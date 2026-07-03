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
import { useEffect, useMemo, useState, useCallback } from 'react';
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
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { playWordAudio } from '@/utils/audioUtils';
import type { WordItem, StudyMode } from '@/types';
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
  // 初始化副作用（useEffect）
  // =========================

  /**
   * 初始化/重置学习页状态
   *   触发条件：词书、选中单词表、派生单词列表发生变化（即进入页面或重新选择时）
   *   行为：
   *     1. 若未选择词书或单词表为空，说明是非法进入，重定向回 /select 选择页；
   *     2. 否则：重置 words 为 baseWords（恢复初始顺序）、
   *              清空 revealedMap（所有卡片回到未展开）、
   *              allRevealed 回到 false。
   */
  useEffect(() => {
    if (!currentBook || selectedSheetIds.length === 0) {
      navigate('/select');
      return;
    }
    setWords(baseWords);
    setRevealedMap({});
    setAllRevealed(false);
  }, [currentBook, selectedSheetIds, baseWords, navigate]);

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

  // 根据当前模式计算顶部显示的文案和图标
  const titleModeLabel = mode === 'word-meaning' ? '看词说意' : '听音辨义';
  const titleModeIcon = mode === 'word-meaning' ? Eye : Headphones;
  const TitleIcon = titleModeIcon;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 pb-12">
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
            {/* 彩色渐变图标（看词=眼睛，听音=耳机） */}
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
          {/* 右：两个操作按钮 - 一键显隐释义 + 乱序 */}
          <div className="flex items-center gap-2">
            {/* 一键显示/隐藏所有释义按钮
                allRevealed=true 时显示"隐藏释义"（高亮渐变），否则显示"显示释义"（白色描边） */}
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
            {/* 乱序按钮：点击后重新随机排列单词 */}
            <button
              onClick={doShuffle}
              title="乱序排列"
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-indigo-700"
            >
              <Shuffle className="h-4 w-4" />
              <span className="hidden sm:inline">乱序</span>
            </button>
          </div>
        </div>
      </div>

      {/* 主内容区：响应式卡片网格（默认1列，sm=2列，lg=3列），根据mode切换看词说意/听音辨义卡片 */}
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
                        {/* 发音按钮
                            - e.stopPropagation()：避免触发外层 toggleReveal
                            - 播放中（playingUid === w.uid）：橙黄渐变 + pulse 动画
                            - 未播放：靛蓝浅色底，hover 放大 */}
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
                            // 已展开：显示中文释义文本
                            <p className="text-sm leading-relaxed text-slate-700">{w.meaning}</p>
                          ) : (
                            // 未展开：眼睛图标 + 操作提示（点击这行也能展开）
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
        ) : (
          // 模式 B：听音辨义 - 卡片头+大号发音按钮+展开区(单词+释义)，发音按钮用stopPropagation阻止冒泡误触卡片
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {words.map((w, idx) => {
              const revealed = !!revealedMap[w.uid];
              return (
                <div
                  key={w.uid}
                  // 整张卡片可点击，用于切换展开/收起
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
                    {/* 居中的大号发音按钮
                        - 高度/宽度 80px，圆形方形倒角（rounded-3xl）
                        - 播放中：橙→玫红渐变 + pulse
                        - 未播放：靛蓝→天蓝渐变，hover 轻微放大 */}
                    <div className="flex justify-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();  // 阻止冒泡，避免触发卡片的 toggleReveal
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
                          // 已展开：居中显示 [单词] 分隔线 [释义]
                          <div className="space-y-3 text-center">
                            <p className="text-2xl font-bold tracking-tight text-slate-900">
                              {w.word}
                            </p>
                            <div className="mx-auto h-px w-12 bg-indigo-200" />
                            <p className="text-sm leading-relaxed text-slate-700">{w.meaning}</p>
                          </div>
                        ) : (
                          // 未展开：提示用户"点击卡片显示答案"
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
