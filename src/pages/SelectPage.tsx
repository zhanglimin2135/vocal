/**
 * ============================================================
 * 页面：词表单元选择 + 学习模式选择（第 2 步）
 * ------------------------------------------------------------
 * 整体流程：
 *   1. 进入页面 → 从全局 Store 读取已选择的词汇书和学习配置
 *   2. 若未选择词汇书或无配置 → 跳转回首页或初始化配置
 *   3. 用户勾选/取消勾选要学习的 Sheet（词表单元），支持全选
 *   4. 用户选择学习模式：看词说意 / 听音辨义
 *   5. 点击「开始学习」跳转到 /study 学习页进行学习
 *   6. 点击「返回首页」清空当前词汇书并回到首页
 * ============================================================
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  FileSpreadsheet,
  Eye,
  Headphones,
  CheckSquare,
  Square,
  Sparkles,
  PencilLine,
  X,
  MessageSquareText,
  Volume2,
  Shuffle,
  Dices,
  Search,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { LookSubMode, SpellingFlow, SpellingSubMode, StudyMode } from '@/types';
import { cn, canUseForcedFullscreen } from '@/lib/utils';

export default function SelectPage() {
  // useNavigate：react-router-dom 提供的 Hook，用于编程式路由跳转
  const navigate = useNavigate();
  // useAppStore：Zustand 全局状态管理 Hook，批量从 Store 订阅状态和操作函数
  const vocabularyBooks = useAppStore((s) => s.vocabularyBooks);           // 所有已上传的词汇书列表
  const currentBookId = useAppStore((s) => s.currentBookId);                // 当前选中的词汇书 ID
  const studyConfig = useAppStore((s) => s.studyConfig);                    // 学习配置（已选单元 ID + 学习模式）
  const setCurrentBook = useAppStore((s) => s.setCurrentBook);              // 切换当前词汇书的 Action
  const toggleSelectedSheetId = useAppStore((s) => s.toggleSelectedSheetId);// 切换单个 Sheet 选中状态的 Action
  const setStudyConfig = useAppStore((s) => s.setStudyConfig);              // 设置学习配置的 Action

  // 「单词拼写」子模式弹窗的开关状态：true=显示弹窗
  const [spellingModalOpen, setSpellingModalOpen] = useState(false);
  // 「看词说意/看意说词」子模式弹窗的开关状态：true=显示弹窗
  const [lookModalOpen, setLookModalOpen] = useState(false);
  // 单元搜索关键词：按 sheet.name 子串匹配，不区分大小写；空字符串表示显示全部
  const [searchQuery, setSearchQuery] = useState('');

  // ===== 拼写范围弹窗（整体拼写 / 随机抽测）=====
  // 点击「开始学习」后弹出，用于选择本次拼写的单词范围
  const [spellingFlowOpen, setSpellingFlowOpen] = useState(false);
  // 当前选中的范围：null=未选 / 'all'=整体拼写 / 'random'=随机抽测
  const [spellingFlowChoice, setSpellingFlowChoice] = useState<SpellingFlow | null>(null);
  // 随机抽测的数量输入值（字符串，便于输入框受控）
  const [quizCountInput, setQuizCountInput] = useState('');
  // 抽测数量的校验错误提示（为空表示无错误）
  const [quizCountError, setQuizCountError] = useState('');

  // useMemo：根据 vocabularyBooks 和 currentBookId 计算出当前选中的词汇书对象，避免重复查找
  const currentBook = useMemo(
    () => vocabularyBooks.find((b) => b.id === currentBookId) || vocabularyBooks[0] || null,
    [vocabularyBooks, currentBookId]
  );

  // useEffect：每次进入选择页时跑一次，做两件事：
  //   1. 若找不到当前词汇书 → 跳转回首页
  //   2. 强制清空 selectedSheetIds 与所有子模式，让用户重新选择单元
  //      （哪怕从学习页返回、或浏览器后退进来，都不保留上次的勾选；
  //        但保留 mode，让"先选模式再选单元"的用户不必重新选模式）
  useEffect(() => {
    if (!currentBook) {
      navigate('/');
      return;
    }
    // 取之前已经选好的 mode，避免"先选学习模式再回来选单元"的用户被清空模式
    const prevMode = studyConfig?.mode || 'word-meaning';
    setStudyConfig({
      selectedSheetIds: [],
      mode: prevMode,
      lookSubMode: undefined,
      spellingSubMode: undefined,
      spellingFlow: undefined,
      spellingQuizCount: undefined,
    });
    // 只跑一次：依赖数组为空，配合 eslint-disable 避免警告
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 若当前词汇书不存在，提前 return null，防止后续渲染报错
  if (!currentBook) return null;

  // 从 studyConfig 解构出已选单元 ID 数组和当前学习模式，缺省值做兜底
  const selectedIds = studyConfig?.selectedSheetIds || [];
  const mode = studyConfig?.mode || 'word-meaning';
  // 统计：所有已勾选单元中包含的单词总数
  const totalSelectedWords = currentBook.sheets
    .filter((sh) => selectedIds.includes(sh.id))
    .reduce((s, sh) => s + sh.wordCount, 0);

  // 全选判断：单元数量 > 0 且 所有单元都在 selectedIds 中
  const allSelected =
    currentBook.sheets.length > 0 && currentBook.sheets.every((sh) => selectedIds.includes(sh.id));

  /**
   * 全选 / 取消全选 按钮处理函数
   * - 若当前已是全选状态 → 清空 selectedSheetIds（保持当前学习模式不变）
   * - 若当前非全选状态 → 将所有 sheet.id 加入 selectedSheetIds（保持模式不变）
   */
  const toggleAll = () => {
    if (allSelected) {
      setStudyConfig({
        selectedSheetIds: [],
        mode,
      });
    } else {
      setStudyConfig({
        selectedSheetIds: currentBook.sheets.map((sh) => sh.id),
        mode,
      });
    }
  };

  /**
   * 学习模式切换函数
   * - 入参 m：StudyMode（'word-meaning' | 'audio-meaning' | 'spelling'）
   * - 更新 studyConfig：保留当前已选单元，仅覆盖 mode 字段
   * - 当模式是 'word-meaning' 时，额外弹出 看词说意/看意说词 子模式选择弹窗
   * - 当模式是 'spelling' 单词拼写时，额外弹出子模式选择弹窗（不立即设置）
   */
  const setMode = (m: StudyMode) => {
    if (m === 'word-meaning') {
      setLookModalOpen(true);
      return;
    }
    if (m === 'spelling') {
      setSpellingModalOpen(true);
      return;
    }
    setStudyConfig({
      selectedSheetIds: selectedIds,
      mode: m,
      lookSubMode: undefined,
      spellingSubMode: undefined,
    });
  };

  /**
   * 看词说意 / 看意说词 子模式选择处理函数
   * - 入参 sub：'word-meaning' 看词说意 / 'meaning-word' 看意说词
   * - 选中后：写入 studyConfig 的 mode + lookSubMode，关闭弹窗
   */
  const selectLookSubMode = (sub: LookSubMode) => {
    setStudyConfig({
      selectedSheetIds: selectedIds,
      mode: 'word-meaning',
      lookSubMode: sub,
      spellingSubMode: undefined,
    });
    setLookModalOpen(false);
  };

  /**
   * 单词拼写子模式选择处理函数
   * - 入参 sub：'meaning-spelling' 释义拼写 / 'audio-spelling' 听音拼写
   * - 选中后：写入 studyConfig 的 mode + spellingSubMode，关闭弹窗
   */
  const selectSpellingSubMode = (sub: SpellingSubMode) => {
    setStudyConfig({
      selectedSheetIds: selectedIds,
      mode: 'spelling',
      lookSubMode: undefined,
      spellingSubMode: sub,
    });
    setSpellingModalOpen(false);
  };

  /**
   * 开始学习 按钮处理函数
   *   只要选了单元就直接进入学习页——不管先选单元还是先选模式，都不再二次弹窗。
   *   若 mode / 子模式未设，自动补默认值：
   *     - mode 缺省 → 'word-meaning'（看词说意）
   *     - lookSubMode 缺省 → 'word-meaning'（看词说意）
   *     - spellingSubMode 缺省 → 'meaning-spelling'（释义拼写）
   *     - 拼写模式额外弹出「整体拼写 / 随机抽测」范围选择（拼写特有必选项）
   */
  const startStudy = () => {
    if (selectedIds.length === 0) return;

    // 缺省 mode → 看词说意
    const effectiveMode = mode || 'word-meaning';

    if (effectiveMode === 'spelling') {
      // 拼写模式：子模式缺省 → 释义拼写；然后弹范围选择
      const effectiveSub = studyConfig?.spellingSubMode || 'meaning-spelling';
      setStudyConfig({
        selectedSheetIds: selectedIds,
        mode: 'spelling',
        lookSubMode: undefined,
        spellingSubMode: effectiveSub,
      });
      // 每次打开弹窗前重置上次的选择，保证干净状态
      setSpellingFlowChoice(null);
      setQuizCountInput('');
      setQuizCountError('');
      setSpellingFlowOpen(true);
      return;
    }

    if (effectiveMode === 'word-meaning') {
      // 看词说意模式：子模式缺省 → 看词说意
      const effectiveSub = studyConfig?.lookSubMode || 'word-meaning';
      setStudyConfig({
        selectedSheetIds: selectedIds,
        mode: 'word-meaning',
        lookSubMode: effectiveSub,
        spellingSubMode: undefined,
      });
      navigate('/study');
      return;
    }

    // 听音辨义：不需要子模式，直接进
    setStudyConfig({
      selectedSheetIds: selectedIds,
      mode: effectiveMode,
      lookSubMode: undefined,
      spellingSubMode: undefined,
    });
    navigate('/study');
  };

  /**
   * 写入拼写配置并跳转学习页（整体拼写 / 随机抽测共用的跳转逻辑）
   * - 写入 studyConfig（含拼写范围与抽测数量）
   * - 在用户手势内同步请求全屏（仅拼写模式需要），再跳转 /study
   */
  const goToSpelling = (flow: SpellingFlow, quizCount?: number) => {
    setStudyConfig({
      selectedSheetIds: selectedIds,
      mode: 'spelling',
      lookSubMode: undefined,
      spellingSubMode: studyConfig?.spellingSubMode,
      spellingFlow: flow,
      spellingQuizCount: quizCount,
    });
    setSpellingFlowOpen(false);
    // 仅「单词拼写」模式要求强制全屏；在用户手势内同步请求，成功率最高。
    // iPad/iOS 等不支持全屏的设备自动跳过（canUseForcedFullscreen 内部判断）。
    if (canUseForcedFullscreen() && !document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
    navigate('/study');
  };

  /**
   * 点击「整体拼写」卡片：直接进入拼写页（全部单词随机乱序），无需再点确认按钮
   */
  const startSpellingAll = () => {
    goToSpelling('all', undefined);
  };

  /**
   * 随机抽测确认按钮：校验输入数量（最少 5 个，最多不超过所选单元的单词总数），
   * 通过后进入抽测拼写页（全部单词乱序后随机抽取对应数量）
   */
  const confirmSpellingRandom = () => {
    const n = parseInt(quizCountInput, 10);
    // 校验：必须是有效数字，且在 [5, totalSelectedWords] 范围内
    if (isNaN(n) || n < 5) {
      setQuizCountError('抽测数量不能少于 5 个');
      return;
    }
    if (n > totalSelectedWords) {
      setQuizCountError(`抽测数量不能超过 ${totalSelectedWords} 个`);
      return;
    }
    goToSpelling('random', n);
  };

  /**
   * 返回首页 按钮处理函数
   * - 先清空当前词汇书（setCurrentBook(null)）
   * - 再跳转回首页 /
   */
  const goBack = () => {
    setCurrentBook(null);
    navigate('/');
  };

  return (
    // 页面最外层容器：渐变背景 + 底部预留 160 空间，避免内容被底部固定栏遮挡
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 pb-40">
      {/* 主内容区：居中容器，最大宽度 4xl，水平内边距 6，垂直 8 */}
      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* 顶部工具栏：左侧返回按钮 + 右侧当前步骤提示 */}
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={goBack}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-indigo-700"
          >
            <ArrowLeft className="h-4 w-4" />
            返回首页
          </button>
          {/* 步骤进度徽章：显示当前为第 2 步 */}
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-4 py-1.5 text-xs font-medium text-indigo-700 shadow-sm backdrop-blur">
            <BookOpen className="h-3.5 w-3.5" />
            第 2 步 · 选择单元与学习模式
          </div>
        </div>

        {/* 页面标题区：渐变文字标题 + 词汇书文件名 + 单元总数 */}
        <header className="mb-8">
          <h1 className="bg-gradient-to-r from-indigo-700 via-blue-700 to-sky-600 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent">
            选择词表单元
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-white/80 px-3 py-1 shadow-sm">
              <FileSpreadsheet className="h-4 w-4 text-indigo-500" />
              {currentBook.fileName}
            </span>
            <span className="rounded-md bg-white/80 px-3 py-1 shadow-sm">
              共 {currentBook.sheets.length} 个单元
            </span>
          </div>
        </header>

        {/* 选中统计条 + 搜索框 + 全选按钮
            布局：左边统计文字  |  flex-1 占位（推右）  |  搜索框（紧挨全选）  |  全选按钮 */}
        <div className="mb-4 flex items-center gap-3">
          <div className="text-sm text-slate-600 shrink-0">
            已选择 <span className="font-semibold text-indigo-700">{selectedIds.length}</span> /{' '}
            {currentBook.sheets.length} 个单元，
            <span className="font-semibold text-indigo-700">{totalSelectedWords}</span> 个单词
          </div>
          {/* 占位 spacer：把右侧的搜索框 + 全选按钮 推到最右边，让搜索框紧贴全选按钮 */}
          <div className="flex-1" />
          {/* 搜索框：窄宽度、紧挨全选按钮（固定宽度约 224px，约为原先 max-w-sm 的一半） */}
          <div className="relative w-56 shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索单元…"
              className="w-full rounded-full border border-slate-200 bg-white/90 py-2 pl-9 pr-9 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                title="清空搜索"
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={toggleAll}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-50"
          >
            {allSelected ? (
              <>
                <CheckSquare className="h-4 w-4" />
                取消全选
              </>
            ) : (
              <>
                <Square className="h-4 w-4" />
                全选
              </>
            )}
          </button>
        </div>

        {/* Sheet 卡片列表区：只渲染匹配搜索关键词的单元，支持空结果提示 */}
        {(() => {
          const q = searchQuery.trim().toLowerCase();
          const filteredSheets = q
            ? currentBook.sheets.filter((s) => s.name.toLowerCase().includes(q))
            : currentBook.sheets;

          if (q && filteredSheets.length === 0) {
            return (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 py-16 text-center text-sm text-slate-500">
                未找到包含 <span className="font-semibold text-indigo-600">「{searchQuery}」</span> 的单元
              </div>
            );
          }

          return (
            <div className="space-y-3">
              {filteredSheets.map((sheet) => {
                const checked = selectedIds.includes(sheet.id);
                // 显示卡片序号时还原为 sheet 在原列表中的位置，保持编号连贯易认
                const idx = currentBook.sheets.findIndex((s) => s.id === sheet.id);
            return (
              <div
                key={sheet.id}
                onClick={() => toggleSelectedSheetId(sheet.id)}
                className={cn(
                  'group flex cursor-pointer items-center gap-4 rounded-2xl border-2 bg-white/90 p-5 shadow-sm transition-all duration-200 hover:shadow-lg',
                  checked
                    ? 'border-indigo-500 bg-gradient-to-r from-indigo-50 to-blue-50 shadow-indigo-100'
                    : 'border-slate-200/70 hover:border-indigo-200'
                )}
              >
                {/* 最左侧：复选框图标，已选=实色，未选=空心（hover 变蓝） */}
                <div className="shrink-0">
                  {checked ? (
                    <CheckSquare className="h-6 w-6 text-indigo-600" />
                  ) : (
                    <Square className="h-6 w-6 text-slate-300 transition group-hover:text-indigo-400" />
                  )}
                </div>
                {/* 序号徽章：两位数字，蓝紫渐变背景 */}
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-sm font-bold text-white shadow-md shadow-indigo-100">
                  {String(idx + 1).padStart(2, '0')}
                </div>
                {/* 单元信息：名称（截断） + 单词数量小字 */}
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-semibold text-slate-800">
                    {sheet.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    包含 {sheet.wordCount} 个单词 · Sheet 单元
                  </p>
                </div>
                {/* 右侧状态标签：已选=蓝底白字，未选=灰底灰字（hover 变蓝） */}
                <div
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition',
                    checked
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-700'
                  )}
                >
                  {checked ? '已选择' : '点击选择'}
                </div>
              </div>
            );
          })}
          </div>
        );
        })()}
      </div>

      {/* 底部固定操作栏：学习模式选择区 + 开始学习按钮 */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/85 backdrop-blur-lg">
        <div className="mx-auto max-w-4xl px-6 py-4">
          {/* 学习模式三选择区：看词说意 / 听音辨义 / 单词拼写，当前选中卡片会高亮 */}
          <div className="mb-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              请选择学习模式
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {/* 模式 1：看词说意 */}
              <button
                onClick={() => setMode('word-meaning')}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition-all duration-200',
                  mode === 'word-meaning'
                    ? 'border-indigo-600 bg-gradient-to-br from-indigo-50 to-blue-50 shadow-md shadow-indigo-100'
                    : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/40'
                )}
              >
                <div
                  className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
                    mode === 'word-meaning'
                      ? 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-md'
                      : 'bg-slate-100 text-slate-500'
                  )}
                >
                  <Eye className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-slate-800">看词说意</h4>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {studyConfig?.lookSubMode === 'word-meaning'
                      ? '已选：看词识意（显示单词，隐藏释义）'
                      : studyConfig?.lookSubMode === 'meaning-word'
                        ? '已选：看意说词（显示释义，隐藏单词）'
                        : '看词识意 / 看意说词 两种子模式'}
                  </p>
                </div>
              </button>
              {/* 模式 2：听音辨义 */}
              <button
                onClick={() => setMode('audio-meaning')}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition-all duration-200',
                  mode === 'audio-meaning'
                    ? 'border-indigo-600 bg-gradient-to-br from-indigo-50 to-blue-50 shadow-md shadow-indigo-100'
                    : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/40'
                )}
              >
                <div
                  className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
                    mode === 'audio-meaning'
                      ? 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-md'
                      : 'bg-slate-100 text-slate-500'
                  )}
                >
                  <Headphones className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-slate-800">听音辨义</h4>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    点击喇叭播放发音，隐藏单词和释义
                  </p>
                </div>
              </button>
              {/* 模式 3：单词拼写 */}
              <button
                onClick={() => setMode('spelling')}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition-all duration-200',
                  mode === 'spelling'
                    ? 'border-indigo-600 bg-gradient-to-br from-indigo-50 to-blue-50 shadow-md shadow-indigo-100'
                    : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/40'
                )}
              >
                <div
                  className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
                    mode === 'spelling'
                      ? 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-md'
                      : 'bg-slate-100 text-slate-500'
                  )}
                >
                  <PencilLine className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-slate-800">单词拼写</h4>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {studyConfig?.spellingSubMode === 'meaning-spelling'
                      ? '已选：释义拼写（首字母提示）'
                      : studyConfig?.spellingSubMode === 'audio-spelling'
                        ? '已选：听音拼写（输入即发音）'
                        : '释义拼写 / 听音拼写 两种子模式'}
                  </p>
                </div>
              </button>
            </div>
          </div>
          {/* 开始学习按钮：未选中单元=禁用态，已选中=高亮可点击，文案显示已选单词总数 */}
          <button
            onClick={startStudy}
            disabled={selectedIds.length === 0}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-base font-bold text-white shadow-xl transition-all duration-200',
              selectedIds.length === 0
                ? 'cursor-not-allowed bg-slate-300 shadow-none'
                : 'bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-600 shadow-indigo-200 hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-indigo-300 active:translate-y-0'
            )}
          >
            <Sparkles className="h-5 w-5" />
            开始学习 · 共 {totalSelectedWords} 个单词
          </button>
        </div>
      </div>

      {/* 看词说意 / 看意说词 子模式选择弹窗：遮罩层 + 居中卡片，z-50 保证在最上层 */}
      {lookModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4"
          onClick={() => setLookModalOpen(false)}
        >
          {/* 弹窗卡片：阻止点击冒泡关闭 */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
          >
            {/* 右上角关闭按钮 × */}
            <button
              onClick={() => setLookModalOpen(false)}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            {/* 弹窗标题：图标 + 标题 + 说明 */}
            <div className="mb-6">
              <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-lg shadow-indigo-200">
                <Eye className="h-7 w-7" />
              </div>
              <h3 className="text-xl font-extrabold text-slate-800">请选择练习形式</h3>
              <p className="mt-1 text-sm text-slate-500">
                两种形式卡片布局完全一致，仅显示内容互相对调
              </p>
            </div>
            {/* 子模式选项列表 */}
            <div className="space-y-3">
              {/* 子模式 1：看词识意 */}
              <button
                onClick={() => selectLookSubMode('word-meaning')}
                className={cn(
                  'flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all duration-200 hover:shadow-lg',
                  studyConfig?.lookSubMode === 'word-meaning'
                    ? 'border-indigo-600 bg-gradient-to-r from-indigo-50 to-blue-50 shadow-indigo-100'
                    : 'border-slate-200 bg-white hover:border-indigo-200'
                )}
              >
                <div className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
                  studyConfig?.lookSubMode === 'word-meaning'
                    ? 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-500'
                )}>
                  <Eye className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-slate-800">看词识意</h4>
                  <p className="mt-0.5 text-xs text-slate-500">
                    上方显示英文单词，隐藏中文释义，点击查看释义
                  </p>
                </div>
              </button>
              {/* 子模式 2：看意说词 */}
              <button
                onClick={() => selectLookSubMode('meaning-word')}
                className={cn(
                  'flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all duration-200 hover:shadow-lg',
                  studyConfig?.lookSubMode === 'meaning-word'
                    ? 'border-indigo-600 bg-gradient-to-r from-indigo-50 to-blue-50 shadow-indigo-100'
                    : 'border-slate-200 bg-white hover:border-indigo-200'
                )}
              >
                <div className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
                  studyConfig?.lookSubMode === 'meaning-word'
                    ? 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-500'
                )}>
                  <MessageSquareText className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-slate-800">看意说词</h4>
                  <p className="mt-0.5 text-xs text-slate-500">
                    上方显示中文释义，隐藏英文单词，点击查看英文单词
                  </p>
                </div>
              </button>
            </div>
            {/* 底部取消按钮 */}
            <button
              onClick={() => setLookModalOpen(false)}
              className="mt-5 w-full rounded-2xl border-2 border-slate-200 bg-white py-3 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 单词拼写子模式选择弹窗：遮罩层 + 居中卡片，z-50 保证在最上层 */}
      {spellingModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4"
          onClick={() => setSpellingModalOpen(false)}
        >
          {/* 弹窗卡片：阻止点击冒泡关闭 */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
          >
            {/* 右上角关闭按钮 × */}
            <button
              onClick={() => setSpellingModalOpen(false)}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            {/* 弹窗标题：图标 + 标题 + 说明 */}
            <div className="mb-6">
              <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-lg shadow-indigo-200">
                <PencilLine className="h-7 w-7" />
              </div>
              <h3 className="text-xl font-extrabold text-slate-800">请选择拼写模式</h3>
              <p className="mt-1 text-sm text-slate-500">
                每个单词限时 15 秒，整体计时始终桌面显示
              </p>
            </div>
            {/* 子模式选项列表 */}
            <div className="space-y-3">
              {/* 子模式 1：释义拼写 */}
              <button
                onClick={() => selectSpellingSubMode('meaning-spelling')}
                className={cn(
                  'flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all duration-200 hover:shadow-lg',
                  studyConfig?.spellingSubMode === 'meaning-spelling'
                    ? 'border-indigo-600 bg-gradient-to-r from-indigo-50 to-blue-50 shadow-indigo-100'
                    : 'border-slate-200 bg-white hover:border-indigo-200'
                )}
              >
                <div className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
                  studyConfig?.spellingSubMode === 'meaning-spelling'
                    ? 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-500'
                )}>
                  <MessageSquareText className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-slate-800">释义拼写</h4>
                  <p className="mt-0.5 text-xs text-slate-500">
                    中文释义在上，输入框提示首字母，手动输入单词
                  </p>
                </div>
              </button>
              {/* 子模式 2：听音拼写 */}
              <button
                onClick={() => selectSpellingSubMode('audio-spelling')}
                className={cn(
                  'flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all duration-200 hover:shadow-lg',
                  studyConfig?.spellingSubMode === 'audio-spelling'
                    ? 'border-indigo-600 bg-gradient-to-r from-indigo-50 to-blue-50 shadow-indigo-100'
                    : 'border-slate-200 bg-white hover:border-indigo-200'
                )}
              >
                <div className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
                  studyConfig?.spellingSubMode === 'audio-spelling'
                    ? 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-500'
                )}>
                  <Volume2 className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-slate-800">听音拼写</h4>
                  <p className="mt-0.5 text-xs text-slate-500">
                    输入框有任何操作即自动播放发音，其他要求同释义拼写
                  </p>
                </div>
              </button>
            </div>
            {/* 底部取消按钮 */}
            <button
              onClick={() => setSpellingModalOpen(false)}
              className="mt-5 w-full rounded-2xl border-2 border-slate-200 bg-white py-3 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 拼写范围选择弹窗（整体拼写 / 随机抽测）：点击「开始学习」后弹出 */}
      {spellingFlowOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4"
          onClick={() => setSpellingFlowOpen(false)}
        >
          {/* 弹窗卡片：阻止点击冒泡关闭 */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
          >
            {/* 右上角关闭按钮 × */}
            <button
              onClick={() => setSpellingFlowOpen(false)}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            {/* 弹窗标题：图标 + 标题 + 说明 */}
            <div className="mb-6">
              <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-lg shadow-indigo-200">
                <PencilLine className="h-7 w-7" />
              </div>
              <h3 className="text-xl font-extrabold text-slate-800">请选择拼写范围</h3>
              <p className="mt-1 text-sm text-slate-500">
                共 {totalSelectedWords} 个单词 · 每个单词限时 15 秒
              </p>
            </div>
            {/* 范围选项列表 */}
            <div className="space-y-3">
              {/* 选项 1：整体拼写（点击直接进入拼写页，无需再点确认按钮） */}
              <button
                onClick={startSpellingAll}
                className="flex w-full items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 text-left transition-all duration-200 hover:border-indigo-200 hover:shadow-lg"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition group-hover:bg-indigo-100">
                  <Shuffle className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-slate-800">整体拼写</h4>
                  <p className="mt-0.5 text-xs text-slate-500">
                    所选单元全部 {totalSelectedWords} 个单词，随机乱序检查
                  </p>
                </div>
              </button>
              {/* 选项 2：随机抽测（卡片内同时显示抽测数量输入框，未选中灰色 / 选中高亮） */}
              <div
                onClick={() => setSpellingFlowChoice('random')}
                className={cn(
                  'w-full cursor-pointer rounded-2xl border-2 p-4 text-left transition-all duration-200 hover:shadow-lg',
                  spellingFlowChoice === 'random'
                    ? 'border-indigo-600 bg-gradient-to-r from-indigo-50 to-blue-50 shadow-indigo-100'
                    : 'border-slate-200 bg-white hover:border-indigo-200'
                )}
              >
                {/* 上半部分：图标 + 标题说明 */}
                <div className="flex items-center gap-4">
                  <div className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
                    spellingFlowChoice === 'random'
                      ? 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-md'
                      : 'bg-slate-100 text-slate-500'
                  )}>
                    <Dices className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-slate-800">随机抽测</h4>
                    <p className="mt-0.5 text-xs text-slate-500">
                      全部单词乱序后随机抽取部分检查，最少 5 个
                    </p>
                  </div>
                </div>
                {/* 下半部分：缩短的抽测数量输入框 + 确认按钮（同一行，确认按钮仅随机抽测使用） */}
                <div className="mt-3 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <input
                      type="number"
                      min={5}
                      max={totalSelectedWords}
                      value={quizCountInput}
                      onClick={(e) => e.stopPropagation()} // 阻止冒泡，避免触发卡片选中重复 setState
                      onFocus={() => setSpellingFlowChoice('random')} // 聚焦输入框时自动选中随机抽测
                      onChange={(e) => {
                        setQuizCountInput(e.target.value);
                        setQuizCountError(''); // 输入变化时清除错误提示
                      }}
                      placeholder="抽测数量"
                      className={cn(
                        'w-full rounded-xl border-2 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none transition',
                        spellingFlowChoice === 'random'
                          ? 'border-indigo-300 focus:border-indigo-500'
                          : 'border-slate-200 opacity-60 focus:border-indigo-500 focus:opacity-100'
                      )}
                    />
                    {/* 范围提示 + 校验错误（错误时替换提示） */}
                    <p className={cn(
                      'mt-1 text-[11px]',
                      quizCountError ? 'font-semibold text-rose-500' : 'text-slate-400'
                    )}>
                      {quizCountError || `5 ~ ${totalSelectedWords}`}
                    </p>
                  </div>
                  {/* 确认按钮：未输入数量时灰色禁用，输入后高亮可点击 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation(); // 阻止冒泡到卡片
                      confirmSpellingRandom();
                    }}
                    disabled={!quizCountInput.trim()}
                    className={cn(
                      'shrink-0 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all duration-200',
                      !quizCountInput.trim()
                        ? 'cursor-not-allowed bg-slate-300'
                        : 'bg-gradient-to-r from-indigo-600 to-blue-600 shadow-md shadow-indigo-200 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0'
                    )}
                  >
                    确认
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
