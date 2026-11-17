/**
 * 计时背诵弹窗（共用于：
 *   - 生词整理「看词识意」：显示单词，计时回想释义（识别背诵模式）
 *   - 生词整理「听音辨义」：只播发音，计时回想单词和释义（听音辨义模式）
 *   - 听力精听生词本「检查」：听音辨义计时模式
 *
 * props:
 *   words         参加的单词数组
 *   mode          识别背诵(word-meaning / 看词识意) | 听音辨义(meaning-word)
 *   seconds       每词秒数（默认 10）
 *   title         弹窗标题（如「听音辨义 · 真题2026 · 错词」）
 *   onClose       关闭回调
 *   onFinish      完成回调，带结果统计
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, Star, Check, ArrowLeft, ArrowRight, Eye, EyeOff, X, Timer } from 'lucide-react';

export interface QuizWord {
  word: string;
  uk?: string;
  us?: string;
  ukPhonetic?: string;
  usPhonetic?: string;
  meaning: string;
}

export interface QuizResult {
  total: number;
  starredCount: number;
  rightCount: number; // = total - starredCount（用户主动「记住」）
  wrongWords: QuizWord[]; // 标星的
  acc: number;
}

interface Props {
  words: QuizWord[];
  mode: 'word-meaning' | 'meaning-word';
  seconds: number;
  title?: string;
  onClose: () => void;
  onFinish?: (r: QuizResult) => void;
}

const YOUDAO_VOICE = (word: string, type: 1 | 2) =>
  `https://dict.youdao.com/dictvoice?type=${type}&audio=${encodeURIComponent(word)}`;

export default function ReciteQuiz({ words, mode, seconds, title = '计时背诵', onClose, onFinish }: Props) {
  const order = useMemo(() => {
    const a = [...words];
    // 听音辨义模式必须乱序
    if (mode === 'meaning-word') {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
    }
    return a;
  }, [words, mode]);

  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(mode === 'word-meaning' ? true : false);
  const [starred, setStarred] = useState<Set<number>>(new Set()); // 标星的下标
  const [memorized, setMemorized] = useState<Set<number>>(new Set()); // 记住的
  const [remaining, setRemaining] = useState(seconds);
  const [finished, setFinished] = useState(false);
  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cur = order[idx];

  // 自动播放（听音辨义模式，或看词识意的美音）
  const play = (type: 1 | 2 = 2) => {
    if (!cur) return;
    const url = cur.us || cur.uk || YOUDAO_VOICE(cur.word, type);
    audioRef.current = new Audio(url);
    audioRef.current.play().catch(() => { /* 网络失败静默 */ });
  };

  // 倒计时
  useEffect(() => {
    if (finished) return;
    setRemaining(seconds);
    // 听音辨义模式进入就自动播
    if (mode === 'meaning-word') {
      setTimeout(() => play(2), 120);
    }
    timerRef.current = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(timerRef.current!);
          timerRef.current = null;
          // 时间到：听音辨义 → 自动揭晓 + 自动标星 + 下一词
          if (mode === 'meaning-word') {
            setRevealed(true);
            setStarred((s) => {
              const next = new Set(s);
              next.add(idx);
              return next;
            });
            // 1.4 秒后切到下一词
            setTimeout(() => nextCard('auto'), 1400);
          } else {
            // 看词识意：时间到自动标星并下一词（用户已见过单词，自动揭晓后继续）
            setRevealed(true);
            setStarred((s) => {
              const next = new Set(s);
              next.add(idx);
              return next;
            });
            setTimeout(() => nextCard('auto'), 1400);
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, finished]);

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished) return;
      // Esc 退出
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); nextCard('manual'); return; }
      if (e.key === 'ArrowUp' || e.key === ' ') { e.preventDefault(); toggleReveal(); return; }
      if (e.key === 'ArrowDown' || e.key.toLowerCase() === 'm') { e.preventDefault(); toggleStar(); return; }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); toggleMemorize(); return; }
      if (e.key.toLowerCase() === 'b' || e.shiftKey) { e.preventDefault(); play(); return; }
    };
    // 弹窗独占键盘（和精听播放页一致）
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, finished]);

  const toggleReveal = () => setRevealed((v) => !v);
  const toggleStar = () => {
    setStarred((s) => {
      const next = new Set(s);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      if (next.has(idx)) memorized.has(idx) && setMemorized((m) => { const n = new Set(m); n.delete(idx); return n; });
      return next;
    });
  };
  const toggleMemorize = () => {
    setMemorized((s) => {
      const next = new Set(s);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      if (next.has(idx)) starred.has(idx) && setStarred((ss) => { const n = new Set(ss); n.delete(idx); return n; });
      return next;
    });
  };

  const stopTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const prev = () => {
    if (idx > 0) {
      stopTimer();
      setIdx(idx - 1);
      setRevealed(mode === 'word-meaning');
    }
  };

  const nextCard = (reason: 'manual' | 'auto') => {
    stopTimer();
    if (idx < order.length - 1) {
      setIdx(idx + 1);
      setRevealed(mode === 'word-meaning');
    } else {
      finishQuiz();
    }
    // 自动模式下不处理
    if (reason === 'manual') { /* 仅用于区分是否已在 effect 里播过音 */ }
  };

  const finishQuiz = () => {
    stopTimer();
    setFinished(true);
    const total = order.length;
    const starredCount = starred.size;
    const rightCount = total - starredCount;
    const wrongWords = order.filter((_, i) => starred.has(i));
    const acc = total === 0 ? 100 : Math.round((rightCount / total) * 100);
    const result: QuizResult = { total, starredCount, rightCount, wrongWords, acc };
    onFinish?.(result);
  };

  // 颜色随倒计时变化
  const countColor = remaining <= 3 ? 'text-rose-600' : remaining <= Math.ceil(seconds / 2) ? 'text-amber-600' : 'text-indigo-600';
  const progress = order.length === 0 ? 0 : ((idx + 1) / order.length) * 100;
  const accNow = order.length === 0 ? 100 : Math.round(((idx + 1 - starred.size) / (idx + 1)) * 100);

  if (!cur) return null;

  if (finished) {
    const total = order.length;
    const starredCount = starred.size;
    const rightCount = total - starredCount;
    const wrongWords = order.filter((_, i) => starred.has(i));
    const acc = total === 0 ? 100 : Math.round((rightCount / total) * 100);
    return (
      <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
        <div className="w-full max-w-3xl rounded-3xl bg-white p-7 shadow-2xl">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900">{title} · 完成</h3>
            <button onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-5 rounded-2xl bg-gradient-to-br from-indigo-50 to-sky-50 p-5 text-slate-700">
            <p className="text-base">
              共 <b className="text-indigo-600">{total}</b> 词 ·
              错 <b className="text-rose-500">{starredCount}</b> ·
              对 <b className="text-emerald-500">{rightCount}</b>，
              准确率 <b className="text-indigo-600">{acc}%</b>
            </p>
          </div>
          {wrongWords.length > 0 && (
            <div className="mt-5">
              <h4 className="mb-2 text-sm font-semibold text-slate-700">标星错词（{wrongWords.length} 个）</h4>
              <div className="max-h-[40vh] overflow-auto rounded-xl border border-slate-200">
                {wrongWords.map((w, i) => (
                  <div key={w.word + i} className="grid grid-cols-[2rem_1fr_2fr] items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                    <span className="text-center text-slate-400 tabular-nums">{i + 1}</span>
                    <span className="font-semibold text-slate-800">{w.word}</span>
                    <span className="text-slate-500">{w.meaning}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">关闭</button>
            <button
              onClick={() => {
                // 再来一轮：重开
                onFinish?.({ total, starredCount, rightCount, wrongWords, acc });
                onClose();
              }}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              再来一轮
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-3xl bg-white p-7 shadow-2xl">
        {/* 顶部统计 */}
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span className="tabular-nums">第 {idx + 1} / {order.length} 个 · 标星 {starred.size} 个 · 准确率 {accNow}%</span>
          <button onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>
        {/* 进度条 */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
        </div>

        {/* 主区域 */}
        <div className="mt-6 flex min-h-[260px] flex-col items-center justify-center gap-4">
          {/* 听音辨义模式：只显示大喇叭 */}
          {mode === 'meaning-word' && (
            <button
              onClick={() => play(2)}
              className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-sky-500 text-white shadow-lg hover:from-indigo-600 hover:to-sky-600"
            >
              <Volume2 className="h-12 w-12" />
            </button>
          )}
          {/* 倒计时（两种模式都显示） */}
          <div className={`text-4xl font-bold tabular-nums ${countColor}`}>
            <Timer className="mr-2 inline h-6 w-6" />
            {remaining}s
          </div>
          {/* 看词识意模式：始终显示单词 */}
          {mode === 'word-meaning' && (
            <div className="text-center">
              <div className="text-3xl font-bold text-slate-900">{cur.word}</div>
              <div className="mt-1 text-sm text-slate-500">
                {cur.usPhonetic && <span className="mr-3">美 {cur.usPhonetic}</span>}
                {cur.ukPhonetic && <span>英 {cur.ukPhonetic}</span>}
              </div>
            </div>
          )}
          {/* 释义揭晓/隐藏 */}
          {mode === 'meaning-word' && (
            <button
              onClick={toggleReveal}
              className="text-sm text-slate-400 hover:text-slate-600"
            >
              {revealed ? <EyeOff className="mr-1 inline h-4 w-4" /> : <Eye className="mr-1 inline h-4 w-4" />}
              {revealed ? '收起' : '显示'}单词和释义 (↑ / 空格)
            </button>
          )}
          {revealed && (
            <div className="text-center">
              {mode === 'meaning-word' && (
                <div className="text-2xl font-bold text-slate-900">{cur.word}</div>
              )}
              {(cur.usPhonetic || cur.ukPhonetic) && mode === 'meaning-word' && (
                <div className="mt-1 text-sm text-slate-500">
                  {cur.usPhonetic && <span className="mr-3">美 {cur.usPhonetic}</span>}
                  {cur.ukPhonetic && <span>英 {cur.ukPhonetic}</span>}
                </div>
              )}
              {mode === 'word-meaning' && (
                <hr className="my-3 w-16 border-slate-200" />
              )}
              <div className="text-base leading-relaxed text-slate-700">{cur.meaning}</div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={prev}
            disabled={idx === 0}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-30"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMemorize}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                memorized.has(idx) ? 'bg-emerald-500 text-white' : 'border border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50'
              }`}
            >
              <Check className="h-4 w-4" /> 记住 (N)
            </button>
            <button
              onClick={toggleStar}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                starred.has(idx) ? 'bg-amber-500 text-white' : 'border border-amber-200 bg-white text-amber-600 hover:bg-amber-50'
              }`}
            >
              <Star className="h-4 w-4" /> 标星 (↓/M)
            </button>
            <button
              onClick={() => play(2)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Volume2 className="h-4 w-4" /> 发音 (Shift/B)
            </button>
          </div>
          <button
            onClick={() => nextCard('manual')}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
