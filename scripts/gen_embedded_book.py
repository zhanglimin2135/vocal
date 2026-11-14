"""
把「助记版」词表 Excel 解析成内嵌的 TypeScript 数据文件（随应用打包下发）。

用法示例：
  python3 scripts/gen_embedded_book.py \
    --src "/path/四级词汇_List 01-35助记版.xlsx" \
    --out "src/data/cet4Embedded.ts" \
    --book-id "built-in-cet4" \
    --file-name "四级词汇_List 01-35助记版.xlsx" \
    --export-name "CET4_EMBEDDED_BOOK" \
    --title "四级词汇"

Excel 列位优先按首行表头文字自动识别（见 COLUMN_KEYWORDS），识别不到时回退到 9 列固定布局：
  单词       -> word
  音标       -> extra.phonetic
  词性+释义  -> meaning
  词根词缀   -> extra.splitParts  （整段文本，存为单元素数组）
  词源       -> extra.etymology
  口诀       -> extra.rhyme
  速记/钩子  -> extra.quick
  词根扩展/同组 -> extra.family      （按 、,，;； 等分隔符拆成数组）
  易错       -> extra.caution
  音标拆分   -> extra.phoneticSplit
  用法       -> extra.usage

若某个 sheet 的第一行是表头（首格为「单词」等表头文字），自动跳过该行。
输出结构为 VocabularyBook（参见 src/types/index.ts）。
"""

import argparse
import json
import os
import re

import openpyxl

# 表头检测关键词：若第一行第一格命中，则视为表头行并跳过
HEADER_WORD_KEYWORDS = {"单词", "word", "英文", "词汇", "term", "english"}

# 表头列名 → 字段名（不同词表的列顺序不一致，优先按表头自动识别列位）
COLUMN_KEYWORDS = {
    "word": ("单词", "word", "英文", "词汇", "term", "english"),
    "phonetic": ("音标", "phonetic", "ipa"),
    "meaning": ("释义", "词性+释义", "meaning"),
    "splitParts": ("词根词缀", "拆分"),
    "phoneticSplit": ("音标拆分", "音节拆分", "syllables"),
    "etymology": ("词源", "etymology"),
    "rhyme": ("口诀", "rhyme"),
    "quick": ("速记", "钩子", "quick"),
    "usage": ("用法", "usage"),
    "family": ("词根扩展", "同组", "同族", "family"),
    "caution": ("易错", "caution"),
}

# 无表头时的默认列位（9 列助记版）
DEFAULT_COLUMNS = {
    "word": 0, "phonetic": 1, "meaning": 2, "splitParts": 3, "etymology": 4,
    "rhyme": 5, "quick": 6, "family": 7, "caution": 8,
}

# 词根扩展（同族词）的分隔符
FAMILY_SPLIT_RE = re.compile(r"[、,，;；\s]+")

# 固定时间戳，避免每次构建导致对象引用变化
UPLOADED_AT = 1730000000000


def cell_str(v) -> str:
    if v is None:
        return ""
    return str(v).strip()


def is_header_row(row) -> bool:
    """判断一行是否是表头行（首格为表头关键词）"""
    if not row or row[0] is None:
        return False
    return cell_str(row[0]).lower() in HEADER_WORD_KEYWORDS


def detect_columns(header_row) -> dict:
    """按表头文字识别各字段所在列位；缺失的字段不返回（读取时留空）"""
    texts = [cell_str(c).lower().replace(" ", "") for c in header_row]
    cols = {}
    # 第一轮：精确匹配（避免「音标拆分」被「音标」抢走）
    for field, keywords in COLUMN_KEYWORDS.items():
        for i, t in enumerate(texts):
            if field in cols:
                break
            if t and t in keywords:
                cols[field] = i
    # 第二轮：包含匹配，补上未识别到的字段
    used = set(cols.values())
    for field, keywords in COLUMN_KEYWORDS.items():
        if field in cols:
            continue
        for i, t in enumerate(texts):
            if not t or i in used:
                continue
            if any(k in t for k in keywords):
                cols[field] = i
                used.add(i)
                break
    return cols


def parse_family(v) -> list:
    """把词根扩展单元格拆成单词数组"""
    s = cell_str(v)
    if not s:
        return []
    return [p.strip() for p in FAMILY_SPLIT_RE.split(s) if p.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description="生成内嵌词表数据文件")
    parser.add_argument("--src", required=True, help="源 Excel 路径")
    parser.add_argument("--out", required=True, help="输出 TS 文件路径")
    parser.add_argument("--book-id", required=True, help="词表唯一 ID")
    parser.add_argument("--file-name", required=True, help="词表原始文件名")
    parser.add_argument("--export-name", required=True, help="导出的常量名")
    parser.add_argument("--title", required=True, help="词表中文名（用于文件头注释）")
    args = parser.parse_args()

    wb = openpyxl.load_workbook(args.src, data_only=True)

    sheets = []
    for sn in wb.sheetnames:
        ws = wb[sn]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue

        # 首行若为表头则跳过，并按表头识别列位；无表头则用默认 9 列布局
        if is_header_row(rows[0]):
            data_start = 1
            cols = detect_columns(rows[0])
            if "word" not in cols:
                cols = dict(DEFAULT_COLUMNS)
        else:
            data_start = 0
            cols = dict(DEFAULT_COLUMNS)

        def cell_at(row, field: str) -> str:
            """按字段名取单元格文本（列位不存在时返回空串）"""
            idx = cols.get(field)
            if idx is None or idx >= len(row):
                return ""
            return cell_str(row[idx])

        words = []
        for row in rows[data_start:]:
            if not row:
                continue
            word = cell_at(row, "word")
            if not word:
                continue

            phonetic = cell_at(row, "phonetic")
            meaning = cell_at(row, "meaning")
            split_parts_raw = cell_at(row, "splitParts")
            etymology = cell_at(row, "etymology")
            rhyme = cell_at(row, "rhyme")
            quick = cell_at(row, "quick")
            family_raw = cell_at(row, "family")
            caution = cell_at(row, "caution")
            phonetic_split = cell_at(row, "phoneticSplit")
            usage = cell_at(row, "usage")

            item = {"word": word, "meaning": meaning or "（暂无释义）"}

            # 只有当存在任意助记字段时才写入 extra
            extra = {}
            if phonetic:
                extra["phonetic"] = phonetic
            if split_parts_raw:
                # 词根词缀：整段文本作为单元素数组（渲染时按文本展示）
                extra["splitParts"] = [split_parts_raw]
            if etymology:
                extra["etymology"] = etymology
            if rhyme:
                extra["rhyme"] = rhyme
            if quick:
                extra["quick"] = quick
            family = parse_family(family_raw)
            if family:
                extra["family"] = family
            if caution:
                extra["caution"] = caution
            if phonetic_split:
                extra["phoneticSplit"] = phonetic_split
            if usage:
                extra["usage"] = usage
            if extra:
                item["extra"] = extra

            words.append(item)

        if not words:
            continue

        sheets.append({
            "id": f"{args.book_id}:{sn}",
            "name": sn,
            "wordCount": len(words),
            "words": words,
        })

    book = {
        "id": args.book_id,
        "fileName": args.file_name,
        "uploadedAt": UPLOADED_AT,
        "sheets": sheets,
    }

    data_json = json.dumps(book, ensure_ascii=False, indent=2)

    content = f'''/**
 * {args.title}（固定内嵌词表）
 * 由 scripts/gen_embedded_book.py 从「{args.file_name}」生成。
 * 打包后随应用下发，任意设备打开浏览器即可看到该词表，无需用户上传。
 */
import type {{ VocabularyBook }} from '@/types';

export const {args.export_name}: VocabularyBook = {data_json} as VocabularyBook;
'''

    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(content)

    print(
        f"[{args.title}] sheets={len(sheets)} "
        f"words={sum(s['wordCount'] for s in sheets)} -> {args.out}"
    )


if __name__ == "__main__":
    main()
