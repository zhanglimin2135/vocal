# Vocabulary · 背单词助手

> 一个纯前端、**无需服务器**的背单词 Web 应用。你只需上传一份自己的 Excel 词表，就能立刻使用两种学习模式：**看词说意** 与 **听音辨义**，配合有道词典在线发音，轻松记忆任何词表。

---

## 🌟 功能一览

| 页面 | 路径 | 主要用途 |
|------|------|---------|
| 第 1 页 · 词表导入 | `/` | 点击或拖拽上传 `.xlsx / .xls` 文件，查看并管理已上传的所有词表 |
| 第 2 页 · 选择配置 | `/select` | 勾选需要学习的 Sheet（可多选），选择学习模式后开始学习 |
| 第 3 页 · 学习页 | `/study` | 按模式展示单词卡片；支持单个释义显隐、一键全部显隐、一键乱序、有道发音 |

### 学习模式说明

- **看词说意（word-meaning）**：页面显示所有英文单词，中文释义默认**隐藏**。
  - 点击单词卡片任意处 → 显示/隐藏该单词的释义
  - 每个单词右侧的 📢 小喇叭 → 播放有道美式发音
  - 右上角工具栏 → 一键显示/隐藏所有释义、整体乱序

- **听音辨义（audio-meaning）**：默认只显示居中的大📢发音按钮，单词+释义都隐藏。
  - 点击大喇叭 → 播放发音（连点可重复播放）
  - 点击卡片任意处 → 同时显示/隐藏「单词 + 释义」
  - 右上角工具栏 → 一键显隐、整体乱序

---

## 🧭 快速开始（5 分钟上手）

### 前置条件：安装 Node.js 20+

这个项目用 Node.js 来跑开发服务器和构建，确保电脑上已经装了 **Node 20 或更新**（macOS 直接去 https://nodejs.org/ 下载 LTS 版本安装即可）。

打开终端（macOS：启动台 → 搜索「终端」），查看是否安装成功：

```bash
node -v   # 应输出 v20.x.x 以上
npm  -v   # 应输出 9.x.x 以上
```

### 第 1 步：安装依赖（只需一次）

在项目文件夹（就是有 `package.json` 的这个目录）里运行：

```bash
npm install -g pnpm        # （如已装过 pnpm 可跳过）
pnpm install
```

等待几分钟，看到 `Done in` 字样即成功。

### 第 2 步：启动开发模式（平时预览用这个）

```bash
pnpm run dev
```

终端会提示：

```
  ➜  Local:   http://localhost:5173/
```

用浏览器打开这个地址即可使用。**这个模式下，你改任何代码保存后，页面会自动刷新。**

### 第 3 步：构建发布版（交给别人用 / 部署）

```bash
pnpm run build
```

构建完成后，会生成一个 `dist/` 文件夹，里面是纯静态的 HTML/CSS/JS 文件，可以：

- 直接双击 `dist/index.html` 在本地打开使用；
- 或把整个 `dist/` 文件夹的内容扔到任意静态文件服务器上（如 nginx、GitHub Pages、对象存储、内网服务器等）。

查看构建效果：

```bash
pnpm run preview       # 本地预览构建后的生产版本
```

---

## 📁 项目结构（非技术人员版）

```
vocal/
├── index.html                  网页最外层的外壳（title、图标、加载入口）
├── package.json                项目配置 + 启动命令列表
├── tailwind.config.js          颜色/字体/动画等样式主题配置
├── vite.config.ts              Vite（打包工具）配置
├── scripts/
│   ├── generate-sample-xlsx.mjs   生成示例 30 词测试 Excel（执行 node scripts/... 即可）
│   └── test-xlsx-parse.mjs        本地快速测试 Excel 解析是否正确
├── public/                     这个文件夹里的内容会原样被"搬到"网站上
│   ├── favicon.svg               浏览器标签栏小图标
│   └── 示例词表-30词.xlsx         可以直接下载做测试的示例文件
└── src/                        所有源代码都在这
    ├── main.tsx                  应用启动入口（相当于电源按钮）
    ├── App.tsx                   路由总调度（哪个 URL 打开哪个页面）
    ├── index.css                 全局样式（字体、Tailwind 引入等）
    ├── types/
    │   └── index.ts                数据类型说明（单词/Sheet/词表是什么样子）
    ├── utils/
    │   ├── audioUtils.ts           有道发音工具：生成 URL + 播放音频 + 缓存
    │   ├── storageUtils.ts         本地存储工具：把词表保存到浏览器 localStorage
    │   └── xlsxUtils.ts            Excel 解析：识别表头、自动跳过表头行、单词列表生成
    ├── store/
    │   └── appStore.ts             Zustand 全局状态（共享数据）：所有页面共享的记忆盒
    ├── lib/
    │   └── utils.ts                小工具：合并样式类名(cn)、生成唯一ID(generateId)
    ├── hooks/
    │   └── useTheme.ts             主题切换 hook（当前默认浅色主题，保留扩展点）
    ├── components/
    │   └── Empty.tsx               空状态占位组件（可直接复用）
    └── pages/
        ├── UploadPage.tsx          第 1 页 · 上传 + 管理词表
        ├── SelectPage.tsx          第 2 页 · 选 Sheet + 选学习模式
        └── StudyPage.tsx           第 3 页 · 学习卡片（两种模式切换）
```

---

## 🧠 代码中使用的关键"黑话"说明

| 名词 | 人话解释 |
|------|---------|
| `React` | 构建页面 UI 的库，让我们可以把每个页面拆成组件拼起来 |
| `TypeScript (TS)` | 在 JS 基础上加了"类型标注"（比如单词只能是字符串，不能是数字），写错了立刻提示 |
| `Vite` | 开发服务器 + 打包工具，负责：`dev` 启动预览、`build` 压缩成生产文件 |
| `Tailwind CSS` | 一套写好的样式工具类。像 `text-blue-500` = 蓝颜色字，不用再手写 CSS 文件 |
| `Zustand` | 一个"全局记忆盒"：A 页面上传的词表，B/C 页面能立刻读取，不需要来回传参 |
| `xlsx (SheetJS)` | 第三方库，专门用来读取 `.xlsx/.xls` Excel 文件内容 |
| `localStorage` | 浏览器自带的小抽屉：最多存几 MB 数据，**只存在你当前浏览器里**，换电脑就没有 |
| `有道 dictvoice API` | 网易有道开放的单词发音 URL，形如 `https://dict.youdao.com/dictvoice?audio=apple&type=1`，返回 mp3 音频 |

---

## 📘 Excel 词表格式要求（重要！）

我们的解析器非常聪明，但请尽量遵循以下约定：

### 最简格式（最常用）

每个 Sheet 的第一行可以是**表头**，也可以**直接就是单词**。推荐加表头，更清晰。

**例 1：英文表头（推荐）**

| word | meaning |
|------|---------|
| abandon | 放弃；抛弃 |
| ability | 能力；才能 |
| absorb | 吸收；吸引 |

**例 2：中文表头**

| 单词 | 释义 |
|------|------|
| apple | 苹果 |
| banana | 香蕉 |

**例 3：混合表头（也支持）**

| English | 中文 |
|---------|------|
| adjust | 调整；适应 |
| admire | 钦佩；赞美 |

### 自动识别规则

- **表头关键字**（不区分大小写、只要单元格里包含就会命中）：
  - 单词列：`word / 单词 / 英文 / 英语 / 词汇 / term / english / en / vocabulary`
  - 释义列：`meaning / 释义 / 中文 / 翻译 / 解释 / 汉语 / definition / chinese / translation`
- 如果第一行两个单元格都命中了上面的关键字 → **自动跳过第一行**，从第二行开始读数据
- 如果没命中 → 从第一行开始读（也能用，就是第一行如果是表头会被当成一个"单词"，这就是为什么推荐写正规表头）
- 没单词的空行会被自动忽略
- 释义为空时，页面显示 `（暂无释义）`

### 生成示例文件快速体验

在项目根目录执行：

```bash
node scripts/generate-sample-xlsx.mjs public/
```

会在 `public/示例词表-30词.xlsx` 生成一份含 3 个 Sheet、共 30 个单词的示例文件。开发模式打开 `http://localhost:5173/示例词表-30词.xlsx` 即可直接下载。

---

## 🔊 发音功能是怎么实现的？

源码在 [audioUtils.ts](src/utils/audioUtils.ts)。

1. 用户点击喇叭按钮时，调用 `playWordAudio(word)` 函数；
2. 函数内部把单词用 `encodeURIComponent` 编码（处理空格、特殊字符）；
3. 拼出一个有道 URL：`https://dict.youdao.com/dictvoice?audio={单词}&type=1`
   - `type=1` → 美式发音（默认）
   - `type=2` → 英式发音（想切换就改 audioUtils 里的代码）
4. 用浏览器原生的 `new Audio(url)` 对象播放；
5. 播过一次的单词音频会**缓存在内存里**（一个 Map），下次再点同一个单词就不用重新下载了，秒播。

**注意**：发音依赖有道服务器 + 公网访问。如果电脑完全离线，按钮不会报错但也发不出声音。

---

## 💾 数据保存在哪里？会丢吗？

所有上传的词表存在**你当前浏览器的 localStorage** 里（键名：`vocabulary_books_storage`）。

- ✅ 刷新页面、关闭浏览器重开 → 词表都在
- ❌ 换台电脑、换个浏览器（Chrome ↔ Safari）、清空浏览器缓存 → 词表会丢
- 🔒 纯前端应用，**数据不会上传任何服务器**，全部留在本地，隐私安全

想迁移数据？打开浏览器「开发者工具 → Application → Local Storage」，把对应键值复制走即可。

---

## 🎨 如何做常见的小改造（改样式 / 改文案 / 改配色）

### 1. 想换标题、按钮、提示文案

直接找对应页面 `.tsx` 文件里的中文文字，改完保存页面立刻刷新：
- 首页上传区 → [UploadPage.tsx](src/pages/UploadPage.tsx)
- 选择页 / 模式名 / 开始按钮 → [SelectPage.tsx](src/pages/SelectPage.tsx)
- 学习页工具栏按钮 → [StudyPage.tsx](src/pages/StudyPage.tsx)

### 2. 想换配色（主色调）

打开 [tailwind.config.js](tailwind.config.js) 找到：

```js
brand: {
  500: '#6366f1',  // 主色：靛蓝
  ...
},
accent: {
  500: '#f59e0b',  // 点缀色：琥珀橙
  ...
}
```

把十六进制色值改成你喜欢的即可（Tailwind 内置 `indigo / blue / emerald / rose ...` 等色盘也可以直接用）。

### 3. 想切换英式发音

改 [audioUtils.ts](src/utils/audioUtils.ts)：
- 所有 `getAudioUrl(word, 1)` 改成 `getAudioUrl(word, 2)` 即可（1=美音，2=英音）。

### 4. 想增加第三/第四种学习模式

- 到 [types/index.ts](src/types/index.ts) 的 `StudyMode` 类型里加枚举值；
- 到 [SelectPage.tsx](src/pages/SelectPage.tsx) 底部模式选择区加一个按钮分支；
- 到 [StudyPage.tsx](src/pages/StudyPage.tsx) 的 render 里再加一套卡片渲染模式。

---

## 🧪 常用命令速查

| 命令 | 用途 | 什么时候用 |
|------|------|-----------|
| `pnpm install` | 安装依赖 | 第一次拉代码、换机器、改 package.json 之后 |
| `pnpm run dev` | 启动开发服务器 + 热更新 | 日常开发 / 预览功能 |
| `pnpm run check` | 只做 TypeScript 类型检查，不构建 | 改完代码想快速检查有没有写错类型 |
| `pnpm run lint` | 跑 ESLint 代码风格检查 | 发布前清理小问题 |
| `pnpm run build` | 构建生产版 → `dist/` 目录 | 交付给别人 / 部署服务器 |
| `pnpm run preview` | 本地预览 build 的结果 | 上线前最后看一眼效果 |

---

## ❓ 常见问题 FAQ

**Q1：上传 Excel 后提示"解析失败"怎么办？**

- 先确认文件是 `.xlsx` 或 `.xls` 格式（不要传 csv、txt、数字书、加密的 Excel）
- 可以先把文件内容复制到一个**全新**的空白 Excel 里，另存为 `.xlsx` 重传（原文件可能带宏/密码/老版格式）
- 用 `scripts/test-xlsx-parse.mjs` 改路径到你的文件，本地跑一下看日志报错

**Q2：上传成功但读出来的单词少了第一行？**

说明你的表头没被识别到（比如写的是「生词 / 汉语」这两个关键字没覆盖到），有两种改法：
- 把表头改成我们支持的关键字（推荐，简单）；
- 或者去 [xlsxUtils.ts](src/utils/xlsxUtils.ts) 的 `WORD_KEYWORDS / MEANING_KEYWORDS` 数组里追加你自己用的表头词。

**Q3：喇叭点了没有声音？**

- 检查电脑音量 / 浏览器是否静音；
- 有些浏览器要求用户**先跟页面交互一次**才允许播音频，第一次点一下任意位置后再点喇叭；
- 确认能访问外网（有道服务器在公网）。可以直接打开 `https://dict.youdao.com/dictvoice?audio=apple&type=1` 看看能不能播。

**Q4：关闭浏览器再打开，词表没了？**

- 90% 是清了浏览器缓存 / 隐身模式打开 / 换了另一个浏览器；
- 注意：Safari 的「隐私模式」localStorage 会在关闭时清空。

**Q5：构建出来的 dist/index.html 双击打开有报错/白屏？**

- 大部分情况是因为浏览器对 `file://` 协议限制了一些功能。用 `pnpm run preview` 或者丢到任意静态服务器（比如 Nginx / python -m http.server）即可正常运行。

---

## 🛟 维护联系人 & 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2026-07-03 | 初版发布：上传词表 / 选 Sheet / 看词说意 / 听音辨义 / 有道发音 / 一键显隐乱序 / localStorage 持久化 |

本项目是纯前端单页应用（SPA），所有核心代码都带有详细的中文注释，非技术同学也可以按「目录结构 → 对应页面文件」的方式找到想改的位置。祝背单词愉快！✨
