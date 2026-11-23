#!/usr/bin/env python3
"""把分段配音 WAV 下载（如为 URL）并无损拼接成一条完整音轨。

用途：TTS 单段 ≤120 秒，长稿分段生成后，用本脚本统一格式、按顺序拼接，
并输出总时长。全程使用同一音色 profile 时，拼接结果即为连续旁白。

清单 JSON 格式（按顺序排列）：
[
  {"index": 1, "url": "https://.../part1.wav"},
  {"index": 2, "local_path": "/abs/part2.wav"}
]

用法:
    python3 concat_audio.py manifest.json --out merged.wav [--sample-rate 40000] [--parts-dir parts]
"""
import argparse
import json
import subprocess
import sys
import urllib.request
from pathlib import Path


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip() or 0)


def normalize(src: Path, dst: Path, sample_rate: int) -> None:
    """统一转码为 PCM 16bit 立体声，避免分段格式不一致导致拼接爆音。"""
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(src),
         "-ac", "2", "-ar", str(sample_rate), "-c:a", "pcm_s16le", str(dst)],
        check=True,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="分段配音拼接为完整 WAV")
    ap.add_argument("manifest", help="分段清单 JSON（url 或 local_path）")
    ap.add_argument("--out", default="merged.wav", help="输出完整 WAV 路径")
    ap.add_argument("--sample-rate", type=int, default=40000, help="统一采样率（默认 40000）")
    ap.add_argument("--parts-dir", default="parts", help="分段下载/暂存目录")
    args = ap.parse_args()

    try:
        items = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[错误] 读取清单失败: {e}", file=sys.stderr)
        return 1

    parts_dir = Path(args.parts_dir)
    parts_dir.mkdir(parents=True, exist_ok=True)
    norm_files: list[Path] = []

    for i, item in enumerate(items, start=1):
        local = item.get("local_path")
        url = item.get("url")
        if local:
            src = Path(local)
        elif url:
            src = parts_dir / f"part{i}.wav"
            try:
                urllib.request.urlretrieve(url, src)
            except Exception as e:
                print(f"[错误] 第 {i} 段下载失败: {e}", file=sys.stderr)
                return 1
        else:
            print(f"[错误] 第 {i} 段缺少 url/local_path", file=sys.stderr)
            return 1

        if not src.exists():
            print(f"[错误] 第 {i} 段文件不存在: {src}", file=sys.stderr)
            return 1

        norm = parts_dir / f"norm{i}.wav"
        normalize(src, norm, args.sample_rate)
        norm_files.append(norm)

    list_file = parts_dir / "concat_list.txt"
    list_file.write_text(
        "".join(f"file '{f.resolve()}'\n" for f in norm_files), encoding="utf-8"
    )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", str(list_file), "-c", "copy", str(out)],
        check=True,
    )

    total = probe_duration(out)
    per = [round(probe_duration(f), 2) for f in norm_files]
    print(f"[完成] {len(norm_files)} 段拼接 → {out}")
    print(f"分段时长(秒): {per}")
    print(f"总时长: {int(total // 60)} 分 {round(total % 60)} 秒（{total:.2f} 秒）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
