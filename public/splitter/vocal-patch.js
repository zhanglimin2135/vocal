/*
 * 本站补丁：把拆分工具播放页右上角的「分享」换成「上传到目录」
 *   点击后仍用工具自己的打包逻辑生成单文件播放页，
 *   但不再下载文件，而是把打包结果直接交给外层应用（精听目录）去命名保存。
 *   单独打开本页时（不在 iframe 里）保持原样，不生效。
 */
(function () {
  var embedded = window.parent !== window;

  /* ===== 全屏联动：勾选「滚动时吸附顶部」（音轨浮起）→ 整页全屏；取消 → 退出全屏 =====
     内嵌时由外层页面把整个「音频拆分·逐句听练」边框全屏，单独打开时退化为本页全屏 */
  function bindFullscreen() {
    var chk = document.getElementById('pinWave');
    if (!chk) return;

    chk.addEventListener('change', function () {
      if (embedded) {
        parent.postMessage({ type: 'vocal-split-fs', on: chk.checked }, location.origin);
        if (chk.checked) {
          setTimeout(function () {
            var card = chk.closest('.card');
            if (card) card.scrollIntoView({ block: 'start' });
          }, 120);
        }
        return;
      }
      if (chk.checked) {
        if (!document.fullscreenElement) {
          var p = document.documentElement.requestFullscreen({ navigationUI: 'hide' });
          if (p && p.catch) p.catch(function () {});
        }
      } else if (document.fullscreenElement) {
        var q = document.exitFullscreen();
        if (q && q.catch) q.catch(function () {});
      }
    });

    if (embedded) {
      /* 外层按 Esc 退出全屏后，同步取消勾选 */
      window.addEventListener('message', function (e) {
        if (e.origin !== location.origin) return;
        if (e.data && e.data.type === 'vocal-split-fs-exit' && chk.checked) {
          chk.checked = false;
          chk.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      return;
    }

    /* 单独打开：进入全屏时把音轨滚到顶部；Esc 退出时取消勾选 */
    document.addEventListener('fullscreenchange', function () {
      if (document.fullscreenElement) {
        var card = chk.closest('.card');
        if (card) setTimeout(function () { card.scrollIntoView({ block: 'start' }); }, 60);
      } else if (chk.checked) {
        chk.checked = false;
        chk.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  bindFullscreen();

  if (!embedded) return;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  /* 拦截一次 <a download> 点击，抓取打包好的 HTML 而不是真的下载 */
  function interceptDownload(cb) {
    var proto = HTMLAnchorElement.prototype;
    var orig = proto.click;
    var grabbed = false;
    proto.click = function () {
      var el = this;
      var href = el.href || '';
      if (!grabbed && href.indexOf('blob:') === 0) {
        grabbed = true;
        proto.click = orig;
        fetch(href)
          .then(function (r) { return r.text(); })
          .then(function (txt) { cb(txt, el.download || ''); })
          .catch(function () { cb(null, ''); });
        return; /* 不触发真正下载 */
      }
      return orig.apply(el, arguments);
    };
    setTimeout(function () {
      if (!grabbed) proto.click = orig;
    }, 15000);
  }

  function uploadCurrent() {
    var pop = document.getElementById('sharePop');
    var finished = false;
    var poll = 0;

    function done(html, filename) {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      if (pop) pop.hidden = true;
      var close = document.getElementById('shareClose');
      if (close) close.click();
      if (!html) {
        alert('打包失败：请确认已载入音频并完成分句后再试');
        return;
      }
      window.parent.postMessage({
        type: 'vocal-split-html',
        html: html,
        name: String(filename || '').replace(/\.html?$/i, ''),
      }, location.origin);
    }

    /* 工具的分享弹窗已由原按钮打开并开始打包，这里先把它藏起来 */
    setTimeout(function () { if (pop) pop.hidden = true; }, 0);

    var tries = 0;
    poll = setInterval(function () {
      var save = document.getElementById('shareSave');
      if (save && !save.disabled) {
        clearInterval(poll);
        interceptDownload(done);
        save.click();
        return;
      }
      if (++tries > 120) { /* 约 30 秒仍未打包好 */
        clearInterval(poll);
      }
    }, 250);
  }

  function patch(btn) {
    if (btn.getAttribute('data-vocal-patched')) return;
    btn.setAttribute('data-vocal-patched', '1');
    btn.textContent = '⬆️ 上传到目录';
    btn.title = '把当前拆分结果直接上传到精听目录';
    btn.addEventListener('click', uploadCurrent);
  }

  /* 词典已改为本站的在线接口，修正提示文案（原先是「需运行 server.js」） */
  function fixDictHint() {
    var chip = document.getElementById('dictChip');
    if (!chip) return;
    var sync = function () {
      var ok = /已连接/.test(chip.textContent || '');
      chip.title = ok
        ? '释义来源：有道词典（本站在线服务），整句翻译由在线翻译接口提供'
        : '在线词典暂不可用，点击重试';
    };
    new MutationObserver(sync).observe(chip, { attributes: true, childList: true, characterData: true, subtree: true });
    sync();
  }

  ready(function () {
    fixDictHint();
    var tries = 0;
    var timer = setInterval(function () {
      var btn = document.getElementById('btnShare');
      if (btn) { clearInterval(timer); patch(btn); }
      else if (++tries > 50) clearInterval(timer);
    }, 200);
  });
})();
