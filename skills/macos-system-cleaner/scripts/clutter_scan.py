#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
重复文件 / 相似图片扫描器（只读；对标 CleanMyMac 的 My Clutter）。

实现方法：
  - 重复文件：先按文件大小分桶，再对同尺寸文件做 SHA-256，按哈希分组。
  - 相似图片：用系统自带 sips 缩略图 + 纯标准库 PNG 解码，计算 9x8 dHash，
    汉明距离 <= 阈值者用并查集合并成组。不依赖 Pillow / 第三方库。
  - 每组默认「建议保留」1 份（体积最大 → 修改时间最新 → 路径最短），
    其余进入 items 供 clean.py 逐项确认；脚本绝不自动删除、也不自动全选。

输出 manifest 与 scan.py 兼容，可直接交给 clean.py：
  python3 clutter_scan.py --out clutter.json
  python3 clean.py --manifest clutter.json --categories duplicates --apply --approved approved.json

安全边界：
  - 只扫描显式给定的 --roots（默认 Downloads/Desktop/Documents/Pictures/Movies）。
  - 跳过 .git / node_modules / venv / Library / Caches 等重型与配置目录。
  - 大文件哈希超过 --max-hash-mb 时跳过，避免卡死。
  - CleanMyMac 的 My Clutter 会永久删除；本脚本坚持走回收站 + 逐项确认。
"""
import os
import sys
import json
import time
import struct
import zlib
import argparse
import datetime
import subprocess
import tempfile
from collections import defaultdict

from rules import load_rules, make_context, resolve, RuleError

try:
    from scan import human_bytes, is_excluded, load_ignore_file
except ImportError:
    sys.stderr.write("clutter_scan.py 需与 scan.py 放在同一目录\n")
    raise SystemExit(2)

HOME = os.path.expanduser("~")
RULES = None
CTX = None


# ---------------------------------------------------------------------------
# 文件枚举与哈希
# ---------------------------------------------------------------------------
def _skip_dir(name):
    cfg = RULES["clutter"]
    return (name in cfg["skip_dirs"] or name.startswith(".")
            or name.endswith(tuple(cfg["package_suffixes"])))


def walk_files(roots, max_files):
    """只读枚举普通文件；跳过软链接、重型目录与应用/照片库包内部。"""
    out, seen = [], set()
    for root in roots:
        root = os.path.abspath(os.path.expanduser(root))
        if not os.path.isdir(root) or _skip_dir(os.path.basename(root)):
            continue
        for dp, dns, fns in os.walk(root, followlinks=False):
            dns[:] = sorted(d for d in dns if not _skip_dir(d))
            for fn in fns:
                p = os.path.join(dp, fn)
                try:
                    if os.path.islink(p) or not os.path.isfile(p):
                        continue
                    rp = os.path.realpath(p)
                    if rp in seen:
                        continue
                    seen.add(rp)
                    st = os.stat(p)
                    out.append({"path": p, "bytes": st.st_size, "mtime": st.st_mtime})
                except OSError:
                    continue
                if len(out) >= max_files:
                    return out
    return out


def sha256_file(path, chunk=1024 * 1024):
    import hashlib
    h = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            while True:
                b = f.read(chunk)
                if not b:
                    break
                h.update(b)
        return h.hexdigest()
    except OSError:
        return None


def group_duplicates(files, min_bytes, max_hash_bytes):
    by_size = defaultdict(list)
    for f in files:
        if f["bytes"] >= min_bytes and f["bytes"] <= max_hash_bytes:
            by_size[f["bytes"]].append(f)
    skipped = sum(len(v) for k, v in by_size.items() if k > max_hash_bytes)
    groups = []
    idx = 0
    for size in sorted(by_size, reverse=True):
        bucket = by_size[size]
        if len(bucket) < 2:
            continue
        by_hash = defaultdict(list)
        for f in bucket:
            digest = sha256_file(f["path"])
            if digest:
                by_hash[digest].append(f)
        for digest, g in by_hash.items():
            if len(g) < 2:
                continue
            idx += 1
            groups.append(build_group("dup-%03d" % idx, g, "sha256:" + digest[:16]))
    return groups, skipped


def build_group(group_id, files, evidence):
    """每组保留 1 份：画质（像素数）→ 体积 → 修改时间 → 路径最短。

    CleanMyMac 5.7.4 OrganizeModule 有 Smartly / Oldest / Newest / Largest / Smallest
    与 isBestInGroup 判据；CLI 没有其完整画质模型，用像素数作为保守近似。
    """
    keep = sorted(files, key=lambda f: (
        -f.get("pixels", 0), -f["bytes"], -f["mtime"], len(f["path"])))[0]
    removable = [f for f in files if f["path"] != keep["path"]]
    return {
        "group_id": group_id,
        "evidence": evidence,
        "suggested_keep": keep["path"],
        "keep_reason": RULES["clutter"]["keep_reason"],
        "files": [{"path": f["path"], "bytes": f["bytes"],
                   "mtime": datetime.datetime.fromtimestamp(f["mtime"]).isoformat(timespec="seconds")}
                  for f in files],
        "suggested_remove": [f["path"] for f in removable],
        "reclaimable_bytes": sum(f["bytes"] for f in removable),
    }


# ---------------------------------------------------------------------------
# PNG 解码（仅标准库，够 sips 输出用）与 dHash
# ---------------------------------------------------------------------------
def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def decode_png(path):
    """返回 (w, h, channels, rows)；只支持 sips 产出的 8-bit 非隔行 PNG。"""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return None
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    pos, idat = 8, []
    w = h = depth = ct = None
    while pos + 12 <= len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if typ == b"IHDR":
            w, h, depth, ct, comp, filt, interlace = struct.unpack(">IIBBBBB", chunk)
            if depth != 8 or interlace != 0 or ct not in (0, 2, 6):
                return None
        elif typ == b"IDAT":
            idat.append(chunk)
        elif typ == b"IEND":
            break
    if not w or not h or not idat:
        return None
    channels = {0: 1, 2: 3, 6: 4}[ct]
    try:
        raw = zlib.decompress(b"".join(idat))
    except zlib.error:
        return None
    stride = w * channels
    if len(raw) < h * (stride + 1):
        return None
    rows, prev, idx = [], bytearray(stride), 0
    for _ in range(h):
        ft = raw[idx]
        idx += 1
        line = bytearray(raw[idx:idx + stride])
        idx += stride
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if ft == 1:
                line[i] = (line[i] + a) & 255
            elif ft == 2:
                line[i] = (line[i] + b) & 255
            elif ft == 3:
                line[i] = (line[i] + ((a + b) >> 1)) & 255
            elif ft == 4:
                line[i] = (line[i] + _paeth(a, b, c)) & 255
            elif ft != 0:
                return None
        rows.append(line)
        prev = line
    return w, h, channels, rows


def image_dimensions(path):
    """用 sips 读像素尺寸；失败返回 (0, 0)。"""
    try:
        r = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
            capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return 0, 0
    if r.returncode != 0:
        return 0, 0
    vals = {}
    for line in r.stdout.splitlines():
        if ":" in line:
            k, v = line.rsplit(":", 1)
            k, v = k.strip(), v.strip()
            if k in ("pixelWidth", "pixelHeight") and v.isdigit():
                vals[k] = int(v)
    return vals.get("pixelWidth", 0), vals.get("pixelHeight", 0)


def dhash(path):
    """9x8 灰度差分哈希 → 64 bit 整数；失败返回 None。"""
    cfg = RULES["clutter"]["dhash"]
    with tempfile.TemporaryDirectory() as td:
        thumb = os.path.join(td, "t.png")
        try:
            r = subprocess.run(
                ["sips", "-s", "format", "png", "-Z", str(cfg["sips_size"]),
                 path, "--out", thumb],
                capture_output=True, timeout=20,
            )
            if r.returncode != 0 or not os.path.isfile(thumb):
                return None
        except (OSError, subprocess.SubprocessError):
            return None
        img = decode_png(thumb)
    if not img:
        return None
    w, h, ch, rows = img
    wbits, hbits = cfg["width"], cfg["height"]
    bits = 0
    for y in range(hbits):
        vals = []
        for x in range(wbits):
            px = min(w - 1, int((x + 0.5) * w / float(wbits)))
            py = min(h - 1, int((y + 0.5) * h / float(hbits)))
            off = px * ch
            vals.append(rows[py][off])
        for x in range(wbits - 1):
            bits = (bits << 1) | (1 if vals[x + 1] > vals[x] else 0)
    return bits


def group_similar(files, min_bytes, threshold, max_images, exclude_paths):
    candidates = [f for f in files
                  if f["bytes"] >= min_bytes
                  and f["path"] not in exclude_paths
                  and os.path.splitext(f["path"])[1].lower() in set(RULES["clutter"]["image_exts"])]
    candidates.sort(key=lambda f: f["bytes"], reverse=True)
    capped = len(candidates) > max_images
    candidates = candidates[:max_images]
    hashes = {}
    for f in candidates:
        h = dhash(f["path"])
        if h is not None:
            w, ht = image_dimensions(f["path"])
            f["pixels"] = w * ht
            hashes[f["path"]] = h

    paths = list(hashes)
    parent = {p: p for p in paths}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i, a in enumerate(paths):
        for b in paths[i + 1:]:
            if bin(hashes[a] ^ hashes[b]).count("1") > threshold:
                continue
            union(a, b)

    clusters = defaultdict(list)
    by_path = {f["path"]: f for f in candidates}
    for p in paths:
        clusters[find(p)].append(by_path[p])
    groups = []
    idx = 0
    for cluster in clusters.values():
        if len(cluster) < 2:
            continue
        idx += 1
        groups.append(build_group("sim-%03d" % idx, cluster,
                                  "dHash<=%d" % threshold))
    return groups, capped


# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------
def make_category(cid, name, desc, groups):
    items, total = [], 0
    for g in groups:
        total += g["reclaimable_bytes"]
        for p in g["suggested_remove"]:
            size = next((f["bytes"] for f in g["files"] if f["path"] == p), 0)
            items.append({"path": p, "bytes": size, "note": g["group_id"]})
    items.sort(key=lambda x: x["bytes"], reverse=True)
    return {
        "id": cid, "name": name, "severity": "caution", "scope": "user",
        "desc": desc, "per_item_confirm": True,
        "total_bytes": total, "item_count": len(items),
        "items": items, "groups": groups,
    }


def main():
    global RULES, CTX
    ap = argparse.ArgumentParser(description="重复文件 / 相似图片扫描（只读）")
    ap.add_argument("--rules-dir", help="规则库目录（默认 <skill>/rules）")
    ap.add_argument("--roots", help="扫描根目录，逗号分隔；默认 Downloads/Desktop/Documents/Pictures/Movies")
    ap.add_argument("--out", default=os.path.join(os.getcwd(), "macos_clutter_manifest.json"))
    ap.add_argument("--min-kb", type=float, default=None, help="最小文件体积 KB（默认见 rules/defaults.json）")
    ap.add_argument("--max-files", type=int, default=None, help="最多枚举文件数（默认见 rules/defaults.json）")
    ap.add_argument("--max-hash-mb", type=float, default=None, help="超过此体积不做哈希（默认见 rules/defaults.json）")
    ap.add_argument("--similar-threshold", type=int, default=None, help="dHash 汉明距离阈值（默认见 rules/defaults.json）")
    ap.add_argument("--max-images", type=int, default=None, help="相似图片最多比较张数（默认见 rules/defaults.json）")
    ap.add_argument("--no-similar", action="store_true", help="只查完全重复文件")
    ap.add_argument("--ignore-file", help="持久化忽略清单 JSON（与 scan.py 共用）")
    args = ap.parse_args()

    try:
        RULES = load_rules(args.rules_dir)
    except RuleError as ex:
        sys.stderr.write("规则库载入失败: %s\n" % ex)
        raise SystemExit(2)
    CTX = make_context()
    defaults = RULES["defaults"]["cli_defaults"]
    for arg, key in (("min_kb", "min_kb"), ("max_files", "max_files"),
                     ("max_hash_mb", "max_hash_mb"),
                     ("similar_threshold", "similar_threshold"),
                     ("max_images", "max_images")):
        if getattr(args, arg) is None:
            setattr(args, arg, defaults[key])

    roots = ([x.strip() for x in args.roots.split(",") if x.strip()]
             if args.roots else resolve(RULES["clutter"]["default_roots"], CTX, RULES))
    try:
        ignored = load_ignore_file(args.ignore_file)
    except Exception as ex:
        sys.stderr.write("忽略清单读取失败: %s\n" % ex)
        raise SystemExit(2)

    files = [f for f in walk_files(roots, args.max_files) if not is_excluded(f["path"])]
    min_bytes = int(args.min_kb * 1024)
    dup_groups, skipped = group_duplicates(files, min_bytes, int(args.max_hash_mb * 1024 * 1024))

    sim_groups, capped = [], False
    if not args.no_similar:
        dup_paths = {f["path"] for g in dup_groups for f in g["files"]}
        sim_groups, capped = group_similar(
            files, min_bytes, args.similar_threshold, args.max_images, dup_paths)

    manifest = {
        "tool": "macos-system-cleaner/clutter",
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "roots": roots,
        "thresholds": {
            "min_kb": args.min_kb,
            "max_hash_mb": args.max_hash_mb,
            "similar_hamming": args.similar_threshold,
            "max_images": args.max_images,
        },
        "notes": list(RULES["clutter"]["notes"]),
        "categories": [
            make_category("duplicates", RULES["clutter"]["categories"]["duplicates"]["name"],
                          RULES["clutter"]["categories"]["duplicates"]["desc"], dup_groups),
        ],
    }
    if not args.no_similar:
        manifest["categories"].append(make_category(
            "similar_images", RULES["clutter"]["categories"]["similar_images"]["name"],
            RULES["clutter"]["categories"]["similar_images"]["desc"], sim_groups))
    if skipped:
        manifest["notes"].append("有 %d 个文件超过 --max-hash-mb，未做哈希。" % skipped)
    if capped:
        manifest["notes"].append("相似图片超过 --max-images，仅比较体积最大的若干张。")

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print("扫描根目录: %s" % ", ".join(roots))
    print("枚举文件: %d%s" % (len(files), "  | 忽略规则 %d 条" % ignored if args.ignore_file else ""))
    print("-" * 60)
    for c in manifest["categories"]:
        print("%-28s %12s  %5d 项  (%d 组)" % (
            c["name"], human_bytes(c["total_bytes"]), c["item_count"], len(c["groups"])))
    print("-" * 60)
    print("manifest -> %s" % args.out)


if __name__ == "__main__":
    main()
