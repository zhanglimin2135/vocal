/**
 * AudioSplitterPage —— 添加音频
 *   全屏内嵌「音频拆分 · 逐句听练」工具：
 *   工具本身的功能与交互完全保持原样，这里只把外层容器做成与本站一致的风格
 *   （渐变背景、白色吸顶栏、圆角卡片 + 加载态）。
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Volume2 } from 'lucide-react';
import { AUDIO_SPLITTER_URL } from './ListeningPage';

export default function AudioSplitterPage() {
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const prev = document.title;
    document.title = '添加音频 · 逐句听练';
    return () => {
      document.title = prev;
    };
  }, []);

  /* 拆分工具发来的消息：上传到目录 / 音轨浮起时整页全屏 */
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; html?: string; name?: string; on?: boolean };
      if (!data) return;

      if (data.type === 'vocal-split-fs') {
        if (data.on) {
          const el = shellRef.current;
          if (el && !document.fullscreenElement && el.requestFullscreen) {
            const p = el.requestFullscreen({ navigationUI: 'hide' });
            if (p && p.catch) p.catch(() => {});
          }
        } else if (document.fullscreenElement) {
          const p = document.exitFullscreen();
          if (p && p.catch) p.catch(() => {});
        }
        return;
      }

      if (data.type === 'vocal-split-html' && typeof data.html === 'string') {
        navigate('/listening', {
          state: { splitHtml: data.html, splitName: data.name || '' },
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate]);

  /* 用户按 Esc 退出全屏时，通知工具取消「滚动时吸附顶部」 */
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'vocal-split-fs-exit' },
          window.location.origin,
        );
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  return (
    <div
      ref={shellRef}
      className="flex h-screen flex-col overflow-hidden bg-gradient-to-br from-sky-50 via-white to-indigo-50"
    >
      {/* 顶部栏：风格与听力精听目录页一致 */}
      <div className="z-20 flex-none border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-3">
          <button
            onClick={() => navigate('/listening')}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            返回精听目录
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-sm">
            <Volume2 className="h-3.5 w-3.5" />
            添加音频
          </span>
          <span className="hidden truncate text-xs text-slate-400 lg:block">
            导入音频与文本 → 自动分句 → 波形微调切点 → 句子播放 → 导出
          </span>
          <button
            onClick={() => window.open(AUDIO_SPLITTER_URL, '_blank', 'noopener,noreferrer')}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            在新标签打开
          </button>
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col px-4 pb-0 pt-5">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_10px_40px_-14px_rgba(79,70,229,.18)]">
          {!loaded && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white">
              <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-500 border-t-transparent" />
              <p className="text-sm text-slate-500">正在加载拆分工具…</p>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={AUDIO_SPLITTER_URL}
            title="添加音频 · 逐句听练"
            onLoad={() => setLoaded(true)}
            className="block min-h-0 w-full flex-1 border-0"
            allow="autoplay; clipboard-read; clipboard-write; fullscreen; microphone"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    </div>
  );
}
