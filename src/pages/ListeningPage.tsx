/**
 * ListeningPage —— 听力精听主页面（路由容器 + 数据管理）
 *   第一阶段：显示导入页（ListeningUpload）
 *   点击"开始拆分 →"后：进入编辑页（ListeningEditor）
 *
 *   同时导出 splitByLines / buildFromTexts / splitSegment / removeSegmentAt / segBreakpoints
 *   这些工具函数被 ListeningUpload / ListeningEditor 直接引用。
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Volume2, Save, Trash2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { ListeningLesson, SentenceSegment } from '@/types';
import ListeningUpload from './ListeningUpload';
import ListeningEditor from './ListeningEditor';

// ============================================
// 工具函数（export 给 ListeningUpload / ListeningEditor 复用）
// ============================================

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
// 主组件
// ============================================

type ViewState =
  | { phase: 'upload' }
  | {
      phase: 'editor';
      fileName: string;
      audioDataUrl: string;
      duration: number;
      segments: SentenceSegment[];
      textContent: string;
      lessonId: string | null; // 如果编辑的是已有材料
      title: string;
    };

export default function ListeningPage() {
  // 占位页：听力精听功能暂时关闭，入口按钮保留，后期再启用
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
          <button onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            ← 返回首页
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1 text-xs font-semibold text-white shadow-sm">
            🎧 听力精听
          </span>
          <div className="w-16" />
        </div>
      </div>

      <div className="mx-auto flex max-w-3xl flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-100 to-teal-100 text-4xl">
          🎧
        </div>
        <h1 className="mb-3 text-2xl font-bold text-slate-800">听力精听</h1>
        <p className="mb-2 text-slate-500">导入音频 + 文本，按句拆分波形，精准对齐暂停点</p>
        <p className="mb-8 rounded-full bg-amber-50 px-4 py-1.5 text-sm text-amber-600">
          🚧 功能升级中，近期开放，敬请期待
        </p>
        <button onClick={() => navigate('/')}
          className="rounded-full bg-slate-900 px-6 py-2 text-sm text-white shadow-sm transition hover:bg-slate-700">
          先去首页看看其他功能
        </button>
      </div>
    </div>
  );
}
