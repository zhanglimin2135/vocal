/**
 * 应用入口 / 路由页面
 * 这是整个 React 应用的"总调度"：
 *   1. 页面一打开时调用 useAppStore().hydrate() 从 localStorage 填回之前保存过的词表
 *   2. 用 React Router 把 URL 路径和页面绑定起来：
 *        /                → 第一页（背单词-上传词表）
 *        /select          → 背单词-选 Sheet + 选模式
 *        /study           → 背单词-学习页
 *        /listening       → 听力精听（音频 + 文本 + 分句波形）
 *   3. 旧 /reading-upload、/reading 重定向到 /listening（功能已替换为听力精听）
 *   4. 其它没命中的路径统一跳回首页
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
// 背单词模块三个页面
import UploadPage from '@/pages/UploadPage';
import SelectPage from '@/pages/SelectPage';
import StudyPage from '@/pages/StudyPage';
// 听力精听模块（替换原"托福阅读补全"）
import ListeningPage from '@/pages/ListeningPage';
// 固定词表模块：四级词汇 List 09–15
import CET4Page from '@/pages/CET4Page';
// 全局 store
import { useAppStore } from '@/store/appStore';

function AppShell() {
  const hydrate = useAppStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <Routes>
      <Route path="/" element={<UploadPage />} />
      <Route path="/select" element={<SelectPage />} />
      <Route path="/study" element={<StudyPage />} />
      <Route path="/listening" element={<ListeningPage />} />
      <Route path="/cet4" element={<CET4Page />} />
      {/* 旧路由重定向到新的听力精听页面，保证收藏链接不失效 */}
      <Route path="/reading-upload" element={<Navigate to="/listening" replace />} />
      <Route path="/reading" element={<Navigate to="/listening" replace />} />
      <Route path="*" element={<UploadPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <AppShell />
    </Router>
  );
}
