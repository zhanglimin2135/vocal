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
  SkipForward,
  Timer,
  Trophy,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { playWordAudio } from '@/utils/audioUtils';
import type { WordItem, StudyMode, SpellingSubMode } from '@/types';
import { cn, generateId } from '@/lib/utils';

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

  // 当前学习模式：默认看词说意
  const mode: StudyMode = studyConfig?.mode || 'word-meaning';
  // 用户勾选的单词表 id 列表
  const selectedSheetIds = studyConfig?.selectedSheetIds || [];
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

  // =========================
  // 【单词拼写模式】专属状态
  // =========================

  /**
   * spellingIndex - 拼写模式当前做到第几个单词（words 数组下标）
   *   拼写模式是按顺序一个一个单词过，不像其他模式是平铺卡片
   */
  const [spellingIndex, setSpellingIndex] = useState(0);

  /**
   * spellingInput - 当前单词用户在输入框里打了什么内容
   */
  const [spellingInput, setSpellingInput] = useState('');

  /**
   * spellingSubmitted - 当前单词是否已提交
   *   - null：还没提交（可输入+可提交）
   *   - true：提交且正确
   *   - false：提交错误
   */
  const [spellingSubmitted, setSpellingSubmitted] = useState<boolean | null>(null);

  /**
   * perWordTimer - 当前单词的剩余秒数（每个单词最多 10 秒）
   *   到 0 时自动判错并跳过到下一个
   */
  const [perWordTimer, setPerWordTimer] = useState(10);
  const PER_WORD_SECONDS = 10;

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
  }
  const [wrongRecords, setWrongRecords] = useState<WrongRecord[]>([]);

  /**
   * hintVisible - 释义拼写模式下的"首字母提示"是否显示
   *   默认显示（按用户需求：输入框内提示首字母）；一键隐藏按钮可隐藏它
   */
  const [hintVisible, setHintVisible] = useState(true);

  // 用于自动 focus 输入框的 ref
  const spellingInputRef = useRef<HTMLInputElement>(null);
  // 整体计时器 ID（引用，用于卸载时清理）
  const totalTimerRef = useRef<number | null>(null);
  // 单单词倒计时 ID
  const perWordTimerRef = useRef<number | null>(null);

  /**
   * 拼写输入规范化（供正确性比对用）：
   *   - 去掉所有空格
   *   - 全部转成小写
   *   这样 "Apple " " apple"  "APPLE" 都会被判定为和 apple 相同
   */
  const normalizeSpelling = (s: string) => s.replace(/\s+/g, '').toLowerCase();

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
    // 看词说意/听音辨义：保持原表顺序；单词拼写：选择子模式后出现的检测词直接乱序
    setWords(mode === 'spelling' ? shuffleArray(baseWords) : baseWords);
    setRevealedMap({});
    setAllRevealed(false);
    // —— 拼写模式初始化 ——
    setSpellingIndex(0);
    setSpellingInput('');
    setSpellingSubmitted(null);
    setPerWordTimer(PER_WORD_SECONDS);
    setTotalElapsedMs(0);
    setStats({ correct: 0, wrong: 0, timeout: 0 });
    setWrongRecords([]);
    setHintVisible(true);
    setPlayingUid(null);
  }, [currentBook, selectedSheetIds, baseWords, navigate, PER_WORD_SECONDS, mode]);

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
   * doShuffle - 对当前单词列表执行一次随机乱序
   *   实现：使用函数式 setWords，将 prev 传入 shuffleArray 得到新顺序。
   */
  const doShuffle = useCallback(() => {
    setWords((prev) => shuffleArray(prev));
  }, []);

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
   * 跳到下一个单词（或完成）
   *   - 重置单单词倒计时为 10s
   *   - 清空输入框
   *   - 重置提交状态
   *   - 自动 focus 输入框
   */
  const goNextSpellingWord = useCallback(() => {
    setSpellingIndex((prev) => Math.min(prev + 1, words.length));
    setSpellingInput('');
    setSpellingSubmitted(null);
    setPerWordTimer(PER_WORD_SECONDS);
    setHintVisible(true);
    // 下一帧 focus 输入框（等待 DOM 渲染）
    requestAnimationFrame(() => {
      spellingInputRef.current?.focus();
    });
  }, [words.length, PER_WORD_SECONDS]);

  /**
   * 提交当前拼写答案
   *   - 规范化：去空格 + 小写
   *   - 判定正确/错误，更新统计
   *   - 听音拼写模式下，提交后再播放一遍发音作对照
   */
  const submitSpelling = useCallback(() => {
    const cur = words[spellingIndex];
    if (!cur || spellingSubmitted !== null) return;
    const userAns = normalizeSpelling(spellingInput);
    const rightAns = normalizeSpelling(cur.word);
    const correct = userAns === rightAns;
    setSpellingSubmitted(correct);
    setStats((prev) => ({
      ...prev,
      correct: prev.correct + (correct ? 1 : 0),
      wrong: prev.wrong + (correct ? 0 : 1),
    }));
    // 错题收集：正确答案不收集，错误加入 wrongRecords
    if (!correct) {
      setWrongRecords((prev) => [
        ...prev,
        {
          word: cur,
          userAnswer: spellingInput,
          isTimeout: false,
        },
      ]);
    }
    // 提交正确后：听音拼写模式下额外播放一次发音
    if (spellingSubMode === 'audio-spelling') {
      void playCurrentSpellingWord();
    }
  }, [words, spellingIndex, spellingSubmitted, spellingInput, spellingSubMode, playCurrentSpellingWord]);

  /**
   * （仅乱序时）重置拼写到第 0 个词，因为乱序后列表变了
   */
  const resetSpellingAfterShuffle = useCallback(() => {
    setSpellingIndex(0);
    setSpellingInput('');
    setSpellingSubmitted(null);
    setPerWordTimer(PER_WORD_SECONDS);
    setHintVisible(true);
    requestAnimationFrame(() => spellingInputRef.current?.focus());
  }, [PER_WORD_SECONDS]);

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
   *   当所有单词完成时（spellingIndex === words.length）暂停计时
   */
  useEffect(() => {
    if (mode !== 'spelling') return;
    if (spellingIndex >= words.length) return; // 全部做完就停表
    totalTimerRef.current = window.setInterval(() => {
      setTotalElapsedMs((t) => t + 100);
    }, 100);
    return () => {
      if (totalTimerRef.current !== null) {
        window.clearInterval(totalTimerRef.current);
        totalTimerRef.current = null;
      }
    };
  }, [mode, spellingIndex, words.length]);

  /**
   * 每词 10 秒倒计时：仅拼写模式下运行，每 1 秒 -1
   *   - 到 0 时：判为超时错误，自动统计并跳到下一题
   *   - 已提交（spellingSubmitted!==null）暂停倒计时
   */
  useEffect(() => {
    if (mode !== 'spelling') return;
    if (spellingIndex >= words.length) return;
    if (spellingSubmitted !== null) return;
    perWordTimerRef.current = window.setInterval(() => {
      setPerWordTimer((prev) => {
        if (prev <= 1) {
          // 倒计时结束：记为超时错误，自动跳下一单词
          setStats((s) => ({ ...s, timeout: s.timeout + 1, wrong: s.wrong + 1 }));
          // 收集超时错题
          const curWord = words[spellingIndex];
          if (curWord) {
            setWrongRecords((prevR) => [
              ...prevR,
              {
                word: curWord,
                userAnswer: '',
                isTimeout: true,
              },
            ]);
          }
          setSpellingSubmitted(false);
          // 下一帧跳下一题（避免和 interval 同帧冲突）
          setTimeout(() => {
            if (spellingIndex + 1 < words.length) {
              goNextSpellingWord();
            }
          }, 1200);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (perWordTimerRef.current !== null) {
        window.clearInterval(perWordTimerRef.current);
        perWordTimerRef.current = null;
      }
    };
  }, [mode, spellingIndex, spellingSubmitted, words.length, goNextSpellingWord]);

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
    requestAnimationFrame(() => spellingInputRef.current?.focus());
  }, [mode, spellingIndex]);

  /**
   * 拼写模式：全局回车键快捷键（window 级别）
   *   - 未提交 spellingSubmitted == null → 回车 = 提交
   *   - 已提交 spellingSubmitted != null → 回车 = 下一题
   * 作用：即使输入框 disabled 或失焦状态也能响应回车
   */
  useEffect(() => {
    if (mode !== 'spelling') return;
    if (spellingIndex >= words.length) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      // 如果当前焦点在输入框里，交给输入框自身 onKeyDown 处理即可（避免重复触发）
      const active = document.activeElement;
      if (active && active.tagName === 'INPUT' && spellingInputRef.current === active) {
        return;
      }
      // 如果用户焦点在按钮（提交按钮/下一题按钮），也不要抢默认行为
      if (active && active.tagName === 'BUTTON') return;
      if (spellingSubmitted === null) {
        // 空输入就不做提交（保持按钮禁用的一致性）
        if (!spellingInput.trim()) return;
        submitSpelling();
      } else {
        goNextSpellingWord();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    mode, spellingIndex, words.length,
    spellingSubmitted, spellingInput, submitSpelling, goNextSpellingWord,
  ]);

  // 统一总毫秒数格式化：mm:ss.S（分:秒.1位小数）
  const formatTotalTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    const tenths = Math.floor((ms % 1000) / 100);
    return `${mm}:${ss}.${tenths}`;
  };

  // 返回选择页
  const goBack = () => navigate('/select');

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

  // 根据当前模式计算顶部显示的文案和图标（新增单词拼写模式）
  const titleModeLabel: string =
    mode === 'word-meaning'
      ? '看词说意'
      : mode === 'spelling'
        ? spellingSubMode === 'meaning-spelling'
          ? '单词拼写 · 释义拼写'
          : '单词拼写 · 听音拼写'
        : '听音辨义';
  const TitleIcon =
    mode === 'word-meaning' ? Eye : mode === 'spelling' ? PencilLine : Headphones;

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 pb-12">
      {/* ===============================================================
       *  拼写模式专属：整体计时器悬浮徽章
       *  - fixed 固定在视窗右下角，z-40，始终桌面显示，不随页面滚动消失
       *  - 显示总用时 + 进度 (已做/总数) + 正确/错误/超时统计
       *  其他模式不渲染这块
       * =============================================================== */}
      {mode === 'spelling' && (
        <div className="fixed bottom-5 right-5 z-40 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow">
              <Timer className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                总用时 · 进度 {Math.min(spellingIndex + (spellingSubmitted !== null ? 1 : 0), words.length)} / {words.length}
              </p>
              <p className="font-mono text-lg font-extrabold tabular-nums text-slate-800">
                {formatTotalTime(totalElapsedMs)}
              </p>
            </div>
            <div className="ml-1 flex flex-col items-end gap-0.5 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">
                <Check className="h-3 w-3" />
                {stats.correct}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700">
                <X className="h-3 w-3" />
                {stats.wrong}
                <span className="ml-0.5 text-[9px] opacity-70">({stats.timeout}超时)</span>
              </span>
            </div>
          </div>
        </div>
      )}

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
            {/* sm 及以上：显示模式名 + 词书名 + 单词总数 */}
            <div className="min-w-0 hidden sm:block">
              <p className="truncate text-sm font-semibold text-slate-800">{titleModeLabel}</p>
              <p className="truncate text-xs text-slate-500">
                {currentBook?.fileName} · {words.length} 个单词
              </p>
            </div>
            {/* sm 以下：显示精简的模式徽标 */}
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 sm:hidden">
              <Sparkles className="h-3 w-3" />
              {titleModeLabel}
            </span>
          </div>
          {/* 右：两个操作按钮
              - 看词说意/听音辨义：一键显隐释义
              - 拼写模式：切换"首字母提示/提示显示"（释义拼写切换提示，听音拼写切换音频提示说明显隐）
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
              <button
                onClick={toggleAllReveal}
                title={allRevealed ? '一键隐藏所有释义' : '一键显示所有释义'}
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
                    <span className="hidden sm:inline">隐藏释义</span>
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4" />
                    <span className="hidden sm:inline">显示释义</span>
                  </>
                )}
              </button>
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
          // 模式 A：看词说意 - 卡片头（序号徽标+词表名）+ 卡片体（单词+发音按钮 + 释义展开区）
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {words.map((w, idx) => {
              const revealed = !!revealedMap[w.uid];
              return (
                <div
                  key={w.uid}
                  className={cn(
                    'group overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg',
                    revealed ? 'border-indigo-200' : 'border-slate-200/80'
                  )}
                >
                  {/* 卡片头：渐变底条带，左侧序号徽标，右侧单词表名 */}
                  <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-indigo-50/70 via-blue-50/70 to-sky-50/70 px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-white/80 px-2 py-0.5 text-[11px] font-medium text-indigo-600">
                      <BookOpen className="h-3 w-3" />
                      {String(idx + 1).padStart(3, '0')}
                    </span>
                    <span className="truncate text-[11px] text-slate-500">{w.sheetName}</span>
                  </div>
                  {/* 卡片主体 */}
                  <div className="p-5">
                    {/* 整块可点击区域：点击切换 revealed（展开/收起释义） */}
                    <div
                      onClick={() => toggleReveal(w.uid)}
                      className="cursor-pointer select-none"
                    >
                      {/* 单词行 + 发音按钮 */}
                      <div className="flex items-start justify-between gap-2">
                        {/* 单词文本：大号粗体，hover 时变色 */}
                        <p className="flex-1 break-words text-2xl font-bold tracking-tight text-slate-900 transition group-hover:text-indigo-700">
                          {w.word}
                        </p>
                        {/* 发音按钮 */}
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
                      {/* 释义区域（可展开/收起） */}
                      <div className="mt-4">
                        <div
                          className={cn(
                            'overflow-hidden rounded-xl border transition-all duration-300',
                            revealed
                              ? 'max-h-60 border-indigo-100 bg-gradient-to-br from-indigo-50 to-blue-50 p-4 opacity-100'
                              : 'max-h-10 border-dashed border-slate-200 bg-slate-50/60 p-2 opacity-80'
                          )}
                        >
                          {revealed ? (
                            <p className="text-sm leading-relaxed text-slate-700">{w.meaning}</p>
                          ) : (
                            <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
                              <Eye className="h-3.5 w-3.5" />
                              点击单词或此处查看释义
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
                    'px-6 py-10 text-center text-white',
                    passed
                      ? 'bg-gradient-to-br from-emerald-500 via-teal-500 to-sky-600'
                      : 'bg-gradient-to-br from-rose-500 via-orange-500 to-amber-500'
                  )}
                >
                  <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white/15 backdrop-blur">
                    <Trophy className="h-10 w-10" />
                  </div>
                  {passed ? (
                    <>
                      <h2 className="text-2xl font-extrabold sm:text-3xl">🎉 恭喜你，闯关成功！</h2>
                      <p className="mt-2 text-sm text-white/90">
                        准确率 {accuracyStr}，超过 90% 合格线，太棒啦，继续保持！
                      </p>
                    </>
                  ) : (
                    <>
                      <h2 className="text-2xl font-extrabold sm:text-3xl">💪 很遗憾，再接再厉！</h2>
                      <p className="mt-2 text-sm text-white/90">
                        当前准确率 {accuracyStr}，合格线是 90%。别灰心，复习错题，再来一遍一定能过！
                      </p>
                    </>
                  )}
                  <p className="mt-3 text-xs text-white/80">
                    模式：单词拼写 · {modeText}　·　共 {words.length} 个单词　·　总用时{' '}
                    <span className="font-mono font-bold">{formatTotalTime(totalElapsedMs)}</span>
                  </p>
                </div>

                {/* —— 4 格统计卡（检查时间 / 检查内容 / 正确 / 错误 / 正确率 合并） —— */}
                <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
                  <div className="bg-white px-4 py-4 text-center">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      检查时间
                    </p>
                    <p className="mt-1 break-words text-sm font-bold text-slate-800">
                      {checkTimeStr}
                    </p>
                  </div>
                  <div className="bg-white px-4 py-4 text-center sm:col-span-1">
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
                  <div className="bg-white px-4 py-4 text-center">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      正确
                    </p>
                    <p className="mt-1 font-mono text-2xl font-extrabold text-emerald-600">
                      {stats.correct}
                    </p>
                  </div>
                  <div className="bg-white px-4 py-4 text-center">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      错误
                    </p>
                    <p className="mt-1 font-mono text-2xl font-extrabold text-rose-500">
                      {stats.wrong}
                      <span className="ml-1 text-[10px] font-medium text-slate-400">
                        （{stats.timeout}超时）
                      </span>
                    </p>
                  </div>
                </div>

                {/* —— 单独一行：准确率大字（突出） —— */}
                <div className="border-y border-slate-100 bg-gradient-to-r from-indigo-50 via-blue-50 to-sky-50 px-6 py-4 text-center">
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
                <div className="px-6 py-6">
                  {wrongRecords.length === 0 ? (
                    <div className="rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/60 p-6 text-center">
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
                                  onClick={() => {
                                    setPlayingUid(rec.word.uid);
                                    void playWordAudio(rec.word.word).finally(() =>
                                      setPlayingUid((p) =>
                                        p === rec.word.uid ? null : p
                                      )
                                    );
                                  }}
                                  className={cn(
                                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition',
                                    playingUid === rec.word.uid
                                      ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow animate-pulse'
                                      : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                                  )}
                                  title="听正确发音"
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
                    onClick={resetSpellingAfterShuffle}
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
              // —— 单词拼写：单题作答界面 ——
              <SpellingCardUI
                index={spellingIndex}
                total={words.length}
                perWordTimer={perWordTimer}
                maxSeconds={PER_WORD_SECONDS}
                word={words[spellingIndex]}
                spellingSubMode={spellingSubMode!}
                spellingInput={spellingInput}
                setSpellingInput={(v) => {
                  setSpellingInput(v);
                  // 听音拼写：新题自动只播一次，输入框不再重复触发发音
                  // 如需重听，请点击右上角发音图标手动播放
                }}
                onInputFocus={() => {
                  // 听音拼写：输入框聚焦不再自动发音，避免打扰
                  // 请点击发音图标手动重听
                }}
                hintVisible={hintVisible}
                spellingSubmitted={spellingSubmitted}
                normalizeSpelling={normalizeSpelling}
                inputRef={spellingInputRef}
                onSubmit={submitSpelling}
                onNext={goNextSpellingWord}
                playing={playingUid === words[spellingIndex]?.uid}
                onManualPlay={playCurrentSpellingWord}
                isLastWord={spellingIndex + 1 >= words.length}
              />
            )}
          </div>
        ) : (
          // 模式 B：听音辨义 - 卡片头+大号发音按钮+展开区(单词+释义)
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {words.map((w, idx) => {
              const revealed = !!revealedMap[w.uid];
              return (
                <div
                  key={w.uid}
                  onClick={() => toggleReveal(w.uid)}
                  className={cn(
                    'group cursor-pointer overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg',
                    revealed ? 'border-indigo-200' : 'border-slate-200/80'
                  )}
                >
                  {/* 卡片头：左侧耳机图标 + 序号，右侧单词表名 */}
                  <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-indigo-50/70 via-blue-50/70 to-sky-50/70 px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-white/80 px-2 py-0.5 text-[11px] font-medium text-indigo-600">
                      <Headphones className="h-3 w-3" />
                      {String(idx + 1).padStart(3, '0')}
                    </span>
                    <span className="truncate text-[11px] text-slate-500">{w.sheetName}</span>
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
        )}
      </div>
    </div>
  );
}

/* ========================================================================
 *  单词拼写题目的 UI 组件（内联定义，方便复用）
 *  封装：进度条 + 10秒倒计时环 + 题目区（释义 / 发音按钮） + 输入框 + 提交结果反馈
 * ====================================================================== */
interface SpellingCardUIProps {
  index: number;                                // 当前第几个单词（从 0 开始）
  total: number;                                // 单词总数
  perWordTimer: number;                         // 当前单词剩余秒数
  maxSeconds: number;                           // 每词限时（=10）
  word: StudyWord;                              // 当前学习的单词
  spellingSubMode: SpellingSubMode;             // 子模式：释义拼写 / 听音拼写
  spellingInput: string;                        // 用户输入内容
  setSpellingInput: (v: string) => void;        // 修改输入
  onInputFocus: () => void;                     // 输入框获得焦点回调
  hintVisible: boolean;                         // 是否显示首字母提示
  spellingSubmitted: boolean | null;            // 提交结果 null/true/false
  normalizeSpelling: (s: string) => string;     // 规范化函数
  inputRef: React.RefObject<HTMLInputElement>;  // ref 自动 focus
  onSubmit: () => void;                         // 点击/回车提交
  onNext: () => void;                           // 进入下一题
  playing: boolean;                             // 是否正在播放发音
  onManualPlay: () => void;                     // 手动点播放发音
  isLastWord: boolean;                          // 是不是最后一个单词
}

function SpellingCardUI(props: SpellingCardUIProps) {
  const {
    index, total, perWordTimer, maxSeconds, word, spellingSubMode,
    spellingInput, setSpellingInput, onInputFocus, hintVisible, spellingSubmitted,
    normalizeSpelling, inputRef, onSubmit, onNext, playing, onManualPlay, isLastWord,
  } = props;
  // 首字母：取 word 第一个字符作为提示（取真实首字母，保留大小写）
  const firstLetter = word.word.length > 0 ? word.word.charAt(0) : '';
  // 规范化后的比较结果
  const correctWord = normalizeSpelling(word.word);
  const userWord = normalizeSpelling(spellingInput);
  const nowCorrect = userWord === correctWord && spellingSubmitted === true;
  const nowWrong = spellingSubmitted === false;
  // 倒计时进度（用于视觉进度条和圆环百分比）
  const pct = Math.max(0, Math.min(1, perWordTimer / maxSeconds));
  // 按下回车：若未提交则提交，若已提交则下一题
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (spellingSubmitted === null) onSubmit();
      else onNext();
    }
  };
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
      {/* 顶部：进度条 0%~100% （已做题数 / 总数） */}
      <div className="h-1.5 w-full bg-slate-100">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 via-blue-500 to-sky-500 transition-all"
          style={{ width: `${(index / Math.max(1, total)) * 100}%` }}
        />
      </div>
      {/* 头部：大字进度 + 倒计时环 + 所属词表名 */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-indigo-50/60 via-blue-50/60 to-sky-50/60 px-6 py-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            来自 · {word.sheetName}
          </p>
          <p className="mt-0.5 text-lg font-extrabold tabular-nums text-slate-800">
            第 <span className="text-indigo-600">{index + 1}</span> / {total} 题
          </p>
        </div>
        {/* 10秒倒计时圆环（SVG 绘制，外圈剩余，内圈数字） */}
        <div className="relative h-16 w-16 shrink-0">
          <svg className="h-16 w-16 -rotate-90" viewBox="0 0 36 36">
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none" stroke="#e2e8f0" strokeWidth="3"
            />
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke={perWordTimer <= 3 ? '#f43f5e' : '#4f46e5'}
              strokeWidth="3"
              strokeDasharray={`${pct * 100}, 100`}
              className="transition-all"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <Timer className={cn('mb-0.5 h-3 w-3', perWordTimer <= 3 ? 'text-rose-500 animate-pulse' : 'text-indigo-500')} />
            <span className={cn('text-center font-mono text-sm font-extrabold tabular-nums leading-none', perWordTimer <= 3 ? 'text-rose-500 animate-pulse' : 'text-slate-800')}>
              {perWordTimer}s
            </span>
          </div>
        </div>
      </div>

      {/* 题目区：释义拼写=显示中文释义；听音拼写=大号发音按钮 + 提示 */}
      <div className="px-6 pt-8">
        {spellingSubMode === 'meaning-spelling' ? (
          // —— 释义拼写模式 ——
          <div className="text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-indigo-500">
              释义拼写 · 根据中文释义写出对应的英文单词
            </p>
            <p className="text-2xl font-extrabold leading-snug text-slate-800 sm:text-3xl">
              {word.meaning}
            </p>
          </div>
        ) : (
          // —— 听音拼写模式 ——
          <div className="flex flex-col items-center">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-indigo-500">
              听音拼写 · 新题进入会自动播放一次发音
            </p>
            <button
              onClick={onManualPlay}
              className={cn(
                'mb-2 flex h-24 w-24 items-center justify-center rounded-3xl shadow-xl transition-all duration-200 hover:scale-105',
                playing
                  ? 'bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-white shadow-2xl shadow-orange-200 animate-pulse'
                  : 'bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white shadow-indigo-200 hover:shadow-2xl hover:shadow-indigo-300'
              )}
              title="点击手动播放发音"
            >
              <Volume2 className="h-12 w-12" />
            </button>
            <p className="mt-1 text-xs text-slate-500">
              没听清？点击上方喇叭图标再次播放发音
            </p>
          </div>
        )}
      </div>

      {/* 输入区：首字母提示 + 输入框 + 提交按钮 */}
      <div className="px-6 pb-4 pt-6">
        {/* 首字母提示行（可隐藏） */}
        {hintVisible && spellingSubmitted === null && (
          <p className="mb-2 text-xs font-medium text-slate-500">
            💡 首字母提示：{' '}
            <span className="inline-block rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-base font-extrabold text-indigo-700">
              {firstLetter}
            </span>
            <span className="ml-1 text-slate-400">
              （{word.word.length} 个字母，空格和大小写不影响正确性）
            </span>
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          {/* 输入框：未提交=可编辑，已提交=只读 */}
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={spellingInput}
              disabled={spellingSubmitted !== null}
              onChange={(e) => setSpellingInput(e.target.value)}
              onFocus={onInputFocus}
              onKeyDown={handleKeyDown}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={
                spellingSubmitted !== null
                  ? ''
                  : spellingSubMode === 'meaning-spelling'
                    ? '请输入对应的英文单词...'
                    : '在此输入听到的单词...'
              }
              className={cn(
                'w-full rounded-2xl border-2 px-5 py-4 font-mono text-xl font-semibold tracking-wide outline-none transition-all',
                spellingSubmitted === null
                  ? 'border-slate-200 bg-slate-50/50 text-slate-800 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100'
                  : nowCorrect
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-rose-300 bg-rose-50 text-rose-800'
              )}
            />
            {spellingSubmitted !== null && (
              <div
                className={cn(
                  'absolute right-4 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-white shadow',
                  nowCorrect ? 'bg-emerald-500' : 'bg-rose-500'
                )}
              >
                {nowCorrect ? <Check className="h-5 w-5" /> : <X className="h-5 w-5" />}
              </div>
            )}
          </div>
          {/* 按钮：未提交=提交答案；已提交=下一题/完成 */}
          {spellingSubmitted === null ? (
            <button
              onClick={onSubmit}
              disabled={spellingInput.trim().length === 0}
              className={cn(
                'flex items-center justify-center gap-2 rounded-2xl px-6 py-4 text-base font-bold text-white shadow-lg transition-all sm:min-w-[120px]',
                spellingInput.trim().length === 0
                  ? 'cursor-not-allowed bg-slate-300 shadow-none'
                  : 'bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-600 shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 active:translate-y-0.5'
              )}
            >
              <PencilLine className="h-5 w-5" />
              提交
            </button>
          ) : (
            <button
              onClick={onNext}
              className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-600 px-6 py-4 text-base font-bold text-white shadow-lg shadow-indigo-200 transition-all hover:shadow-xl hover:shadow-indigo-300 active:translate-y-0.5 sm:min-w-[140px]"
            >
              <SkipForward className="h-5 w-5" />
              {isLastWord ? '查看结果' : '下一题'}
            </button>
          )}
        </div>

        {/* 提交后：错误答案对照区 / 正确提示 */}
        {spellingSubmitted !== null && (
          <div
            className={cn(
              'mt-4 rounded-2xl border p-4',
              nowCorrect
                ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50'
                : 'border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50'
            )}
          >
            {nowCorrect ? (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <Check className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-bold text-emerald-800">回答正确！🎉</p>
                  <p className="text-sm text-emerald-700/80">
                    <span className="font-mono font-semibold">{word.word}</span>
                    <span className="mx-2 text-emerald-600/50">·</span>
                    {word.meaning}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white">
                  <X className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-rose-800">
                    {perWordTimer === 0 ? '⏰ 超时了，本题记为错误' : '回答错误'}
                  </p>
                  <div className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-rose-500/80">你的答案</p>
                      <p className="break-all font-mono font-semibold text-rose-700 line-through decoration-2">
                        {spellingInput || <span className="italic opacity-70">（空）</span>}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-500">正确答案</p>
                      <p className="break-all font-mono font-extrabold text-slate-800">
                        {word.word}
                      </p>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    中文释义：<span className="font-semibold text-slate-700">{word.meaning}</span>
                  </p>
                </div>
                {/* 对照后手动发音按钮 */}
                <button
                  onClick={onManualPlay}
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition',
                    playing
                      ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white animate-pulse'
                      : 'bg-rose-100 text-rose-600 hover:bg-rose-200'
                  )}
                  title="再听一遍正确发音"
                >
                  <Volume2 className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
