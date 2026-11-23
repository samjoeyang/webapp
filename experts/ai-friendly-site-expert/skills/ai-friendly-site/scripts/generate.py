#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate.py — 官网 AI 友好化改造 · 生成脚本

读取一份 facts.json（品牌/商标/授权/FAQ 等事实），结合 analyze.py 的报告，
渲染 assets/templates/ 下的模板，产出待落地的优化文件，写入**独立暂存目录**。

产物（默认写到 ./ai-friendly-out/）：
  - llms.txt            根目录 AI 阅读清单
  - schema-org.html     可直接注入 <head> 的 Organization/WebSite JSON-LD 片段
  - faq.html            含 FAQPage JSON-LD 的标准答案页
  - authentic.html      含 Brand JSON-LD 的正品/商标权属声明页
  - seo-report.md       生成说明 + 落地与验证待办

安全约定：本脚本绝不写入项目源码目录、绝不覆盖现有文件。落地动作由智能体在确认后执行。

用法：
  python3 generate.py --facts facts.json [--report report.json] [--out ./ai-friendly-out]
"""
import argparse
import html
import json
import os
import re
import sys
import urllib.parse
from datetime import datetime

SKILL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATES = os.path.join(SKILL_ROOT, "assets", "templates")


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def fill(template, d):
    out = template
    for k, v in d.items():
        s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
        out = out.replace("{{ " + k + " }}", s).replace("{{" + k + "}}", s)
    # 残留占位符 -> 显式提示，避免裸 {{}} 泄漏到线上
    out = re.sub(r"\{\{\s*([\w\.]+)\s*\}\}", lambda m: f"【请补充：{m.group(1)}】", out)
    return out


def host_label(u):
    try:
        return urllib.parse.urlparse(u).netloc or u
    except Exception:
        return u


def build_schema(brand, department):
    domain = brand.get("domain") or "https://【请补充：域名】"
    name_zh = brand.get("name_zh") or brand.get("name") or "【请补充：品牌名】"
    name_en = brand.get("name_en") or name_zh
    node = {
        "@type": "Organization",
        "@id": domain.rstrip("/") + "#organization",
        "name": f"{name_en}（{name_zh}）" if name_en != name_zh else name_zh,
        "alternateName": name_zh,
        "url": domain,
        "logo": brand.get("logo", ""),
        "description": brand.get("description", ""),
        "sameAs": brand.get("same_as", []),
    }
    if brand.get("parent"):
        node["parentOrganization"] = {"@type": "Organization", "name": brand["parent"]}
    if department.get("name"):
        dept = {"@type": "Organization", "name": department["name"]}
        desc = department.get("description") or ("与真公司关系：" + department.get("relation", ""))
        if desc:
            dept["description"] = desc
        node["department"] = dept
    org = {"@context": "https://schema.org", "@graph": [node]}
    return "<script type=\"application/ld+json\">\n" + json.dumps(org, ensure_ascii=False, indent=2) + "\n</script>"


def main():
    ap = argparse.ArgumentParser(description="官网 AI 友好化改造 · 生成优化文件")
    ap.add_argument("--facts", required=True, help="facts.json 路径")
    ap.add_argument("--report", help="analyze.py 产出的报告 JSON（用于回退品牌名等）")
    ap.add_argument("--out", default="./ai-friendly-out", help="产物输出目录（默认 ./ai-friendly-out）")
    args = ap.parse_args()

    facts = load_json(args.facts)
    report = load_json(args.report) if args.report else {}

    brand = facts.get("brand", {})
    trademark = facts.get("trademark", {})
    department = facts.get("department", {})
    pages = facts.get("pages", {})

    # —— 解析基础字段（带回退与占位提示）——
    primary = (brand.get("name")
               or report.get("checks", {}).get("entity_consistency", {}).get("primary_name")
               or "【请补充：品牌名】")
    name_zh = brand.get("name_zh") or primary
    name_en = brand.get("name_en") or primary
    desc = brand.get("description") or "【请补充：一句话定位】"
    domain = brand.get("domain") or "https://【请补充：域名】"
    domain_r = domain.rstrip("/")
    logo = brand.get("logo", "")
    same_as = brand.get("same_as", []) or []

    def page_url(key, default_path):
        return pages.get(key) or (domain_r + default_path)

    url_about = page_url("about", "/about")
    url_authentic = page_url("authentic", "/authentic")
    url_china = page_url("china", "/china")
    url_products = page_url("products", "/products")
    url_faq = page_url("faq", "/faq")

    trademark_name = trademark.get("name") or "【请补充：注册商标】"
    trademark_reg_no = trademark.get("reg_no") or "【请补充：注册号】"
    trademark_owner = trademark.get("owner") or primary
    trademark_query = trademark.get("query_url") or "https://【请补充：商标局查询页】"
    department_name = department.get("name") or "【请补充：授权方】"
    department_relation = department.get("relation") or "授权经销"
    official_channels = facts.get("official_channels") or "【请补充：官方购买/售后渠道】"
    counterfeit_warning = facts.get("counterfeit_warning") or "【请补充：仿冒警示文案】"
    contact_url = facts.get("contact_url") or url_about
    auth_methods = facts.get("auth_methods", []) or []
    auth_method_1 = auth_methods[0] if len(auth_methods) > 0 else "【请补充：鉴别方法 1】"
    auth_method_2 = auth_methods[1] if len(auth_methods) > 1 else "【请补充：鉴别方法 2】"
    auth_method_3 = auth_methods[2] if len(auth_methods) > 2 else "【请补充：鉴别方法 3】"

    same_as_1 = same_as[0] if len(same_as) > 0 else "https://【请补充：权威源1】"
    same_as_2 = same_as[1] if len(same_as) > 1 else "https://【请补充：权威源2】"
    same_as_1_label = host_label(same_as_1) if "请补充" not in same_as_1 else "权威源 1"
    same_as_2_label = host_label(same_as_2) if "请补充" not in same_as_2 else "权威源 2"

    faq = facts.get("faq", []) or []
    faq_list = []
    faq_items_html = ""
    for qa in faq:
        q = qa.get("q", "【请补充：问题】")
        a = qa.get("a", "【请补充：答案】")
        faq_list.append({
            "@type": "Question",
            "name": q,
            "acceptedAnswer": {"@type": "Answer", "text": a},
        })
        faq_items_html += f'    <section>\n      <h3>Q：{html.escape(q)}</h3>\n      <p>{html.escape(a)}</p>\n    </section>\n\n'
    if not faq_list:
        faq_items_html = '    <section>\n      <h3>Q：【请补充：问题】</h3>\n      <p>【请补充：标准答案】</p>\n    </section>\n'
        faq_list = [{"@type": "Question", "name": "【请补充：问题】",
                     "acceptedAnswer": {"@type": "Answer", "text": "【请补充：答案】"}}]
    faq_json = json.dumps(faq_list, ensure_ascii=False, indent=6)

    # —— 渲染模板 ——
    rendered = {}

    # llms.txt
    with open(os.path.join(TEMPLATES, "llms.txt"), encoding="utf-8") as f:
        t_llms = f.read()
    rendered["llms.txt"] = fill(t_llms, {
        "brand_name": primary, "brand_name_en": name_en, "brand_description": desc,
        "url_about": url_about, "url_authentic": url_authentic, "url_china": url_china,
        "url_products": url_products, "url_faq": url_faq,
        "trademark_name": trademark_name, "trademark_reg_no": trademark_reg_no,
        "department_name": department_name, "department_relation": department_relation,
        "counterfeit_warning": counterfeit_warning,
    })

    # faq.html
    with open(os.path.join(TEMPLATES, "faq.html"), encoding="utf-8") as f:
        t_faq = f.read()
    faq_title = pages.get("titles", {}).get("faq") or f"{primary} 常见问题（标准答案）"
    faq_desc = pages.get("titles", {}).get("faq_desc") or desc
    rendered["faq.html"] = fill(t_faq, {
        "page_title": faq_title, "faq_description": faq_desc, "canonical": url_faq,
        "faq_json": faq_json, "faq_items": faq_items_html, "site_name": primary,
        "url_authentic": url_authentic, "url_about": url_about,
    })

    # authentic.html
    with open(os.path.join(TEMPLATES, "authentic.html"), encoding="utf-8") as f:
        t_auth = f.read()
    auth_title = pages.get("titles", {}).get("authentic") or f"{primary} · 正品与商标权属声明"
    auth_desc = pages.get("titles", {}).get("authentic_desc") or desc

    # —— 计算修正字段（避免模板硬占位产生错误/空链接）——
    owner_name = department.get("name") or trademark.get("owner") or primary
    logo_field = f'"logo": "{logo}",' if logo else ""
    # 商标区块：注册号未知时给出中性说明，绝不编造注册号
    if "请补充" in trademark_reg_no:
        reg_line = f'<li>{html.escape(primary)} 为本站使用的品牌标识；商标权属与注册状态以国家知识产权局登记为准（注册号待补充）。</li>'
    else:
        reg_line = f'<li>商标注册号：<code>{html.escape(trademark_reg_no)}</code></li>'
    trademark_section = "\n      ".join([
        f'<li>注册商标：<code>{html.escape(trademark_name)}</code></li>',
        reg_line,
        f'<li>商标权属人：{html.escape(trademark_owner)}</li>',
        f'<li>官方查询：<a href="{html.escape(trademark_query)}" target="_blank" rel="noopener">商标局公开查询页</a></li>',
    ])
    # 权威佐证：仅渲染真实 same_as，过滤占位符
    real_same_as = [s for s in same_as if s and "请补充" not in s]
    if not real_same_as:
        real_same_as = [domain_r]
    same_as_items = "\n      ".join(
        f'<li><a href="{html.escape(s)}" target="_blank" rel="noopener">{html.escape(host_label(s))}</a></li>'
        for s in real_same_as
    )

    rendered["authentic.html"] = fill(t_auth, {
        "page_title": auth_title, "auth_description": auth_desc, "canonical": url_authentic,
        "brand_name": primary, "brand_name_zh": name_zh,
        "domain": domain_r, "logo_field": logo_field,
        "owner_name": owner_name,
        "trademark_section": trademark_section,
        "department_name": department_name, "department_relation": department_relation,
        "official_channels": official_channels,
        "auth_method_1": auth_method_1, "auth_method_2": auth_method_2, "auth_method_3": auth_method_3,
        "counterfeit_warning": counterfeit_warning,
        "same_as_items": same_as_items,
        "site_name": primary, "contact_url": contact_url,
    })

    # schema（程序化生成，不等同于模板占位）
    rendered["schema-org.html"] = build_schema(brand, department)

    # —— 写出到暂存目录 ——
    os.makedirs(args.out, exist_ok=True)
    written = []
    for name, content in rendered.items():
        p = os.path.join(args.out, name)
        with open(p, "w", encoding="utf-8") as f:
            f.write(content)
        written.append(p)

    # —— seo-report.md ——
    needs = []
    if "请补充" in rendered["llms.txt"]:
        needs.append("llms.txt 仍有占位符待补（品牌名/商标号/授权方/仿冒警示等）")
    if "请补充" in rendered["faq.html"]:
        needs.append("faq.html 仍有占位符待补（FAQ 至少 1 条需真实问答）")
    if "请补充" in rendered["authentic.html"]:
        needs.append("authentic.html 仍有占位符待补（鉴别方法/授权渠道等）")
    if "请补充" in trademark_reg_no:
        needs.append("authentic.html 的商标注册号待补充：请向商标权人索取真实注册号填入 facts.json，切勿编造（当前为中性说明占位）。")
    report_md = f"""# AI 友好化生成报告

生成时间：{datetime.now().isoformat(timespec='seconds')}
事实来源：{os.path.abspath(args.facts)}

## 已生成文件（暂存于 `{os.path.abspath(args.out)}`）

| 文件 | 用途 | 落地位置 |
|---|---|---|
| `llms.txt` | 根目录 AI 阅读清单 | 站点根 / `public/` |
| `schema-org.html` | Organization JSON-LD 片段 | 注入各页 `<head>` |
| `faq.html` | 标准答案页（含 FAQPage JSON-LD） | 站点根 / `public/`，URL 对应 `{url_faq}` |
| `authentic.html` | 正品/商标权属页（含 Brand JSON-LD） | 站点根 / `public/`，URL 对应 `{url_authentic}` |

## 落地与验证待办

1. 把 `llms.txt`、`faq.html`、`authentic.html` 复制到**站点根或 `public/`**，确保 `https://域名/llms.txt` 等可公开访问。
2. 把 `schema-org.html` 内的 `<script>` 注入到 `index.html`（全局 Organization）+ 各静态页 `<head>`；SPA 逐页 schema 在组件内动态注入。
3. 全站内链：首页 ↔ 关于 ↔ 正品声明 ↔ FAQ 互相链接，强化"同一主体"图谱。
4. 用 [Schema Markup Validator](https://validator.schema.org/) 验证 JSON-LD 无报错。
5. 浏览器访问 `https://域名/llms.txt`、`/faq.html`、`/authentic.html` 确认可访问。
6. AI 探针：用 prompt 模拟用户提问，观察主流 AI 是否引到你的官网；每周复测。

## 仍需人工补充

{chr(10).join('- ' + n for n in needs) if needs else '- 无，所有占位符均已填充'}
"""
    rp = os.path.join(args.out, "seo-report.md")
    with open(rp, "w", encoding="utf-8") as f:
        f.write(report_md)
    written.append(rp)

    print("已生成以下文件（均位于暂存目录，未改动项目源码）：")
    for w in written:
        print("  - " + w)
    if needs:
        print("\n⚠️ 仍有占位符待补充：")
        for n in needs:
            print("   · " + n)
    else:
        print("\n✅ 所有占位符均已填充，可直接落地。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
