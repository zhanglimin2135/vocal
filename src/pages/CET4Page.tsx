/**
 * CET4Page —— 固定词表「四级词汇」页（简化占位）
 *   只展示原网页内容，自测功能待后续开放
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ArrowLeft } from 'lucide-react';
import cet4HtmlRaw from '@/data/cet4-list.html?raw';

export default function CET4Page() {
  const navigate = useNavigate();
  const srcDocHtml = useMemo(() =>
    cet4HtmlRaw.replace(/<script[^>]+src=["'][^"']+["'][^>]*><\/script>\s*\n?/g, ''),
  []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-indigo-50/30 to-violet-50/40">
      {/* 顶部固定栏 */}
      <div className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-3">
          <button onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            <ArrowLeft className="h-4 w-4" />返回
          </button>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1 text-xs font-semibold text-white shadow-sm">
              <BookOpen className="h-3.5 w-3.5" />固定词表
            </span>
            <span className="text-sm font-semibold text-slate-700">四级词汇 List 09–15</span>
          </div>
          <div className="w-16" />
        </div>
      </div>

      {/* 原网页内容（iframe srcDoc 完整嵌入） */}
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <iframe
            title="四级词汇 List 09-15"
            srcDoc={srcDocHtml}
            className="block w-full"
            style={{ height: 1100, border: 0 }}
          />
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          ↑ 以上为原网页内容，支持左右键翻页、搜索单词、遮住释义
        </p>
      </div>

      {/* 底部占位 */}
      <div className="mx-auto max-w-6xl px-6 py-12 flex flex-col items-center gap-3">
        <p className="rounded-full bg-amber-50 px-4 py-1.5 text-sm text-amber-600">
          🚧 自测功能升级中，敬请期待
        </p>
        <button onClick={() => navigate(-1)}
          className="rounded-full bg-slate-900 px-6 py-2 text-sm text-white shadow-sm transition hover:bg-slate-700">
          返回上一页
        </button>
      </div>
    </div>
  );
}
