/**
 * 全局状态管理（Zustand）
 * 相当于一个"全局记忆盒"，所有页面共享的信息都存在这里：
 *  - 已上传的词表列表（持久化到 localStorage）
 *  - 当前正在操作的那个词表的 ID
 *  - 学习配置（选中了哪些 Sheet + 使用哪种学习模式）
 *  - 已上传的阅读文章列表（补全单词练习）
 *  - 当前正在练习的阅读文章 ID
 *
 * 任何页面用 useAppStore 都能读/改这些数据，并在修改时自动刷新页面显示。
 */

import { create } from 'zustand';
import type { VocabularyBook, StudyConfig, StudyMode, ReadingPassage } from '@/types';
// 与 localStorage 读写的工具函数
import {
  loadVocabularyBooks,
  saveVocabularyBooks,
  clearVocabularyBooks,
  loadReadingPassages,
  saveReadingPassages,
  clearReadingPassages,
  clearAllStorage,
} from '@/utils/storageUtils';

/**
 * 全局 Store 的数据结构 + 所有可调用的修改方法
 */
interface AppState {
  // ===== 词表学习模块的数据 =====
  vocabularyBooks: VocabularyBook[];   // 所有已上传过的词表
  currentBookId: string | null;        // 当前选中的词表 ID（第 2 页/第 3 页用到）
  studyConfig: StudyConfig | null;     // 第 2 页勾选的 Sheet 列表 + 学习模式

  // ===== 阅读补全单词练习模块的数据 =====
  readingPassages: ReadingPassage[];   // 所有已上传的阅读文章
  currentPassageId: string | null;     // 当前正在练习/查看的阅读文章 ID

  // ===== 标星单词模块的数据 =====
  starredWords: string[];              // 所有打了星标的单词（字符串集合，去重存储）

  // ===== 词表学习模块的操作方法 =====
  /** 新增一份词表（用户上传成功后调用，同时保存到本地） */
  addVocabularyBook: (book: VocabularyBook) => void;
  /** 删除某份词表（按 ID） */
  removeVocabularyBook: (id: string) => void;
  /** 设置"当前词表"是谁（进入第 2 页之前调用） */
  setCurrentBook: (id: string) => void;
  /** 一次性设置完整的学习配置（选中的 Sheet + 模式） */
  setStudyConfig: (config: StudyConfig) => void;
  /** 只修改学习模式，不影响已选中的 Sheet 列表 */
  setStudyMode: (mode: StudyMode) => void;
  /** 点击某个 Sheet 卡片时调用：选中则加入列表，再点一次就取消选中 */
  toggleSelectedSheetId: (sheetId: string) => void;

  // ===== 阅读补全单词练习模块的操作方法 =====
  /** 新增一篇阅读文章（同时保存到 localStorage） */
  addReadingPassage: (passage: ReadingPassage) => void;
  /** 按 ID 删除一篇阅读文章 */
  removeReadingPassage: (id: string) => void;
  /** 设置当前正在练习的文章 ID */
  setCurrentPassage: (id: string | null) => void;

  // ===== 标星单词模块的操作方法 =====
  /** 切换某个单词的标星状态（已标星则取消，未标星则添加）—— 仅在当前学习会话生效 */
  toggleStarredWord: (word: string) => void;
  /** 查询某个单词是否已标星 */
  isWordStarred: (word: string) => boolean;
  /** 重置本次学习会话的所有标星（返回选择页/离开学习页时调用） */
  resetStarredWords: () => void;
  /** 清空所有标星，等同于 resetStarredWords */
  clearAllStarred: () => void;

  // ===== 全局方法 =====
  /** 清空所有数据（词表 + 阅读 + 当前 + 学习配置）同时清空 localStorage */
  clearAll: () => void;
  /** 应用刚打开时调用：从 localStorage 读取之前保存过的词表 + 阅读文章，填回 store */
  hydrate: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // ===== 初始默认值 =====
  vocabularyBooks: [],
  currentBookId: null,
  studyConfig: null,
  readingPassages: [],
  currentPassageId: null,
  starredWords: [],

  // ===== 词表学习模块的具体实现 =====

  /**
   * 新增一份词表：把它放到数组最前面（新上传的在最上方），并立即存到 localStorage
   */
  addVocabularyBook: (book) =>
    set((state) => {
      const next = [book, ...state.vocabularyBooks];
      saveVocabularyBooks(next);
      return { vocabularyBooks: next, currentBookId: book.id };
    }),

  /**
   * 按 ID 删除一份词表；如果删的恰好是当前词表，顺便把 currentBookId 置空
   */
  removeVocabularyBook: (id) =>
    set((state) => {
      const next = state.vocabularyBooks.filter((b) => b.id !== id);
      saveVocabularyBooks(next);
      const currentBookId = state.currentBookId === id ? null : state.currentBookId;
      return { vocabularyBooks: next, currentBookId };
    }),

  setCurrentBook: (id) => set({ currentBookId: id }),

  setStudyConfig: (config) => set({ studyConfig: config }),

  setStudyMode: (mode) =>
    set((state) => {
      if (!state.studyConfig) return state;
      return { studyConfig: { ...state.studyConfig, mode } };
    }),

  toggleSelectedSheetId: (sheetId) =>
    set((state) => {
      const prev = state.studyConfig?.selectedSheetIds || [];
      const next = prev.includes(sheetId)
        ? prev.filter((x) => x !== sheetId)
        : [...prev, sheetId];
      return {
        studyConfig: state.studyConfig
          ? { ...state.studyConfig, selectedSheetIds: next }
          : { selectedSheetIds: next, mode: 'word-meaning' },
      };
    }),

  // ===== 阅读补全单词练习模块的具体实现 =====

  /**
   * 新增一篇阅读文章：插入数组最前面（最新的在最上），并保存到 localStorage
   * 同时自动把 currentPassageId 设为刚添加的这篇
   */
  addReadingPassage: (passage) =>
    set((state) => {
      const next = [passage, ...state.readingPassages];
      saveReadingPassages(next);
      return { readingPassages: next, currentPassageId: passage.id };
    }),

  /**
   * 按 ID 删除一篇阅读文章；如果正好是当前这篇，顺便把 currentPassageId 置空
   */
  removeReadingPassage: (id) =>
    set((state) => {
      const next = state.readingPassages.filter((p) => p.id !== id);
      saveReadingPassages(next);
      const currentPassageId = state.currentPassageId === id ? null : state.currentPassageId;
      return { readingPassages: next, currentPassageId };
    }),

  setCurrentPassage: (id) => set({ currentPassageId: id }),

  // ===== 标星单词模块的具体实现 =====

  /**
   * 切换某个单词的标星状态（仅内存，不持久化 —— 离开学习页就清空）
   * - 若已标星 → 移除；未标星 → 添加
   */
  toggleStarredWord: (word) =>
    set((state) => {
      const prev = state.starredWords;
      const has = prev.includes(word);
      const next = has ? prev.filter((w) => w !== word) : [...prev, word];
      return { starredWords: next };
    }),

  /**
   * 查询某个单词是否已标星（用数组 includes，数据量小足够高效）
   */
  isWordStarred: (word) => get().starredWords.includes(word),

  /**
   * 重置本次学习会话的所有标星
   * （进入学习页时保证为空、返回选择页/离开学习页时调用）
   */
  resetStarredWords: () => set({ starredWords: [] }),

  /**
   * 清空所有标星 —— 等同于 resetStarredWords（保持 API 兼容）
   */
  clearAllStarred: () => set({ starredWords: [] }),

  // ===== 全局方法 =====

  clearAll: () => {
    clearAllStorage();
    set({
      vocabularyBooks: [],
      currentBookId: null,
      studyConfig: null,
      readingPassages: [],
      currentPassageId: null,
      starredWords: [],
    });
  },

  /**
   * 应用启动时调用：从浏览器 localStorage 填回词表 + 阅读文章
   * ⚠️ 注意：标星单词是会话级别的，不从 localStorage 恢复（每次进入学习页都是全新的空状态）
   */
  hydrate: () => {
    const loadedBooks = loadVocabularyBooks();
    const loadedPassages = loadReadingPassages();
    set({
      vocabularyBooks: loadedBooks,
      currentBookId: loadedBooks[0]?.id || null,
      readingPassages: loadedPassages,
      currentPassageId: loadedPassages[0]?.id || null,
      starredWords: [],
    });
  },
}));
