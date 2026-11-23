#!/usr/bin/env python3
"""估算口播稿时长，并判断是否落在目标区间（默认 3~5 分钟）。

字数口径：中文字符逐字计，英文按空格分词计，数字串按词计；标点不计入语速基数。

用法:
    python3 estimate_duration.py script.txt [--wpm 240] [--target-min 3] [--target-max 5]
    echo "口播稿文本" | python3 estimate_duration.py - [--wpm 240]
"""
import argparse
import re
import sys

CJK_RE = re.compile(r"[\u4e00-\u9fff]")
WORD_RE = re.compile(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*")


def count_units(text: str) -> int:
    cjk = len(CJK_RE.findall(text))
    latin = len(WORD_RE.findall(text))
    return cjk + latin


def main() -> int:
    ap = argparse.ArgumentParser(description="口播稿时长估算")
    ap.add_argument("input", help="口播稿文本文件，- 表示从标准输入读取")
    ap.add_argument("--wpm", type=float, default=240, help="每分钟朗读单位数（默认 240）")
    ap.add_argument("--target-min", type=float, default=3.0, help="目标时长下限（分钟）")
    ap.add_argument("--target-max", type=float, default=5.0, help="目标时长上限（分钟）")
    args = ap.parse_args()

    if args.input == "-":
        text = sys.stdin.read()
    else:
        try:
            with open(args.input, "r", encoding="utf-8") as f:
                text = f.read()
        except Exception as e:
            print(f"[错误] 读取文件失败: {e}", file=sys.stderr)
            return 1

    units = count_units(text)
    minutes = units / args.wpm if args.wpm > 0 else 0.0
    mm = int(minutes)
    ss = round((minutes - mm) * 60)

    print(f"朗读单位数: {units}")
    print(f"语速: {args.wpm:.0f} 单位/分钟")
    print(f"预计时长: {mm} 分 {ss} 秒（{minutes:.2f} 分钟）")

    if minutes < args.target_min:
        print(f"[偏短] 低于目标下限 {args.target_min:g} 分钟，可补充案例或展开重点。")
        return 2
    if minutes > args.target_max:
        print(f"[偏长] 超过目标上限 {args.target_max:g} 分钟，需压缩细节或提高语速。")
        return 3
    print(f"[达标] 时长在 {args.target_min:g}~{args.target_max:g} 分钟区间内。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
