/**
 * 精听播放页「划词查义」注入脚本
 *
 * 背景：点击目录里的「本地网页」条目时，我们是用 Blob URL 打开「下载网页」生成的
 * 独立 HTML（内含音频与完整版文本）。那份文件是外部工具产出的，无法直接改它的源码，
 * 所以在打开前把下面这段脚本插到 </body> 之前，给它加上：
 *
 *   - 在完整版文本里选中单词 / 短语 / 句子 → 自动弹出释义卡片（无需额外点击）
 *   - 释义优先「有道词典」，其次「百度翻译」，最后 MyMemory 兜底
 *   - 单词附带英/美两套音标与发音（发音走有道发音接口，失败时用开放词典音频兜底）
 *   - 卡片样式贴近有道词典：单词标题、英 / 美 音标、喇叭按钮、词性释义、来源
 *   - 查词后点「＋ 加入词表」可把单词存入生词本（仅当前页面，关闭或切换页面即清空）
 *   - 生词本固定在页面最下面：序号 / 单词 / 英·美发音 / 释义
 *   - 生词本「检查」→ 选 5/7/10/15 秒限时 → 乱序辨音弹窗（听音回忆，倒计时结束揭晓）
 *
 * 说明：脚本运行在独立页面的 Shadow DOM 里，样式与播放页互不影响。
 */

const LOOKUP_SCRIPT = String.raw`
(function () {
  if (window.__vocalLookupInstalled) return;
  window.__vocalLookupInstalled = true;

  var host = document.createElement('div');
  host.id = '__vocal_lookup_root';
  host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  (document.body || document.documentElement).appendChild(host);

  var style = document.createElement('style');
  style.textContent = [
    '.card{position:absolute;box-sizing:border-box;background:#fff;border-radius:16px;',
    'box-shadow:0 12px 40px rgba(15,23,42,.18),0 2px 8px rgba(15,23,42,.08);',
    'border:1px solid #edf0f5;padding:16px 18px 12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",',
    '"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;display:none;}',
    '.head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}',
    '.title{flex:1;min-width:0;font-size:22px;font-weight:700;line-height:1.25;word-break:break-word;letter-spacing:-.2px;}',
    '.close{border:0;background:transparent;color:#b6bdc8;font-size:22px;line-height:1;cursor:pointer;',
    'padding:0 2px;margin-top:-3px;transition:color .15s;}',
    '.close:hover{color:#6b7280;}',
    '.pron{display:flex;flex-wrap:wrap;gap:16px;margin-top:8px;}',
    '.pronItem{display:inline-flex;align-items:center;gap:6px;}',
    '.pronLabel{font-size:13px;color:#9aa4b2;}',
    '.ipa{font-size:13.5px;color:#4b5563;font-family:Georgia,"Times New Roman",serif;}',
    '.spk{border:0;background:transparent;padding:0;cursor:pointer;display:inline-flex;align-items:center;',
    'color:#7c8696;transition:color .15s;}',
    '.spk:hover{color:#4f46e5;}',
    '.spk svg{width:17px;height:17px;display:block;}',
    '.divider{height:1px;background:#eef1f6;margin:11px 0 9px;}',
    '.def{font-size:14.5px;line-height:1.75;color:#374151;margin:0 0 5px;word-break:break-word;}',
    '.related{font-size:12px;line-height:1.6;color:#8b93a1;margin-top:7px;word-break:break-word;}',
    '.related span{color:#6b7280;}',
    '.foot{margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;}',
    '.src{font-size:11px;color:#a3aab6;}',
    '.hint{font-size:12px;color:#9aa4b2;}',
    '.dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#6366f1;margin-right:6px;',
    'vertical-align:middle;animation:pulse 1s ease-in-out infinite;}',
    '@keyframes pulse{0%,100%{opacity:.35}50%{opacity:1}}',
    /* ---- 加入词表按钮（卡片右上角，× 左侧） ---- */
    '.hright{display:flex;align-items:center;gap:8px;flex:0 0 auto;}',
    '.addbtn{border:1px solid #ddd6fe;background:#f5f3ff;color:#5b21b6;font-size:12px;font-weight:600;',
    'padding:5px 10px;border-radius:8px;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s;}',
    '.addbtn:hover{background:#ede9fe;}',
    '.addbtn.done{background:#ecfdf5;border-color:#a7f3d0;color:#047857;}',
    /* ---- 生词本面板（参考导出错词卡片） ---- */
    '.book{position:relative;margin:26px auto 44px;width:calc(100% - 32px);max-width:1080px;background:#fff;',
    'border-radius:22px;box-shadow:0 8px 30px rgba(15,23,42,.10);border:1px solid #eef1f6;',
    'display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",',
    '"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;}',
    '.book.show{display:flex;}',
    '.bookHead{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid #f1f5f9;}',
    '.bookIcon{flex:0 0 auto;width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#8b5cf6,#a855f7);',
    'color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(139,92,246,.35);}',
    '.bookIcon svg{width:22px;height:22px;}',
    '.bookTitles{flex:1;min-width:0;}',
    '.bookTitle{font-size:15px;font-weight:800;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.bookSub{margin-top:3px;font-size:12px;color:#64748b;}',
    '.bookSub b{color:#7c3aed;font-weight:800;}',
    '.bookActions{display:flex;align-items:center;gap:8px;}',
    '.chk{display:inline-flex;align-items:center;gap:5px;border:0;background:linear-gradient(135deg,#8b5cf6,#7c3aed);',
    'color:#fff;font-size:13px;font-weight:700;padding:8px 16px;border-radius:12px;cursor:pointer;',
    'box-shadow:0 8px 18px rgba(124,58,237,.28);}',
    '.chk:hover{filter:brightness(1.07);}',
    '.chk svg{width:14px;height:14px;}',
    '.bookList{padding:4px 20px 8px;}',
    '.row{display:grid;grid-template-columns:2.6rem minmax(0,10rem) 4.4rem minmax(0,1fr) 2.2rem;align-items:center;',
    'gap:18px;padding:11px 0;border-bottom:1px solid #f4f6fa;font-size:14px;}',
    '.row:last-child{border-bottom:0;}',
    '.del{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;',
    'border-radius:8px;background:transparent;color:#cbd5e1;cursor:pointer;transition:background .15s,color .15s;}',
    '.del svg{width:15px;height:15px;display:block;}',
    '.del:hover{background:#fff1f2;color:#e11d48;}',
    '.idx{color:#94a3b8;font-size:13px;font-weight:600;text-align:center;font-variant-numeric:tabular-nums;}',
    '.wd{font-weight:700;color:#0f172a;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.pronMini{display:flex;gap:5px;align-items:center;}',
    '.pmini{border:1px solid #e5e7eb;background:#fff;color:#64748b;font-size:11px;line-height:1;',
    'padding:4px 7px;border-radius:7px;cursor:pointer;}',
    '.pmini:hover{border-color:#c4b5fd;color:#7c3aed;background:#f5f3ff;}',
    '.mn{color:#475569;font-size:13.5px;line-height:1.55;word-break:break-word;}',
    '.bookFoot{display:flex;gap:10px;padding:12px 20px 14px;border-top:1px solid #f1f5f9;background:#fbfcfe;}',
    '.copy{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;',
    'background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;font-size:13.5px;font-weight:700;padding:11px 0;',
    'border-radius:14px;cursor:pointer;box-shadow:0 10px 22px rgba(124,58,237,.3);}',
    '.copy:hover{filter:brightness(1.06);}',
    '.copy svg{width:16px;height:16px;}',
    '.fold{border:1px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;font-weight:600;padding:11px 22px;',
    'border-radius:14px;cursor:pointer;}',
    '.fold:hover{border-color:#c4b5fd;color:#7c3aed;}',
    '.imp{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #c7d2fe;',
    'background:#eef2ff;color:#4f46e5;font-size:13px;font-weight:600;padding:11px 18px;border-radius:14px;cursor:pointer;}',
    '.imp:hover{background:#e0e7ff;border-color:#a5b4fc;}',
    '.imp svg{width:15px;height:15px;}',
    /* ---- 提示条 ---- */
    '.toast{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);background:rgba(17,24,39,.9);color:#fff;',
    'font-size:12.5px;padding:8px 16px;border-radius:999px;opacity:0;transition:opacity .2s;pointer-events:none;',
    'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;}',
    '.toast.on{opacity:1;}',
    /* ---- 限时选择弹窗 ---- */
    '.pick{position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);display:none;',
    'align-items:center;justify-content:center;padding:0 20px;z-index:2147483647;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}',
    '.pick.show{display:flex;}',
    '.pickCard{position:relative;width:min(460px,calc(100vw - 40px));background:#fff;border-radius:24px;padding:24px;',
    'box-shadow:0 24px 64px rgba(15,23,42,.32);}',
    '.pickTop{display:flex;align-items:center;gap:12px;margin-bottom:18px;padding-right:28px;}',
    '.pickIcon{flex:0 0 auto;width:48px;height:48px;border-radius:16px;background:linear-gradient(135deg,#8b5cf6,#a855f7);',
    'color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 22px rgba(139,92,246,.35);}',
    '.pickIcon svg{width:24px;height:24px;}',
    '.pickTitle{font-size:18px;font-weight:800;color:#0f172a;}',
    '.pickDesc{margin-top:4px;font-size:12px;color:#64748b;}',
    '.px{position:absolute;right:14px;top:14px;width:32px;height:32px;border:0;border-radius:50%;background:transparent;',
    'color:#94a3b8;font-size:20px;line-height:1;cursor:pointer;}',
    '.px:hover{background:#f1f5f9;color:#475569;}',
    '.pickGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}',
    '.pickBtn{display:flex;flex-direction:column;align-items:center;gap:4px;padding:18px 0 14px;border:2px solid #e2e8f0;',
    'border-radius:18px;background:#fff;cursor:pointer;transition:.15s;}',
    '.pickBtn:hover{border-color:#a78bfa;background:#f5f3ff;}',
    '.pickBtn b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:30px;font-weight:900;',
    'color:#7c3aed;line-height:1;}',
    '.pickBtn span{font-size:12px;color:#64748b;}',
    /* ---- 辨音计时弹窗（听音辨义计时模式） ---- */
    '.recite{position:fixed;inset:0;background:rgba(15,23,42,.62);backdrop-filter:blur(6px);display:none;',
    'align-items:center;justify-content:center;padding:20px 10px;overflow:auto;z-index:2147483647;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}',
    '.recite.show{display:flex;}',
    '.rwrap{display:flex;align-items:center;gap:14px;width:100%;max-width:660px;margin:auto;}',
    '.nav{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:42px;height:42px;border:0;',
    'border-radius:50%;background:#fff;color:#475569;font-size:20px;line-height:1;cursor:pointer;',
    'box-shadow:0 8px 20px rgba(15,23,42,.2);transition:.15s;}',
    '.nav:hover:not(:disabled){background:#f5f3ff;color:#7c3aed;}',
    '.nav:disabled{background:rgba(226,232,240,.85);color:#cbd5e1;cursor:not-allowed;}',
    '.rbox{flex:1;min-width:0;background:#fff;border-radius:24px;overflow:hidden;user-select:none;',
    'box-shadow:0 24px 64px rgba(15,23,42,.35);}',
    '.rhead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 22px;',
    'background:linear-gradient(90deg,#f5f3ff,#faf5ff);border-bottom:1px solid #f1f5f9;}',
    '.rstat{display:flex;align-items:center;gap:5px;font-size:13px;font-weight:700;color:#334155;flex-wrap:wrap;}',
    '.rstat svg{width:14px;height:14px;color:#7c3aed;}',
    '.rstat .dot2{width:4px;height:4px;border-radius:50%;background:#cbd5e1;margin:0 2px;}',
    '.rstat .cur{color:#7c3aed;}',
    '.rstat .star{color:#d97706;}',
    '.rstat .acc{color:#059669;font-weight:800;}',
    '.rstat .acc.bad{color:#e11d48;}',
    '.rx{flex:0 0 auto;border:0;background:transparent;color:#94a3b8;font-size:22px;line-height:1;cursor:pointer;',
    'padding:0 2px;}',
    '.rx:hover{color:#475569;}',
    '.rbar{height:6px;background:#f1f5f9;}',
    '.rbarIn{height:100%;border-radius:999px;background:linear-gradient(90deg,#8b5cf6,#a855f7);',
    'transition:width .6s ease-out;}',
    '.rbody{padding:24px 24px 20px;text-align:center;}',
    '.ring{position:relative;width:80px;height:80px;margin:0 auto 16px;}',
    '.ring svg{width:80px;height:80px;transform:rotate(-90deg);display:block;}',
    '.ringNum{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:24px;',
    'font-weight:900;color:#7c3aed;font-variant-numeric:tabular-nums;}',
    '.starTag{display:flex;align-items:center;justify-content:center;gap:4px;margin-top:6px;font-size:12px;',
    'font-weight:600;color:#d97706;}',
    '.starTag svg{width:12px;height:12px;}',
    '.bigspk{width:96px;height:96px;border:0;border-radius:50%;background:linear-gradient(135deg,#8b5cf6,#a855f7);',
    'color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;',
    'box-shadow:0 14px 30px rgba(139,92,246,.42);transition:transform .15s;}',
    '.bigspk:hover{transform:scale(1.05);}',
    '.bigspk svg{width:44px;height:44px;}',
    '.rhint{margin-top:16px;font-size:13px;font-weight:500;color:#64748b;}',
    '.rshow{margin-top:16px;min-height:2.5rem;}',
    '.rshowBtn{border:0;background:transparent;font-family:inherit;cursor:pointer;padding:0;width:100%;}',
    '.rshowBtn p{margin:0;}',
    '.rplaceholder{font-size:26px;font-weight:900;color:#94a3b8;opacity:.45;letter-spacing:-.2px;}',
    '.rword{font-size:34px;font-weight:900;color:#0f172a;letter-spacing:-.5px;line-height:1.2;word-break:break-word;}',
    '.rdiv{width:64px;height:1px;background:#ddd6fe;margin:14px auto;}',
    '.rmean{font-size:18px;line-height:1.65;color:#0f172a;word-break:break-word;}',
    '.rfoot{border-top:1px solid #f1f5f9;background:#fafbfe;padding:15px 22px 17px;}',
    '.rbtns{display:flex;gap:10px;}',
    '.rbtn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;padding:13px 0;',
    'border-radius:16px;font-size:15px;font-weight:700;color:#fff;cursor:pointer;transition:.15s;}',
    '.rbtn svg{width:18px;height:18px;}',
    '.rbtn.ok{background:linear-gradient(90deg,#10b981,#14b8a6);box-shadow:0 10px 22px rgba(16,185,129,.3);}',
    '.rbtn.mark{background:linear-gradient(90deg,#fbbf24,#f97316);box-shadow:0 10px 22px rgba(249,115,22,.3);}',
    '.rbtn.ghost{background:#fff;border:1px solid #e2e8f0;color:#475569;box-shadow:none;}',
    '.rbtn:hover{filter:brightness(1.05);}',
    '.rbtn:active{transform:translateY(1px);}',
    '.rkeys{margin-top:10px;text-align:center;font-size:11px;color:#94a3b8;}',
    '.rdone{text-align:left;padding:22px 22px 24px;}',
    '.rdone h4{margin:0 0 6px;font-size:17px;font-weight:800;color:#0f172a;line-height:1.4;word-break:break-word;}',
    '.rdone p{margin:0 0 16px;font-size:13px;color:#64748b;}',
    '.rdone .rbtns{justify-content:center;}',
    '.rdone .rbtn{flex:0 0 auto;padding:11px 26px;font-size:14px;}',
    '.rdone .dlabel{display:flex;align-items:center;justify-content:space-between;margin:0 0 6px;font-size:12px;',
    'font-weight:700;color:#94a3b8;}',
    '.rdone .dlist{max-height:46vh;overflow:auto;text-align:left;margin:0 0 16px;border-top:1px solid #f1f5f9;}',
    '.rdone .drow{display:grid;grid-template-columns:2.6rem minmax(0,10rem) minmax(0,1fr);gap:18px;align-items:center;',
    'padding:11px 0;border-bottom:1px solid #f4f6fa;font-size:14px;}',
    '.rdone .didx{color:#94a3b8;font-size:13px;font-weight:600;text-align:center;',
    'font-variant-numeric:tabular-nums;}',
    '.rdone .dwd{font-weight:700;color:#0f172a;font-size:15px;word-break:break-word;}',
    '.rdone .dmn{color:#475569;line-height:1.5;word-break:break-word;}',
    '.rdone .dempty{padding:10px 0 16px;font-size:13px;color:#94a3b8;}',
    '@keyframes deplete{from{stroke-dashoffset:0}to{stroke-dashoffset:100}}',
    '@keyframes tone{0%{stroke:#8b5cf6}60%{stroke:#f59e0b}100%{stroke:#ef4444}}',
    '@keyframes toneText{0%{color:#7c3aed}60%{color:#d97706}100%{color:#e11d48}}'
  ].join('');
  root.appendChild(style);

  var card = document.createElement('div');
  card.className = 'card';
  root.appendChild(card);

  var currentToken = 0;
  var cache = {};

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function hide() {
    card.style.display = 'none';
  }

  function speakerButton(onClick) {
    var btn = document.createElement('button');
    btn.className = 'spk';
    btn.type = 'button';
    btn.title = '播放发音';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"></path>' +
      '<path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18.5 5.5a9 9 0 0 1 0 13"></path></svg>';
    btn.onclick = function (e) {
      e.stopPropagation();
      onClick();
    };
    return btn;
  }

  // ---------- 生词本（仅当前页面内存，关闭页面即清空） ----------

  var WB_KEY = 'vocal_listening_wordbook_v1';
  var bookCollapsed = false;
  var quizTimer = null;
  var quizState = null;
  var quizPaintShow = null;

  /** 播放页标题（目录标题），由 injectLookup 注入时写入 */
  function resolvePageTitle() {
    var t = '';
    try { t = String(window.__vocalPageTitle || ''); } catch (e) { t = ''; }
    if (!t) t = String(document.title || '').replace(/·\s*逐句听练.*$/, '').trim();
    return t || '精听生词本';
  }
  var PAGE_TITLE = resolvePageTitle();

  /** 常用图标（线性风格，颜色跟随 currentColor） */
  var ICON = {
    timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"></path></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18.5 5.5a9 9 0 0 1 0 13"></path></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>'
  };

  // 生词本挂到页面内容末尾（文档流内）：永远在「全文」下方，逐条向下排，不遮挡原文
  var bookHost = document.createElement('div');
  bookHost.id = '__vocal_book_root';
  bookHost.style.cssText = 'display:block;width:100%;box-sizing:border-box;';
  (document.body || document.documentElement).appendChild(bookHost);
  var bookRoot = bookHost.attachShadow ? bookHost.attachShadow({ mode: 'open' }) : bookHost;
  if (bookRoot !== bookHost) bookRoot.appendChild(style.cloneNode(true));

  var bookEl = document.createElement('div');
  bookEl.className = 'book';
  bookRoot.appendChild(bookEl);

  var pickEl = document.createElement('div');
  pickEl.className = 'pick';
  root.appendChild(pickEl);

  var reciteEl = document.createElement('div');
  reciteEl.className = 'recite';
  root.appendChild(reciteEl);

  var toastEl = document.createElement('div');
  toastEl.className = 'toast';
  root.appendChild(toastEl);
  var toastTimer = null;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.className = 'toast on';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 1500);
  }

  // 生词本只保存在当前页面内存中：关闭标签页或打开其他目录条目后自动清空，
  // 不同精听页面之间不共享词表。
  var bookStore = [];

  // 清理旧版本遗留在本机的跨页面生词本数据
  try { localStorage.removeItem(WB_KEY); } catch (e) {}

  function loadBook() {
    return bookStore;
  }

  function saveBook(arr) {
    bookStore = arr;
  }

  function findInBook(word) {
    var list = loadBook();
    var lower = String(word).toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].word).toLowerCase() === lower) return true;
    }
    return false;
  }

  /** 把当前查询结果加入生词本（单词 + 音标 + 释义） */
  function addToBook(data) {
    var word = String((data && data.title) || '').trim();
    if (!word) return;
    var list = loadBook();
    if (findInBook(word)) { toast('已在生词本中'); return; }
    var wasEmpty = list.length === 0;
    list.push({
      word: word,
      uk: data.uk || '',
      us: data.us || '',
      meaning: (data.defs || []).join('；')
    });
    saveBook(list);
    toast('已加入生词本');
    renderBook();
    // 首次加入时把生词本滚动到可视区（它位于全文下方）
    if (wasEmpty) {
      try { bookEl.scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch (e) {}
    }
  }

  /** 一键复制文本：第 1 行播放页标题，之后每行「序号\t单词\t释义」 */
  function buildCopyText() {
    var list = loadBook();
    var lines = [PAGE_TITLE];
    for (var i = 0; i < list.length; i++) {
      lines.push((i + 1) + '\t' + list[i].word + '\t' + (list[i].meaning || ''));
    }
    return lines.join('\n');
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      (document.body || document.documentElement).appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      if (ta.parentNode) ta.parentNode.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  /** 复制任意文本（Clipboard API，失败走 execCommand 兜底），并给出提示 */
  function copyToClipboard(text) {
    function done(ok) { toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择'); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () {
          done(fallbackCopy(text));
        });
        return;
      }
    } catch (e) { /* 继续走兜底 */ }
    done(fallbackCopy(text));
  }

  function copyBook() {
    copyToClipboard(buildCopyText());
  }

  // ---------- 导入到首页「生词整理」（localStorage: vocal_collection_v1） ----------

  var COLLECTION_KEY = 'vocal_collection_v1';
  var COLLECTION_LIMIT = 500;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtStamp(ts) {
    var d = new Date(ts);
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 把当前生词本整体导入首页固定词表「生词整理」，作为最上面的一个新单元 */
  function importToCollection() {
    var list = loadBook();
    if (!list.length) { toast('生词本还是空的'); return; }

    var units = [];
    try {
      var raw = localStorage.getItem(COLLECTION_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      units = Array.isArray(arr) ? arr : [];
    } catch (e) { units = []; }

    var total = 0;
    for (var u = 0; u < units.length; u++) {
      total += (units[u].words || []).length;
    }
    var room = COLLECTION_LIMIT - total;
    if (room <= 0) {
      toast('生词整理已达 ' + COLLECTION_LIMIT + ' 词上限，请先导出或清理');
      return;
    }

    var seen = {};
    var words = [];
    for (var i = 0; i < list.length && words.length < room; i++) {
      var key = String(list[i].word || '').toLowerCase();
      if (!key || seen[key]) continue;
      seen[key] = true;
      words.push({
        word: list[i].word,
        uk: list[i].uk || '',
        us: list[i].us || '',
        ukPhonetic: '',
        usPhonetic: '',
        meaning: list[i].meaning || '',
        pos: ''
      });
    }
    if (!words.length) { toast('没有可导入的单词'); return; }

    var unit = {
      id: 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      name: (PAGE_TITLE || '精听生词') + ' · ' + fmtStamp(Date.now()),
      createdAt: Date.now(),
      words: words
    };
    units.unshift(unit);

    try {
      localStorage.setItem(COLLECTION_KEY, JSON.stringify(units));
      toast(words.length < list.length
        ? '已导入 ' + words.length + ' 词（达到上限，部分未导入）'
        : '已导入生词整理，回首页即可查看');
    } catch (e) {
      toast('导入失败：浏览器本地存储不可用');
    }
  }

  /** 生词本面板：标题 + 数量 + 检查 + 列表 + 一键复制（参考导出错词卡片） */
  function renderBook() {
    var list = loadBook();
    bookEl.innerHTML = '';
    if (!list.length) {
      bookEl.className = 'book';
      return;
    }
    bookEl.className = 'book show';

    var head = el('div', 'bookHead');
    var icon = el('div', 'bookIcon');
    icon.innerHTML = ICON.book;
    head.appendChild(icon);

    var titles = el('div', 'bookTitles');
    titles.appendChild(el('div', 'bookTitle', PAGE_TITLE));
    var sub = el('div', 'bookSub');
    sub.appendChild(document.createTextNode('生词本 · 共 '));
    sub.appendChild(el('b', null, String(list.length)));
    sub.appendChild(document.createTextNode(' 词'));
    titles.appendChild(sub);
    head.appendChild(titles);

    var actions = el('div', 'bookActions');
    var checkBtn = document.createElement('button');
    checkBtn.className = 'chk';
    checkBtn.type = 'button';
    checkBtn.innerHTML = ICON.timer + '<span>检查</span>';
    checkBtn.onclick = openPicker;
    actions.appendChild(checkBtn);
    head.appendChild(actions);
    bookEl.appendChild(head);

    if (!bookCollapsed) {
      var listEl = el('div', 'bookList');
      for (var i = 0; i < list.length; i++) {
        var w = list[i];
        var row = el('div', 'row');
        row.appendChild(el('span', 'idx', String(i + 1)));
        row.appendChild(el('span', 'wd', String(w.word)));

        var pron = el('span', 'pronMini');
        (function (word) {
          var uk = el('button', 'pmini', '英');
          uk.type = 'button';
          uk.title = '英式发音';
          uk.onclick = function () { playPronunciation(word, 'uk'); };
          var us = el('button', 'pmini', '美');
          us.type = 'button';
          us.title = '美式发音';
          us.onclick = function () { playPronunciation(word, 'us'); };
          pron.appendChild(uk);
          pron.appendChild(us);
        })(w.word);
        row.appendChild(pron);

        row.appendChild(el('span', 'mn', w.meaning || '—'));

        // 行尾删除：点击后从生词本移除当前单词
        var del = el('button', 'del');
        del.type = 'button';
        del.title = '删除这个单词';
        del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path>' +
          '<path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path>' +
          '<path d="M10 11v6"></path><path d="M14 11v6"></path></svg>';
        del.onclick = (function (word) {
          return function () {
            var arr = loadBook();
            var next = [];
            for (var k = 0; k < arr.length; k++) {
              if (arr[k].word !== word) next.push(arr[k]);
            }
            saveBook(next);
            toast('已删除 ' + word);
            renderBook();
          };
        })(w.word);
        row.appendChild(del);

        listEl.appendChild(row);
      }
      bookEl.appendChild(listEl);
    }

    var foot = el('div', 'bookFoot');
    var copyBtn = document.createElement('button');
    copyBtn.className = 'copy';
    copyBtn.type = 'button';
    copyBtn.innerHTML = ICON.copy + '<span>一键复制</span>';
    copyBtn.onclick = copyBook;
    foot.appendChild(copyBtn);

    var impBtn = document.createElement('button');
    impBtn.className = 'imp';
    impBtn.type = 'button';
    impBtn.title = '导入到首页「生词整理」';
    impBtn.innerHTML = ICON.download + '<span>导入生词表</span>';
    impBtn.onclick = importToCollection;
    foot.appendChild(impBtn);

    var fold = el('button', 'fold', bookCollapsed ? '展开' : '收起');
    fold.type = 'button';
    fold.onclick = function () {
      bookCollapsed = !bookCollapsed;
      renderBook();
    };
    foot.appendChild(fold);
    bookEl.appendChild(foot);
  }

  // ---------- 辨音限时检查弹窗 ----------

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  // ---------- 限时选择弹窗（图二：计时背诵） ----------

  function openPicker() {
    if (reciteEl.className.indexOf('show') >= 0) return;
    if (!loadBook().length) { toast('生词本还是空的'); return; }
    pickEl.className = 'pick show';
    pickEl.innerHTML = '';

    var pickCard = el('div', 'pickCard');
    var x = el('button', 'px', '×');
    x.type = 'button';
    x.title = '关闭';
    x.onclick = closePicker;
    pickCard.appendChild(x);

    var top = el('div', 'pickTop');
    var icon = el('div', 'pickIcon');
    icon.innerHTML = ICON.timer;
    top.appendChild(icon);
    var tt = el('div', null);
    tt.appendChild(el('div', 'pickTitle', '计时背诵'));
    tt.appendChild(el('div', 'pickDesc', '选择每个单词的倒计时秒数，超时未操作将自动标星'));
    top.appendChild(tt);
    pickCard.appendChild(top);

    var grid = el('div', 'pickGrid');
    var secs = [5, 7, 10, 15];
    for (var i = 0; i < secs.length; i++) {
      (function (sec) {
        var b = el('button', 'pickBtn');
        b.type = 'button';
        b.appendChild(el('b', null, String(sec)));
        b.appendChild(el('span', null, '秒 / 词'));
        b.onclick = function () { closePicker(); startQuiz(sec); };
        grid.appendChild(b);
      })(secs[i]);
    }
    pickCard.appendChild(grid);
    pickEl.appendChild(pickCard);
    pickEl.onclick = function (e) { if (e.target === pickEl) closePicker(); };
  }

  function closePicker() {
    pickEl.className = 'pick';
    pickEl.innerHTML = '';
    pickEl.onclick = null;
  }

  // ---------- 辨音计时检查（与「听音辨义 · 计时背诵」一致） ----------

  function stopTimer() {
    if (quizTimer) { clearInterval(quizTimer); quizTimer = null; }
  }

  function closeQuiz() {
    stopTimer();
    quizState = null;
    quizPaintShow = null;
    reciteEl.className = 'recite';
    reciteEl.innerHTML = '';
  }

  function startQuiz(seconds) {
    stopTimer();
    var list = shuffle(loadBook().slice());
    if (!list.length) { toast('生词本还是空的'); return; }
    quizState = {
      list: list,
      seconds: seconds,
      index: 0,
      remaining: seconds,
      revealed: false,
      starred: {}
    };
    reciteEl.className = 'recite show';
    renderQuiz();
  }

  /** 当前已标星数量 */
  function quizStarCount() {
    if (!quizState) return 0;
    var n = 0;
    for (var k in quizState.starred) { if (quizState.starred[k]) n++; }
    return n;
  }

  /** 切换到指定下标（倒计时与释义展示状态重置） */
  function quizGo(index) {
    var game = quizState;
    if (!game) return;
    game.index = index < 0 ? 0 : index;
    game.remaining = game.seconds;
    game.revealed = false;
    renderQuiz();
  }

  /** mark=true 标星并下一词；mark=false 记住（取消标星）并下一词 */
  function quizStep(mark) {
    var game = quizState;
    if (!game) return;
    var cur = game.list[game.index];
    if (cur) {
      if (mark) game.starred[cur.word] = true;
      else delete game.starred[cur.word];
    }
    quizGo(game.index + 1);
  }

  /** 每词独立倒计时：归零 = 自动标星并进入下一词 */
  function startTimer() {
    stopTimer();
    quizTimer = setInterval(function () {
      var game = quizState;
      if (!game) { stopTimer(); return; }
      game.remaining--;
      var numEl = reciteEl.querySelector('.ringNum');
      if (game.remaining > 0) {
        if (numEl) numEl.textContent = String(game.remaining);
        return;
      }
      stopTimer();
      if (numEl) numEl.textContent = '0';
      quizStep(true);
    }, 1000);
  }

  function renderQuiz() {
    var game = quizState;
    if (!game) return;
    stopTimer();
    reciteEl.innerHTML = '';
    if (game.index >= game.list.length) { renderQuizDone(); return; }

    var cur = game.list[game.index];
    var total = game.list.length;
    var starredCount = quizStarCount();
    var acc = total > 0 ? Math.round(((total - starredCount) / total) * 100) : 100;

    var wrap = el('div', 'rwrap');

    var prev = el('button', 'nav', '‹');
    prev.type = 'button';
    prev.title = '上一词（←）';
    prev.disabled = game.index <= 0;
    prev.onclick = function () { quizGo(game.index - 1); };
    wrap.appendChild(prev);

    var box = el('div', 'rbox');

    // 顶部统计：第 N / 总数 个 · 标星 X 个 · 准确率 Y%
    var head = el('div', 'rhead');
    var stat = el('div', 'rstat');
    var clock = el('span', null);
    clock.innerHTML = ICON.timer;
    stat.appendChild(clock);
    stat.appendChild(document.createTextNode('第 '));
    stat.appendChild(el('span', 'cur', String(game.index + 1)));
    stat.appendChild(document.createTextNode(' / ' + total + ' 个'));
    stat.appendChild(el('span', 'dot2'));
    stat.appendChild(el('span', 'star', '标星 ' + starredCount + ' 个'));
    stat.appendChild(el('span', 'dot2'));
    stat.appendChild(el('span', 'acc' + (acc < 90 ? ' bad' : ''), '准确率 ' + acc + '%'));
    head.appendChild(stat);
    var xx = el('button', 'rx', '×');
    xx.type = 'button';
    xx.title = '退出检查';
    xx.onclick = closeQuiz;
    head.appendChild(xx);
    box.appendChild(head);

    // 进度条
    var bar = el('div', 'rbar');
    var barIn = el('div', 'rbarIn');
    barIn.style.width = ((game.index / total) * 100) + '%';
    bar.appendChild(barIn);
    box.appendChild(bar);

    var body = el('div', 'rbody');

    // 圆形倒计时（环随秒数递减并变色）
    var ring = el('div', 'ring');
    ring.innerHTML = '<svg viewBox="0 0 36 36">' +
      '<circle cx="18" cy="18" r="15.9155" fill="none" stroke="#e2e8f0" stroke-width="3" stroke-linecap="round"></circle>' +
      '<circle cx="18" cy="18" r="15.9155" fill="none" stroke-width="3" stroke-linecap="round" stroke-dasharray="100" ' +
      'style="animation:deplete ' + game.seconds + 's linear forwards,tone ' + game.seconds + 's linear forwards"></circle>' +
      '</svg>';
    var num = el('div', 'ringNum', String(game.remaining));
    num.style.animation = 'toneText ' + game.seconds + 's linear forwards';
    ring.appendChild(num);
    body.appendChild(ring);

    if (game.starred[cur.word]) {
      var tag = el('div', 'starTag');
      tag.innerHTML = ICON.star + '<span>已标星</span>';
      body.appendChild(tag);
    }

    // 听音辨义：只给发音，单词与释义默认隐藏
    var spk = document.createElement('button');
    spk.className = 'bigspk';
    spk.type = 'button';
    spk.title = '点击播放发音（Shift / B）';
    spk.innerHTML = ICON.speaker;
    spk.onclick = function () { playPronunciation(cur.word, 'us'); };
    body.appendChild(spk);

    body.appendChild(el('p', 'rhint', '点击喇叭播放发音，尝试回想单词和释义'));

    var show = el('div', 'rshow');
    function paintShow() {
      show.innerHTML = '';
      var b = document.createElement('button');
      b.className = 'rshowBtn';
      b.type = 'button';
      if (game.revealed) {
        b.title = '点击收起（↑）';
        b.appendChild(el('p', 'rword', cur.word));
        b.appendChild(el('div', 'rdiv'));
        b.appendChild(el('p', 'rmean', cur.meaning || '—'));
      } else {
        b.title = '点击显示（↑ / 空格）';
        b.appendChild(el('span', 'rplaceholder', '显示单词和释义'));
      }
      b.onclick = function () {
        game.revealed = !game.revealed;
        paintShow();
      };
      show.appendChild(b);
    }
    quizPaintShow = paintShow;
    paintShow();
    body.appendChild(show);

    box.appendChild(body);

    // 底部：记住 / 标星 + 快捷键
    var foot = el('div', 'rfoot');
    var btns = el('div', 'rbtns');
    var ok = document.createElement('button');
    ok.className = 'rbtn ok';
    ok.type = 'button';
    ok.innerHTML = ICON.check + '<span>记住</span>';
    ok.onclick = function () { quizStep(false); };
    var mark = document.createElement('button');
    mark.className = 'rbtn mark';
    mark.type = 'button';
    mark.innerHTML = ICON.star + '<span>标星</span>';
    mark.onclick = function () { quizStep(true); };
    btns.appendChild(ok);
    btns.appendChild(mark);
    foot.appendChild(btns);
    foot.appendChild(el('div', 'rkeys', '快捷键：← 上一词 · → 下一词 · ↑/空格 显示/收起释义 · ↓/M 标星 · N 记住 · Shift/B 播放发音'));
    box.appendChild(foot);

    wrap.appendChild(box);

    var next = el('button', 'nav', '›');
    next.type = 'button';
    next.title = '下一词（→）';
    next.disabled = game.index >= total - 1;
    next.onclick = function () { quizGo(game.index + 1); };
    wrap.appendChild(next);

    reciteEl.appendChild(wrap);

    // 与听音辨义计时模式一致：进入新单词自动播放美音
    playPronunciation(cur.word, 'us');
    startTimer();
  }

  /** 检查完成页 */
  function renderQuizDone() {
    var game = quizState;
    if (!game) return;
    var total = game.list.length;
    var starredCount = quizStarCount();
    var acc = total > 0 ? Math.round(((total - starredCount) / total) * 100) : 100;

    reciteEl.innerHTML = '';
    var box = el('div', 'rbox');
    // 与生词本面板同宽
    box.style.width = 'calc(100% - 32px)';
    box.style.maxWidth = '1080px';
    box.style.margin = 'auto';

    var head = el('div', 'rhead');
    var stat = el('div', 'rstat');
    stat.appendChild(el('span', 'cur', '检查完成'));
    head.appendChild(stat);
    var xx = el('button', 'rx', '×');
    xx.type = 'button';
    xx.title = '关闭';
    xx.onclick = closeQuiz;
    head.appendChild(xx);
    box.appendChild(head);

    var done = el('div', 'rdone');
    done.appendChild(el('h4', null, PAGE_TITLE + ' 错词'));
    var rightCount = total - starredCount;
    done.appendChild(el('p', null, '共 ' + total + ' 词 · 错 ' + starredCount + ' · 对 ' + rightCount + '，准确率 ' + acc + '%'));

    // 标星错词（与导出标星错词一致：序号 / 单词 / 释义）
    var wrong = [];
    for (var i = 0; i < game.list.length; i++) {
      if (game.starred[game.list[i].word]) wrong.push(game.list[i]);
    }
    var label = el('div', 'dlabel');
    label.appendChild(el('span', null, '标星错词'));
    label.appendChild(el('span', null, '共 ' + wrong.length + ' 个'));
    done.appendChild(label);
    if (!wrong.length) {
      done.appendChild(el('div', 'dempty', '本轮没有标星的错词'));
    } else {
      var dlist = el('div', 'dlist');
      for (var j = 0; j < wrong.length; j++) {
        var r = el('div', 'drow');
        r.appendChild(el('span', 'didx', String(j + 1)));
        r.appendChild(el('span', 'dwd', String(wrong[j].word)));
        r.appendChild(el('span', 'dmn', wrong[j].meaning || '—'));
        dlist.appendChild(r);
      }
      done.appendChild(dlist);
    }

    var btns = el('div', 'rbtns');
    var copyBtn = el('button', 'rbtn ghost');
    copyBtn.type = 'button';
    copyBtn.innerHTML = ICON.copy + '<span>一键复制</span>';
    copyBtn.onclick = function () {
      // 格式同导出标星：第 1 行标题，第 2 行统计，之后每行「序号\t单词\t释义」
      var lines = [
        PAGE_TITLE,
        '共 ' + total + ' 词 · 错 ' + starredCount + ' · 对 ' + rightCount + '，准确率 ' + acc + '%'
      ];
      for (var k = 0; k < wrong.length; k++) {
        lines.push((k + 1) + '\t' + wrong[k].word + '\t' + (wrong[k].meaning || ''));
      }
      copyToClipboard(lines.join('\n'));
    };
    btns.appendChild(copyBtn);
    var again = el('button', 'rbtn ok', '再来一轮');
    again.type = 'button';
    again.onclick = function () { startQuiz(game.seconds); };
    var quit = el('button', 'rbtn ghost', '关闭');
    quit.type = 'button';
    quit.onclick = closeQuiz;
    btns.appendChild(again);
    btns.appendChild(quit);
    done.appendChild(btns);
    box.appendChild(done);
    reciteEl.appendChild(box);
  }

  function render(data) {
    card.innerHTML = '';
    var head = el('div', 'head');
    head.appendChild(el('div', 'title', data.title));

    // 右上角：加入词表 + 关闭（单词查询完成后才提供，释义 / 音标取当前查询结果）
    var hright = el('div', 'hright');
    if (data.isWord && !data.loading) {
      var added = findInBook(data.title);
      var addBtn = el('button', 'addbtn' + (added ? ' done' : ''), added ? '✓ 已在词表' : '＋ 加入词表');
      addBtn.type = 'button';
      addBtn.title = '加入生词本';
      addBtn.onclick = function (e) {
        e.stopPropagation();
        addToBook(data);
        addBtn.className = 'addbtn done';
        addBtn.textContent = '✓ 已在词表';
      };
      hright.appendChild(addBtn);
    }

    var close = el('button', 'close', '×');
    close.title = '关闭';
    close.onclick = hide;
    hright.appendChild(close);
    head.appendChild(hright);
    card.appendChild(head);

    // 音标行：单词始终显示 英 / 美 两个喇叭；有 IPA 时顺带显示音标
    if (data.isWord) {
      var pron = el('div', 'pron');
      var uk = el('span', 'pronItem');
      uk.appendChild(el('span', 'pronLabel', '英'));
      if (data.uk) uk.appendChild(el('span', 'ipa', data.uk));
      uk.appendChild(speakerButton(function () { playPronunciation(data.title, 'uk'); }));
      pron.appendChild(uk);
      var us = el('span', 'pronItem');
      us.appendChild(el('span', 'pronLabel', '美'));
      if (data.us) us.appendChild(el('span', 'ipa', data.us));
      us.appendChild(speakerButton(function () { playPronunciation(data.title, 'us'); }));
      pron.appendChild(us);
      card.appendChild(pron);
    }

    card.appendChild(el('div', 'divider'));

    if (data.loading) {
      var row = el('div', 'def');
      row.appendChild(el('span', 'dot'));
      row.appendChild(document.createTextNode('正在查询释义…'));
      card.appendChild(row);
    } else if (data.defs && data.defs.length) {
      for (var i = 0; i < data.defs.length; i++) card.appendChild(el('p', 'def', data.defs[i]));
    } else {
      card.appendChild(el('p', 'def', '暂未找到释义，可换个词试试'));
    }

    if (data.related && data.related.length) {
      var rel = el('div', 'related');
      rel.appendChild(el('span', null, '相关：'));
      rel.appendChild(document.createTextNode(data.related.join(' / ')));
      card.appendChild(rel);
    }

    var foot = el('div', 'foot');
    foot.appendChild(el('span', 'src', data.source || ''));
    foot.appendChild(el('span', 'hint', '选中文字即可查询'));
    card.appendChild(foot);
  }

  var lastRect = { left: 0, top: 0, bottom: 0, right: 0 };

  function place() {
    if (card.style.display === 'none') return;
    var w = Math.min(360, window.innerWidth - 24);
    card.style.width = w + 'px';
    var h = card.offsetHeight || 130;
    var left = Math.min(Math.max(12, lastRect.left), window.innerWidth - w - 12);
    var top = lastRect.bottom + 10;
    if (top + h > window.innerHeight - 12) top = Math.max(12, lastRect.top - h - 10);
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function show(data, rect) {
    lastRect = rect;
    render(data);
    card.style.display = 'block';
    place();
    // 内容异步补全后高度会变化，再校正一次位置
    setTimeout(place, 60);
  }

  // ---------- 发音（有道优先，失败按原形/小写/词根重试，最后百度） ----------

  /** 生成可能的词形：原形、小写、去复数/过去式/进行时等后缀的词根 */
  function wordForms(w) {
    var lower = w.toLowerCase();
    var forms = [w, lower];
    var push = function (s) {
      if (s && s.length > 2 && forms.indexOf(s) < 0) forms.push(s);
    };
    if (/ies$/.test(lower)) push(lower.slice(0, -3) + 'y');
    if (/es$/.test(lower)) push(lower.slice(0, -2));
    if (/s$/.test(lower) && !/ss$/.test(lower)) push(lower.slice(0, -1));
    if (/ed$/.test(lower)) {
      push(lower.slice(0, -2));
      push(lower.slice(0, -1)); // created -> create, lived -> live
    }
    if (/ing$/.test(lower)) {
      push(lower.slice(0, -3));
      push(lower.slice(0, -3) + 'e'); // running -> runne? 由前面去掉
      // 双写辅音还原：running -> run
      var stem = lower.slice(0, -3);
      if (stem.length > 2 && stem.slice(-1) === stem.slice(-2, -1)) {
        push(stem.slice(0, -1));
      }
    }
    return forms;
  }

  /** 优先所选口音；美音不可用时自动补英音，最后百度 TTS 兜底 */
  function audioUrls(word, accent) {
    var forms = wordForms(word);
    var accents = accent === 'us' ? ['us', 'uk'] : ['uk', 'us'];
    var urls = [];
    for (var a = 0; a < accents.length; a++) {
      var youdaoType = accents[a] === 'uk' ? 1 : 2;
      for (var i = 0; i < forms.length; i++) {
        var url = 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(forms[i]) + '&type=' + youdaoType;
        if (urls.indexOf(url) < 0) urls.push(url);
      }
    }
    for (var b = 0; b < accents.length; b++) {
      var baiduLan = accents[b] === 'uk' ? 'uk' : 'en';
      urls.push('https://fanyi.baidu.com/gettts?lan=' + baiduLan + '&text=' + encodeURIComponent(word) + '&spd=3&source=web');
    }
    return urls;
  }

  /** 依次尝试音源；每次调用先停掉上一次音频避免串音，全部失败后静默 */
  var _currentAudio = null;
  function playChain(urls) {
    try { if (_currentAudio) { _currentAudio.pause(); _currentAudio = null; } } catch (e) { /* ignore */ }
    if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    var i = 0;
    function next() {
      if (i >= urls.length) return;
      var audio;
      var done = false;
      var timer = null;
      function finish(ok) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (audio) audio.onerror = null;
        if (!ok) {
          try { if (audio) audio.pause(); } catch (e) { /* ignore */ }
          next();
        } else {
          _currentAudio = audio;
        }
      }
      try {
        audio = new Audio(urls[i++]);
        audio.onerror = function () { finish(false); };
        timer = setTimeout(function () { finish(false); }, 4500);
        var p = audio.play();
        if (p && p.then) p.then(function () { finish(true); }, function () { finish(false); });
        else finish(true);
      } catch (e) { finish(false); }
    }
    next();
  }

  function playPronunciation(word, accent) {
    playChain(audioUrls(word, accent));
  }

  // ---------- 数据源 ----------

  function jsonp(url, paramName, namePrefix, cb, timeout) {
    var name = namePrefix + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    var script = document.createElement('script');
    var done = false;
    var timer = setTimeout(function () { finish(null); }, timeout || 7000);

    function finish(payload) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { delete window[name]; } catch (e) { window[name] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
      cb(payload);
    }

    window[name] = finish;
    script.onerror = function () { finish(null); };
    script.src = url + '&' + paramName + '=' + name;
    (document.head || document.documentElement).appendChild(script);
  }

  /** 有道词典建议接口（JSONP 参数名 callback）：返回词性 + 中文释义 */
  function youdaoSuggest(text, cb) {
    jsonp(
      'https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=en&q=' +
        encodeURIComponent(text),
      'callback',
      '__yd_cb_',
      function (res) {
        var entries = res && res.data && res.data.entries;
        cb(Array.isArray(entries) ? entries : null);
      }
    );
  }

  /** 百度翻译词典建议接口（JSONP 参数名 cb）：k=词, v=中文释义 */
  function baiduSuggest(text, cb) {
    jsonp(
      'https://fanyi.baidu.com/sug?kw=' + encodeURIComponent(text),
      'cb',
      '__bd_cb_',
      function (res) {
        var list = res && res.data;
        cb(Array.isArray(list) ? list : null);
      }
    );
  }

  /** 英/美音标：依次尝试原形、小写、去词缀词根（复数/过去式/进行时等） */
  function fetchPhonetics(word, cb) {
    var empty = { uk: '', us: '', ukAudio: '', usAudio: '' };
    var forms = wordForms(word);

    function tryAt(idx, acc) {
      if (idx >= forms.length) { cb(acc || empty); return; }
      try {
        fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(forms[idx]))
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (arr) {
            var found = null;
            if (Array.isArray(arr) && arr.length) {
              found = { uk: '', us: '', ukAudio: '', usAudio: '' };
              for (var i = 0; i < arr.length; i++) {
                var phs = (arr[i] && arr[i].phonetics) || [];
                for (var j = 0; j < phs.length; j++) {
                  var p = phs[j] || {};
                  var audio = String(p.audio || '');
                  var text = String(p.text || '');
                  if (!found.us && /[-_]us\./i.test(audio)) { found.us = text; found.usAudio = audio; }
                  if (!found.uk && /[-_]uk\./i.test(audio)) { found.uk = text; found.ukAudio = audio; }
                }
              }
              if (!found.uk && !found.us) {
                var single = (arr[0] && arr[0].phonetic) || '';
                if (!single && arr[0] && arr[0].phonetics && arr[0].phonetics[0]) {
                  single = arr[0].phonetics[0].text || '';
                }
                found.uk = single;
              }
              if (!found.uk && !found.us) found = null;
            }
            if (found) cb(found); else tryAt(idx + 1, acc);
          })
          .catch(function () { tryAt(idx + 1, acc); });
      } catch (e) { tryAt(idx + 1, acc); }
    }

    tryAt(0, empty);
  }

  /** MyMemory 开源翻译（最后兜底） */
  function translateMemory(text, cb) {
    try {
      fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|zh-CN')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (json) {
          var got = json && json.responseData && json.responseData.translatedText;
          cb(typeof got === 'string' ? got : '');
        })
        .catch(function () { cb(''); });
    } catch (e) { cb(''); }
  }

  function lookup(text, isWord, rect) {
    var token = ++currentToken;
    var key = text.toLowerCase();
    if (cache[key]) { show(cache[key], rect); return; }

    show({ title: text, loading: true, defs: [], related: [], source: '', isWord: isWord }, rect);

    function finishData(data) {
      cache[key] = data;
      if (token !== currentToken) return; // 用户已经选了别的内容
      show(data, rect);
    }

    function withPhonetics(data) {
      data.isWord = isWord;
      if (!isWord) { finishData(data); return; }
      fetchPhonetics(text, function (ph) {
        data.uk = ph.uk;
        data.us = ph.us;
        data.ukAudio = ph.ukAudio;
        data.usAudio = ph.usAudio;
        finishData(data);
      });
    }

    function memoryFallback() {
      translateMemory(text, function (zh) {
        withPhonetics({
          title: text, loading: false, defs: zh ? [zh] : [], related: [],
          source: zh ? 'MyMemory 翻译' : '',
        });
      });
    }

    // 1) 有道词典
    youdaoSuggest(text, function (entries) {
      if (entries && entries.length) {
        var defs = [];
        var related = [];
        for (var i = 0; i < entries.length; i++) {
          var item = entries[i];
          if (!item || !item.explain) continue;
          if (i === 0) defs.push(item.explain);
          else if (related.length < 3) related.push(item.explain);
        }
        if (defs.length) {
          withPhonetics({ title: text, loading: false, defs: defs, related: related, source: '有道翻译' });
          return;
        }
      }

      // 2) 百度翻译
      baiduSuggest(text, function (list) {
        if (list && list.length) {
          var defs2 = [];
          var related2 = [];
          var lower = text.toLowerCase();
          for (var k = 0; k < list.length; k++) {
            var it = list[k];
            if (!it || !it.v) continue;
            var same = String(it.k || '').toLowerCase() === lower;
            if (same && defs2.length === 0) defs2.push(it.v);
            else if (related2.length < 3) related2.push(it.k + '：' + it.v);
          }
          if (!defs2.length && list[0] && list[0].v) defs2.push(list[0].v);
          if (defs2.length) {
            withPhonetics({ title: text, loading: false, defs: defs2, related: related2, source: '百度翻译' });
            return;
          }
        }

        // 3) MyMemory 兜底
        memoryFallback();
      });
    });
  }

  // ---------- 交互 ----------

  function readSelection() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { hide(); return; }
    var text = String(sel.toString()).replace(/\s+/g, ' ').trim();
    if (!text || text.length > 300) { hide(); return; }

    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) { hide(); return; }

    // 单个词 / 最多三个单词的短语 → 按词典查；更长按句子翻译
    var isWord = /^[A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,2}$/.test(text) && text.length <= 40;
    lookup(text, isWord, rect);
  }

  document.addEventListener('mouseup', function (e) {
    if (host.contains(e.target)) return;
    setTimeout(readSelection, 10);
  }, true);

  document.addEventListener('touchend', function (e) {
    if (host.contains(e.target)) return;
    setTimeout(readSelection, 60);
  }, true);

  document.addEventListener('mousedown', function (e) {
    if (!host.contains(e.target) && card.style.display !== 'none') hide();
  }, true);

  /** 是否有弹窗处于打开状态（限时选择 / 辨音检查） */
  function modalOpen() {
    return reciteEl.className.indexOf('show') >= 0 || pickEl.className.indexOf('show') >= 0;
  }

  /**
   * 弹窗打开期间独占键盘：
   *   在 window 捕获阶段拦截，事件不再传给播放页，
   *   避免空格键既切换释义、又触发下方句子的播放/暂停。
   */
  function captureKey(e) {
    if (!modalOpen()) return;
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (e.type !== 'keydown') return;

    // 限时选择弹窗：只响应 Esc，其余按键一律不传到页面
    if (pickEl.className.indexOf('show') >= 0) {
      if (e.key === 'Escape') { e.preventDefault(); closePicker(); }
      return;
    }

    var game = quizState;
    if (!game) return;
    var key = e.key;
    if (key === 'Escape') { e.preventDefault(); closeQuiz(); return; }
    if (game.index >= game.list.length) return;
    if (key === 'Tab') return; // 保留焦点切换
    if (key === 'ArrowLeft') { e.preventDefault(); quizGo(game.index - 1); return; }
    if (key === 'ArrowRight') { e.preventDefault(); quizGo(game.index + 1); return; }
    if (key === 'ArrowUp' || key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      game.revealed = !game.revealed;
      if (quizPaintShow) quizPaintShow();
      return;
    }
    if (key === 'ArrowDown' || key === 'm' || key === 'M') {
      e.preventDefault();
      quizStep(true);
      return;
    }
    if (key === 'n' || key === 'N') {
      e.preventDefault();
      quizStep(false);
      return;
    }
    if (key === 'Shift' || key === 'b' || key === 'B') {
      e.preventDefault();
      if (e.repeat) return;
      var cur = game.list[game.index];
      if (cur) playPronunciation(cur.word, 'us');
      return;
    }
    // 空格等按键的默认行为也不落到页面/按钮上
    if (key === ' ' || key === 'Spacebar' || key === 'Enter') e.preventDefault();
  }

  window.addEventListener('keydown', captureKey, true);
  window.addEventListener('keyup', captureKey, true);
  window.addEventListener('keypress', captureKey, true);

  document.addEventListener('keydown', function (e) {
    if (modalOpen()) return; // 弹窗期间由 captureKey 独占处理
    if (e.key === 'Escape') hide();
  });

  window.addEventListener('scroll', hide, true);

  // 首次渲染生词本（当前页面已有单词时显示在页面最下面）
  renderBook();
})();
`;

/**
 * 把划词查义 + 生词本脚本注入到精听播放页 HTML 中
 * @param html 播放页 HTML
 * @param pageTitle 目录里的标题（生词本标题与一键复制首行使用）
 * 优先插入到 </body> 前，没有 body 时追加到末尾
 */
export function injectLookup(html: string, pageTitle?: string): string {
  const titleJson = JSON.stringify(pageTitle || '').replace(/</g, '\\u003c');
  const tag = `<script>window.__vocalPageTitle=${titleJson};</script><script>${LOOKUP_SCRIPT}</script>`;
  const idx = html.search(/<\/body>/i);
  if (idx >= 0) return html.slice(0, idx) + tag + html.slice(idx);
  return html + tag;
}
