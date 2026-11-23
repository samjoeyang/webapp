#!/usr/bin/env python3
"""把口播稿拆成带时间轴的 SRT 字幕，并输出分句 JSON 供逐句配音。

- 分句依据：句号、问号、感叹号、分号、换行；去掉空句与纯标题行（可选）。
- 每句时长按字数 / 语速估算，句间留 --gap 秒停顿。
- 输出：<stem>.srt 字幕文件 + <stem>.lines.json 分句清单（text、start、end、duration）。

用法:
    python3 script_to_srt.py script.txt [--wpm 240] [--gap 0.3] [--out-dir .]
"""
import argparse
import json
import re
import sys
from pathlib import Path

CJK_RE = re.compile(r"[\u4e00-\u9fff]")
WORD_RE = re.compile(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*")
SPLIT_RE = re.compile(r"(?<=[。！？!?；;])|\n")


def count_units(text: str) -> int:
    return len(CJK_RE.findall(text)) + len(WORD_RE.findall(text))


def fmt_ts(seconds: float) -> str:
    ms = round(seconds * 1000)
    h, ms = divmod(ms, 3600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def split_sentences(text: str) -> list[str]:
    raw = [s.strip() for s in SPLIT_RE.split(text) if s and s.strip()]
    lines: list[str] = []
    for s in raw:
        # 跳过纯小标题行（如 “一、xxx” 单独成行且无句末标点）可保留，这里仅去空
        if s:
            lines.append(s)
    return lines


def main() -> int:
    ap = argparse.ArgumentParser(description="口播稿转 SRT 字幕与分句清单")
    ap.add_argument("input", help="口播稿文本文件（UTF-8）")
    ap.add_argument("--wpm", type=float, default=240, help="每分钟朗读单位数（默认 240）")
    ap.add_argument("--gap", type=float, default=0.3, help="句间停顿秒数（默认 0.3）")
    ap.add_argument("--out-dir", default=".", help="输出目录")
    args = ap.parse_args()

    try:
        text = Path(args.input).read_text(encoding="utf-8")
    except Exception as e:
        print(f"[错误] 读取文件失败: {e}", file=sys.stderr)
        return 1

    sentences = split_sentences(text)
    if not sentences:
        print("[错误] 未解析到有效句子", file=sys.stderr)
        return 1

    lines: list[dict] = []
    cursor = 0.0
    for i, sent in enumerate(sentences, start=1):
        units = count_units(sent)
        dur = units / args.wpm * 60 if args.wpm > 0 else 3.0
        dur = max(dur, 1.0)  # 单句至少 1 秒，避免字幕一闪而过
        start = cursor
        end = start + dur
        lines.append({"index": i, "text": sent, "start": round(start, 3),
                      "end": round(end, 3), "duration": round(dur, 3)})
        cursor = end + args.gap

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(args.input).stem
    srt_path = out_dir / f"{stem}.srt"
    json_path = out_dir / f"{stem}.lines.json"

    srt_blocks = []
    for ln in lines:
        srt_blocks.append(
            f"{ln['index']}\n{fmt_ts(ln['start'])} --> {fmt_ts(ln['end'])}\n{ln['text']}"
        )
    srt_path.write_text("\n\n".join(srt_blocks) + "\n", encoding="utf-8")
    json_path.write_text(json.dumps(lines, ensure_ascii=False, indent=2), encoding="utf-8")

    total = lines[-1]["end"]
    print(f"[完成] {len(lines)} 句，总时长约 {int(total // 60)} 分 {round(total % 60)} 秒")
    print(f"字幕: {srt_path}")
    print(f"分句: {json_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
