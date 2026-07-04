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
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { SpellingSubMode, StudyMode } from '@/types';
import { cn } from '@/lib/utils';

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

  // useMemo：根据 vocabularyBooks 和 currentBookId 计算出当前选中的词汇书对象，避免重复查找
  const currentBook = useMemo(
    () => vocabularyBooks.find((b) => b.id === currentBookId) || vocabularyBooks[0] || null,
    [vocabularyBooks, currentBookId]
  );

  // useEffect：页面初始化及依赖变化时执行，做两件事：
  //   1. 若找不到当前词汇书 → 跳转回首页
  //   2. 若 studyConfig 未初始化 → 初始化默认值（空选中列表 + 看词说意模式）
  useEffect(() => {
    if (!currentBook) {
      navigate('/');
      return;
    }
    if (!studyConfig) {
      setStudyConfig({
        selectedSheetIds: [],
        mode: 'word-meaning',
      });
    }
  }, [currentBook, navigate, studyConfig, setStudyConfig]);

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
   * - 当模式是 'spelling' 单词拼写时，额外弹出子模式选择弹窗（不立即设置）
   */
  const setMode = (m: StudyMode) => {
    if (m === 'spelling') {
      setSpellingModalOpen(true);
      return;
    }
    setStudyConfig({
      selectedSheetIds: selectedIds,
      mode: m,
      spellingSubMode: undefined,
    });
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
      spellingSubMode: sub,
    });
    setSpellingModalOpen(false);
  };

  /**
   * 开始学习 按钮处理函数
   * - 校验 1：至少选中 1 个单元，否则不跳转
   * - 校验 2：若模式是单词拼写，必须先选中子模式（释义拼写/听音拼写）
   * - 通过则跳转到 /study 路由，进入学习页
   */
  const startStudy = () => {
    if (selectedIds.length === 0) return;
    if (mode === 'spelling' && !studyConfig?.spellingSubMode) {
      setSpellingModalOpen(true);
      return;
    }
    navigate('/study');
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

        {/* 选中统计条：左侧显示已选单元/单词数，右侧是全选/取消全选按钮 */}
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-slate-600">
            已选择 <span className="font-semibold text-indigo-700">{selectedIds.length}</span> /{' '}
            {currentBook.sheets.length} 个单元，
            <span className="font-semibold text-indigo-700">{totalSelectedWords}</span> 个单词
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

        {/* Sheet 卡片列表区：遍历当前词汇书的所有单元，生成可点击选择的卡片 */}
        <div className="space-y-3">
          {currentBook.sheets.map((sheet, idx) => {
            const checked = selectedIds.includes(sheet.id);
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
                    显示单词，隐藏中文释义，点击查看
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
                每个单词限时 10 秒，整体计时始终桌面显示
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
    </div>
  );
}
