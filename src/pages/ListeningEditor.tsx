/**
 * ListeningEditor —— 听力精听「编辑页」
 *   参考图风格：
 *     - 顶部：音频文件名 + 播放控件 + 进度
 *     - 波形图：分句交替彩色背景块 + 深色明显结束线 + 蓝色暂停线
 *     - 波形图上可拖拽结束线微调时间，可双击添加暂停线
 *     - 波形图"中心处拆分"按钮：把光标所在分句在音频中点劈开
 *     - 下方分句列表：序号、原文、翻译、时间戳、▶播放、删分句
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Play, Pause, Save, Trash2, Pencil, Volume2,
} from 'lucide-react';
import type { SentenceSegment } from '@/types';
import {
  decodeAudioFile, downsample, drawWaveform, pixelToTime,
} from '@/utils/waveformUtils';
import { splitSegment, removeSegmentAt, segBreakpoints } from '@/pages/ListeningPage';

interface Props {
  fileName: string;
  audioDataUrl: string;
  initialDuration: number;
  initialSegments: SentenceSegment[];
  /** 拆分完分句后的分句更新（保存到 store） */
  onSegmentsChange: (segs: SentenceSegment[]) => void;
  /** 保存 */
  onSave: () => void;
  /** 返回导入页 */
  onBack: () => void;
}

export default function ListeningEditor({
  fileName, audioDataUrl, initialDuration, initialSegments,
  onSegmentsChange, onSave, onBack,
}: Props) {
  // ===== 状态 =====
  const [audioDuration, setAudioDuration] = useState(initialDuration);
  const [bars, setBars] = useState<number[]>([]);
  const [segments, setSegments] = useState<SentenceSegment[]>(initialSegments);
  const [pausePoints, setPausePoints] = useState<number[]>([]);

  // 视口缩放/平移
  const [zoom, setZoom] = useState(1);
  const [viewStartIdx, setViewStartIdx] = useState(0);
  const [viewEndIdx, setViewEndIdx] = useState(0);

  // 播放
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeSegmentIdx, setActiveSegmentIdx] = useState<number | null>(null);
  const segmentEndRef = useRef<number | null>(null);
  const nextPausePointRef = useRef<number | null>(null);
  const SAFETY_MARGIN = 0.08;

  // 波形画布
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioFileRef = useRef<File | null>(null); // 用于 resize 时重采样

  // ============================================
  // 派生：viewStartIdx / viewEndIdx 根据 zoom 计算
  // ============================================
  useEffect(() => {
    if (bars.length === 0) return;
    const viewLen = Math.max(20, Math.round(bars.length / zoom));
    setViewStartIdx((prev) => Math.min(prev, Math.max(0, bars.length - viewLen)));
    setViewEndIdx((prev) => {
      const start = Math.min(viewStartIdx, Math.max(0, bars.length - viewLen));
      return Math.min(bars.length, start + viewLen);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, bars.length]);

  // 播放中自动把红条滚到视口中间
  useEffect(() => {
    if (!isPlaying || audioDuration <= 0 || bars.length === 0) return;
    const curBar = Math.floor((currentTime / audioDuration) * bars.length);
    const viewLen = viewEndIdx - viewStartIdx;
    if (curBar >= viewEndIdx - Math.round(viewLen * 0.2)) {
      const newStart = Math.max(0, curBar - Math.round(viewLen * 0.2));
      setViewStartIdx(newStart);
      setViewEndIdx(Math.min(bars.length, newStart + viewLen));
    }
  }, [currentTime, isPlaying, zoom, bars.length, audioDuration, viewStartIdx, viewEndIdx]);

  // ============================================
  // 音频元素事件
  // ============================================
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTimeUpdate = () => {
      const t = el.currentTime;
      setCurrentTime(t);

      const segEnd = segmentEndRef.current;
      if (segEnd != null && t >= segEnd - SAFETY_MARGIN) {
        el.pause();
        el.currentTime = segEnd;
        segmentEndRef.current = null;
        setIsPlaying(false);
        return;
      }
      const np = nextPausePointRef.current;
      if (np != null && np > 0 && t >= np - SAFETY_MARGIN) {
        el.pause();
        el.currentTime = np;
        nextPausePointRef.current = null;
        setIsPlaying(false);
        const future = pausePoints.filter((p) => p > np + 0.01).sort((a, b) => a - b);
        if (future.length > 0) nextPausePointRef.current = future[0];
      }
      let idx = -1;
      for (let i = 0; i < segments.length; i++) {
        if (t >= segments[i].startTime && t < segments[i].endTime) { idx = i; break; }
      }
      if (idx === -1 && segments.length > 0 && t >= segments[segments.length - 1].endTime) idx = segments.length - 1;
      setActiveSegmentIdx(idx >= 0 ? idx : null);
    };
    const onPause = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);

    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('pause', onPause);
    el.addEventListener('play', onPlay);
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('play', onPlay);
    };
  }, [segments, pausePoints]);

  // 空格键 = 播放/暂停
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioDataUrl, pausePoints]);

  // ============================================
  // 波形解码：把 dataUrl 解回来拿采样
  // ============================================
  useEffect(() => {
    if (!audioDataUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(audioDataUrl);
        const ab = await res.arrayBuffer();
        const ACtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new ACtor();
        const buf = await ctx.decodeAudioData(ab.slice(0));
        const cd = buf.getChannelData(0);
        if (cancelled) { await ctx.close(); return; }
        setAudioDuration(buf.duration);
        const canvasEl = canvasRef.current;
        const barCount = canvasEl ? Math.max(300, Math.floor(canvasEl.clientWidth * 2)) : 600;
        setBars(downsample(cd, barCount));
        await ctx.close();
      } catch (e) {
        console.error('解码音频失败', e);
      }
    })();
    return () => { cancelled = true; };
  }, [audioDataUrl]);

  // ResizeObserver：窗口变了重采样
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(async () => {
      if (!audioDataUrl) return;
      try {
        const res = await fetch(audioDataUrl);
        const ab = await res.arrayBuffer();
        const ACtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new ACtor();
        const buf = await ctx.decodeAudioData(ab.slice(0));
        const cd = buf.getChannelData(0);
        const barCount = Math.max(300, Math.floor(canvas.clientWidth * 2));
        setBars(downsample(cd, barCount));
        await ctx.close();
      } catch { /* ignore */ }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [audioDataUrl]);

  // 重绘波形
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || bars.length === 0 || audioDuration <= 0) return;
    drawWaveform({
      canvas, bars, duration: audioDuration,
      viewStartIdx, viewEndIdx,
      currentTime: isPlaying ? currentTime : null,
      allBreakpoints: segBreakpoints(segments),
      pausePoints,
      segmentRanges: segments.map((s, i) => ({ startTime: s.startTime, endTime: s.endTime, idx: i })),
      pauseColor: '#f59e0b', // 黄色暂停线（虚线）
    });
  }, [bars, audioDuration, segments, pausePoints, currentTime, isPlaying, viewStartIdx, viewEndIdx]);

  // ============================================
  // 底部整体预览小波形（全音频 + 深色视口框 + 暂停线 + 当前播放位置）
  // ============================================
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const preview = previewCanvasRef.current;
    if (!preview || bars.length === 0 || audioDuration <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = preview.getBoundingClientRect();
    const pw = rect.width, ph = rect.height;
    if (pw <= 0 || ph <= 0) return;
    preview.width = Math.floor(pw * dpr);
    preview.height = Math.floor(ph * dpr);
    const pctx = preview.getContext('2d');
    if (!pctx) return;
    pctx.scale(dpr, dpr);

    // 背景
    pctx.fillStyle = '#f1f5f9';
    pctx.fillRect(0, 0, pw, ph);

    // 波形（全量 bars）
    const centerY = ph / 2;
    const maxHalf = ph * 0.38;
    const barW = pw / bars.length;
    for (let i = 0; i < bars.length; i++) {
      const amp = bars[i];
      const half = Math.max(0.5, amp * maxHalf);
      pctx.fillStyle = '#94a3b8';
      pctx.fillRect(i * barW + barW / 2 - barW * 0.35, centerY - half, barW * 0.7, half * 2);
    }

    // 分句结束线（深色细竖线）
    pctx.strokeStyle = 'rgba(51, 65, 85, 0.7)';
    pctx.lineWidth = 0.8;
    for (const bp of segBreakpoints(segments)) {
      const x = (bp / audioDuration) * pw;
      pctx.beginPath(); pctx.moveTo(x, 0); pctx.lineTo(x, ph); pctx.stroke();
    }
    pctx.lineWidth = 1;

    // 暂停线（黄色虚线）
    pctx.setLineDash([4, 3]);
    pctx.strokeStyle = '#f59e0b';
    pctx.lineWidth = 1.5;
    for (const p of pausePoints) {
      const x = (p / audioDuration) * pw;
      pctx.beginPath(); pctx.moveTo(x, 0); pctx.lineTo(x, ph); pctx.stroke();
    }
    pctx.setLineDash([]);
    pctx.lineWidth = 1;

    // 深色视口框（当前显示的那一段）
    const vx1 = (viewStartIdx / bars.length) * pw;
    const vx2 = (viewEndIdx / bars.length) * pw;
    // 半透明遮罩（视口外区域变暗）
    pctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
    pctx.fillRect(0, 0, vx1, ph);
    pctx.fillRect(vx2, 0, pw - vx2, ph);
    // 视口高亮框边
    pctx.strokeStyle = '#1e293b';
    pctx.lineWidth = 2;
    pctx.strokeRect(vx1, 1, vx2 - vx1, ph - 2);
    pctx.lineWidth = 1;

    // 当前播放位置小红线 + 小三角
    if (currentTime >= 0) {
      const cx = (currentTime / audioDuration) * pw;
      pctx.strokeStyle = '#ef4444';
      pctx.lineWidth = 1.5;
      pctx.beginPath(); pctx.moveTo(cx, 0); pctx.lineTo(cx, ph); pctx.stroke();
      pctx.lineWidth = 1;
    }
  }, [bars, audioDuration, segments, pausePoints, viewStartIdx, viewEndIdx, currentTime]);

  // 底部预览图点击 → 视口快速跳转
  const onPreviewClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (bars.length === 0 || zoom <= 1) return;
    const preview = previewCanvasRef.current;
    if (!preview) return;
    const rect = preview.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const t = ratio * audioDuration;
    // 以点击点为中心，视口长度保持不变
    const viewLen = viewEndIdx - viewStartIdx;
    const centerIdx = ratio * bars.length;
    let newStart = Math.max(0, Math.min(bars.length - viewLen, centerIdx - viewLen / 2));
    setViewStartIdx(Math.round(newStart));
    setViewEndIdx(Math.round(newStart + viewLen));
    // 标杆也跳到这里
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  // ============================================
  // 播放控制
  // ============================================
  const togglePlay = async () => {
    if (!audioRef.current || !audioDataUrl) return;
    if (audioRef.current.paused) {
      if (audioRef.current.src !== audioDataUrl) audioRef.current.src = audioDataUrl;
      const t = audioRef.current.currentTime;
      const future = pausePoints.filter((p) => p > t + 0.01).sort((a, b) => a - b);
      nextPausePointRef.current = future[0] ?? null;
      segmentEndRef.current = null;
      await audioRef.current.play();
      setIsPlaying(true);
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const playSegment = async (idx: number) => {
    if (!audioRef.current || !audioDataUrl) return;
    const seg = segments[idx];
    if (!seg) return;
    const same = isPlaying && activeSegmentIdx === idx && segmentEndRef.current != null;
    if (same) { audioRef.current.pause(); audioRef.current.currentTime = seg.startTime; segmentEndRef.current = null; return; }

    if (audioRef.current.src !== audioDataUrl) audioRef.current.src = audioDataUrl;
    audioRef.current.currentTime = seg.startTime;
    segmentEndRef.current = seg.endTime;
    nextPausePointRef.current = null;
    await audioRef.current.play();
    setIsPlaying(true);
    setActiveSegmentIdx(idx);
  };

  // ============================================
  // 波形图事件（拖拽微调 / 单击定位 / 双击暂停线 / 滚轮平移）
  // ============================================
  type DragMode = null | { kind: 'pause' | 'breakpoint'; index: number; startX: number; moved: boolean };
  const dragStateRef = useRef<DragMode>(null);
  const clickTimerRef = useRef<number | null>(null);

  const px2t = (clientX: number) => pixelToTime(
    canvasRef.current!, audioDuration, bars.length, viewStartIdx, viewEndIdx, clientX);

  const time2px = (t: number) => {
    if (bars.length === 0 || audioDuration <= 0) return 0;
    const viewLen = viewEndIdx - viewStartIdx;
    if (viewLen <= 0) return 0;
    const ratio = ((t / audioDuration) * bars.length - viewStartIdx) / viewLen;
    const rect = canvasRef.current!.getBoundingClientRect();
    return rect.left + Math.max(0, Math.min(1, ratio)) * rect.width;
  };

  const findHit = (clientX: number, clientY: number): DragMode => {
    const rect = canvasRef.current!.getBoundingClientRect();
    if (clientY < rect.top || clientY > rect.bottom) return null;
    const HIT_PX = 10;
    for (let i = 0; i < pausePoints.length; i++) {
      const x = time2px(pausePoints[i]);
      if (Math.abs(clientX - x) <= HIT_PX) return { kind: 'pause', index: i, startX: clientX, moved: false };
    }
    const segBps = segBreakpoints(segments);
    for (let i = 0; i < segBps.length; i++) {
      const x = time2px(segBps[i]);
      if (Math.abs(clientX - x) <= HIT_PX) return { kind: 'breakpoint', index: i, startX: clientX, moved: false };
    }
    return null;
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (audioDuration <= 0 || bars.length === 0 || e.button !== 0) return;
    const hit = findHit(e.clientX, e.clientY);
    if (hit) {
      dragStateRef.current = hit;
      (e.currentTarget as HTMLCanvasElement).style.cursor = hit.kind === 'pause' ? 'ew-resize' : 'col-resize';
      if (clickTimerRef.current) { window.clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
      return;
    }
    clickTimerRef.current = window.setTimeout(() => { clickTimerRef.current = null; }, 500); // 占位（单击在 onMouseUp 里处理）
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (audioDuration <= 0 || bars.length === 0) return;
    const drag = dragStateRef.current;
    if (drag) {
      const dx = Math.abs(e.clientX - drag.startX);
      if (!drag.moved && dx > 5) drag.moved = true;
      if (!drag.moved) return;

      const t = px2t(e.clientX);
      const clamped = Math.max(0, Math.min(audioDuration, t));

      if (drag.kind === 'pause') {
        setPausePoints((prev) => {
          const next = [...prev];
          next[drag.index] = clamped;
          next.sort((a, b) => a - b);
          return next;
        });
      } else {
        setSegments((prev) => {
          if (prev.length < 2) return prev;
          const left = prev[drag.index];
          const right = prev[drag.index + 1];
          const minLeft = left.startTime + 0.1;
          const maxRight = right.endTime - 0.1;
          const newBreak = Math.max(minLeft, Math.min(maxRight, clamped));
          const next = [...prev];
          next[drag.index] = { ...left, endTime: newBreak };
          next[drag.index + 1] = { ...right, startTime: newBreak };
          return next;
        });
      }
      return;
    }
    const hit = findHit(e.clientX, e.clientY);
    (e.currentTarget as HTMLCanvasElement).style.cursor = hit
      ? (hit.kind === 'pause' ? 'ew-resize' : 'col-resize') : 'pointer';
  };

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (audioDuration <= 0 || bars.length === 0) return;
    const drag = dragStateRef.current;
    dragStateRef.current = null;
    (e.currentTarget as HTMLCanvasElement).style.cursor = 'pointer';

    // 任何命中线的 mouseDown → 不触发标杆跳转（哪怕没真拖，也不能让标杆被"拖完回到起点"这种 bug 带走）
    if (drag) return;

    // 没命中任何线 → 正常单击：标杆跳到该处
    const t = px2t(e.clientX);
    if (audioRef.current) {
      audioRef.current.currentTime = t;
      if (isPlaying) {
        const future = pausePoints.filter((p) => p > t + 0.01).sort((a, b) => a - b);
        nextPausePointRef.current = future[0] ?? null;
      }
    }
    setCurrentTime(t);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (audioDuration <= 0 || bars.length === 0) return;
    if (clickTimerRef.current) { window.clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
    const t = px2t(e.clientX);
    const existingIdx = pausePoints.findIndex((p) => Math.abs(p - t) < 0.08);
    if (existingIdx >= 0) {
      setPausePoints((prev) => prev.filter((_, i) => i !== existingIdx));
    } else {
      setPausePoints((prev) => [...prev, t].sort((a, b) => a - b));
    }
    const tNow = audioRef.current?.currentTime ?? currentTime;
    const future = pausePoints.filter((p) => p > tNow + 0.01).sort((a, b) => a - b);
    nextPausePointRef.current = future[0] ?? null;
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (bars.length === 0 || zoom <= 1) return;
    e.preventDefault();
    const viewLen = viewEndIdx - viewStartIdx;
    const maxStart = Math.max(0, bars.length - viewLen);
    const delta = Math.sign(e.deltaY) * Math.max(20, Math.round(viewLen * 0.08));
    const newStart = Math.min(maxStart, Math.max(0, viewStartIdx - delta));
    setViewStartIdx(newStart);
    setViewEndIdx(newStart + viewLen);
  };

  // ============================================
  // 拆分/合并分句按钮
  // ============================================
  const splitCurrentSegment = () => {
    let idx = activeSegmentIdx ?? 0;
    const target = segments[idx];
    if (!target) return;
    if (target.endTime - target.startTime < 0.2) { alert('分句太短（< 0.2s），无法再拆分'); return; }
    const splitTime = (target.startTime + target.endTime) / 2;
    const halfLen = Math.max(1, Math.round(target.text.length / 2));
    setSegments((prev) => splitSegment(prev, idx, splitTime,
      target.text.slice(0, halfLen), target.text.slice(halfLen)));
  };

  const removeSegment = (idx: number) => {
    if (segments.length <= 1) { alert('至少保留一个分句'); return; }
    setSegments((prev) => removeSegmentAt(prev, idx));
  };

  const updateTranslation = (id: string, value: string) => {
    setSegments((prev) => prev.map((s) => s.id === id ? { ...s, translation: value } : s));
  };

  // 通知父组件（同步保存分句到 store）
  useEffect(() => {
    onSegmentsChange(segments);
  }, [segments, onSegmentsChange]);

  const fmt = (t: number) => {
    if (!isFinite(t) || t < 0) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-white">
      {/* 顶部栏 */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
          <button onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
            <ArrowLeft className="h-4 w-4" />返回导入页
          </button>
          <div className="flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium truncate max-w-[240px]">
              <Volume2 className="h-4 w-4 text-indigo-500" />
              {fileName}
            </span>
            <span className="text-slate-400">·</span>
            <span className="font-mono text-slate-500">{fmt(currentTime)} / {fmt(audioDuration)}</span>
          </div>
          <button onClick={onSave}
            className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700">
            <Save className="h-3.5 w-3.5" />保存
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6">
        {/* 播放控件 + 缩放 */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={togglePlay}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md transition hover:shadow-lg">
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <span className="text-xs text-slate-500">空格 = 播放/暂停</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
              暂停线 {pausePoints.length}
            </span>
            <button onClick={() => setPausePoints([])}
              className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700">
              清空暂停线
            </button>
            <input type="range" min={1} max={6} step={1} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-28 accent-indigo-500 ml-2" />
            <span className="font-mono text-xs text-slate-500 w-7 text-right">{zoom}x</span>
          </div>
        </div>

        {/* 波形图 */}
        <div className="relative mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
            className="block w-full cursor-pointer"
            style={{ height: 130 }}
          />
          <audio ref={audioRef} preload="auto" />
          {/* 右下角：中心处拆分 */}
          <button
            onClick={splitCurrentSegment}
            title="把当前分句从中间拆成两个（光标所在或第一个）"
            className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-amber-500/90 px-2.5 py-1 text-xs text-white shadow hover:bg-amber-600">
            <Pencil className="h-3 w-3" />中心处拆分
          </button>
        </div>

        {/* 底部整体预览小波形（参考图风格） */}
        <div className="mb-3">
          <canvas
            ref={previewCanvasRef}
            onClick={onPreviewClick}
            className="block w-full rounded-lg border border-slate-200 bg-slate-100 cursor-crosshair"
            style={{ height: 38 }}
          />
          <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 font-mono">
            <span>0:00</span>
            <span>整体预览 · 深色框 = 当前视口 · 黄虚线 = 暂停线 · 红竖线 = 当前播放位置</span>
            <span>{fmt(audioDuration)}</span>
          </div>
        </div>

        {/* 操作提示 */}
        <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span><kbd className="rounded bg-slate-100 px-1">单击</kbd> 标杆跳到该处</span>
          <span><kbd className="rounded bg-slate-100 px-1">双击</kbd> 添加/取消暂停线</span>
          <span><kbd className="rounded bg-slate-100 px-1">空格</kbd> 播放/暂停</span>
          <span><kbd className="rounded bg-slate-100 px-1">滚轮</kbd> 左右平移</span>
          <span><kbd className="rounded bg-slate-100 px-1">拖动深色线</kbd> 微调分句时间</span>
          <span><kbd className="rounded bg-slate-100 px-1">拖动蓝色线</kbd> 微调暂停点</span>
        </div>

        {/* 分句列表 */}
        <div className="space-y-3">
          {segments.map((seg, idx) => {
            const isCurrent = isPlaying && activeSegmentIdx === idx;
            return (
              <div key={seg.id} className={`rounded-xl border bg-white p-4 transition ${
                isCurrent ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'}`}>
                <div className="flex items-start gap-3">
                  <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    isCurrent ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base leading-relaxed text-slate-800">{seg.text}</p>
                    <p className="mt-1 text-xs text-slate-400 font-mono">
                      {fmt(seg.startTime)} – {fmt(seg.endTime)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => playSegment(idx)}
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        isCurrent ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}>
                      {isCurrent ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      {isCurrent ? '暂停' : '播放'}
                    </button>
                    <button onClick={() => removeSegment(idx)} title="删除此分句"
                      className="rounded-full px-2 py-1.5 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 rounded-lg bg-slate-50 p-3">
                  <input
                    type="text"
                    value={seg.translation}
                    onChange={(e) => updateTranslation(seg.id, e.target.value)}
                    placeholder="中文翻译…"
                    className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
