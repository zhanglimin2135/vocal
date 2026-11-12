/**
 * ListeningUpload —— 听力精听「导入页」
 *   只负责两件事：导入音频 + 导入/粘贴文本。
 *   点「开始拆分 →」按钮后，把数据通过父组件回传，进入编辑页。
 */

import { useCallback, useRef, useState } from 'react';
import { Upload, Music2, FileText, Play, AlertCircle } from 'lucide-react';
import type { SentenceSegment } from '@/types';
import { splitByLines, buildFromTexts } from '@/pages/ListeningPage'; // 复用分句工具（在 ListeningPage 里 export）
import { translateSentence } from '@/utils/translate';

interface Props {
  /** 音频文件选择完毕：解码后把 samples、duration、dataUrl 一起传给父组件 */
  onAudioReady: (info: { dataUrl: string; duration: number; fileName: string }) => void;
  /** 点击"开始拆分"：传入文本分句列表（已均分时间） */
  onStartSplit: (segments: SentenceSegment[]) => void;
  /** 音频已经在 store 里时的回填（已加载已有材料时跳到编辑页） */
  hasAudio: boolean;
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function ListeningUpload({ onAudioReady, onStartSplit, hasAudio }: Props) {
  const [audioName, setAudioName] = useState('');
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioDataUrl, setAudioDataUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [translating, setTranslating] = useState(false);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  const handleAudioFile = useCallback(async (file: File) => {
    setAudioName(file.name);
    try {
      const dataUrl = await fileToDataURL(file);
      // 解码拿时长（不用采样数据，波形在编辑页重采样）
      const ab = await file.arrayBuffer();
      const ACtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new ACtor();
      const buf = await ctx.decodeAudioData(ab.slice(0));
      const duration = buf.duration;
      await ctx.close();

      setAudioDuration(duration);
      setAudioDataUrl(dataUrl);
      onAudioReady({ dataUrl, duration, fileName: file.name });
    } catch (e) {
      console.error('解码音频失败', e);
      alert('音频解码失败，请使用 mp3 / wav / ogg 等常见格式');
    }
  }, [onAudioReady]);

  const startSplit = async () => {
    if (!audioDataUrl) { alert('请先导入音频文件'); return; }
    if (!rawText.trim()) { alert('请先输入或上传文本（一行一句）'); return; }
    const texts = splitByLines(rawText);
    if (texts.length === 0) { alert('文本为空，请输入内容'); return; }
    if (audioDuration <= 0) { alert('音频时长无效，请重新导入'); return; }

    const segments = buildFromTexts(texts, audioDuration);

    // 自动翻译：**等全部翻译完**再传给编辑页
    setTranslating(true);
    try {
      for (const seg of segments) {
        if (seg.translation) continue;
        try {
          seg.translation = (await translateSentence(seg.text)) || '';
        } catch { /* ignore */ }
      }
    } finally {
      setTranslating(false);
    }

    onStartSplit(segments);
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8 text-center">
        <h1 className="mb-2 text-2xl font-bold text-slate-800">听力精听</h1>
        <p className="text-sm text-slate-500">导入音频和对应文本（一行一句），系统自动拆分。拆分后可进入编辑页微调时间。</p>
      </div>

      {/* 上：音频（窄居中） */}
      <div className="mx-auto max-w-xl mb-8">
        <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Music2 className="h-4 w-4 text-indigo-500" />音频文件
        </label>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleAudioFile(f); }}
          onClick={() => audioInputRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition ${
            audioName ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-white hover:border-indigo-300'
          }`}
        >
          {audioName ? (
            <div className="space-y-1">
              <p className="font-medium text-indigo-700">{audioName}</p>
              <p className="text-xs text-slate-500">时长 {audioDuration.toFixed(2)} 秒</p>
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-600">✓ 音频就绪</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-slate-500">
              <Upload className="h-7 w-7 text-slate-300" />
              <p className="text-sm font-medium">拖拽音频到此处，或点击选择</p>
              <p className="text-xs text-slate-400">mp3 / wav / ogg</p>
            </div>
          )}
          <input ref={audioInputRef} type="file" accept="audio/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleAudioFile(f); }} />
        </div>
      </div>

      {/* 下：文本（满宽，一行一句，方便手动换行拆句） */}
      <div className="mb-8">
        <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <FileText className="h-4 w-4 text-emerald-500" />文本内容（**一行一句**，按回车手动换行）
          <span className="text-xs text-slate-400 font-normal">· 空行自动忽略</span>
        </label>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={10}
          placeholder={"第一句英文…（回车换行）\n第二句英文…\n第三句英文…"}
          className="w-full resize-y rounded-2xl border-2 border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 font-mono"
        />
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <input ref={textInputRef} type="file" accept=".txt" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(setRawText); }} />
          <button onClick={() => textInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 transition hover:border-emerald-300 hover:text-emerald-600">
            <Upload className="h-3 w-3" />上传 .txt
          </button>
          {rawText && <span className="text-xs text-slate-500">{splitByLines(rawText).length} 行（= {splitByLines(rawText).length} 个分句）</span>}
          {audioDuration > 0 && splitByLines(rawText).length > 0 && (
            <span className="text-xs text-slate-400">预计每句均分 {((audioDuration) / splitByLines(rawText).length).toFixed(2)} 秒</span>
          )}
        </div>
      </div>

      {/* 开始拆分按钮 */}
      <div className="mt-10 flex flex-col items-center gap-4">
        <button
          onClick={startSplit}
          disabled={!audioName || !rawText.trim() || translating}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-3 text-base font-semibold text-white shadow-lg transition hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play className="h-4 w-4" />
          {translating ? '正在翻译中…' : '开始拆分 →'}
        </button>
        {hasAudio && (
          <p className="inline-flex items-center gap-1 text-xs text-amber-600">
            <AlertCircle className="h-3 w-3" />
            注意：已加载旧材料的文本和分句，音频需重新上传（浏览器不持久化大文件）
          </p>
        )}
      </div>
    </div>
  );
}
