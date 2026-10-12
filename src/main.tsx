/**
 * 整个项目的启动入口（Vite 在 index.html 里引用的就是这个文件）
 * 工作流程：
 *   1. 找到 index.html 里 <div id="root"></div> 这个挂载点
 *   2. 把我们写的 React 应用 <App /> 渲染进去
 *   3. 同时加载全局样式 index.css（里面包括 Tailwind 指令、字体引入、全局 body 样式等）
 */

import { StrictMode } from 'react';          // React 严格模式：开发时帮助发现不安全的代码
import { createRoot } from 'react-dom/client'; // React 18 的渲染入口函数
import App from './App';                      // 我们自己写的应用总组件（路由+页面）
import './index.css';                          // 全局样式入口（Tailwind + 自定义字体/样式）

// createRoot：把 React 组件挂载到页面的指定 DOM 节点上
// document.getElementById('root') 就是 index.html 里写的 <div id="root"></div>
createRoot(document.getElementById('root')!).render(
  // StrictMode 是一个只在开发模式下有用的外层包装：
  // 它会主动把一些副作用执行两次，帮你找出容易出 bug 的写法
  // 不影响生产环境（发布出去以后就不启用了）
  <StrictMode>
    <App />
  </StrictMode>
);
