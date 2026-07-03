/**
 * 应用入口 / 路由页面
 * 这是整个 React 应用的"总调度"：
 *   1. 页面一打开时调用 useAppStore().hydrate() 从 localStorage 填回之前保存的词表
 *   2. 用 React Router 把 URL 路径和三个页面绑定起来：
 *        /        → 第一页（上传词表）
 *        /select  → 第二页（选 Sheet + 选模式）
 *        /study   → 第三页（学习页）
 *   3. 其它没命中的路径统一跳回第一页
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
// 引入三个页面
import UploadPage from '@/pages/UploadPage';
import SelectPage from '@/pages/SelectPage';
import StudyPage from '@/pages/StudyPage';
// 引入全局 store（用来调用 hydrate）
import { useAppStore } from '@/store/appStore';

/**
 * 真正的应用主体（放在 Router 里面才能用路由相关的 Hook）
 * 它的主要职责是：一启动就读 localStorage，然后根据 URL 渲染对应页面
 */
function AppShell() {
  // 取出 store 里提供的 hydrate 函数
  const hydrate = useAppStore((s) => s.hydrate);

  // useEffect：组件第一次挂载完成后执行一次 → 恢复之前保存的词表
  // 相当于应用一打开就去浏览器抽屉里看看有没有之前的"存档"
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Routes：根据 URL 决定显示哪个页面
  return (
    <Routes>
      <Route path="/" element={<UploadPage />} />        {/* 首页：上传 */}
      <Route path="/select" element={<SelectPage />} />  {/* 第 2 页：选择 */}
      <Route path="/study" element={<StudyPage />} />    {/* 第 3 页：学习 */}
      <Route path="*" element={<UploadPage />} />        {/* 没匹配到时回首页 */}
    </Routes>
  );
}

/**
 * 整个应用最外层的根组件
 * 里面包了一层 Router（BrowserRouter 用 URL history 做路由切换，即地址栏路径变化）
 */
export default function App() {
  return (
    <Router>
      <AppShell />
    </Router>
  );
}
