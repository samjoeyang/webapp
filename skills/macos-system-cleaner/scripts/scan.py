#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
macOS 跨版本系统垃圾扫描器（只读，绝不修改任何文件）。

功能：
  - 自动探测 macOS 版本/芯片，按版本映射各类垃圾路径（重点解决不同 macOS
    版本下 Mail 版本目录、系统缓存卷语义、Rosetta 缓存等差异）。
  - 覆盖 CleanMyMac 风格的主要清理类目：用户/系统缓存、日志、废纸篓、
    不完整下载、DMG/安装包、邮件垃圾、Xcode 派生数据、iOS 备份、容器缓存、
    浏览器缓存、应用残留、Docker/Homebrew 缓存、字体缓存、Rosetta 缓存、
    大文件/旧文件等。
  - 输出结构化 manifest（JSON），含每个类目的体积、条目数与明细，供 clean.py
    做交互式选择清理。

仅做文件系统读取与体积统计，不删除、不移动、不写入任何源文件。
"""
import os
import re
import sys
import json
import time
import argparse
import datetime
import platform
import tempfile
import subprocess
import fnmatch

from rules import (load_rules, make_context, resolve, resolve_category,
                   RuleError, mail_version_pattern)

HOME = os.path.expanduser("~")

# 运行时状态（不是规则）：所有策略数据都从 rules/*.json 载入，此处只放空容器。
RULES = None
CTX = None
ALWAYS_PROTECTED = []
NAMED_DIR_GUARDS = set()
DOCKER_CANDIDATES = []
QUICK_SKIP_IDS = set()
DEV_BASES = []

# 命中即从扫描结果中剔除的前缀，由 --keep 填充（本机指定保留的目录放这里）。
KEEP_PREFIXES = []

# 持久化忽略清单（对标 CleanMyMac 的 Ignore List）：路径前缀 + fnmatch 通配。
# 由 --ignore-file 载入；命中规则与 --keep / ALWAYS_PROTECTED 一样，只影响扫描结果。
IGNORE_PREFIXES = []
IGNORE_PATTERNS = []

def _under(path, prefix):
    try:
        ap = os.path.abspath(os.path.expanduser(path))
        pk = os.path.abspath(os.path.expanduser(prefix))
    except Exception:
        return False
    return ap == pk or ap.startswith(pk + os.sep)


def load_ignore_file(path):
    """读取持久化忽略清单，返回载入的规则条数。

    支持两种 JSON 形状：
      {"paths": [...], "prefixes": [...], "patterns": [...]}
      ["/path/a", "/Users/*/Library/Caches/Foo"]
    纯路径默认按「前缀」处理；想用通配符请放进 patterns。
    """
    if not path:
        return 0
    with open(os.path.expanduser(path), "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        prefixes, patterns = data, []
    elif isinstance(data, dict):
        prefixes = list(data.get("paths") or data.get("prefixes") or [])
        patterns = list(data.get("patterns") or [])
    else:
        raise ValueError("忽略清单应为 JSON 数组或对象")
    for p in prefixes:
        s = str(p).strip()
        if s:
            IGNORE_PREFIXES.append(os.path.abspath(os.path.expanduser(s)))
    for p in patterns:
        s = str(p).strip()
        if s:
            IGNORE_PATTERNS.append(os.path.abspath(os.path.expanduser(s)))
    return len(IGNORE_PREFIXES) + len(IGNORE_PATTERNS)


def is_excluded(path):
    """是否应剔除该路径（工具链本体 / 临时保留 / 持久化忽略清单）。"""
    for k in KEEP_PREFIXES + ALWAYS_PROTECTED + IGNORE_PREFIXES:
        if _under(path, k):
            return True
    try:
        ap = os.path.abspath(os.path.expanduser(path))
    except Exception:
        return False
    for pat in IGNORE_PATTERNS:
        if fnmatch.fnmatchcase(ap, pat):
            return True
    return False


# ---------------------------------------------------------------------------
# macOS 版本探测（跨版本核心）
# ---------------------------------------------------------------------------
def detect_macos():
    """返回 macOS 环境信息字典。"""
    info = {
        "product": "Unknown",
        "version": "0",
        "family": "0",       # "10.15" / "11" / "12" ...
        "major_num": 0.0,    # 用于大小比较的浮点
        "name": "Unknown",
        "apple_silicon": False,
        "sealed_system": False,  # Catalina(10.15)+ 系统卷只读密封
        "uid": os.getuid(),
    }
    try:
        # sw_vers 每次只接受一个 -flag；直接解析无参输出（"Key:\tValue" 行）更稳。
        out = subprocess.run(
            ["sw_vers"], capture_output=True, text=True, timeout=20)
        for line in out.stdout.splitlines():
            if ":" in line:
                k, _, v = line.partition(":")
                k, v = k.strip(), v.strip()
                if k == "ProductName":
                    info["product"] = v
                elif k == "ProductVersion":
                    info["version"] = v
                elif k == "BuildVersion":
                    info["build"] = v
    except Exception:
        pass

    ver = info["version"]
    parts = [int(x) for x in ver.split(".") if x.isdigit()]
    while len(parts) < 2:
        parts.append(0)
    if parts[0] == 10:
        info["family"] = "10.%d" % parts[1]
        info["major_num"] = 10.0 + parts[1] / 100.0
    else:
        info["family"] = str(parts[0])
        info["major_num"] = float(parts[0])

    # 友好名称（规则库 defaults.macos_names）
    names = RULES["defaults"]["macos_names"] if RULES else {}
    info["name"] = names.get(info["family"], "macOS %s" % ver)

    # 芯片
    try:
        mach = platform.machine()
        if mach == "arm64":
            info["apple_silicon"] = True
        else:
            # Rosetta 转译进程
            r = subprocess.run(["sysctl", "-n", "sysctl.proc_translated"],
                               capture_output=True, text=True, timeout=10)
            info["apple_silicon"] = (r.stdout.strip() == "1")
    except Exception:
        info["apple_silicon"] = (platform.machine() == "arm64")

    info["sealed_system"] = info["major_num"] >= 10.15
    return info


# ---------------------------------------------------------------------------
# 体积统计工具
# ---------------------------------------------------------------------------
def detect_mail_version():
    """优先从 Mail/PersistenceInfo.plist 读 LastUsedVersionDirectoryName。

    CleanMyMac 5.7.4 MailboxService.framework 就是这么做的；比按 macOS 版本硬映射更可靠
    （升级/迁移后 V 目录可能不一致）。失败时退化为「已有的最大 V<n> 目录」。
    """
    plist = resolve(RULES["collectors"]["mail_persistence_plist"], CTX, RULES)
    last_key = RULES["collectors"]["mail_last_version_key"]
    if os.path.isfile(plist):
        try:
            r = subprocess.run(
                ["/usr/libexec/PlistBuddy", "-c",
                 "Print :%s" % last_key, plist],
                capture_output=True, text=True, timeout=10)
            v = r.stdout.strip()
            if mail_version_pattern().fullmatch(v):
                return v
        except (OSError, subprocess.SubprocessError):
            pass
    base = os.path.dirname(plist)
    try:
        found = [d for d in os.listdir(base) if mail_version_pattern().fullmatch(d)]
        if found:
            return sorted(found, key=lambda s: int(s[1:]))[-1]
    except OSError:
        pass
    return None


def collect_ai_tool_junk():
    """只收 AI 工具的缓存/日志/遥测，不碰配置、技能、插件本体与可执行文件。"""
    items = []
    for rel in RULES["collectors"]["ai_tool_junk_rel"]:
        p = os.path.join(HOME, rel)
        if os.path.lexists(p) and not os.path.islink(p):
            items.append({"path": p, "bytes": du(p), "note": rel})
    return items


def du(path):
    """递归计算目录/文件字节数。失败返回 0。"""
    total = 0
    try:
        if os.path.islink(path):
            return 0
        if os.path.isfile(path):
            return os.path.getsize(path)
        if not os.path.isdir(path):
            return 0
        stack = [path]
        while stack:
            d = stack.pop()
            try:
                with os.scandir(d) as it:
                    for e in it:
                        try:
                            if e.is_symlink():
                                continue
                            if e.is_file(follow_symlinks=False):
                                total += e.stat(follow_symlinks=False).st_size
                            elif e.is_dir(follow_symlinks=False):
                                stack.append(e.path)
                        except OSError:
                            continue
            except OSError:
                continue
    except OSError:
        return 0
    return total


def human_bytes(n):
    if n < 1024:
        return "%.0f B" % n
    for unit in ["KB", "MB", "GB", "TB", "PB"]:
        n /= 1024.0
        if n < 1024.0:
            return "%.1f %s" % (n, unit)
    return "%.1f PB" % (n / 1024.0)


# ---------------------------------------------------------------------------
# 收集器（每种类目如何枚举明细条目）
# ---------------------------------------------------------------------------
def collect_dir_top(roots, exclude=None):
    """把每个 root 的直接子项作为一条明细，统计各自体积。exclude: 跳过这些绝对路径。"""
    exclude = set(exclude or [])
    items = []
    for root in roots:
        if not os.path.isdir(root):
            continue
        try:
            with os.scandir(root) as it:
                for e in it:
                    try:
                        if e.path in exclude:
                            continue
                        size = du(e.path)
                        items.append({"path": e.path, "bytes": size})
                    except OSError:
                        continue
        except OSError as ex:
            items.append({"path": root, "bytes": 0, "error": str(ex)})
    return items


def collect_dir_whole(roots):
    """把每个 root 整体作为一条明细。"""
    items = []
    for root in roots:
        if not os.path.exists(root):
            continue
        items.append({"path": root, "bytes": du(root)})
    return items


def collect_globs(roots, patterns, max_depth=4):
    """在 roots 下匹配文件名 pattern（fnmatch），每条匹配文件为一条明细。"""
    items = []
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            depth = dirpath[len(root):].count(os.sep)
            if depth > max_depth:
                dirnames[:] = []
                continue
            for fn in filenames:
                if any(fnmatch.fnmatch(fn, p) for p in patterns):
                    p = os.path.join(dirpath, fn)
                    try:
                        items.append({"path": p, "bytes": os.path.getsize(p)})
                    except OSError:
                        continue
    return items


def collect_named_dirs(base_dirs, names, max_depth=2):
    """在 base_dirs 下查找指定名称的目录（如 node_modules / venv），每条为一条明细。
    命中目录不再向下深入，避免把嵌套目录重复计入。"""
    names = set(names)
    # 位于这些「环境/依赖」目录内部的同名子目录不算过程产物，一律跳过——
    # 否则会把 venv 的 bin/（含解释器入口）误当成 C++ 构建产物等，删了会破坏环境本体。
    guards = NAMED_DIR_GUARDS
    items = []
    for base in base_dirs:
        if not os.path.isdir(base):
            continue
        for dp, dns, fns in os.walk(base):
            depth = dp[len(base):].count(os.sep)
            if depth > max_depth:
                dns[:] = []
                continue
            if any(p in guards for p in dp[len(base):].split(os.sep) if p):
                dns[:] = []
                continue
            matched = [d for d in dns if d in names]
            dns[:] = [d for d in dns if d not in names]  # 不再深入已匹配的目录
            for d in matched:
                p = os.path.join(dp, d)
                if os.path.exists(p):
                    items.append({"path": p, "bytes": du(p)})
    items.sort(key=lambda x: x["bytes"], reverse=True)
    return items


# ---------------------------------------------------------------------------
# 命令式资源（Docker / Time Machine）：不是普通文件，必须靠命令回收
# ---------------------------------------------------------------------------
def parse_human_size(s):
    """'1.443GB (7%)' / '462MB*' / '0B' / '20.06GB' -> bytes"""
    if not s:
        return 0
    txt = str(s).split("(")[0].strip().rstrip("*").strip()
    m = re.match(r"^([0-9]+(?:\.[0-9]+)?)\s*([KMGTPE]?i?B)$", txt, re.I)
    if not m:
        return 0
    mult = {"B": 1, "KB": 1024, "MB": 1024 ** 2, "GB": 1024 ** 3,
            "TB": 1024 ** 4, "PB": 1024 ** 5,
            "KIB": 1024, "MIB": 1024 ** 2, "GIB": 1024 ** 3, "TIB": 1024 ** 4}
    return int(float(m.group(1)) * mult.get(m.group(2).upper(), 1))


def run_cmd(argv, timeout=25):
    """执行只读探测命令，返回 (stdout, returncode)。失败一律返回 ("", 非0)。"""
    try:
        out = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        return out.stdout, out.returncode
    except Exception:
        return "", 1


_DOCKER_PATH = None


def docker_env_path():
    """Docker Desktop 的 CLI 常在 PATH 外，补上常见位置。"""
    global _DOCKER_PATH
    if _DOCKER_PATH is None:
        cand = resolve(RULES["defaults"]["docker_cli_candidates"], CTX, RULES)
        _DOCKER_PATH = os.pathsep.join(cand + [os.environ.get("PATH", "")])
    return _DOCKER_PATH


def docker_cmd(args, timeout=25):
    env = dict(os.environ)
    env["PATH"] = docker_env_path()
    try:
        out = subprocess.run(["docker"] + args, capture_output=True, text=True,
                             timeout=timeout, env=env)
        return out.stdout, out.returncode
    except Exception:
        return "", 1


_DOCKER_READY = None


def docker_ready():
    """Docker daemon 是否可用（缓存结果，避免重复探测拖慢扫描）。"""
    global _DOCKER_READY
    if _DOCKER_READY is None:
        out, rc = docker_cmd(["version", "--format", "{{.Server.Version}}"], timeout=20)
        _DOCKER_READY = bool(rc == 0 and out.strip())
    return _DOCKER_READY


def collect_docker_build_cache():
    """Docker 构建缓存（docker system df 的 Build Cache 行）。"""
    if not docker_ready():
        return []
    out, rc = docker_cmd(["system", "df", "--format", "{{json .}}"])
    if rc != 0:
        return []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if str(row.get("Type", "")).lower() != RULES["collectors"]["docker_build_cache_type"]:
            continue
        b = parse_human_size(row.get("Reclaimable", ""))
        if b <= 0:
            return []
        return [{
            "kind": "command",
            "path": "(docker build cache)",
            "bytes": b,
            "cmd": list(RULES["collectors"]["docker_commands"]["build_cache_prune"]),
            "note": "%s 条构建缓存记录。只影响下次构建速度，不影响镜像/容器/数据卷。"
                    % row.get("TotalCount", "?"),
        }]
    return []


def collect_docker_unused_images():
    """未被任何容器（含已停止）引用的镜像，按镜像 ID 归并（多 tag 只算一次）。"""
    if not docker_ready():
        return []
    # 1) 收集被容器引用的镜像 ID
    used = set()
    out, rc = docker_cmd(["ps", "-aq"])
    cids = [x.strip() for x in out.split() if x.strip()]
    if cids:
        out2, rc2 = docker_cmd(["inspect", "--format", "{{.Image}}"] + cids[:300])
        if rc2 == 0:
            for ln in out2.splitlines():
                ln = ln.strip()
                if ln.startswith("sha256:"):
                    used.add(ln[7:19])
    # 2) 全部镜像按 ID 归并
    out3, rc3 = docker_cmd(["images", "--format", "{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}"])
    if rc3 != 0:
        return []
    groups = {}
    for ln in out3.splitlines():
        parts = ln.split("|")
        if len(parts) < 4:
            continue
        iid, repo, tag, size = (p.strip() for p in parts[:4])
        if not iid:
            continue
        g = groups.setdefault(iid, {"size": 0, "refs": []})
        g["size"] = max(g["size"], parse_human_size(size))
        if repo == "<none>" and tag == "<none>":
            g["refs"].append("<none>:<none>")
        else:
            g["refs"].append("%s:%s" % (repo, tag))
    items = []
    for iid, g in groups.items():
        if iid[:12] in used:
            continue
        label = ", ".join(sorted(set(g["refs"]))[:4])
        items.append({
            "kind": "command",
            "path": "(docker image) %s [%s]" % (label, iid[:12]),
            "bytes": g["size"],
            "cmd": [x.replace("{ID}", iid)
                    for x in RULES["collectors"]["docker_commands"]["image_rm"]],
            "note": "无容器引用。删除后如需再用须重新 pull / build。",
        })
    items.sort(key=lambda x: x["bytes"], reverse=True)
    return items


def tm_status():
    """Time Machine 开关与快照概览（全部只读）。"""
    st = {}
    out, rc = run_cmd(["defaults", "read",
                       resolve(RULES["collectors"]["tm_autobackup_plist"], CTX, RULES),
                       RULES["collectors"]["tm_autobackup_key"]])
    # 注意：0 = 关闭，1 = 开启；读不到（键不存在）说明从未配置过
    st["auto_backup"] = (out.strip() == "1") if rc == 0 else None
    out, rc = run_cmd(["tmutil", "listlocalsnapshots", "/"], timeout=20)
    prefix = RULES["collectors"]["tm_snapshot_prefix"]
    st["snapshot_count"] = len([ln for ln in out.splitlines()
                                if ln.strip().startswith(prefix)]) if rc == 0 else None
    out, rc = run_cmd(["diskutil", "apfs", "listSnapshots", "/System/Volumes/Data"], timeout=20)
    st["data_volume"] = out.strip() if rc == 0 else ""
    return st


def collect_tm_snapshots():
    """Time Machine 本地快照（只读列出；删除必须交用户执行 sudo tmutil）。"""
    out, rc = run_cmd(["tmutil", "listlocalsnapshots", "/"], timeout=20)
    items = []
    if rc == 0:
        prefix = RULES["collectors"]["tm_snapshot_prefix"]
        suffix = RULES["collectors"]["tm_snapshot_local_suffix"]
        for ln in out.splitlines():
            ln = ln.strip()
            if not ln.startswith(prefix):
                continue
            stamp = ln[len(prefix):]
            if stamp.endswith(suffix):
                stamp = stamp[:-len(suffix)]
            items.append({
                "kind": "manual",
                "path": "(tm snapshot) %s" % ln,
                "bytes": 0,
                "manual": RULES["collectors"]["tm_snapshot_delete"].replace("{STAMP}", stamp),
                "note": "APFS 快照与系统共享数据块，体积无法单独计量；读操作不需要 sudo，删除需要。",
            })
    return items


# ---------------------------------------------------------------------------
# 类目定义（跨版本路径在此解析）
# ---------------------------------------------------------------------------
# severity: safe=可放心清理；caution=清理安全但建议确认；system=系统级需 sudo
# scope: user=用户级（移入 ~/.Trash 即可）；system=系统级（需 --system --sudo）
def build_categories(mac):
    """从规则库解析类目；条件根路径按当前 macOS 环境展开。"""
    global CTX
    mail_v = (detect_mail_version()
              or RULES["defaults"]["mail_v"].get(
                  mac["family"], RULES["defaults"]["mail_v_default"]))
    local_ctx = make_context(mac, mail_v, RULES)
    CTX = local_ctx  # 其余收集器共用同一上下文
    cats = []
    for raw in RULES["categories"]["categories"]:
        cat = resolve_category(raw, local_ctx, RULES, mac)
        if cat is not None:
            cats.append(cat)
    return cats


# ---------------------------------------------------------------------------
# 自定义收集器实现
# ---------------------------------------------------------------------------
def collect_custom_mail(roots):
    items = []
    for r in roots:
        if not os.path.exists(r):
            continue
        marker = RULES["collectors"]["mail_downloads_marker"]
        if os.path.isdir(r) and marker not in r:
            # Mail 主目录：统计 Envelope Index 与 Attachments 子目录
            for sub in RULES["collectors"]["mail_subdirs"]:
                p = os.path.join(r, sub)
                if os.path.exists(p):
                    items.append({"path": p, "bytes": du(p)})
        else:
            items.append({"path": r, "bytes": du(r)})
    return items


def collect_custom_containers(roots):
    items = []
    for base in roots:
        if not os.path.isdir(base):
            continue
        # 只聚合各容器内的 Library/Caches
        cache_rel = os.path.join("Data", "Library", "Caches") if "Containers" in base else os.path.join("Library", "Caches")
        try:
            with os.scandir(base) as it:
                for e in it:
                    if not e.is_dir(follow_symlinks=False):
                        continue
                    cpath = os.path.join(e.path, cache_rel)
                    if os.path.isdir(cpath):
                        items.append({"path": cpath, "bytes": du(cpath)})
        except OSError:
            continue
    return items


def collect_custom_browser(roots):
    items = []
    home = HOME
    targets = resolve(RULES["collectors"]["browser_targets"], CTX, RULES)
    for t in targets:
        if os.path.exists(t):
            items.append({"path": t, "bytes": du(t)})
    return items


def run_collector(cat, mac):
    c = cat["collector"]
    roots = cat.get("roots", [])
    if c == "dir_top":
        return collect_dir_top(roots, cat.get("exclude"))
    if c == "dir_top_multi":
        # 多个独立 root，每个 root 直接子项作为明细
        items = []
        for r in roots:
            items.extend(collect_dir_top([r]))
        return items
    if c == "dir_whole":
        return collect_dir_whole(roots)
    if c == "globs":
        return collect_globs(roots, cat.get("patterns", []), cat.get("max_depth", 4))
    if c == "custom_mail":
        return collect_custom_mail(roots)
    if c == "custom_containers":
        return collect_custom_containers(roots)
    if c == "custom_browser":
        return collect_custom_browser(roots)
    if c == "custom_npm":
        return collect_custom_npm(roots, cat.get("dev_bases", []))
    if c == "custom_python":
        return collect_custom_python(roots, cat.get("conda_bases", []), cat.get("dev_bases", []))
    if c == "custom_named_dirs":
        return collect_custom_named_dirs(roots, cat.get("names", []), cat.get("dev_bases", []))
    if c == "custom_docker_builder":
        return collect_docker_build_cache()
    if c == "custom_docker_images":
        return collect_docker_unused_images()
    if c == "custom_tm":
        return collect_tm_snapshots()
    if c == "custom_tmp":
        return collect_tmp_files(roots, cat.get("min_age_days", 7))
    if c == "custom_docker_containers":
        return collect_docker_stopped_containers()
    if c == "custom_external_trashes":
        return collect_external_trashes()
    if c == "custom_app_support_caches":
        return collect_app_support_caches()
    if c == "custom_ai_tool_junk":
        return collect_ai_tool_junk()
    return []


def collect_custom_npm(cache_roots, dev_bases):
    """npm/yarn/pnpm 缓存 + 常用开发目录下的 node_modules。"""
    items = []
    for r in cache_roots:
        if os.path.exists(r):
            items.append({"path": r, "bytes": du(r)})
    items.extend(collect_named_dirs(dev_bases, set(RULES["collectors"]["npm_named_dirs"]), max_depth=2))
    items.sort(key=lambda x: x["bytes"], reverse=True)
    return items[:RULES["collectors"]["named_dirs_max_items"]]


def collect_custom_python(cache_roots, conda_bases, dev_bases):
    """pip 缓存 + conda/pyenv/virtualenvwrapper 虚拟环境 + 开发目录下的 venv。"""
    items = []
    for r in cache_roots:
        if os.path.exists(r):
            items.append({"path": r, "bytes": du(r)})
    # conda 环境目录 <base>/envs/<name>
    for cb in conda_bases:
        env_dir = os.path.join(cb, "envs")
        if os.path.isdir(env_dir):
            try:
                with os.scandir(env_dir) as it:
                    for e in it:
                        if e.is_dir(follow_symlinks=False):
                            items.append({"path": e.path, "bytes": du(e.path)})
            except OSError:
                pass
    # pyenv-virtualenv: ~/.pyenv/versions/<ver>/envs/<name>
    pyenv_versions = resolve(RULES["collectors"]["pyenv_versions_dir"], CTX, RULES)
    if os.path.isdir(pyenv_versions):
        try:
            with os.scandir(pyenv_versions) as it:
                for ver in it:
                    if not ver.is_dir(follow_symlinks=False):
                        continue
                    envs_dir = os.path.join(ver.path, "envs")
                    if os.path.isdir(envs_dir):
                        with os.scandir(envs_dir) as e2:
                            for e in e2:
                                if e.is_dir(follow_symlinks=False):
                                    items.append({"path": e.path, "bytes": du(e.path)})
        except OSError:
            pass
    # 通用 venv 目录名
    items.extend(collect_named_dirs(
        dev_bases, set(RULES["collectors"]["python_named_dirs"]), max_depth=2))
    items.sort(key=lambda x: x["bytes"], reverse=True)
    return items[:RULES["collectors"]["named_dirs_max_items"]]


def collect_custom_named_dirs(cache_roots, names, dev_bases):
    """缓存目录整体 + 开发目录下指定名称的目录（target/build/vendor 等过程产物）。

    Rust target/、C++ build/、PHP vendor/ 等共用：缓存部分整目录一条，
    过程产物在 dev_bases（深度 ≤2）内按目录名查找，命中即止（不深入已命中目录）。
    """
    items = []
    for r in cache_roots:
        if os.path.exists(r):
            items.append({"path": r, "bytes": du(r)})
    items.extend(collect_named_dirs(dev_bases, set(names), max_depth=2))
    items.sort(key=lambda x: x["bytes"], reverse=True)
    return items[:RULES["collectors"]["named_dirs_max_items"]]


# ---------------------------------------------------------------------------
# 大文件 / 旧文件（独立扫描，受阈值控制）
# ---------------------------------------------------------------------------
def collect_tmp_files(roots, min_age_days=7):
    """临时目录：只收「最后修改时间超过 N 天」的顶层项。

    近期改动的项一律跳过 —— 那是正在运行的进程可能在用的文件，
    误删会导致程序异常。这是临时目录清理唯一可靠的安全边界。
    """
    cutoff = time.time() - min_age_days * 86400
    items = []
    for root in roots:
        if not os.path.isdir(root):
            continue
        try:
            with os.scandir(root) as it:
                for e in it:
                    try:
                        st = e.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    if st.st_mtime > cutoff:
                        continue
                    items.append({
                        "path": e.path,
                        "bytes": du(e.path),
                        "note": "最后修改 %s" % datetime.datetime.fromtimestamp(
                            st.st_mtime).strftime("%Y-%m-%d"),
                    })
        except OSError:
            continue
    return items


def collect_docker_stopped_containers():
    """已停止（exited）容器：命令式回收 docker container prune -f。

    只删容器记录，不动运行中容器、镜像与数据卷。
    """
    out, rc = docker_cmd(["ps", "-aq", "-f", "status=exited"], timeout=20)
    if rc != 0:
        return []
    ids = [x for x in out.splitlines() if x.strip()]
    if not ids:
        return []

    # 可回收体积取 docker system df 的 Containers 行 RECLAIMABLE 列，避免逐容器求和失真
    size_txt = "0B"
    out2, rc2 = docker_cmd(["system", "df"], timeout=25)
    if rc2 == 0:
        for line in out2.splitlines():
            parts = line.split()
            if parts and parts[0] == "Containers" and len(parts) >= 5:
                size_txt = parts[4]
                break
    return [{
        "kind": "command",
        "path": "(已停止容器 %d 个)" % len(ids),
        "bytes": parse_human_size(size_txt),
        "cmd": list(RULES["collectors"]["docker_commands"]["container_prune"]),
        "note": "docker container prune -f：只删已停止容器，不动运行中容器与数据卷",
    }]


def collect_external_trashes():
    """外接卷废纸篓：/Volumes/*/.Trashes/<uid>。

    外接盘上删除的文件进了该盘的 .Trashes，清空不会动系统盘。
    """
    items = []
    uid = str(os.getuid())
    vols = resolve(RULES["collectors"]["volumes_root"], CTX, RULES)
    if not os.path.isdir(vols):
        return items
    try:
        names = os.listdir(vols)
    except OSError:
        return items
    for v in names:
        base = os.path.join(vols, v, RULES["collectors"]["external_trash_dirname"])
        if not os.path.isdir(base):
            continue
        own = os.path.join(base, uid)
        target = own if os.path.exists(own) else base
        sz = du(target)
        note = "外接卷 %s" % v
        if sz == 0:
            note += "（体积未能读取，通常需 sudo 才能统计）"
        items.append({"path": target, "bytes": sz, "note": note})
    return items


def collect_app_support_caches():
    """~/Library/Application Support/*/Caches —— 不走标准 ~/Library/Caches 的 App 缓存。

    只认精确名为 Cache / Caches 的子目录，避免把用户配置当成缓存。
    """
    base = os.path.join(HOME, "Library", "Application Support")
    items = []
    if not os.path.isdir(base):
        return items
    try:
        with os.scandir(base) as it:
            for e in it:
                try:
                    if not e.is_dir(follow_symlinks=False):
                        continue
                except OSError:
                    continue
                for nm in RULES["collectors"]["app_support_cache_names"]:
                    p = os.path.join(e.path, nm)
                    if os.path.isdir(p) and not os.path.islink(p):
                        items.append({"path": p, "bytes": du(p), "note": e.name})
    except OSError:
        pass
    return items


def collect_large_old(mac, min_gb, old_days):
    import time
    min_bytes = min_gb * 1024 ** 3
    cutoff = time.time() - old_days * 86400
    rule = RULES["defaults"]["large_old_files"]
    scan_dirs = resolve(rule["roots"], CTX, RULES)
    skip_sub = set(resolve(rule["skip_sub"], CTX, RULES))
    hits = []
    for base in scan_dirs:
        if not os.path.isdir(base):
            continue
        for dp, dns, fns in os.walk(base):
            dns[:] = [d for d in dns if d not in skip_sub and not d.startswith(".")]
            if dp != base and os.path.basename(dp) in skip_sub:
                dns[:] = []
                continue
            for fn in fns:
                p = os.path.join(dp, fn)
                try:
                    st = os.lstat(p)
                    if st.st_size >= min_bytes and st.st_mtime < cutoff:
                        hits.append({"path": p, "bytes": st.st_size})
                except OSError:
                    continue
    hits.sort(key=lambda x: x["bytes"], reverse=True)
    return hits[:RULES["defaults"]["large_old_files"]["max_items"]]


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def main():
    global RULES, CTX, ALWAYS_PROTECTED, NAMED_DIR_GUARDS
    global DOCKER_CANDIDATES, QUICK_SKIP_IDS, DEV_BASES
    ap = argparse.ArgumentParser(description="macOS 跨版本系统垃圾扫描器（只读）")
    ap.add_argument("--out", default=os.path.join(os.getcwd(), "macos_clean_manifest.json"),
                    help="manifest 输出路径（默认当前目录 macos_clean_manifest.json）")
    ap.add_argument("--categories", help="仅扫描指定类目 id（逗号分隔），默认全部")
    ap.add_argument("--rules-dir",
                    help="规则库目录（默认 <skill>/rules；自定义目录可无 manifest）")
    ap.add_argument("--min-size", type=float, default=None,
                    help="类目内单条明细低于此 MB 的忽略（默认见 rules/defaults.json）")
    ap.add_argument("--large-gb", type=float, default=None,
                    help="大文件阈值 GB（默认见 rules/defaults.json）")
    ap.add_argument("--old-days", type=int, default=None,
                    help="旧文件阈值天数（默认见 rules/defaults.json）")
    ap.add_argument("--no-large", action="store_true", help="跳过「大文件/旧文件」扫描")
    ap.add_argument("--tmp-days", type=int, default=None,
                    help="临时文件只清超过此天数未修改的（默认见 rules/defaults.json）")
    ap.add_argument("--include-system", action="store_true",
                    help="包含系统级类目（扫描只读，清理需 sudo）")
    ap.add_argument("--no-docker", action="store_true",
                    help="跳过 Docker 命令式探测（Docker 未运行时更快）")
    ap.add_argument("--keep", action="append", default=[],
                    help="指定保留的目录前缀（可多次给），命中即从结果剔除")
    ap.add_argument("--ignore-file",
                    help="持久化忽略清单 JSON（paths/prefixes/patterns），对标 CleanMyMac Ignore List")
    ap.add_argument("--quick", action="store_true",
                    help="Smart Care 式快速巡检：跳过环境依赖/模拟器/大文件全盘遍历等重型类目")
    args = ap.parse_args()

    try:
        RULES = load_rules(args.rules_dir)
    except RuleError as ex:
        sys.stderr.write("❌ 规则库载入失败: %s\n" % ex)
        raise SystemExit(2)

    defaults = RULES["defaults"]["cli_defaults"]
    for arg, key in (("min_size", "min_size"), ("large_gb", "large_gb"),
                     ("old_days", "old_days"), ("tmp_days", "tmp_days")):
        if getattr(args, arg) is None:
            setattr(args, arg, defaults[key])

    boot_ctx = make_context(None, None, RULES)
    ALWAYS_PROTECTED = resolve(RULES["defaults"]["always_protected"], boot_ctx, RULES)
    NAMED_DIR_GUARDS = set(RULES["defaults"]["named_dir_guards"])
    DOCKER_CANDIDATES = resolve(RULES["defaults"]["docker_cli_candidates"], boot_ctx, RULES)
    QUICK_SKIP_IDS = set(RULES["defaults"]["quick_skip_ids"])
    DEV_BASES = resolve("@DEV_BASES", boot_ctx, RULES)

    KEEP_PREFIXES.extend(args.keep)
    try:
        ignored = load_ignore_file(args.ignore_file)
    except Exception as ex:
        sys.stderr.write("❌ 忽略清单读取失败: %s\n" % ex)
        raise SystemExit(2)

    mac = detect_macos()
    CTX = make_context(mac, None, RULES)
    cats = build_categories(mac)
    # 临时文件类目的时间阈值统一由 --tmp-days 决定
    for c in cats:
        if c["collector"] == "custom_tmp":
            c["min_age_days"] = args.tmp_days
    if args.no_docker:
        cats = [c for c in cats if not c["collector"].startswith("custom_docker")]
    if args.quick:
        cats = [c for c in cats if c["id"] not in QUICK_SKIP_IDS]

    only = set(c.strip() for c in args.categories.split(",")) if args.categories else None
    min_bytes = args.min_size * 1024 ** 2

    manifest = {
        "tool": "macos-system-cleaner",
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "macos": mac,
        "time_machine": tm_status(),
        "categories": [],
        "grand_total_bytes": 0,
    }

    for cat in cats:
        if only and cat["id"] not in only:
            continue
        if cat["scope"] == "system" and not args.include_system:
            continue
        items = run_collector(cat, mac)
        items = [it for it in items if is_excluded(it.get("path", "")) is False]
        # 命令式资源（kind != file）体积可能为 0（如快照），不做体积极小值过滤
        items = [it for it in items
                 if it.get("kind", "file") != "file" or it.get("bytes", 0) >= min_bytes]
        items.sort(key=lambda x: x["bytes"], reverse=True)
        total = sum(it["bytes"] for it in items)
        manifest["categories"].append({
            "id": cat["id"], "name": cat["name"], "severity": cat["severity"],
            "scope": cat["scope"], "desc": cat["desc"],
            "per_item_confirm": cat.get("per_item_confirm", False),
            "total_bytes": total, "item_count": len(items), "items": items,
        })
        manifest["grand_total_bytes"] += total

    # 大文件/旧文件（遵守 --categories 过滤；类目定义来自 rules/defaults.json）
    rlo = RULES["defaults"]["large_old_files"]
    if not args.no_large and not args.quick and (only is None or rlo["id"] in only):
        hits = collect_large_old(mac, args.large_gb, args.old_days)
        hits = [h for h in hits if h["bytes"] >= min_bytes]
        total = sum(h["bytes"] for h in hits)
        manifest["categories"].append({
            "id": rlo["id"],
            "name": rlo["name_template"] % (args.large_gb, args.old_days),
            "severity": rlo["severity"], "scope": rlo["scope"],
            "desc": rlo["desc"], "per_item_confirm": rlo["per_item_confirm"],
            "total_bytes": total, "item_count": len(hits), "items": hits,
        })
        manifest["grand_total_bytes"] += total

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # 控制台摘要
    print("macOS: %s (%s, %s)%s" % (
        mac["name"], mac["version"], mac["family"],
        ", Apple Silicon" if mac["apple_silicon"] else ""))
    print("密封系统卷(只读): %s%s" % (
        "是" if mac["sealed_system"] else "否",
        "  | 快速巡检模式" if args.quick else "",
    ))
    print("规则库: %s (%d 个类目定义)" % (
        RULES["_dir"], len(RULES["categories"]["categories"])))
    if args.ignore_file:
        print("持久化忽略规则: %d 条" % ignored)
    print("-" * 60)
    for c in manifest["categories"]:
        flag = "  [系统]" if c["scope"] == "system" else ""
        print("%-34s %12s  %5d 项%s" % (
            c["name"][:34], human_bytes(c["total_bytes"]), c["item_count"], flag))
    print("-" * 60)
    print("可清理总计: %s  (manifest -> %s)" % (human_bytes(manifest["grand_total_bytes"]), args.out))


if __name__ == "__main__":
    main()
