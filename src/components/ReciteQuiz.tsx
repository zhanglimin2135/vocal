/**
 * 计时背诵弹窗（生词整理页使用）
 *
 * 两种模式，交互与「背单词 · 计时背诵」完全一致：
 *   - word-meaning（看词识意）：正面显示单词 + 播放发音，点击/↑/空格 查看释义
 *   - meaning-word（听音辨义）：正面只显示大喇叭（自动播放），点击/↑/空格 显示单词和释义
 *
 * 快捷键：← 上一词 · → 下一词 · ↑/空格 显示/收起 · ↓/M 标星 · N 记住 · Shift/B 播放发音 · Esc 退出
 * 超时：自动标星并进入下一词
 * 结束：结果页与听力精听生词本检查结果一致（单元名 + 错词、统计、错词列表、一键复制、再来一轮）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, Star, Check, ChevronLeft, ChevronRight, X, Timer, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { playWordAudio } from '@/utils/audioUtils';

export interface QuizWord {
  word: string;
  uk?: string;
  us?: string;
  ukPhonetic?: string;
  usPhonetic?: string;
  meaning: string;
}

interface Props {
  words: QuizWord[];
  mode: 'word-meaning' | 'meaning-word';
  seconds: number;
  /** 单元名，用作结果页标题 */
  title: string;
  onClose: () => void;
}

/** 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 复制到剪贴板（失败降级 execCommand） */
function copyText(text: string): Promise<boolean> {
  const fallback = (s: string) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  };
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => fallback(text));
  }
  return Promise.resolve(fallback(text));
}

export default function ReciteQuiz({ words, mode, seconds, title, onClose }: Props) {
  // 听音辨义乱序；看词识意保持原顺序
  const [round, setRound] = useState(0);
  const list = useMemo(
    () => (mode === 'meaning-word' ? shuffle(words) : [...words]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [words, mode, round],
  );

  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(seconds);
  const [revealed, setRevealed] = useState(false);
  const [starred, setStarred] = useState<Set<number>>(new Set());
  const [finished, setFinished] = useState(false);
  const [keyPressed, setKeyPressed] = useState<'remember' | 'mark' | null>(null);
  const [copied, setCopied] = useState(false);

  const cur = list[index];

  const play = () => {
    if (cur) void playWordAudio(cur.word, 'us');
  };

  /** 切到指定下标（重置倒计时与展开状态） */
  const goTo = (next: number) => {
    setRemaining(seconds);
    setRevealed(false);
    setIndex(next);
  };

  /** 记住：已标星则取消标星；进入下一词 */
  const remember = () => {
    setStarred((s) => {
      if (!s.has(index)) return s;
      const n = new Set(s);
      n.delete(index);
      return n;
    });
    if (index + 1 >= list.length) finish();
    else goTo(index + 1);
  };

  /** 标星：标记当前词；进入下一词 */
  const mark = () => {
    setStarred((s) => {
      const n = new Set(s);
      n.add(index);
      return n;
    });
    if (index + 1 >= list.length) finish();
    else goTo(index + 1);
  };

  /** 超时：自动标星并进入下一词 */
  const timeout = () => {
    mark();
  };

  const prev = () => {
    if (index <= 0) return;
    goTo(index - 1);
  };

  const next = () => {
    if (index + 1 >= list.length) finish();
    else goTo(index + 1);
  };

  const finish = () => {
    setFinished(true);
  };

  // 每词倒计时
  useEffect(() => {
    if (finished || !cur) return;
    const t = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(t);
          window.setTimeout(() => timeout(), 0);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, finished, list.length]);

  // 听音辨义：进入新词自动播放
  useEffect(() => {
    if (finished || mode !== 'meaning-word' || !cur) return;
    const t = window.setTimeout(() => play(), 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, finished, mode]);

  // 快捷键（捕获阶段独占键盘，避免触发播放页快捷键）
  useEffect(() => {
    if (finished) return;
    const flash = (k: 'remember' | 'mark') => {
      setKeyPressed(k);
      window.setTimeout(() => setKeyPressed(null), 150);
    };
    const handler = (e: KeyboardEvent) => {
      const appKeys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', ' ', 'Spacebar', 'm', 'M', 'n', 'N', 'b', 'B', 'Shift', 'Escape'];
      if (appKeys.includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
      switch (e.key) {
        case 'ArrowRight': next(); break;
        case 'ArrowLeft': prev(); break;
        case 'ArrowUp':
        case ' ':
        case 'Spacebar':
          setRevealed((v) => !v);
          break;
        case 'ArrowDown':
        case 'm':
        case 'M':
          flash('mark');
          mark();
          break;
        case 'n':
        case 'N':
          flash('remember');
          remember();
          break;
        case 'Shift':
        case 'b':
        case 'B':
          if (!e.repeat) play();
          break;
        case 'Escape':
          onClose();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, finished, list.length]);

  // ===== 结果页 =====
  if (finished) {
    const total = list.length;
    const wrong = list.filter((_, i) => starred.has(i));
    const wrongCount = wrong.length;
    const rightCount = total - wrongCount;
    const acc = total === 0 ? 100 : Math.round((rightCount / total) * 100);
    const statsLine = `共 ${total} 词 · 错 ${wrongCount} · 对 ${rightCount}，准确率 ${acc}%`;
    const copyContent = [
      `${title} 错词`,
      statsLine,
      ...wrong.map((w, i) => `${i + 1}\t${w.word}\t${w.meaning}`),
    ].join('\n');

    return (
      <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-md">
        <div className="flex max-h-[92vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-7 py-4">
            <div className="min-w-0 pr-4">
              <h3 className="truncate text-lg font-extrabold text-slate-800">{title} 错词</h3>
              <p className="mt-1 text-sm font-semibold text-slate-700">{statsLine}</p>
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-7 py-4">
            {wrongCount === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">本轮没有标星的错词</div>
            ) : (
              <div className="mt-2">
                {wrong.map((w, i) => (
                  <div
                    key={`${w.word}-${i}`}
                    className="grid grid-cols-[2rem_9rem_minmax(0,1fr)] items-center gap-3 border-b border-dashed border-slate-100 py-2 text-sm"
                  >
                    <span className="text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
                    <span className="truncate font-semibold text-slate-800">{w.word}</span>
                    <span className="break-words text-slate-500">{w.meaning}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-7 py-4">
            <button
              onClick={async () => {
                const ok = await copyText(copyContent);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
                if (!ok) alert('复制失败，请手动选择内容');
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
            >
              <Copy className="h-4 w-4" />
              {copied ? '已复制' : '一键复制'}
            </button>
            <button
              onClick={() => {
                setStarred(new Set());
                setIndex(0);
                setRemaining(seconds);
                setRevealed(false);
                setFinished(false);
                setRound((r) => r + 1);
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              再来一轮
            </button>
            <button
              onClick={onClose}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!cur) return null;

  const starredCount = starred.size;
  const accNow = index + 1 === 0 ? 100 : Math.round(((index + 1 - starredCount) / (index + 1)) * 100);
  const barWidth = (index / Math.max(1, list.length)) * 100;

  return (
    <div
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-900/60 px-2 backdrop-blur-md sm:px-4"
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex w-full max-w-2xl items-center gap-2 sm:gap-4">
        {/* 左箭头 */}
        <button
          onClick={prev}
          disabled={index <= 0}
          title="上一词（←）"
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-lg transition-all sm:h-12 sm:w-12',
            index <= 0
              ? 'cursor-not-allowed bg-slate-200/80 text-slate-300'
              : 'bg-white text-slate-600 hover:scale-110 hover:bg-violet-50 hover:text-violet-600 active:translate-y-0.5',
          )}
        >
          <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>

        <div className="relative min-w-0 flex-1 select-none overflow-hidden rounded-3xl bg-white shadow-2xl">
          {/* 顶部统计 */}
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-violet-50/70 to-purple-50/70 px-6 py-4 sm:px-8">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-bold text-slate-700">
                第 <span className="text-violet-600">{index + 1}</span> / {list.length} 个
                <span className="ml-1 font-normal text-slate-400">·</span>
                <span className="ml-1 text-amber-600">标星<span className="font-bold">{starredCount}</span>个</span>
                <span className="ml-1 font-normal text-slate-400">·</span>
                <span className={cn('ml-1 font-bold', accNow >= 90 ? 'text-emerald-600' : 'text-rose-500')}>
                  准确率<span>{accNow}</span>%
                </span>
              </span>
            </div>
            <button
              onClick={onClose}
              title="退出计时背诵"
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* 进度条 */}
          <div className="h-1.5 w-full rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500 transition-[width] duration-700 ease-out"
              style={{ width: `${barWidth}%` }}
            />
          </div>

          {/* 主体 */}
          <div className="px-6 py-7 sm:px-8 sm:py-8">
            {/* 倒计时环 */}
            <div className="mb-6 flex flex-col items-center">
              <div className="relative h-20 w-20">
                <svg className="h-20 w-20 -rotate-90" viewBox="0 0 36 36">
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none" stroke="#e2e8f0" strokeWidth="3" strokeLinecap="round"
                  />
                  <path
                    key={`${index}-${seconds}`}
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray="100"
                    style={{
                      animation: `recite-deplete ${seconds}s linear forwards, recite-color-fade ${seconds}s linear forwards`,
                    }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span
                    key={`num-${index}-${seconds}`}
                    className="font-mono text-2xl font-normal tabular-nums"
                    style={{ animation: `recite-text-color-fade ${seconds}s linear forwards` }}
                  >
                    {remaining}
                  </span>
                </div>
              </div>
              {starred.has(index) && (
                <div className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-600">
                  <Star className="h-3 w-3 fill-current" />
                  已标星
                </div>
              )}
            </div>

            {mode === 'word-meaning' ? (
              // ===== 看词识意：单词 + 播放发音 + 点击查看释义 =====
              <div className="text-center">
                <p className="break-words text-4xl font-black tracking-tight text-slate-900">{cur.word}</p>
                <div className="mx-auto my-4 h-px w-16 bg-violet-200" />
                <button
                  onClick={play}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-violet-50 px-4 py-2 text-sm font-medium text-violet-600 transition-all hover:scale-105 hover:bg-violet-100"
                  title="播放发音"
                >
                  <Volume2 className="h-4 w-4" />
                  播放发音
                </button>
                <div className="mt-3 flex min-h-[66px] items-center justify-center">
                  {revealed ? (
                    <button
                      onClick={() => setRevealed(false)}
                      className="w-full cursor-pointer break-words bg-transparent text-xl leading-relaxed text-slate-900 focus:outline-none"
                      title="点击收起（↑）"
                    >
                      {cur.meaning}
                    </button>
                  ) : (
                    <button
                      onClick={() => setRevealed(true)}
                      className="text-xl leading-relaxed text-slate-400 opacity-40 focus:outline-none"
                    >
                      点击查看释义
                    </button>
                  )}
                </div>
              </div>
            ) : (
              // ===== 听音辨义：大喇叭 + 点击查看单词和释义 =====
              <div className="text-center">
                <button
                  onClick={play}
                  className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-lg shadow-purple-200 transition hover:scale-105"
                  title="点击播放发音"
                >
                  <Volume2 className="h-12 w-12" />
                </button>
                <p className="mt-4 text-sm font-medium text-slate-500">
                  点击喇叭播放发音，尝试回想单词和释义
                </p>
                <div className="mt-4 min-h-[2.5rem]">
                  {revealed ? (
                    <button
                      onClick={() => setRevealed(false)}
                      className="w-full cursor-pointer bg-transparent focus:outline-none"
                      title="点击收起（↑）"
                    >
                      <p className="break-words text-4xl font-black tracking-tight text-slate-900">{cur.word}</p>
                      <div className="mx-auto my-4 h-px w-16 bg-violet-200" />
                      <p className="break-words text-xl leading-relaxed text-slate-900">{cur.meaning}</p>
                    </button>
                  ) : (
                    <button
                      onClick={() => setRevealed(true)}
                      className="text-4xl font-black tracking-tight text-slate-400 opacity-40 focus:outline-none"
                    >
                      显示单词和释义
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 底部操作 */}
          <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-5 sm:px-8">
            <div className="flex gap-3">
              <button
                onClick={remember}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3.5 text-base font-bold text-white shadow-lg shadow-emerald-200 transition-all hover:shadow-xl hover:shadow-emerald-300 active:translate-y-0.5',
                  keyPressed === 'remember' && 'translate-y-0.5 scale-95 brightness-110 shadow-inner',
                )}
              >
                <Check className="h-5 w-5" />
                记住
              </button>
              <button
                onClick={mark}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 py-3.5 text-base font-bold text-white shadow-lg shadow-orange-200 transition-all hover:shadow-xl hover:shadow-orange-300 active:translate-y-0.5',
                  keyPressed === 'mark' && 'translate-y-0.5 scale-95 brightness-110 shadow-inner',
                )}
              >
                <Star className="h-5 w-5" />
                标星
              </button>
            </div>
            <p className="mt-3 text-center text-[11px] text-slate-400">
              快捷键：← 上一词 · → 下一词 · ↑/空格 显示/收起释义 · ↓/M 标星 · N 记住 · Shift/B 播放发音
            </p>
          </div>
        </div>

        {/* 右箭头 */}
        <button
          onClick={next}
          disabled={index >= list.length - 1}
          title="下一词（→）"
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-lg transition-all sm:h-12 sm:w-12',
            index >= list.length - 1
              ? 'cursor-not-allowed bg-slate-200/80 text-slate-300'
              : 'bg-white text-slate-600 hover:scale-110 hover:bg-violet-50 hover:text-violet-600 active:translate-y-0.5',
          )}
        >
          <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>
      </div>
    </div>
  );
}
