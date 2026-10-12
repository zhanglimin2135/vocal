/*
 * ============================================
 * 页面名称：ReadingUploadPage - 托福阅读补全单词「上传 + 文章列表页
 * 页面用途：
 *   1. 让用户分别输入「文章内容」和「答案内容」两个文本，解析后加入文章目录中
 *   2. 左侧显示文章目录列表（已上传过的所有文章），方便快速查找并开始练习
 *   3. 点击任意文章卡片或「开始练习」按钮会跳转到阅读练习页面（/reading）
 *
 * 整体结构：
 *   - 顶部：顶部导航条（返回首页 + 页面大标题）
 *   - 左侧（上半/左栏）：文章目录卡片列表
 *   - 右侧（下半/右栏）：上传区（两个大的 textarea：文章 + 答案）
 * ============================================
 */

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookText,       // 书本图标
  Upload,        // 上传图标
  FileText,      // 文档图标（答案）
  BookOpen,      // 打开书本（标题用）
  CheckCircle2,   // 成功图标
  AlertCircle,   // 错误图标
  Trash2,        // 删除图标
  PlayCircle,      // 开始练习
  Home,          // 返回首页
  ChevronRight,  // 右箭头
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { parseReadingPassage } from '@/utils/passageParser';
import type { ReadingPassage } from '@/types';
import { cn } from '@/lib/utils';

// 上传状态：空闲 / 成功 / 失败
type UploadStatus = 'idle' | 'success' | 'error';

// 示例文章文本（用于填充"示例"按钮，让用户快速体验）
const SAMPLE_CONTENT = `Title: The Quick Brown Fox
The qui_k br_wn f_x j_mped _ver the l_zy d_g.
This is a s_mple passage for r_ading practice.
`;

const SAMPLE_ANSWER = `Title: The Quick Brown Fox
quick
brown
fox
jumped
over
lazy
dog
sample
reading
`;

export default function ReadingUploadPage() {
  const navigate = useNavigate();

  // ========== 读取全局状态 ==========
  const readingPassages = useAppStore((s) => s.readingPassages);
  const addReadingPassage = useAppStore((s) => s.addReadingPassage);
  const removeReadingPassage = useAppStore((s) => s.removeReadingPassage);
  const setCurrentPassage = useAppStore((s) => s.setCurrentPassage);

  // ========== 本地页面状态 ==========
  const [contentText, setContentText] = useState('');     // 文章输入框内容
  const [answerText, setAnswerText] = useState('');      // 答案输入框内容
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  // ========== 工具函数：时间戳格式化 ==========
  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // ========== 核心：提交解析文章 + 答案 ==========
  const handleAddPassage = () => {
    try {
      const passage: ReadingPassage = parseReadingPassage(contentText, answerText);
      addReadingPassage(passage);
      setStatus('success');
      setStatusMsg(
        `添加成功：共识别 ${passage.blankWords.length} 个待填词，${passage.totalBlanks} 个空字母`
      );
      // 清空输入框，便于继续添加
      setContentText('');
      setAnswerText('');
      // 3 秒后清空提示
      setTimeout(() => {
        setStatus('idle');
        setStatusMsg('');
      }, 3000);
    } catch (e: any) {
      setStatus('error');
      setStatusMsg(e?.message || '解析失败，请检查文章和答案格式');
    }
  };

  // ========== 填充示例 ==========
  const handleFillSample = () => {
    setContentText(SAMPLE_CONTENT);
    setAnswerText(SAMPLE_ANSWER);
    setStatus('idle');
    setStatusMsg('');
  };

  // ========== 清空两个输入框 ==========
  const handleClear = () => {
    setContentText('');
    setAnswerText('');
    setStatus('idle');
    setStatusMsg('');
  };

  // ========== 跳转练习：把当前文章设为选中，并跳转到 /reading ==========
  const goPractice = (passageId: string) => {
    setCurrentPassage(passageId);
    navigate('/reading');
  };

  // ================================
  // Render
  // ================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-100">
      {/* ========== 顶部导航 ========== */}
      <header className="sticky top-0 z-10 border-b border-white/60 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-white hover:text-indigo-700"
          >
            <Home className="h-4 w-4" />
            返回首页
          </button>
          <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm">
            <BookOpen className="h-4 w-4" />
            托福阅读补全单词
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          已添加 <span className="font-semibold text-emerald-700">{readingPassages.length}</span> 篇文章
        </div>
      </div>
      </header>

      {/* ========== 主内容区：左目录 + 右上传 ========== */}
      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-12">
        {/* ============ 左侧：文章目录列表 ============ */}
        <section className="lg:col-span-5 xl:col-span-4">
          <div className="rounded-3xl border border-white/60 bg-white/80 p-5 shadow-lg backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                <BookText className="h-5 w-5 text-emerald-600" />
                文章目录
              </h2>
              <span className="rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-semibold text-emerald-700">
                {readingPassages.length} 篇
              </span>
            </div>

            {readingPassages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center">
                <BookText className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                <p className="text-sm text-slate-400">
                  还没有文章，请在右侧填入「文章内容」和「答案内容」后点击添加
                </p>
                <button
                  onClick={handleFillSample}
                  className="mt-4 text-xs font-medium text-emerald-600 underline-offset-2 hover:underline"
                >
                  或者先点我填充一个示例试试？
                </button>
              </div>
            ) : (
              <ul className="space-y-3 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
                {readingPassages.map((p, idx) => (
                  <li
                    key={p.id}
                    className="group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"
                  >
                    <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-emerald-500 to-teal-500" />
                    <div className="flex items-start gap-3 p-4 pl-5">
                      {/* 序号圆形标签 */}
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-bold text-white shadow-sm">
                        {idx + 1}
                      </div>
                      {/* 文章信息 */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {p.title}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            {p.blankWords.length} 个词
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
                            {p.totalBlanks} 个空
                          </span>
                          <span>{formatDate(p.createdAt)}</span>
                        </div>
                      </div>
                      {/* 开始练习按钮 + 删除按钮 */}
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => goPractice(p.id)}
                          className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:from-emerald-600 hover:to-teal-600"
                          title="开始练习"
                        >
                          <PlayCircle className="h-3.5 w-3.5" />
                          练习
                          <ChevronRight className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`确定删除文章「${p.title}」吗？`)) {
                              removeReadingPassage(p.id);
                            }
                          }}
                          className="rounded-lg p-1.5 text-slate-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                          title="删除文章"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ============ 右侧：上传 / 输入区 ============ */}
        <section className="lg:col-span-7 xl:col-span-8">
          <div className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-lg backdrop-blur">
            {/* 区块标题 */}
            <div className="mb-5 flex items-end justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                  <Upload className="h-5 w-5 text-emerald-600" />
                  添加新文章
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  支持两种答案格式：<b>每行一个正确单词</b>，或<b>给出完整的无下划线文章段落</b>
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleFillSample}
                  className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50"
                >
                  填充示例
                </button>
                <button
                  onClick={handleClear}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  清空
                </button>
              </div>
            </div>

            {/* 两个 textarea：文章 + 答案 */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* 文章内容 */}
              <label className="flex flex-col">
                <span className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                  <BookText className="h-4 w-4 text-indigo-500" />
                  文章内容
                  <span className="text-[11px] font-normal text-slate-400">
                    （需要填的字母用 _ 代替，第一行可写 Title: 标题）
                  </span>
                </span>
                <textarea
                  ref={contentRef}
                  value={contentText}
                  onChange={(e) => setContentText(e.target.value)}
                  placeholder={`示例：\nTitle: 我的第一篇文章\nThe qui_k br_wn f_x jumps _ver the l_zy dog.\nIt is a bea_tiful day.`}
                  className="h-80 w-full resize-none rounded-2xl border border-slate-200 bg-white p-4 font-mono text-sm leading-relaxed text-slate-800 shadow-inner outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200"
                  spellCheck={false}
                />
              </label>

              {/* 答案内容 */}
              <label className="flex flex-col">
                <span className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                  <FileText className="h-4 w-4 text-teal-500" />
                  答案内容
                  <span className="text-[11px] font-normal text-slate-400">
                    （推荐：每行一个答案词；或写完整无下划线的文章）
                  </span>
                </span>
                <textarea
                  ref={answerRef}
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  placeholder={`推荐：每行一个答案词（按文中出现顺序）\nquick\nbrown\nfox\nover\nlazy\n\n或者：整段无下划线的完整文章\nThe quick brown fox jumps over the lazy dog.`}
                  className="h-80 w-full resize-none rounded-2xl border border-slate-200 bg-white p-4 font-mono text-sm leading-relaxed text-slate-800 shadow-inner outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200"
                  spellCheck={false}
                />
              </label>
            </div>

            {/* 状态提示条 */}
            <div className="mt-4 h-8">
              {status === 'success' && (
                <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  {statusMsg}
                </p>
              )}
              {status === 'error' && (
                <p className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-4 py-1.5 text-sm font-medium text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  {statusMsg}
                </p>
              )}
            </div>

            {/* 提交按钮 */}
            <div className="mt-2 flex items-center justify-end gap-3">
              <button
                onClick={handleAddPassage}
                disabled={!contentText.trim() || !answerText.trim()}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full px-8 py-3 text-sm font-semibold shadow-lg transition-all duration-200',
                  contentText.trim() && answerText.trim()
                    ? 'bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white shadow-emerald-200 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0'
                    : 'cursor-not-allowed bg-slate-200 text-slate-400 shadow-none'
                )}
              >
                <Upload className="h-4 w-4" />
                添加到文章目录
              </button>
            </div>
          </div>

          {/* ============ 使用说明提示卡 ============ */}
          <div className="mt-6 rounded-3xl border border-white/60 bg-white/60 p-5 shadow-sm backdrop-blur">
            <h3 className="mb-2 text-sm font-bold text-slate-700">使用小贴士</h3>
            <ul className="space-y-1.5 text-xs leading-relaxed text-slate-600">
              <li>• 文章中每个 <code className="rounded bg-slate-100 px-1 font-mono">_</code> 代表一个需要填的字母，例如 <code className="rounded bg-slate-100 px-1 font-mono">qui_k</code> 里面有 1 个空字母要填。</li>
              <li>• 答案格式优先使用「每行一个答案词」最准确；按文章中空词出现的顺序依次填入。</li>
              <li>• 也可以直接粘贴「完整的正确版本文章」作为答案，系统会按顺序抽取对应位置的单词作为答案。</li>
              <li>• 练习页面左右两侧中间有「上一篇 / 下一篇」按钮，方便你连续刷题；中间有提交按钮，提交后显示对错颜色。</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
