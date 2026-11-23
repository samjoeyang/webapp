#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
删除本地项目目录前的风险核查（只读，绝不删除任何东西）。

要回答的唯一问题：**删了之后，哪些东西是真正无法恢复的？**
工程目录通常混着三类东西，用户说「删掉」时往往只想到第一类：

  1. 可从远程恢复的代码（git 仓库 + 有 remote + 工作区干净）
  2. 只在本地、删了就真没了的数据（未跟踪文件、无 remote 的 .git、非 git 目录）
  3. 可重建但昂贵的产物（node_modules / venv / 构建产物）

用法：
  python3 project_audit.py <目录> [<目录> ...] [--json] [--out FILE]
退出码：0 = 低风险；1 = 存在中/高风险（需人工确认后再删）。
"""
import os
import sys
import json
import argparse
import subprocess

# 这些目录名如果「未被 git 跟踪」，几乎一定是「删了就没了」的东西
KEY_DIRS = [".env", "data", "models", "deps", "host-native", "logs", "backups",
            "docs", "scripts", "config", "migrations", ".backup"]


def sh(argv, cwd=None, timeout=90):
    try:
        r = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.stdout, r.returncode
    except Exception:
        return "", 1


def du_bytes(path):
    """递归统计实际占用（按块大小，比 st_size 更接近 du）。软链接不跟随、计 0。"""
    if os.path.islink(path):
        return 0
    total = 0
    for dp, dns, fns in os.walk(path, onerror=lambda e: None):
        for fn in fns + dns:
            p = os.path.join(dp, fn)
            try:
                st = os.lstat(p)
                if not os.path.islink(p):
                    total += getattr(st, "st_blocks", 0) * 512 or st.st_size
            except OSError:
                continue
    return total


def human(n):
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if n < 1024:
            return "%.1f %s" % (n, unit) if unit != "B" else "%d B" % n
        n /= 1024.0
    return "%.1f PB" % n


def find_symlinks(path, max_depth=2):
    links = []
    base_depth = path.rstrip(os.sep).count(os.sep)
    for dp, dns, fns in os.walk(path, followlinks=False, onerror=lambda e: None):
        if dp.count(os.sep) - base_depth >= max_depth:
            dns[:] = []
        for name in dns + fns:
            p = os.path.join(dp, name)
            if os.path.islink(p):
                try:
                    tgt = os.path.realpath(p)
                except OSError:
                    tgt = "?"
                links.append({"path": os.path.relpath(p, path), "target": tgt,
                              "outside": not tgt.startswith(os.path.realpath(path) + os.sep)})
    return links


def find_nested_repos(path, max_depth=3):
    repos = []
    base_depth = path.rstrip(os.sep).count(os.sep)
    for dp, dns, fns in os.walk(path, onerror=lambda e: None):
        depth = dp.count(os.sep) - base_depth
        if depth >= max_depth:
            dns[:] = []
        if ".git" in dns and dp != path:
            repos.append(os.path.relpath(dp, path))
        dns[:] = [d for d in dns if d != ".git"]
    return repos


def audit(path):
    p = os.path.abspath(os.path.expanduser(path))
    info = {"path": p, "exists": os.path.isdir(p), "risk": "unknown", "reasons": [],
            "is_git": False, "remote": None, "head": None, "branch": None,
            "dirty_count": None, "untracked_count": None, "tracked_count": None,
            "key_dirs_untracked": [], "untracked_top": [], "untracked_bytes": 0,
            "symlinks": [], "nested_repos": [], "size_bytes": 0}
    if not info["exists"]:
        info["risk"] = "n/a"
        info["reasons"].append("目录不存在")
        return info

    info["size_bytes"] = du_bytes(p)

    out, rc = sh(["git", "rev-parse", "--is-inside-work-tree"], p)
    info["is_git"] = (rc == 0 and out.strip() == "true")

    if info["is_git"]:
        out, _ = sh(["git", "rev-parse", "--show-toplevel"], p)
        info["git_root"] = out.strip()
        out, _ = sh(["git", "remote", "-v"], p)
        info["remote"] = out.strip() or None
        out, _ = sh(["git", "rev-parse", "HEAD"], p)
        info["head"] = out.strip() or None
        out, _ = sh(["git", "branch", "--show-current"], p)
        info["branch"] = out.strip() or "(detached)"
        out, _ = sh(["git", "status", "--porcelain"], p)
        lines = [x for x in out.splitlines() if x.strip()]
        untracked = [x[3:] for x in lines if x.startswith("?? ")]
        info["untracked_count"] = len(untracked)
        info["dirty_count"] = len(lines) - len(untracked)
        info["untracked_top"] = untracked[:12]
        total_untracked = 0
        for rel in untracked:
            fp = os.path.join(p, rel.rstrip("/"))
            if os.path.islink(fp):
                continue          # 软链接只删链接本身，不计入体积（否则会顺着链走到底）
            try:
                total_untracked += du_bytes(fp) if os.path.isdir(fp) else os.path.getsize(fp)
            except OSError:
                pass
        info["untracked_bytes"] = total_untracked
        out, _ = sh(["git", "ls-files"], p)
        info["tracked_count"] = len([x for x in out.splitlines() if x.strip()])
        # 关键目录里「未被跟踪」的部分 = 删了真没了的
        for d in KEY_DIRS:
            fp = os.path.join(p, d)
            if not os.path.exists(fp):
                continue
            out, _ = sh(["git", "ls-files", "--", d], p)
            n = len([x for x in out.splitlines() if x.strip()])
            if n == 0:
                try:
                    sz = du_bytes(fp) if os.path.isdir(fp) else os.path.getsize(fp)
                except OSError:
                    sz = 0
                info["key_dirs_untracked"].append({"name": d, "bytes": sz})
    else:
        info["reasons"].append("不是 git 仓库 —— 全局唯一副本，删了彻底没有")

    info["symlinks"] = find_symlinks(p)
    info["nested_repos"] = find_nested_repos(p)

    # 风险判定（先看能否从远程恢复，再看本地独有部分）
    if not info["is_git"]:
        info["risk"] = "high"
    elif not info["remote"]:
        info["risk"] = "high"
        info["reasons"].append("git 仓库但没有 remote —— .git 里那份是全局唯一副本")
    elif info["dirty_count"]:
        info["risk"] = "medium"
        info["reasons"].append("有 %d 处未提交改动，删了会丢失" % info["dirty_count"])
    else:
        info["risk"] = "low"

    if info["key_dirs_untracked"]:
        info["risk"] = "high" if info["risk"] != "high" else "high"
        names = ", ".join("%s(%s)" % (d["name"], human(d["bytes"]))
                          for d in info["key_dirs_untracked"][:6])
        info["reasons"].append("关键目录未被 git 跟踪（删了无法从远程恢复）: %s" % names)
    if info["nested_repos"]:
        info["reasons"].append("含 %d 个嵌套 git 仓库: %s"
                               % (len(info["nested_repos"]), ", ".join(info["nested_repos"][:5])))
    outside = [l for l in info["symlinks"] if l["outside"]]
    if outside:
        info["reasons"].append("有 %d 个指向目录外的软链接（如共享 node_modules），"
                              "删除前应先 rm -f 解链，避免误伤共享依赖" % len(outside))
    return info


def main():
    ap = argparse.ArgumentParser(description="删除本地项目目录前的风险核查（只读）")
    ap.add_argument("paths", nargs="+", help="要核查的项目目录")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out", help="JSON 输出到文件")
    args = ap.parse_args()

    reports = [audit(p) for p in args.paths]

    if args.json or args.out:
        payload = json.dumps(reports, ensure_ascii=False, indent=2)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(payload)
        if args.json:
            print(payload)
    else:
        label = {"high": "🔴 高风险", "medium": "🟡 中风险", "low": "🟢 低风险",
                 "n/a": "⚪ 不存在", "unknown": "⚪ 未知"}
        for r in reports:
            print("=" * 66)
            print("%s  %s" % (label.get(r["risk"], r["risk"]), r["path"]))
            print("  体积: %s" % human(r["size_bytes"]))
            if not r["exists"]:
                continue
            if r["is_git"]:
                print("  git : 分支 %s | HEAD %s" % (r["branch"], (r["head"] or "")[:12]))
                print("  远程: %s" % ("有" if r["remote"] else "❌ 无 remote"))
                print("  工作区: 未提交 %s 处 | 未跟踪 %s 项（约 %s）| 已跟踪 %s 个文件"
                      % (r["dirty_count"], r["untracked_count"],
                         human(r["untracked_bytes"]), r["tracked_count"]))
            else:
                print("  git : ❌ 不是 git 仓库")
            if r["key_dirs_untracked"]:
                print("  ⚠️ 未被跟踪的关键目录（删了就没有第二份）:")
                for d in r["key_dirs_untracked"]:
                    print("       %-14s %s" % (d["name"], human(d["bytes"])))
            if r["untracked_top"]:
                print("  未跟踪样例: %s%s"
                      % (", ".join(r["untracked_top"][:6]),
                         " …" if len(r["untracked_top"]) > 6 else ""))
            if r["nested_repos"]:
                print("  嵌套仓库: %s" % ", ".join(r["nested_repos"][:6]))
            outside = [l for l in r["symlinks"] if l["outside"]]
            if r["symlinks"]:
                print("  软链接: %d 个（其中 %d 个指向目录外）" % (len(r["symlinks"]), len(outside)))
                for l in r["symlinks"][:5]:
                    print("       %-22s -> %s%s" % (l["path"], l["target"],
                                                    "  ⚠️外部" if l["outside"] else ""))
            if r["reasons"]:
                print("  判断依据:")
                for x in r["reasons"]:
                    print("       • %s" % x)

        print("=" * 66)
        risky = [r for r in reports if r["risk"] in ("high", "medium")]
        if risky:
            print("结论：%d/%d 个目录含不可恢复内容或未提交改动。"
                  % (len(risky), len(reports)))
            print("删前必须：① 把「未被跟踪的关键目录」列给用户确认；② 让用户选择删除方式"
                  "（废纸篓可恢复 vs 彻底删除）；③ 落一份清单存档（路径 / git HEAD / 文件列表）；")
            print("④ 先 rm -f 解除指向目录外的软链接；⑤ 记下 df -h，删后解释空间差额"
                  "（Time Machine 快照 / Docker 镜像孤儿 / lsof +L1）。")
        else:
            print("结论：全部为低风险（git + 有 remote + 工作区干净），"
                  "代码可从远程恢复；删除仍建议走清单存档流程。")

    sys.exit(1 if any(r["risk"] in ("high", "medium") for r in reports) else 0)


if __name__ == "__main__":
    main()
