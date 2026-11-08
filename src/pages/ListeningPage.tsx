/**
 * ListeningPage —— 听力精听「目录页」
 *   进入听力精听后首先看到的页面：展示所有已收集的精听材料（上传的链接 / 导入的网页）。
 *
 *   顶部入口：
 *     - 「上传音频」：跳转外部拆分工具（audio-splitter），在那里拆分并生成播放页
 *   两种收集方式：
 *     - 粘贴分享链接 → 生成外链卡片（点击在新标签页打开）
 *     - 导入「下载网页」得到的 .html 文件 → 解析句数/时长，网页本体存 IndexedDB
 *   排序：
 *     - 手动拖拽卡片调整顺序，点「完成排序」保存
 *
 *   同时导出 splitByLines / buildFromTexts / splitSegment / removeSegmentAt / segBreakpoints
 *   这些工具函数被 ListeningUpload / ListeningEditor 直接引用。
 */

import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Volume2, Plus, Link2, FileUp, GripVertical, Trash2, ExternalLink,
  Music2, Loader2, X, Check, ListMusic, Sparkles, Lock, Search,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { ListeningEntry, SentenceSegment } from '@/types';
import { getHtmlPage, saveHtmlPage, deleteHtmlPage } from '@/utils/htmlStore';
import { injectLookup } from '@/utils/lookupInject';
import { cn } from '@/lib/utils';

// ============================================
// 工具函数（export 给 ListeningUpload / ListeningEditor 复用）
// ============================================

/** 外部音频拆分工具地址（上传音频入口） */
export const AUDIO_SPLITTER_URL =
  'https://audio-splitter-study.app.workbuddy.host/?sharecode=6A2QF3UZEN';

/** 唯一 ID */
export function generateId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 按换行分句（一行一句，过滤空行） */
export function splitByLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 分句结束时间 → 时间数组 */
export function segBreakpoints(segs: SentenceSegment[]): number[] {
  return segs.slice(0, -1).map((s) => s.endTime);
}

/** 按文本均分时间 → SentenceSegment[] */
export function buildFromTexts(texts: string[], duration: number): SentenceSegment[] {
  if (texts.length === 0 || duration <= 0) return [];
  const step = duration / texts.length;
  return texts.map((t, i) => ({
    id: generateId(),
    text: t,
    translation: '',
    startTime: i * step,
    endTime: (i + 1) * step,
  }));
}

/** 拆分某个分句为两个：前半 [startTime, splitTime]，后半 [splitTime, endTime] */
export function splitSegment(
  segments: SentenceSegment[],
  idx: number,
  splitTime: number,
  textA: string,
  textB: string
): SentenceSegment[] {
  if (idx < 0 || idx >= segments.length) return segments;
  const orig = segments[idx];
  const segA: SentenceSegment = {
    id: generateId(), text: textA, translation: '',
    startTime: orig.startTime, endTime: splitTime,
  };
  const segB: SentenceSegment = {
    id: generateId(), text: textB, translation: '',
    startTime: splitTime, endTime: orig.endTime,
  };
  return [...segments.slice(0, idx), segA, segB, ...segments.slice(idx + 1)];
}

/** 删除某个分句（合并到前一个 / 后一个） */
export function removeSegmentAt(
  segments: SentenceSegment[],
  idx: number
): SentenceSegment[] {
  if (segments.length <= 1) return segments;
  if (idx === 0) {
    const merged = {
      ...segments[1],
      text: segments[0].text + ' ' + segments[1].text,
      startTime: segments[0].startTime,
    };
    return [merged, ...segments.slice(2)];
  }
  const prev = segments[idx - 1];
  const cur = segments[idx];
  const merged = {
    ...prev,
    text: prev.text + ' ' + cur.text,
    endTime: cur.endTime,
  };
  const out: SentenceSegment[] = [
    ...segments.slice(0, idx - 1),
    merged,
    ...segments.slice(idx + 1),
  ];
  // 对齐后续分句的 startTime（保证无缝衔接）
  for (let i = 1; i < out.length; i++) {
    out[i] = { ...out[i], startTime: out[i - 1].endTime };
  }
  return out;
}

// ============================================
// 页面内部工具
// ============================================

/** 从 URL 推导一个可读标题（跨域抓取失败时的兜底） */
function titleFromUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const code = u.searchParams.get('sharecode') || u.searchParams.get('code');
    if (code) return `分享课程 ${code}`;
    const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    if (seg) return seg.replace(/\.html?$/i, '');
    return u.hostname;
  } catch {
    return '未命名精听';
  }
}

/**
 * 从「下载网页」生成的 HTML 文本里提取元信息：
 *   该页面内嵌 var D = { lines: [{t,s,e,x}], dur, name, ... }
 */
function parseShareHtml(html: string): { title: string; lineCount: number; duration: number } {
  let title = '';
  let lineCount = 0;
  let duration = 0;

  // 1) 内嵌数据：var D = { ... };
  const startIdx = html.search(/var\s+D\s*=\s*\{/);
  if (startIdx >= 0) {
    const braceStart = html.indexOf('{', startIdx);
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < html.length; i++) {
      const ch = html[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end > braceStart) {
      const jsonText = html.slice(braceStart, end + 1);
      try {
        const data = JSON.parse(jsonText) as {
          name?: string; dur?: number; lines?: unknown[];
        };
        if (data.name) title = String(data.name).replace(/\.[^.]+$/, '');
        if (typeof data.dur === 'number') duration = data.dur;
        if (Array.isArray(data.lines)) lineCount = data.lines.length;
      } catch {
        /* 解析失败则继续用正则兜底 */
      }
    }
  }

  // 2) <title>xxx · 逐句听练</title>
  if (!title) {
    const m = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (m) title = m[1].replace(/<[^>]+>/g, '').replace(/·\s*逐句听练.*$/s, '').trim();
  }

  return { title: title || '', lineCount, duration };
}

/** 秒 → mm:ss */
function fmtDuration(sec?: number): string {
  if (!sec || !isFinite(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 时间戳 → 月/日 */
function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ============================================
// 主组件
// ============================================

export default function ListeningPage() {
  const navigate = useNavigate();
  const entries = useAppStore((s) => s.listeningEntries);
  const addListeningEntry = useAppStore((s) => s.addListeningEntry);
  const removeListeningEntry = useAppStore((s) => s.removeListeningEntry);
  const moveListeningEntry = useAppStore((s) => s.moveListeningEntry);

  // 导入弹窗：null=关闭 / 'link'=粘贴链接
  const [dialog, setDialog] = useState<null | 'link'>(null);
  const [linkInput, setLinkInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  // 排序模式（拖拽）
  const [sorting, setSorting] = useState(false);
  // 目录搜索关键词
  const [search, setSearch] = useState('');
  const dragFromRef = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const htmlInputRef = useRef<HTMLInputElement | null>(null);

  // ===== 密码保护：上传音频 / 粘贴链接 / 导入网页 / 排序 需要先输入密码 =====
  const UNLOCK_PASSWORD = '11111111111';
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdInput, setPwdInput] = useState('');
  const [pwdError, setPwdError] = useState('');
  /** 校验通过后要继续执行的动作 */
  const pendingActionRef = useRef<(() => void) | null>(null);

  /** 受保护入口统一走这里：每次都先弹密码框，校验通过才执行 */
  const requireUnlock = useCallback((action: () => void) => {
    pendingActionRef.current = action;
    setPwdInput('');
    setPwdError('');
    setPwdOpen(true);
  }, []);

  const submitPassword = () => {
    if (pwdInput.trim() !== UNLOCK_PASSWORD) {
      setPwdError('密码不正确，请重试');
      return;
    }
    setPwdOpen(false);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  };

  // ===== 导入网页：先解析，再让用户确认/修改名称 =====
  const [pendingFiles, setPendingFiles] = useState<
    { html: string; title: string; lineCount?: number; duration?: number }[]
  >([]);
  const [pendingTitle, setPendingTitle] = useState('');

  // 打开某个目录条目
  const openEntry = useCallback(async (entry: ListeningEntry) => {
    if (entry.kind === 'link' && entry.url) {
      window.open(entry.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (entry.kind === 'html' && entry.htmlKey) {
      const html = await getHtmlPage(entry.htmlKey);
      if (!html) {
        alert('本地网页文件已丢失，请重新导入这份 .html');
        return;
      }
      // 打开前注入「划词查义」脚本：完整版文本里选中单词/句子自动显示释义（有道优先）
      const patched = injectLookup(html);
      const url = URL.createObjectURL(new Blob([patched], { type: 'text/html;charset=utf-8' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      // 给新标签页留出加载时间后释放
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }, []);

  // 删除条目
  const handleDelete = useCallback(async (entry: ListeningEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`确定删除「${entry.title}」吗？`)) return;
    removeListeningEntry(entry.id);
    if (entry.htmlKey) {
      try { await deleteHtmlPage(entry.htmlKey); } catch { /* 忽略 */ }
    }
  }, [removeListeningEntry]);

  // ===== 粘贴链接导入 =====
  // 输入框变化时，若标题未被手动改过，则跟着链接自动推导
  const handleLinkChange = (v: string) => {
    setLinkInput(v);
    setImportError('');
    setTitleInput(v.trim() ? titleFromUrl(v.trim()) : '');
  };

  const handleImportLink = async () => {
    const url = linkInput.trim();
    if (!/^https?:\/\//i.test(url)) {
      setImportError('请输入以 http:// 或 https:// 开头的链接');
      return;
    }
    setImporting(true);
    setImportError('');
    let title = titleInput.trim() || titleFromUrl(url);

    // 尝试抓取网页标题（同源/允许跨域时成功；外部站点通常会被 CORS 拦截，自动回退）
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (res.ok) {
        const text = await res.text();
        const m = text.match(/<title>([\s\S]*?)<\/title>/i);
        const fetched = m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
        if (fetched && fetched !== '音频拆分 · 逐句听练') title = fetched;
      }
    } catch {
      /* CORS 或网络失败：使用推导标题 */
    }

    addListeningEntry({
      id: generateId(),
      title,
      kind: 'link',
      url,
      createdAt: Date.now(),
      order: entries.length,
    });
    setImporting(false);
    setDialog(null);
    setLinkInput('');
    setTitleInput('');
    setSorting(true); // 抓取成功后自动回到目录并进入排序
  };

  // ===== 导入 .html 网页文件：先解析出默认名称，再弹窗让用户确认/修改 =====
  const handleHtmlFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      const parsed: { html: string; title: string; lineCount?: number; duration?: number }[] = [];
      for (const file of Array.from(files)) {
        const html = await file.text();
        const meta = parseShareHtml(html);
        parsed.push({
          html,
          title: meta.title || file.name.replace(/\.html?$/i, ''),
          lineCount: meta.lineCount || undefined,
          duration: meta.duration || undefined,
        });
      }
      if (parsed.length) {
        setPendingFiles(parsed);
        setPendingTitle(parsed[0].title);
      }
    } catch (err) {
      console.error(err);
      alert('导入网页失败，请确认文件是「下载网页」生成的 .html');
    } finally {
      setImporting(false);
      if (htmlInputRef.current) htmlInputRef.current.value = '';
    }
  }, []);

  /** 确认当前这份网页的名称并加入目录；多文件时依次处理 */
  const confirmPendingImport = async () => {
    if (!pendingFiles.length) return;
    const current = pendingFiles[0];
    const name = pendingTitle.trim() || current.title || '未命名精听';
    setImporting(true);
    try {
      const id = generateId();
      await saveHtmlPage(id, current.html);
      addListeningEntry({
        id,
        title: name,
        kind: 'html',
        htmlKey: id,
        lineCount: current.lineCount,
        duration: current.duration,
        createdAt: Date.now(),
        order: 0,
      });
      const rest = pendingFiles.slice(1);
      setPendingFiles(rest);
      setPendingTitle(rest[0]?.title || '');
      if (rest.length === 0) setSorting(true);
    } catch (err) {
      console.error(err);
      alert('保存网页失败，可能是浏览器存储空间不足');
    } finally {
      setImporting(false);
    }
  };


  // ===== 拖拽排序 =====
  const onDragStart = (idx: number) => {
    dragFromRef.current = idx;
  };
  const onDragOver = (idx: number, e: React.DragEvent) => {
    e.preventDefault();
    if (dragOver !== idx) setDragOver(idx);
  };
  const onDrop = (idx: number) => {
    const from = dragFromRef.current;
    dragFromRef.current = null;
    setDragOver(null);
    if (from === null) return;
    moveListeningEntry(from, idx);
  };

  // 搜索过滤：按名称匹配（不区分大小写）
  const keyword = search.trim().toLowerCase();
  const visibleEntries = keyword
    ? entries.filter((e) => e.title.toLowerCase().includes(keyword))
    : entries;
  /** 可见条目 → 在原始目录中的位置（拖拽排序要用原始索引） */
  const realIndex = (id: string) => entries.findIndex((e) => e.id === id);

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-indigo-50">
      {/* 顶部栏 */}
      <div className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            返回首页
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-sm">
            <Volume2 className="h-3.5 w-3.5" />
            听力精听
          </span>
          <button
            onClick={() => requireUnlock(() => window.open(AUDIO_SPLITTER_URL, '_blank', 'noopener,noreferrer'))}
            className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <Plus className="h-4 w-4" />
            上传音频
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* 标题区 */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-slate-800">
              <ListMusic className="h-6 w-6 text-indigo-600" />
              我的精听目录
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              把拆分好的逐句听练页面收进这里，拖拽卡片即可调整顺序
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 搜索：按精听名称过滤目录 */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索精听名称"
                className="w-48 rounded-full border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:w-60 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  title="清空搜索"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => requireUnlock(() => { setDialog('link'); setImportError(''); })}
              className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50"
            >
              <Link2 className="h-4 w-4" />
              粘贴链接
            </button>
            <button
              onClick={() => requireUnlock(() => htmlInputRef.current?.click())}
              disabled={importing}
              className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-60"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              导入网页
            </button>
            <input
              ref={htmlInputRef}
              type="file"
              accept=".html,.htm,text/html"
              multiple
              className="hidden"
              onChange={(e) => handleHtmlFiles(e.target.files)}
            />
          </div>
        </div>

        {/* 排序提示条 */}
        {sorting && entries.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/80 px-4 py-3">
            <p className="flex items-center gap-2 text-sm text-indigo-800">
              <Sparkles className="h-4 w-4" />
              已生成新的目录：拖拽卡片调整顺序，完成后点右侧按钮
            </p>
            <button
              onClick={() => setSorting(false)}
              className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
            >
              <Check className="h-4 w-4" />
              完成排序
            </button>
          </div>
        )}

        {/* 目录列表 */}
        {entries.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-indigo-200 bg-white/70 px-8 py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-500 shadow-lg shadow-indigo-200">
              <Music2 className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-base font-semibold text-slate-800">目录还是空的</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              点右上角「上传音频」去拆分音频，完成后把「分享 / 下载网页」的链接粘贴进来，
              或直接导入下载好的 .html 网页文件
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                onClick={() => requireUnlock(() => window.open(AUDIO_SPLITTER_URL, '_blank', 'noopener,noreferrer'))}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:-translate-y-0.5"
              >
                <Plus className="h-4 w-4" />
                上传音频
              </button>
              <button
                onClick={() => requireUnlock(() => setDialog('link'))}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <Link2 className="h-4 w-4" />
                粘贴链接
              </button>
            </div>
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white/70 px-8 py-14 text-center">
            <Search className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <h2 className="text-base font-semibold text-slate-700">没有找到匹配的精听</h2>
            <p className="mt-1 text-sm text-slate-500">
              没有名称包含「{search.trim()}」的条目
            </p>
            <button
              onClick={() => setSearch('')}
              className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700"
            >
              <X className="h-4 w-4" />
              清空搜索
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {visibleEntries.map((entry) => {
              const idx = realIndex(entry.id);
              return (
              <div
                key={entry.id}
                draggable={sorting}
                onDragStart={() => onDragStart(idx)}
                onDragOver={(e) => onDragOver(idx, e)}
                onDrop={() => onDrop(idx)}
                onDragEnd={() => { dragFromRef.current = null; setDragOver(null); }}
                onClick={() => { if (!sorting) openEntry(entry); }}
                className={cn(
                  'group relative flex cursor-pointer items-center gap-4 rounded-2xl border bg-white p-4 shadow-sm transition-all',
                  'border-slate-200/80 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg',
                  sorting && 'cursor-grab active:cursor-grabbing',
                  dragOver === idx && 'border-indigo-400 ring-2 ring-indigo-200',
                )}
              >
                {/* 拖拽手柄（排序模式显示） */}
                {sorting && (
                  <GripVertical className="h-5 w-5 shrink-0 text-slate-300" />
                )}
                {/* 类型图标 */}
                <div
                  className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-sm',
                    entry.kind === 'link'
                      ? 'bg-gradient-to-br from-indigo-500 to-blue-500'
                      : 'bg-gradient-to-br from-emerald-500 to-teal-500',
                  )}
                >
                  {entry.kind === 'link'
                    ? <Link2 className="h-6 w-6 text-white" />
                    : <Music2 className="h-6 w-6 text-white" />}
                </div>
                {/* 标题 + 元信息 */}
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-slate-800">{entry.title}</h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        entry.kind === 'link'
                          ? 'bg-indigo-50 text-indigo-600'
                          : 'bg-emerald-50 text-emerald-600',
                      )}
                    >
                      {entry.kind === 'link' ? '分享链接' : '本地网页'}
                    </span>
                    {!!entry.lineCount && <span>{entry.lineCount} 句</span>}
                    {!!fmtDuration(entry.duration) && <span>{fmtDuration(entry.duration)}</span>}
                    <span>{fmtDate(entry.createdAt)}</span>
                  </p>
                </div>
                {/* 操作 */}
                <div className="flex shrink-0 items-center gap-1">
                  {!sorting && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); openEntry(entry); }}
                        title="打开"
                        className="rounded-full p-2 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(entry, e)}
                        title="删除"
                        className="rounded-full p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}

        {/* 底部提示 */}
        {entries.length > 0 && !sorting && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={() => requireUnlock(() => setSorting(true))}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700"
            >
              <GripVertical className="h-4 w-4" />
              调整目录顺序
            </button>
          </div>
        )}
      </div>

      {/* ===== 粘贴链接弹窗 ===== */}
      {dialog === 'link' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-4 backdrop-blur-sm"
          onClick={() => { if (!importing) setDialog(null); }}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-800">
                  <Link2 className="h-4 w-4 text-indigo-600" />
                  粘贴精听链接
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  在拆分工具里点「🔗 分享」拿到播放页链接，粘贴到这里即可生成目录卡片
                </p>
              </div>
              <button
                onClick={() => setDialog(null)}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mb-1 block text-xs font-medium text-slate-500">链接</label>
            <input
              autoFocus
              value={linkInput}
              onChange={(e) => handleLinkChange(e.target.value)}
              placeholder="https://audio-splitter-study.app.workbuddy.host/?sharecode=..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />

            <label className="mb-1 mt-3 block text-xs font-medium text-slate-500">名称（可修改，目录中显示此名称）</label>
            <input
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="自动抓取，也可手动填写"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />

            {importError && <p className="mt-2 text-xs text-rose-500">{importError}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDialog(null)}
                disabled={importing}
                className="rounded-full px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-100"
              >
                取消
              </button>
              <button
                onClick={handleImportLink}
                disabled={importing}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:-translate-y-0.5 disabled:opacity-60"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {importing ? '正在抓取…' : '抓取并添加'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ===== 导入网页：确认 / 修改名称 ===== */}
      {pendingFiles.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4">
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-800">
                <FileUp className="h-4 w-4 text-indigo-600" />
                给这份精听起个名称
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                目录中会显示下面的名称
                {pendingFiles.length > 1 && `（还有 ${pendingFiles.length - 1} 份待命名）`}
                {!!pendingFiles[0]?.lineCount && ` · 共 ${pendingFiles[0].lineCount} 句`}
                {!!fmtDuration(pendingFiles[0]?.duration) && ` · ${fmtDuration(pendingFiles[0].duration)}`}
              </p>
            </div>
            <input
              autoFocus
              value={pendingTitle}
              onChange={(e) => setPendingTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !importing) confirmPendingImport(); }}
              placeholder="例如：四级听力 Unit 3"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => { setPendingFiles([]); setPendingTitle(''); }}
                disabled={importing}
                className="rounded-full px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-100"
              >
                取消
              </button>
              <button
                onClick={confirmPendingImport}
                disabled={importing}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:-translate-y-0.5 disabled:opacity-60"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                保存到目录
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 密码保护弹窗 ===== */}
      {pwdOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm"
          onClick={() => setPwdOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-800">
                  <Lock className="h-4 w-4 text-indigo-600" />
                  需要密码
                </h3>
                <p className="mt-1 text-xs text-slate-500">该操作受保护，请输入密码后继续</p>
              </div>
              <button
                onClick={() => setPwdOpen(false)}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              autoFocus
              type="password"
              value={pwdInput}
              onChange={(e) => { setPwdInput(e.target.value); setPwdError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submitPassword(); }}
              placeholder="请输入密码"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm tracking-widest text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />
            {pwdError && <p className="mt-2 text-xs text-rose-500">{pwdError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPwdOpen(false)}
                className="rounded-full px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-100"
              >
                取消
              </button>
              <button
                onClick={submitPassword}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:-translate-y-0.5"
              >
                <Check className="h-4 w-4" />
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
