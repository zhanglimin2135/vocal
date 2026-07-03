/**
 * 单个单词条目：一个英语单词+其中文释义
 * 这是整个应用的最小数据单元，每个sheet里有很多这样的条目
 */
export interface WordItem {
  word: string;       // 英文单词本身，如 "apple"
  meaning: string;    // 中文释义，如 "苹果；苹果树"
  phonetic?: string;  // 可选：音标，如 /ˈæpəl/（目前支持选填）
}

/**
 * Sheet 数据：一个 Excel 里的单个工作表（如 "Unit 1"）
 * 每个 sheet 会有自己的名字、单词数量、以及解析出来的所有单词列表
 */
export interface SheetData {
  id: string;          // 这个 sheet 在系统内部的唯一 ID（每次上传自动生成）
  name: string;        // Sheet 名字，就是 Excel 底部的工作表名，如 "Unit 1"
  wordCount: number;   // 这个 sheet 里一共有多少个单词
  words: WordItem[];   // 这个 sheet 里所有的单词条目（数组）
}

/**
 * 词表（一个上传的 Excel 文件整体）
 * 代表用户上传的一份 .xlsx/.xls 文件，里面可能包含多个 sheet
 */
export interface VocabularyBook {
  id: string;          // 这份词表在系统内部的唯一 ID（每次上传自动生成）
  fileName: string;    // 上传时的原始文件名，如 "我的四级单词.xlsx"
  uploadedAt: number;  // 上传时间戳（毫秒数，1970年至今的毫秒），用于显示"上传于..."
  sheets: SheetData[]; // 这份文件里解析出的所有 sheet 列表
}

/**
 * 学习模式的枚举类型：
 * - 'word-meaning'：看词说意（显示单词，隐藏中文释义）
 * - 'audio-meaning'：听音辨义（显示喇叭播放发音，隐藏单词和释义）
 */
export type StudyMode = 'word-meaning' | 'audio-meaning';

/**
 * 学习配置：记录用户在第 2 页（选择页）选了什么
 * 选中了哪些 sheet + 选择了哪种学习模式
 * 点击"开始学习"时会把这份配置保存下来，并在第 3 页使用
 */
export interface StudyConfig {
  selectedSheetIds: string[];  // 用户勾选的所有 sheet 的 ID 列表（多选）
  mode: StudyMode;             // 用户选择的学习模式（上面定义的两种二选一）
}
