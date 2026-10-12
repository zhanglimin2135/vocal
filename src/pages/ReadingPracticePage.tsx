/*
 * ============================================
 * 页面名称：ReadingPracticePage - 托福阅读补全单词「练习页」
 * 页面用途：让用户真正做练习的核心页面
 * 主要功能：
 *   1. 左侧：文章目录列表（侧边栏，可展开/收起），点击跳转对应文章
 *   2. 页面中间：显示当前文章内容，每个 _ 变成一个单字母输入框
 *      输入字母后输入框显示该字母，按 Tab / Enter 自动跳到下一个空
 *   3. 左/右两侧「中间高度位置」分别悬浮：上一篇 / 下一篇 按钮
 *   4. 页面中央底部（文章下方）放置「提交」按钮
 *   5. 提交后：当前文章的空字母 -> 对的绿色 / 错的红色
 *      页面下方显示正确答案（每个空词对应的正确单词）
 * ============================================
 */

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,     // 上一篇
  ChevronRight,    // 下一篇
  Send,            // 提交
  BookText,        // 书本（目录标题）
  ArrowLeftCircle, // 返回上传页
  RotateCcw,       // 重做本题
  CheckCircle2,    // 正确
  XCircle,         // 错误
  Target,          // 得分
  FileCheck,       // 答案标题
  List,            // 目录图标（展开/收起）
  Home,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { ReadingPassage, PassageResult } from '@/types';
import { gradePassage } from '@/utils/passageParser';
import { cn } from '@/lib/utils';

export default function ReadingPracticePage() {
  const navigate = useNavigate();

  // ========== 全局状态 ==========
  const readingPassages = useAppStore((s) => s.readingPassages);
  const currentPassageId = useAppStore((s) => s.currentPassageId);
  const setCurrentPassage = useAppStore((s) => s.setCurrentPassage);

  // ========== 页面本地状态 ==========
  // 当前文章在数组中的下标
  const currentIdx = useMemo(
    () =>
      Math.max(
        0,
        readingPassages.findIndex((p) => p.id === currentPassageId)
      ),
    [readingPassages, currentPassageId]
  );
  const current: ReadingPassage | undefined = readingPassages[currentIdx];

  // 用户答案：Map<blankCharId, 单个字母字符串>
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  // 提交后的结果（没提交就是 null）
  const [result, setResult] = useState<PassageResult | null>(null);
  // 目录侧栏是否展开（移动端默认收起，桌面端默认展开）
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // 所有空格的 input DOM 的 ref，用于自动跳转下一个空
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ========== 切换文章时：重置用户答案 + 结果 ==========
  useEffect(() => {
    setUserAnswers({});
    setResult(null);
  }, [current?.id]);

  // ========== 计算上/下一篇是否可用 ==========
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx < readingPassages.length - 1;

  // ========== 跳转文章 ==========
  const goPrev = useCallback(() => {
    if (hasPrev) setCurrentPassage(readingPassages[currentIdx - 1].id);
  }, [hasPrev, readingPassages, currentIdx, setCurrentPassage]);

  const goNext = useCallback(() => {
    if (hasNext) setCurrentPassage(readingPassages[currentIdx + 1].id);
  }, [hasNext, readingPassages, currentIdx, setCurrentPassage]);

  // ========== 提交答案 ==========
  const handleSubmit = useCallback(() => {
    if (!current) return;
    const r = gradePassage(current, userAnswers);
    setResult(r);
    // 滚到文章顶部，用户方便从头看对错
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [current, userAnswers]);

  // ========== 重做 ==========
  const handleReset = useCallback(() => {
    setUserAnswers({});
    setResult(null);
    // 聚焦第一个空
    setTimeout(() => {
      const firstBlank = current?.blankWords[0]?.blankChars[0];
      if (firstBlank) {
        inputRefs.current[firstBlank.id]?.focus();
      }
    }, 50);
  }, [current]);

  // ========== 输入单个字母 -> 自动跳下一空 ==========
  const handleInputChange = (
    blankCharId: string,
    raw: string,
    bcGlobalIndex: number
  ) => {
    // 如果已经提交了，就不允许再改
    if (result) return;

    // 只保留最后一个字母
    const cleaned = raw.replace(/[^A-Za-z]/g, '').slice(-1);
    setUserAnswers((prev) => ({ ...prev, [blankCharId]: cleaned }));

    // 如果用户输入了字母 -> 自动跳到下一个空
    if (cleaned.length > 0) {
      // 找到 globalIndex + 1 的那个 blankChar
      const all =
        current?.blankWords.flatMap((bw) => bw.blankChars) || [];
      const next = all.find((x) => x.globalIndex === bcGlobalIndex + 1);
      if (next) {
        // 用 setTimeout 让 React 先把字母渲染上去再聚焦，避免光标错位
        setTimeout(() => inputRefs.current[next.id]?.focus(), 0);
      }
    }
  };

  // ========== 处理键盘：Backspace 在空输入时跳回上一个空 ==========
  const handleInputKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    blankCharId: string,
    bcGlobalIndex: number,
    currentVal: string
  ) => {
    if (result) return;
    if (e.key === 'Backspace' && !currentVal) {
      const all = current?.blankWords.flatMap((bw) => bw.blankChars) || [];
      const prev = all.find((x) => x.globalIndex === bcGlobalIndex - 1);
      if (prev) {
        e.preventDefault();
        inputRefs.current[prev.id]?.focus();
      }
    }
    if (e.key === 'Enter') {
      // Enter = 跳到下一个空（如果有）
      e.preventDefault();
      const all = current?.blankWords.flatMap((bw) => bw.blankChars) || [];
      const next = all.find((x) => x.globalIndex === bcGlobalIndex + 1);
      if (next) inputRefs.current[next.id]?.focus();
      else handleSubmit();
    }
  };

  // ==================================================
  // 渲染：单个输入框（字母空）
  // 根据提交前后状态决定样式：
  //   未提交：浅蓝底虚线边框
  //   提交后：对的绿色背景，错的红色背景
  // ==================================================
  const renderBlankInput = (
    bc: import('@/types').BlankChar,
    bw: import('@/types').BlankWord
  ) => {
    const val = userAnswers[bc.id] || '';
    const br = result?.blankResults.find((r) => r.blankCharId === bc.id);

    // 决定样式：
    let baseCls =
      'mx-[1px] inline-flex h-9 w-8 items-center justify-center rounded-md border-2 border-dashed text-center text-sm font-bold uppercase outline-none transition-all duration-150 align-middle';

    if (!result) {
      // 做题中
      baseCls = cn(
        baseCls,
        'border-indigo-300 bg-indigo-50/60 text-indigo-700 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-200'
      );
    } else if (br?.isCorrect) {
      baseCls = cn(
        baseCls,
        'border-emerald-400 bg-emerald-100 text-emerald-700 shadow-inner'
      );
    } else {
      // 错 / 未填
      baseCls = cn(
        baseCls,
        'border-red-400 bg-red-100 text-red-700 shadow-inner'
      );
    }

    // 正确答案字母（提交后显示在输入框下方的 tooltip）
    return (
      <span className="relative inline-block align-middle">
        <input
          ref={(el) => {
            inputRefs.current[bc.id] = el;
          }}
          type="text"
          inputMode="text"
          maxLength={2}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={val}
          onChange={(e) => handleInputChange(bc.id, e.target.value, bc.globalIndex)}
          onKeyDown={(e) => handleInputKeyDown(e, bc.id, bc.globalIndex, val)}
          className={baseCls}
          aria-label={`第 ${bc.globalIndex + 1} 个空`}
          disabled={!!result}
        />
        {/* 提交后如果错了，在右下角显示正确答案小标签 */}
        {result && br && !br.isCorrect && (
          <span className="pointer-events-none absolute -bottom-1 -right-1 translate-y-full rounded-md bg-emerald-600 px-1 py-0.5 text-[10px] font-bold text-white shadow z-10">
            {br.correctLetter.toUpperCase()}
          </span>
        )}
        {/* 未填标记（提交后） */}
        {result && br && !br.userInput && (
          <span className="pointer-events-none absolute -top-1 -right-1 rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow">
            空
          </span>
        )}
      </span>
    );
  };

  // ==================================================
  // 渲染：一个"带空格的单词"（比如 qui_k -> 字母 + 输入框混合排列）
  // 提交后用红/绿色边框套在整个单词外面
  // ==================================================
  const renderBlankWord = (bw: import('@/types').BlankWord) => {
    // 检查整个单词是否都答对（用于给单词整体加颜色）
    const allCorrect = result
      ? bw.blankChars.every((bc) => {
          const br = result.blankResults.find((r) => r.blankCharId === bc.id);
          return br?.isCorrect;
        })
      : null;
    const anyWrong = result
      ? bw.blankChars.some((bc) => {
          const br = result.blankResults.find((r) => r.blankCharId === bc.id);
          return br && !br.isCorrect;
        })
      : null;

    // 逐字符渲染：要么是普通字母（原单词里非 _ 的字符），要么是输入框
    const chars: React.ReactNode[] = [];
    for (let i = 0; i < bw.originalMasked.length; i++) {
      const ch = bw.originalMasked[i];
      if (ch === '_') {
        const bc = bw.blankChars.find((b) => b.charIndexInWord === i);
        if (bc) chars.push(renderBlankInput(bc, bw));
      } else {
        // 普通字母：展示出来（也根据整体对错变色）
        const letterCls = cn(
          'inline-block align-middle text-lg font-semibold',
          result && allCorrect ? 'text-emerald-600' : '',
          result && anyWrong ? 'text-red-600' : 'text-slate-800'
        );
        chars.push(
          <span key={`bw-${bw.id}-ch-${i}`} className={letterCls}>
            {ch}
          </span>
        );
      }
    }

    return (
      <span
        className={cn(
          'inline-flex items-baseline rounded-md px-1 py-0.5 mx-[1px] transition-colors',
          result && allCorrect ? 'bg-emerald-50 ring-1 ring-emerald-200' : '',
          result && anyWrong ? 'bg-red-50 ring-1 ring-red-200' : ''
        )}
        title={result ? `正确答案：${bw.correctWord || '—'}` : undefined}
      >
        {chars}
      </span>
    );
  };

  // ==================================================
  // 渲染：整篇文章（segments 列表）
  // 段落之间用换行
  // ==================================================
  const renderPassageBody = (p: ReadingPassage) => {
    // segments 顺序就是文章顺序，直接 map。换行我们用"连续的多个 \n"当作分段
    // 这里为了简单，直接把每个 segment 输出；换行用 <br>。
    const nodes: React.ReactNode[] = [];
    p.segments.forEach((seg, i) => {
      if (seg.type === 'text') {
        // 把 content 里的换行转成 <br/>
        const parts = seg.content.split('\n');
        parts.forEach((part, pi) => {
          if (part.length > 0) {
            nodes.push(
              <span
                key={`seg-${i}-p-${pi}`}
                className="whitespace-pre-wrap text-lg leading-[2.2] text-slate-800"
              >
                {part}
              </span>
            );
          }
          if (pi < parts.length - 1) {
            nodes.push(<br key={`seg-${i}-br-${pi}`} />);
          }
        });
      } else {
        nodes.push(
          <span key={`seg-${i}-bw`}>{renderBlankWord(seg.word)}</span>
        );
      }
    });
    return nodes;
  };

  // ==================================================
  // Render：页面主体
  // ==================================================
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-sky-50 via-indigo-50 to-violet-100">
      {/* ========== 顶部导航条 ========== */}
      <header className="sticky top-0 z-20 border-b border-white/60 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => navigate('/reading-upload')}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-white hover:text-emerald-700 sm:px-3 sm:text-sm"
            >
              <ArrowLeftCircle className="h-4 w-4" />
              <span className="hidden sm:inline">返回上传/目录页</span>
              <span className="sm:hidden">目录</span>
            </button>
            <button
              onClick={() => navigate('/')}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-sm text-slate-500 shadow-sm transition hover:bg-white hover:text-indigo-700"
            >
              <Home className="h-4 w-4" />
              首页
            </button>
            <h1 className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm sm:px-4 sm:text-sm">
              <BookText className="h-4 w-4" />
              <span className="hidden sm:inline">托福阅读补全单词 · 练习</span>
              <span className="sm:hidden">阅读练习</span>
            </h1>
          </div>
          {/* 进度 + 得分 */}
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 sm:inline-block">
              第 <span className="font-bold text-indigo-600">{readingPassages.length > 0 ? currentIdx + 1 : 0}</span> / {readingPassages.length} 篇
            </span>
            {result && current && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold sm:text-sm',
                  result.accuracy >= 0.8
                    ? 'bg-emerald-100 text-emerald-700'
                    : result.accuracy >= 0.5
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-700'
                )}
              >
                <Target className="h-3.5 w-3.5" />
                {result.correctCount}/{result.totalCount}
                <span className="opacity-70">
                  ({(result.accuracy * 100).toFixed(0)}%)
                </span>
              </span>
            )}
            {/* 小屏幕目录按钮 */}
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-white lg:hidden"
            >
              <List className="h-4 w-4" />
              目录
            </button>
          </div>
        </div>
      </header>

      {/* ========== 主体：侧边栏(目录) + 文章区 ========== */}
      <div className="mx-auto flex max-w-7xl gap-4 px-4 py-6 sm:px-6">
        {/* ===================== 左侧：文章目录（桌面默认展开，小屏抽屉） ===================== */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 w-72 transform border-r border-white/60 bg-white/95 shadow-xl backdrop-blur transition-transform duration-300 lg:static lg:z-0 lg:block lg:w-1/4 lg:max-w-xs lg:translate-x-0 lg:rounded-3xl lg:border lg:bg-white/80 lg:shadow-lg xl:w-1/5',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <div className="flex h-full flex-col p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
                <BookText className="h-5 w-5 text-indigo-500" />
                文章目录
              </h2>
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 lg:hidden"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            </div>
            <ul className="flex-1 space-y-2 overflow-y-auto pr-1">
              {readingPassages.length === 0 && (
                <li className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4 text-center text-xs text-slate-400">
                  还没有文章，请先到上传页添加
                </li>
              )}
              {readingPassages.map((p, i) => {
                const active = p.id === current?.id;
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => {
                        setCurrentPassage(p.id);
                        if (window.innerWidth < 1024) setSidebarOpen(false);
                      }}
                      className={cn(
                        'w-full rounded-2xl border p-3 text-left transition-all',
                        active
                          ? 'border-indigo-300 bg-indigo-50/80 shadow-sm ring-2 ring-indigo-200'
                          : 'border-slate-200/70 bg-white hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-sm'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={cn(
                            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                            active
                              ? 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow'
                              : 'bg-slate-100 text-slate-600'
                          )}
                        >
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              'truncate text-sm font-semibold',
                              active ? 'text-indigo-800' : 'text-slate-800'
                            )}
                          >
                            {p.title}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {p.blankWords.length} 词 · {p.totalBlanks} 空
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
        {/* 小屏遮罩（目录抽屉开时显示） */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-20 bg-slate-900/20 backdrop-blur-sm lg:hidden"
          />
        )}

        {/* ===================== 中间：文章内容区 ===================== */}
        <main className="relative flex-1">
          {!current ? (
            // 没有文章的空状态
            <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/60 p-10 text-center shadow-sm">
              <BookText className="mb-3 h-12 w-12 text-slate-300" />
              <h3 className="text-lg font-bold text-slate-600">暂无文章</h3>
              <p className="mt-2 max-w-md text-sm text-slate-500">
                请先到上传页添加至少一篇包含 _ 的文章和对应答案
              </p>
              <button
                onClick={() => navigate('/reading-upload')}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition hover:-translate-y-0.5 hover:shadow-xl"
              >
                去添加文章
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              {/* ====== 文章卡片 ====== */}
              <article className="overflow-hidden rounded-3xl border border-white/70 bg-white/90 shadow-xl backdrop-blur">
                {/* 文章标题条 */}
                <div className="relative border-b border-slate-100 bg-gradient-to-r from-indigo-50 via-violet-50 to-purple-50 px-6 py-5 sm:px-8">
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-xl font-extrabold tracking-tight text-slate-800 sm:text-2xl">
                      {current.title}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-white/80 px-3 py-1 font-medium text-indigo-600 shadow-sm">
                        {current.blankWords.length} 个单词
                      </span>
                      <span className="rounded-full bg-white/80 px-3 py-1 font-medium text-violet-600 shadow-sm">
                        {current.totalBlanks} 个空字母
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    提示：每个字母空输入后会自动跳到下一个；空输入时按 Backspace 回到上一个；按 Enter 提交。
                  </p>
                </div>

                {/* 文章正文 */}
                <div className="px-6 py-7 sm:px-10 sm:py-9">
                  <div className="font-serif">
                    {renderPassageBody(current)}
                  </div>
                </div>

                {/* 提交按钮 + 重做按钮 */}
                <div className="flex flex-wrap items-center justify-center gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-5 sm:gap-5">
                  {!result ? (
                    <button
                      onClick={handleSubmit}
                      className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 sm:text-base"
                    >
                      <Send className="h-4 w-4 transition-transform group-hover:translate-x-0.5 sm:h-5 sm:w-5" />
                      提交答案
                    </button>
                  ) : (
                    <button
                      onClick={handleReset}
                      className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-7 py-3 text-sm font-bold text-white shadow-lg shadow-amber-200 transition-all hover:-translate-y-0.5 hover:shadow-xl sm:text-base"
                    >
                      <RotateCcw className="h-4 w-4 transition-transform group-hover:-rotate-180 duration-500 sm:h-5 sm:w-5" />
                      重做本题
                    </button>
                  )}
                </div>
              </article>

              {/* ====== 提交后：结果统计 + 正确答案区 ====== */}
              {result && (
                <section className="mt-6 overflow-hidden rounded-3xl border border-white/70 bg-white/90 shadow-xl backdrop-blur">
                  {/* 得分大标题 */}
                  <div className="relative border-b border-slate-100 bg-gradient-to-r from-emerald-50 via-teal-50 to-cyan-50 px-6 py-5 sm:px-8">
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="flex items-center gap-2 text-lg font-extrabold text-slate-800 sm:text-xl">
                        <FileCheck className="h-5 w-5 text-emerald-600 sm:h-6 sm:w-6" />
                        正确答案
                      </h3>
                      <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          对 {result.correctCount}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 font-semibold text-red-700">
                          <XCircle className="h-3.5 w-3.5" />
                          错 {result.totalCount - result.correctCount}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-3 py-1 font-bold',
                            result.accuracy >= 0.8
                              ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white'
                              : result.accuracy >= 0.5
                              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white'
                              : 'bg-gradient-to-r from-red-500 to-rose-500 text-white'
                          )}
                        >
                          <Target className="h-3.5 w-3.5" />
                          正确率 {(result.accuracy * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 答案表：按"带空格单词"逐个展示 */}
                  <div className="grid grid-cols-1 gap-3 px-6 py-6 sm:px-8 sm:grid-cols-2 lg:grid-cols-3">
                    {current.blankWords.map((bw, wi) => {
                      // 这个单词下所有空格是否全对
                      const wordBlankResults = bw.blankChars
                        .map((bc) =>
                          result.blankResults.find(
                            (r) => r.blankCharId === bc.id
                          )
                        )
                        .filter(Boolean) as NonNullable<
                        (typeof result.blankResults)[number]
                      >[];
                      const wordRight = wordBlankResults.filter(
                        (b) => b.isCorrect
                      ).length;
                      const wordTotal = wordBlankResults.length;
                      const allRight = wordRight === wordTotal;

                      return (
                        <div
                          key={bw.id}
                          className={cn(
                            'rounded-2xl border p-4 shadow-sm transition',
                            allRight
                              ? 'border-emerald-200 bg-emerald-50/60'
                              : 'border-red-200 bg-red-50/60'
                          )}
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-slate-500 shadow-sm">
                              #{wi + 1}
                            </span>
                            <span
                              className={cn(
                                'text-[11px] font-bold',
                                allRight ? 'text-emerald-700' : 'text-red-700'
                              )}
                            >
                              {allRight
                                ? `✓ ${wordRight}/${wordTotal}`
                                : `✗ ${wordRight}/${wordTotal}`}
                            </span>
                          </div>
                          {/* 用户填出来的样子（错的红色） */}
                          <div className="mb-2 text-sm text-slate-500">
                            你的答案：
                            <span className="font-mono font-semibold text-slate-700">
                              {renderBlankWordAnswerOnly(bw, result)}
                            </span>
                          </div>
                          {/* 正确答案 */}
                          <div className="text-sm text-slate-500">
                            正确答案：
                            <span className="font-mono text-lg font-bold text-emerald-700">
                              {bw.correctWord || '—'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>

      {/* ========== 左侧悬浮：上一篇按钮（文章中间高度） ========== */}
      {current && (
        <button
          onClick={goPrev}
          disabled={!hasPrev}
          title="上一篇文章"
          className={cn(
            'fixed left-2 top-1/2 z-10 -translate-y-1/2 flex h-16 w-10 sm:h-20 sm:w-14 items-center justify-center rounded-2xl shadow-xl transition-all duration-200 lg:left-4 lg:h-24 lg:w-16',
            hasPrev
              ? 'group bg-gradient-to-b from-indigo-500 to-violet-600 text-white hover:scale-110 hover:shadow-2xl active:scale-95'
              : 'cursor-not-allowed bg-slate-200 text-slate-400 shadow-none'
          )}
        >
          <ChevronLeft className="h-6 w-6 transition-transform group-hover:-translate-x-0.5 sm:h-8 sm:w-8 lg:h-10 lg:w-10" />
        </button>
      )}

      {/* ========== 右侧悬浮：下一篇按钮（文章中间高度） ========== */}
      {current && (
        <button
          onClick={goNext}
          disabled={!hasNext}
          title="下一篇文章"
          className={cn(
            'fixed right-2 top-1/2 z-10 -translate-y-1/2 flex h-16 w-10 sm:h-20 sm:w-14 items-center justify-center rounded-2xl shadow-xl transition-all duration-200 lg:right-4 lg:h-24 lg:w-16',
            hasNext
              ? 'group bg-gradient-to-b from-violet-500 to-purple-600 text-white hover:scale-110 hover:shadow-2xl active:scale-95'
              : 'cursor-not-allowed bg-slate-200 text-slate-400 shadow-none'
          )}
        >
          <ChevronRight className="h-6 w-6 transition-transform group-hover:translate-x-0.5 sm:h-8 sm:w-8 lg:h-10 lg:w-10" />
        </button>
      )}
    </div>
  );
}

// ============================================================
// 辅助渲染：底部"正确答案区"里显示"用户填出来的单词"
// 只显示字母（不对的红色，对的绿色）
// ============================================================
function renderBlankWordAnswerOnly(
  bw: import('@/types').BlankWord,
  result: PassageResult
) {
  return (
    <span>
      {Array.from(bw.originalMasked).map((ch, i) => {
        if (ch !== '_') {
          return (
            <span key={i} className="text-slate-700">
              {ch}
            </span>
          );
        }
        const bc = bw.blankChars.find((b) => b.charIndexInWord === i);
        const br = bc
          ? result.blankResults.find((r) => r.blankCharId === bc.id)
          : undefined;
        if (!br) return <span key={i}>_</span>;
        return (
          <span
            key={i}
            className={cn(
              'font-bold uppercase',
              br.isCorrect ? 'text-emerald-600' : 'text-red-600 underline decoration-wavy'
            )}
          >
            {br.userInput || <span className="opacity-40">_</span>}
          </span>
        );
      })}
    </span>
  );
}
