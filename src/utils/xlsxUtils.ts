/**
 * Excel 解析工具：把用户上传的 .xlsx/.xls 文件解析成系统内部使用的"词表"结构
 *
 * 支持的 Excel 格式（非常灵活）：
 *  - 第 1 列是单词，第 2 列是中文释义（默认约定）
 *  - 如果第一行是表头，会自动识别这些关键字跳过头：
 *      Word列关键词：word、单词、英文、英语、词汇、term、english、en、vocabulary
 *      释义列关键词：meaning、释义、中文、翻译、解释、汉语、definition、chinese 等
 */

import type { WordItem, SheetData, VocabularyBook } from '@/types';
import * as XLSX from 'xlsx';

/**
 * 判断某一行（表头行）哪一列是"单词列"、哪一列是"释义列"
 * 遍历表头每一个单元格，匹配上面写的关键词，命中则返回该列索引（0表示第一列）
 * 找不到返回 -1
 */
function detectColumnIndex(headers: string[], keywords: string[]): number {
  // 把所有表头统一转成小写、去掉前后空格，方便匹配
  const normalized = headers.map((h) => String(h || '').trim().toLowerCase());
  for (let i = 0; i < normalized.length; i++) {
    const header = normalized[i];
    // 只要这个表头里包含了任意一个关键词，就认为这是目标列
    if (keywords.some((k) => header.includes(k.toLowerCase()))) return i;
  }
  return -1;
}

// 单词列关键词（大小写不敏感，匹配只要包含即可）
const WORD_KEYWORDS = [
  'word',
  '单词',
  '英文',
  '英语',
  '词汇',
  'term',
  'english',
  'en',
  'vocabulary',
];

// 释义列关键词
const MEANING_KEYWORDS = [
  'meaning',
  '释义',
  '中文',
  '翻译',
  '解释',
  '汉语',
  'definition',
  'def',
  'zh',
  'chinese',
  'translate',
  'translation',
];

/**
 * 当 detectColumnIndex 没匹配到任何关键词时，做一层"启发式判断"：
 *  - 这行看起来是不是像"表头"？如果像就跳过，把它当表头行
 *  - 比如 ["English","中文"] 这种肯定是表头，不是真正的单词数据
 */
function looksLikeHeader(cells: string[]): boolean {
  if (cells.length < 2) return false;
  const [a, b] = cells.map((c) => String(c || '').trim().toLowerCase());
  if (!a || !b) return false;

  // 如果两列的关键词都命中，肯定是表头
  const aIsWordLabel = WORD_KEYWORDS.some((k) => a.includes(k));
  const bIsMeaningLabel = MEANING_KEYWORDS.some((k) => b.includes(k));
  if (aIsWordLabel && bIsMeaningLabel) return true;

  // 再做一层：短文本 + 不含标点分隔符 + 不像"英文单词 + 中文释义"组合 → 当作表头
  if (/^[\u4e00-\u9fa5a-z]{1,12}$/i.test(a) && /^[\u4e00-\u9fa5a-z]{1,12}$/i.test(b)) {
    const noSeparatorA = !/[，,；;。.\s]/.test(String(cells[0] || ''));
    const noSeparatorB = !/[，,；;。.\s]/.test(String(cells[1] || ''));
    if (noSeparatorA && noSeparatorB && a.length <= 10 && b.length <= 10) {
      // 看起来像"英文单词 + 中文"（就是正常数据）→ 不是表头
      const wordLike = /^[a-z]+$/i.test(a) || /^[a-z\s-]+$/i.test(a);
      const chineseLike = /^[\u4e00-\u9fa5]+$/.test(b);
      if (wordLike && chineseLike) return false;
      return !wordLike;
    }
  }
  return false;
}

/**
 * 解析单个 Sheet 里的所有单词，返回 WordItem 数组
 */
function parseSheetWords(ws: XLSX.WorkSheet, sheetName: string): WordItem[] {
  // header: 1 → 解析成二维数组 [[第1行],[第2行],...]
  // defval: '' → 空单元格默认填空字符串
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
  if (!rows || rows.length === 0) return [];

  const headerRow = rows[0] || [];
  // 先尝试用关键词匹配确定两列索引
  let wordColIdx = detectColumnIndex(headerRow, WORD_KEYWORDS);
  let meaningColIdx = detectColumnIndex(headerRow, MEANING_KEYWORDS);
  let dataStartIdx = 0; // 从第几行开始是真正的单词数据

  if (wordColIdx !== -1 && meaningColIdx !== -1) {
    // 两列都匹配到关键词 → 第 1 行是表头，数据从第 2 行（下标 1）开始
    dataStartIdx = 1;
  } else {
    // 关键词没全部命中 → 用默认约定：第 1 列=单词，第 2 列=释义
    wordColIdx = 0;
    meaningColIdx = 1;
    // 再启发式判断下第一行是不是表头，是就从下一行开始读数据
    if (looksLikeHeader(headerRow)) {
      dataStartIdx = 1;
    }
  }

  // 遍历所有数据行，汇总为 WordItem
  const words: WordItem[] = [];
  for (let i = dataStartIdx; i < rows.length; i++) {
    const row = rows[i] || [];
    const rawWord = String(row[wordColIdx] || '').trim();
    const rawMeaning = String(row[meaningColIdx] || '').trim();
    // 没单词的空行直接跳过
    if (!rawWord) continue;
    words.push({
      word: rawWord,
      // 没释义就写个占位，免得显示空
      meaning: rawMeaning || '（暂无释义）',
    });
  }

  return words;
}

/**
 * 生成一个在系统内部使用的唯一 ID（每次导入/生成 Sheet 时用）
 * 用 "当前时间转36进制 + 随机片段" 保证几乎不会重复
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 对外暴露的主函数：把用户选择的 Excel File 对象 → VocabularyBook
 * 整个过程是异步的（读文件、解析），所以用 async/await
 */
export async function parseExcelFile(file: File): Promise<VocabularyBook> {
  // 把浏览器选中的文件读成二进制 array buffer
  const buffer = await file.arrayBuffer();
  // 用 xlsx 库解析整个工作簿
  const wb = XLSX.read(buffer, { type: 'array' });

  // 遍历 Excel 里的每一个 Sheet，统一包装成我们自己的 SheetData 结构
  const sheets: SheetData[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const words = parseSheetWords(ws, name);
    return {
      id: generateId(),         // 给 sheet 生成唯一 ID
      name,                     // sheet 原名（Excel 底部显示的那个）
      wordCount: words.length,  // 单词数 = 解析出的条目
      words,                    // 单词列表本身
    };
  });

  // 返回整份词表
  return {
    id: generateId(),     // 整份 Excel 也有唯一 ID
    fileName: file.name,  // 原始文件名
    uploadedAt: Date.now(), // 上传时的毫秒时间戳
    sheets,
  };
}
