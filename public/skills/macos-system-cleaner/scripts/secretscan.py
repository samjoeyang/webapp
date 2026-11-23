#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
首次推送远程仓库前的凭据体检（只读，不修改任何文件）。

回答三个问题：
  1) 这个项目现在会被推上去的，具体是哪些文件？（含未跟踪但未被 .gitignore 排除的）
  2) 其中有没有明文凭据？是真凭据还是占位符？
  3) 历史里是否进过敏感路径（.env / 私钥 / 备份目录）？

关键判据（踩过的坑都在这）：
  - `.env` 的变体副本（`.envGgHYK9` 这类 6 位随机后缀）与 `.env` 内容逐字段相同 —— 只写 `.env` 到
    .gitignore 是不够的，必须 `.env*`。
  - 代码里的兜底默认值（`process.env.PASS || '真实口令'`）是最容易漏的一类，它长得像配置。
  - 大量命中是假阳性（占位符、从环境变量读取、文档示例），脚本会把它们单独归类，别一律当真。
  - 本地根本不是 git 仓库时容错为零：一次 `git add -A` 就把口令写进历史。

用法：
  python3 secretscan.py [--repo DIR] [--history] [--json] [--out FILE] [--strict]
退出码：0 = 未发现需阻断项；1 = 发现疑似真实凭据或敏感文件将入库；2 = 参数/环境错误。
"""
import os
import re
import sys
import json
import argparse
import subprocess
from concurrent.futures import ThreadPoolExecutor

# 凭据特征：(名称, 正则, 级别)
PATTERNS = [
    ("私钥内容", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "critical"),
    ("AWS Access Key ID", re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "critical"),
    ("GitHub Token", re.compile(r"\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}"), "critical"),
    ("sk- 风格 API Key", re.compile(r"\bsk-[A-Za-z0-9_\-]{20,}"), "critical"),
    ("Slack Token", re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}"), "high"),
    ("Google API Key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}"), "high"),
    ("带口令的连接串",
     re.compile(r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://[^\s:@/]+:[^\s:@/]+@"), "critical"),
    # 代码里的「兜底默认值」——最容易被漏掉的一类：长得像配置，实际是把真口令固化进仓库。
    # 必须先于通用赋值式匹配，否则会被当成普通配置。
    # ⚠️ 分隔符只认 || / or / ??，不认逗号（`,` 会把单词列表误判成默认值）；
    #    `ENV` 必须带词边界，否则 "tenvis" 这类单词里的 env 会命中。
    ("代码兜底默认值",
     re.compile(r"(?i)((?:process\.env|os\.environ(?:\.get)?|getenv|\bENV\b)[\.\[\(]?['\"]?[A-Z0-9_]+['\"]?[\]\)]?)"
                r"\s*(?:\|\||\bor\b|\?\?)\s*['\"]([^'\"]{6,})['\"]"), "critical"),
    # 赋值式口令/密钥：锚定行首（可带 export 与前导空白），避免命中正文里的单词
    # （如 frontmatter 的 `author: 某公司` 里的 "auth"）。AUTH 必须成词，不能裸写。
    ("赋值式口令/密钥",
     re.compile(r"(?im)^\s*(?:export\s+|set\s+)?"
                r"([A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|ACCESS_KEY|PRIVATE_KEY|API_KEY|"
                r"TOKEN|AUTHORIZATION|AUTH_TOKEN|AUTH_KEY|CREDENTIALS?)[A-Za-z0-9_]*)"
                r"\s*[:=]\s*['\"]?([^\s'\"#,]{6,})"), "high"),
]

# 占位符 / 非真实值的特征（命中即降级为「需人工确认」，不算阻断项）
PLACEHOLDER_RE = re.compile(
    r"(?i)(your[_-]?|please[_-]?change|changeme|change[_-]?me|replace[_-]?me|placeholder|"
    r"dummy|example|sample|xxx+|\*{3,}|<[^>]{1,40}>|\$\{[^}]{1,60}\}|\$[A-Z_]{2,}|"
    r"%\([A-Za-z_]+\)s|printenv|os\.environ|getenv|process\.env|password123|test123|"
    r"^none$|^null$|^true$|^false$|^\d{1,3}$)")

# 文件级敏感（路径命中即视为「不该进仓库」，与内容无关）
SENSITIVE_PATH_RE = re.compile(
    r"(?:^|/)("
    r"\.env[A-Za-z0-9]{6}"          # .env 的随机后缀临时副本 —— 最常漏
    r"|\.env"
    r"|id_rsa|id_ed25519|id_ecdsa"
    r"|[^/]*\.pem|[^/]*\.key|[^/]*\.p12|[^/]*\.pfx"
    r"|cookies\.txt"
    r"|docker-compose\.ya?ml[A-Za-z0-9]{6}"   # 保存时产生的随机后缀副本
    r")$")

SENSITIVE_DIR_HINTS = (" .backup ", "/.backup/", "/backups/", ".old/")

MAX_FILE_BYTES = 2 * 1024 * 1024   # 超过 2MB 不读内容（推上去前本就该排除）
TEXT_EXT_SKIP = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
                 ".tgz", ".bz2", ".xz", ".7z", ".mp4", ".mov", ".mp3", ".woff", ".woff2",
                 ".ttf", ".otf", ".so", ".dylib", ".dll", ".exe", ".bin", ".pyc", ".sqlite3"}


def sh(argv, cwd=None, timeout=60):
    try:
        r = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.stdout, r.returncode
    except Exception:
        return "", 1


def git(args, cwd, timeout=60):
    return sh(["git"] + args, cwd=cwd, timeout=timeout)


def redact(s):
    """只留可识别的前缀，避免把口令本身又打印一遍。"""
    s = s.strip()
    if len(s) <= 6:
        return "*" * len(s)
    return s[:3] + "*" * min(8, len(s) - 3) + "(%d字符)" % len(s)


def make_snippet(line, m):
    """把命中片段的「值」部分打码后返回，保留键名便于定位。"""
    s = line.rstrip("\n")
    try:
        if m.lastindex and m.lastindex >= 2 and m.group(2):
            a, b = m.span(2)
        else:
            a, b = m.span()
        s = s[:a] + "***已打码***" + s[b:]
    except Exception:
        s = "***已打码***"
    s = s.strip()
    return s[:157] + "..." if len(s) > 160 else s


def is_binary_by_ext(path):
    return os.path.splitext(path)[1].lower() in TEXT_EXT_SKIP


def scan_file(root, rel):
    """扫描单个文件，返回命中列表。"""
    full = os.path.join(root, rel)
    hits = []
    # 1) 路径本身敏感
    if SENSITIVE_PATH_RE.search("/" + rel.replace(os.sep, "/")):
        hits.append({"file": rel, "line": 0, "pattern": "敏感文件名",
                     "level": "critical", "snippet": "", "placeholder": False,
                     "note": "文件名/后缀即属敏感类型，不应进入仓库"})
    if is_binary_by_ext(full):
        return hits
    try:
        if os.path.getsize(full) > MAX_FILE_BYTES:
            return hits
        with open(full, "r", encoding="utf-8", errors="strict") as f:
            lines = f.readlines()
    except (OSError, UnicodeDecodeError):
        return hits

    for i, line in enumerate(lines, 1):
        if len(line) > 4000:
            line = line[:4000]
        for name, rx, level in PATTERNS:
            m = rx.search(line)
            if not m:
                continue
            snippet = make_snippet(line, m)
            # 判读：占位符还是真凭据
            target = m.group(2) if (m.lastindex or 0) >= 2 else m.group(0)
            # 只判读「值」本身：整行含 process.env 不代表值无害
            # （`process.env.X || '真实口令'` 正是最该拦的一类）
            placeholder = bool(PLACEHOLDER_RE.search(target))
            hits.append({
                "file": rel, "line": i, "pattern": name,
                "level": "info" if placeholder else level,
                "snippet": snippet, "placeholder": placeholder,
                "note": "疑似占位符/从环境读取，人工确认" if placeholder else "疑似真实凭据",
            })
            break   # 一行只报一次，避免同类刷屏
    return hits


def check_gitignore(root):
    """检查 .gitignore 是否覆盖关键路径（正反两个方向）。"""
    must_ignore = [".env", ".env.local", "data/", "models/", "node_modules/", ".backup/"]
    must_not_ignore = [".env.example"]
    out = {"ignored_ok": [], "ignored_missing": [], "wrongly_ignored": []}
    for p in must_ignore:
        full = os.path.join(root, p)
        if not os.path.exists(full):
            continue
        _, rc = git(["check-ignore", "-q", p], root)
        (out["ignored_ok"] if rc == 0 else out["ignored_missing"]).append(p)
    for p in must_not_ignore:
        if not os.path.exists(os.path.join(root, p)):
            continue
        _, rc = git(["check-ignore", "-q", p], root)
        if rc == 0:
            out["wrongly_ignored"].append(p)
    return out


def main():
    ap = argparse.ArgumentParser(description="推送前凭据体检（只读）")
    ap.add_argument("--repo", default=".", help="项目目录（默认当前目录）；若在仓库子目录下，默认只扫该子目录")
    ap.add_argument("--whole-repo", action="store_true",
                    help="即使 --repo 是仓库子目录，也扫描整个仓库（仓库很大时会很慢）")
    ap.add_argument("--history", action="store_true", help="额外检查历史中是否进过敏感路径")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    ap.add_argument("--out", help="JSON 输出到文件")
    ap.add_argument("--strict", action="store_true", help="占位符命中也视为阻断")
    args = ap.parse_args()

    root = os.path.abspath(os.path.expanduser(args.repo))
    if not os.path.isdir(root):
        sys.stderr.write("目录不存在: %s\n" % root)
        sys.exit(2)

    out, rc = git(["rev-parse", "--show-toplevel"], root)
    is_git = (rc == 0 and out.strip() != "")
    repo_root = out.strip() if is_git else root

    report = {
        "repo": repo_root,
        "is_git_repo": is_git,
        "branch": None,
        "remote": None,
        "head": None,
        "to_be_committed": [],      # 会被推上去的文件（tracked + 未忽略的未跟踪）
        "findings": [],
        "gitignore": {},
        "history": [],
        "blocking_count": 0,
        "warning_count": 0,
    }

    if is_git:
        out, _ = git(["branch", "--show-current"], repo_root)
        report["branch"] = out.strip() or "(detached)"
        out, _ = git(["remote", "-v"], repo_root)
        report["remote"] = out.strip() or None
        out, _ = git(["rev-parse", "HEAD"], repo_root)
        report["head"] = out.strip() or None

        # ⚠️ --repo 常指向仓库的某个子目录。若不加限制，git ls-files 会列出整仓库文件，
        # 在大型仓库上会慢到被 SIGTERM（exit 137），而且扫的也不是用户想扫的范围。
        # 用 realpath 比较：/tmp 与 /private/tmp 这类软链接差异会造成误判。
        sub = os.path.relpath(os.path.realpath(root), os.path.realpath(repo_root))
        if sub == os.curdir or sub.startswith(os.pardir):
            sub = "."
        elif not args.whole_repo:
            report["scoped_to"] = sub
        else:
            sub = "."
        pathspec = [] if sub == "." else ["--", sub]

        out, _ = git(["ls-files"] + pathspec, repo_root)
        tracked = [x for x in out.splitlines() if x.strip()]
        out, _ = git(["ls-files", "--others", "--exclude-standard"] + pathspec, repo_root)
        untracked = [x for x in out.splitlines() if x.strip()]
        if sub != ".":
            pre = sub.rstrip("/") + "/"
            tracked = [x[len(pre):] if x.startswith(pre) else x for x in tracked]
            untracked = [x[len(pre):] if x.startswith(pre) else x for x in untracked]
        report["to_be_committed"] = sorted(set(tracked + untracked))
        report["gitignore"] = check_gitignore(root if sub != "." else repo_root)
        if args.history:
            hp = [] if sub == "." else [sub]
            for probe in [".env", ".backup", "*.pem", "*.key"]:
                h, hrc = git(["log", "--all", "--oneline"] + (["--"] + hp if hp else ["--"]) + [probe],
                             repo_root, timeout=120)
                if hrc == 0 and h.strip():
                    report["history"].append({
                        "path": probe,
                        "commits": len(h.strip().splitlines()),
                        "sample": h.strip().splitlines()[:3],
                    })
    else:
        # 非 git 目录：把「若此刻 git init + add -A 会被推上去的文件」全部列出
        skip_dirs = {".git", "node_modules", "venv", ".venv", "env", "__pycache__",
                     "dist", "build", ".next", "target", ".idea", ".vscode"}
        files = []
        for dp, dns, fns in os.walk(root):
            dns[:] = [d for d in dns if d not in skip_dirs and not d.startswith(".Trash")]
            for fn in fns:
                rel = os.path.relpath(os.path.join(dp, fn), root)
                files.append(rel)
            if len(files) > 20000:
                break
        report["to_be_committed"] = sorted(files)

    # 扫描内容：清单里的相对路径是相对 scan_root 的。
    # 用线程池并发读（I/O 密集；同步盘/网络卷上串行读 300 个文件能拖到一分钟）。
    scan_root = root if report.get("scoped_to") else repo_root
    files = report["to_be_committed"][:20000]
    with ThreadPoolExecutor(max_workers=8) as ex:
        for hits in ex.map(lambda r: scan_file(scan_root, r), files):
            report["findings"].extend(hits)

    blocking = [f for f in report["findings"]
                if f["level"] in ("critical", "high") and (args.strict or not f["placeholder"])]
    warnings = [f for f in report["findings"] if f["placeholder"] or f["level"] == "info"]
    report["blocking_count"] = len(blocking)
    report["warning_count"] = len(warnings)

    if args.json or args.out:
        payload = json.dumps(report, ensure_ascii=False, indent=2)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(payload)
        if args.json:
            print(payload)
    else:
        # 人类可读输出
        print("仓库: %s" % repo_root)
        print("形态: %s" % ("git 仓库（分支 %s）" % report["branch"] if is_git
                            else "⚠️ 不是 git 仓库 —— 零历史但零容错，.gitignore 必须一次到位"))
        if report.get("scoped_to"):
            print("扫描范围: %s（仓库根为 %s，其余文件未扫；需全仓库用 --whole-repo）"
                  % (report["scoped_to"], repo_root))
        if is_git:
            print("远程: %s" % (report["remote"] or "（无 remote）"))
        print("将进入仓库的文件: %d 个" % len(report["to_be_committed"]))
        gi = report["gitignore"]
        if is_git:
            if gi.get("ignored_missing"):
                print("⚠️ .gitignore 未覆盖: %s" % ", ".join(gi["ignored_missing"]))
            if gi.get("wrongly_ignored"):
                print("⚠️ 误伤（不该忽略却被忽略）: %s" % ", ".join(gi["wrongly_ignored"]))
            if not gi.get("ignored_missing") and not gi.get("wrongly_ignored"):
                print("✅ .gitignore 关键项覆盖正常")
        if report["history"]:
            print("\n⚠️ 历史中出现过敏感路径：")
            for h in report["history"]:
                print("  %-12s %d 个提交" % (h["path"], h["commits"]))

        if blocking:
            print("\n🚫 需处理（疑似真实凭据/敏感文件）: %d 处" % len(blocking))
            for f in blocking[:40]:
                loc = f["file"] + (":%d" % f["line"] if f["line"] else "")
                print("  [%s] %s\n      %s\n      %s" % (f["level"], loc, f["pattern"],
                                                         f["snippet"] or f["note"]))
        if warnings:
            print("\nℹ️ 需人工确认（多为占位符/环境变量）: %d 处" % len(warnings))
            for f in warnings[:15]:
                loc = f["file"] + (":%d" % f["line"] if f["line"] else "")
                print("  %s  %s  ← %s" % (loc, f["pattern"], f["note"]))
            if len(warnings) > 15:
                print("  … 另有 %d 处" % (len(warnings) - 15))
        print("\n结论: %s" % ("❌ 不要直接推送，先处理上面的阻断项"
                              if blocking else "✅ 未发现需阻断的凭据（占位符项请自己扫一眼）"))

    sys.exit(1 if blocking else 0)


if __name__ == "__main__":
    main()
