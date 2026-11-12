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
    '.title{font-size:22px;font-weight:700;line-height:1.25;word-break:break-word;letter-spacing:-.2px;}',
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

  function render(data) {
    card.innerHTML = '';
    var head = el('div', 'head');
    head.appendChild(el('div', 'title', data.title));
    var close = el('button', 'close', '×');
    close.title = '关闭';
    close.onclick = hide;
    head.appendChild(close);
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

  /** 有道发音（type=1 英 / type=2 美） → 百度 TTS（lan=uk 英 / lan=en 美） */
  function audioUrls(word, accent) {
    var youdaoType = accent === 'uk' ? 1 : 2;
    var baiduLan = accent === 'uk' ? 'uk' : 'en';
    var forms = wordForms(word);
    var urls = [];
    for (var i = 0; i < forms.length; i++) {
      urls.push('https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(forms[i]) + '&type=' + youdaoType);
    }
    // 百度 TTS 兜底（用原词，百度对变形词支持较好）
    urls.push('https://fanyi.baidu.com/gettts?lan=' + baiduLan + '&text=' + encodeURIComponent(word) + '&spd=3&source=web');
    return urls;
  }

  /** 依次尝试一组音频 URL，成功即播放，全部失败则静默 */
  function playChain(urls) {
    var i = 0;
    function next() {
      if (i >= urls.length) return;
      try {
        var audio = new Audio(urls[i++]);
        audio.onerror = next;
        var p = audio.play();
        if (p && p.catch) p.catch(next);
      } catch (e) { next(); }
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
