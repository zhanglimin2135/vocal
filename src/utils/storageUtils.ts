/**
 * 本地存储工具：把用户上传的词表保存到浏览器的 localStorage 里
 * 这样用户即使刷新页面或关闭浏览器，再次打开时已上传的词表仍然在
 */

import type { VocabularyBook } from '@/types';

// localStorage 里存词表使用的"键名"，相当于抽屉的标签
const STORAGE_KEY = 'vocabulary_books_storage';

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
