/**
 * 本地存储工具：把用户上传的词表保存到浏览器的 localStorage 里
 * 这样用户即使刷新页面或关闭浏览器，再次打开时已上传的词表仍然在
 */

import type { VocabularyBook, ReadingPassage, ListeningLesson, ListeningEntry } from '@/types';

// localStorage 里存词表使用的"键名"，相当于抽屉的标签
const STORAGE_KEY = 'vocabulary_books_storage';

// localStorage 里存阅读文章（补全单词练习）的键名
const READING_PASSAGES_KEY = 'reading_passages_storage';

// localStorage 里存标星单词的键名（单词字符串 → true/false，直接存字符串集合更省空间）
const STARRED_WORDS_KEY = 'starred_words_storage';

// localStorage 里存听力精听材料的键名
const LISTENING_LESSONS_KEY = 'listening_lessons_storage';

// localStorage 里存听力精听「目录」条目的键名（网页本体存在 IndexedDB）
const LISTENING_ENTRIES_KEY = 'listening_entries_storage';

/**
 * 把当前所有的词表列表保存到浏览器本地
 * @param books 所有词表（数组）
 */
export function saveVocabularyBooks(books: VocabularyBook[]): void {
  try {
    // 把 JS 对象变成 JSON 字符串（localStorage 只能存文字）
    const json = JSON.stringify(books);
    // 写入浏览器 localStorage
    localStorage.setItem(STORAGE_KEY, json);
  } catch (e) {
    // 存失败一般是浏览器隐私模式或本地存储已满，打印错误但不报错
    console.error('保存词表失败', e);
  }
}

/**
 * 从浏览器 localStorage 读取之前保存的所有词表
 * 页面一打开时会调用这个函数，让用户看到之前上传过的词表
 * @returns 已保存的词表数组，如果以前没存过则返回空数组
 */
export function loadVocabularyBooks(): VocabularyBook[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // 没存过数据就返回空数组
    if (!raw) return [];
    // 把 JSON 字符串还原回 JS 对象
    return JSON.parse(raw) as VocabularyBook[];
  } catch (e) {
    console.error('读取词表失败', e);
    return [];
  }
}

/**
 * 清空所有已保存的词表（相当于重置）
 */
export function clearVocabularyBooks(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ============================================
// 以下是「托福阅读补全单词」模块的存储
// ============================================

/**
 * 保存所有阅读文章到 localStorage
 */
export function saveReadingPassages(passages: ReadingPassage[]): void {
  try {
    localStorage.setItem(READING_PASSAGES_KEY, JSON.stringify(passages));
  } catch (e) {
    console.error('保存阅读文章失败', e);
  }
}

/**
 * 从 localStorage 读取所有阅读文章
 */
export function loadReadingPassages(): ReadingPassage[] {
  try {
    const raw = localStorage.getItem(READING_PASSAGES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ReadingPassage[];
  } catch (e) {
    console.error('读取阅读文章失败', e);
    return [];
  }
}

/**
 * 清空所有已保存的阅读文章
 */
export function clearReadingPassages(): void {
  localStorage.removeItem(READING_PASSAGES_KEY);
}

// ============================================
// 以下是「听力精听」模块的存储
// 注意：音频文件（audioDataUrl）体积较大，存 localStorage 可能触发配额超限，
//      所以保存前会把 audioDataUrl 字段清掉（只存文本和分句结构），
//      进入听力精听页面时音频需要用户重新上传。
// ============================================

/**
 * 保存所有听力精听材料（剥离 audioDataUrl 避免 localStorage 超限）
 */
export function saveListeningLessons(lessons: ListeningLesson[]): void {
  try {
    // 保存时不存音频二进制——太大，会触发 QuotaExceededError
    const lightweight = lessons.map((l) => ({ ...l, audioDataUrl: '' }));
    localStorage.setItem(LISTENING_LESSONS_KEY, JSON.stringify(lightweight));
  } catch (e) {
    console.error('保存听力精听材料失败', e);
  }
}

/**
 * 从 localStorage 读取所有听力精听材料（注意：音频内容丢失，需要重新上传）
 */
export function loadListeningLessons(): ListeningLesson[] {
  try {
    const raw = localStorage.getItem(LISTENING_LESSONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ListeningLesson[];
  } catch (e) {
    console.error('读取听力精听材料失败', e);
    return [];
  }
}

/**
 * 清空所有听力精听材料
 */
export function clearListeningLessons(): void {
  localStorage.removeItem(LISTENING_LESSONS_KEY);
}

// ============================================
// 以下是「听力精听目录」模块的存储
//   目录条目本身很小（标题 / 链接 / 句数 / 顺序），直接存 localStorage；
//   导入的 .html 网页本体体积大（内嵌音频），由 htmlStore.ts 存到 IndexedDB。
// ============================================

/** 保存听力精听目录条目 */
export function saveListeningEntries(entries: ListeningEntry[]): void {
  try {
    localStorage.setItem(LISTENING_ENTRIES_KEY, JSON.stringify(entries));
  } catch (e) {
    console.error('保存听力目录失败', e);
  }
}

/** 读取听力精听目录条目 */
export function loadListeningEntries(): ListeningEntry[] {
  try {
    const raw = localStorage.getItem(LISTENING_ENTRIES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ListeningEntry[]) : [];
  } catch (e) {
    console.error('读取听力目录失败', e);
    return [];
  }
}

/** 清空听力精听目录条目 */
export function clearListeningEntries(): void {
  localStorage.removeItem(LISTENING_ENTRIES_KEY);
}

/**
 * 清空所有和本应用相关的 localStorage 数据
 */
export function clearAllStorage(): void {
  clearVocabularyBooks();
  clearReadingPassages();
  clearStarredWords();
  clearListeningLessons();
  clearListeningEntries();
}

// ============================================
// 以下是「标星单词」模块的存储
//   标星使用场景：识别背诵、听音辨义两个板块可以给单词打星标，
//   支持"只显示标星单词"的筛选模式，方便重点复习。
// ============================================

/**
 * 保存所有标星单词到 localStorage（使用 Set 结构：去重 + O(1) 查询）
 * @param words 标星单词数组（字符串）
 */
export function saveStarredWords(words: string[]): void {
  try {
    const unique = Array.from(new Set(words));
    localStorage.setItem(STARRED_WORDS_KEY, JSON.stringify(unique));
  } catch (e) {
    console.error('保存标星单词失败', e);
  }
}

/**
 * 从 localStorage 读取所有标星单词
 * @returns 标星单词数组（字符串），未存过返回空数组
 */
export function loadStarredWords(): string[] {
  try {
    const raw = localStorage.getItem(STARRED_WORDS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error('读取标星单词失败', e);
    return [];
  }
}

/**
 * 清空所有标星单词
 */
export function clearStarredWords(): void {
  localStorage.removeItem(STARRED_WORDS_KEY);
}
