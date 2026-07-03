import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const xlsxPath = path.resolve(__dirname, '../public/示例词表-30词.xlsx');

const WORD_KEYWORDS = ['word','单词','英文','英语','词汇','term','english','en','vocabulary'];
const MEANING_KEYWORDS = ['meaning','释义','中文','翻译','解释','汉语','definition','def','zh','chinese','translate','translation'];

function detectColumnIndex(headers, keywords) {
  const normalized = headers.map((h) => String(h || '').trim().toLowerCase());
  for (let i = 0; i < normalized.length; i++) {
    if (keywords.some((k) => normalized[i].includes(k.toLowerCase()))) return i;
  }
  return -1;
}

function looksLikeHeader(cells) {
  if (cells.length < 2) return false;
  const [a, b] = cells.map((c) => String(c || '').trim().toLowerCase());
  if (!a || !b) return false;
  const aIsWordLabel = WORD_KEYWORDS.some((k) => a.includes(k));
  const bIsMeaningLabel = MEANING_KEYWORDS.some((k) => b.includes(k));
  if (aIsWordLabel && bIsMeaningLabel) return true;
  if (/^[\u4e00-\u9fa5a-z]{1,12}$/i.test(a) && /^[\u4e00-\u9fa5a-z]{1,12}$/i.test(b)) {
    const noSeparatorA = !/[，,；;。.\s]/.test(String(cells[0] || ''));
    const noSeparatorB = !/[，,；;。.\s]/.test(String(cells[1] || ''));
    if (noSeparatorA && noSeparatorB && a.length <= 10 && b.length <= 10) {
      const wordLike = /^[a-z]+$/i.test(a) || /^[a-z\s-]+$/i.test(a);
      const chineseLike = /^[\u4e00-\u9fa5]+$/.test(b);
      if (wordLike && chineseLike) return false;
      return !wordLike;
    }
  }
  return false;
}

const buffer = fs.readFileSync(xlsxPath);
const wb = XLSX.read(buffer, { type: 'buffer' });

let ok = true;
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headerRow = rows[0] || [];
  let wordColIdx = detectColumnIndex(headerRow, WORD_KEYWORDS);
  let meaningColIdx = detectColumnIndex(headerRow, MEANING_KEYWORDS);
  let dataStartIdx = 0;
  if (wordColIdx !== -1 && meaningColIdx !== -1) {
    dataStartIdx = 1;
  } else {
    wordColIdx = 0; meaningColIdx = 1;
    if (looksLikeHeader(headerRow)) dataStartIdx = 1;
  }
  const words = [];
  for (let i = dataStartIdx; i < rows.length; i++) {
    const row = rows[i] || [];
    const w = String(row[wordColIdx] || '').trim();
    const m = String(row[meaningColIdx] || '').trim();
    if (w) words.push({ word: w, meaning: m });
  }
  const first = words[0];
  const isFirstHeader = first && (first.word === 'English' || first.word === 'word' || first.word === '单词');
  console.log(`${name}: ${words.length} words, dataStartIdx=${dataStartIdx}, header=${JSON.stringify(headerRow)}, firstWord="${first?.word}"`);
  if (isFirstHeader || words.length !== 10) {
    console.log('  ❌ PROBLEM: header row included or count off');
    ok = false;
  } else {
    console.log('  ✅ OK');
  }
  words.slice(0, 2).forEach((w) => console.log(`     ${w.word}: ${w.meaning}`));
}
console.log(ok ? '\n✅ All sheets parsed correctly!' : '\n❌ Some issues found.');
