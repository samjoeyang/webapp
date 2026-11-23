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

HOME = os.path.expanduser("~")

# 命中即从扫描结果中剔除的前缀，由 --keep 填充（本机指定保留的目录放这里）。
KEEP_PREFIXES = []

# 永远剔除：这些是工具链本体（解释器/托管运行时），删了会直接坏掉，不属于「可清理垃圾」。
ALWAYS_PROTECTED = [
    os.path.join(HOME, ".workbuddy", "binaries", "python"),   # WorkBuddy 托管解释器与环境
    os.path.join(HOME, ".local", "share", "uv", "python"),    # uv 的 cpython 解释器安装
    os.path.join(HOME, ".rustup", "toolchains"),              # Rust 工具链本体（只清 downloads/tmp）
    os.path.join(HOME, ".gradle", "wrapper"),                 # Gradle wrapper 下载的发行版
]


def _under(path, prefix):
    try:
        ap = os.path.abspath(os.path.expanduser(path))
        pk = os.path.abspath(os.path.expanduser(prefix))
    except Exception:
        return False
    return ap == pk or ap.startswith(pk + os.sep)


def is_excluded(path):
    """是否应剔除该路径（用户指定保留 or 工具链本体）。"""
    for k in KEEP_PREFIXES + ALWAYS_PROTECTED:
        if _under(path, k):
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

    # 友好名称
    NAMES = {
        "10.13": "High Sierra", "10.14": "Mojave", "10.15": "Catalina",
        "11": "Big Sur", "12": "Monterey", "13": "Ventura",
        "14": "Sonoma", "15": "Sequoia",
    }
    info["name"] = NAMES.get(info["family"], "macOS %s" % ver)

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


# macOS 版本 -> Mail 数据目录版本号（~/Library/Mail/Vx）
MAIL_V = {
    "10.7": "V2", "10.8": "V2", "10.9": "V2",
    "10.10": "V3", "10.11": "V4", "10.12": "V5",
    "10.13": "V6", "10.14": "V7", "10.15": "V8",
    "11": "V9", "12": "V10", "13": "V10", "14": "V10", "15": "V10",
}


# ---------------------------------------------------------------------------
# 体积统计工具
# ---------------------------------------------------------------------------
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
    items = []
    for base in base_dirs:
        if not os.path.isdir(base):
            continue
        for dp, dns, fns in os.walk(base):
            depth = dp[len(base):].count(os.sep)
            if depth > max_depth:
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
        cand = [os.path.join(HOME, ".docker", "bin"), "/usr/local/bin", "/opt/homebrew/bin"]
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
        if str(row.get("Type", "")).lower() != "build cache":
            continue
        b = parse_human_size(row.get("Reclaimable", ""))
        if b <= 0:
            return []
        return [{
            "kind": "command",
            "path": "(docker build cache)",
            "bytes": b,
            "cmd": ["builder", "prune", "-af"],
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
            "cmd": ["image", "rm", iid],
            "note": "无容器引用。删除后如需再用须重新 pull / build。",
        })
    items.sort(key=lambda x: x["bytes"], reverse=True)
    return items


def tm_status():
    """Time Machine 开关与快照概览（全部只读）。"""
    st = {}
    out, rc = run_cmd(["defaults", "read",
                       "/Library/Preferences/com.apple.TimeMachine.plist", "AutoBackup"])
    # 注意：0 = 关闭，1 = 开启；读不到（键不存在）说明从未配置过
    st["auto_backup"] = (out.strip() == "1") if rc == 0 else None
    out, rc = run_cmd(["tmutil", "listlocalsnapshots", "/"], timeout=20)
    st["snapshot_count"] = len([ln for ln in out.splitlines()
                                if ln.strip().startswith("com.apple.TimeMachine.")]) if rc == 0 else None
    out, rc = run_cmd(["diskutil", "apfs", "listSnapshots", "/System/Volumes/Data"], timeout=20)
    st["data_volume"] = out.strip() if rc == 0 else ""
    return st


def collect_tm_snapshots():
    """Time Machine 本地快照（只读列出；删除必须交用户执行 sudo tmutil）。"""
    out, rc = run_cmd(["tmutil", "listlocalsnapshots", "/"], timeout=20)
    items = []
    if rc == 0:
        for ln in out.splitlines():
            ln = ln.strip()
            if not ln.startswith("com.apple.TimeMachine."):
                continue
            stamp = ln[len("com.apple.TimeMachine."):]
            if stamp.endswith(".local"):
                stamp = stamp[:-len(".local")]
            items.append({
                "kind": "manual",
                "path": "(tm snapshot) %s" % ln,
                "bytes": 0,
                "manual": "sudo tmutil deletelocalsnapshots %s" % stamp,
                "note": "APFS 快照与系统共享数据块，体积无法单独计量；读操作不需要 sudo，删除需要。",
            })
    return items


# ---------------------------------------------------------------------------
# 类目定义（跨版本路径在此解析）
# ---------------------------------------------------------------------------
# severity: safe=可放心清理；caution=清理安全但建议确认；system=系统级需 sudo
# scope: user=用户级（移入 ~/.Trash 即可）；system=系统级（需 --system --sudo）
def build_categories(mac):
    fam = mac["family"]
    sealed = mac["sealed_system"]
    asil = mac["apple_silicon"]

    mail_v = MAIL_V.get(fam, "V10")
    mail_dir = os.path.join(HOME, "Library", "Mail", mail_v)

    cats = []

    # user_cache 是 ~/Library/Caches 的「兜底」收集器；专用类目（Homebrew/浏览器/QuickLook/字体）
    # 会独占其下的特定子目录，避免同一份字节被重复计入多个类目、且清理时父目录先移走导致子项被静默跳过。
    cache_home = os.path.join(HOME, "Library", "Caches")
    user_cache_exclude = {
        os.path.join(cache_home, "Homebrew"),                          # -> homebrew_cache
        os.path.join(cache_home, "com.apple.Safari"),                  # -> browser_cache
        os.path.join(cache_home, "Firefox"),                           # -> browser_cache
        os.path.join(cache_home, "Google"),                            # -> browser_cache (Chrome)
        os.path.join(cache_home, "Microsoft"),                         # -> browser_cache (Edge)
        os.path.join(cache_home, "com.apple.QuickLook.thumbnails"),    # -> quicklook_cache
        os.path.join(cache_home, "com.apple.fonts"),                   # -> font_cache
    }

    # 1. 用户缓存
    cats.append({
        "id": "user_cache", "name": "用户缓存", "severity": "safe", "scope": "user",
        "desc": "~/Library/Caches 下各 App 的缓存（不含已归属专用类目者），可安全清理（下次打开 App 会重建）。",
        "collector": "dir_top",
        "roots": [cache_home],
        "exclude": list(user_cache_exclude),
    })

    # 2. 系统缓存（注意：Catalina+ 系统卷密封只读，/System/Library/Caches 不可动）
    sys_roots = [os.path.join(os.sep, "Library", "Caches")]
    if sealed:
        sys_roots.append(os.path.join(os.sep, "System", "Volumes", "Data", "Library", "Caches"))
    cats.append({
        "id": "system_cache", "name": "系统缓存（需 sudo）", "severity": "system", "scope": "system",
        "desc": "/Library/Caches 下的系统级缓存。Catalina 及以上系统卷只读，/System/Library/Caches 不在清理范围。",
        "collector": "dir_top",
        "roots": sys_roots,
    })

    # 3. 用户日志
    cats.append({
        "id": "user_logs", "name": "用户日志", "severity": "safe", "scope": "user",
        "desc": "~/Library/Logs 下的崩溃/运行日志，可清理。",
        "collector": "dir_top",
        "roots": [os.path.join(HOME, "Library", "Logs")],
    })

    # 4. 系统日志
    cats.append({
        "id": "system_logs", "name": "系统日志（需 sudo）", "severity": "system", "scope": "system",
        "desc": "/Library/Logs 与 /var/log 下的系统日志。",
        "collector": "dir_top",
        "roots": [os.path.join(os.sep, "Library", "Logs"),
                  os.path.join(os.sep, "var", "log")],
    })

    # 5. 废纸篓
    cats.append({
        "id": "trash", "name": "废纸篓", "severity": "safe", "scope": "user",
        "desc": "~/.Trash 中尚未清空的已删除文件。",
        "collector": "dir_whole",
        "roots": [os.path.join(HOME, ".Trash")],
    })

    # 6. 不完整下载（下载中断残留）
    cats.append({
        "id": "broken_downloads", "name": "不完整下载", "severity": "safe", "scope": "user",
        "desc": "~/Downloads 下 *.download / *.part / *.crdownload / *.partial 等下载残留。",
        "collector": "globs", "max_depth": 2,
        "patterns": ["*.download", "*.part", "*.crdownload", "*.partial", "*.tmp", "*.opdownload"],
        "roots": [os.path.join(HOME, "Downloads")],
    })

    # 7. 安装镜像 / 安装包（大体积）
    cats.append({
        "id": "dmg_installers", "name": "安装镜像/安装包", "severity": "safe", "scope": "user",
        "desc": "~/Downloads 下体积较大的 .dmg/.iso/.pkg/.app(安装器) 等，可归档或删除。",
        "collector": "globs", "max_depth": 2,
        "patterns": ["*.dmg", "*.iso", "*.pkg", "*.dmgpart", "Install macOS*.app"],
        "roots": [os.path.join(HOME, "Downloads")],
    })

    # 8. 邮件垃圾（版本相关：Vx 目录）
    cats.append({
        "id": "mail_junk", "name": "邮件垃圾（版本相关）", "severity": "caution", "scope": "user",
        "desc": "Mail 的附件缓存、Envelope Index 与 Mail Downloads（当前版本 %s）。" % mail_v,
        "collector": "custom_mail",
        "roots": [mail_dir, os.path.join(HOME, "Library", "Mail Downloads")],
    })

    # 9. Xcode / 开发者垃圾
    dev = os.path.join(HOME, "Library", "Developer")
    xcode_roots = [
        os.path.join(dev, "Xcode", "DerivedData"),
        os.path.join(dev, "Xcode", "Archives"),
        os.path.join(dev, "Xcode", "iOS DeviceSupport"),
        os.path.join(dev, "Xcode", "Products"),
        os.path.join(HOME, "Library", "Developer", "CoreSimulator", "Caches"),
        os.path.join(HOME, "Library", "Developer", "CoreSimulator", "Devices"),
    ]
    cats.append({
        "id": "xcode_junk", "name": "Xcode/开发者垃圾", "severity": "caution", "scope": "user",
        "desc": "DerivedData、Archives、iOS DeviceSupport、模拟器缓存（重装/清理 Xcode 前可清）。",
        "collector": "dir_top_multi",
        "roots": xcode_roots,
    })

    # 10. iOS 备份
    cats.append({
        "id": "ios_backups", "name": "iOS 备份", "severity": "caution", "scope": "user",
        "desc": "~/Library/Application Support/MobileSync/Backup 下的旧设备备份（删除将丢失该备份）。",
        "collector": "dir_top",
        "roots": [os.path.join(HOME, "Library", "Application Support", "MobileSync", "Backup")],
    })

    # 11. 容器缓存（App Store / 沙盒 App）
    cats.append({
        "id": "containers_cache", "name": "容器缓存", "severity": "safe", "scope": "user",
        "desc": "~/Library/Containers 与 Group Containers 下各 App 的 Caches。",
        "collector": "custom_containers",
        "roots": [os.path.join(HOME, "Library", "Containers"),
                  os.path.join(HOME, "Library", "Group Containers")],
    })

    # 12. 浏览器缓存
    cats.append({
        "id": "browser_cache", "name": "浏览器缓存", "severity": "safe", "scope": "user",
        "desc": "Safari / Chrome / Firefox / Edge 的缓存与历史缓存。",
        "collector": "custom_browser",
        "roots": [],
    })

    # 13. 应用状态保存
    cats.append({
        "id": "saved_state", "name": "应用残留状态", "severity": "safe", "scope": "user",
        "desc": "~/Library/Saved Application State（App 上次退出时的窗口状态）。",
        "collector": "dir_top",
        "roots": [os.path.join(HOME, "Library", "Saved Application State")],
    })

    # 14. Quick Look 缩略图缓存
    cats.append({
        "id": "quicklook_cache", "name": "Quick Look 缓存", "severity": "safe", "scope": "user",
        "desc": "QuickLook 缩略图生成缓存。",
        "collector": "dir_top",
        "roots": [os.path.join(HOME, "Library", "Caches", "com.apple.QuickLook.thumbnails")],
    })

    # 15. Docker 垃圾
    docker_roots = [
        os.path.join(HOME, "Library", "Containers", "com.docker.docker", "Data", "vms"),
        os.path.join(HOME, ".docker"),
    ]
    if sealed is False:
        docker_roots.append(os.path.join(os.sep, "Library", "Containers", "com.docker.docker"))
    cats.append({
        "id": "docker_junk", "name": "Docker 垃圾", "severity": "caution", "scope": "user",
        "desc": "Docker 虚拟机磁盘镜像（Docker.raw 稀疏文件）与 CLI 缓存（清理前确认无运行中容器）。"
                "⚠️ 该体积与「Docker 构建缓存」「Docker 未使用镜像」重叠（后者就装在这个 raw 文件里），"
                "不要相加；正确顺序是先用后两个类目回收内部资源，raw 才会随之收缩。",
        "collector": "dir_top_multi",
        "roots": docker_roots,
    })

    # 16. Homebrew 缓存
    hb_roots = [os.path.join(HOME, "Library", "Caches", "Homebrew")]
    if asil:
        hb_roots.append(os.path.join(os.sep, "opt", "homebrew", "var", "cache", "homebrew"))
    else:
        hb_roots.append(os.path.join(os.sep, "usr", "local", "var", "cache", "homebrew"))
    cats.append({
        "id": "homebrew_cache", "name": "Homebrew 缓存", "severity": "safe", "scope": "user",
        "desc": "Homebrew 下载的源码包/ bottled 缓存。",
        "collector": "dir_top",
        "roots": hb_roots,
    })

    # 17. 字体缓存
    font_roots = [os.path.join(HOME, "Library", "Caches", "com.apple.fonts")]
    if sealed is False:
        font_roots.append(os.path.join(os.sep, "Library", "Caches", "com.apple.fonts"))
    cats.append({
        "id": "font_cache", "name": "字体缓存", "severity": "safe", "scope": "user",
        "desc": "系统/用户字体注册缓存（重建后自动生成）。",
        "collector": "dir_top",
        "roots": font_roots,
    })

    # 18. Rosetta 2 缓存（仅 Apple Silicon, macOS 11+）
    if asil and mac["major_num"] >= 11:
        cats.append({
            "id": "rosetta_cache", "name": "Rosetta 2 缓存（需 sudo）", "severity": "system", "scope": "system",
            "desc": "Apple Silicon 上运行 Intel 应用的转译缓存 /Library/Apple/usr/libexec/oah。",
            "collector": "dir_whole",
            "roots": [os.path.join(os.sep, "Library", "Apple", "usr", "libexec", "oah"),
                      os.path.join(os.sep, "var", "db", "oah")],
        })

    # 19. npm 环境垃圾（缓存 + 可重建的 node_modules，逐目录确认）
    # 注意 ~/.npm 的大头常是 _npx（npx 临时下载的完整包，MCP server 常驻几十 MB），
    # 而 `npm cache clean --force` 只清 _cacache、清不掉 _npx —— 必须整目录。
    npm_cache_roots = [
        os.path.join(HOME, ".npm"),
        os.path.join(HOME, ".cache", "yarn"),
        os.path.join(HOME, ".cache", "pnpm"),
        os.path.join(HOME, ".pnpm-store"),
        os.path.join(HOME, ".node-gyp"),          # 编译头文件，删后重装原生模块会重新下载
    ]
    npm_dev_bases = [os.path.join(HOME, d) for d in
                     ["Projects", "projects", "code", "dev", "Developer",
                      "work", "workspace", "Documents", "Desktop", "Downloads"]]
    cats.append({
        "id": "npm_junk", "name": "npm 环境垃圾", "severity": "caution", "scope": "user",
        "desc": "npm/yarn/pnpm 缓存（~/.npm 含 _npx/_cacache/_prebuilds/_logs、~/.node-gyp）"
                "与常用开发目录下可重建的 node_modules。"
                "不包含 ~/Library/pnpm/global（全局包）与 ~/.yarn/lib（本体程序）。删除前需逐目录单独确认。",
        "per_item_confirm": True,
        "collector": "custom_npm",
        "roots": npm_cache_roots,
        "dev_bases": npm_dev_bases,
    })

    # 20. Python 环境垃圾（缓存 + 虚拟环境，逐目录确认）
    conda_bases = [os.path.join(HOME, "miniconda3"), os.path.join(HOME, "anaconda3"),
                   os.path.join(HOME, "opt", "miniconda3"), os.path.join(HOME, "opt", "anaconda3")]
    python_cache_roots = [
        os.path.join(HOME, ".cache", "pip"),
        os.path.join(HOME, "Library", "Caches", "pip"),
        os.path.join(HOME, ".cache", "uv"),       # 下载缓存，下次 uv 调用会重建
        os.path.join(HOME, ".virtualenvs"),
    ]
    for cb in conda_bases:
        python_cache_roots.append(os.path.join(cb, "pkgs"))
    python_dev_bases = [os.path.join(HOME, d) for d in
                        ["Projects", "projects", "code", "dev", "Developer",
                         "work", "workspace", "Documents", "Desktop", "Downloads"]]
    cats.append({
        "id": "python_junk", "name": "Python 环境垃圾", "severity": "caution", "scope": "user",
        "desc": "pip/uv 缓存、virtualenvwrapper/pyenv/conda 虚拟环境与包缓存。"
                "删除虚拟环境将丢失其中安装的包（可重建）。"
                "不含托管解释器（~/.workbuddy/binaries/python、~/.local/share/uv/python）。删除前需逐目录单独确认。",
        "per_item_confirm": True,
        "collector": "custom_python",
        "roots": python_cache_roots,
        "conda_bases": conda_bases,
        "dev_bases": python_dev_bases,
    })

    # 21. Docker 构建缓存（命令式：docker builder prune）
    cats.append({
        "id": "docker_build_cache", "name": "Docker 构建缓存", "severity": "caution", "scope": "user",
        "desc": "Docker 的 BuildKit 构建缓存（docker system df 的 Build Cache）。"
                "回收只影响下次构建速度，不动镜像/容器/数据卷。需逐项确认。",
        "per_item_confirm": True,
        "collector": "custom_docker_builder",
        "roots": [],
    })

    # 22. Docker 未被使用的镜像（命令式：docker image rm）
    cats.append({
        "id": "docker_unused_images", "name": "Docker 未使用镜像", "severity": "caution", "scope": "user",
        "desc": "没有任何容器（含已停止）引用的镜像，按镜像 ID 归并。删除后如需再用须重新 pull/build。需逐项确认。",
        "per_item_confirm": True,
        "collector": "custom_docker_images",
        "roots": [],
    })

    # 23. Time Machine 本地快照（manual：写操作需 sudo + 完全磁盘访问权限，只能交用户执行）
    cats.append({
        "id": "tm_local_snapshots", "name": "Time Machine 本地快照", "severity": "caution", "scope": "user",
        "desc": "APFS 本地快照（tmutil listlocalsnapshots）。只在自动备份开启期间生成，"
                "系统需要空间时会自动回收。删除命令需 sudo 且调用方须持有完全磁盘访问权限 —— 只能由用户在自己终端执行。",
        "per_item_confirm": True,
        "collector": "custom_tm",
        "roots": [],
    })

    # ------------------------------------------------------------------
    # 临时文件（按权限拆两类：用户 $TMPDIR 与系统 /private/tmp）
    # 只收「超过 min_age_days 天未修改」的顶层项 —— 近期改动的一律跳过。
    # ------------------------------------------------------------------
    cats.append({
        "id": "tmp_user", "name": "临时文件（用户）", "severity": "safe", "scope": "user",
        "desc": "用户临时目录（$TMPDIR）下超过 7 天未修改的文件/目录。"
                "近期改动的自动跳过，避免删掉正在运行进程正在用的文件。",
        "collector": "custom_tmp", "min_age_days": 7,
        "roots": [tempfile.gettempdir()],
    })

    cats.append({
        "id": "tmp_system", "name": "临时文件（系统，需 sudo）", "severity": "system", "scope": "system",
        "desc": "/private/tmp 下超过 7 天未修改的顶层项。近期改动的自动跳过。清理需 sudo。",
        "collector": "custom_tmp", "min_age_days": 7,
        "roots": [os.path.join(os.sep, "private", "tmp")],
    })

    # 系统诊断数据（遥测/崩溃/能耗），系统会自动重建
    cats.append({
        "id": "system_diagnostics", "name": "系统诊断数据（需 sudo）", "severity": "system", "scope": "system",
        "desc": "/private/var/db 下的 diagnostics、PowerLog、DiagnosticPipeline（崩溃与能耗遥测数据）。"
                "系统会按需自动重建，删除后不影响功能。",
        "collector": "dir_whole",
        "roots": [os.path.join(os.sep, "private", "var", "db", "diagnostics"),
                  os.path.join(os.sep, "private", "var", "db", "PowerLog"),
                  os.path.join(os.sep, "private", "var", "db", "DiagnosticPipeline")],
    })

    # 休眠镜像：大小≈内存容量，系统会重建
    cats.append({
        "id": "sleepimage", "name": "休眠镜像（需 sudo）", "severity": "caution", "scope": "system",
        "desc": "/private/var/vm/sleepimage，大小约等于物理内存。删除后系统会在下次休眠时重建。"
                "FileVault 开启时它承担安全休眠，删前请确认可接受休眠行为变化。",
        "collector": "dir_whole",
        "roots": [os.path.join(os.sep, "private", "var", "vm", "sleepimage")],
    })

    # Rust：只清 registry/git 与 rustup 的 downloads/tmp，绝不碰 toolchains
    cats.append({
        "id": "rust_cache", "name": "Rust 缓存", "severity": "safe", "scope": "user",
        "desc": "~/.cargo/registry、~/.cargo/git 与 ~/.rustup 的 downloads/tmp。"
                "不含 ~/.rustup/toolchains（工具链本体，删了要重装 rustup）。",
        "collector": "dir_whole",
        "roots": [os.path.join(HOME, ".cargo", "registry"),
                  os.path.join(HOME, ".cargo", "git"),
                  os.path.join(HOME, ".rustup", "downloads"),
                  os.path.join(HOME, ".rustup", "tmp")],
    })

    # AI 模型权重：单个模型动辄数 GB，重新下载成本高 → 逐项确认
    cats.append({
        "id": "ai_model_cache", "name": "AI 模型缓存", "severity": "caution", "scope": "user",
        "desc": "HuggingFace / PyTorch / Ollama / LM Studio 下载的模型权重。"
                "删除后需重新下载（动辄数 GB ~ 数十 GB）。需逐项确认。",
        "per_item_confirm": True,
        "collector": "dir_whole",
        "roots": [os.path.join(HOME, ".cache", "huggingface"),
                  os.path.join(HOME, ".cache", "torch"),
                  os.path.join(HOME, ".ollama", "models"),
                  os.path.join(HOME, ".cache", "lm-studio"),
                  os.path.join(HOME, ".lmstudio", "models")],
    })

    # 通用 XDG 缓存（排除已归属专用类目的子目录）
    cats.append({
        "id": "xdg_cache", "name": "通用 XDG 缓存", "severity": "safe", "scope": "user",
        "desc": "~/.cache 下各 CLI 工具的缓存（pip/uv/huggingface/torch/yarn/pnpm 等"
                "已归属专用类目者除外）。",
        "collector": "dir_top",
        "roots": [os.path.join(HOME, ".cache")],
        "exclude": [os.path.join(HOME, ".cache", x) for x in
                    ("pip", "uv", "huggingface", "torch", "yarn", "pnpm", "lm-studio")],
    })

    # Ruby：只清 cache/specs，不含已安装 gem 本体
    cats.append({
        "id": "ruby_gem_cache", "name": "Ruby gem 缓存", "severity": "safe", "scope": "user",
        "desc": "~/.gem 的 cache/specs 与 ~/.bundle/cache。不含已安装的 gem 本体。",
        "collector": "dir_whole",
        "roots": [os.path.join(HOME, ".gem", "cache"),
                  os.path.join(HOME, ".gem", "specs"),
                  os.path.join(HOME, ".bundle", "cache")],
    })

    # 其他语言/包管理器缓存（存在才出现）
    cats.append({
        "id": "misc_pkg_cache", "name": "其他包管理器缓存", "severity": "safe", "scope": "user",
        "desc": "Maven ~/.m2/repository、Gradle ~/.gradle/caches、NuGet、Composer、SwiftPM、Ivy 的下载缓存。",
        "collector": "dir_whole",
        "roots": [os.path.join(HOME, ".m2", "repository"),
                  os.path.join(HOME, ".gradle", "caches"),
                  os.path.join(HOME, ".nuget", "packages"),
                  os.path.join(HOME, ".composer", "cache"),
                  os.path.join(HOME, ".ivy2", "cache"),
                  os.path.join(HOME, "Library", "Caches", "org.swift.swiftpm")],
    })

    # Docker 已停止容器（命令式）
    cats.append({
        "id": "docker_stopped_containers", "name": "Docker 已停止容器", "severity": "safe", "scope": "user",
        "desc": "已退出（exited）的容器记录，执行 docker container prune -f 回收。"
                "不动运行中容器、镜像与数据卷。需逐项确认。",
        "per_item_confirm": True,
        "collector": "custom_docker_containers", "roots": [],
    })

    # 外接卷废纸篓
    cats.append({
        "id": "external_trashes", "name": "外接卷废纸篓（需 sudo）", "severity": "caution", "scope": "system",
        "desc": "/Volumes/*/.Trashes 下各外接磁盘的废纸篓项。清空后该盘上的这些文件不可恢复。",
        "collector": "custom_external_trashes", "roots": [],
    })

    # iOS 模拟器设备镜像
    cats.append({
        "id": "simulator_devices", "name": "iOS 模拟器", "severity": "caution", "scope": "user",
        "desc": "~/Library/Developer/CoreSimulator/Devices 下各模拟器设备镜像。"
                "删除后需在 Xcode 里重新下载运行时。需逐项确认。",
        "per_item_confirm": True,
        "collector": "dir_top",
        "roots": [os.path.join(HOME, "Library", "Developer", "CoreSimulator", "Devices")],
    })

    # Application Support 下的 Cache/Caches（非标准路径）
    cats.append({
        "id": "app_support_caches", "name": "应用支持目录缓存", "severity": "safe", "scope": "user",
        "desc": "~/Library/Application Support/*/Caches —— 部分 App 不走标准 ~/Library/Caches。",
        "collector": "custom_app_support_caches", "roots": [],
    })

    return cats


# ---------------------------------------------------------------------------
# 自定义收集器实现
# ---------------------------------------------------------------------------
def collect_custom_mail(roots):
    items = []
    for r in roots:
        if not os.path.exists(r):
            continue
        if os.path.isdir(r) and "Mail Downloads" not in r:
            # Mail 主目录：统计 Envelope Index 与 Attachments 子目录
            for sub in ["Envelope Index", "Envelope Index-shm", "Envelope Index-wal", "Attachments"]:
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
    targets = [
        # Safari
        os.path.join(home, "Library", "Caches", "com.apple.Safari"),
        os.path.join(home, "Library", "Safari", "Webpage Previews"),
        os.path.join(home, "Library", "Safari", "History.db"),
        # Chrome
        os.path.join(home, "Library", "Caches", "Google", "Chrome"),
        os.path.join(home, "Library", "Application Support", "Google", "Chrome", "Default", "Cache"),
        # Firefox
        os.path.join(home, "Library", "Caches", "Firefox"),
        # Edge
        os.path.join(home, "Library", "Caches", "Microsoft", "Edge"),
        os.path.join(home, "Library", "Application Support", "Microsoft", "Edge", "Default", "Cache"),
    ]
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
    return []


def collect_custom_npm(cache_roots, dev_bases):
    """npm/yarn/pnpm 缓存 + 常用开发目录下的 node_modules。"""
    items = []
    for r in cache_roots:
        if os.path.exists(r):
            items.append({"path": r, "bytes": du(r)})
    items.extend(collect_named_dirs(dev_bases, {"node_modules"}, max_depth=2))
    items.sort(key=lambda x: x["bytes"], reverse=True)
    return items[:400]


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
    pyenv_versions = os.path.join(HOME, ".pyenv", "versions")
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
        dev_bases, {".venv", "venv", "env", "virtualenv"}, max_depth=2))
    items.sort(key=lambda x: x["bytes"], reverse=True)
    return items[:400]


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
        "cmd": ["container", "prune", "-f"],
        "note": "docker container prune -f：只删已停止容器，不动运行中容器与数据卷",
    }]


def collect_external_trashes():
    """外接卷废纸篓：/Volumes/*/.Trashes/<uid>。

    外接盘上删除的文件进了该盘的 .Trashes，清空不会动系统盘。
    """
    items = []
    uid = str(os.getuid())
    vols = os.path.join(os.sep, "Volumes")
    if not os.path.isdir(vols):
        return items
    try:
        names = os.listdir(vols)
    except OSError:
        return items
    for v in names:
        base = os.path.join(vols, v, ".Trashes")
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
                for nm in ("Caches", "Cache"):
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
    scan_dirs = [
        os.path.join(HOME, "Downloads"),
        os.path.join(HOME, "Desktop"),
        os.path.join(HOME, "Documents"),
        os.path.join(HOME, "Movies"),
        os.path.join(HOME, "Music"),
        os.path.join(HOME, "Pictures"),
        HOME,
    ]
    skip_sub = {".git", "node_modules", "Caches", "Containers", "Application Support",
                "Mail", "Library", ".Trash", "DerivedData"}
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
    return hits[:500]


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="macOS 跨版本系统垃圾扫描器（只读）")
    ap.add_argument("--out", default=os.path.join(os.getcwd(), "macos_clean_manifest.json"),
                    help="manifest 输出路径（默认当前目录 macos_clean_manifest.json）")
    ap.add_argument("--categories", help="仅扫描指定类目 id（逗号分隔），默认全部")
    ap.add_argument("--min-size", type=float, default=0.0,
                    help="类目内单条明细低于此 MB 的忽略（默认 0，全部保留）")
    ap.add_argument("--large-gb", type=float, default=1.0, help="大文件阈值（GB，默认 1）")
    ap.add_argument("--old-days", type=int, default=90, help="旧文件阈值（天，默认 90）")
    ap.add_argument("--no-large", action="store_true", help="跳过「大文件/旧文件」扫描")
    ap.add_argument("--tmp-days", type=int, default=7,
                    help="临时文件只清超过此天数未修改的（默认 7，近期改动一律跳过）")
    ap.add_argument("--include-system", action="store_true",
                    help="包含系统级类目（扫描只读，清理需 sudo）")
    ap.add_argument("--no-docker", action="store_true",
                    help="跳过 Docker 命令式探测（Docker 未运行时更快）")
    ap.add_argument("--keep", action="append", default=[],
                    help="指定保留的目录前缀（可多次给），命中即从结果剔除")
    args = ap.parse_args()

    KEEP_PREFIXES.extend(args.keep)

    mac = detect_macos()
    cats = build_categories(mac)
    # 临时文件类目的时间阈值统一由 --tmp-days 决定
    for c in cats:
        if c["collector"] == "custom_tmp":
            c["min_age_days"] = args.tmp_days
    if args.no_docker:
        cats = [c for c in cats if not c["collector"].startswith("custom_docker")]

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

    # 大文件/旧文件
    if not args.no_large:
        hits = collect_large_old(mac, args.large_gb, args.old_days)
        hits = [h for h in hits if h["bytes"] >= min_bytes]
        total = sum(h["bytes"] for h in hits)
        manifest["categories"].append({
            "id": "large_old_files", "name": "大文件/旧文件（>%gGB 且 %d天未改）" % (args.large_gb, args.old_days),
            "severity": "caution", "scope": "user",
            "desc": "用户目录下超过阈值且久未修改的文件，需人工确认是否删除。",
            "per_item_confirm": False,
            "total_bytes": total, "item_count": len(hits), "items": hits,
        })
        manifest["grand_total_bytes"] += total

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # 控制台摘要
    print("macOS: %s (%s, %s)%s" % (
        mac["name"], mac["version"], mac["family"],
        ", Apple Silicon" if mac["apple_silicon"] else ""))
    print("密封系统卷(只读): %s" % ("是" if mac["sealed_system"] else "否"))
    print("-" * 60)
    for c in manifest["categories"]:
        flag = "  [系统]" if c["scope"] == "system" else ""
        print("%-34s %12s  %5d 项%s" % (
            c["name"][:34], human_bytes(c["total_bytes"]), c["item_count"], flag))
    print("-" * 60)
    print("可清理总计: %s  (manifest -> %s)" % (human_bytes(manifest["grand_total_bytes"]), args.out))


if __name__ == "__main__":
    main()
