/**
 * 应用入口 / 路由页面
 * 这是整个 React 应用的"总调度"：
 *   1. 页面一打开时调用 useAppStore().hydrate() 从 localStorage 填回之前保存的词表
 *   2. 用 React Router 把 URL 路径和页面绑定起来：
 *        /                → 第一页（背单词-上传词表）
 *        /select          → 背单词-选 Sheet + 选模式
 *        /study           → 背单词-学习页
 *        /reading-upload  → 托福阅读补全单词-上传 + 文章目录
 *        /reading         → 托福阅读补全单词-练习页
 *   3. 其它没命中的路径统一跳回首页
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
// 背单词模块三个页面
import UploadPage from '@/pages/UploadPage';
import SelectPage from '@/pages/SelectPage';
import StudyPage from '@/pages/StudyPage';
// 托福阅读补全单词模块两个页面
import ReadingUploadPage from '@/pages/ReadingUploadPage';
import ReadingPracticePage from '@/pages/ReadingPracticePage';
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
      <Route path="/reading-upload" element={<ReadingUploadPage />} />
      <Route path="/reading" element={<ReadingPracticePage />} />
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
