/**
 * 波形图绘制与音频解码工具（增强版：支持缩放 + 视口平移 + 暂停线标记）
 *   - 解码音频得到原始 Float32Array 采样
 *   - 降采样到目标条形数
 *   - 支持视口渲染：只渲染 [viewStartIdx, viewEndIdx] 区间内的条形，实现缩放
 *   - 支持暂停线、分句结束线、播放位置线叠加绘制
 */

/** 解码音频文件得到原始采样数据 + 总时长 */
export async function decodeAudioFile(
  file: File
): Promise<{ samples: Float32Array; duration: number }> {
  const arrayBuffer = await file.arrayBuffer();
  const ACtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new ACtor();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const channelData = audioBuffer.getChannelData(0);
  const duration = audioBuffer.duration;
  await ctx.close();
  return { samples: channelData, duration };
}

/** 把原始采样数据降采样到目标条形数，返回每一条形的振幅（已归一化到 [0,1]） */
export function downsample(samples: Float32Array, bars: number): number[] {
  if (bars <= 0 || samples.length === 0) return [];
  const step = Math.max(1, Math.floor(samples.length / bars));
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    let sum = 0;
    const start = i * step;
    const end = Math.min(start + step, samples.length);
    for (let j = start; j < end; j++) sum += Math.abs(samples[j]);
    out.push(sum / Math.max(1, end - start));
  }
  const max = Math.max(...out, 0.0001);
  return out.map((v) => v / max);
}

/** 波形图绘制参数 */
export interface WaveformDrawOptions {
  canvas: HTMLCanvasElement;
  bars: number[];
  duration: number;
  /** 视口起始条形索引（默认 0） */
  viewStartIdx: number;
  /** 视口结束条形索引（默认 bars.length） */
  viewEndIdx: number;
  currentTime: number | null;
  /** 所有需要画竖线的时间点：分句结束点和暂停点合并 */
  allBreakpoints?: number[];
  /** 暂停线时间点（单独颜色） */
  pausePoints?: number[];
  /** 分句结束线（默认橙色；暂停线默认红色；分句结束+暂停都在同一点上时显示暂停色） */
  bgColor?: string;
  waveColor?: string;
  playedColor?: string;
  playLineColor?: string;
  breakpointColor?: string;
  pauseColor?: string;
  /** 每段分句的时间范围（秒），用于画彩色背景块 */
  segmentRanges?: Array<{ startTime: number; endTime: number; idx: number }>;
}

/** 带视口窗口的波形图绘制 —— 参考图风格：分句彩色背景块 + 深色结束竖线 */
export function drawWaveform(opts: WaveformDrawOptions) {
  const {
    canvas, bars, duration, viewStartIdx, viewEndIdx,
    currentTime, allBreakpoints = [], pausePoints = [], segmentRanges = [],
    bgColor = '#f8fafc',
    waveColor = '#94a3b8',
    playedColor = '#4f46e5',
    playLineColor = '#ef4444',
    pauseColor = '#0ea5e9',
  } = opts;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  if (w <= 0 || h <= 0) return;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  // 画布主背景
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  if (bars.length === 0 || duration <= 0) return;

  const viewBars = bars.slice(viewStartIdx, viewEndIdx);
  if (viewBars.length === 0) return;
  const barWidth = w / viewBars.length;
  const centerY = h / 2;
  const maxBarHalf = h * 0.42;

  const xOfTime = (t: number) => ((t / duration) * bars.length - viewStartIdx) * barWidth;

  // ---- 1. 分句背景分块：交替两种浅色，让句子边界一眼可见 ----
  const SHADES = [
    'rgba(99, 102, 241, 0.06)',  // indigo 极浅
    'rgba(14, 165, 233, 0.06)',  // sky 极浅
  ];
  if (segmentRanges.length > 0) {
    for (const seg of segmentRanges) {
      const x1 = Math.max(0, xOfTime(seg.startTime));
      const x2 = Math.min(w, xOfTime(seg.endTime));
      if (x2 <= x1) continue;
      ctx.fillStyle = SHADES[seg.idx % SHADES.length];
      ctx.fillRect(x1, 0, x2 - x1, h);
    }
  }

  // ---- 2. 波形条形：播放过的用深紫色，未播放用浅灰 ----
  const absBarIdx = currentTime != null
    ? Math.floor((currentTime / duration) * bars.length)
    : -1;
  const playedIdx = absBarIdx - viewStartIdx;

  for (let i = 0; i < viewBars.length; i++) {
    const amp = viewBars[i];
    const half = Math.max(1, amp * maxBarHalf);
    const x = i * barWidth + barWidth / 2;
    ctx.fillStyle = i <= playedIdx ? playedColor : waveColor;
    ctx.fillRect(x - barWidth * 0.35, centerY - half, barWidth * 0.7, half * 2);
  }

  // ---- 3. 分句结束线：深色明显竖线（参考图里那种）----
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.85)'; // slate-700 深色
  ctx.lineWidth = 1.2;
  for (const bp of allBreakpoints) {
    // 如果这个 bp 同时也是暂停线，跳过（让暂停线颜色优先）
    if (pausePoints.some((p) => Math.abs(p - bp) < 0.02)) continue;
    const x = xOfTime(bp);
    if (x < -2 || x > w + 2) continue;
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  ctx.lineWidth = 1;

  // ---- 4. 暂停线：黄色虚线 + 顶/底三角 ----
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = pauseColor;
  ctx.lineWidth = 2;
  for (const p of pausePoints) {
    const x = xOfTime(p);
    if (x < -2 || x > w + 2) continue;
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    // 顶部向下的三角
    ctx.fillStyle = pauseColor;
    ctx.beginPath();
    ctx.moveTo(x - 6, 0); ctx.lineTo(x + 6, 0); ctx.lineTo(x, 10); ctx.closePath();
    ctx.fill();
    // 底部向上的三角
    ctx.beginPath();
    ctx.moveTo(x - 6, h); ctx.lineTo(x + 6, h); ctx.lineTo(x, h - 10); ctx.closePath();
    ctx.fill();
  }
  ctx.setLineDash([]);
  ctx.lineWidth = 1;

  // ---- 5. 播放位置红线（最醒目）----
  if (currentTime != null && currentTime >= 0) {
    const x = xOfTime(currentTime);
    if (x >= -2 && x <= w + 2) {
      ctx.strokeStyle = playLineColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.lineWidth = 1;
      // 底部向上的小三角标记
      ctx.fillStyle = playLineColor;
      ctx.beginPath();
      ctx.moveTo(x - 5, h); ctx.lineTo(x + 5, h); ctx.lineTo(x, h - 8); ctx.closePath();
      ctx.fill();
    }
  }
}

/** 把 Canvas 上相对位置反查成绝对时间（秒） */
export function pixelToTime(
  canvas: HTMLCanvasElement,
  duration: number,
  clientX: number,
  totalBars: number,
  viewStartIdx: number,
  viewEndIdx: number
): number {
  const rect = canvas.getBoundingClientRect();
  const localRatio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const viewRatio = viewStartIdx + localRatio * (viewEndIdx - viewStartIdx);
  const timeRatio = Math.max(0, Math.min(1, viewRatio / Math.max(1, totalBars)));
  return timeRatio * duration;
}

/** 根据时间返回它属于哪个 viewport 窗口的相对位置（用于自动滚动） */
export function computeAutoScroll(
  viewStartIdx: number,
  viewEndIdx: number,
  targetAbsIdx: number,
  marginRatio = 0.25
): { newStart: number; newEnd: number; shifted: boolean } {
  const viewLen = viewEndIdx - viewStartIdx;
  // 希望目标位置落在视口中间偏左一点（25% 位置）
  const marginLeft = Math.round(viewLen * marginRatio);
  const relative = targetAbsIdx - viewStartIdx;
  let newStart = viewStartIdx;
  if (relative > viewLen - marginLeft) {
    newStart = Math.max(0, targetAbsIdx - marginLeft);
  } else if (relative < marginLeft) {
    newStart = Math.max(0, targetAbsIdx - marginLeft);
  }
  const shifted = newStart !== viewStartIdx;
  return { newStart, newEnd: newStart + viewLen, shifted };
}
