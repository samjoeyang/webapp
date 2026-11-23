#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
macOS 本机工况查看器（只读，绝不修改任何文件 / 设置）。

展示四大类本机工况，功能对标 CleanMyMac 的「系统状态 / 菜单栏监控」：
  - CPU 工况：型号、物理/逻辑核心数、实时占用率、1/5/15 分钟负载、热状态
  - 内存工况：总量、已用（App+Wired+Compressed）、空闲、缓存、压缩、交换、压力等级
  - 网络连接：主网卡 + IP、各状态 TCP/UDP 连接数、监听端口、Wi‑Fi SSID、公网 IP（可选）
  - 硬盘工况：各挂载卷总量/已用/可用/占比（含 ASCII 占用条）、SMART 状态

输出：终端仪表盘（默认） + `--json` 可导出机器可读 JSON。
全程只读，仅调用 sysctl / vm_stat / top / df / netstat / ifconfig / networksetup 等系统命令。
"""

import os
import sys
import json
import argparse
import subprocess

HOME = os.path.expanduser("~")


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------
def run(cmd, timeout=10):
    """执行命令，返回 (stdout, rc)；失败返回 ("", -1)。"""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout, r.returncode
    except Exception:
        return "", -1


def sysctl_get(*keys):
    """批量读取 sysctl，返回 {key: value_str}。"""
    out, rc = run(["sysctl", "-n"] + list(keys))
    if rc != 0:
        return {}
    vals = out.splitlines()
    # sysctl -n 多 key 时逐行返回，行数与 key 数一致
    return {keys[i]: (vals[i].strip() if i < len(vals) else "") for i in range(len(keys))}


def fmt_size(b):
    """人类可读体积。"""
    b = float(b)
    for unit in ("B", "KB", "MB", "GB", "TB", "PB"):
        if b < 1024 or unit == "PB":
            return ("%.0f %s" % (b, unit)) if unit == "B" else ("%.1f %s" % (b, unit))
        b /= 1024


def bar(pct, width=24):
    """ASCII 占用条。pct 为 0-100 整数。"""
    pct = max(0, min(100, int(pct)))
    filled = int(round(pct / 100.0 * width))
    return "[" + "#" * filled + "-" * (width - filled) + "] %3d%%" % pct


def C(text, code):
    """极简 ANSI 着色（--no-color 时关闭）。"""
    if bar_use_color:
        return "\033[%dm%s\033[0m" % (code, text)
    return text


bar_use_color = True
GREEN, YELLOW, RED, CYAN, DIM = 32, 33, 31, 36, 90


def level_color(pct):
    if pct >= 90:
        return RED
    if pct >= 70:
        return YELLOW
    return GREEN


# ---------------------------------------------------------------------------
# CPU 工况
# ---------------------------------------------------------------------------
def cpu_info():
    info = {"brand": "Unknown", "physical": 0, "logical": 0, "ncpu": 0,
            "usage_pct": None, "idle_pct": None, "loadavg": [None, None, None],
            "thermal": "N/A"}
    kv = sysctl_get("machdep.cpu.brand_string", "hw.physicalcpu",
                    "hw.logicalcpu", "hw.ncpu", "vm.loadavg")
    if "machdep.cpu.brand_string" in kv:
        info["brand"] = kv["machdep.cpu.brand_string"]
    try:
        info["physical"] = int(kv.get("hw.physicalcpu", 0))
    except ValueError:
        pass
    try:
        info["logical"] = int(kv.get("hw.logicalcpu", 0))
    except ValueError:
        pass
    try:
        info["ncpu"] = int(kv.get("hw.ncpu", 0))
    except ValueError:
        pass
    # 负载（始终可用，即使 top 被沙箱限制）
    la = kv.get("vm.loadavg", "").strip()
    if la.startswith("{"):
        nums = [x for x in la.strip("{}").split() if x.replace(".", "").isdigit()]
        if len(nums) >= 3:
            info["loadavg"] = [float(x) for x in nums[:3]]

    # 实时占用率：top 单次采样（被限制时降级为 N/A，以负载均值作参考）
    out, rc = run(["top", "-l", "1", "-n", "0", "-R"], timeout=8)
    usage_found = False
    if rc == 0:
        for line in out.splitlines():
            if "CPU usage" in line:
                parts = [p for p in line.replace("CPU usage:", "").split(",")]
                for p in parts:
                    if "idle" in p:
                        try:
                            idle = float(p.split("%")[0].strip())
                        except ValueError:
                            idle = None
                        if idle is not None:
                            info["idle_pct"] = idle
                            info["usage_pct"] = round(100.0 - idle, 2)
                            usage_found = True
    info["usage_available"] = usage_found

    # 热状态（Apple Silicon / Intel 不同键，择一）
    for key in ("machdep.xcpm.cpu_thermal_level", "dev.cpu.0.temperature"):
        t, _ = run(["sysctl", "-n", key], timeout=5)
        t = t.strip()
        if t and t != "":
            info["thermal"] = t
            break
    return info


# ---------------------------------------------------------------------------
# 内存工况
# ---------------------------------------------------------------------------
def memory_info():
    info = {"total": 0, "used": 0, "free": 0, "cached": 0,
            "compressed": 0, "wired": 0, "active": 0, "swap_used": 0,
            "pressure": "N/A"}
    kv = sysctl_get("hw.memsize", "hw.pagesize")
    total = int(kv.get("hw.memsize", 0))
    ps = int(kv.get("hw.pagesize", 4096))
    info["total"] = total

    out, _ = run(["vm_stat"], timeout=8)
    pg = {}
    for line in out.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            k = k.strip().replace(" ", "_").replace("Pages_", "")
            v = v.replace(".", "").strip()
            if v.isdigit():
                pg[k] = int(v) * ps

    free = pg.get("free", 0)
    inactive = pg.get("inactive", 0)
    speculative = pg.get("speculative", 0)
    wired = pg.get("wired", 0)
    active = pg.get("active", 0)
    compressed = pg.get("occupied_by_compressor", 0) or pg.get("compressed", 0)

    info["free"] = free
    info["cached"] = inactive + speculative
    info["wired"] = wired
    info["active"] = active
    info["compressed"] = compressed
    info["used"] = active + wired + compressed  # ≈ App + Wired + Compressed

    # 交换
    su, _ = run(["sysctl", "-n", "vm.swapusage"], timeout=5)
    for part in su.split():
        if part.startswith("used"):
            try:
                info["swap_used"] = int(float(part.split("=")[1].replace("M", "")) * 1024 * 1024)
            except (IndexError, ValueError):
                pass

    # 内存压力等级
    mp, _ = run(["memory_pressure"], timeout=8)
    for line in mp.splitlines():
        if "memory pressure" in line:
            try:
                lvl = int(line.split(":")[1].split()[0])
                info["pressure"] = {1: "正常 (normal)",
                                    2: "偏高 (warn)",
                                    3: "紧急 (critical)"}.get(lvl, str(lvl))
            except (IndexError, ValueError):
                pass
    return info


# ---------------------------------------------------------------------------
# 网络连接
# ---------------------------------------------------------------------------
def network_info(public=True):
    info = {"primary_iface": None, "primary_ip": None, "wifi_ssid": None,
            "tcp_states": {}, "udp_count": 0, "listening": [], "public_ip": None}

    # 主路由接口
    ro, _ = run(["route", "-n", "get", "default"], timeout=5)
    for line in ro.splitlines():
        if "interface:" in line:
            info["primary_iface"] = line.split(":")[1].strip()

    if info["primary_iface"]:
        ip, _ = run(["ipconfig", "getifaddr", info["primary_iface"]], timeout=5)
        info["primary_ip"] = ip.strip() or None
        # Wi‑Fi SSID（仅 en0 等 AirPort 接口）
        ssid, _ = run(["networksetup", "-getairportnetwork", info["primary_iface"]], timeout=5)
        if "Current Wi-Fi Network:" in ssid:
            info["wifi_ssid"] = ssid.split(":", 1)[1].strip()

    # 连接统计
    tcp, _ = run(["netstat", "-an", "-f", "inet", "-p", "tcp"], timeout=8)
    for line in tcp.splitlines():
        f = line.split()
        if len(f) >= 6 and f[0] == "tcp4":
            state = f[5]
            info["tcp_states"][state] = info["tcp_states"].get(state, 0) + 1
            if state == "LISTEN":
                # *.PORT 或 addr.port
                addr = f[3]
                port = addr.rsplit(".", 1)[-1] if "." in addr else addr
                info["listening"].append({"addr": addr, "port": port})
    udp, _ = run(["netstat", "-an", "-f", "inet", "-p", "udp"], timeout=8)
    info["udp_count"] = sum(1 for l in udp.splitlines() if l.strip().startswith("udp4"))

    if public:
        pip, _ = run(["curl", "-s", "--max-time", "3", "https://api.ipify.org"], timeout=5)
        info["public_ip"] = pip.strip() or None
    return info


# ---------------------------------------------------------------------------
# 硬盘工况
# ---------------------------------------------------------------------------
def disk_info():
    info = {"volumes": [], "smart": "N/A"}
    out, _ = run(["df", "-k", "-P"], timeout=8)
    lines = out.splitlines()[1:]  # 跳过表头
    for line in lines:
        f = line.split()
        if len(f) < 6:
            continue
        fs, blocks, used, avail, cap, mount = f[0], f[1], f[2], f[3], f[4], f[5]
        # 过滤伪文件系统
        if fs.startswith(("map", "devfs", "com.apple")) or "auto" in fs:
            continue
        if mount not in ("/",) and not mount.startswith(("/Volumes/", "/System/Volumes/")):
            continue
        if not cap.rstrip("%").isdigit():
            continue
        pct = int(cap.rstrip("%"))
        info["volumes"].append({
            "filesystem": fs,
            "mount": mount,
            "total_bytes": int(blocks) * 1024,
            "used_bytes": int(used) * 1024,
            "avail_bytes": int(avail) * 1024,
            "used_pct": pct,
        })

    # SMART（APFS/HFS 物理盘，disk0 常见）
    for dsk in ("disk0", "disk1"):
        sm, _ = run(["diskutil", "info", dsk], timeout=5)
        for line in sm.splitlines():
            if "SMART Status" in line:
                info["smart"] = line.split(":", 1)[1].strip()
                break
        if info["smart"] != "N/A":
            break
    return info


# ---------------------------------------------------------------------------
# 渲染
# ---------------------------------------------------------------------------
def render(data):
    lines = []
    A = lines.append

    A(C("══════════════ macOS 本机工况 ══════════════", CYAN))
    m = data["macos"]
    A("系统: %s %s (build %s) · %s · 密封系统卷: %s" % (
        m["name"], m["version"], m.get("build", "?"),
        "Apple Silicon" if m["apple_silicon"] else "Intel",
        "是" if m["sealed_system"] else "否"))

    # CPU
    c = data["cpu"]
    A("")
    A(C("● CPU 工况", CYAN))
    A("  型号     : %s" % c["brand"])
    A("  核心数   : 物理 %s / 逻辑 %s（共 %s）" % (c["physical"], c["logical"], c["ncpu"]))
    if c["usage_pct"] is not None:
        A("  实时占用 : %s" % C("%s%%" % c["usage_pct"], level_color(c["usage_pct"])))
    else:
        A("  实时占用 : N/A（top 受限，以下负载均值作参考）")
    A("  负载均值 : %.2f / %.2f / %.2f  (1/5/15 分钟)" % tuple(c["loadavg"]))
    A("  热状态   : %s" % c["thermal"])

    # 内存
    mem = data["memory"]
    A("")
    A(C("● 内存工况", CYAN))
    A("  总量     : %s" % fmt_size(mem["total"]))
    used_pct = mem["used"] / mem["total"] * 100 if mem["total"] else 0
    A("  已用     : %s  %s" % (fmt_size(mem["used"]),
                               C(bar(used_pct), level_color(used_pct))))
    A("  空闲     : %s" % fmt_size(mem["free"]))
    A("  缓存     : %s（可回收）" % fmt_size(mem["cached"]))
    A("  压缩     : %s" % fmt_size(mem["compressed"]))
    A("  交换     : %s" % fmt_size(mem["swap_used"]))
    A("  压力等级 : %s" % C(mem["pressure"], YELLOW if mem["pressure"] != "正常 (normal)" else GREEN))

    # 网络
    n = data["network"]
    A("")
    A(C("● 网络连接", CYAN))
    if n["primary_iface"]:
        A("  主接口   : %s  →  %s" % (n["primary_iface"], n["primary_ip"] or "（无 IP）"))
    if n["wifi_ssid"]:
        A("  Wi‑Fi    : %s" % n["wifi_ssid"])
    states = n["tcp_states"]
    est = states.get("ESTABLISHED", 0)
    A("  TCP 连接 : ESTABLISHED %d / LISTEN %d / TIME_WAIT %d / 其他 %d" % (
        est, states.get("LISTEN", 0), states.get("TIME_WAIT", 0),
        sum(v for k, v in states.items() if k not in ("ESTABLISHED", "LISTEN", "TIME_WAIT"))))
    A("  UDP 端口 : %d" % n["udp_count"])
    if n["listening"]:
        lst = ", ".join(sorted({x["port"] for x in n["listening"]}))[:80]
        A("  监听端口 : %s" % lst)
    if n.get("public_ip"):
        A("  公网 IP  : %s" % n["public_ip"])

    # 硬盘
    d = data["disk"]
    A("")
    A(C("● 硬盘工况", CYAN))
    for v in d["volumes"]:
        A("  %-22s %s  %s" % (
            v["mount"],
            C(bar(v["used_pct"]), level_color(v["used_pct"])),
            fmt_size(v["used_bytes"]) + " / " + fmt_size(v["total_bytes"])))
        A("  %-22s  可用 %s" % ("", fmt_size(v["avail_bytes"])))
    A("  SMART    : %s" % C(d["smart"], GREEN if d["smart"] == "Verified" else YELLOW))

    A(C("════════════════════════════════════════════", CYAN))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 主程序
# ---------------------------------------------------------------------------
def detect_macos():
    """轻量版本探测（复用 scan.py 语义，供工况头部展示）。"""
    info = {"name": "Unknown", "version": "0", "apple_silicon": False,
            "sealed_system": False, "build": "?"}
    out, _ = run(["sw_vers"], timeout=20)
    for line in out.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            k, v = k.strip(), v.strip()
            if k == "ProductName":
                info["product"] = v
            elif k == "ProductVersion":
                info["version"] = v
            elif k == "BuildVersion":
                info["build"] = v
    parts = [int(x) for x in info["version"].split(".") if x.isdigit()]
    while len(parts) < 2:
        parts.append(0)
    if parts[0] == 10:
        fam = "10.%d" % parts[1]
        major_num = 10.0 + parts[1] / 100.0
    else:
        fam = str(parts[0])
        major_num = float(parts[0])
    NAMES = {"10.13": "High Sierra", "10.14": "Mojave", "10.15": "Catalina",
             "11": "Big Sur", "12": "Monterey", "13": "Ventura",
             "14": "Sonoma", "15": "Sequoia"}
    info["name"] = NAMES.get(fam, "macOS %s" % info["version"])
    info["apple_silicon"] = (os.uname().machine == "arm64")
    info["sealed_system"] = major_num >= 10.15
    return info


def main():
    global bar_use_color
    ap = argparse.ArgumentParser(description="macOS 本机工况查看器（CPU/内存/网络/硬盘）")
    ap.add_argument("--json", action="store_true", help="输出机器可读 JSON（不打印仪表盘）")
    ap.add_argument("--out", default=None, help="JSON 输出文件路径（配合 --json）")
    ap.add_argument("--no-color", action="store_true", help="关闭 ANSI 着色")
    ap.add_argument("--no-public", action="store_true", help="不查询公网 IP（离线更快）")
    args = ap.parse_args()
    bar_use_color = not args.no_color

    data = {
        "macos": detect_macos(),
        "cpu": cpu_info(),
        "memory": memory_info(),
        "network": network_info(public=not args.no_public),
        "disk": disk_info(),
    }

    if args.json:
        js = json.dumps(data, ensure_ascii=False, indent=2)
        if args.out:
            with open(args.out, "w") as f:
                f.write(js)
            print("已写入 JSON: %s" % args.out)
        else:
            print(js)
    else:
        print(render(data))


if __name__ == "__main__":
    main()
