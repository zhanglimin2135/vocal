/**
 * 精听播放页「划词查义」注入脚本
 *
 * 背景：点击目录里的「本地网页」条目时，我们是用 Blob URL 打开「下载网页」生成的
 * 独立 HTML（内含音频与完整版文本）。那份文件是外部工具产出的，无法直接改它的源码，
 * 所以在打开前把下面这段脚本插到 </body> 之前，给它加上：
 *
 *   - 在完整版文本里选中单词 / 短语 / 句子 → 自动弹出释义卡片（无需额外点击）
 *   - 数据源优先「有道翻译」（词典 JSONP 接口，不受跨域限制）
 *   - 有道查不到时：单词补音标（dictionaryapi.dev）+ MyMemory 翻译兜底
 *   - 卡片样式尽量贴近有道词典：单词、音标、词性释义、相关释义、来源
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
    '.card{position:absolute;box-sizing:border-box;background:#fff;border-radius:14px;',
    'box-shadow:0 12px 40px rgba(15,23,42,.18),0 2px 8px rgba(15,23,42,.08);',
    'border:1px solid #e8ecf3;padding:14px 16px 12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",',
    '"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;display:none;}',
    '.head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}',
    '.title{font-size:19px;font-weight:700;line-height:1.3;word-break:break-word;}',
    '.close{border:0;background:transparent;color:#9aa4b2;font-size:20px;line-height:1;cursor:pointer;',
    'padding:0 2px;margin-top:-2px;}',
    '.close:hover{color:#4b5563;}',
    '.phonetic{margin-top:6px;font-size:13px;color:#6b7280;font-family:Georgia,"Times New Roman",serif;}',
    '.divider{height:1px;background:#eef1f6;margin:9px 0;}',
    '.def{font-size:14px;line-height:1.65;color:#374151;margin:0 0 4px;word-break:break-word;}',
    '.def b{font-weight:600;color:#111827;}',
    '.related{font-size:12px;line-height:1.6;color:#8b93a1;margin-top:6px;word-break:break-word;}',
    '.related span{color:#6b7280;}',
    '.foot{margin-top:9px;display:flex;align-items:center;justify-content:space-between;gap:8px;}',
    '.src{font-size:11px;color:#a3aab6;}',
    '.hint{font-size:12px;color:#9aa4b2;}',
    '.dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#6366f1;margin-right:6px;',
    'vertical-align:middle;animation:pulse 1s ease-in-out infinite;}',
    '@keyframes pulse{0%,100%{opacity:.35}50%{opacity:1}}'
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

  function render(data) {
    card.innerHTML = '';
    var head = el('div', 'head');
    head.appendChild(el('div', 'title', data.title));
    var close = el('button', 'close', '×');
    close.title = '关闭';
    close.onclick = hide;
    head.appendChild(close);
    card.appendChild(head);

    if (data.phonetic) card.appendChild(el('div', 'phonetic', data.phonetic));
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

  function place() {
    if (card.style.display === 'none') return;
    var w = Math.min(340, window.innerWidth - 24);
    card.style.width = w + 'px';
    var h = card.offsetHeight || 120;
    var left = Math.min(Math.max(12, lastRect.left), window.innerWidth - w - 12);
    var top = lastRect.bottom + 10;
    if (top + h > window.innerHeight - 12) top = Math.max(12, lastRect.top - h - 10);
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  var lastRect = { left: 0, top: 0, bottom: 0, right: 0 };

  function show(data, rect) {
    lastRect = rect;
    render(data);
    card.style.display = 'block';
    place();
    // 内容异步补全后高度会变化，再校正一次位置
    setTimeout(place, 60);
  }

  // ---------- 数据源 ----------

  /** 有道词典建议接口（支持 JSONP，浏览器可直接请求） */
  function youdaoSuggest(text, cb) {
    var name = '__yd_cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    var script = document.createElement('script');
    var done = false;
    var timer = setTimeout(function () { finish(null); }, 7000);

    function finish(entries) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { delete window[name]; } catch (e) { window[name] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
      cb(entries);
    }

    window[name] = function (res) {
      var entries = res && res.data && res.data.entries;
      finish(Array.isArray(entries) ? entries : null);
    };
    script.onerror = function () { finish(null); };
    script.src = 'https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=en&q=' +
      encodeURIComponent(text) + '&callback=' + name;
    (document.head || document.documentElement).appendChild(script);
  }

  /** 音标（有道接口不允许浏览器跨域，这里用开放的 dictionaryapi.dev 补音标） */
  function fetchPhonetic(word, cb) {
    try {
      fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (arr) {
          var ph = '';
          if (Array.isArray(arr) && arr.length) {
            var first = arr[0];
            if (first.phonetic) ph = first.phonetic;
            if (!ph && Array.isArray(first.phonetics)) {
              for (var i = 0; i < first.phonetics.length; i++) {
                if (first.phonetics[i] && first.phonetics[i].text) { ph = first.phonetics[i].text; break; }
              }
            }
          }
          cb(ph);
        })
        .catch(function () { cb(''); });
    } catch (e) { cb(''); }
  }

  /** MyMemory 开源翻译（句子 / 有道查不到时的兜底） */
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

    show({ title: text, loading: true, defs: [], related: [], source: '' }, rect);

    function finishData(data) {
      cache[key] = data;
      if (token !== currentToken) return; // 用户已经选了别的内容
      show(data, rect);
    }

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
        var data = { title: text, loading: false, defs: defs, related: related, phonetic: '', source: '有道翻译' };
        if (isWord) {
          fetchPhonetic(text, function (ph) {
            data.phonetic = ph || '';
            finishData(data);
          });
        } else {
          finishData(data);
        }
        return;
      }

      // 有道没有收录 → 音标 + MyMemory 兜底
      if (isWord) {
        fetchPhonetic(text, function (ph) {
          translateMemory(text, function (zh) {
            finishData({
              title: text, loading: false, phonetic: ph || '',
              defs: zh ? [zh] : [], related: [],
              source: zh ? 'MyMemory 翻译' : '',
            });
          });
        });
      } else {
        translateMemory(text, function (zh) {
          finishData({
            title: text, loading: false, phonetic: '',
            defs: zh ? [zh] : [], related: [],
            source: zh ? 'MyMemory 翻译' : '',
          });
        });
      }
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

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hide();
  });

  window.addEventListener('scroll', hide, true);
})();
`;

/**
 * 把划词查义脚本注入到精听播放页 HTML 中
 * 优先插入到 </body> 前，没有 body 时追加到末尾
 */
export function injectLookup(html: string): string {
  const tag = `<script>${LOOKUP_SCRIPT}</script>`;
  const idx = html.search(/<\/body>/i);
  if (idx >= 0) return html.slice(0, idx) + tag + html.slice(idx);
  return html + tag;
}
