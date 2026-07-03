/**
 * 全局状态管理（Zustand）
 * 相当于一个"全局记忆盒"，所有页面共享的信息都存在这里：
 *  - 已上传的词表列表（持久化到 localStorage）
 *  - 当前正在操作的那个词表的 ID
 *  - 学习配置（选中了哪些 Sheet + 使用哪种学习模式）
 *
 * 任何页面用 useAppStore 都能读/改这些数据，并在修改时自动刷新页面显示。
 */

import { create } from 'zustand';
import type { VocabularyBook, StudyConfig, StudyMode } from '@/types';
// 与 localStorage 读写的工具函数
import {
  loadVocabularyBooks,
  saveVocabularyBooks,
  clearVocabularyBooks,
} from '@/utils/storageUtils';

/**
 * 全局 Store 的数据结构 + 所有可调用的修改方法
 */
interface AppState {
  // ===== 数据（读取：const books = useAppStore(s => s.vocabularyBooks)） =====
  vocabularyBooks: VocabularyBook[];   // 所有已上传过的词表
  currentBookId: string | null;        // 当前选中的词表 ID（第 2 页/第 3 页用到）
  studyConfig: StudyConfig | null;     // 第 2 页勾选的 Sheet 列表 + 学习模式

  // ===== 操作方法（修改数据） =====
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
  /** 清空所有数据（词表 + 当前 + 学习配置）同时清空 localStorage */
  clearAll: () => void;
  /** 应用刚打开时调用：从 localStorage 读取之前保存过的词表，填回 store */
  hydrate: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // ===== 初始默认值 =====
  vocabularyBooks: [],   // 还没 hydrate 之前就是空数组
  currentBookId: null,
  studyConfig: null,

  // ===== 具体实现 =====

  /**
   * 新增一份词表：把它放到数组最前面（新上传的在最上方），并立即存到 localStorage
   */
  addVocabularyBook: (book) =>
    set((state) => {
      const next = [book, ...state.vocabularyBooks];
      saveVocabularyBooks(next);
      // 同时把"当前词表"自动设置成刚上传的这份，用户体验更顺
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

  /** 设置当前选中的词表（通常在点卡片"进入选择"时调用） */
  setCurrentBook: (id) => set({ currentBookId: id }),

  /** 一次性设置整个学习配置（Sheet 列表 + 模式） */
  setStudyConfig: (config) => set({ studyConfig: config }),

  /**
   * 只改学习模式；前提是 studyConfig 必须已经存在（否则忽略）
   */
  setStudyMode: (mode) =>
    set((state) => {
      if (!state.studyConfig) return state;
      return { studyConfig: { ...state.studyConfig, mode } };
    }),

  /**
   * 勾选 / 取消勾选某个 Sheet：
   *  - 如果 ID 已在列表里 → 移除（取消选中）
   *  - 否则 → 加进去
   * 若还没有 studyConfig，则顺便创建一个 mode 默认是 'word-meaning' 的配置
   */
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

  /** 清空所有：内存 + localStorage 一起清 */
  clearAll: () => {
    clearVocabularyBooks();
    set({ vocabularyBooks: [], currentBookId: null, studyConfig: null });
  },

  /** 应用启动时调用：从浏览器 localStorage 填回词表数据 */
  hydrate: () => {
    const loaded = loadVocabularyBooks();
    if (loaded.length > 0) {
      set({
        vocabularyBooks: loaded,
        // 如果有历史词表，默认把"当前词表"设为最近上传的那个（也就是第一个）
        currentBookId: loaded[0]?.id || null,
      });
    }
  },
}));
