#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
macOS 系统垃圾清理器（读取 scan.py 产出的 manifest，交互式选择后清理）。

核心安全原则（务必遵守）：
  - 默认只做预览（--dry-run），必须显式 --apply 才执行。
  - 默认移入「废纸篓/回收站」（可恢复），而非永久删除；仅当显式 --purge 才永久删除。
  - 用户级（scope=user）直接移入 ~/.Trash；系统级（scope=system）需 --system --sudo，
    移入 /.Trashes/<uid>（系统废纸篓，Finder 中可恢复），永久删除需再叠加 --purge。
  - 每次操作写入清理日志（JSON + 文本），供审计/恢复。
  - 绝不触碰 manifest 之外的任何文件——只处理扫描阶段登记过的路径。

两种用法：
  1) 智能体/脚本驱动（推荐）：先 scan，再 clean --categories a,b,c --apply
  2) 终端交互：clean --manifest <file> --interactive
"""
import os
import sys
import json
import argparse
import datetime
import subprocess
import shutil

HOME = os.path.expanduser("~")
UID = os.getuid()


def human_bytes(n):
    if n < 1024:
        return "%.0f B" % n
    for unit in ["KB", "MB", "GB", "TB", "PB"]:
        n /= 1024.0
        if n < 1024.0:
            return "%.1f %s" % (n, unit)
    return "%.1f PB" % (n / 1024.0)


def load_manifest(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_approved(spec):
    """读取用户已确认的路径清单。

    spec 可以是**文件路径**（推荐，见 SKILL.md 示例），也可以是**内联 JSON**：
      - `--approved approved.json`
      - `--approved '["/path/a","/path/b"]'`
      - `--approved '{"approved":["/path/a"]}'`
    解析失败时直接退出（exit 2），而不是静默返回空清单 —— 空清单会让所有
    逐项确认类目被判「未确认」而全部跳过，用户只会看到「没有获得确认的待删条目」，很难排查。
    """
    raw = (spec or "").strip()
    if not raw:
        return set()

    data = None
    if raw[0] in "[{":
        try:
            data = json.loads(raw)
        except Exception as ex:
            sys.stderr.write("❌ --approved 内联 JSON 解析失败: %s\n" % ex)
            raise SystemExit(2)
    else:
        try:
            with open(os.path.expanduser(raw), "r", encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            sys.stderr.write(
                "❌ --approved 清单文件不存在: %s\n"
                "   （也可以直接传内联 JSON，例如 --approved '[\"/path/a\"]'）\n" % raw)
            raise SystemExit(2)
        except Exception as ex:
            sys.stderr.write("❌ 无法读取 --approved 清单 %s: %s\n" % (raw, ex))
            raise SystemExit(2)

    if isinstance(data, list):
        paths = data
    elif isinstance(data, dict):
        paths = data.get("approved") or data.get("paths") or []
    else:
        sys.stderr.write("❌ --approved 格式不支持：应为路径数组或 {\"approved\":[...]}\n")
        raise SystemExit(2)

    out = set()
    for x in paths:
        s = str(x).strip()
        if not s:
            continue
        out.add(os.path.normpath(os.path.expanduser(s)))
    return out


def select_categories_interactive(manifest):
    """终端交互选择。返回选中类目 id 列表。"""
    cats = manifest["categories"]
    print("\n可清理类目（来自扫描结果）：")
    print("%-4s %-36s %12s  %5s  %s" % ("#", "类目", "体积", "条目", "级别"))
    for i, c in enumerate(cats, 1):
        lvl = "系统" if c["scope"] == "system" else ("谨慎" if c["severity"] == "caution" else "安全")
        print("%-4d %-36s %12s  %5d  %s" % (i, c["name"][:36], human_bytes(c["total_bytes"]), c["item_count"], lvl))
    raw = input("\n输入要清理的编号（逗号分隔，或 all / none）：").strip()
    if raw.lower() == "none" or raw == "":
        return []
    if raw.lower() == "all":
        return [c["id"] for c in cats]
    sel = []
    for tok in raw.split(","):
        tok = tok.strip()
        if tok.isdigit() and 1 <= int(tok) <= len(cats):
            sel.append(cats[int(tok) - 1]["id"])
    return sel


def trash_target(scope, sudo):
    """根据范围与权限返回回收站目录。"""
    if scope == "system":
        return os.path.join(os.sep, ".Trashes", str(UID))
    return os.path.join(HOME, ".Trash")


def ensure_dir(path, sudo):
    if os.path.isdir(path):
        return True
    if sudo:
        r = subprocess.run(["sudo", "mkdir", "-p", path], capture_output=True, text=True)
        if r.returncode != 0:
            sys.stderr.write("创建回收站目录失败: %s\n%s\n" % (path, r.stderr))
            return False
        subprocess.run(["sudo", "chmod", "700", path], capture_output=True, text=True)
        return True
    try:
        os.makedirs(path, exist_ok=True)
        os.chmod(path, 0o700)
        return True
    except OSError as e:
        sys.stderr.write("创建回收站目录失败: %s (%s)\n" % (path, e))
        return False


def unique_target(trash_dir, name, sudo):
    target = os.path.join(trash_dir, name)
    if not (sudo and os.path.exists(target)) and (not sudo and not os.path.exists(target)):
        return target
    base, ext = os.path.splitext(name)
    i = 1
    while True:
        cand = os.path.join(trash_dir, "%s_%d%s" % (base, i, ext))
        if not os.path.exists(cand):
            return cand
        i += 1


def move_to_trash(path, trash_dir, sudo, purge):
    """移入回收站；purge=True 时永久删除。返回 (ok, detail)。"""
    if purge:
        if sudo:
            r = subprocess.run(["sudo", "rm", "-rf", path], capture_output=True, text=True)
            return (r.returncode == 0, r.stderr.strip() or "deleted")
        try:
            if os.path.isdir(path) and not os.path.islink(path):
                shutil.rmtree(path)
            else:
                os.remove(path)
            return (True, "deleted")
        except OSError as e:
            return (False, str(e))

    # 移入回收站
    name = os.path.basename(path.rstrip(os.sep))
    target = unique_target(trash_dir, name, sudo)
    if sudo:
        r = subprocess.run(["sudo", "mv", "-f", path, target], capture_output=True, text=True)
        return (r.returncode == 0, (r.stderr.strip() or target) if r.returncode != 0 else target)
    try:
        shutil.move(path, target)
        return (True, target)
    except OSError as e:
        return (False, str(e))


def execute_command(item):
    """执行 manifest 中登记的 Docker 命令（kind=command）。返回 (ok, detail)。

    只有 scan.py 显式写入 cmd 的条目才会走到这里，且必须已通过逐项确认闸门。
    """
    cmd = item.get("cmd")
    if not cmd:
        return (False, "条目缺少 cmd 字段")
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join([os.path.join(HOME, ".docker", "bin"), "/usr/local/bin",
                                   "/opt/homebrew/bin", env.get("PATH", "")])
    try:
        r = subprocess.run(["docker"] + list(cmd), capture_output=True, text=True,
                           timeout=600, env=env)
    except Exception as e:
        return (False, str(e))
    out = ((r.stdout or "") + (r.stderr or "")).strip()
    last = out.splitlines()[-1] if out else "ok"
    return (r.returncode == 0, last[:200])


def _same_path(p, approved_set):
    """判断 manifest 里的路径是否在用户确认清单中。

    先按规范化后的字面路径比对；再按 realpath 比对一次，兼容 macOS 上
    /var → /private/var 这类符号链接差异（用户可能把 realpath 写进清单）。
    """
    cand = {os.path.normpath(os.path.expanduser(str(p)))}
    try:
        cand.add(os.path.realpath(str(p)))
    except OSError:
        pass
    if cand & approved_set:
        return True
    for a in approved_set:
        try:
            if os.path.realpath(a) in cand:
                return True
        except OSError:
            continue
    return False


def decide_deletions(selected, approved_set, confirm_each, interactive):
    """决定实际要删除的 (category, item) 列表，并返回被跳过的 (category, item, 原因)。

    逐目录确认规则（per_item_confirm 或 --confirm-each 触发的类目）：
      - 若提供了 --approved 清单且路径在其中 → 删除；
      - 若提供了 --approved 但路径不在其中 → 跳过（记日志）；
      - 交互模式 → 逐条 y/N 询问；
      - 非交互且无 --approved → 拒绝删除（记日志），杜绝静默误删。
    其余类目（user_cache 等）保持原行为：选中即全部删除。
    """
    planned, skipped = [], []
    for c in selected:
        need = c.get("per_item_confirm", False) or confirm_each
        for it in c["items"]:
            p = it["path"]
            if not need:
                planned.append((c, it))
                continue
            if approved_set:
                if _same_path(p, approved_set):
                    planned.append((c, it))
                else:
                    skipped.append((c, it, "未在 --approved 确认清单中"))
                continue
            if interactive:
                desc = p
                if it.get("kind") == "command":
                    desc = "%s  →  docker %s" % (p, " ".join(it.get("cmd", [])))
                elif it.get("kind") == "manual":
                    desc = "%s  →  需你自行执行: %s" % (p, it.get("manual", ""))
                ans = input("  处理 %s (%s)? [y/N/s(跳过)/q(退出)] "
                            % (desc, human_bytes(it.get("bytes", 0)))).strip().lower()
                if ans == "q":
                    print("已退出。")
                    raise SystemExit(0)
                if ans == "s":
                    skipped.append((c, it, "用户跳过"))
                elif ans == "y":
                    planned.append((c, it))
                else:
                    skipped.append((c, it, "用户跳过"))
                continue
            # 非交互且无确认清单：拒绝删除
            skipped.append((c, it, "需逐目录确认（未提供 --approved 且非交互模式）"))
    return planned, skipped


def main():
    ap = argparse.ArgumentParser(description="macOS 系统垃圾清理器（基于 manifest）")
    ap.add_argument("--manifest", default=os.path.join(os.getcwd(), "macos_clean_manifest.json"),
                    help="scan.py 产出的 manifest 路径")
    ap.add_argument("--categories", help="要清理的类目 id（逗号分隔）；不指定则需 --interactive")
    ap.add_argument("--interactive", action="store_true", help="终端交互选择类目")
    ap.add_argument("--apply", action="store_true", help="真正执行清理（默认仅预览）")
    ap.add_argument("--system", action="store_true", help="允许处理系统级类目（需 --sudo 才生效）")
    ap.add_argument("--sudo", action="store_true", help="对系统级目录使用 sudo（移动/删除）")
    ap.add_argument("--purge", action="store_true", help="永久删除而非移入回收站（危险，需谨慎）")
    ap.add_argument("--approved", default=None,
                    help="逐目录确认清单：JSON 文件路径，或直接内联 JSON（如 '[\"/path/a\"]' / '{\"approved\":[...]}'）。"
                         "仅清单内的路径会被删除。")
    ap.add_argument("--confirm-each", action="store_true",
                    help="终端模式下逐条询问每个目录是否删除（对所有选中类目生效）。")
    ap.add_argument("--log", default=None,
                    help="清理日志输出路径（默认写在 manifest 同目录的 cleanup_log.json）")
    args = ap.parse_args()
    if args.log is None:
        args.log = os.path.join(os.path.dirname(os.path.abspath(args.manifest)), "cleanup_log.json")

    manifest = load_manifest(args.manifest)
    cats_by_id = {c["id"]: c for c in manifest["categories"]}

    # 选择类目
    if args.interactive:
        sel = select_categories_interactive(manifest)
    elif args.categories:
        sel = [s.strip() for s in args.categories.split(",") if s.strip() in cats_by_id]
    else:
        sys.stderr.write("错误：需指定 --categories <id,...> 或 --interactive\n")
        sys.exit(2)

    if not sel:
        print("未选择任何类目，退出。")
        sys.exit(0)

    # 系统级校验
    selected = [cats_by_id[i] for i in sel]
    has_system = any(c["scope"] == "system" for c in selected)
    if has_system and not (args.system and args.sudo):
        sys.stderr.write("⚠️ 所选类目含系统级（scope=system），需同时加 --system --sudo 才会处理；"
                         "本次将跳过系统级类目。\n")
        selected = [c for c in selected if c["scope"] != "system"]

    # 预览计划
    print("\n清理计划预览：")
    total_items = 0
    total_bytes = 0
    has_per_item = False
    for c in selected:
        tag = " [逐目录确认]" if c.get("per_item_confirm", False) else ""
        print("  • %-32s %12s  %5d 项 [%s]%s" % (
            c["name"][:32], human_bytes(c["total_bytes"]), c["item_count"], c["severity"], tag))
        total_items += c["item_count"]
        total_bytes += c["total_bytes"]
        if c.get("per_item_confirm", False):
            has_per_item = True
    print("  " + "-" * 58)
    print("  合计：%s，%d 项" % (human_bytes(total_bytes), total_items))
    has_cmd_item = any(it.get("kind") in ("command", "manual")
                       for c in selected for it in c["items"])
    if args.purge:
        mode = "永久删除(--purge)"
    elif has_cmd_item:
        mode = "文件类移入回收站(可恢复) + 命令式条目永久执行"
    else:
        mode = "移入回收站(可恢复)"
    print("  模式：%s" % mode)

    # 命令式 / 需人工执行的条目：把真正会运行的命令原样打出来（不可恢复，必须让用户看见）
    specials = [(it, c) for c in selected for it in c["items"]
                if it.get("kind") in ("command", "manual")]
    if specials:
        print("\n  命令式条目（不经回收站，不可恢复）：")
        for it, c in specials[:40]:
            if it.get("kind") == "command":
                print("    • [%s] %s\n        docker %s"
                      % (c["id"], it["path"], " ".join(it.get("cmd", []))))
            else:
                print("    • [%s] %s\n        需你自行执行: %s"
                      % (c["id"], it["path"], it.get("manual", "")))
        if len(specials) > 40:
            print("    … 另有 %d 项" % (len(specials) - 40))

    # 逐目录确认类目提示
    if has_per_item and not args.approved and not args.confirm_each:
        ids = [c["id"] for c in selected if c.get("per_item_confirm", False)]
        print("\n⚠️ 含需逐项确认的类目（%s）：本次未提供 --approved 且未开启 --confirm-each，"
              "这些类目将被跳过（不删除任何东西）。" % ", ".join(ids))

    if not args.apply:
        if args.interactive:
            yn = input("\n确认执行清理? (y/N): ").strip().lower()
            if yn != "y":
                print("已取消。")
                sys.exit(0)
            args.apply = True
        else:
            print("\n（仅预览，未做任何修改。加 --apply 执行；逐目录确认类目需 --approved 或 --confirm-each。）")
            sys.exit(0)

    # 决定实际待删条目（处理逐目录确认）
    approved_set = load_approved(args.approved) if args.approved else set()
    planned, skipped = decide_deletions(selected, approved_set, args.confirm_each, args.interactive)

    if not planned:
        print("\n没有获得确认的待删条目，未做任何修改。")
        if skipped:
            print("（被跳过的目录数：%d，原因见日志）" % len(skipped))
        log = {"tool": "macos-system-cleaner",
               "cleaned_at": datetime.datetime.now().isoformat(timespec="seconds"),
               "mode": "purge" if args.purge else "trash", "actions": []}
        for c, it, reason in skipped:
            log["actions"].append({"category": c["id"], "path": it["path"],
                                   "bytes": it.get("bytes", 0), "result": "skipped", "detail": reason})
        try:
            with open(args.log, "w", encoding="utf-8") as f:
                json.dump(log, f, ensure_ascii=False, indent=2)
        except OSError:
            pass
        print("日志 -> %s" % args.log)
        sys.exit(0)

    # 执行
    log = {"tool": "macos-system-cleaner", "cleaned_at": datetime.datetime.now().isoformat(timespec="seconds"),
           "mode": "purge" if args.purge else "trash", "actions": []}
    ok, fail = 0, 0
    manual_items = []
    for c, it in planned:
        p = it["path"]
        kind = it.get("kind", "file")

        # 需用户自己在终端执行的条目：永不代跑（写操作需 sudo + 完全磁盘访问权限）
        if kind == "manual":
            manual_items.append((c, it))
            log["actions"].append({
                "category": c["id"], "path": p, "bytes": it.get("bytes", 0),
                "result": "manual", "detail": it.get("manual", ""),
            })
            continue

        # 命令式资源（Docker）：执行登记的命令，不走回收站
        if kind == "command":
            res, detail = execute_command(it)
            log["actions"].append({
                "category": c["id"], "path": p, "bytes": it.get("bytes", 0),
                "result": "ok" if res else "fail", "detail": detail,
                "cmd": "docker " + " ".join(it.get("cmd", [])),
            })
            if res:
                ok += 1
            else:
                fail += 1
                sys.stderr.write("  ✗ 失败 %s: %s\n" % (p, detail))
            continue

        trash_dir = trash_target(c["scope"], args.sudo)
        if not ensure_dir(trash_dir, args.sudo and c["scope"] == "system"):
            skipped.append((c, it, "回收站目录不可用"))
            continue
        if not os.path.exists(p):
            log["actions"].append({
                "category": c["id"], "path": p, "bytes": it.get("bytes", 0),
                "result": "skipped",
                "detail": "路径不存在（可能已被其他类目先行移走或已删除）",
            })
            continue
        res, detail = move_to_trash(p, trash_dir, args.sudo and c["scope"] == "system", args.purge)
        log["actions"].append({
            "category": c["id"], "path": p, "bytes": it.get("bytes", 0),
            "result": "ok" if res else "fail", "detail": detail,
        })
        if res:
            ok += 1
        else:
            fail += 1
            sys.stderr.write("  ✗ 失败 %s: %s\n" % (p, detail))

    # 记录被跳过的条目
    for c, it, reason in skipped:
        log["actions"].append({"category": c["id"], "path": it["path"], "bytes": it.get("bytes", 0),
                               "result": "skipped", "detail": reason})

    with open(args.log, "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, indent=2)

    print("\n完成：成功 %d 项，失败 %d 项；跳过（需确认/未确认）%d 项；需你手动执行 %d 项。"
          % (ok, fail, len(skipped), len(manual_items)))
    if manual_items:
        print("\n以下条目只能由你在自己的终端执行（写操作需 sudo，且调用方须持有「完全磁盘访问权限」；"
              "只给 Terminal.app 授权对 iTerm2/VS Code 无效）：")
        for c, it in manual_items:
            print("  • %s\n      %s" % (it["path"], it.get("manual", "")))
    kinds = set(it.get("kind", "file") for c, it in planned)
    if "command" in kinds:
        print("注意：Docker 命令式清理为永久操作，不经回收站，无法从废纸篓恢复。")
    if "file" in kinds:
        print("文件类条目已移入回收站，可恢复；彻底释放需清空回收站。")
    print("日志 -> %s" % args.log)


if __name__ == "__main__":
    main()
