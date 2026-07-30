# 背单词应用 (Vocal)

一个基于 React + TypeScript + Tailwind CSS 的单词学习应用。

## 功能特点

- 单词选择和筛选
- 拼写学习模式（释义拼写/听音拼写）
- 实时统计和结果展示
- 一键截图功能
- 阅读练习模块

## 技术栈

- React 18
- TypeScript
- Vite
- Tailwind CSS
- Zustand 状态管理

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

或者

```bash
npm install
```

### 2. 启动开发服务器

```bash
pnpm run dev
```

或者

```bash
npm run dev
```

### 3. 构建生产版本

```bash
pnpm run build
```

## 项目结构

```
src/
├── pages/          # 页面组件
├── components/     # 公共组件
├── store/          # 全局状态管理
├── types/          # 类型定义
├── utils/          # 工具函数
├── hooks/          # 自定义 Hooks
└── lib/            # 库函数
```

## 上传到 GitHub

### 方法一：使用上传脚本（推荐）

```bash
# 1. 进入项目目录
cd /path/to/vocal

# 2. 运行上传脚本
./upload-to-github.sh

# 3. 按照提示输入您的 GitHub 仓库地址
#    格式: https://github.com/用户名/仓库名.git
```

### 方法二：手动上传

1. 在 GitHub 创建新仓库
2. 只上传源代码文件（不要上传 node_modules、dist 等）
3. 使用 Git 命令：

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/用户名/仓库名.git
git push -u origin main
```

## 注意事项

- 请勿上传 `node_modules` 文件夹（175MB）
- 请勿上传 `dist` 构建产物
- 其他开发者克隆后需要运行 `pnpm install` 安装依赖
