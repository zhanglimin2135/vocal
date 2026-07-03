/*
 * ============================================
 * 页面名称：UploadPage - 词表导入页（首页）
 * 页面用途：作为应用的入口页面，提供 Excel 词表文件的上传导入功能，
 *          同时展示用户已导入的所有词表列表，并支持进入学习模式选择页。
 * 整体结构：
 *   1. 顶部 header 区 - 应用介绍和标题
 *   2. 中间上传区 - 支持点击/拖拽上传 Excel 文件，显示上传状态（加载/成功/失败）
 *   3. 下方我的词表区 - 展示已导入词表列表（卡片式），每个卡片显示词表信息、
 *      删除按钮和进入选择按钮；无词表时显示空状态提示
 * ============================================
 */

// 从 React 导入需要的 Hook：状态管理、回调函数缓存、DOM 引用
import { useState, useCallback, useRef } from 'react';
// 从 react-router-dom 导入路由跳转 Hook
import { useNavigate } from 'react-router-dom';
// 从 lucide-react 导入 UI 图标组件
import {
  Upload,           // 上传图标
  FileSpreadsheet,  // 表格图标（词表卡片/空状态使用）
  CheckCircle2,     // 成功图标
  AlertCircle,      // 错误警告图标
  CloudUpload,      // 云端上传图标（上传区大图标）
  BookOpen,         // 书本打开图标（header 标签）
  ChevronRight,     // 向右箭头（进入选择按钮）
  Loader2,          // 加载转圈图标
  Trash2,           // 垃圾桶删除图标
} from 'lucide-react';
// 导入全局状态管理 Hook（Zustand）
import { useAppStore } from '@/store/appStore';
// 导入 Excel 文件解析工具函数
import { parseExcelFile } from '@/utils/xlsxUtils';
// 导入词表数据类型定义
import type { VocabularyBook } from '@/types';
// 导入 Tailwind 类名合并工具
import { cn } from '@/lib/utils';

// 上传状态的联合类型定义：空闲 / 加载中 / 成功 / 失败
type UploadStatus = 'idle' | 'loading' | 'success' | 'error';

// 默认导出的 React 函数组件：词表导入页
export default function UploadPage() {
  // useNavigate：路由跳转 Hook，用于跳转到词表选择学习模式页面
  const navigate = useNavigate();
  // useRef：引用隐藏的 input[type=file] 元素，用于触发文件选择对话框
  const inputRef = useRef<HTMLInputElement>(null);
  // useState：管理当前上传状态（空闲/加载中/成功/失败），控制 UI 显示
  const [status, setStatus] = useState<UploadStatus>('idle');
  // useState：存储上传失败时的错误提示消息
  const [errorMsg, setErrorMsg] = useState('');
  // useState：存储正在解析的文件名，用于加载状态展示
  const [progressName, setProgressName] = useState('');
  // useState：管理拖拽文件时的高亮状态（true=拖拽中，控制上传区样式）
  const [dragActive, setDragActive] = useState(false);

  // useAppStore：从全局状态读取【词表列表】数组，展示用户已导入的所有词表
  const vocabularyBooks = useAppStore((s) => s.vocabularyBooks);
  // useAppStore：从全局状态读取【添加词表】方法，解析完 Excel 后将词表存入全局状态
  const addVocabularyBook = useAppStore((s) => s.addVocabularyBook);
  // useAppStore：从全局状态读取【删除词表】方法，点击卡片删除按钮时移除对应词表
  const removeVocabularyBook = useAppStore((s) => s.removeVocabularyBook);
  // useAppStore：从全局状态读取【设置当前选中词表】方法，进入学习前先选定词表
  const setCurrentBook = useAppStore((s) => s.setCurrentBook);

  // ============================================
  // handleFile：处理上传文件的核心逻辑
  // 参数 file：用户选择或拖拽得到的 File 对象
  // 处理流程：
  //   1. 校验文件后缀，必须是 .xlsx 或 .xls，否则报错
  //   2. 设置状态为加载中，记录文件名
  //   3. 调用 parseExcelFile 异步解析 Excel
  //   4. 解析成功后，将词表加入全局状态，显示成功提示
  //   5. 成功 1.5 秒后自动重置状态回空闲
  //   6. 任何错误捕获后，设置错误状态和错误信息
  // ============================================
  const handleFile = useCallback(
    async (file: File) => {
      // 将文件名转小写便于判断后缀
      const name = file.name.toLowerCase();
      // 文件类型校验：仅允许 Excel 格式
      if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
        setStatus('error');
        setErrorMsg('请上传 .xlsx 或 .xls 格式的 Excel 文件');
        return;
      }
      try {
        // 进入加载状态，准备解析
        setStatus('loading');
        // 记录当前解析的文件名，用于展示
        setProgressName(file.name);
        // 清空上次可能残留的错误信息
        setErrorMsg('');
        // 调用工具函数解析 Excel，返回词表对象
        const book: VocabularyBook = await parseExcelFile(file);
        // 将解析后的词表添加到全局状态存储
        addVocabularyBook(book);
        // 设置上传成功状态
        setStatus('success');
        // 成功提示显示 1.5 秒后，自动重置为空闲状态并清空文件名
        setTimeout(() => {
          setStatus('idle');
          setProgressName('');
        }, 1500);
      } catch (e: any) {
        // 捕获解析异常，设置错误状态和错误消息
        setStatus('error');
        setErrorMsg(e?.message || '文件解析失败，请检查文件格式');
      }
    },
    // 依赖项：addVocabularyBook，用 useCallback 缓存函数避免重复渲染
    [addVocabularyBook]
  );

  // ============================================
  // onFileInputChange：隐藏 input 选择文件后的变更回调
  // 处理逻辑：
  //   1. 从 input 的 files 列表中取出第一个文件
  //   2. 如果取到文件，调用 handleFile 进行处理
  //   3. 将 input value 清空，确保下次选同一文件也会触发 change 事件
  // ============================================
  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  // ============================================
  // onDrop：拖拽文件到上传区并松开鼠标时的回调
  // 处理逻辑：
  //   1. 阻止浏览器默认行为（防止直接打开文件）
  //   2. 关闭拖拽高亮状态
  //   3. 从拖拽数据中取出第一个文件
  //   4. 如果取到文件，调用 handleFile 进行处理
  // ============================================
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // ============================================
  // goSelect：点击"进入选择"按钮，跳转到学习模式选择页
  // 参数 bookId：要进入的词表 ID
  // 处理逻辑：
  //   1. 将该词表设为全局当前选中词表
  //   2. 跳转到 /select 路由（Sheet 选择与学习模式页面）
  // ============================================
  const goSelect = (bookId: string) => {
    setCurrentBook(bookId);
    navigate('/select');
  };

  // ============================================
  // formatDate：时间戳格式化工具函数
  // 参数 ts：毫秒级时间戳（词表上传时间）
  // 返回格式："月/日 时:分"，例如 "7/3 14:05"
  // ============================================
  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // ============================================
  // Render：页面主体渲染部分
  // ============================================
  return (
    // 最外层容器：全屏渐变背景色
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      {/* 内容区域：居中最大宽度容器，左右内边距 */}
      <div className="mx-auto max-w-5xl px-6 py-12">

        {/* ======== Header 顶部标题介绍区 ======== */}
        <header className="mb-10 text-center">
          {/* 上方小圆角标签：应用 Logo + 名称 */}
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-1.5 text-sm text-indigo-700 shadow-sm backdrop-blur">
            <BookOpen className="h-4 w-4" />
            <span>Vocabulary · 你的专属背单词助手</span>
          </div>
          {/* 主标题：渐变色大字标题 */}
          <h1 className="whitespace-nowrap bg-gradient-to-r from-indigo-700 via-blue-700 to-sky-600 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl md:text-5xl lg:text-[52px]">
            导入词表，开启记忆之旅
          </h1>
          {/* 副标题：功能简介说明 */}
          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600">
            上传 Excel 词表，自由选择学习单元，支持看词说意与听音辨义两种模式，一键获取有道纯正发音。
          </p>
        </header>

        {/* ======== 上传区：支持点击/拖拽文件 ======== */}
        <div
          // 拖拽悬停：阻止默认 + 开启高亮样式
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          // 拖拽离开：关闭高亮样式
          onDragLeave={() => setDragActive(false)}
          // 拖拽松手：处理文件
          onDrop={onDrop}
          // 点击整个上传区：触发隐藏 input 的点击，弹出文件选择框
          onClick={() => inputRef.current?.click()}
          // 动态样式：拖拽中会变蓝、放大，普通状态有虚线边框，悬停有阴影
          className={cn(
            'group relative cursor-pointer overflow-hidden rounded-3xl border-2 border-dashed bg-white/70 p-12 text-center shadow-lg backdrop-blur transition-all duration-300',
            dragActive
              ? 'border-indigo-500 bg-indigo-50/80 shadow-indigo-200/60 scale-[1.01]'
              : 'border-indigo-300/60 hover:border-indigo-400 hover:shadow-xl hover:bg-white'
          )}
        >
          {/* 隐藏的原生文件选择 input，通过 ref 触发点击 */}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={onFileInputChange}
          />
          {/* 悬浮渐变遮罩层（鼠标 hover 时淡入） */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-blue-500/5 opacity-0 transition-opacity group-hover:opacity-100" />
          {/* 上传区主要内容容器 */}
          <div className="relative">
            {/* 中间大图标容器：根据 status 切换图标（加载转圈/成功对勾/错误感叹/默认云上传） */}
            <div
              className={cn(
                'mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 shadow-xl shadow-indigo-200 transition-transform duration-300',
                dragActive && 'scale-110 rotate-3'
              )}
            >
              {status === 'loading' ? (
                <Loader2 className="h-10 w-10 animate-spin text-white" />
              ) : status === 'success' ? (
                <CheckCircle2 className="h-10 w-10 text-white" />
              ) : status === 'error' ? (
                <AlertCircle className="h-10 w-10 text-white" />
              ) : (
                <CloudUpload className="h-10 w-10 text-white transition-transform group-hover:scale-110" />
              )}
            </div>
            {/* 上传区主文字标题：根据 status 切换提示语 */}
            <h2 className="text-2xl font-bold text-slate-800">
              {status === 'loading'
                ? `正在解析 ${progressName} ...`
                : status === 'success'
                ? '词表导入成功！'
                : status === 'error'
                ? '导入失败'
                : '点击上传或拖拽 Excel 文件到此处'}
            </h2>
            {/* 辅助说明文字：支持格式和列定义 */}
            <p className="mt-2 text-sm text-slate-500">
              支持 .xlsx / .xls 格式 · 默认第 1 列为单词，第 2 列为中文释义
            </p>
            {/* 上传失败时：红色错误提示条 */}
            {status === 'error' && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-red-50 px-4 py-1.5 text-sm font-medium text-red-600">
                <AlertCircle className="h-4 w-4" />
                {errorMsg}
              </p>
            )}
            {/* 上传成功时：绿色成功提示条 */}
            {status === 'success' && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                已保存，可在下方词表管理中查看
              </p>
            )}
            {/* 「选择本地文件」按钮：点击时阻止冒泡避免触发父容器 click（否则会连续弹两次选择框） */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-indigo-300 active:translate-y-0"
            >
              <Upload className="h-4 w-4" />
              选择本地文件
            </button>
          </div>
        </div>

        {/* ======== 我的词表：已导入词表列表展示区 ======== */}
        <section className="mt-12">
          {/* 列表标题栏：左侧显示标题 + 词表数量统计 */}
          <div className="mb-5 flex items-end justify-between">
            <div>
              <h3 className="text-xl font-bold text-slate-800">我的词表</h3>
              <p className="text-sm text-slate-500">
                共 {vocabularyBooks.length} 个词表，点击卡片进入选择 Sheet 与学习模式
              </p>
            </div>
          </div>

          {/* 空状态：词表数量为 0 时显示提示 */}
          {vocabularyBooks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10 text-center">
              <FileSpreadsheet className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="text-sm text-slate-400">暂无词表，请先上传 Excel 文件</p>
            </div>
          ) : (
            // 词表卡片：单列布局，宽度与上方导入框一致
            <div className="space-y-4">
              {vocabularyBooks.map((book) => {
                // 统计该词表所有 Sheet 合计的单词总数
                const totalWords = book.sheets.reduce((s, sh) => s + sh.wordCount, 0);
                return (
                  // 单张词表卡片容器：hover 时上移 + 阴影 + 边框变蓝
                  <div
                    key={book.id}
                    className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-xl"
                  >
                    {/* 卡片顶部彩色渐变装饰条 */}
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-blue-500 to-sky-500" />
                    <div className="flex items-start gap-4 p-5">
                      {/* 左侧表格图标 */}
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 shadow-md shadow-indigo-100">
                        <FileSpreadsheet className="h-6 w-6 text-white" />
                      </div>
                      {/* 中间词表信息区（文件名行 + 元信息行），flex-1 占满可用空间 */}
                      <div className="min-w-0 flex-1">
                        {/* 第一行：词表名称靠左 + 进入选择按钮靠右，使用 justify-between 两端对齐 */}
                        <div className="flex items-center justify-between gap-3">
                          {/* 文件名：超长截断显示省略号，shrink-1 允许压缩宽度为按钮让位 */}
                          <h4 className="truncate text-base font-semibold text-slate-800">
                            {book.fileName}
                          </h4>
                          {/* 「进入选择」主按钮：与词表名称同一行靠右显示，shrink-0 不压缩换行 */}
                          <button
                            onClick={() => goSelect(book.id)}
                            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 px-4 py-1.5 text-xs font-semibold text-white shadow transition-all hover:from-indigo-600 hover:to-blue-600"
                          >
                            进入选择
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {/* 第二行：Sheet 数量 / 单词总数 / 上传时间 + Sheet 预览 */}
                        <div className="mt-2 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500" />
                              {book.sheets.length} 个 Sheet
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
                              {totalWords} 个单词
                            </span>
                            <span>上传于 {formatDate(book.uploadedAt)}</span>
                          </div>
                          <div className="text-xs text-slate-500">
                            Sheet:{' '}
                            {book.sheets.slice(0, 3).map((s, i) => (
                              <span key={s.id}>
                                {s.name}
                                {i < Math.min(book.sheets.length, 3) - 1 ? '、' : ''}
                              </span>
                            ))}
                            {book.sheets.length > 3 ? ` 等${book.sheets.length}个` : ''}
                          </div>
                        </div>
                      </div>
                      {/* 右上角删除按钮：默认透明，hover 时显示；阻止冒泡避免触发卡片整体点击 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeVocabularyBook(book.id);
                        }}
                        className="shrink-0 rounded-lg p-2 text-slate-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                        title="删除词表"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
