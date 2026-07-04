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
 * - 'spelling'：单词拼写（释义拼写 / 听音拼写 两种子模式，进入时弹窗选择）
 */
export type StudyMode = 'word-meaning' | 'audio-meaning' | 'spelling';

/**
 * 单词拼写的子模式：
 * - 'meaning-spelling'：释义拼写（上方显示中文释义，下方输入框给出首字母提示）
 * - 'audio-spelling'：听音拼写（输入框有任何操作即播放当前单词音频）
 */
export type SpellingSubMode = 'meaning-spelling' | 'audio-spelling';

/**
 * 学习配置：记录用户在第 2 页（选择页）选了什么
 * 选中了哪些 sheet + 选择了哪种学习模式
 * 点击"开始学习"时会把这份配置保存下来，并在第 3 页使用
 */
export interface StudyConfig {
  selectedSheetIds: string[];           // 用户勾选的所有 sheet 的 ID 列表（多选）
  mode: StudyMode;                      // 用户选择的学习模式
  spellingSubMode?: SpellingSubMode;    // 仅当 mode 为 'spelling' 时必填：拼写字模式
}

// ============================================
// 以下是「托福阅读补全单词」练习模块的类型定义
// ============================================

/**
 * 填空字符：文章中单个需要填写的字母位置
 * 相当于原文章里的一个 "_"，用户需要输入一个字母
 */
export interface BlankChar {
  id: string;              // 该空格的唯一 ID（用于 React key + 定位输入）
  wordIndex: number;       // 属于第几个带空格的单词（从 0 开始）
  charIndexInWord: number; // 在该单词内部是第几个字符（从 0 开始）
  globalIndex: number;     // 在整篇文章的"空格序号"（即第几个空，从 0 开始）
}

/**
 * 带空格的单词：文章中含有 _ 的单词
 * 例如 "qui_k" 是一个带空格的单词，里面有 1 个 BlankChar
 */
export interface BlankWord {
  id: string;                  // 该单词的唯一 ID
  wordIndex: number;           // 整篇文章中这是第几个带空格的单词（从 0 开始）
  originalMasked: string;      // 用户上传时的原文（含 _），如 "qui_k"
  correctWord: string;         // 从答案中还原的正确单词，如 "quick"
  blankChars: BlankChar[];     // 这个单词内部包含的所有待填字母位置
}

/**
 * 文章段落里的"片段"：可以是一段纯文本，也可以是一个带空格的单词
 * 用于把整篇文章拆分成 [文本, 空, 文本, 空, ...] 的交替结构来渲染
 */
export type PassageSegment =
  | { type: 'text'; content: string }
  | { type: 'blank-word'; word: BlankWord };

/**
 * 单篇阅读文章（带答案）
 * 用户上传后经过解析，变成这样的数据结构
 */
export interface ReadingPassage {
  id: string;               // 唯一 ID（上传时自动生成）
  title: string;            // 文章标题（用于匹配答案 + 目录显示）
  rawContent: string;       // 用户原始输入的文章内容（含 _）
  rawAnswer: string;        // 用户原始输入的答案内容（完整文本或按行的答案词）
  segments: PassageSegment[];  // 解析后的渲染片段列表
  blankWords: BlankWord[];  // 所有带空格的单词列表（按出现顺序）
  totalBlanks: number;      // 总共有多少个需要填的字母（_ 的个数）
  createdAt: number;        // 上传时间戳
}

/**
 * 单次答题的结果：某个空的对/错情况
 */
export interface BlankResult {
  blankCharId: string;       // 对应哪个空格 ID
  userInput: string;         // 用户填的字母（"" 表示没填）
  correctLetter: string;     // 正确字母
  isCorrect: boolean;        // 是否答对（忽略大小写比较）
}

/**
 * 单篇文章的整体答题结果
 */
export interface PassageResult {
  passageId: string;          // 对应哪篇文章
  blankResults: BlankResult[]; // 每个空格的详细对错
  correctCount: number;       // 答对的空数
  totalCount: number;         // 总空数
  accuracy: number;           // 正确率（0~1）
  submittedAt: number;        // 提交时间
}
