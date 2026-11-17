/**
 * 生词整理的数据存储（localStorage）
 * 结构：
 *   CollectionUnit { id, name, createdAt, words: WordEntry[] }
 *   WordEntry { word, uk, us, ukPhonetic, usPhonetic, meaning, pos }
 * 上限：500 词（所有单元合计）
 */

import type { LookupResult } from './wordLookup';

export interface WordEntry {
  word: string;
  uk: string;
  us: string;
  ukPhonetic: string;
  usPhonetic: string;
  meaning: string;
  pos: string;
}

export interface CollectionUnit {
  id: string;
  name: string;
  createdAt: number;
  words: WordEntry[];
}

const STORAGE_KEY = 'vocal_collection_v1';
export const COLLECTION_LIMIT = 500;

function uid(): string {
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function loadUnits(): CollectionUnit[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveUnits(units: CollectionUnit[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(units));
  } catch { /* ignore quota */ }
}

export function totalWordCount(units: CollectionUnit[]): number {
  return units.reduce((s, u) => s + u.words.length, 0);
}

/**
 * 追加到上一单元或新建单元；若超限则自动截断并返回 overflow=true
 */
export function appendOrCreate(
  units: CollectionUnit[],
  words: LookupResult[],
  opts: {
    mode: 'append' | 'new';
    nameHint?: string; // 新单元时的手动命名（可含「真题* / 或其他出处」）
  },
): { next: CollectionUnit[]; added: number; overflow: boolean; atLimit: boolean } {
  const cleaned: WordEntry[] = words
    .map((w) => ({
      word: w.word,
      uk: w.uk,
      us: w.us,
      ukPhonetic: w.ukPhonetic,
      usPhonetic: w.usPhonetic,
      meaning: w.meaning,
      pos: w.pos,
    }))
    // 单元内去重
    .filter((w, i, arr) => arr.findIndex((x) => x.word.toLowerCase() === w.word.toLowerCase()) === i);

  const current = totalWordCount(units);
  const room = Math.max(0, COLLECTION_LIMIT - current);
  const take = cleaned.slice(0, room);
  const overflow = take.length < cleaned.length;
  const atLimit = current + take.length >= COLLECTION_LIMIT;

  let next = [...units];
  if (opts.mode === 'append' && next.length > 0) {
    // 追加到最上面的单元（最近一次新建的）；注意用户说的「上一单元」就是「上一次添加的」
    // 因为每次新建单元都 unshift 到最前，所以 units[0] 就是上一次的
    const top = next[0];
    const seen = new Set(top.words.map((w) => w.word.toLowerCase()));
    const fresh = take.filter((w) => !seen.has(w.word.toLowerCase()));
    next[0] = { ...top, words: [...top.words, ...fresh] };
  } else {
    const base = (opts.nameHint || '').trim() || '生词';
    const stamp = formatTimestamp(Date.now());
    const name = `${base} · ${stamp}`;
    next = [{ id: uid(), name, createdAt: Date.now(), words: take }, ...next];
  }
  return { next, added: take.length, overflow, atLimit };
}

/** 按单元顺序（新→旧）把所有单元导出为单个 WordBook 对象，供 StudyPage 使用 */
export function toStudyBook(units: CollectionUnit[]) {
  const sheets = units.map((u) => ({
    id: u.id,
    name: u.name,
    wordCount: u.words.length,
    rows: u.words.map((w) => ({
      word: w.word,
      phonetic: w.usPhonetic || w.ukPhonetic,
      meaning: w.pos ? `${w.pos} ${w.meaning}` : w.meaning,
    })),
  }));
  return {
    id: 'built-in-collection',
    name: '我的生词整理',
    sheets,
  };
}

/** 格式化 2026-11-17 14:32 */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
