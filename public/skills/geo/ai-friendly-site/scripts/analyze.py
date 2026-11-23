#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analyze.py — 官网 AI 友好化改造 · 审计脚本

对「本地目录 / 本地文件 / 网站 URL」做只读审计，输出一份 AI 友好化缺口报告（JSON）。
配合 references/analysis-guide.md 使用。

用法：
  # 扫描本地项目目录
  python3 analyze.py --path /path/to/site

  # 扫描若干本地文件
  python3 analyze.py --files a.html b.html

  # 审计线上网站（尝试抓取首页 + 探测 llms.txt/robots.txt）
  python3 analyze.py --url https://example.com

  # 聚焦某个品牌名的实体一致性
  python3 analyze.py --path /path/to/site --brand-name "真公司"

  # 把报告写入文件并只看 JSON
  python3 analyze.py --path . --out report.json --json

依赖：仅 Python 标准库。
"""
import argparse
import json
import os
import re
import ssl
import sys
import urllib.request
import urllib.error
from datetime import datetime

SKILL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

IGNORE_DIRS = {
    "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
    ".workbuddy", ".cache", ".idea", ".vscode", "__pycache__", "vendor",
    # 不审计 skill 自身的源码（避免把模板/SKILL.md 误判为网站的 FAQ/正品页）
    "ai-friendly-site",
}

ROOT_HINT = {
    "vite-spa": "public/（构建后原样进 dist/ 根）",
    "angular-spa": "public/",
    "nextjs": "public/",
    "astro": "public/",
    "ssg": "static/ 或 public/",
    "static-html": "站点根目录",
    "unknown": "站点根目录或 public/",
}

FAQ_KEYWORDS_TXT = ("常见问题", "FAQ", "Q&A", "q&a", "frequently asked")
AUTH_KEYWORDS = ("正品", "商标", "授权", "防伪", "仿冒", "authentic", "trademark", "genuine")


# --------------------------------------------------------------------------- #
# 网络抓取（URL 模式）
# --------------------------------------------------------------------------- #
def fetch_url(url, timeout=15):
    """返回 (text_or_None, error_or_None)。自动尊重 HTTP(S)_PROXY 环境变量。"""
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (compatible; AIOptAudit/1.0)"}
    )
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            raw = r.read()
        return raw.decode("utf-8", "replace"), None
    except Exception as e:  # 网络不可用 / 404 / 超时等
        return None, str(e)


# --------------------------------------------------------------------------- #
# 框架识别
# --------------------------------------------------------------------------- #
def detect_framework(path):
    if not os.path.isdir(path):
        return "unknown"
    has = lambda *names: any(os.path.isfile(os.path.join(path, n)) for n in names)

    if has("vite.config.js", "vite.config.ts", "vite.config.mjs"):
        return "vite-spa"
    if has("next.config.js", "next.config.mjs", "next.config.ts"):
        return "nextjs"
    if has("astro.config.mjs", "astro.config.ts", "astro.config.js"):
        return "astro"
    pj = os.path.join(path, "package.json")
    if os.path.isfile(pj):
        try:
            d = json.load(open(pj, encoding="utf-8"))
            deps = {**d.get("dependencies", {}), **d.get("devDependencies", {})}
            if "next" in deps:
                return "nextjs"
            if "astro" in deps:
                return "astro"
            if "@angular/core" in deps:
                return "angular-spa"
            if "react" in deps or "vue" in deps or "@vue/cli-service" in deps:
                return "vite-spa"
        except Exception:
            pass
    if has("config.toml", "_config.yml", "_config.yaml") and os.path.isdir(os.path.join(path, "content")):
        return "ssg"
    if has("index.html"):
        return "static-html"
    return "unknown"


# --------------------------------------------------------------------------- #
# HTML 解析工具
# --------------------------------------------------------------------------- #
def extract_jsonld(html):
    blocks = re.findall(
        r"<script[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
        html, re.DOTALL | re.IGNORECASE,
    )
    parsed = []
    for b in blocks:
        b = b.strip()
        if not b:
            continue
        try:
            parsed.append(json.loads(b))
        except Exception:
            # 容错：尝试去注释
            try:
                parsed.append(json.loads(re.sub(r"/\*.*?\*/", "", b, flags=re.DOTALL)))
            except Exception:
                parsed.append({"__parse_error__": True})
    return parsed


def jsonld_types(parsed):
    types = []
    names = []
    for obj in parsed:
        if not isinstance(obj, dict):
            continue
        graph = obj.get("@graph", [obj])
        if isinstance(graph, list):
            for node in graph:
                if isinstance(node, dict) and "@type" in node:
                    t = node["@type"]
                    types.append(t if isinstance(t, str) else str(t))
                    if "name" in node:
                        names.append(node["name"])
    return types, names


def strip_tags(html):
    return re.sub(r"<[^>]+>", " ", html)


def count_brand(text, brand):
    if not brand:
        return 0
    return text.count(brand)


# --------------------------------------------------------------------------- #
# 目录扫描
# --------------------------------------------------------------------------- #
def find_files(path, exts):
    out = []
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        for f in files:
            if any(f.lower().endswith(e) for e in exts):
                out.append(os.path.join(root, f))
    return out


def analyze_dir(path, brand_name=None):
    framework = detect_framework(path)
    html_files = find_files(path, (".html", ".htm"))
    md_files = find_files(path, (".md", ".markdown"))
    text_files = html_files + md_files
    json_files = find_files(path, (".json",))

    # 根目录 / public 探测关键文件
    candidates_root = [path]
    pub = os.path.join(path, "public")
    if os.path.isdir(pub):
        candidates_root.append(pub)

    def exists_in_roots(name):
        for r in candidates_root:
            p = os.path.join(r, name)
            if os.path.isfile(p):
                return os.path.relpath(p, path)
        return None

    llms = exists_in_roots("llms.txt")
    robots = exists_in_roots("robots.txt")
    sitemap = exists_in_roots("sitemap.xml") or exists_in_roots("sitemap_index.xml")

    # JSON-LD 汇总
    all_jsonld = []
    files_with_schema = []
    for hf in html_files:
        try:
            html = open(hf, encoding="utf-8", errors="replace").read()
        except Exception:
            continue
        p = extract_jsonld(html)
        if p:
            files_with_schema.append(os.path.relpath(hf, path))
            all_jsonld.extend(p)
    schema_types, schema_names = jsonld_types(all_jsonld)

    # FAQ / 正品页候选（仅针对真实网页 HTML，避免把文档里提及"FAQ"的 md 误判）
    faq_candidates = []
    auth_candidates = []
    for tf in html_files:
        try:
            content = open(tf, encoding="utf-8", errors="replace").read()
        except Exception:
            continue
        base = os.path.basename(tf).lower()
        rel = os.path.relpath(tf, path)
        has_faq_kw = ("faq" in base) or any(k.lower() in content.lower() for k in FAQ_KEYWORDS_TXT)
        signals = []
        if "faq" in base:
            signals.append("文件名含 faq")
        if any(k.lower() in content.lower() for k in FAQ_KEYWORDS_TXT):
            signals.append("正文含 FAQ 关键词")
        h3 = len(re.findall(r"<h3[\s>]", content, re.I))
        # 仅当已命中 FAQ 关键词/文件名时，才把 h3+<p> 结构当作佐证，避免误判普通落地页
        if has_faq_kw and h3 >= 3 and "<p" in content.lower():
            signals.append("结构：≥3 个 <h3>+<p> 问答块")
        if signals:
            faq_candidates.append({"path": rel, "signals": signals, "h3_count": h3})

        a_signals = []
        if any(k in base for k in ("authentic", "trademark", "zhenpin", "shouquan")):
            a_signals.append("文件名含授权/商标/正品")
        if any(k in content for k in AUTH_KEYWORDS):
            a_signals.append("正文含商标/授权/正品/防伪关键词")
        if a_signals:
            auth_candidates.append({"path": rel, "signals": a_signals})

    # 实体一致性
    entity = {"primary_name": None, "name_variants": sorted(set(schema_names)), "brand_mentions": {}}
    if not brand_name and schema_names:
        brand_name = schema_names[0]
    if not brand_name:
        # 退而求其次：取 index.html 的 <title>
        for hf in html_files:
            if os.path.basename(hf).lower() in ("index.html", "index.htm"):
                try:
                    t = re.search(r"<title>(.*?)</title>", open(hf, encoding="utf-8", errors="replace").read(), re.I | re.S)
                    if t:
                        brand_name = t.group(1).strip().split("·")[0].strip()
                except Exception:
                    pass
                break
    entity["primary_name"] = brand_name
    if brand_name:
        for tf in html_files:
            try:
                txt = strip_tags(open(tf, encoding="utf-8", errors="replace").read())
            except Exception:
                continue
            c = count_brand(txt, brand_name)
            if c:
                entity["brand_mentions"][os.path.relpath(tf, path)] = c

    # 内链（首页级文件）
    internal_links = 0
    for hf in html_files:
        try:
            html = open(hf, encoding="utf-8", errors="replace").read()
        except Exception:
            continue
        base = os.path.basename(hf).lower()
        if base in ("index.html", "index.htm") or base == os.path.basename(path).lower():
            internal_links = len(re.findall(r'href=["\'](?!https?://|//|mailto:|tel:|#)([^"\']+)["\']', html))

    return {
        "mode": "dir",
        "target": path,
        "framework": framework,
        "root_hint": ROOT_HINT.get(framework, ROOT_HINT["unknown"]),
        "file_counts": {
            "html": len(html_files),
            "markdown": len(md_files),
            "json": len(json_files),
        },
        "checks": {
            "llms_txt": {"present": bool(llms), "path": llms},
            "robots_txt": {"present": bool(robots), "path": robots},
            "sitemap": {"present": bool(sitemap), "path": sitemap},
            "jsonld": {
                "present": bool(schema_types),
                "files_with_schema": files_with_schema,
                "types": sorted(set(schema_types)),
            },
            "faq_page": {"present": bool(faq_candidates), "candidates": faq_candidates},
            "authentic_page": {"present": bool(auth_candidates), "candidates": auth_candidates},
            "entity_consistency": entity,
            "internal_linking": {"index_internal_links": internal_links},
        },
    }


# --------------------------------------------------------------------------- #
# URL 模式
# --------------------------------------------------------------------------- #
def analyze_url(url, brand_name=None):
    base = url.rstrip("/")
    home, err = fetch_url(base)
    if home is None:
        return {
            "mode": "url",
            "target": url,
            "framework": "unknown",
            "error": "无法抓取首页：" + (err or "未知错误"),
            "manual_collection_hint": [
                "用 WebFetch 采集首页：" + base,
                "用 WebFetch 采集：" + base + "/llms.txt",
                "用 WebFetch 采集：" + base + "/robots.txt",
                "把采集到的文本存为本地文件后，改用 --files 或 --path 模式重跑。",
            ],
            "checks": {},
        }

    llms_txt, _ = fetch_url(base + "/llms.txt")
    robots_txt, _ = fetch_url(base + "/robots.txt")
    sitemap, _ = fetch_url(base + "/sitemap.xml")

    schema = extract_jsonld(home)
    schema_types, schema_names = jsonld_types(schema)

    entity = {"primary_name": brand_name or (schema_names[0] if schema_names else None),
              "name_variants": sorted(set(schema_names)), "brand_mentions": {}}
    if entity["primary_name"]:
        entity["brand_mentions"]["homepage"] = count_brand(strip_tags(home), entity["primary_name"])

    faq_signals = []
    if "faq" in base:
        faq_signals.append("URL 含 faq")
    if any(k.lower() in home.lower() for k in FAQ_KEYWORDS_TXT):
        faq_signals.append("首页含 FAQ 关键词")
    auth_signals = [k for k in AUTH_KEYWORDS if k in home]

    return {
        "mode": "url",
        "target": url,
        "framework": "unknown",
        "checks": {
            "llms_txt": {"present": bool(llms_txt and "application" not in (llms_txt[:40].lower()) and len(llms_txt) > 5),
                         "fetched": bool(llms_txt), "note": "若 fetched=false 表示线上不存在"},
            "robots_txt": {"present": bool(robots_txt), "fetched": bool(robots_txt)},
            "sitemap": {"present": bool(sitemap), "fetched": bool(sitemap)},
            "jsonld": {"present": bool(schema_types), "types": sorted(set(schema_types))},
            "faq_page": {"present": bool(faq_signals), "signals": faq_signals},
            "authentic_page": {"present": bool(auth_signals), "signals": auth_signals},
            "entity_consistency": entity,
            "internal_linking": {"index_internal_links": len(re.findall(r'href=["\'](?!https?://|//|mailto:|tel:|#)([^"\']+)["\']', home))},
        },
    }


# --------------------------------------------------------------------------- #
# 汇总缺口
# --------------------------------------------------------------------------- #
def summarize_gaps(report):
    c = report.get("checks", {})
    gaps = []
    must = [
        ("llms_txt", "① llms.txt 缺失"),
        ("robots_txt", "② robots.txt 缺失"),
        ("jsonld", "③ schema.org 结构化数据缺失/不完整"),
        ("faq_page", "④ FAQ 标准答案页缺失"),
        ("authentic_page", "⑤ 正品/商标权属声明页缺失"),
    ]
    for key, label in must:
        item = c.get(key, {})
        if not item.get("present"):
            gaps.append(label)
    if not c.get("sitemap", {}).get("present"):
        gaps.append("建议：sitemap.xml 缺失")
    ent = c.get("entity_consistency", {})
    if ent.get("name_variants") and len(ent["name_variants"]) > 1:
        gaps.append("实体称谓不一致：" + " / ".join(ent["name_variants"]))
    return gaps


# --------------------------------------------------------------------------- #
# 人类可读摘要
# --------------------------------------------------------------------------- #
def print_summary(report):
    c = report.get("checks", {})
    line = lambda k, v: print(f"  - {k}: {v}")
    print(f"\n=== 官网 AI 友好化审计 ===")
    print(f"目标: {report.get('target')}  | 模式: {report.get('mode')}  | 框架: {report.get('framework')}")
    if report.get("root_hint"):
        print(f"静态文件落点建议: {report['root_hint']}")
    if report.get("error"):
        print(f"⚠️ {report['error']}")
        for h in report.get("manual_collection_hint", []):
            print(f"   · {h}")
        return
    print("逐项检查：")
    line("llms.txt", "✅ 有 (" + str(c['llms_txt'].get('path')) + ")" if c.get('llms_txt', {}).get('present') else "❌ 缺失")
    line("robots.txt", "✅ 有" if c.get('robots_txt', {}).get('present') else "❌ 缺失")
    line("sitemap.xml", "✅ 有" if c.get('sitemap', {}).get('present') else "— 缺失(建议)")
    jl = c.get('jsonld', {})
    line("schema.org", ("✅ 类型: " + ", ".join(jl.get('types', []))) if jl.get('present') else "❌ 缺失")
    line("FAQ 页", ("✅ 候选: " + ", ".join(x['path'] for x in c.get('faq_page', {}).get('candidates', []))) if c.get('faq_page', {}).get('present') else "❌ 缺失")
    line("正品声明页", ("✅ 候选: " + ", ".join(x['path'] for x in c.get('authentic_page', {}).get('candidates', []))) if c.get('authentic_page', {}).get('present') else "❌ 缺失")
    ent = c.get('entity_consistency', {})
    line("实体主名", ent.get('primary_name') or "（未识别，建议用 --brand-name）")
    if ent.get('name_variants') and len(ent['name_variants']) > 1:
        line("⚠️ 称谓变体", " / ".join(ent['name_variants']))
    il = c.get('internal_linking', {})
    line("首页内链数", il.get('index_internal_links', 0))
    gaps = summarize_gaps(report)
    print("\n缺口清单（gaps）：")
    if gaps:
        for g in gaps:
            print(f"  ❌ {g}")
    else:
        print("  ✅ 六项必做全部具备")
    print()


# --------------------------------------------------------------------------- #
# 入口
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="官网 AI 友好化改造审计")
    ap.add_argument("--path", help="本地项目/目录路径")
    ap.add_argument("--files", help="逗号分隔的本地文件列表")
    ap.add_argument("--url", help="网站 URL")
    ap.add_argument("--brand-name", help="聚焦检查的品牌名（实体一致性）")
    ap.add_argument("--out", help="把 JSON 报告写入该文件")
    ap.add_argument("--json", action="store_true", help="只输出 JSON 到 stdout")
    args = ap.parse_args()

    if sum(bool(x) for x in (args.path, args.files, args.url)) != 1:
        ap.error("必须且只能指定 --path / --files / --url 之一")
        return 2

    if args.url:
        report = analyze_url(args.url, args.brand_name)
    elif args.files:
        files = [f.strip() for f in args.files.split(",") if f.strip()]
        # 用首个文件的目录作为根，逐文件分析后合并
        root = os.path.dirname(os.path.commonpath(files)) if len(files) > 1 else os.path.dirname(files[0])
        merged = analyze_dir(root or ".", args.brand_name)
        # 仅保留这些文件相关结果较复杂；简单起见仍扫描整目录
        report = merged
    else:
        if not os.path.isdir(args.path):
            print(f"路径不存在: {args.path}", file=sys.stderr)
            return 2
        report = analyze_dir(args.path, args.brand_name)

    report["generated_at"] = datetime.now().isoformat(timespec="seconds")
    report["gaps"] = summarize_gaps(report)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_summary(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
