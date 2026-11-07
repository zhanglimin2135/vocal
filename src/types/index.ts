/**
 * 单个单词条目：一个英语单词+其中文释义
 * 这是整个应用的最小数据单元，每个sheet里有很多这样的条目
 */
export interface WordItem {
  word: string;       // 英文单词本身，如 "apple"
  meaning: string;    // 中文释义，如 "苹果；苹果树"
  phonetic?: string;  // 可选：音标，如 /ˈæpəl/（目前支持选填）
  /** 可选：该词的助记信息（词根拆分/词源/口诀/速记/同族词/易错）。
   *  若导入的表格含有对应列，解析时会写入这里；背诵页的助记卡片会优先使用它。 */
  extra?: WordMnemonic;
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
 * WordMnemonic - 单词助记信息（固定词表入口会附带，用于背诵页的「助记」弹窗）
 *   - splitParts: 词素拆分（奇数下标为词根、偶数下标为说明，与词表原始结构一致）
 *   - etymology:  词源说明
 *   - rhyme:      口诀
 *   - quick:      速记
 *   - family:     同族词
 *   - caution:    易错提示
 *   - accent/tint: 该词的主题色与浅底色
 */
export interface WordMnemonic {
  splitParts?: string[];
  etymology?: string;
  rhyme?: string;
  quick?: string;
  family?: string[];
  caution?: string;
  phonetic?: string;
  accent?: string;
  tint?: string;
}

/**
 * StudyWord - 学习态单词对象类型
 *   在原始 WordItem 的基础上额外附带：
 *   - uid: 每个单词在当前学习会话中的唯一标识（用于独立控制单卡展开/发音状态）
 *   - sheetName: 该单词所属单词表的名称（卡片顶部显示）
 *   - extra: 可选扩展字段（固定词表入口会附带词源、拆分、口诀等）
 */
export interface StudyWord extends WordItem {
  uid: string;
  sheetName: string;
  extra?: WordMnemonic;
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
 * - 'word-meaning'：看词/看意 双向练习（识别背诵 / 释义识别 两种子模式，进入时弹窗选择）
 * - 'audio-meaning'：听音辨义（显示喇叭播放发音，隐藏单词和释义）
 * - 'spelling'：单词拼写（释义拼写 / 单词拼写 两种子模式，进入时弹窗选择）
 */
export type StudyMode = 'word-meaning' | 'audio-meaning' | 'spelling';

/**
 * 看词/看意 子模式：
 * - 'word-meaning'：识别背诵（上方显示英文单词，隐藏中文释义，点击查看）
 * - 'meaning-word'：释义识别（上方显示中文释义，隐藏英文单词，点击查看，形式同识别背诵）
 */
export type LookSubMode = 'word-meaning' | 'meaning-word';

/**
 * 单词拼写的子模式：
 * - 'meaning-spelling'：释义拼写（上方显示中文释义，下方输入框给出首字母提示）
 * - 'audio-spelling'：单词拼写（输入框有任何操作即播放当前单词音频）
 */
export type SpellingSubMode = 'meaning-spelling' | 'audio-spelling';

/**
 * 单词拼写的范围模式（选择单元后、点击"开始拼写"时弹出选择）：
 * - 'all'：整体拼写（选中单元的全部单词，随机乱序检查）
 * - 'random'：随机抽测（全部单词乱序后随机抽取指定数量，数量由用户输入，
 *              最少 5 个，最多不超过所选单元的单词总数）
 */
export type SpellingFlow = 'all' | 'random';

/**
 * 学习配置：记录用户在第 2 页（选择页）选了什么
 * 选中了哪些 sheet + 选择了哪种学习模式
 * 点击"开始学习"时会把这份配置保存下来，并在第 3 页使用
 */
export interface StudyConfig {
  selectedSheetIds: string[];           // 用户勾选的所有 sheet 的 ID 列表（多选）
  mode: StudyMode;                      // 用户选择的学习模式
  lookSubMode?: LookSubMode;            // 仅当 mode 为 'word-meaning' 时必填：看词/看意子模式
  spellingSubMode?: SpellingSubMode;    // 仅当 mode 为 'spelling' 时必填：拼写字模式
  spellingFlow?: SpellingFlow;          // 仅当 mode 为 'spelling' 时必填：整体拼写 / 随机抽测
  spellingQuizCount?: number;           // 仅当 spellingFlow 为 'random' 时必填：抽测的单词数量
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

// ============================================
// 以下是「听力精听」模块的类型定义
// ============================================

/**
 * 单个分句：由逗号拆分或用户在波形图上手动添加断句点形成
 * - startTime / endTime：该分句在音频中的起止时间（秒）
 *   默认情况下时间会被平均分；用户在波形图上添加断句点后会被精确调整
 * - text：该分句的原始文本
 * - translation：用户填写的中文翻译（可为空，后续手动补充）
 */
export interface SentenceSegment {
  id: string;              // 分句唯一 ID
  text: string;            // 分句原文（去掉了逗号本身，逗号是拆分标记）
  translation: string;     // 用户填写的翻译（可为空字符串）
  startTime: number;       // 音频起始时间（秒）
  endTime: number;         // 音频结束时间（秒）
}

/**
 * 单份听力精听材料（一篇练习）
 */
export interface ListeningLesson {
  id: string;                    // 唯一 ID
  title: string;                 // 材料标题（用户可自定义，默认用音频文件名）
  audioName: string;             // 原始音频文件名
  audioDataUrl: string;          // 音频内容（DataURL，持久化用；不持久化则用 Blob URL）
  textContent: string;           // 原始文本（未拆分）
  segments: SentenceSegment[];   // 按逗号拆分后 + 用户手动调整的分句列表
  createdAt: number;             // 导入时间戳
}

/**
 * 听力精听「目录」条目（首页 → 听力精听 → 目录页）
 *   kind = 'link'：用户粘贴的分享链接，点击在新标签页打开外部播放页
 *   kind = 'html'：用户导入的「下载网页」.html 文件，解析出句数与时长，
 *                  原文件存在 IndexedDB（htmlKey），点击时用 Blob URL 打开
 */
export interface ListeningEntry {
  id: string;              // 唯一 ID
  title: string;           // 目录卡片标题
  kind: 'link' | 'html';   // 条目类型：外链 / 本地网页文件
  url?: string;            // kind=link 时的分享链接
  htmlKey?: string;        // kind=html 时 IndexedDB 中的键
  lineCount?: number;      // 句数（kind=html 解析得出）
  duration?: number;       // 音频时长（秒，kind=html 解析得出）
  createdAt: number;       // 导入时间戳
  order: number;           // 手动拖拽排序的位置索引
}
