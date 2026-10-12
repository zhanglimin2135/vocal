/**
 * 本地存储工具：把用户上传的词表保存到浏览器的 localStorage 里
 * 这样用户即使刷新页面或关闭浏览器，再次打开时已上传的词表仍然在
 */

import type { VocabularyBook, ReadingPassage } from '@/types';

// localStorage 里存词表使用的"键名"，相当于抽屉的标签
const STORAGE_KEY = 'vocabulary_books_storage';

// localStorage 里存阅读文章（补全单词练习）的键名
const READING_PASSAGES_KEY = 'reading_passages_storage';

// localStorage 里存标星单词的键名（单词字符串 → true/false，直接存字符串集合更省空间）
const STARRED_WORDS_KEY = 'starred_words_storage';

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

/**
 * 清空所有和本应用相关的 localStorage 数据
 */
export function clearAllStorage(): void {
  clearVocabularyBooks();
  clearReadingPassages();
  clearStarredWords();
}

// ============================================
// 以下是「标星单词」模块的存储
//   标星使用场景：看词说意、听音辨义两个板块可以给单词打星标，
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
