/**
 * 生词整理页面
 *   首页固定词表下的入口；支持用户手动输入单词/词组（/ 或换行分隔），
 *   自动抓取发音与释义后存为一个单元；可追加到上一单元或新建单元。
 *
 *   单元内：
 *     - 生词本样式（序号 / 单词 / 发音 / 释义 / 删除 / 一键复制本单元）
 *     - 看词识意（识别背诵计时弹窗）
 *     - 听音辨义（听音辨义计时弹窗）
 *
 *   总量上限 500 词；450 / 480 / 500 时弹窗提示。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Sparkles, Copy, Download, Trash2, Volume2, BookOpen, Headphones,
  AlertTriangle, BookMarked, Check, Timer, ChevronDown, ChevronUp, Loader2, X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAppStore } from '@/store/appStore';
import { playWordAudio } from '@/utils/audioUtils';
import { lookupBatch, youdaoVoice, type LookupResult } from '@/utils/wordLookup';
import {
  loadUnits, saveUnits, totalWordCount, appendOrCreate, formatTimestamp,
  type CollectionUnit, type WordEntry, COLLECTION_LIMIT,
} from '@/utils/wordCollection';
import ReciteQuiz, { type QuizWord } from '@/components/ReciteQuiz';
import { cn } from '@/lib/utils';

/** 把原始输入拆成数组（支持 '/' '、' '，' 和换行分隔） */
function splitInput(raw: string): string[] {
  return raw
    .split(/[\/、，,；;\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 剪贴板写文本（失败走 execCommand 兜底） */
function copyText(text: string): Promise<boolean> {
  const fallback = (s: string) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = s; ta.style.position = 'fixed'; ta.style.top = '-1000px';
      document.body.appendChild(ta); ta.select();
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

/** 生成单元的复制文本（和听力精听一致） */
function buildUnitCopy(unit: CollectionUnit): string {
  const lines: string[] = [unit.name];
  for (let i = 0; i < unit.words.length; i++) {
    const w = unit.words[i];
    lines.push(`${i + 1}\t${w.word}\t${w.meaning}`);
  }
  return lines.join('\n');
}

/** 生成所有单元的复制文本 */
function buildAllCopy(units: CollectionUnit[]): string {
  const lines: string[] = [];
  let globalIdx = 0;
  for (const u of units) {
    lines.push(u.name);
    for (const w of u.words) {
      globalIdx++;
      lines.push(`${globalIdx}\t${w.word}\t${w.meaning}`);
    }
  }
  return lines.join('\n');
}

/** 把所有单元导出 xlsx：两个 sheet——「全表」和按单元拆分 */
function exportXlsx(units: CollectionUnit[]) {
  const wb = XLSX.utils.book_new();
  const allRows: string[][] = [];
  let globalIdx = 0;
  allRows.push(['序号', '单词', '释义']);
  for (const u of units) {
    allRows.push([u.name, formatTimestamp(u.createdAt)]);
    for (const w of u.words) {
      globalIdx++;
      allRows.push([String(globalIdx), w.word, w.pos ? `${w.pos} ${w.meaning}` : w.meaning]);
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(allRows), '全表');
  for (const u of units) {
    const rows = [
      ['序号', '单词', '释义'],
      ...u.words.map((w, i) => [String(i + 1), w.word, w.pos ? `${w.pos} ${w.meaning}` : w.meaning]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), u.name.slice(0, 28));
  }
  const stamp = formatTimestamp(Date.now()).replace(/[: ]/g, '-');
  XLSX.writeFile(wb, `生词整理-${stamp}.xlsx`);
}

export default function CollectionPage() {
  const navigate = useNavigate();
  const hydrate = useAppStore((s) => s.hydrate);

  const [units, setUnits] = useState<CollectionUnit[]>(() => loadUnits());
  const [inputOpen, setInputOpen] = useState(false);
  const [inputRaw, setInputRaw] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [parsedBatch, setParsedBatch] = useState<LookupResult[] | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [modeConfirm, setModeConfirm] = useState<'append' | 'new'>('new');
  const [nameHint, setNameHint] = useState('真题2026');
  const [limitPopup, setLimitPopup] = useState<null | { total: number; threshold: number; atLimit: boolean; overflow: boolean }>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);

  const [quiz, setQuiz] = useState<null | { unitId: string; mode: 'word-meaning' | 'meaning-word'; seconds: number; title: string }>(null);
  const [quizPick, setQuizPick] = useState<null | { unitId: string; mode: 'word-meaning' | 'meaning-word'; title: string }>(null);

  const totalCount = useMemo(() => totalWordCount(units), [units]);

  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => { saveUnits(units); }, [units]);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1600);
  };

  /** 单元内单词发音：走 playWordAudio，带口音偏好，内部自动停掉上一次播放 */
  const playAudio = (_url: string, word: string, accent: 'us' | 'uk' = 'us') => {
    if (!word) return;
    void playWordAudio(word, accent);
  };

  // ====== 输入 → 抓取 → 确认 ======
  const startImport = async () => {
    const words = splitInput(inputRaw);
    if (words.length === 0) { showToast('请输入至少一个单词'); return; }
    if (words.length > 120) { showToast('单次建议不超过 120 个，以免抓取过慢'); }

    setLoading(true);
    setProgress({ done: 0, total: words.length, current: '' });
    try {
      const results = await lookupBatch(words, (done, total, cur) => {
        setProgress({ done, total, current: cur });
      });
      setParsedBatch(results);
      if (results.length === 0) {
        showToast('未抓取到任何释义，请检查网络');
      }
    } finally {
      setLoading(false);
    }
  };

  const confirmImport = async () => {
    if (!parsedBatch || parsedBatch.length === 0) return;
    // 计算两种模式下的数量，判断是否超限
    const current = totalWordCount(units);
    // 上一单元（最前的）去重后 room
    const topWords = modeConfirm === 'append' && units.length > 0
      ? units[0].words.map((w) => w.word.toLowerCase())
      : [];
    const deduped = parsedBatch.filter((w) => !topWords.includes(w.word.toLowerCase()));
    const room = Math.max(0, COLLECTION_LIMIT - current);
    const take = deduped.slice(0, room);
    const overflow = take.length < deduped.length;
    const newTotal = current + take.length;

    const updated = appendOrCreate(units, parsedBatch, { mode: modeConfirm, nameHint });
    setUnits(updated.next);

    // 清零
    setInputRaw('');
    setParsedBatch(null);
    setShowConfirm(false);
    setInputOpen(false);

    // 上限提示（达到阈值就弹）
    if (newTotal >= 500 || updated.atLimit) {
      setLimitPopup({ total: updated.next.reduce((s, u) => s + u.words.length, 0), threshold: 500, atLimit: true, overflow });
    } else if (newTotal >= 480) {
      setLimitPopup({ total: newTotal, threshold: 480, atLimit: false, overflow });
    } else if (newTotal >= 450) {
      setLimitPopup({ total: newTotal, threshold: 450, atLimit: false, overflow });
    }

    showToast(updated.added > 0 ? `已加入 ${updated.added} 词` : '这些词都已在上一单元里');
  };

  // ====== 单元操作 ======
  const deleteUnit = (id: string) => {
    setUnits((us) => us.filter((u) => u.id !== id));
    showToast('单元已删除');
  };

  const deleteWord = (unitId: string, wordIdx: number) => {
    setUnits((us) => us.map((u) => u.id !== unitId ? u : { ...u, words: u.words.filter((_, i) => i !== wordIdx) }));
  };

  const deleteAllUnits = () => {
    setUnits([]);
    setExpanded({});
    setConfirmClearAll(false);
    showToast('全部单元已删除');
  };

  const copyUnit = async (u: CollectionUnit) => {
    const ok = await copyText(buildUnitCopy(u));
    showToast(ok ? `已复制「${u.name}」` : '复制失败，请手动选择');
  };

  const copyAll = async () => {
    const ok = await copyText(buildAllCopy(units));
    showToast(ok ? '全部单元已复制' : '复制失败，请手动选择');
  };

  const exportAll = () => {
    if (units.length === 0) { showToast('还没有单元'); return; }
    exportXlsx(units);
  };

  const toggleExpand = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const openQuiz = (u: CollectionUnit, mode: 'word-meaning' | 'meaning-word') => {
    if (u.words.length === 0) { showToast('单元里还没有单词'); return; }
    setQuizPick({ unitId: u.id, mode, title: u.name });
  };

  const currentUnit = quiz ? units.find((u) => u.id === quiz.unitId) : null;
  const quizWords: QuizWord[] = currentUnit?.words.map((w) => ({
    word: w.word,
    uk: w.uk, us: w.us, ukPhonetic: w.ukPhonetic, usPhonetic: w.usPhonetic, meaning: w.meaning,
  })) ?? [];

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 py-7">
      {/* 顶部返回 + 批量按钮 */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate('/')} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> 返回首页
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setInputOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:from-violet-600 hover:to-purple-600"
          >
            <Plus className="h-3.5 w-3.5" /> 添加单词
          </button>
          <button
            onClick={copyAll}
            disabled={units.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-40"
          >
            <Copy className="h-3.5 w-3.5" /> 一键复制全部单元
          </button>
          <button
            onClick={exportAll}
            disabled={units.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:from-indigo-600 hover:to-sky-600 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> 导出词表（xlsx）
          </button>
          <button
            onClick={() => setConfirmClearAll(true)}
            disabled={units.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" /> 删除全部单元
          </button>
        </div>
      </div>

      {/* 标题 + 统计 */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <BookMarked className="h-6 w-6 text-indigo-500" />
            生词整理
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            共 <b className="text-slate-700">{units.length}</b> 单元 ·
            <b className="text-slate-700"> {totalCount}</b> 词
            <span className="ml-2 text-slate-400">（上限 {COLLECTION_LIMIT}）</span>
          </p>
        </div>
      </div>

      {/* 输入弹窗：点「添加单词」后打开 */}
      {inputOpen && (
        <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
          <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <Sparkles className="h-4 w-4 text-violet-500" />
                添加单词
              </h3>
              <button onClick={() => setInputOpen(false)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
              <label className="mb-2 block text-xs font-semibold text-slate-600">
                输入单词 / 词组（每行一个，或用 / 、 ， 分隔）
              </label>
              <textarea
                autoFocus
                value={inputRaw}
                onChange={(e) => setInputRaw(e.target.value)}
                placeholder={'legacy\nambiguous  /  take into account\n换句话说，也就是说'}
                rows={8}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800 outline-none transition focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100"
              />
              <div className="mt-2 text-xs text-slate-500">
                {splitInput(inputRaw).length > 0 && `共 ${splitInput(inputRaw).length} 个待抓取`}
                {loading && progress.total > 0 && ` · 抓取中 ${progress.done}/${progress.total}（${progress.current || '…'}）`}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
              <button
                onClick={() => setInputOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={startImport}
                disabled={loading || splitInput(inputRaw).length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:from-violet-600 hover:to-purple-600 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                完成输入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 单元列表 */}
      {units.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10 text-center">
          <BookMarked className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-400">还没有任何单元，点右上角「添加单词」开始整理吧</p>
        </div>
      ) : (
        <div className="mt-8 space-y-5">
          {units.map((u) => (
            <UnitCard
              key={u.id}
              unit={u}
              expanded={!!expanded[u.id]}
              onToggle={() => toggleExpand(u.id)}
              onDeleteUnit={() => deleteUnit(u.id)}
              onDeleteWord={(idx) => deleteWord(u.id, idx)}
              onCopy={() => copyUnit(u)}
              onPlay={(url, w, accent) => playAudio(url, w, accent)}
              onQuiz={(m) => openQuiz(u, m)}
            />
          ))}
        </div>
      )}

      {/* 抓取完成后 —— 确认弹窗（选择「新单元」还是「追加到上一单元」） */}
      {parsedBatch && parsedBatch.length > 0 && (
        <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                抓到 {parsedBatch.length} 个单词，加入到哪里？
              </h3>
              <button onClick={() => { setParsedBatch(null); }} className="rounded-full p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-4 max-h-48 overflow-auto rounded-xl border border-slate-200 p-3 text-xs">
              {parsedBatch.slice(0, 20).map((w, i) => (
                <div key={i} className="flex gap-2 border-b border-slate-100 py-1 last:border-b-0">
                  <span className="w-28 shrink-0 font-semibold text-slate-800">{w.word}</span>
                  <span className="text-slate-500">{w.meaning || '—（未释义）'}</span>
                </div>
              ))}
              {parsedBatch.length > 20 && <div className="mt-1 text-slate-400">… 还有 {parsedBatch.length - 20} 个</div>}
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-xs font-semibold text-slate-600">保存方式</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  onClick={() => { setModeConfirm('new'); setShowConfirm(true); }}
                  className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-left hover:bg-indigo-100"
                >
                  <div className="text-sm font-bold text-indigo-700">✦ 添加为新单元</div>
                  <div className="mt-1 text-[11px] text-indigo-500">单元名 = 手动文字 + 添加时间（月日）</div>
                </button>
                <button
                  onClick={() => { setModeConfirm('append'); setShowConfirm(true); }}
                  disabled={units.length === 0}
                  className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:bg-slate-50 disabled:opacity-40"
                >
                  <div className="text-sm font-bold text-slate-700">↳ 追加到上一单元</div>
                  <div className="mt-1 text-[11px] text-slate-400">汇总到最上面那个单元的末尾</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 新单元命名 */}
      {showConfirm && modeConfirm === 'new' && (
        <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h4 className="text-sm font-bold text-slate-900">新单元命名</h4>
            <p className="mt-1 text-xs text-slate-500">
              命名规则：手动文字 + 添加时间（月日，自动追加）。<br />
              例如「真题2026 · 11-18」
            </p>
            <input
              value={nameHint}
              onChange={(e) => setNameHint(e.target.value)}
              placeholder="真题2026 / 或其他出处"
              className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowConfirm(false)} className="rounded-xl border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">取消</button>
              <button onClick={() => confirmImport()} className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500">确认添加</button>
            </div>
          </div>
        </div>
      )}

      {showConfirm && modeConfirm === 'append' && (
        <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h4 className="text-sm font-bold text-slate-900">追加到上一单元？</h4>
            <p className="mt-1 text-xs text-slate-500">
              把这 <b>{parsedBatch?.length}</b> 个单词汇总到当前最上面的单元「<b>{units[0]?.name}</b>」末尾。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowConfirm(false)} className="rounded-xl border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">取消</button>
              <button onClick={() => confirmImport()} className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500">确认追加</button>
            </div>
          </div>
        </div>
      )}

      {/* 上限提示 */}
      {limitPopup && (
        <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              <h4 className="text-sm font-bold">
                {limitPopup.atLimit ? '单词上限已达到' : `单词数量达到 ${limitPopup.threshold}`}
              </h4>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              生词整理总共 <b>{COLLECTION_LIMIT}</b> 词上限。
              当前已使用 <b>{limitPopup.total}</b> 词
              {limitPopup.atLimit ? '，新单词将不再能继续加入。' : `，再加入 ${COLLECTION_LIMIT - limitPopup.total} 词即满。`}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              建议：点页面顶部「一键复制全部单元」或「导出词表（xlsx）」把当前所有单元保存到本地，再回到首页清除生词整理。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { copyAll(); setLimitPopup(null); }}
                className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                一键复制全部
              </button>
              <button
                onClick={() => { exportAll(); setLimitPopup(null); }}
                className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                导出词表
              </button>
              <button
                onClick={() => setLimitPopup(null)}
                className="rounded-xl border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除全部单元确认 */}
      {confirmClearAll && (
        <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <AlertTriangle className="h-4 w-4 text-rose-500" />
              删除全部单元？
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              将删除当前全部 {units.length} 个单元、共 {totalCount} 个单词，此操作不可恢复。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmClearAll(false)} className="rounded-xl border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">取消</button>
              <button onClick={deleteAllUnits} className="rounded-xl bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-500">确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* 计时秒数选择弹窗（与词表计时背诵一致） */}
      {quizPick && (
        <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-md">
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start gap-3 border-b border-slate-100 bg-gradient-to-r from-violet-50 to-purple-50 px-6 py-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-lg shadow-purple-200">
                <Timer className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <h3 className="text-lg font-extrabold leading-tight text-slate-900">计时背诵</h3>
                <p className="mt-1 truncate text-[11px] text-violet-500">{quizPick.title}</p>
              </div>
              <button
                onClick={() => setQuizPick(null)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/70 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 px-6 py-5">
              {[5, 7, 10, 15].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setQuiz({ unitId: quizPick.unitId, mode: quizPick.mode, seconds: s, title: quizPick.title });
                    setQuizPick(null);
                  }}
                  className="flex flex-col items-center gap-1 rounded-2xl border-2 border-slate-200 bg-white py-5 transition-all hover:border-violet-400 hover:bg-violet-50 active:translate-y-0.5"
                >
                  <span className="font-mono text-3xl font-semibold text-violet-600">{s}</span>
                  <span className="text-xs font-medium text-slate-500">秒 / 词</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 计时背诵弹窗 */}
      {quiz && (
        <ReciteQuiz
          words={quizWords}
          mode={quiz.mode}
          seconds={quiz.seconds}
          title={quiz.title}
          onClose={() => setQuiz(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 z-[2147483647] -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-xs text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// =============================
// 单元卡片（子组件）
// =============================

interface UnitCardProps {
  unit: CollectionUnit;
  expanded: boolean;
  onToggle: () => void;
  onDeleteUnit: () => void;
  onDeleteWord: (idx: number) => void;
  onCopy: () => void;
  onPlay: (url: string, word: string, accent?: 'us' | 'uk') => void;
  onQuiz: (mode: 'word-meaning' | 'meaning-word') => void;
}

function UnitCard({ unit, expanded, onToggle, onDeleteUnit, onDeleteWord, onCopy, onPlay, onQuiz }: UnitCardProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* 单元头 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-sky-50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 shrink-0 text-indigo-500" />
            <h3 className="truncate text-sm font-bold text-slate-800">{unit.name}</h3>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
            <span>共 {unit.words.length} 词</span>
            <span>· {formatTimestamp(unit.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onQuiz('word-meaning')}
            className="inline-flex items-center gap-1.5 rounded-full border border-violet-300 bg-violet-100 px-4 py-1.5 text-[13px] font-bold text-violet-700 transition hover:border-violet-400 hover:bg-violet-200 active:translate-y-0.5"
          >
            <BookOpen className="h-4 w-4" /> 看词识意
          </button>
          <button
            onClick={() => onQuiz('meaning-word')}
            className="inline-flex items-center gap-1.5 rounded-full border border-sky-300 bg-sky-100 px-4 py-1.5 text-[13px] font-bold text-sky-700 transition hover:border-sky-400 hover:bg-sky-200 active:translate-y-0.5"
          >
            <Headphones className="h-4 w-4" /> 听音辨义
          </button>
          <button
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-100 px-4 py-1.5 text-[13px] font-bold text-emerald-700 transition hover:border-emerald-400 hover:bg-emerald-200 active:translate-y-0.5"
          >
            <Copy className="h-4 w-4" /> 复制本单元
          </button>
          <button
            onClick={() => {
              if (confirm(`删除整个单元「${unit.name}」？`)) onDeleteUnit();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-500 transition hover:border-rose-300 hover:bg-rose-100"
            title="删除单元"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={onToggle}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
            title={expanded ? '收起' : '展开'}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* 列表 */}
      {expanded && (
        <div className="max-h-[60vh] overflow-auto px-4 py-2">
          {unit.words.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">单元里还没有单词</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {unit.words.map((w, i) => (
                <WordRow key={i} idx={i + 1} word={w} onPlay={onPlay} onDelete={() => onDeleteWord(i)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WordRow({ idx, word, onPlay, onDelete }: { idx: number; word: WordEntry; onPlay: (url: string, word: string, accent?: 'us' | 'uk') => void; onDelete: () => void }) {
  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto_auto_auto] items-start gap-x-2 gap-y-1 py-2 text-sm">
      <span className="self-center text-center text-xs text-slate-400 tabular-nums">{idx}</span>
      <span className="break-words whitespace-normal self-center font-semibold leading-snug text-slate-800">{word.word}</span>
      <span className="self-center inline-flex gap-1">
        {word.us && (
          <button
            onClick={() => onPlay(word.us, word.word, 'us')}
            title="美音"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-sky-300 hover:text-sky-600"
          >
            <Volume2 className="h-2.5 w-2.5" /> 美
          </button>
        )}
        {word.uk && (
          <button
            onClick={() => onPlay(word.uk, word.word, 'uk')}
            title="英音"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
          >
            <Volume2 className="h-2.5 w-2.5" /> 英
          </button>
        )}
        {!word.us && !word.uk && (
          <>
            <button onClick={() => onPlay('', word.word, 'us')} title="美音" className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-sky-300 hover:text-sky-600">
              <Volume2 className="h-2.5 w-2.5" /> 美
            </button>
            <button onClick={() => onPlay('', word.word, 'uk')} title="英音" className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-indigo-300 hover:text-indigo-600">
              <Volume2 className="h-2.5 w-2.5" /> 英
            </button>
          </>
        )}
      </span>
      <span className="self-center text-xs leading-relaxed text-slate-500">
        {word.meaning}
      </span>
      <button onClick={onDelete} title="删除" className="self-center flex h-6 w-6 items-center justify-center rounded-md text-slate-300 hover:bg-rose-50 hover:text-rose-500">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
