/**
 * StudyPage - 学习页（第三页）
 *
 * 页面用途：
 *   根据用户在选择页（/select）选定的词书和单词表，进入学习模式进行单词记忆练习。
 *
 * 两种学习模式（由 studyConfig.mode 决定）：
 *   1. 看词说意（word-meaning）：卡片正面显示单词（可点击发音），释义默认隐藏，
 *      用户先尝试回忆释义，再点击卡片或"显示释义"查看答案。
 *   2. 听音辨义（meaning-word）：卡片正面只显示一个大号发音按钮，
 *      用户先听发音尝试回想单词和释义，再点击卡片显示单词 + 释义。
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Volume2,
  Eye,
  EyeOff,
  Shuffle,
  BookOpen,
  Headphones,
  Sparkles,
  PencilLine,
  Check,
  X,
  Trophy,
  Star,
  MessageSquareText,
  Send,
  Camera,
  CheckCircle,
  Download,
  Timer,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { playWordAudio } from '@/utils/audioUtils';
import type { WordItem, StudyMode, LookSubMode, SpellingSubMode } from '@/types';
import { cn, generateId, canUseForcedFullscreen } from '@/lib/utils';
import * as XLSX from 'xlsx';

/**
 * StudyWord - 学习态单词对象类型
 *   在原始 WordItem 的基础上额外附带：
 *   - uid: 每个单词在当前学习会话中的唯一标识（用于独立控制单卡展开/发音状态）
 *   - sheetName: 该单词所属单词表的名称（卡片顶部显示）
 */
interface StudyWord extends WordItem {
  uid: string;
  sheetName: string;
}

/**
 * shuffleArray - Fisher-Yates 洗牌算法（通用泛型版本）
 *   作用：将传入数组的元素顺序随机打乱，返回一个新数组（不修改原数组）
 *   实现要点：
 *     1. 拷贝原数组避免副作用；
 *     2. 从末尾向前遍历，每轮在 [0, i] 区间内取一个随机下标 j；
 *     3. 交换 a[i] 与 a[j]，最终得到等概率的随机排列。
 */
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 拼写输入允许的字符集合：英文字母、空格及常见半角标点符号
 *   - 用于过滤掉中文及全角字符，但保留空格 / 标点让用户可以输入
 *   - 空格与标点仅作为可见输入内容，核对时由 normalizeSpelling 忽略，不影响判断
 */
const SPELLING_ALLOWED_CHARS = "a-zA-Z \\-'.,!?;:()\\[\\]{}\"/\\\\@#&*+=_~`^%$";
// 匹配「不在允许集合内」的字符，用于清洗输入（全局替换）
const SPELLING_DISALLOWED_RE = new RegExp(`[^${SPELLING_ALLOWED_CHARS}]`, 'g');

export default function StudyPage() {
  // =========================
  // 路由与全局状态读取
  // =========================
  const navigate = useNavigate();
  // 全部词书列表（来自全局 store）
  const vocabularyBooks = useAppStore((s) => s.vocabularyBooks);
  // 当前选中词书的 id
  const currentBookId = useAppStore((s) => s.currentBookId);
  // 学习配置：包含学习模式 + 选中的单词表 id 列表
  const studyConfig = useAppStore((s) => s.studyConfig);
  // ===== 标星模块：全局状态 =====
  // 切换某个单词标星状态的方法
  const toggleStarredWord = useAppStore((s) => s.toggleStarredWord);
  // 标星单词列表（响应式，用于触发组件重渲染）
  const starredWords = useAppStore((s) => s.starredWords);
  // 清空本次学习会话所有标星的方法（返回选择页/离开学习页时调用）
  const resetStarredWords = useAppStore((s) => s.resetStarredWords);

  // 当前学习模式：默认看词说意
  const mode: StudyMode = studyConfig?.mode || 'word-meaning';
  // 用户勾选的单词表 id 列表
  const selectedSheetIds = studyConfig?.selectedSheetIds || [];
  // 看词/看意 子模式：仅当 mode==='word-meaning' 时有值（看词识意 / 看意说词）
  const lookSubMode: LookSubMode = studyConfig?.lookSubMode || 'word-meaning';
  // 单词拼写子模式：仅当 mode==='spelling' 时有值（释义拼写 / 听音拼写）
  const spellingSubMode: SpellingSubMode | undefined = studyConfig?.spellingSubMode;

  // =========================
  // 派生数据：用 useMemo 避免重复计算
  // =========================

  // 根据 currentBookId 找到对应的词书对象
  const currentBook = useMemo(
    () => vocabularyBooks.find((b) => b.id === currentBookId) || null,
    [vocabularyBooks, currentBookId]
  );

  // 从当前词书中按 selectedSheetIds 筛选出所有单词，
  // 扁平化为 StudyWord[] 数组（每个单词附加 uid + sheetName）
  const baseWords = useMemo<StudyWord[]>(() => {
    if (!currentBook) return [];
    const selectedSheets = currentBook.sheets.filter((sh) =>
      selectedSheetIds.includes(sh.id)
    );
    const result: StudyWord[] = [];
    for (const sh of selectedSheets) {
      for (const w of sh.words) {
        result.push({
          ...w,
          uid: generateId(),   // 为每个单词生成会话内唯一 id
          sheetName: sh.name,  // 记录来自哪个单词表
        });
      }
    }
    return result;
  }, [currentBook, selectedSheetIds]);

  // 选中的单词表名称（去重，结果页"检查内容"展示用）
  const selectedSheetNames = useMemo<string[]>(() => {
    const set = new Set<string>();
    baseWords.forEach((w) => set.add(w.sheetName));
    return Array.from(set);
  }, [baseWords]);

  // =========================
  // 组件内部状态（useState）
  // =========================

  /**
   * words - 当前渲染的单词列表（可被乱序）
   *   初始值来自 baseWords；点击"乱序"按钮会使用 shuffleArray 重新排序。
   */
  const [words, setWords] = useState<StudyWord[]>([]);

  /**
   * revealedMap - 每张卡片的"释义是否已展开"状态映射表
   *   结构：{ [uid: string]: boolean }
   *   - key:   StudyWord.uid
   *   - value: true 表示已展开释义，false/不存在表示未展开
   */
  const [revealedMap, setRevealedMap] = useState<Record<string, boolean>>({});

  /**
   * allRevealed - "一键显示/隐藏所有释义"按钮的总开关
   *   true  表示当前所有卡片都处于展开状态（再次点击则一键收起）
   *   false 表示当前按单卡各自状态控制（再次点击则一键全部展开）
   */
  const [allRevealed, setAllRevealed] = useState(false);

  /**
   * playingUid - 当前正在播放发音的单词 uid
   *   - 有值时：对应卡片上的发音按钮高亮并显示脉冲动画
   *   - null 时：无发音播放
   *   作用：避免重复触发发音 + 提供视觉反馈
   */
  const [playingUid, setPlayingUid] = useState<string | null>(null);

  // ===== 标星模块：本地 UI 状态 =====
  /**
   * showStarredOnly - 是否只显示已标星的单词（筛选开关）
   *   - true：只渲染被打星标的单词卡片；
   *   - false：渲染全部单词（默认行为）。
   *   仅在「看词说意」和「听音辨义」两种非拼写模式下生效。
   */
  const [showStarredOnly, setShowStarredOnly] = useState(false);

  /**
   * exportModalOpen - 「导出标星单词」弹窗的开关
   *   - true：显示导出弹窗（表格展示所有标星单词 + 下载按钮）
   *   - false：隐藏弹窗
   */
  const [exportModalOpen, setExportModalOpen] = useState(false);

  // ===== 标星模块：派生数据 =====
  /**
   * displayWords - 最终要渲染的单词列表
   *   仅在非拼写模式下根据 showStarredOnly 开关进行筛选：
   *   - showStarredOnly = true  → 只保留已标星单词（通过 starredWords 判断）
   *   - showStarredOnly = false → 保持 words 原样
   *   拼写模式下不筛选，直接返回 words。
   */
  const displayWords = useMemo<StudyWord[]>(() => {
    if (mode === 'spelling') return words;
    if (!showStarredOnly) return words;
    return words.filter((w) => starredWords.includes(w.word));
  }, [words, showStarredOnly, mode, starredWords]);

  /**
   * starredWordItems - 当前学习会话中已标星的单词对象列表（含 word + meaning）
   *   用于「导出标星单词」弹窗展示，以及导出 Excel 文件。
   *   只取本次学习词表中存在的标星词，保证释义能查到。
   */
  const starredWordItems = useMemo<StudyWord[]>(() => {
    return words.filter((w) => starredWords.includes(w.word));
  }, [words, starredWords]);

  // ===== 计时背诵模块：本地 UI 状态 =====
  /**
   * recitePickerOpen - 「计时背诵」时间选择浮层的开关
   *   - true：显示时间选项浮层（5 / 7 / 10 / 15 秒）
   *   - false：隐藏浮层
   *   仅在「看词说意」和「听音辨义」两种非拼写模式下使用
   */
  const [recitePickerOpen, setRecitePickerOpen] = useState(false);

  /**
   * reciteActive - 是否正在计时背诵中（弹窗已弹出，背景虚化）
   *   - true：显示背诵弹窗，每词独立倒计时
   *   - false：不显示弹窗
   */
  const [reciteActive, setReciteActive] = useState(false);

  /**
   * reciteSeconds - 每个单词的倒计时秒数（用户从 5 / 7 / 10 / 15 中选择）
   */
  const [reciteSeconds, setReciteSeconds] = useState(5);

  /**
   * reciteIndex - 计时背诵当前做到第几个单词（words 数组下标）
   */
  const [reciteIndex, setReciteIndex] = useState(0);

  /**
   * reciteRemaining - 当前单词的剩余秒数（实时递减，弹窗倒计时显示用）
   */
  const [reciteRemaining, setReciteRemaining] = useState(0);

  /**
   * reciteRevealed - 当前单词的释义/单词是否已展开
   *   - false：隐藏释义（或单词），只显示正面内容
   *   - true：已点击展开，显示完整内容
   *   切换到新单词时自动重置为 false（见下方 useEffect）
   */
  const [reciteRevealed, setReciteRevealed] = useState(false);

  /**
   * reciteKeyPressed - 快捷键触发的按钮按压状态（用于显示按键反馈）
   *   - 'remember'：刚按了 ↑ 键，记住按钮显示按压效果
   *   - 'mark'：刚按了 ↓ 键，标星按钮显示按压效果
   *   - null：无按压
   *   按下后 150ms 自动清除
   */
  const [reciteKeyPressed, setReciteKeyPressed] = useState<'remember' | 'mark' | null>(null);

  // =========================
  // 【单词拼写模式】专属状态
  // =========================

  /**
   * spellingIndex - 拼写模式当前做到第几个单词（words 数组下标）
   *   拼写模式是按顺序一个一个单词过，不像其他模式是平铺卡片
   */
  const [spellingIndex, setSpellingIndex] = useState(0);

  /**
   * answers - 每个单词的用户输入答案（数组，索引对应单词索引）
   */
  const [answers, setAnswers] = useState<string[]>([]);

  /**
   * locked - 每个单词是否已锁定（锁定后不可修改）
   */
  const [locked, setLocked] = useState<boolean[]>([]);

  /**
   * results - 每个单词的提交结果（null=未提交，true=正确，false=错误）
   */
  const [results, setResults] = useState<(boolean | null)[]>([]);

  /**
   * chineseInputFlags - 每个单词是否曾在「中文输入法」下输入过（数组）
   *   - 只要该单词的输入框触发过 IME 合成（compositionend），即标记为 true
   *   - 被标记的单词在核对时一律判定为错误，即使拼写内容正确
   */
  const [chineseInputFlags, setChineseInputFlags] = useState<boolean[]>([]);

  /**
   * perWordTimers - 每个单词的剩余秒数（数组）
   */
  const [perWordTimers, setPerWordTimers] = useState<number[]>([]);
  const PER_WORD_SECONDS = 15;

  /**
   * totalElapsedMs - 拼写模式整体累计用时（毫秒）
   *   从进入第一个单词就开始计时，桌面始终显示，不会随页面滚动消失
   */
  const [totalElapsedMs, setTotalElapsedMs] = useState(0);

  /**
   * 统计数据：正确数 / 错误数 / 超时数
   */
  const [stats, setStats] = useState<{ correct: number; wrong: number; timeout: number }>({
    correct: 0,
    wrong: 0,
    timeout: 0,
  });

  /**
   * wrongRecords - 拼写模式所有错题记录（结果页展示用）
   *  - 单词对象（含 word / meaning / sheetName）
   *  - 用户答案（空字符串表示超时或没填就判错）
   *  - 是否属于超时
   */
  interface WrongRecord {
    word: StudyWord;
    userAnswer: string;
    isTimeout: boolean;
    // 是否因「使用中文输入法」而判错（即使拼写内容正确也算错）
    isChinese?: boolean;
  }
  const [wrongRecords, setWrongRecords] = useState<WrongRecord[]>([]);

  /**
   * hintVisible - 释义拼写模式下的"首字母提示"是否显示
   *   默认显示（按用户需求：输入框内提示首字母）；一键隐藏按钮可隐藏它
   */
  const [hintVisible, setHintVisible] = useState(true);

  // 用于自动 focus 输入框的 ref（改为数组）
  const spellingInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  // 整体计时器 ID（引用，用于卸载时清理）
  const totalTimerRef = useRef<number | null>(null);

  // —— 强制全屏相关 ——
  // 标记「正在主动离开学习页」：主动退出（如卸载、点返回）会触发 fullscreenchange，
  // 需靠这个标记跳过「退出全屏 → 回首页」的强制逻辑，避免误跳转。
  const leavingStudyRef = useRef(false);

  /**
   * 拼写输入规范化（供正确性比对用）：
   *   - 去掉所有空格
   *   - 全部转成小写
   *   这样 "Apple " " apple"  "APPLE" 都会被判定为和 apple 相同
   */
  const normalizeSpelling = (s: string) =>
    // 核对时忽略空格与标点符号：只保留字母和数字，再转小写
    // 这样用户输入的空格、连字符、逗号等不会影响判断结果
    s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  // =========================
  // 初始化副作用（useEffect）
  // =========================

  /**
   * 初始化/重置学习页状态
   *   触发条件：词书、选中单词表、派生单词列表发生变化（即进入页面或重新选择时）
   *   行为：
   *     1. 若未选择词书或单词表为空，说明是非法进入，重定向回 /select 选择页；
   *     2. 否则：重置 words 为 baseWords（恢复初始顺序）、
   *              清空 revealedMap（所有卡片回到未展开）、
   *              allRevealed 回到 false、
   *              拼写模式专属状态也一并重置。
   */
  useEffect(() => {
    if (!currentBook || selectedSheetIds.length === 0) {
      navigate('/select');
      return;
    }
    // —— 标星模块：每次进入学习页（换词表/换模式/重新开始）都确保标星是全新的空状态 ——
    resetStarredWords();
    // 看词说意/听音辨义：保持原表顺序；单词拼写：选择子模式后出现的检测词直接乱序
    setWords(mode === 'spelling' ? shuffleArray(baseWords) : baseWords);
    setRevealedMap({});
    setAllRevealed(false);
    // 同时把"只看标星"开关也关掉（新会话默认显示全部单词）
    setShowStarredOnly(false);
    // —— 拼写模式初始化 ——
    setSpellingIndex(0);
    const initCount = mode === 'spelling' ? baseWords.length : 0;
    setAnswers(new Array(initCount).fill(''));
    setLocked(new Array(initCount).fill(false));
    setResults(new Array(initCount).fill(null));
    setChineseInputFlags(new Array(initCount).fill(false));
    setPerWordTimers(new Array(initCount).fill(PER_WORD_SECONDS));
    setTotalElapsedMs(0);
    setStats({ correct: 0, wrong: 0, timeout: 0 });
    setWrongRecords([]);
    setHintVisible(true);
    setPlayingUid(null);
  }, [currentBook, selectedSheetIds, baseWords, navigate, PER_WORD_SECONDS, mode, resetStarredWords]);

  /**
   * 离开学习页（返回选择页/跳首页/浏览器后退等）时：
   *   清空本次会话所有标星，保证下次进入学习页是完全全新的空状态
   *   标星规则：仅限本次选择的单元，一旦返回选择单元页即全部取消
   */
  useEffect(() => {
    return () => {
      resetStarredWords();
    };
  }, [resetStarredWords]);

  /**
   * 强制全屏：进入学习页后必须处于全屏状态
   *   规则（网站强制要求）：
   *     - 选好词表单元 + 学习模式，点「开始学习」进入本页后，立即请求浏览器全屏；
   *     - 一旦用户退出全屏（按 Esc、F11、点右上退出等），页面强制返回选择词表单元页 '/select'.
   *   适配说明：
   *     - iPad / iOS 等不支持可靠全屏的设备直接跳过整段逻辑（不请求、不监听、不跳转），
   *       避免它们进页面后因全屏异常被误踢回选择页，保证正常使用。
   *   实现要点：
   *     - 只在词表合法（不会被上面的 effect 重定向回 /select）时才启用；
   *     - 主动离开（卸载/点返回）时也会触发 fullscreenchange，用 leavingStudyRef 跳过误判；
   *     - 卸载时移除监听并退出全屏，避免影响其它页面。
   */
  useEffect(() => {
    // 词表非法时，上面的 effect 会重定向到 /select，这里不启用全屏逻辑
    if (!currentBook || selectedSheetIds.length === 0) return;
    // 只有单词拼写模块才强制全屏
    if (mode !== 'spelling') return;
    // iPad/iOS 等不支持可靠全屏的设备：完全跳过强制全屏，让页面正常使用
    if (!canUseForcedFullscreen()) return;

    leavingStudyRef.current = false;
    const rootEl = document.documentElement;

    // 请求进入全屏（部分浏览器要求用户手势触发；点「开始学习」跳转本页通常仍在手势上下文内）
    const enterFullscreen = () => {
      const req = rootEl.requestFullscreen?.bind(rootEl);
      if (req && !document.fullscreenElement) {
        // 某些环境（如未处于用户手势中）会 reject，静默忽略即可，
        // 后续 fullscreenchange 若检测到没进全屏并不会误跳转（初始本就非全屏）
        void req().catch(() => {});
      }
    };

    // 全屏状态变化：若「已退出全屏」且不是主动离开，则强制返回选择词表单元页
    const handleFullscreenChange = () => {
      if (leavingStudyRef.current) return;
      if (!document.fullscreenElement) {
        leavingStudyRef.current = true;
        navigate('/select');
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    // 延迟一帧再请求，确保页面已挂载、仍在点击手势上下文内
    const t = window.setTimeout(enterFullscreen, 0);

    return () => {
      window.clearTimeout(t);
      // 标记为主动离开，避免卸载时退出全屏又触发一次跳转
      leavingStudyRef.current = true;
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => {});
      }
    };
  }, [currentBook, selectedSheetIds, navigate, mode]);

  // =========================
  // 交互回调（useCallback 包装，避免不必要的子组件重渲染）
  // =========================

  /**
   * toggleReveal - 切换单张卡片的释义展开/收起状态
   *   @param uid - 目标单词的 uid
   *   实现：使用函数式更新，保留其它卡片的状态不变，仅翻转目标 uid 的布尔值。
   */
  const toggleReveal = useCallback((uid: string) => {
    setRevealedMap((prev) => ({ ...prev, [uid]: !prev[uid] }));
  }, []);

  /**
   * toggleAllReveal - 一键显示/隐藏所有卡片的释义
   *   逻辑：
   *     1. 翻转 allRevealed 开关；
   *     2. 若下一个状态是"全部显示"：
   *          遍历 words 构建一个 { uid: true } 全展开映射表；
   *     3. 若下一个状态是"全部隐藏"：
   *          直接把 revealedMap 清空为 {}。
   *   依赖：words（构建全展开表需要遍历）
   */
  const toggleAllReveal = useCallback(() => {
    setAllRevealed((prev) => {
      const next = !prev;
      if (next) {
        const all: Record<string, boolean> = {};
        words.forEach((w) => (all[w.uid] = true));
        setRevealedMap(all);
      } else {
        setRevealedMap({});
      }
      return next;
    });
  }, [words]);

  /**
   * handlePlay - 播放指定单词的发音
   *   @param word - 单词文本（传给音频工具）
   *   @param uid  - 单词 uid（用于高亮对应发音按钮）
   *   流程：
   *     1. 设置 playingUid = uid，让按钮进入"播放中"视觉状态；
   *     2. 调用 playWordAudio（异步）播放发音；
   *     3. 无论成功或失败（catch 中静默忽略），在 finally 里：
   *        仅当当前 playingUid 仍是该 uid 时才清空为 null，
   *        避免用户快速连点时覆盖了其它卡片的播放状态。
   */
  const handlePlay = useCallback(async (word: string, uid: string) => {
    setPlayingUid(uid);
    try {
      await playWordAudio(word);
    } catch (e) {
      // ignore
    } finally {
      setPlayingUid((p) => (p === uid ? null : p));
    }
  }, []);

  // =========================
  // 【单词拼写模式】专属交互回调
  // =========================

  /**
   * 播放当前拼写单词的发音（带防抖：避免每按一个键就连发）
   */
  const playCurrentSpellingWord = useCallback(async () => {
    const cur = words[spellingIndex];
    if (!cur) return;
    setPlayingUid(cur.uid);
    try {
      await playWordAudio(cur.word);
    } finally {
      setPlayingUid((p) => (p === cur.uid ? null : p));
    }
  }, [words, spellingIndex]);

  /**
   * 提交当前单词（锁定并跳转下一个）
   *   - 锁定当前单词（不可修改）
   *   - 判定当前答案正确/错误
   *   - 自动跳转到下一个单词并开始计时
   */
  const submitCurrentWord = useCallback((index: number) => {
    if (index >= words.length) return;
    if (locked[index]) return;
    
    const cur = words[index];
    const userAns = normalizeSpelling(answers[index] || '');
    const rightAns = normalizeSpelling(cur.word);
    // 中文输入法输入过的单词一律判错，即使拼写内容正确
    const usedChinese = !!chineseInputFlags[index];
    const correct = userAns === rightAns && !usedChinese;
    
    setLocked((prev) => {
      const next = [...prev];
      next[index] = true;
      return next;
    });
    
    setResults((prev) => {
      const next = [...prev];
      next[index] = correct;
      return next;
    });
    
    if (!correct) {
      setWrongRecords((prev) => {
        if (prev.some(r => r.word.uid === cur.uid)) return prev;
        return [...prev, {
          word: cur,
          userAnswer: answers[index] || '',
          isTimeout: false,
          isChinese: usedChinese,
        }];
      });
    }
    
    const nextIndex = index + 1;
    if (nextIndex < words.length) {
      setSpellingIndex(nextIndex);
      setPerWordTimers((prev) => {
        const next = [...prev];
        next[index] = 0;
        next[nextIndex] = PER_WORD_SECONDS;
        return next;
      });
      requestAnimationFrame(() => {
        spellingInputRefs.current[nextIndex]?.focus();
      });
    } else {
      setPerWordTimers((prev) => {
        const next = [...prev];
        next[index] = 0;
        return next;
      });
    }
  }, [words, answers, locked, chineseInputFlags]);

  /**
   * 锁定当前单词答案（用于超时场景）
   *   - 锁定后自动跳转到下一个未锁定的单词
   *   - 下一个单词自动开始计时
   */
  const lockSpellingWord = useCallback((index: number, isTimeout: boolean) => {
    if (locked[index]) return;
    
    const cur = words[index];
    const userAns = normalizeSpelling(answers[index] || '');
    const rightAns = normalizeSpelling(cur.word);
    // 中文输入法输入过的单词一律判错，即使拼写内容正确
    const usedChinese = !!chineseInputFlags[index];
    const correct = userAns === rightAns && !isTimeout && !usedChinese;
    
    setLocked((prev) => {
      const next = [...prev];
      next[index] = true;
      return next;
    });
    
    setResults((prev) => {
      const next = [...prev];
      next[index] = correct;
      return next;
    });
    
    // 统计数据由 useEffect 从 results/wrongRecords 派生，这里不再直接 setStats
    // 避免与 useEffect 的计算结果冲突（如增量更新 vs 全量重算的竞态）
    
    if (!correct) {
      setWrongRecords((prev) => {
        if (prev.some(r => r.word.uid === cur.uid)) return prev;
        return [...prev, {
          word: cur,
          userAnswer: answers[index] || '',
          isTimeout,
          isChinese: usedChinese,
        }];
      });
    }
    
    const nextIndex = index + 1;
    if (nextIndex < words.length) {
      setSpellingIndex(nextIndex);
      setPerWordTimers((prev) => {
        const next = [...prev];
        next[index] = 0;
        next[nextIndex] = PER_WORD_SECONDS;
        return next;
      });
      requestAnimationFrame(() => {
        spellingInputRefs.current[nextIndex]?.focus();
      });
    } else {
      setPerWordTimers((prev) => {
        const next = [...prev];
        next[index] = 0;
        return next;
      });
    }
  }, [words, answers, locked, chineseInputFlags]);

  /**
   * 单词拼写模式 · 重新开始（乱序）：把本轮所有状态清零
   */
  const resetSpellingAfterShuffle = useCallback(() => {
    setSpellingIndex(0);
    setAnswers(new Array(words.length).fill(''));
    setLocked(new Array(words.length).fill(false));
    setResults(new Array(words.length).fill(null));
    setChineseInputFlags(new Array(words.length).fill(false));
    setPerWordTimers(new Array(words.length).fill(PER_WORD_SECONDS));
    setHintVisible(true);
    setStats({ correct: 0, wrong: 0, timeout: 0 });
    setWrongRecords([]);
    setTotalElapsedMs(0);
    setPlayingUid(null);
    requestAnimationFrame(() => spellingInputRefs.current[0]?.focus());
  }, [words.length, PER_WORD_SECONDS]);

  // 覆盖原 doShuffle：乱序后如果是拼写模式，把索引也重置
  // 重新定义：
  const baseDoShuffle = useCallback(() => {
    setWords((prev) => shuffleArray(prev));
  }, []);
  // 先卸载原 doShuffle（用重定义方式）：
  // 这里把原 doShuffle 的逻辑替换掉（见 JSX 按钮里用 wrappedDoShuffle）
  const wrappedDoShuffle = useCallback(() => {
    baseDoShuffle();
    if (mode === 'spelling') {
      resetSpellingAfterShuffle();
    }
  }, [baseDoShuffle, mode, resetSpellingAfterShuffle]);

  // =========================
  // 【单词拼写模式】计时器副作用
  // =========================

  /**
   * 整体计时器：仅拼写模式下运行，每 100ms 加 100ms（更高精度）
   *   当所有单词完成时（全部锁定）暂停计时
   */
  useEffect(() => {
    if (mode !== 'spelling') return;
    if (words.length === 0) return;
    
    const checkAndTick = () => {
      const allLocked = locked.length > 0 && locked.every(l => l);
      if (!allLocked) {
        setTotalElapsedMs((t) => t + 100);
      }
    };
    
    totalTimerRef.current = window.setInterval(checkAndTick, 100);
    return () => {
      if (totalTimerRef.current !== null) {
        window.clearInterval(totalTimerRef.current);
        totalTimerRef.current = null;
      }
    };
  }, [mode, words.length, locked]);

  /**
   * 使用 useRef 保存 lockSpellingWord 的最新引用，避免计时器因依赖变化而中断
   */
  const lockSpellingWordRef = useRef(lockSpellingWord);
  lockSpellingWordRef.current = lockSpellingWord;

  /**
   * 每词 15 秒倒计时：单个单词单独计时，只有当前单词拼写时计时
   *   - 到 0 时：判为超时错误，自动统计并锁定
   *   - 已锁定的单词停止倒计时
   *   - 切换单词时，当前单词开始计时，之前的单词停止计时（保留剩余时间）
   *   - 使用 useRef 确保计时器不会因输入操作而中断暂停
   */
  useEffect(() => {
    if (mode !== 'spelling') return;
    if (spellingIndex >= words.length) return;
    if (locked[spellingIndex]) return;
    
    const timerId = window.setInterval(() => {
      setPerWordTimers((prev) => {
        const next = [...prev];
        if (next[spellingIndex] <= 1) {
          next[spellingIndex] = 0;
          setTimeout(() => {
            lockSpellingWordRef.current(spellingIndex, true);
          }, 200);
        } else {
          next[spellingIndex] -= 1;
        }
        return next;
      });
    }, 1000);
    
    return () => {
      window.clearInterval(timerId);
    };
  }, [mode, spellingIndex, words.length, locked]);

  /**
   * 听音拼写模式：进入一个新单词时，立刻自动播放一次发音
   *   - 依赖项 spellingIndex 变化即触发（换到新单词自动播）
   */
  useEffect(() => {
    if (mode !== 'spelling') return;
    if (spellingSubMode !== 'audio-spelling') return;
    if (spellingIndex >= words.length) return;
    // 延迟 120ms，等输入框挂好再播放
    const t = window.setTimeout(() => {
      void playCurrentSpellingWord();
    }, 120);
    return () => window.clearTimeout(t);
  }, [mode, spellingSubMode, spellingIndex, words.length, playCurrentSpellingWord]);

  /**
   * 进入拼写模式/切题后，自动 focus 输入框（键盘直接打）
   */
  useEffect(() => {
    if (mode !== 'spelling') return;
    requestAnimationFrame(() => spellingInputRefs.current[spellingIndex]?.focus());
  }, [mode, spellingIndex]);

  /**
   * 实时计算统计数据：监听 results 数组变化，所有被判定正确/错误的单词都计入统计
   */
  useEffect(() => {
    if (mode !== 'spelling') return;
    const correct = results.filter(r => r === true).length;
    const wrong = results.filter(r => r === false).length;
    const timeoutCount = wrongRecords.filter(r => r.isTimeout).length;
    setStats({ correct, wrong, timeout: timeoutCount });
  }, [results, wrongRecords, mode]);

  /**
   * 拼写模式：全局快捷键（window 级别）
   *   - Enter 回车键 → 当前单词未锁定 → 锁定当前单词（不跳转）
   *   - Tab 键 → 当前单词已锁定 → 跳到下一个单词
   */
  useEffect(() => {
    if (mode !== 'spelling') return;
    if (spellingIndex >= words.length) return;
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && active.tagName === 'INPUT') {
        const inputIndex = spellingInputRefs.current.indexOf(active as HTMLInputElement);
        if (inputIndex !== -1) {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!locked[inputIndex] && (answers[inputIndex] || '').trim()) {
              submitCurrentWord(inputIndex);
            }
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            const nextIndex = Math.min(inputIndex + 1, words.length - 1);
            if (locked[inputIndex]) {
              setSpellingIndex(nextIndex);
              requestAnimationFrame(() => {
                spellingInputRefs.current[nextIndex]?.focus();
              });
            }
          }
          return;
        }
      }
      if (active && active.tagName === 'BUTTON') return;

      if (e.key === 'Enter') {
        if (!locked[spellingIndex] && (answers[spellingIndex] || '').trim()) {
          submitCurrentWord(spellingIndex);
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, spellingIndex, words.length, locked, answers, submitCurrentWord]);

  // 统一总毫秒数格式化：mm:ss.S（分:秒.1位小数）
  const formatTotalTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    const tenths = Math.floor((ms % 1000) / 100);
    return `${mm}:${ss}.${tenths}`;
  };

  // 返回选择页（主动离开：先置离开标记，避免退出全屏被误判为「返回首页」）
  const goBack = () => {
    leavingStudyRef.current = true;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    }
    navigate('/select');
  };

  /**
   * handleExportStarredExcel - 将当前所有标星单词导出为 Excel 文件
   *   - 表头与导入词表一致：第 1 列「单词」、第 2 列「释义」
   *   - 仅导出已标星的单词，文件名带时间戳避免覆盖
   */
  const handleExportStarredExcel = () => {
    if (starredWordItems.length === 0) return;
    // 二维数组：首行表头 + 每行 [单词, 释义]
    const aoa: (string | number)[][] = [
      ['单词', '释义'],
      ...starredWordItems.map((w) => [w.word, w.meaning]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // 调整列宽，让单词和释义显示更完整
    ws['!cols'] = [{ wch: 24 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '标星单词');
    const ts = new Date();
    const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `标星单词_${stamp}.xlsx`);
  };

  // =========================
  // 【计时背诵模式】交互回调
  // =========================

  /**
   * startRecite - 用户在时间选择浮层中选定秒数后启动计时背诵
   *   @param seconds - 每个单词的倒计时秒数（5 / 7 / 10 / 15）
   *   行为：关闭浮层 → 打开背诵弹窗 → 从第 0 个单词开始，倒计时设为选定秒数
   */
  const startRecite = (seconds: number) => {
    setReciteSeconds(seconds);
    setReciteIndex(0);
    setReciteRemaining(seconds);
    setRecitePickerOpen(false);
    setReciteActive(true);
  };

  /**
   * reciteRemember - 点击「记住」：不标记当前单词，跳转下一个
   *   - 当前单词不做任何标星操作
   *   - 倒计时重置为 reciteSeconds，切到下一个单词
   *   - 若已是最后一个单词 → 关闭弹窗
   */
  const reciteRemember = () => {
    const next = reciteIndex + 1;
    if (next >= words.length) {
      setReciteActive(false);
    } else {
      setReciteRemaining(reciteSeconds);
      setReciteIndex(next);
    }
  };

  /**
   * reciteMark - 点击「标星」：标记当前单词并跳转下一个
   *   - 如果当前单词尚未标星 → 加入标星列表（toggleStarredWord）
   *   - 已标星的单词不会被取消（避免重复切换）
   *   - 倒计时重置，切到下一个单词；若是最后一个 → 关闭弹窗
   */
  const reciteMark = () => {
    const cur = words[reciteIndex];
    if (cur && !starredWords.includes(cur.word)) {
      toggleStarredWord(cur.word);
    }
    const next = reciteIndex + 1;
    if (next >= words.length) {
      setReciteActive(false);
    } else {
      setReciteRemaining(reciteSeconds);
      setReciteIndex(next);
    }
  };

  /**
   * recitePrev - 点击「上一词」：回到上一个单词，倒计时重置
   *   - 已是第一个单词时无效
   *   - 标星状态不受影响（之前标记过的单词仍保持标星）
   */
  const recitePrev = () => {
    if (reciteIndex <= 0) return;
    setReciteRemaining(reciteSeconds);
    setReciteIndex(reciteIndex - 1);
  };

  /**
   * reciteNext - 点击「下一词」：跳到下一个单词，不标记
   *   与「记住」功能一致：跳转下一词、不做标记
   */
  const reciteNext = () => {
    const next = reciteIndex + 1;
    if (next >= words.length) {
      setReciteActive(false);
    } else {
      setReciteRemaining(reciteSeconds);
      setReciteIndex(next);
    }
  };

  /**
   * reciteClose - 退出计时背诵（手动关闭弹窗）
   *   标星结果已实时写入全局 store，关闭后单词展示页自动反映标星状态
   */
  const reciteClose = () => {
    setReciteActive(false);
  };

  /**
   * 超时处理 ref：保存最新的超时动作（标记当前单词 + 跳转下一个）
   *   使用 ref 是为了让 setInterval 回调始终调用最新闭包，避免因依赖变化导致计时器中断
   *   （与拼写模式 lockSpellingWordRef 同一模式）
   */
  const reciteTimeoutRef = useRef<() => void>(() => {});
  reciteTimeoutRef.current = () => {
    const cur = words[reciteIndex];
    // 超时 = 标星：如果尚未标星则加入标星列表
    if (cur && !starredWords.includes(cur.word)) {
      toggleStarredWord(cur.word);
    }
    const next = reciteIndex + 1;
    if (next >= words.length) {
      setReciteActive(false);
    } else {
      setReciteRemaining(reciteSeconds);
      setReciteIndex(next);
    }
  };

  /**
   * 计时背诵 · 每词独立倒计时
   *   - 仅在背诵弹窗激活时运行
   *   - 每秒递减 1，到 0 时自动标记当前单词并跳转下一个
   *   - 依赖 reciteIndex 变化时重新启动计时（切到新单词 → 新的 15 秒倒计时）
   *   - 超时动作通过 ref 调用，避免将 action 函数放入依赖导致计时器重启
   */
  useEffect(() => {
    if (!reciteActive) return;
    if (reciteIndex >= words.length) {
      setReciteActive(false);
      return;
    }

    const timerId = window.setInterval(() => {
      setReciteRemaining((prev) => {
        if (prev <= 1) {
          // 倒计时归零：延迟调用超时动作，避免在 setState 回调中直接调用其它 setState
          window.setTimeout(() => reciteTimeoutRef.current(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [reciteActive, reciteIndex, words.length]);

  /**
   * 听音辨义模式下的计时背诵：进入一个新单词时自动播放发音
   *   - 依赖 reciteIndex 变化即触发（换到新单词自动播放）
   */
  useEffect(() => {
    if (!reciteActive) return;
    if (mode !== 'audio-meaning') return;
    if (reciteIndex >= words.length) return;
    const cur = words[reciteIndex];
    if (!cur) return;
    const t = window.setTimeout(() => {
      void playWordAudio(cur.word);
    }, 120);
    return () => window.clearTimeout(t);
  }, [reciteActive, reciteIndex, mode, words]);

  /**
   * 切换到新单词时自动重置「展开」状态
   *   - reciteIndex 变化（记住/标星/上一词/下一词/超时跳转）时触发
   *   - reciteActive 变化（启动/关闭）时触发
   */
  useEffect(() => {
    setReciteRevealed(false);
  }, [reciteIndex, reciteActive]);

  /**
   * 计时背诵 · 键盘快捷键（仅在背诵弹窗激活时生效）
   *   - ← 左方向键：上一词
   *   - → 右方向键：下一词
   *   - ↑ 上方向键：记住（不标记，跳下一词）
   *   - ↓ 下方向键：标星（标记并跳下一词）
   *   - 空格键：查看释义 / 单词（展开当前单词的答案）
   *   动作通过 ref 调用最新闭包，监听器只在 reciteActive 切换时重新绑定
   */
  const reciteActionsRef = useRef({
    next: reciteNext,
    prev: recitePrev,
    remember: reciteRemember,
    mark: reciteMark,
  });
  reciteActionsRef.current = {
    next: reciteNext,
    prev: recitePrev,
    remember: reciteRemember,
    mark: reciteMark,
  };
  useEffect(() => {
    if (!reciteActive) return;
    // 触发某个按钮的按压反馈：设置状态后 150ms 自动清除
    const flashPressed = (key: 'remember' | 'mark') => {
      setReciteKeyPressed(key);
      window.setTimeout(() => setReciteKeyPressed(null), 150);
    };
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          reciteActionsRef.current.next();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          reciteActionsRef.current.prev();
          break;
        case 'ArrowUp':
          e.preventDefault();
          flashPressed('remember');
          reciteActionsRef.current.remember();
          break;
        case 'ArrowDown':
          e.preventDefault();
          flashPressed('mark');
          reciteActionsRef.current.mark();
          break;
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          setReciteRevealed(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [reciteActive]);

  // 单词为空时的加载占位（通常发生在初始化尚未完成时）
  if (words.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-md">
            <BookOpen className="h-8 w-8 animate-pulse text-indigo-500" />
          </div>
          <p className="text-slate-500">正在加载词表...</p>
        </div>
      </div>
    );
  }

  // 根据当前模式计算顶部显示的文案和图标（新增看意说词子模式 + 单词拼写模式）
  const titleModeLabel: string =
    mode === 'word-meaning'
      ? lookSubMode === 'meaning-word'
        ? '看意说词'
        : '看词说意'
      : mode === 'spelling'
        ? spellingSubMode === 'meaning-spelling'
          ? '单词拼写 · 释义拼写'
          : '单词拼写 · 听音拼写'
        : '听音辨义';
  const TitleIcon =
    mode === 'word-meaning'
      ? lookSubMode === 'meaning-word'
        ? MessageSquareText
        : Eye
      : mode === 'spelling'
        ? PencilLine
        : Headphones;

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 pb-12">
      
      

      {/* 顶部 Sticky 工具栏（滚动固定）：左侧返回，中间模式信息，右侧工具按钮 */}
      <div className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-4">
          {/* 左：返回选择页按钮 */}
          <button
            onClick={goBack}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-200 hover:text-indigo-700"
          >
            <ArrowLeft className="h-4 w-4" />
            返回选择
          </button>
          {/* 中：模式图标 + 模式名称 + 词书信息（大屏显示完整，小屏仅显示徽标） */}
          <div className="flex min-w-0 items-center gap-2">
            {/* 彩色渐变图标 */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 shadow-md">
              <TitleIcon className="h-4.5 w-4.5 text-white" />
            </div>
            {/* sm 及以上：显示模式名 + 词书名 + 单词总数（若开启筛选则显示 筛选/总数） */}
            <div className="min-w-0 hidden sm:block">
              <p className="truncate text-sm font-semibold text-slate-800">{titleModeLabel}</p>
              <p className="truncate text-xs text-slate-500">
                {/* 词表名只显示前 4 个字，后面用省略号替代 */}
                {currentBook?.fileName ? `${currentBook.fileName.slice(0, 4)}…` : ''} · {words.length} 词
                {/* 非拼写模式：始终实时显示已标星数量，方便学习过程中掌握收藏情况 */}
                {mode !== 'spelling' && (
                  <>
                    {' · '}
                    已标星{' '}
                    <span className="font-bold text-amber-600">{starredWords.length}</span>
                  </>
                )}
              </p>
            </div>
            {/* sm 以下：显示精简的模式徽标 */}
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 sm:hidden">
              <Sparkles className="h-3 w-3" />
              {titleModeLabel}
            </span>
          </div>
          {/* 右：操作按钮
              - 看词说意/听音辨义：一键显隐释义 + 只显示标星
              - 拼写模式：切换"首字母提示/提示显示"
           */}
          <div className="flex items-center gap-2">
            {mode === 'spelling' ? (
              <button
                onClick={() => setHintVisible((v) => !v)}
                title={hintVisible ? '隐藏首字母提示' : '显示首字母提示'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium shadow-sm transition-all',
                  hintVisible
                    ? 'bg-gradient-to-r from-indigo-500 to-blue-500 text-white hover:from-indigo-600 hover:to-blue-600'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-indigo-700'
                )}
              >
                {hintVisible ? (
                  <>
                    <EyeOff className="h-4 w-4" />
                    <span className="hidden sm:inline">隐藏提示</span>
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4" />
                    <span className="hidden sm:inline">显示提示</span>
                  </>
                )}
              </button>
            ) : (
              <>
                {/* 按钮 1：一键显隐（仅非拼写模式）—— 看意说词：显隐单词；其它：显隐释义 */}
                <button
                  onClick={toggleAllReveal}
                  title={
                    allRevealed
                      ? mode === 'word-meaning' && lookSubMode === 'meaning-word'
                        ? '一键隐藏所有单词'
                        : '一键隐藏所有释义'
                      : mode === 'word-meaning' && lookSubMode === 'meaning-word'
                        ? '一键显示所有单词'
                        : '一键显示所有释义'
                  }
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium shadow-sm transition-all',
                    allRevealed
                      ? 'bg-gradient-to-r from-indigo-500 to-blue-500 text-white hover:from-indigo-600 hover:to-blue-600'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-indigo-700'
                  )}
                >
                  {allRevealed ? (
                    <>
                      <EyeOff className="h-4 w-4" />
                      <span className="hidden sm:inline">
                        {mode === 'word-meaning' && lookSubMode === 'meaning-word'
                          ? '隐藏单词'
                          : '隐藏释义'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4" />
                      <span className="hidden sm:inline">
                        {mode === 'word-meaning' && lookSubMode === 'meaning-word'
                          ? '显示单词'
                          : '显示释义'}
                      </span>
                    </>
                  )}
                </button>
                {/* 按钮 2：只显示标星单词（仅非拼写模式） */}
                <button
                  onClick={() => setShowStarredOnly((v) => !v)}
                  title={
                    showStarredOnly
                      ? '显示全部单词（当前只看标星）'
                      : '只显示已打星标的单词'
                  }
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium shadow-sm transition-all',
                    showStarredOnly
                      ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-white hover:from-amber-500 hover:to-orange-600 shadow-orange-200'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-amber-600'
                  )}
                >
                  <Star
                    className={cn('h-4 w-4', showStarredOnly ? 'fill-current' : '')}
                  />
                  <span className="hidden sm:inline">只看标星</span>
                  {/* 标星单词个数：始终实时显示，方便在学习过程中掌握收藏数量 */}
                  <span
                    className={cn(
                      'ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-bold',
                      showStarredOnly
                        ? 'bg-white/30 text-white'
                        : 'bg-amber-100 text-amber-700'
                    )}
                  >
                    {starredWords.length}
                  </span>
                </button>
                {/* 按钮 3：导出标星单词（仅非拼写模式）—— 弹窗展示并支持下载 Excel */}
                <button
                  onClick={() => setExportModalOpen(true)}
                  disabled={starredWordItems.length === 0}
                  title="导出已标星的单词（Excel 格式）"
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium shadow-sm transition-all',
                    starredWordItems.length === 0
                      ? 'cursor-not-allowed bg-slate-100 text-slate-300 ring-1 ring-slate-200'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-emerald-600'
                  )}
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">导出</span>
                </button>
                {/* 按钮 4：计时背诵（仅非拼写模式）—— 选择每词秒数后弹窗背诵 */}
                <button
                  onClick={() => setRecitePickerOpen(true)}
                  title="计时背诵：每词独立倒计时，超时或标记的单词自动加入标星"
                  className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-500 to-purple-500 px-3.5 py-2 text-xs font-medium text-white shadow-sm transition-all hover:from-violet-600 hover:to-purple-600"
                >
                  <Timer className="h-4 w-4" />
                  <span className="hidden sm:inline">计时背诵</span>
                </button>
              </>
            )}
            {/* 乱序按钮：点击后重新随机排列单词 */}
            <button
              onClick={wrappedDoShuffle}
              title="乱序排列"
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-indigo-700"
            >
              <Shuffle className="h-4 w-4" />
              <span className="hidden sm:inline">乱序</span>
            </button>
          </div>
        </div>
      </div>

      {/* 主内容区：根据 mode 切换 看词说意 / 单词拼写 / 听音辨义 */}
      <div className="mx-auto max-w-5xl px-6 py-8">
        {mode === 'word-meaning' ? (
          // 模式 A：看词说意 - 卡片头（序号徽标+词表名+标星）+ 卡片体（单词+发音按钮 + 释义展开区）
          displayWords.length === 0 ? (
            // 「只看标星」模式下没有任何标星单词时 → 友好空状态引导
            <div className="mx-auto max-w-md py-16 text-center">
              <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-100 to-orange-100 shadow-md">
                <Star className="h-10 w-10 text-amber-400" />
              </div>
              <h3 className="text-lg font-extrabold text-slate-800">还没有任何标星的单词</h3>
              <p className="mt-2 text-sm text-slate-500">
                点击卡片右上角的 ⭐ 星标按钮，把需要重点复习的单词收藏起来吧～
              </p>
              <button
                onClick={() => setShowStarredOnly(false)}
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition hover:shadow-xl"
              >
                <BookOpen className="h-4 w-4" />
                返回查看全部单词
              </button>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {displayWords.map((w, idx) => {
              const revealed = !!revealedMap[w.uid];
              const starred = starredWords.includes(w.word);
              return (
                <div
                  key={w.uid}
                  className={cn(
                    'group overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg',
                    revealed ? 'border-indigo-200' : 'border-slate-200/80',
                    starred ? 'ring-2 ring-amber-300/70' : ''
                  )}
                >
                  {/* 卡片头：渐变底条带，左侧序号徽标，中间单词表名，右侧标星按钮 */}
                  <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-indigo-50/70 via-blue-50/70 to-sky-50/70 px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-white/80 px-2 py-0.5 text-[11px] font-medium text-indigo-600">
                      <BookOpen className="h-3 w-3" />
                      {String(idx + 1).padStart(3, '0')}
                    </span>
                    <span className="truncate text-[11px] text-slate-500 flex-1 mx-2 text-center">
                      {w.sheetName}
                    </span>
                    {/* 标星按钮：点击切换星标，stopPropagation 避免触发卡片展开 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStarredWord(w.word);
                      }}
                      title={starred ? '取消星标' : '标记星标，重点复习'}
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all',
                        starred
                          ? 'text-amber-500 hover:bg-amber-100 hover:scale-110'
                          : 'text-slate-300 hover:text-amber-400 hover:bg-amber-50 hover:scale-110'
                      )}
                    >
                      <Star className={cn('h-3.5 w-3.5', starred ? 'fill-current' : '')} />
                    </button>
                  </div>
                  {/* 卡片主体 */}
                  <div className="p-5">
                    {/* 整块可点击区域：点击切换 revealed（展开/收起） */}
                    <div
                      onClick={() => toggleReveal(w.uid)}
                      className="cursor-pointer select-none"
                    >
                      {lookSubMode === 'word-meaning' ? (
                        <>
                          {/* ===== 看词说意（原逻辑）：上方单词+发音，下方释义展开区 ===== */}
                          <div className="flex items-start justify-between gap-2">
                            <p className="flex-1 break-words text-2xl font-bold tracking-tight text-slate-900 transition group-hover:text-indigo-700">
                              {w.word}
                            </p>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePlay(w.word, w.uid);
                              }}
                              className={cn(
                                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all',
                                playingUid === w.uid
                                  ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-orange-200 animate-pulse'
                                  : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:scale-105'
                              )}
                              title="播放发音"
                            >
                              <Volume2 className="h-5 w-5" />
                            </button>
                          </div>
                          <div className="mt-4">
                            <div
                              className={cn(
                                'overflow-hidden rounded-xl border transition-all duration-300',
                                revealed
                                  ? 'max-h-60 border border-indigo-300 bg-white p-4 opacity-100 shadow-sm'
                                  : 'max-h-10 border-dashed border-slate-300 bg-slate-100/70 p-2 opacity-90'
                              )}
                            >
                              {revealed ? (
                                <p className="text-base font-medium leading-relaxed text-slate-900">{w.meaning}</p>
                              ) : (
                                <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500">
                                  <Eye className="h-3.5 w-3.5" />
                                  点击单词或此处查看释义
                                </div>
                              )}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* ===== 看意说词（新逻辑）：上方显示中文释义，下方展开英文单词+发音 ===== */}
                          <div className="min-h-[3.5rem] flex items-center">
                            <p className="flex-1 break-words text-xl font-bold tracking-tight leading-snug text-slate-900 transition group-hover:text-indigo-700">
                              {w.meaning}
                            </p>
                          </div>
                          <div className="mt-4">
                            <div
                              className={cn(
                                'overflow-hidden rounded-xl border transition-all duration-300',
                                revealed
                                  ? 'max-h-60 border border-indigo-300 bg-white p-4 opacity-100 shadow-sm'
                                  : 'max-h-10 border-dashed border-slate-300 bg-slate-100/70 p-2 opacity-90'
                              )}
                            >
                              {revealed ? (
                                <div className="flex items-center justify-between gap-2">
                                  <p className="flex-1 break-words text-xl font-bold tracking-tight text-slate-900">
                                    {w.word}
                                  </p>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePlay(w.word, w.uid);
                                    }}
                                    className={cn(
                                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all',
                                      playingUid === w.uid
                                        ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-orange-200 animate-pulse'
                                        : 'bg-white text-indigo-600 hover:bg-indigo-50 hover:scale-105 ring-1 ring-indigo-200'
                                    )}
                                    title="播放发音"
                                  >
                                    <Volume2 className="h-5 w-5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500">
                                  <Eye className="h-3.5 w-3.5" />
                                  点击释义或此处查看英文单词
                                </div>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          )
        ) : mode === 'spelling' ? (
          // 模式 C：单词拼写（子模式 释义拼写 / 听音拼写）
          // 单卡片居中布局，顶部进度条，中间题目/输入区，底部提交+下一题
          <div className="mx-auto max-w-2xl">
            {spellingIndex >= words.length ? (
              // —— 全部做完：结果总结页面 ——
              (() => {
                // ====== 派生数据：准确率 / 是否达标 / 检查时间 / 模式文案 ======
                const accuracyVal =
                  words.length === 0 ? 0 : (stats.correct / words.length) * 100;
                const accuracyStr = `${Math.round(accuracyVal)}%`;
                const passed = accuracyVal >= 90;
                // 因「使用中文输入法」而被判错的单词数量
                const chineseCount = wrongRecords.filter((r) => r.isChinese).length;
                // 检查时间（当前系统时间）
                const checkTimeStr = new Date().toLocaleString('zh-CN', {
                  year: 'numeric', month: '2-digit', day: '2-digit',
                  hour: '2-digit', minute: '2-digit', hour12: false,
                });
                const modeText =
                  spellingSubMode === 'meaning-spelling' ? '释义拼写' : '听音拼写';
                return (
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
                {/* —— 顶部祝贺/鼓励横幅（按准确率 ≥90 切换） —— */}
                <div
                  className={cn(
                    'relative px-6 py-4 text-center text-white',
                    passed
                      ? 'bg-gradient-to-br from-emerald-500 via-teal-500 to-sky-600'
                      : 'bg-gradient-to-br from-rose-500 via-orange-500 to-amber-500'
                  )}
                >
                  <div className="mx-auto flex items-center justify-center gap-2">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur">
                      <Trophy className="h-5 w-5" />
                    </div>
                    {passed ? (
                      <div className="text-center">
                        <h2 className="text-lg font-extrabold sm:text-xl">🎉 恭喜你，闯关成功！</h2>
                        <p className="mt-0.5 text-xs text-white/90">
                          准确率 {accuracyStr}，超过 90% 合格线，太棒啦，继续保持！
                        </p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <h2 className="text-lg font-extrabold sm:text-xl">💪 很遗憾，再接再厉！</h2>
                        <p className="mt-0.5 text-xs text-white/90">
                          当前准确率 {accuracyStr}，合格线是 90%。别灰心，复习错题，再来一遍一定能过！
                        </p>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-white/80">
                    模式：单词拼写 · {modeText}　·　共 {words.length} 个单词　·　总用时{' '}
                    <span className="font-mono font-bold">{formatTotalTime(totalElapsedMs)}</span>
                  </p>
                </div>

                {/* —— 4 格统计卡（检查时间 / 检查内容 / 正确 / 错误 / 正确率 合并） —— */}
                <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
                  <div className="bg-white px-4 py-3 text-center">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      检查时间
                    </p>
                    <p className="mt-1 break-words text-sm font-bold text-slate-800">
                      {checkTimeStr}
                    </p>
                  </div>
                  <div className="bg-white px-4 py-3 text-center sm:col-span-1">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      检查内容（词表）
                    </p>
                    <div className="mt-1 flex flex-wrap justify-center gap-1">
                      {selectedSheetNames.length === 0 ? (
                        <span className="text-xs text-slate-400">-</span>
                      ) : (
                        selectedSheetNames.map((n) => (
                          <span
                            key={n}
                            className="inline-block truncate rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 max-w-full"
                          >
                            {n}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="bg-white px-4 py-3 text-center">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      正确
                    </p>
                    <p className="mt-1 font-mono text-2xl font-extrabold text-emerald-600">
                      {stats.correct}
                    </p>
                  </div>
                  <div className="bg-white px-4 py-3 text-center">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      错误
                    </p>
                    <p className="mt-1 font-mono text-2xl font-extrabold text-rose-500">
                      {stats.wrong}
                    </p>
                  </div>
                </div>

                {/* —— 单独一行：准确率大字（突出） —— */}
                <div className="border-y border-slate-100 bg-gradient-to-r from-indigo-50 via-blue-50 to-sky-50 px-6 py-3 text-center">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-indigo-500">
                    本次准确率
                  </p>
                  <p
                    className={cn(
                      'mt-1 font-mono text-4xl font-black tabular-nums',
                      passed ? 'text-emerald-600' : 'text-rose-500'
                    )}
                  >
                    {accuracyStr}
                    <span className="ml-2 align-middle text-xs font-semibold text-slate-500">
                      {passed ? '✅ ≥ 90%（合格）' : '❌ < 90%（未达标）'}
                    </span>
                  </p>
                </div>

                {/* —— 准确率下方：所有错题列表（正确单词 / 释义 / 错误拼写） —— */}
                <div className="px-6 py-4">
                  {wrongRecords.length === 0 ? (
                    <div className="rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/60 p-5 text-center">
                      <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                        <Check className="h-7 w-7" />
                      </div>
                      <p className="text-base font-bold text-emerald-700">
                        全对，没有任何错误单词！🏆
                      </p>
                      <p className="mt-1 text-xs text-emerald-700/70">
                        太棒啦，这组词表已完全掌握
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div className="mb-3 flex items-end justify-between gap-3">
                        <div>
                          <h3 className="text-base font-extrabold text-slate-800">
                            📋 错题列表（共 {wrongRecords.length} 个）
                            {(stats.timeout > 0 || chineseCount > 0) && (
                              <span className="ml-2 align-middle text-xs font-medium text-slate-400">
                                {stats.timeout > 0 && `${stats.timeout} 超时`}
                                {stats.timeout > 0 && chineseCount > 0 && ' · '}
                                {chineseCount > 0 && `${chineseCount} 中文输入`}
                              </span>
                            )}
                          </h3>
                          <p className="mt-0.5 text-xs text-slate-500">
                            显示正确单词、中文释义、以及你当时拼写的错误答案
                          </p>
                        </div>
                      </div>
                      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        {wrongRecords.map((rec, idx) => (
                          <li
                            key={idx}
                            className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-start"
                          >
                            {/* 1. 正确单词 + 发音 */}
                            <div>
                              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                                ✅ 正确单词
                              </p>
                              <div className="mt-1 flex items-center gap-2">
                                <p className="break-all font-mono text-lg font-black text-slate-800">
                                  {rec.word.word}
                                </p>
                                <button
                                  onClick={(e) => e.preventDefault()}
                                  onMouseEnter={() => {
                                    setPlayingUid(rec.word.uid);
                                    void playWordAudio(rec.word.word).finally(() =>
                                      setPlayingUid((p) =>
                                        p === rec.word.uid ? null : p
                                      )
                                    );
                                  }}
                                  className={cn(
                                    'flex h-7 w-7 shrink-0 cursor-help items-center justify-center rounded-lg transition',
                                    playingUid === rec.word.uid
                                      ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow animate-pulse'
                                      : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                                  )}
                                  title="鼠标悬停到图标上播放发音；点击不发音"
                                >
                                  <Volume2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <p className="mt-0.5 text-[10px] text-slate-400">
                                来自：{rec.word.sheetName}
                              </p>
                            </div>
                            {/* 2. 中文释义 */}
                            <div>
                              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                                📖 中文释义
                              </p>
                              <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-700">
                                {rec.word.meaning}
                              </p>
                            </div>
                            {/* 3. 你拼写的错误答案 */}
                            <div>
                              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                                ❌ 你的答案
                                {rec.isTimeout && (
                                  <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-amber-700">
                                    超时
                                  </span>
                                )}
                                {rec.isChinese && (
                                  <span className="ml-1 rounded bg-orange-100 px-1 py-0.5 text-orange-700">
                                    中文输入
                                  </span>
                                )}
                              </p>
                              <p className="mt-1 break-all font-mono text-base font-bold text-rose-600 line-through decoration-2 decoration-rose-400/70">
                                {rec.userAnswer || (
                                  <span className="italic text-rose-500/80 no-underline">
                                    （空，未作答）
                                  </span>
                                )}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* —— 底部按钮 —— */}
                <div className="space-y-3 border-t border-slate-100 px-6 py-6 sm:flex sm:space-y-0 sm:gap-3">
                  <button
                    onClick={wrappedDoShuffle}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-1/2"
                  >
                    <Shuffle className="h-4 w-4" />
                    重新开始（乱序）
                  </button>
                  <button
                    onClick={goBack}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition hover:shadow-xl sm:w-1/2"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    返回选择页
                  </button>
                </div>
              </div>
                );
              })()
            ) : (
              // —— 单词拼写：全单词列表界面 ——
              <SpellingListUI
                words={words}
                spellingSubMode={spellingSubMode!}
                answers={answers}
                setAnswers={(index, value) => {
                  setAnswers((prev) => {
                    const next = [...prev];
                    next[index] = value;
                    return next;
                  });
                }}
                locked={locked}
                setLocked={setLocked}
                results={results}
                setResults={setResults}
                setWrongRecords={setWrongRecords}
                perWordTimers={perWordTimers}
                currentIndex={spellingIndex}
                setCurrentIndex={setSpellingIndex}
                hintVisible={hintVisible}
                inputRefs={spellingInputRefs}
                onSubmitWord={submitCurrentWord}
                onFocusWord={(index) => {
                  setPerWordTimers((prev) => {
                    const next = [...prev];
                    if (next[index] === undefined || next[index] === 0) {
                      next[index] = PER_WORD_SECONDS;
                    }
                    return next;
                  });
                }}
                onChineseInput={(index) => {
                  // 标记该单词使用了中文输入法（后续核对一律判错）
                  setChineseInputFlags((prev) => {
                    const next = [...prev];
                    next[index] = true;
                    return next;
                  });
                }}
                playingUid={playingUid}
                stats={stats}
                totalElapsedMs={totalElapsedMs}
                formatTotalTime={formatTotalTime}
                onSubmit={() => {
                  // 提交时：把所有尚未锁定且没有答案的单词标记为错误（跳过/未作答）
                  // 统计数据由 useEffect 从 results/wrongRecords 派生，不再用 setTimeout 延迟计算
                  // 避免闭包中 results/wrongRecords 过期导致的统计不一致
                  for (let i = 0; i < words.length; i++) {
                    if (!locked[i] && !answers[i].trim()) {
                      setLocked((prev) => {
                        const next = [...prev];
                        next[i] = true;
                        return next;
                      });
                      setResults((prev) => {
                        const next = [...prev];
                        next[i] = false;
                        return next;
                      });
                      setWrongRecords((prev) => [
                        ...prev,
                        {
                          word: words[i],
                          userAnswer: '',
                          isTimeout: false,
                        },
                      ]);
                    }
                  }
                  // 直接触发结果页：上述状态更新会被 React 18 自动批处理，
                  // useEffect 会在渲染后根据最新 results/wrongRecords 重新计算 stats
                  setSpellingIndex(words.length);
                }}
              />
            )}
          </div>
        ) : (
          // 模式 B：听音辨义 - 卡片头(序号+词表名+标星)+大号发音按钮+展开区(单词+释义)
          displayWords.length === 0 ? (
            // 「只看标星」模式下没有任何标星单词时 → 友好空状态引导
            <div className="mx-auto max-w-md py-16 text-center">
              <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-100 to-orange-100 shadow-md">
                <Star className="h-10 w-10 text-amber-400" />
              </div>
              <h3 className="text-lg font-extrabold text-slate-800">还没有任何标星的单词</h3>
              <p className="mt-2 text-sm text-slate-500">
                点击卡片右上角的 ⭐ 星标按钮，把需要重点复习的单词收藏起来吧～
              </p>
              <button
                onClick={() => setShowStarredOnly(false)}
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition hover:shadow-xl"
              >
                <Headphones className="h-4 w-4" />
                返回查看全部单词
              </button>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {displayWords.map((w, idx) => {
                const revealed = !!revealedMap[w.uid];
                const starred = starredWords.includes(w.word);
                return (
                  <div
                    key={w.uid}
                    onClick={() => toggleReveal(w.uid)}
                    className={cn(
                      'group cursor-pointer overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg',
                      revealed ? 'border-indigo-200' : 'border-slate-200/80',
                      starred ? 'ring-2 ring-amber-300/70' : ''
                    )}
                  >
                    {/* 卡片头：左侧耳机图标 + 序号，中间单词表名，右侧标星按钮 */}
                    <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-indigo-50/70 via-blue-50/70 to-sky-50/70 px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-white/80 px-2 py-0.5 text-[11px] font-medium text-indigo-600">
                        <Headphones className="h-3 w-3" />
                        {String(idx + 1).padStart(3, '0')}
                      </span>
                      <span className="truncate text-[11px] text-slate-500 flex-1 mx-2 text-center">
                        {w.sheetName}
                      </span>
                      {/* 标星按钮：stopPropagation 避免触发整张卡片的展开/收起 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStarredWord(w.word);
                        }}
                        title={starred ? '取消星标' : '标记星标，重点复习'}
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all',
                          starred
                            ? 'text-amber-500 hover:bg-amber-100 hover:scale-110'
                            : 'text-slate-300 hover:text-amber-400 hover:bg-amber-50 hover:scale-110'
                        )}
                      >
                        <Star className={cn('h-3.5 w-3.5', starred ? 'fill-current' : '')} />
                      </button>
                    </div>
                    {/* 卡片主体 */}
                    <div className="p-5">
                      {/* 居中的大号发音按钮 */}
                      <div className="flex justify-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlay(w.word, w.uid);
                          }}
                          className={cn(
                            'flex h-20 w-20 items-center justify-center rounded-3xl shadow-lg transition-all duration-200 hover:scale-105',
                            playingUid === w.uid
                              ? 'bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-white shadow-xl shadow-orange-200 animate-pulse'
                              : 'bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white shadow-xl shadow-indigo-200 hover:shadow-2xl hover:shadow-indigo-300'
                          )}
                          title="播放发音"
                        >
                          <Volume2 className="h-10 w-10" />
                        </button>
                      </div>
                      {/* 答案区：单词 + 释义（未展开时只显示提示） */}
                      <div className="mt-5">
                        <div
                          className={cn(
                            'overflow-hidden rounded-xl border transition-all duration-300',
                            revealed
                              ? 'max-h-96 border-indigo-100 bg-gradient-to-br from-indigo-50 to-blue-50 p-4 opacity-100'
                              : 'max-h-14 border-dashed border-slate-200 bg-slate-50/60 p-3 opacity-80'
                          )}
                        >
                          {revealed ? (
                            <div className="space-y-3 text-center">
                              <p className="text-2xl font-bold tracking-tight text-slate-900">
                                {w.word}
                              </p>
                              <div className="mx-auto h-px w-12 bg-indigo-200" />
                              <p className="text-sm leading-relaxed text-slate-700">{w.meaning}</p>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
                              <Eye className="h-3.5 w-3.5" />
                              点击卡片显示单词和释义
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* 导出标星单词弹窗：遮罩层 + 居中卡片，z-50 保证在最上层 */}
      {exportModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4"
          onClick={() => setExportModalOpen(false)}
        >
          {/* 弹窗卡片：阻止点击冒泡关闭 */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-3xl bg-white shadow-2xl"
          >
            {/* 右上角关闭按钮 × */}
            <button
              onClick={() => setExportModalOpen(false)}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            {/* 弹窗头部：图标 + 标题 + 说明 */}
            <div className="border-b border-slate-100 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-orange-200">
                  <Download className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-slate-800">导出标星单词</h3>
                  <p className="text-xs text-slate-500">
                    共 <span className="font-bold text-amber-600">{starredWordItems.length}</span> 个标星单词，格式与导入词表一致（单词 / 释义）
                  </p>
                </div>
              </div>
            </div>

            {/* 表格区域：可滚动，表头固定 */}
            <div className="flex-1 overflow-auto px-6 py-4">
              {starredWordItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Star className="h-10 w-10 text-slate-300" />
                  <p className="mt-3 text-sm text-slate-400">还没有标星任何单词</p>
                </div>
              ) : (
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr>
                      <th className="w-12 rounded-l-lg border-b border-slate-200 px-3 py-2.5 text-center text-xs font-semibold text-slate-500">
                        #
                      </th>
                      <th className="border-b border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-500">
                        单词
                      </th>
                      <th className="rounded-r-lg border-b border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-500">
                        释义
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {starredWordItems.map((w, idx) => (
                      <tr key={w.uid} className="hover:bg-slate-50">
                        <td className="border-b border-slate-100 px-3 py-2.5 text-center text-xs text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2.5 font-mono font-semibold text-slate-800">
                          {w.word}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2.5 text-slate-600">
                          {w.meaning}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 底部操作区：下载 + 关闭 */}
            <div className="flex items-center gap-3 border-t border-slate-100 px-6 py-4">
              <button
                onClick={() => setExportModalOpen(false)}
                className="flex-1 rounded-2xl border-2 border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
              >
                关闭
              </button>
              <button
                onClick={handleExportStarredExcel}
                disabled={starredWordItems.length === 0}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-bold text-white shadow-lg transition-all',
                  starredWordItems.length === 0
                    ? 'cursor-not-allowed bg-slate-300 shadow-none'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-500 shadow-emerald-200 hover:shadow-xl hover:shadow-emerald-300 active:translate-y-0.5'
                )}
              >
                <Download className="h-4 w-4" />
                下载 Excel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 计时背诵 · 时间选择浮层 ===== */}
      {/* 点击工具栏「计时背诵」按钮后出现，选择每词倒计时秒数 */}
      {recitePickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4"
          onClick={() => setRecitePickerOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
          >
            {/* 右上角关闭 */}
            <button
              onClick={() => setRecitePickerOpen(false)}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            {/* 头部：图标 + 标题 */}
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-lg shadow-purple-200">
                <Timer className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-slate-800">计时背诵</h3>
                <p className="text-xs text-slate-500">
                  选择每个单词的倒计时秒数，超时未操作将自动标星
                </p>
              </div>
            </div>
            {/* 4 个时间选项 */}
            <div className="grid grid-cols-2 gap-3">
              {[5, 7, 10, 15].map((sec) => (
                <button
                  key={sec}
                  onClick={() => startRecite(sec)}
                  className="flex flex-col items-center gap-1 rounded-2xl border-2 border-slate-200 bg-white py-5 transition-all hover:border-violet-400 hover:bg-violet-50 active:translate-y-0.5"
                >
                  <span className="font-mono text-3xl font-black text-violet-600">{sec}</span>
                  <span className="text-xs font-medium text-slate-500">秒 / 词</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== 计时背诵 · 背诵弹窗（背景虚化，仅显示弹窗） ===== */}
      {reciteActive && reciteIndex < words.length && (() => {
        const cur = words[reciteIndex];
        if (!cur) return null;
        const starred = starredWords.includes(cur.word);
        // 倒计时进度比例（0~1），用于圆形 SVG 进度环
        const pct = Math.max(0, Math.min(1, reciteRemaining / reciteSeconds));
        // 剩余秒数 ≤ 3 时变红色提醒
        const isUrgent = reciteRemaining <= 3;
        // 判断当前背诵模式的展示形式
        // - 看词说意（lookSubMode==='word-meaning'）：正面显示单词，点击查看释义
        // - 看意说词（lookSubMode==='meaning-word'）：正面显示释义，点击查看单词
        // - 听音辨义（mode==='audio-meaning'）：正面显示发音按钮，点击查看单词+释义
        const isWordMeaningMode = mode === 'word-meaning' && lookSubMode === 'word-meaning';
        const isMeaningWordMode = mode === 'word-meaning' && lookSubMode === 'meaning-word';
        // 听音辨义模式作为 else 分支（mode === 'audio-meaning'）
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md px-2 sm:px-4">
            {/* 卡片 + 两侧导航箭头（横向 flex：左箭头 | 卡片 | 右箭头） */}
            <div className="flex w-full max-w-2xl items-center gap-2 sm:gap-4">
              {/* 左侧：上一词（仅图标） */}
              <button
                onClick={recitePrev}
                disabled={reciteIndex <= 0}
                title="上一词（←）"
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-lg transition-all sm:h-12 sm:w-12',
                  reciteIndex <= 0
                    ? 'cursor-not-allowed bg-slate-200/80 text-slate-300'
                    : 'bg-white text-slate-600 hover:bg-violet-50 hover:text-violet-600 hover:scale-110 active:translate-y-0.5'
                )}
              >
                <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>

              {/* 弹窗主体 */}
              <div className="relative min-w-0 flex-1 overflow-hidden rounded-3xl bg-white shadow-2xl">
              {/* —— 顶部进度条 + 关闭按钮 —— */}
              <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-violet-50/70 to-purple-50/70 px-8 py-4">
                <div className="flex items-center gap-2">
                  <Timer className="h-4 w-4 text-violet-600" />
                  <span className="text-sm font-bold text-slate-700">
                    第 <span className="text-violet-600">{reciteIndex + 1}</span> / {words.length} 个
                  </span>
                </div>
                <button
                  onClick={reciteClose}
                  title="退出计时背诵"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {/* 顶部进度条 */}
              <div className="h-1 w-full bg-slate-100">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all"
                  style={{ width: `${((reciteIndex) / Math.max(1, words.length)) * 100}%` }}
                />
              </div>

              {/* —— 单词展示区 —— 倒计时环居中置于顶部，内容根据模式展示 */}
              <div className="px-8 py-8">
                {/* 顶部居中：圆形倒计时 + 标星状态 */}
                <div className="mb-6 flex flex-col items-center">
                  <div className="relative h-20 w-20">
                    <svg className="h-20 w-20 -rotate-90" viewBox="0 0 36 36">
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none" stroke="#e2e8f0" strokeWidth="3"
                      />
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke={isUrgent ? '#f43f5e' : '#8b5cf6'}
                        strokeWidth="3"
                        strokeDasharray={`${pct * 100}, 100`}
                        className="transition-all"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={cn(
                        'font-mono text-2xl font-black tabular-nums',
                        isUrgent ? 'text-rose-500' : 'text-violet-600'
                      )}>
                        {reciteRemaining}
                      </span>
                    </div>
                  </div>
                  {starred && (
                    <div className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-600">
                      <Star className="h-3 w-3 fill-current" />
                      已标星
                    </div>
                  )}
                </div>

                {/* —— 根据背诵模式显示不同内容 —— */}
                {isWordMeaningMode ? (
                  // ===== 看词说意：正面显示单词，上方播放发音，下方点击查看释义 =====
                  <div className="text-center">
                    <p className="break-words text-4xl font-black tracking-tight text-slate-900">
                      {cur.word}
                    </p>
                    <div className="mx-auto my-4 h-px w-16 bg-violet-200" />
                    {/* 上方：播放发音按钮 */}
                    <button
                      onClick={() => void playWordAudio(cur.word)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-violet-50 px-4 py-2 text-sm font-medium text-violet-600 transition-all hover:bg-violet-100 hover:scale-105"
                      title="播放发音"
                    >
                      <Volume2 className="h-4 w-4" />
                      播放发音
                    </button>
                    {/* 下方：点击查看释义 / 已展开则显示释义（按钮文字大小与释义一致，仅透明度降低） */}
                    <div className="mt-3 min-h-[1.75rem]">
                      {reciteRevealed ? (
                        <p className="break-words text-xl leading-relaxed text-slate-700">
                          {cur.meaning}
                        </p>
                      ) : (
                        <button
                          onClick={() => setReciteRevealed(true)}
                          className="text-xl leading-relaxed text-slate-400 opacity-40 transition-opacity hover:opacity-100"
                        >
                          点击查看释义
                        </button>
                      )}
                    </div>
                  </div>
                ) : isMeaningWordMode ? (
                  // ===== 看意说词：正面显示释义，上方播放发音，下方点击查看单词 =====
                  <div className="text-center">
                    <p className="break-words text-2xl font-bold tracking-tight leading-snug text-slate-900">
                      {cur.meaning}
                    </p>
                    <div className="mx-auto my-4 h-px w-16 bg-violet-200" />
                    {/* 上方：播放发音按钮 */}
                    <button
                      onClick={() => void playWordAudio(cur.word)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-violet-50 px-4 py-2 text-sm font-medium text-violet-600 transition-all hover:bg-violet-100 hover:scale-105"
                      title="播放发音"
                    >
                      <Volume2 className="h-4 w-4" />
                      播放发音
                    </button>
                    {/* 下方：点击查看单词 / 已展开则显示单词（按钮文字大小与单词一致，仅透明度降低） */}
                    <div className="mt-3 min-h-[2.5rem]">
                      {reciteRevealed ? (
                        <p className="break-words text-4xl font-black tracking-tight text-slate-900">
                          {cur.word}
                        </p>
                      ) : (
                        <button
                          onClick={() => setReciteRevealed(true)}
                          className="text-4xl font-black tracking-tight text-slate-400 opacity-40 transition-opacity hover:opacity-100"
                        >
                          点击查看单词
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  // ===== 听音辨义：上方播放发音，下方点击查看单词+释义 =====
                  <div className="text-center">
                    {/* 上方：大号播放发音按钮 */}
                    <button
                      onClick={() => void playWordAudio(cur.word)}
                      className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-lg shadow-purple-200 transition hover:scale-105"
                      title="点击播放发音"
                    >
                      <Volume2 className="h-12 w-12" />
                    </button>
                    <p className="mt-4 text-sm font-medium text-slate-500">
                      点击喇叭播放发音，尝试回想单词和释义
                    </p>
                    {/* 下方：点击查看单词和释义 / 已展开则显示（按钮文字大小与单词一致，仅透明度降低） */}
                    <div className="mt-4 min-h-[2.5rem]">
                      {reciteRevealed ? (
                        <div>
                          <p className="break-words text-4xl font-black tracking-tight text-slate-900">
                            {cur.word}
                          </p>
                          <div className="mx-auto my-4 h-px w-16 bg-violet-200" />
                          <p className="break-words text-xl leading-relaxed text-slate-700">
                            {cur.meaning}
                          </p>
                        </div>
                      ) : (
                        <button
                          onClick={() => setReciteRevealed(true)}
                          className="text-4xl font-black tracking-tight text-slate-400 opacity-40 transition-opacity hover:opacity-100"
                        >
                          显示单词和释义
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* —— 底部操作按钮区（仅记住 / 标星，导航箭头已移至卡片两侧） —— */}
              <div className="border-t border-slate-100 bg-slate-50/60 px-8 py-5">
                <div className="flex gap-3">
                  <button
                    onClick={reciteRemember}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3.5 text-base font-bold text-white shadow-lg shadow-emerald-200 transition-all hover:shadow-xl hover:shadow-emerald-300 active:translate-y-0.5',
                      reciteKeyPressed === 'remember' && 'scale-95 brightness-110 shadow-inner translate-y-0.5'
                    )}
                  >
                    <Check className="h-5 w-5" />
                    记住
                  </button>
                  <button
                    onClick={reciteMark}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 py-3.5 text-base font-bold text-white shadow-lg shadow-orange-200 transition-all hover:shadow-xl hover:shadow-orange-300 active:translate-y-0.5',
                      reciteKeyPressed === 'mark' && 'scale-95 brightness-110 shadow-inner translate-y-0.5'
                    )}
                  >
                    <Star className="h-5 w-5" />
                    标星
                  </button>
                </div>
                {/* 快捷键提示 */}
                <p className="mt-3 text-center text-[11px] text-slate-400">
                  快捷键：← 上一词 · → 下一词 · ↑ 记住 · ↓ 标星 · 空格 查看释义
                </p>
              </div>
              </div>

              {/* 右侧：下一词（仅图标） */}
              <button
                onClick={reciteNext}
                disabled={reciteIndex >= words.length - 1}
                title="下一词（→）"
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-lg transition-all sm:h-12 sm:w-12',
                  reciteIndex >= words.length - 1
                    ? 'cursor-not-allowed bg-slate-200/80 text-slate-300'
                    : 'bg-white text-slate-600 hover:bg-violet-50 hover:text-violet-600 hover:scale-110 active:translate-y-0.5'
                )}
              >
                <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ========================================================================
 *  单词拼写题目的 UI 组件（内联定义，方便复用）
 *  封装：进度条 + 15秒倒计时环 + 题目区（释义 / 发音按钮） + 输入框 + 提交结果反馈
 * ====================================================================== */
interface SpellingListUIProps {
  words: StudyWord[];
  spellingSubMode: SpellingSubMode;
  answers: string[];
  setAnswers: (index: number, value: string) => void;
  locked: boolean[];
  setLocked: React.Dispatch<React.SetStateAction<boolean[]>>;
  results: (boolean | null)[];
  setResults: React.Dispatch<React.SetStateAction<(boolean | null)[]>>;
  setWrongRecords: React.Dispatch<React.SetStateAction<{ word: StudyWord; userAnswer: string; isTimeout: boolean; isChinese?: boolean; }[]>>;
  perWordTimers: number[];
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  hintVisible: boolean;
  inputRefs: React.RefObject<(HTMLInputElement | null)[]>;
  onSubmitWord: (index: number) => void;
  onFocusWord: (index: number) => void;
  // 检测到某个单词使用了中文输入法时回调（用于标记该单词判错）
  onChineseInput: (index: number) => void;
  playingUid: string | null;
  onSubmit: () => void;
  stats: { correct: number; wrong: number; timeout: number };
  totalElapsedMs: number;
  formatTotalTime: (ms: number) => string;
}

function SpellingListUI(props: SpellingListUIProps) {
  const {
    words, spellingSubMode, answers, setAnswers, locked, setLocked, results, setResults,
    setWrongRecords, perWordTimers, currentIndex, setCurrentIndex, hintVisible,
    inputRefs, onSubmitWord, onFocusWord, onChineseInput, playingUid, onSubmit, stats,
    totalElapsedMs, formatTotalTime,
  } = props;

  const maxSeconds = 15;

  const hasFocusedRef = useRef<boolean[]>(new Array(words.length).fill(false));

  // 检测到中文（IME 合成）输入时的提示：提醒用户切换为英文输入法
  // 记录触发提示的输入框索引；-1 表示不显示
  const [imeWarnIndex, setImeWarnIndex] = useState<number>(-1);
  const imeWarnTimerRef = useRef<number | null>(null);

  // 弹出「请切换英文输入法」提示，并在数秒后自动消失
  const showImeWarn = (index: number) => {
    setImeWarnIndex(index);
    if (imeWarnTimerRef.current) {
      window.clearTimeout(imeWarnTimerRef.current);
    }
    imeWarnTimerRef.current = window.setTimeout(() => {
      setImeWarnIndex(-1);
    }, 2500);
  };

  const handleInputChange = (index: number, value: string) => {
    if (!locked[index]) {
      // 清洗输入：只保留英文字母、空格及常见半角标点，过滤中文/全角字符。
      // 说明：始终执行清洗（不因合成态而 return），避免标志位卡死导致英文无法输入。
      // 中文/IME 相关内容的最终拦截与提示由 onCompositionEnd 负责。
      const filtered = value.replace(SPELLING_DISALLOWED_RE, '');
      setAnswers(index, filtered);
    }
  };

  const handleInputFocus = (index: number) => {
    if (!locked[index]) {
      setCurrentIndex(index);
      onFocusWord(index);
      
      for (let i = 0; i < index; i++) {
        if (!locked[i]) {
          setLocked((prev) => {
            const next = [...prev];
            next[i] = true;
            return next;
          });
          setResults((prev) => {
            const next = [...prev];
            next[i] = false;
            return next;
          });
          setWrongRecords((prev) => [
            ...prev,
            {
              word: words[i],
              userAnswer: '',
              isTimeout: false,
            },
          ]);
        }
      }
      
      if (spellingSubMode === 'audio-spelling' && !hasFocusedRef.current[index]) {
        hasFocusedRef.current[index] = true;
        const cur = words[index];
        if (cur) {
          setTimeout(() => {
            void playWordAudio(cur.word);
          }, 100);
        }
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!locked[index] && answers[index].trim()) {
        onSubmitWord(index);
      }
    }
    
    if (e.key === 'Tab') {
      e.preventDefault();
      const nextIndex = Math.min(index + 1, words.length - 1);
      if (locked[index]) {
        setCurrentIndex(nextIndex);
        requestAnimationFrame(() => {
          inputRefs.current[nextIndex]?.focus();
        });
      }
    }
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
      <div className="fixed top-20 right-6 z-50 rounded-2xl border border-slate-200 bg-white/95 px-6 py-4 shadow-xl backdrop-blur">
        <div className="flex items-center justify-between gap-8">
          <div className="text-left">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              当前进度
            </p>
            <p className="font-mono text-lg font-extrabold text-indigo-600">
              {currentIndex} / {words.length}
            </p>
          </div>
          <div className="h-8 w-px bg-slate-200" />
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              总用时
            </p>
            <p className="font-mono text-lg font-extrabold text-indigo-600">
              {formatTotalTime(totalElapsedMs)}
            </p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <div className="text-center">
              <p className="text-xs font-medium text-slate-500">正确</p>
              <p className="font-mono text-lg font-bold text-emerald-600">{stats.correct}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-slate-500">错误</p>
              <p className="font-mono text-lg font-bold text-rose-500">{stats.wrong}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-slate-500">准确率</p>
              <p className="font-mono text-lg font-bold text-indigo-600">
                {stats.correct + stats.wrong > 0 ? Math.round((stats.correct / (stats.correct + stats.wrong)) * 100) : 0}%
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="h-1.5 w-full bg-slate-100">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 via-blue-500 to-sky-500 transition-all"
          style={{ width: `${(currentIndex / Math.max(1, words.length)) * 100}%` }}
        />
      </div>

      <div className="border-b border-slate-100 bg-gradient-to-r from-indigo-50/60 via-blue-50/60 to-sky-50/60 px-6 py-4">
        <div className="flex items-center">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              单词拼写模式
            </p>
            <p className="mt-0.5 text-lg font-extrabold tabular-nums text-slate-800">
              共 <span className="text-indigo-600">{words.length}</span> 个单词
            </p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {words.map((word, index) => {
          const answer = answers[index] || '';
          const isLocked = locked[index];
          const result = results[index];
          const timer = perWordTimers[index] || 0;
          const isCurrent = !isLocked && index === currentIndex;
          const firstLetter = word.word.charAt(0);
          const letterCount = word.word.length;
          const pct = Math.max(0, Math.min(1, timer / maxSeconds));
          const nowCorrect = result === true;
          const nowWrong = result === false;

          return (
            <div
              key={word.uid}
              className={cn(
                'px-6 py-5 transition-all',
                isCurrent ? 'bg-indigo-50/30' : '',
                isLocked && nowCorrect ? 'bg-emerald-50/30' : '',
                isLocked && nowWrong ? 'bg-rose-50/30' : ''
              )}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold',
                  isCurrent ? 'bg-indigo-100 text-indigo-700' :
                  nowCorrect ? 'bg-emerald-100 text-emerald-700' :
                  nowWrong ? 'bg-rose-100 text-rose-700' :
                  'bg-slate-100 text-slate-600'
                )}>
                  {index + 1}
                </span>
                <span className="text-xs font-medium text-slate-500">{word.sheetName}</span>
              </div>

              {spellingSubMode === 'meaning-spelling' ? (
                <>
                  <p className="text-lg font-semibold text-slate-800 mb-2">{word.meaning}</p>
                  <div className="flex items-center gap-4 mb-4 text-sm text-slate-600">
                    {isCurrent && timer > 0 && (
                      <div className="relative h-8 w-8 shrink-0">
                        <svg className="h-8 w-8 -rotate-90" viewBox="0 0 36 36">
                          <path
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none" stroke="#e2e8f0" strokeWidth="3"
                          />
                          <path
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke={timer <= 3 ? '#f43f5e' : '#4f46e5'}
                            strokeWidth="3"
                            strokeDasharray={`${pct * 100}, 100`}
                            className="transition-all"
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className={cn('text-[10px] font-bold', timer <= 3 ? 'text-rose-500' : 'text-slate-800')}>
                            {timer}
                          </span>
                        </div>
                      </div>
                    )}
                    {hintVisible && (
                      <>
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-mono font-bold text-indigo-700">
                          <span>首字母：{firstLetter}</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                          共 {letterCount} 个字母
                        </span>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    {timer > 0 && (
                      <div className="relative h-8 w-8 shrink-0">
                        <svg className="h-8 w-8 -rotate-90" viewBox="0 0 36 36">
                          <path
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none" stroke="#e2e8f0" strokeWidth="3"
                          />
                          <path
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke={timer <= 3 ? '#f43f5e' : '#4f46e5'}
                            strokeWidth="3"
                            strokeDasharray={`${pct * 100}, 100`}
                            className="transition-all"
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className={cn('text-[10px] font-bold', timer <= 3 ? 'text-rose-500' : 'text-slate-800')}>
                            {timer}
                          </span>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setCurrentIndex(index);
                        const cur = words[index];
                        if (cur) {
                          void playWordAudio(cur.word);
                        }
                      }}
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition',
                        playingUid === word.uid
                          ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white animate-pulse'
                          : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'
                      )}
                      title="点击播放发音"
                    >
                      <Volume2 className="h-4 w-4" />
                    </button>
                    {hintVisible && (
                      <>
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-mono font-bold text-indigo-700">
                          首字母：{firstLetter}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                          共 {letterCount} 个字母
                        </span>
                      </>
                    )}
                  </div>
                </>
              )}

              <div className="relative">
                <input
                  ref={(el) => { inputRefs.current[index] = el; }}
                  type="text"
                  value={answer}
                  disabled={isLocked}
                  onChange={(e) => handleInputChange(index, e.target.value)}
                  onFocus={() => handleInputFocus(index)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  onCompositionStart={() => {
                    // IME 合成一开始（在中文输入法下敲下第一个字母就会触发），
                    // 立即判定该单词使用了中文输入法：标记为错误 + 弹出「请切换英文输入法」提示。
                    // 这样哪怕只在中文输入法下输入一个字母，也会按错误计算。
                    if (locked[index]) return;
                    onChineseInput(index);
                    showImeWarn(index);
                  }}
                  onCompositionEnd={() => {
                    // 合成结束再兜底标记一次（防止某些输入法不触发 start）。
                    // 此处不撤销输入内容（允许保留），核对时一律判为错误。
                    if (locked[index]) return;
                    onChineseInput(index);
                    showImeWarn(index);
                  }}
                  onPaste={(e) => {
                    // 禁止粘贴，只能一个一个字母手动输入
                    e.preventDefault();
                  }}
                  onCopy={(e) => {
                    // 禁止复制
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    // 禁止拖拽文本进入输入框
                    e.preventDefault();
                  }}
                  inputMode="text"
                  lang="en"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={isLocked ? '' : '输入单词...'}
                  className={cn(
                    'w-full rounded-xl border px-4 py-3 font-mono text-base font-semibold outline-none transition-all',
                    isLocked
                      ? nowCorrect
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-rose-300 bg-rose-50 text-rose-800'
                      : isCurrent
                        ? 'border-indigo-300 bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
                        : 'border-slate-200 bg-slate-50/50 text-slate-800'
                  )}
                />
                {isLocked && (
                  <div className={cn(
                    'absolute right-3 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full text-white',
                    nowCorrect ? 'bg-emerald-500' : 'bg-rose-500'
                  )}>
                    {nowCorrect ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                  </div>
                )}
              </div>

              {imeWarnIndex === index && !isLocked && (
                <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                  <span>⚠️</span>
                  <span>检测到中文输入法，请切换为英文输入法！本词已判为错误。</span>
                </div>
              )}

              {isLocked && nowWrong && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                  <div className="flex items-start gap-2 text-sm">
                    <span className="text-xs font-medium text-rose-500">正确答案：</span>
                    <span className="font-mono font-extrabold text-slate-800">{word.word}</span>
                    {answer && (
                      <>
                        <span className="text-slate-400">·</span>
                        <span className="font-mono text-rose-600 line-through">你的答案：{answer}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-100 bg-gradient-to-r from-indigo-50/60 via-blue-50/60 to-sky-50/60 px-6 py-4">
        <button
          onClick={onSubmit}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-600 px-6 py-3 text-base font-bold text-white shadow-lg shadow-indigo-200 transition-all hover:shadow-xl hover:shadow-indigo-300 active:translate-y-0.5"
        >
          <Send className="h-5 w-5" />
          提交答案
        </button>
      </div>
    </div>
  );
}
