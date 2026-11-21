/**
 * 应用入口 / 路由页面
 * 这是整个 React 应用的"总调度"：
 *   1. 页面一打开时调用 useAppStore().hydrate() 从 localStorage 填回之前保存过的词表
 *   2. 用 React Router 把 URL 路径和页面绑定起来
 *   3. 首页（背单词）同步加载，优先保证首屏；其它页面全部按路由拆包懒加载
 *   4. 首屏渲染完成后，在浏览器空闲时按批次预取听力精听 / 生词整理 / 背景知识
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
// 背单词首页：保持同步加载，优先显示单词页内容
import UploadPage from '@/pages/UploadPage';
// 其余页面：路由级懒加载，点击对应入口时再下载各自的代码
const SelectPage = lazy(() => import('@/pages/SelectPage'));
const StudyPage = lazy(() => import('@/pages/StudyPage'));
const ListeningPage = lazy(() => import('@/pages/ListeningPage'));
const CET4Page = lazy(() => import('@/pages/CET4Page'));
const CollectionPage = lazy(() => import('@/pages/CollectionPage'));
// 全局 store
import { useAppStore } from '@/store/appStore';

/** 懒加载页面的过渡占位：一个轻量的居中转圈 */
function PageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-500 border-t-transparent" />
    </div>
  );
}

function AppShell() {
  const hydrate = useAppStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // 首屏渲染完成后，空闲时按批次预取其它页面与背景知识手册
  useEffect(() => {
    let cancelled = false;

    const prefetch = () => {
      if (cancelled) return;
      // 第 1 批：听力精听；第 2 批：生词整理 + 四级词表；第 3 批：选词/学习页
      import('@/pages/ListeningPage')
        .then(() => Promise.all([import('@/pages/CollectionPage'), import('@/pages/CET4Page')]))
        .then(() => Promise.all([import('@/pages/SelectPage'), import('@/pages/StudyPage')]))
        .catch(() => { /* 预取失败不影响正常点击时的按需加载 */ });

      // 背景知识是独立静态页面：低优先级预取，用户点开时秒开
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = '/background-handbook.html';
      document.head.appendChild(link);
    };

    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;

    if (ric) {
      const id = ric(prefetch, { timeout: 3000 });
      return () => {
        cancelled = true;
        (window as any).cancelIdleCallback?.(id);
      };
    }
    const timer = window.setTimeout(prefetch, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/select" element={<SelectPage />} />
        <Route path="/study" element={<StudyPage />} />
        <Route path="/listening" element={<ListeningPage />} />
        <Route path="/cet4" element={<CET4Page />} />
        <Route path="/collection" element={<CollectionPage />} />
        {/* 旧路由重定向到新的听力精听页面，保证收藏链接不失效 */}
        <Route path="/reading-upload" element={<Navigate to="/listening" replace />} />
        <Route path="/reading" element={<Navigate to="/listening" replace />} />
        <Route path="*" element={<UploadPage />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <Router>
      <AppShell />
    </Router>
  );
}
