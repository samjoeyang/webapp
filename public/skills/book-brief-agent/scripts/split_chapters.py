#!/usr/bin/env python3
"""把长篇书籍 TXT 切成可分批摘要的章节块。

策略：
1. 先用章节标题正则切分（第X章 / Chapter X / 卷X / 一、二、… 等常见写法）；
2. 若某块仍超过 --max-chars，再按字数在段落边界硬切；
3. 输出 JSON 列表，每项含 index、title、text，供逐章摘要环节使用。

用法:
    python3 split_chapters.py book.txt [--max-chars 1500] [--out chunks.json]
"""
import argparse
import json
import re
import sys

# 章节标题：行首出现，独占一行或后跟标题文字
CHAPTER_PATTERNS = [
    r"^\s*第\s*[0-9一二三四五六七八九十百千零两]+\s*[章卷部节回编]\b.*$",
    r"^\s*Chapter\s+\d+.*$",
    r"^\s*Part\s+\d+.*$",
    r"^\s*[0-9]+\.\s*[^\d].*$",
    r"^\s*[一二三四五六七八九十]+、.*$",
]
CHAPTER_RE = re.compile("|".join(f"(?:{p})" for p in CHAPTER_PATTERNS), re.MULTILINE)


def split_by_chapter(text: str) -> list[dict]:
    matches = list(CHAPTER_RE.finditer(text))
    if not matches:
        return [{"title": "全文", "text": text.strip()}]

    chunks: list[dict] = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if not body:
            continue
        title = m.group(0).strip()
        chunks.append({"title": title, "text": body})
    # 标题之前的前言/扉页内容
    if matches[0].start() > 0:
        pre = text[: matches[0].start()].strip()
        if pre:
            chunks.insert(0, {"title": "前言", "text": pre})
    return chunks


def hard_split(text: str, max_chars: int) -> list[str]:
    """按段落边界把超长文本切成不超过 max_chars 的小块。"""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    parts: list[str] = []
    buf = ""
    for p in paragraphs:
        if len(buf) + len(p) + 1 <= max_chars:
            buf = f"{buf}\n\n{p}" if buf else p
        else:
            if buf:
                parts.append(buf)
            if len(p) <= max_chars:
                buf = p
            else:
                # 单段仍超长，按句子硬切
                sentences = re.split(r"(?<=[。！？!?；;])", p)
                buf = ""
                for s in sentences:
                    if len(buf) + len(s) <= max_chars:
                        buf += s
                    else:
                        if buf:
                            parts.append(buf)
                        buf = s
                if buf:
                    parts.append(buf)
                buf = ""
    if buf:
        parts.append(buf)
    return parts


def main() -> int:
    ap = argparse.ArgumentParser(description="书籍 TXT 章节切块")
    ap.add_argument("input", help="书籍纯文本文件（UTF-8）")
    ap.add_argument("--max-chars", type=int, default=1500, help="单块最大字数（默认 1500）")
    ap.add_argument("--out", default="chunks.json", help="输出 JSON 路径")
    args = ap.parse_args()

    try:
        with open(args.input, "r", encoding="utf-8") as f:
            text = f.read()
    except Exception as e:
        print(f"[错误] 读取文件失败: {e}", file=sys.stderr)
        return 1

    chapters = split_by_chapter(text)
    chunks: list[dict] = []
    idx = 1
    for ch in chapters:
        if len(ch["text"]) <= args.max_chars:
            chunks.append({"index": idx, "title": ch["title"], "text": ch["text"]})
            idx += 1
        else:
            for j, part in enumerate(hard_split(ch["text"], args.max_chars), start=1):
                chunks.append({"index": idx, "title": f"{ch['title']}（{j}）", "text": part})
                idx += 1

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(chunks, f, ensure_ascii=False, indent=2)

    total = sum(len(c["text"]) for c in chunks)
    print(f"[完成] 共 {len(chunks)} 块，合计 {total} 字 → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
