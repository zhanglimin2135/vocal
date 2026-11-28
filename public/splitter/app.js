/* 音频拆分 · 逐句听练 —— 纯前端，本地处理 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  // 版本戳：打进分享页页脚，方便确认下载到的是不是最新模板
  var APP_VER = 'v2026-11-23.1';
  var HOP_PER_SEC = 100;          // 包络帧率：每 10ms 一帧
  var BUCKETS = 20000;            // 波形绘制桶数
  var MAX_SCHEDULE = 600;         // 单次最多排队的播放片段

  var state = {
    buf: null, fileName: '', fileSize: 0,
    srcBytes: null, srcMime: '',   // 原始音频字节（分享时打包进独立网页）
    env: null, mm: null, chans: null,
    pauses: [], boundaries: [], stops: [], lines: [],
    // edges = 句子区间的分界（决定每句播哪一段），只随文本生成/拆句变化
    // boundaries = 音轨上的切点（只作标记，不拆句子），两者互不影响
    edges: [],
    manual: false, thr: -60,
    selected: 0, zoom: 1,
    repeat: 1, gap: 0.6, rate: 1,
    trans: {},          // 句子原文 → { text: 释义, src: 来源 }
    follow: true,       // 波形跟随播放头
    pauseMode: 'hold',  // hold=在切点停住等手动 · auto=停留N秒自动继续 · off=不暂停
    pauseSec: 1
  };

  /* ---------- 工具 ---------- */
  function dur() { return state.buf ? state.buf.duration : 0; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  /* ---------- 视图窗口：缩放 / 平移 ---------- */
  var ZOOM_MAX = 4000;            // 最深放大倍数
  var view = { start: 0, span: 0 };

  function viewEnsure() {
    var D = dur();
    if (!D) { view.start = 0; view.span = 0; return; }
    view.span = clamp(D / state.zoom, 0.02, D);
    view.start = clamp(view.start, 0, Math.max(0, D - view.span));
  }
  function zoomToSlider(z) { return (Math.log10(clamp(z, 1, ZOOM_MAX)) / Math.log10(ZOOM_MAX)) * 100; }
  function sliderToZoom(v) { return Math.pow(10, (v / 100) * Math.log10(ZOOM_MAX)); }
  function fmtZoom(z) {
    return z >= 1000 ? (Math.round(z / 10) * 10) + 'x'
      : z >= 100 ? Math.round(z) + 'x'
        : z >= 10 ? z.toFixed(0) + 'x' : z.toFixed(1) + 'x';
  }
  function setZoom(z, anchorT) {
    var D = dur(); if (!D) return;
    viewEnsure();
    var oldSpan = view.span || D;
    var anchor = anchorT == null ? (view.start + oldSpan / 2) : anchorT;
    var frac = oldSpan ? (anchor - view.start) / oldSpan : 0.5;
    state.zoom = clamp(z, 1, ZOOM_MAX);
    view.span = clamp(D / state.zoom, 0.02, D);
    view.start = clamp(anchor - frac * view.span, 0, Math.max(0, D - view.span));
    syncZoomUI();
    drawStatic(); paintMini();
  }
  function panView(dt) {
    var D = dur(); if (!D) return;
    viewEnsure();
    view.start = clamp(view.start + dt, 0, Math.max(0, D - view.span));
    drawStatic(); paintMini();
  }
  function centerView(t) {
    var D = dur(); if (!D) return;
    viewEnsure();
    view.start = clamp(t - view.span / 2, 0, Math.max(0, D - view.span));
    drawStatic(); paintMini();
  }
  function syncZoomUI() {
    var el = $('#zoomR'); if (el) el.value = zoomToSlider(state.zoom);
    var lb = $('#zoomLabel'); if (lb) lb.textContent = fmtZoom(state.zoom);
  }
  // 播放时保证播放头可见（离边缘 8% 时才重新居中，避免每帧重绘）
  function ensurePlayheadVisible() {
    if (!state.buf || !$('#followPlay') || !$('#followPlay').checked) return false;
    viewEnsure();
    if (!view.span) return false;
    if (playhead == null) return false;
    var margin = view.span * 0.08;
    if (playhead < view.start + margin || playhead > view.start + view.span - margin) {
      centerView(playhead);
      return true;
    }
    return false;
  }

  /* ---------- 波形卡片：滚动时吸附到顶部（只留波形） ---------- */
  function pinTopOffset() {
    var top = document.querySelector('.top');
    return (top ? top.offsetHeight : 54) + 8;
  }

  function updateWavePin() {
    var card = $('#waveCard');
    if (!card) return;
    var off = pinTopOffset();
    if (document.documentElement.style) {
      document.documentElement.style.setProperty('--topH', off + 'px');
    }
    var cb = $('#pinWave');
    var enabled = !!state.buf && (!cb || cb.checked);
    card.classList.toggle('pinOff', !enabled);
    var pinned = false;
    if (enabled) {
      var r = card.getBoundingClientRect();
      pinned = (r.top <= off + 1.5) && (r.bottom > off + 40);
    }
    if (pinned !== card.classList.contains('pinned')) {
      card.classList.toggle('pinned', pinned);
      drawStatic();
      paintMini();
    }
    updatePinEditor();
  }

  function bindWavePin() {
    var pending = false;
    function onScroll() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; updateWavePin(); });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    if ($('#pinWave')) $('#pinWave').addEventListener('change', updateWavePin);
    updateWavePin();
  }

  /* ---------- 下滑固定时的随行断句编辑器 ---------- */
  // 波形卡片吸附顶部时，卡片内直接显示当前选中句的文本框，随时断句
  function updatePinEditor() {
    var card = $('#waveCard'), ed = $('#pinEditor'), ta = $('#pinText'), tag = $('#peTag');
    if (!ed || !ta || !tag) return;
    var i = state.selected;
    var ok = !!(card && card.classList.contains('pinned') && state.buf &&
                i != null && i >= 0 && i < state.lines.length);
    if (!ok) { ed.hidden = true; return; }
    ed.hidden = false;
    tag.textContent = '第 ' + (i + 1) + ' 句 / ' + state.lines.length;
    if (document.activeElement !== ta) {
      ta.value = state.lines[i];
      autosize(ta);
    }
  }

  function bindPinEditor() {
    var ta = $('#pinText');
    if (!ta) return;
    ta.addEventListener('input', function () {
      autosize(ta);
      var i = state.selected;
      if (i == null || i < 0 || i >= state.lines.length) return;
      var v = ta.value.replace(/\n/g, ' ');
      state.lines[i] = v;
      // 同步到对应句子卡（不整页刷新）
      var rowEl = document.querySelector('.row[data-i="' + i + '"]');
      var rt = rowEl && rowEl.querySelector('.rowText');
      if (rt) { rt.value = v; autosize(rt); }
      var durEl = rowEl && rowEl.querySelector('.rowDur');
      if (durEl) durEl.innerHTML = durCell(segments()[i], v);
      writeArea();
      saveState();
    });
    ta.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (ev.metaKey || ev.ctrlKey) splitRowAtCaret(state.selected, ta.selectionStart);
      }
    });
    // 聚焦文本框时，波形上的橙色虚影 = 播放线位置（拆分按钮就切在这里，两者绝对一致）
    var ghost = function () {
      ghostRow = state.selected;
      drawOverlay();
    };
    ['click', 'keyup', 'select', 'focus'].forEach(function (evt) { ta.addEventListener(evt, ghost); });
    ta.addEventListener('blur', function () { if (ghostRow >= 0) { ghostRow = -1; drawOverlay(); } });
    var sp = $('#peSplit');
    if (sp) sp.addEventListener('click', function () { splitRowAtCaret(state.selected, ta.selectionStart, playhead); });
  }

  /* ---------- 完成分句 · 播放页 ---------- */
  // 只保留句子播放框，其余全部隐藏；顶栏放「显示全部释义 / 分享 / 返回编辑」，
  // 播放控制条整条搬到顶栏第二行（换页时再搬回去），Esc 或「返回编辑」退出
  function setFinish(on) {
    document.body.classList.toggle('finish', !!on);
    // 播放页里句子不再可编辑（点击句子只播放，同下载页）；退出播放页恢复可编辑
    var rts = document.querySelectorAll('.rowText');
    for (var k = 0; k < rts.length; k++) rts[k].readOnly = !!on;
    if (on) {
      var ae = document.activeElement;
      if (ae && ae.classList && ae.classList.contains('rowText')) ae.blur();
    }
    var top = $('#playTop');
    if (top) top.hidden = !on;
    var bar = document.querySelector('.playbar');
    var ctrl = $('#ptCtrl');
    if (bar && ctrl) {
      if (on && bar.parentNode !== ctrl) ctrl.appendChild(bar);
      if (!on && bar.parentNode === ctrl) {
        var sec = document.querySelector('.card.block');
        var rowsEl = $('#rows');
        if (sec && rowsEl) sec.insertBefore(bar, rowsEl);
        else if (sec) sec.appendChild(bar);
      }
    }
    if (on) {
      stopPlayback(true);
      syncPlayTop();
      applyTransVisible();
      fullTextFill();
      fullUi();
      window.scrollTo(0, 0);
    } else {
      fullStop(true);
      window.scrollTo(0, 0);
    }
    // 字号在播放页变大/变小，文本框高度要按新字号重算
    if (window.requestAnimationFrame) requestAnimationFrame(function () { updateWavePin(); drawStatic(); autosizeAll(); });
    else { updateWavePin(); drawStatic(); autosizeAll(); }
  }

  // 顶栏左侧：文件名 · 句数 · 时长
  function syncPlayTop() {
    var nm = $('#ptName'), mt = $('#ptMeta');
    if (nm) nm.textContent = state.fileName || '未命名音频';
    if (mt) {
      mt.textContent = state.buf
        ? (state.lines.length + ' 句 · ' + fmt(dur()) + ' · ' + state.boundaries.length + ' 个切点')
        : '未载入音频';
    }
  }

  // 显示 / 隐藏全部释义（播放页顶栏开关，记在本机）
  function transVisible() {
    var el = $('#showTrans');
    return el ? !!el.checked : true;
  }
  function applyTransVisible() {
    document.body.classList.toggle('noTrans', !transVisible());
  }

  /* ---------- 标记：切点(hard) / 暂停点(soft) ---------- */
  // 播放时需要在这些时间点停下：所有切点 + 所有暂停点
  function pausePoints() {
    var d = dur(), out = [];
    state.boundaries.forEach(function (b) { if (b > 0.02 && b < d - 0.02) out.push(b); });
    state.stops.forEach(function (b) { if (b > 0.02 && b < d - 0.02) out.push(b); });
    out.sort(function (a, b) { return a - b; });
    var res = [];
    out.forEach(function (t) { if (!res.length || t - res[res.length - 1] > 0.02) res.push(t); });
    return res;
  }
  function stopsIn(a, b) {
    return pausePoints().filter(function (t) { return t > a + 0.05 && t < b - 0.05; });
  }
  function markExists(t) {
    var ps = pausePoints();
    for (var i = 0; i < ps.length; i++) if (Math.abs(ps[i] - t) < 0.03) return true;
    return false;
  }
  // 暂停点：只影响播放行为，不拆句子、不动文本
  function addStopAt(t) {
    if (!state.buf) return false;
    t = clamp(t, 0.05, dur() - 0.05);
    if (markExists(t)) { toast('这里已经有标记了（' + fmt(t) + '）'); return false; }
    state.stops.push(t);
    state.stops.sort(function (a, b) { return a - b; });
    state.manual = true;
    afterAlign(rowIndexAt(t));            // 只刷新暂停点所在那一行
    return true;
  }
  function addStopAtBatch(list) {
    var added = 0;
    (list || []).forEach(function (t) {
      t = clamp(t, 0.05, dur() - 0.05);
      if (markExists(t)) return;
      state.stops.push(t); added++;
    });
    if (added) { state.stops.sort(function (a, b) { return a - b; }); afterAlign(); }
    return added;
  }

  function fmt(t) {
    if (t == null || !isFinite(t)) return '';
    t = Math.max(0, t);
    var m = Math.floor(t / 60), s = t - m * 60;
    return String(m).padStart(2, '0') + ':' + s.toFixed(3).padStart(6, '0');
  }
  function parseT(v) {
    v = String(v || '').trim();
    if (!v) return null;
    if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v);
    var m = v.match(/^(\d+):([0-9.]+)$/);
    if (m) return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
    return null;
  }
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function safeName(s, max) {
    s = String(s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim();
    if (s.length > max) s = s.slice(0, max);
    return s;
  }
  function pad3(n) { return String(n).padStart(3, '0'); }

  function guessMime(name, type) {
    if (type && /^audio\//.test(type)) return type;
    var ext = (String(name || '').match(/\.([a-z0-9]+)$/i) || [])[1];
    var map = {
      mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4',
      ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
      aac: 'audio/aac', webm: 'audio/webm', aiff: 'audio/aiff', aif: 'audio/aiff'
    };
    return map[String(ext || '').toLowerCase()] || 'audio/mpeg';
  }

  /* ---------- 音频分析 ---------- */
  function computeEnvelope(buf) {
    var nc = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
    var chans = [];
    for (var c = 0; c < nc; c++) chans.push(buf.getChannelData(c));
    var hop = Math.max(1, Math.round(sr / HOP_PER_SEC));
    var frames = Math.floor(len / hop);
    var db = new Float32Array(frames);
    for (var i = 0; i < frames; i++) {
      var s0 = i * hop, e0 = Math.min(len, s0 + hop), sum = 0;
      for (var j = s0; j < e0; j++) {
        var v = 0;
        for (var c2 = 0; c2 < nc; c2++) v += chans[c2][j];
        v /= nc;
        sum += v * v;
      }
      db[i] = 20 * Math.log10(Math.sqrt(sum / Math.max(1, e0 - s0)) + 1e-12);
    }
    return { db: db, hopDur: hop / sr };
  }

  function computeMinMax(buf) {
    var nc = buf.numberOfChannels, len = buf.length;
    var chans = [];
    for (var c = 0; c < nc; c++) chans.push(buf.getChannelData(c));
    var per = len / BUCKETS;
    var mn = new Float32Array(BUCKETS), mx = new Float32Array(BUCKETS);
    for (var i = 0; i < BUCKETS; i++) {
      var s0 = Math.floor(i * per), e0 = Math.min(len, Math.floor((i + 1) * per));
      var a = 1, b = -1;
      for (var j = s0; j < e0; j++) {
        var v = 0;
        for (var c2 = 0; c2 < nc; c2++) v += chans[c2][j];
        v /= nc;
        if (v < a) a = v;
        if (v > b) b = v;
      }
      if (b < a) { a = 0; b = 0; }
      mn[i] = a; mx[i] = b;
    }
    return { mn: mn, mx: mx };
  }

  function percentile(arr, p) {
    var a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
    var i = clamp(Math.round((p / 100) * (a.length - 1)), 0, a.length - 1);
    return a[i];
  }

  function detect() {
    if (!state.buf) return;
    var env = state.env;
    var arr = Array.prototype.slice.call(env.db);
    if ($('#smooth').checked) {
      var src = arr.slice();
      for (var i = 1; i < src.length - 1; i++) arr[i] = (src[i - 1] + src[i] + src[i + 1]) / 3;
    }
    var p05 = percentile(arr, 5), p95 = percentile(arr, 95);
    var t = parseFloat($('#sens').value);
    var thr = Math.min(p05 + (p95 - p05) * t, p95 - 3);
    state.thr = thr;
    $('#waveStat').textContent = '阈值 ' + thr.toFixed(1) + ' dB · 底噪 ' + p05.toFixed(1) + ' dB · 峰值 ' + p95.toFixed(1) + ' dB';

    var hopDur = env.hopDur;
    var minSil = parseFloat($('#minSil').value) / 1000;
    var closeFrames = Math.max(1, Math.round(0.12 / hopDur));

    var flags = new Uint8Array(arr.length);
    for (var k = 0; k < arr.length; k++) flags[k] = arr[k] < thr ? 1 : 0;

    // 形态学闭运算：填补 <120ms 的粘连段
    var i2 = 0;
    while (i2 < flags.length) {
      if (flags[i2] === 0) {
        var j = i2;
        while (j < flags.length && flags[j] === 0) j++;
        if (j - i2 <= closeFrames && i2 > 0 && j < flags.length) {
          for (var m = i2; m < j; m++) flags[m] = 1;
        }
        i2 = j;
      } else i2++;
    }

    var pauses = [], s = -1;
    // 真气口验证：两侧 0.18s 内必须有明显高于阈值的语音，
    // 过滤掉"语音中间的弱音段"被误判成静音的假气口（否则切点会落在句子中间）
    var guard = Math.max(2, Math.round(0.18 / hopDur));
    var need = thr + 6;
    function voicePeak(a, b) {
      var v = -999;
      for (var k = Math.max(0, a); k <= Math.min(arr.length - 1, b); k++) if (arr[k] > v) v = arr[k];
      return v;
    }
    function realPause(si, ei) {
      var before = voicePeak(si - guard, si - 1);
      var after = voicePeak(ei + 1, ei + guard);
      return before >= need && after >= need;
    }
    for (var f = 0; f < flags.length; f++) {
      if (flags[f] === 1 && s < 0) s = f;
      if ((flags[f] === 0 || f === flags.length - 1) && s >= 0) {
        var st = s * hopDur, en = f * hopDur, d = en - st;
        if (d >= minSil && realPause(s, f)) pauses.push({ start: st, end: en, dur: d });
        s = -1;
      }
    }
    state.pauses = pauses;

    // 更短的停顿也留一份，行数多于气口时用来补切（比从中点平均切更准）
    var all = [], s2 = -1;
    for (var f2 = 0; f2 < flags.length; f2++) {
      if (flags[f2] === 1 && s2 < 0) s2 = f2;
      if ((flags[f2] === 0 || f2 === flags.length - 1) && s2 >= 0) {
        var st2 = s2 * hopDur, en2 = f2 * hopDur, d2 = en2 - st2;
        if (d2 >= 0.08 && realPause(s2, f2)) all.push({ start: st2, end: en2, dur: d2 });
        s2 = -1;
      }
    }
    state.allPauses = all;
  }

  function tailSec() { return parseFloat($('#tail').value) / 1000; }
  function boundaryPoint(p) { return p.start + Math.min(tailSec(), p.dur * 0.3); }

  // 找距离 t 最近的气口（真气口优先，短停兜底），返回落点时间；找不到返回 null
  // skipT：拖动起点的气口，不参与吸附——否则一起拖就被自己吸住，没法做小幅微调
  function nearestPauseBp(t, maxDist, skipT) {
    maxDist = maxDist == null ? 1.2 : maxDist;
    var pool = (state.pauses || []).concat(state.allPauses || []);
    var best = null, bestD = Infinity;
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (skipT != null && Math.abs(boundaryPoint(p) - skipT) < 0.03) continue;
      var d = t < p.start ? p.start - t : (t > p.end ? t - p.end : 0);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best || bestD > maxDist) return null;
    return { t: boundaryPoint(best), pause: best, dist: bestD };
  }

  // 句子区间：由 state.edges 决定，与音轨切点 state.boundaries 完全无关
  function segments() {
    var d = dur();
    if (!d) return [];
    var bs = state.edges.filter(function (b) { return b > 0.001 && b < d - 0.001; })
      .sort(function (a, b) { return a - b; });
    var pts = [0].concat(bs, [d]);
    var out = [];
    for (var i = 0; i < pts.length - 1; i++) out.push({ start: pts[i], end: pts[i + 1] });
    return out;
  }

  // 句子区间分界必须恰好比句子数少 1；文本变短时裁掉多余的
  function fitEdges() {
    var want = Math.max(0, state.lines.length - 1);
    var es = state.edges.filter(function (b) { return b > 0.001 && b < dur() - 0.001; })
      .sort(function (a, b) { return a - b; });
    if (es.length > want) es = es.slice(0, want);
    state.edges = es;
    return es;
  }

  /* ---------- 切分对齐 ---------- */
  // 文本的行数一旦变化，就强制按新行数重新划分句子区间
  function maybeAutoAlign() {
    if (!state.buf || !state.lines.length) { updateCounts(); return; }
    if (segments().length === state.lines.length) { updateCounts(); return; }
    autoAlign();
  }

  // 一句话的有效字数（去掉标点与空白），至少算 1
  function textWeight(s) {
    var t = String(s || '').replace(/\s/g, '');
    t = t.replace(/[.,!?;:，。！？；：、…‥—－–·'"“”‘’`^~～（）()\[\]{}《》〈〉【】「」『』<>\/\\|@#$%&*+=_\-]/g, '');
    var n = 0;
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) i++;      // 代理对（emoji 等）算一个字
      n++;
    }
    return Math.max(1, n);
  }

  // 语音真正的起止（去掉首尾静音），用于让切点从第一声开始算
  function speechSpan() {
    var d = dur(), env = state.env;
    if (!env || !env.db || !env.db.length || !isFinite(state.thr)) return { start: 0, end: d };
    var db = env.db, hop = env.hopDur, thr = state.thr + 3;
    var f0 = -1, f1 = -1, i;
    for (i = 0; i < db.length; i++) if (db[i] > thr) { f0 = i; break; }
    for (i = db.length - 1; i >= 0; i--) if (db[i] > thr) { f1 = i; break; }
    if (f0 < 0 || f1 <= f0) return { start: 0, end: d };
    var a = Math.max(0, f0 * hop - 0.05);
    var b = Math.min(d, (f1 + 1) * hop + 0.05);
    if (b - a < d * 0.25) return { start: 0, end: d };   // 估得不可靠就别用
    return { start: a, end: b };
  }

  // 只按文本算切点位置：按每行字数比例分配时长（这才是切点的依据）
  function textTargets() {
    var sp = speechSpan(), span = sp.end - sp.start;
    var ws = [], total = 0, i;
    for (i = 0; i < state.lines.length; i++) { ws.push(textWeight(state.lines[i])); total += ws[i]; }
    if (!total) return [];
    var acc = 0, out = [];
    for (i = 0; i < state.lines.length - 1; i++) {
      acc += ws[i];
      out.push(sp.start + span * acc / total);
    }
    return out;
  }

  // 气口只做参考：目标点附近有气口就微调到气口，否则找音量最弱处，再不行就用目标点本身
  function refineEdge(target, lo, hi) {
    var span = hi - lo;
    var win = clamp(span * 0.3, 0.35, 0.9);
    var pool = [].concat(state.pauses || [], state.allPauses || []);
    var best = null, bd = Infinity;
    for (var i = 0; i < pool.length; i++) {
      var bp = boundaryPoint(pool[i]);
      if (bp <= lo + 0.03 || bp >= hi - 0.03) continue;   // 不越过相邻分界的保护区
      var d = Math.abs(bp - target);
      if (d <= win && d < bd) { bd = d; best = bp; }
    }
    if (best != null) return best;
    // 附近没气口 → 只在小范围（±0.35s）内找音量最弱的一帧，避免跑偏
    var env = state.env;
    if (env && env.db && env.db.length) {
      var hop = env.hopDur, db = env.db, w = 0.35;
      var f0 = Math.max(0, Math.floor((target - w) / hop));
      var f1 = Math.min(db.length - 1, Math.ceil((target + w) / hop));
      var bi = -1, bv = Infinity;
      for (var f = f0; f <= f1; f++) {
        var tt = f * hop;
        if (tt <= lo + 0.02 || tt >= hi - 0.02) continue;
        var score = db[f] + (Math.abs(tt - target) / w) * 6;
        if (score < bv) { bv = score; bi = f; }
      }
      if (bi >= 0) return clamp(bi * hop, lo + 0.01, hi - 0.01);
    }
    return clamp(target, lo + 0.01, hi - 0.01);
  }

  function autoAlign(force) {
    if (!state.buf) { toast('请先载入音频'); return; }
    var n = state.lines.length, d = dur();
    if (!n) { toast('请先输入文本'); return; }
    if (n === 1) {
      state.edges = [];
      if (!state.manual || force) { state.boundaries = []; state.manual = false; }
      afterAlign();
      return;
    }

    // 每句至少要有 minSeg 秒；句子太多时自动缩小下限，保证总能切满
    var minSeg = Math.min(minSegSec(), (d / n) * 0.85);
    var targets = textTargets();
    var edges = [], prev = 0;
    for (var i = 0; i < targets.length; i++) {
      var lo = prev + minSeg;
      var hi = d - (targets.length - i) * minSeg;      // 给后面的每句留出位置
      if (hi - lo < 0.04) {                            // 时长实在不够，只能均分剩余
        var mid = prev + (d - prev) / (targets.length - i + 1);
        edges.push(clamp(mid, 0.04, d - 0.04));
        prev = edges[edges.length - 1];
        continue;
      }
      var t = refineEdge(targets[i], lo, hi);
      edges.push(t);
      prev = t;
    }
    state.edges = edges;

    // 切点只在「没手动动过」或「显式要求重新对齐」时才跟随句子分界
    if (!state.manual || force) {
      state.boundaries = state.edges.slice();
      state.manual = false;
    }
    afterAlign();
    if (force) updateCounts();
  }

  // 把所有切点吸附到最近的气口上（处理历史遗留的"语音中间"切点）
  function snapAllBoundaries() {
    if (!state.boundaries.length) { toast('还没有切点'); return; }
    // 先算好每个切点的落点（避免互相踩），再统一应用；
    // 用 applyMarkerMove 让句子分界跟着一起挪（两者一一对应）
    var plan = [], bs = state.boundaries.slice();
    for (var i = 0; i < bs.length; i++) {
      var snap = nearestPauseBp(bs[i], 1.0);
      if (!snap) continue;
      var nt = clamp(snap.t, 0.05, dur() - 0.05);
      var clash = false;
      for (var j = 0; j < plan.length; j++) {
        if (Math.abs(plan[j].to - nt) < 0.03) { clash = true; break; }
      }
      if (!clash && Math.abs(nt - bs[i]) > 0.005) plan.push({ from: bs[i], to: nt });
    }
    var moved = 0;
    for (var k = 0; k < plan.length; k++) {
      var idx = state.boundaries.indexOf(plan[k].from);
      if (idx < 0) continue;
      applyMarkerMove({ kind: 'hard', idx: idx, t: plan[k].from }, plan[k].to);
      moved++;
    }
    state.manual = true;
    afterAlign();
    toast(moved ? ('已把 ' + moved + ' 个切点吸附到气口上') : '所有切点都已在气口上，无需调整');
  }

  // 不变量：切点线 ⇄ 句子分界一一对应。
  // 分句必须有分割线：多一条句子分界就多一条切点线；没有分割线的地方就只有一句。
  function afterAlign(from) {
    if (state.buf) fitEdges();
    state.boundaries = state.edges.slice();
    renderRows(from);
    drawStatic();
    updateCounts();
    saveState();
  }

  // 改句子区间的分界（句子卡上的「起 / 止」输入框）——切点线跟着一起动
  function setBoundary(k, t) {
    var es = state.edges.slice();
    while (es.length < k + 1) es.push(0);
    var prev = k > 0 ? es[k - 1] : 0;
    var next = (k + 1 < es.length && es[k + 1] > 0) ? es[k + 1] : dur();
    es[k] = clamp(t, prev + 0.02, next - 0.02);
    state.edges = es.filter(function (b) { return b > 0; }).sort(function (a, b) { return a - b; });
    afterAlign(k);                        // 只有第 k / k+1 两句的区间变了
  }

  /* ---------- 文本 ⇄ 句子区间 ---------- */
  var PUNC = '，。！？；：、,.!?;:…—';
  function isCJK(c) { return c && /[\u3400-\u9fff\uf900-\ufaff]/.test(c); }


  function joinText(a, b) {
    a = String(a || '').trim(); b = String(b || '').trim();
    if (!a) return b;
    if (!b) return a;
    // 只有两边都是英文/数字时才补空格；中文与全角标点直接相接
    var need = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b);
    return a + (need ? ' ' : '') + b;
  }

  // 按切点时间把一句话切成两句：先吸附到标点/词边界，再退化为按比例
  function splitLineAtTime(line, seg, t) {
    line = String(line || '');
    if (!line) return ['', ''];
    var span = Math.max(0.001, seg.end - seg.start);
    var target = Math.round(line.length * clamp((t - seg.start) / span, 0.08, 0.92));

    var cut = -1, bestD = Infinity;
    for (var i = 1; i < line.length; i++) {
      var prev = line[i - 1];
      if (/\s/.test(prev) || PUNC.indexOf(prev) >= 0) {
        var d = Math.abs(i - target);
        if (d < bestD) { bestD = d; cut = i; }
      }
    }
    // 没有可用边界（比如整句无标点无空格）→ 按比例，但不切半个英文单词
    if (cut < 0 || bestD > line.length * 0.45) {
      cut = target;
      while (cut > 1 && /[A-Za-z0-9']/.test(line[cut - 1]) && /[A-Za-z0-9']/.test(line[cut])) cut--;
    }
    cut = clamp(cut, 1, line.length - 1);
    return [line.slice(0, cut).trim(), line.slice(cut).trim()];
  }

  /* ---------- 文本 Cursor 拆分：自由选位置，波形自动定位 —— */
  // 不同类型字符的"说话权重"：中文字按字计，西文按词近似的字母折算，标点/空格几乎不占时长
  function charWeight(ch) {
    if (!ch) return 0;
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(ch)) return 1;      // 中日韩汉字
    if (/[\u3040-\u30ff]/.test(ch)) return 0.9;                 // 日文假名
    if (/[A-Za-z]/.test(ch)) return 0.5;                        // 英文字母
    if (/[0-9]/.test(ch)) return 0.6;
    if (/\s/.test(ch)) return 0.12;
    if (PUNC.indexOf(ch) >= 0) return 0.25;
    return 0.5;
  }
  function weightCum(line) {
    var acc = [0], t = 0;
    for (var i = 0; i < line.length; i++) { t += charWeight(line[i]); acc.push(t); }
    return acc;
  }
  // 光标位置 → 句内时间占比（按字符权重）
  function caretRatio(line, pos) {
    line = String(line || '');
    if (!line.length) return 0.5;
    var acc = weightCum(line);
    pos = clamp(pos, 1, line.length - 1);
    var total = acc[line.length] || 1;
    return clamp(acc[pos] / total, 0.06, 0.94);
  }
  // 句内时间占比 → 光标位置（caretRatio 的逆运算，用于「按播放线拆分」时定文本断点）
  function ratioToPos(line, ratio) {
    line = String(line || '');
    if (line.length < 2) return line.length;
    var acc = weightCum(line), total = acc[line.length] || 1;
    var target = clamp(ratio, 0, 1) * total;
    for (var p = 1; p < line.length; p++) {
      if (acc[p] >= target) return (target - acc[p - 1] <= acc[p] - target) ? p - 1 : p;
    }
    return line.length - 1;
  }

  function minSegSec() {
    var el = $('#minSeg');
    var v = el ? parseFloat(el.value) : NaN;
    return isFinite(v) && v > 0 ? v : 0.35;
  }

  // 在句内把 target 吸附到真正的说话断点：优先落进气口，其次找音量最弱处
  function detectSplitTime(sg, target) {
    var minLen = Math.max(0.1, minSegSec());
    var span = sg.end - sg.start;
    if (span <= minLen * 2 + 0.05) return null;                 // 音频太短，没法在中间切
    var lo = sg.start + minLen, hi = sg.end - minLen;
    var win = Math.max(0.22, span * 0.2);

    // 1) 该句内部的静音气口（含被"最短气口"过滤掉的短停，由 allPauses 兜底）
    var pool = [].concat(state.allPauses || [], state.pauses || []);
    var best = null, bestD = Infinity;
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (!p || p.end <= sg.start || p.start >= sg.end) continue;
      var raw = (p.start + p.end) / 2;
      if (raw <= lo || raw >= hi) continue;
      var d = target < p.start ? p.start - target : (target > p.end ? target - p.end : 0);
      if (d <= win && d < bestD) { bestD = d; best = clamp(raw, lo, hi); }
    }
    if (best != null) return best;

    // 2) 没有气口 → 在包络里找局部最弱的一点（越靠近目标越优先）
    if (state.env && state.env.db && state.env.db.length) {
      var hop = state.env.hopDur, db = state.env.db;
      var f0 = Math.max(0, Math.floor((target - win) / hop));
      var f1 = Math.min(db.length - 1, Math.ceil((target + win) / hop));
      var bi = -1, bv = Infinity;
      for (var f = f0; f <= f1; f++) {
        var tt = f * hop;
        if (tt <= lo || tt >= hi) continue;
        var score = db[f] + (Math.abs(tt - target) / Math.max(win, 1e-3)) * 8;
        if (score < bv) { bv = score; bi = f; }
      }
      if (bi >= 0) return clamp(bi * hop, lo, hi);
    }
    return clamp(target, lo, hi);
  }

  // 预演：光标所在位置对应的切点时间（用于波形上的虚影提示）
  function previewSplitTime(i, pos) {
    var segs = segments(), sg = segs[i];
    var line = state.lines[i] || '';
    if (!sg || line.length < 2) return null;
    var ratio = caretRatio(line, pos);
    var target = sg.start + ratio * (sg.end - sg.start);
    return detectSplitTime(sg, target);
  }

  // 在第 i 句的 pos 字符处拆成两句：只动「文本 + 句子区间」，
  // 不在音轨上加切点（音轨切点只由手动添加）
  // 拆分句子为两句。
  //  · atTime 传了值（按钮「✂ 拆分」）→ 播放线在哪切点就在哪：不吸附气口、不找最弱处，
  //    文本断点按播放线在句内的时间占比换算；⌘/Ctrl + Enter 仍走光标位置。
  //  · 否则按光标 pos：时间上优先吸附气口，其次找最弱处（detectSplitTime）。
  function splitRowAtCaret(i, pos, atTime) {
    if (!state.buf) { toast('请先载入音频'); return false; }
    var segs = segments(), sg = segs[i];
    var line = state.lines[i] || '';
    if (!sg) { toast('第 ' + (i + 1) + ' 句还没有音频区间'); return false; }

    var t;
    if (atTime !== undefined) {
      // —— 播放线拆分：音频切点 = 播放线原样；文本断点 = 光标原样（都卡死，不挪位）——
      if (playhead == null) { toast('先把播放线放到要拆分的位置（点击波形或播放后暂停）'); return false; }
      if (playhead < sg.start - 1e-6 || playhead > sg.end + 1e-6) {
        toast('播放线（' + fmt(playhead) + '）不在第 ' + (i + 1) + ' 句内，无法按它拆分'); return false;
      }
      if (sg.end - sg.start <= Math.max(0.1, minSegSec()) * 2 + 0.05) {
        toast('这一句音频只有 ' + (sg.end - sg.start).toFixed(2) + 's，太短拆不开');
        return false;
      }
      t = clamp(playhead, sg.start + 0.05, sg.end - 0.05);
      // 光标有效就原样用它；光标没放在句内时，才按播放线在句内的占比推算一个断点
      pos = (pos == null) ? null : Math.round(pos);
      var caretOk = pos != null && pos >= 1 && pos < line.length &&
        !!line.slice(0, pos).trim() && !!line.slice(pos).trim();
      if (!caretOk) pos = ratioToPos(line, (t - sg.start) / Math.max(1e-6, sg.end - sg.start));
    } else {
      // —— 只按光标拆（⌘/Ctrl + Enter）：文本断点 = 光标原样，时间也按该位置换算，不吸附气口 ——
      if (pos == null) pos = Math.round(line.length / 2);
      pos = Math.round(pos);
      if (pos < 1 || pos >= line.length) { toast('先把光标放在要断开的位置'); return false; }
      var a0 = line.slice(0, pos), b0 = line.slice(pos);
      if (!a0.trim() || !b0.trim()) { toast('断开位置两侧都需要有内容'); return false; }
      t = clamp(sg.start + caretRatio(line, pos) * (sg.end - sg.start), sg.start + 0.05, sg.end - 0.05);
    }

    pos = clamp(Math.round(pos), 1, line.length - 1);
    var a = line.slice(0, pos), b = line.slice(pos);
    if (!a.trim() || !b.trim()) { toast('断开位置两侧都需要有内容'); return false; }

    state.lines.splice(i, 1, a.trim(), b.trim());
    // 句子多了一句 → 句子区间多一条分界；切点线跟着加在同一点（分句必须有分割线）
    var es = state.edges.slice();
    var at = 0;
    while (at < es.length && es[at] < t - 1e-6) at++;
    es.splice(at, 0, t);
    state.edges = es.sort(function (x, y) { return x - y; });

    var oldKey = normKey(line);
    if (oldKey) delete state.trans[oldKey];          // 句子被拆开，旧释义作废
    writeArea();
    afterAlign(i);                        // 第 i 句之前保持原样，不闪不重取
    select(i + 1, false);
    toast('已拆成两句 · 切点在 ' + fmt(t) + (atTime !== undefined ? '（文本按光标处断开）' : '') + '，序号已更新');
    var next = document.querySelector('.row[data-i="' + (i + 1) + '"] .rowText');
    if (next) { try { next.focus(); next.setSelectionRange(0, 0); } catch (e) { } }
    return true;
  }

  // 加切点：把切点所在的句子拆成两句（句子区间插入分界 + 文本断开），序号实时更新。
  // 点在哪切在哪，不受气口限制；snap=true（Shift 双击 / Shift + C）时吸附最近气口。
  // 失败原因在函数内 toast（调用方不再统一报「这里已经有标记了」）
  function addBoundaryAt(t, snap) {
    if (!state.buf) return false;
    t = clamp(t, 0.05, dur() - 0.05);
    if (markExists(t)) { toast('这里已经有标记了（' + fmt(t) + '）'); return false; }

    if (snap) {
      var sp = nearestPauseBp(t, 1.5);
      if (!sp) { toast('附近 1.5s 内没有气口，换别处或用不按 Shift 的自由切点'); return false; }
      t = clamp(sp.t, 0.05, dur() - 0.05);
      if (markExists(t)) { toast('该气口（' + fmt(t) + '）已经有切点了'); return false; }
    }

    // 切点落在哪个句子里
    var segs = segments();
    var idx = 0;
    for (var k = 0; k < segs.length; k++) {
      if (t >= segs[k].start && t < segs[k].end) { idx = k; break; }
    }
    var oldSeg = segs[idx] || { start: 0, end: dur() };

    state.boundaries.push(t);
    state.boundaries.sort(function (a, b) { return a - b; });
    state.manual = true;

    // 句子区间插入分界 → 该句拆成两句，后面的序号自动顺延
    var es = state.edges.slice();
    var at = 0;
    while (at < es.length && es[at] < t - 1e-6) at++;
    es.splice(at, 0, t);
    state.edges = es.sort(function (x, y) { return x - y; });

    // 文本同步断开：按切点时间在句内找断点（标点/词边界优先，否则按比例）
    if (state.lines.length && idx < state.lines.length) {
      var line = state.lines[idx] || '';
      var parts = splitLineAtTime(line, oldSeg, t);
      state.lines.splice(idx, 1, parts[0], parts[1]);
      var oldKey = normKey(line);
      if (oldKey) delete state.trans[oldKey];   // 原句释义作废，新句等手动获取
      writeArea();
    }
    afterAlign(idx);                            // 切点之前的句子不动
    return true;
  }

  // 删标记。删除切点时：若该处（±0.35s，含切点被轻微拖动过的情况）有句子分界，
  // 把前一句和后一句合并成一句，该位置不残留任何线条；
  // 附近没有句子分界（纯手动标记）则只删标记，句子不动。
  // 返回 'merge'（删切点并合并两句）| 'hard'（只删切点）| 'soft'（删暂停点）| null
  function removeBoundaryNear(t) {
    var cands = [];
    state.boundaries.forEach(function (b, i) { cands.push({ t: b, kind: 'hard', i: i }); });
    state.stops.forEach(function (b, i) { cands.push({ t: b, kind: 'soft', i: i }); });
    if (!cands.length) return null;
    var best = null, bd = Infinity;
    for (var c = 0; c < cands.length; c++) {
      var d2 = Math.abs(cands[c].t - t);
      if (d2 < bd) { bd = d2; best = cands[c]; }
    }
    if (best.kind === 'soft') {
      state.stops.splice(best.i, 1);
      state.manual = true;
      afterAlign(rowIndexAt(t));
      return 'soft';
    }
    // 切点：先删掉标记本身
    state.boundaries.splice(best.i, 1);
    state.manual = true;
    // 找该切点处的句子分界（edges 与切点重合是常态：导入时两者一起生成）
    var ei = -1, ed = Infinity;
    for (var e = 0; e < state.edges.length; e++) {
      var dd = Math.abs(state.edges[e] - best.t);
      if (dd < ed) { ed = dd; ei = e; }
    }
    if (ei >= 0 && ed <= 0.35) {
      state.edges.splice(ei, 1);           // 分界消失 → 前后两句合成一句
      var k = ei;                          // edges[e] 分隔第 e 句和第 e+1 句
      if (state.lines.length > k + 1) {
        var la = state.lines[k] || '', lb = state.lines[k + 1] || '';
        var merged = joinText(la, lb);
        state.lines.splice(k, 2, merged);
        var mk = normKey(merged);
        [normKey(la), normKey(lb)].forEach(function (key) {
          if (key && key !== mk) delete state.trans[key];   // 旧句释义作废
        });
        writeArea();
      }
      afterAlign(k);                       // 合并点之前的句子保持原样
      return 'merge';
    }
    afterAlign(rowIndexAt(t));
    return 'hard';
  }

  /* ---------- 波形绘制 ---------- */
  // 画布宽度固定 = 容器宽度，用 view 窗口决定显示哪一段时间（这样才有真正的缩放）
  function canvasSize() {
    var wrap = $('#waveWrap');
    var w = Math.max(320, wrap.clientWidth || 320);
    var card = $('#waveCard');
    var pinned = card && card.classList.contains('pinned');
    return { w: w, h: pinned ? 128 : 176 };
  }

  function drawStatic() {
    var cv = $('#wave'), wrap = $('#waveWrap');
    if (!state.buf) return;
    viewEnsure();
    var size = canvasSize(), W = size.w, H = size.h;
    var dpr = window.devicePixelRatio || 1;
    [cv, $('#ovl')].forEach(function (c) {
      if (!c) return;
      c.style.width = W + 'px'; c.style.height = H + 'px';
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    });
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    var X = function (t) { return ((t - view.start) / view.span) * W; };
    var top = 24, bot = 20, plotH = H - top - bot;
    var midY = top + plotH / 2;

    // 背景
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fafbfc'; g.fillRect(0, top, W, plotH);

    // 气口（只画可见部分）
    var vEnd = view.start + view.span;
    state.pauses.forEach(function (p) {
      if (p.end < view.start || p.start > vEnd) return;
      g.fillStyle = isUsedPause(p) ? 'rgba(16,185,129,.22)' : 'rgba(148,163,184,.14)';
      var x0 = clamp(X(p.start), -2, W + 2), x1 = clamp(X(p.end), -2, W + 2);
      g.fillRect(x0, top, Math.max(1, x1 - x0), plotH);
    });

    drawPeaks(g, W, top, plotH, midY);

    // 基线
    g.strokeStyle = '#e2e8f0'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, midY + .5); g.lineTo(W, midY + .5); g.stroke();

    drawMarks(g, X, W, H, top, bot);
    drawAxis(g, X, W, H, top, plotH, bot);
    paintMini();
    drawOverlay();
  }

  // 直接从原始采样算可视窗口的峰谷：放大到毫秒级也能看到真实波形
  function drawPeaks(g, W, top, plotH, midY) {
    var ch = state.chans, buf = state.buf;
    if (!ch || !buf) return;
    var sr = buf.sampleRate, len = buf.length, nc = ch.length;
    var s0 = Math.max(0, Math.floor(view.start * sr));
    var s1 = Math.min(len, Math.ceil((view.start + view.span) * sr));
    if (s1 - s0 < 2) { g.fillStyle = '#64748b'; g.fillRect(0, midY - .5, W, 1); return; }
    var per = (s1 - s0) / W;
    var stride = Math.max(1, Math.floor(per / 48));   // 每像素最多扫 48 个点，保证重绘够快
    var half = (plotH / 2) * 0.94;
    g.fillStyle = '#64748b';
    for (var x = 0; x < W; x++) {
      var a0 = s0 + Math.floor(x * per);
      var a1 = Math.min(s1, s0 + Math.floor((x + 1) * per));
      if (a1 <= a0) a1 = Math.min(s1, a0 + 1);
      var mn = 1, mx = -1;
      for (var i = a0; i < a1; i += stride) {
        var v = 0;
        for (var c = 0; c < nc; c++) v += ch[c][i];
        v /= nc;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (mx < mn) { mn = mx = 0; }
      var y0 = midY - mx * half, y1 = midY - mn * half;
      if (y1 - y0 < 1) { y0 = midY - .5; y1 = midY + .5; }
      g.fillRect(x, y0, 1, y1 - y0);
    }
  }

  // 句子区间编号 · 切点（红色虚线）· 暂停点（橙色 ⏸）
  // 句子区间不画分界线：句号标签 + 播放高亮已足够，波形上只出现真实标记，
  // 删除切点后该位置不会有任何残留线条
  function drawMarks(g, X, W, H, top, bot) {
    var segs = segments();
    g.font = '10px -apple-system,PingFang SC,sans-serif';
    g.textBaseline = 'middle';
    for (var i = 0; i < segs.length; i++) {
      var sx0 = X(segs[i].start), sx1 = X(segs[i].end);
      if (sx1 < -20 || sx0 > W + 20) continue;
      var label = String(i + 1), inRange = i < state.lines.length;
      g.textAlign = 'center';
      var wpx = g.measureText(label).width + 10;
      var cx = clamp((sx0 + sx1) / 2, wpx / 2, W - wpx / 2);
      g.fillStyle = inRange ? '#eef2ff' : '#eef0f3';
      g.fillRect(cx - wpx / 2, 5, wpx, 14);
      g.fillStyle = inRange ? '#4f46e5' : '#9aa3af';
      g.fillText(label, cx, 12.5);
    }
    // 手动切点：红色虚线
    state.boundaries.forEach(function (t) {
      var bx = Math.round(X(t)) + .5;
      if (bx < -2 || bx > W + 2) return;
      g.strokeStyle = '#ef4444'; g.lineWidth = 1.5;
      g.setLineDash([4, 3]);
      g.beginPath(); g.moveTo(bx, 2); g.lineTo(bx, H - bot); g.stroke();
      g.setLineDash([]);
    });
    state.stops.forEach(function (t) {
      var bx = Math.round(X(t)) + .5;
      if (bx < -2 || bx > W + 2) return;
      g.strokeStyle = '#f59e0b'; g.lineWidth = 1.5;
      g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(bx, top); g.lineTo(bx, H - bot); g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#f59e0b';
      g.fillRect(bx - 4, 4, 2.5, 9);
      g.fillRect(bx + 1.5, 4, 2.5, 9);
    });
  }

  var TICKS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
  function drawAxis(g, X, W, H, top, plotH, bot) {
    var step = TICKS[TICKS.length - 1];
    for (var q = 0; q < TICKS.length; q++) {
      if (view.span / TICKS[q] <= W / 90) { step = TICKS[q]; break; }
    }
    g.fillStyle = '#9aa3af'; g.textAlign = 'left'; g.textBaseline = 'middle';
    var vEnd = view.start + view.span;
    var guard = 0;
    for (var t = Math.ceil(view.start / step) * step; t <= vEnd + 1e-9 && guard++ < 400; t += step) {
      var tx = Math.round(X(t)) + .5;
      g.strokeStyle = '#eceff3';
      g.beginPath(); g.moveTo(tx, top + plotH); g.lineTo(tx, top + plotH + 4); g.stroke();
      g.fillText(fmtTick(t, step), tx + 3, H - 9);
    }
  }
  function fmtTick(t, step) {
    var m = Math.floor(t / 60), s = t - m * 60;
    if (step < 1) {
      var dec = step < 0.01 ? 3 : 2;
      return m + ':' + s.toFixed(dec).padStart(dec + 3, '0');
    }
    return m + ':' + String(Math.round(s)).padStart(2, '0');
  }

  // 底部总览条：整段音频 + 当前视窗位置
  function paintMini() {
    var cv = $('#mini');
    if (!cv || !state.buf || !state.mm) return;
    var wrap = $('#waveWrap');
    var W = Math.max(320, wrap.clientWidth || 320), H = 30;
    var dpr = window.devicePixelRatio || 1;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#f6f7f9'; g.fillRect(0, 0, W, H);
    var mm = state.mm, N = mm.mn.length;
    g.fillStyle = '#c9cfd8';
    for (var x = 0; x < W; x++) {
      var i0 = Math.floor((x / W) * N), i1 = Math.max(i0 + 1, Math.floor(((x + 1) / W) * N));
      var mn = 1, mx = -1;
      for (var i = i0; i < i1 && i < N; i++) {
        if (mm.mn[i] < mn) mn = mm.mn[i];
        if (mm.mx[i] > mx) mx = mm.mx[i];
      }
      if (mx < mn) { mn = mx = 0; }
      var y0 = 15 - mx * 11, y1 = 15 - mn * 11;
      if (y1 - y0 < 1) { y0 = 14.5; y1 = 15.5; }
      g.fillRect(x, y0, 1, y1 - y0);
    }
    viewEnsure();
    var D = dur(); if (!D) return;
    var vx0 = (view.start / D) * W, vx1 = ((view.start + view.span) / D) * W;
    g.fillStyle = 'rgba(79,70,229,.12)';
    g.fillRect(vx0, 0, Math.max(2, vx1 - vx0), H);
    g.strokeStyle = 'rgba(79,70,229,.8)'; g.lineWidth = 1;
    g.strokeRect(Math.round(vx0) + .5, .5, Math.max(2, Math.round(vx1 - vx0)) - 1, H - 1);
    if (playhead != null) {
      var px = Math.round((playhead / D) * W) + .5;
      g.strokeStyle = '#ef4444'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
    }
  }

  // 这个气口是否已经是句子分界了（补切时不要重复用）
  function isUsedPause(p) {
    var bp = boundaryPoint(p);
    for (var i = 0; i < state.edges.length; i++) if (Math.abs(state.edges[i] - bp) < 0.02) return true;
    return false;
  }

  var playhead = null, playingRange = null, ghostRow = -1;

  // 橙色虚影时间 = 播放线在 ghostRow 句内的位置；不在该句内则不显示（按钮也会拒绝）
  function ghostTimeForRow(i) {
    if (i == null || i < 0 || playhead == null) return null;
    var sg = segments()[i];
    if (!sg) return null;
    if (playhead < sg.start - 1e-6 || playhead > sg.end + 1e-6) return null;
    return playhead;
  }
  var hoverMark = null, dragMark = null;   // 分割线：悬停 / 拖动中

  /* ---------- 分割线（切点 / 暂停点）拖动 ---------- */
  function timeToClientX(t) {
    var cv = $('#wave');
    if (!cv) return 0;
    var rect = cv.getBoundingClientRect();
    viewEnsure();
    if (!view.span) return rect.left;
    return rect.left + ((t - view.start) / view.span) * rect.width;
  }

  // 命中测试：找出离鼠标最近的分割线（像素距离），切点优先于暂停点
  // 命中音轨上的标记：切点(hard) / 暂停点(soft)。句子区间分界不可拖，不参与命中
  function hitMarker(clientX, tol) {
    if (!state.buf) return null;
    var best = null, bd = tol || 8;
    function test(t, kind, idx) {
      if (t == null || !isFinite(t)) return;
      var d = Math.abs(timeToClientX(t) - clientX);
      if (d < bd) { bd = d; best = { kind: kind, idx: idx, t: t }; }
    }
    (state.boundaries || []).forEach(function (t, i) { test(t, 'hard', i); });
    (state.stops || []).forEach(function (t, k) { test(t, 'soft', k); });
    return best;
  }

  function snapRadius() { viewEnsure(); return clamp(view.span * 0.06, 0.12, 0.9); }
  function dragSnapOn() { var el = $('#snapDrag'); return el ? !!el.checked : true; }

  // 拖动时的位置计算：夹在相邻标记之间 + 可选吸附到最近气口
  function dragMarkerTime(mark, rawT, freeMove) {
    var d = dur();
    var lo = 0.05, hi = d - 0.05;
    if (mark.kind === 'hard') {
      var bs = state.boundaries;
      lo = Math.max(lo, (mark.idx > 0 ? bs[mark.idx - 1] : 0) + 0.05);
      hi = Math.min(hi, (mark.idx + 1 < bs.length ? bs[mark.idx + 1] : d) - 0.05);
    }
    if (hi < lo) { lo = hi = clamp(rawT, 0.05, d - 0.05); }
    var t = clamp(rawT, lo, hi), snapped = false;
    if (!freeMove && dragSnapOn()) {
      // 排除起点所在的气口，保证「小幅微调」可用；其它气口照常吸附
      var r = nearestPauseBp(t, snapRadius(), mark.t0 != null ? mark.t0 : null);
      if (r && r.t >= lo && r.t <= hi) { t = r.t; snapped = true; }
    }
    return { t: t, snapped: snapped };
  }

  // 实时写入（拖动过程中只重绘波形，不重渲染 DOM 行）
  function applyMarkerMove(mark, t) {
    if (mark.kind === 'hard') {
      var bs = state.boundaries.slice();
      if (mark.idx < 0 || mark.idx >= bs.length) return;
      var oldT = bs[mark.idx];
      bs[mark.idx] = t;
      state.boundaries = bs.sort(function (a, b) { return a - b; });
      mark.idx = state.boundaries.indexOf(t);
      // 切点对应的句子分界跟着走（加切点会拆句，两者一一对应），
      // 拖动时保持序号标签与切点一致
      var ei = -1, ed = Infinity;
      for (var e = 0; e < state.edges.length; e++) {
        var dd = Math.abs(state.edges[e] - oldT);
        if (dd < ed) { ed = dd; ei = e; }
      }
      if (ei >= 0 && ed <= 0.12) {
        var es = state.edges.slice();
        es[ei] = t;
        state.edges = es.sort(function (x, y) { return x - y; });
      }
    } else {
      var ss = (state.stops || []).slice();
      if (mark.idx < 0 || mark.idx >= ss.length) return;
      ss[mark.idx] = t;
      state.stops = ss.sort(function (a, b) { return a - b; });
      mark.idx = state.stops.indexOf(t);
    }
    state.manual = true;
  }

  function drawOverlay() {
    var cv = $('#ovl');
    if (!state.buf || !cv) return;
    viewEnsure();
    if (!view.span) return;
    var size = canvasSize(), W = size.w, H = size.h;
    var dpr = window.devicePixelRatio || 1;
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    var X = function (t) { return ((t - view.start) / view.span) * W; };

    if (playingRange && playingRange.end > view.start && playingRange.start < view.start + view.span) {
      var x0 = clamp(X(playingRange.start), -2, W + 2), x1 = clamp(X(playingRange.end), -2, W + 2);
      g.fillStyle = 'rgba(79,70,229,.10)';
      g.fillRect(x0, 0, x1 - x0, H - 20);
      g.strokeStyle = 'rgba(79,70,229,.45)'; g.lineWidth = 1;
      g.strokeRect(x0 + .5, .5, Math.max(1, x1 - x0 - 1), H - 21);
    }
    var ghostT = ghostTimeForRow(ghostRow);
    if (ghostT != null) {
      var gx = Math.round(X(ghostT)) + .5;
      if (gx >= -2 && gx <= W + 2) {
        g.strokeStyle = '#f97316'; g.lineWidth = 1.5;
        g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(gx, 0); g.lineTo(gx, H - 20); g.stroke();
        g.setLineDash([]);
        g.font = '10px -apple-system,PingFang SC,sans-serif';
        g.textAlign = 'left'; g.textBaseline = 'middle';
        var glbl = '✂ ' + fmt(ghostT);
        var gw = g.measureText(glbl).width + 8;
        var gx0 = clamp(gx + 3, 0, W - gw);
        g.fillStyle = '#f97316';
        g.fillRect(gx0, H - 32, gw, 13);
        g.fillStyle = '#fff';
        g.fillText(glbl, gx0 + 4, H - 25.5);
      }
    }
    if (playhead != null && playhead >= view.start - 0.001 && playhead <= view.start + view.span + 0.001) {
      var px = Math.round(X(playhead)) + .5;
      g.strokeStyle = '#ef4444'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H - 20); g.stroke();
      var lbl = fmt(playhead);
      g.font = '10px -apple-system,PingFang SC,sans-serif';
      var wpx = g.measureText(lbl).width + 8;
      g.fillStyle = '#ef4444';
      g.fillRect(clamp(px - wpx / 2, 0, W - wpx), 0, wpx, 13);
      g.fillStyle = '#fff';
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(lbl, clamp(px - wpx / 2, 0, W - wpx) + 4, 7);
    }
    drawMarkHandle(g, X, W, H);
  }

  // 悬停 / 拖动中的分割线：加粗高亮 + 顶部手柄 + 时间气泡
  function drawMarkHandle(g, X, W, H) {
    var mk = dragMark || hoverMark;
    if (!mk || mk.t == null) return;
    var x = Math.round(X(mk.t)) + .5;
    if (x < -4 || x > W + 4) return;
    var active = !!dragMark;
    var color = mk.kind === 'hard' ? '#ef4444' : '#f59e0b';

    g.save();
    g.strokeStyle = color;
    g.lineWidth = active ? 2.5 : 2;
    g.globalAlpha = active ? 1 : .75;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H - 20); g.stroke();
    g.globalAlpha = 1;

    // 顶部手柄（横向双箭头，提示可左右拖）
    var hy = 20.5, hw = 7;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, hy - 6); g.lineTo(x + 6, hy); g.lineTo(x, hy + 6); g.lineTo(x - 6, hy);
    g.closePath(); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 1;
    g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x - hw + 1, hy); g.lineTo(x - 2, hy);
    g.moveTo(x + 2, hy); g.lineTo(x + hw - 1, hy);
    g.stroke();
    g.beginPath();
    g.moveTo(x - hw + 1, hy); g.lineTo(x - hw + 3.5, hy - 2.2);
    g.moveTo(x - hw + 1, hy); g.lineTo(x - hw + 3.5, hy + 2.2);
    g.moveTo(x + hw - 1, hy); g.lineTo(x + hw - 3.5, hy - 2.2);
    g.moveTo(x + hw - 1, hy); g.lineTo(x + hw - 3.5, hy + 2.2);
    g.stroke();

    // 时间气泡
    var lbl = (mk.kind === 'hard' ? '切点 ' : '暂停 ') + fmt(mk.t);
    if (active && mk.snapped) lbl += ' · 吸附气口';
    g.font = '10px -apple-system,PingFang SC,sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    var bw = g.measureText(lbl).width + 10;
    var bx = clamp(x + 8, 0, Math.max(0, W - bw));
    var by = active ? 34 : 34;
    g.fillStyle = color;
    g.fillRect(bx, by, bw, 15);
    g.fillStyle = '#fff';
    g.fillText(lbl, bx + 5, by + 8);
    g.restore();
  }

  /* ---------- 播放 ---------- */
  var ctx = null, sources = [], schedule = [], rafId = null, curRow = -1;
  var pausedAt = null;
  var rowBars = [], lastBarIdx = -1;

  /* 播放队列：一句可能被内部的暂停点切成多个 unit，队列逐个 unit 播放 */
  var queue = [], qi = 0, groupLen = 0;
  var holding = false, pendingIdx = -1, holdTimer = null, activeRow = -1;

  function pauseMode() {
    var el = $('#pauseMode');
    return el ? el.value : (state.pauseMode || 'hold');
  }
  function pauseSec() {
    var el = $('#pauseSec');
    return el ? Math.max(0, parseFloat(el.value) || 0) : state.pauseSec;
  }

  function isRunning() { return rafId !== null; }
  function isHolding() { return holding; }
  function nextPendingRow() { return (!holding && !isRunning() && pendingIdx >= 0) ? activeRow : -1; }

  function setRowProgress(i, frac) {
    if (lastBarIdx >= 0 && rowBars[lastBarIdx]) rowBars[lastBarIdx].style.width = '0%';
    lastBarIdx = i;
    if (i >= 0 && rowBars[i]) rowBars[i].style.width = Math.round(clamp(frac, 0, 1) * 100) + '%';
  }

  function updateTimeNow(paused) {
    var p = playhead == null ? 0 : playhead;
    var tail = '';
    if (paused === 'pause') tail = ' · 切点暂停（空格继续）';
    else if (paused) tail = ' · 已暂停';
    else if (isRunning()) tail = ' · 播放中';
    var txt = fmt(p) + ' / ' + fmt(dur()) + tail;
    var el = $('#timeNow'); if (el) el.textContent = txt;
    var el2 = $('#timeNowTop'); if (el2) el2.textContent = txt;
  }

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function stopPlayback(silent) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    for (var i = 0; i < sources.length; i++) { try { sources[i].stop(0); } catch (e) { } }
    sources = []; schedule = [];
    setPlayingRow(-1);
    setRowProgress(-1, 0);
    playingRange = null;
    if (!silent) {                       // 用户点了「停止」：清掉排队状态
      pausedAt = null;
      holding = false; pendingIdx = -1; queue = []; qi = 0; groupLen = 0; activeRow = -1;
      playhead = null;
      paintMini();
    }
    drawOverlay();
    updateTimeNow(holding ? 'pause' : false);
    refreshRowButtons();
  }

  /* 音轨弹窗（pinned）时：把第 i 句滚到可视区正中，上方自然留出已拆好的句子；
     非弹窗状态保持原来的「就近显示」行为 */
  function focusRowIfPinned(i) {
    var card = document.getElementById('waveCard');
    if (!card || !card.classList.contains('pinned') || i < 0) return false;
    var run = function () {
      var row = document.querySelector('.row[data-i="' + i + '"]');
      if (!row) return;
      var cb = card.getBoundingClientRect().bottom;
      var top = Math.max(0, Math.min(cb, window.innerHeight * 0.6));
      var r = row.getBoundingClientRect();
      var targetY = top + (window.innerHeight - top) / 2;
      var delta = (r.top + r.height / 2) - targetY;
      if (Math.abs(delta) < 6) return;
      try { window.scrollBy({ top: delta, behavior: 'smooth' }); }
      catch (e) { window.scrollBy(0, delta); }
    };
    if (window.requestAnimationFrame) requestAnimationFrame(run); else run();
    return true;
  }

  function setPlayingRow(i) {
    if (curRow === i) return;
    var rows = document.querySelectorAll('.row');
    if (rows[curRow]) rows[curRow].classList.remove('playing');
    curRow = i;
    if (i >= 0 && rows[i]) {
      rows[i].classList.add('playing');
      if (!focusRowIfPinned(i)) {
        try { rows[i].scrollIntoView({ block: 'nearest' }); } catch (e) { }
      }
    }
    fullMark(i);                    // 完整版文本里同步高亮同一句
    refreshRowButtons();
  }

  // 每句播放按钮的状态：播放中=⏸暂停 · 停在切点上=▶继续 · 其余=▶播放
  function refreshRowButtons() {
    var rows = document.querySelectorAll('.row');
    for (var i = 0; i < rows.length; i++) {
      var btn = rows[i].querySelector('.playBtn');
      if (!btn) continue;
      var playing = (curRow === i && isRunning());
      var waiting = holding && queue[pendingIdx] && queue[pendingIdx].row === i;
      var resume = !isRunning() && !holding && activeRow === i && pendingIdx >= 0 && pausedAt != null;
      rows[i].classList.toggle('waiting', !!waiting);
      btn.textContent = playing ? '⏸ 暂停' : ((waiting || resume) ? '▶ 继续' : '▶ 播放');
    }
  }

  /* 把待播句子展开为 unit 队列：句内的暂停点会把一句切成若干段，每段是一个 unit */
  function unitsFor(list, repeat) {
    var segs = segments(), out = [];
    repeat = Math.max(1, repeat || 1);
    for (var r = 0; r < repeat; r++) {
      for (var k = 0; k < list.length; k++) {
        var row = list[k], sg = segs[row];
        if (!sg) continue;
        var cuts = stopsIn(sg.start, sg.end);
        var pts = [sg.start].concat(cuts, [sg.end]);
        for (var j = 0; j < pts.length - 1; j++) {
          if (pts[j + 1] - pts[j] < 0.02) continue;
          out.push({ row: row, s: pts[j], e: pts[j + 1] });
        }
      }
    }
    return out;
  }

  function startQueue(q, idx, offset) {
    queue = q; holding = false; pendingIdx = -1;
    playGroup(idx || 0, offset || 0);
  }

  function playGroup(idx, offset) {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (idx < 0 || idx >= queue.length) { stopPlayback(true); return; }
    qi = idx;
    var unit = queue[idx];
    var s = clamp(unit.s + (offset || 0), unit.s, unit.e - 0.01);
    activeRow = unit.row;
    var items = [{ row: unit.row, s: s, e: unit.e, gapAfter: 0 }];
    if (pauseMode() === 'off') {
      // 不暂停：后面的片段一次性排好，句间只留「间隔」秒静音
      for (var k = idx + 1; k < queue.length && (k - idx) < MAX_SCHEDULE; k++) {
        items.push({ row: queue[k].row, s: queue[k].s, e: queue[k].e, gapAfter: state.gap });
      }
      for (var m = 0; m < items.length - 1; m++) items[m].gapAfter = state.gap;
    }
    if (!startSources(items)) { toast('播放失败'); return; }
    pendingIdx = -1;
    if (unit.row >= 0) select(unit.row, false);
    ensurePlayheadVisible();
    refreshRowButtons();
  }

  // 一段播完 → 看下一个 unit：按「切点暂停」策略决定停住 / 等待 / 继续
  function handleGroupDone() {
    var nextIdx = qi + schedule.length;
    if (nextIdx >= queue.length) {
      var lastU = queue[queue.length - 1];
      stopPlayback(true);
      playhead = lastU ? lastU.e : playhead;
      queue = []; pendingIdx = -1; activeRow = -1; pausedAt = null;
      ensurePlayheadVisible();
      drawOverlay(); paintMini(); updateTimeNow(); refreshRowButtons();
      return;
    }
    playhead = queue[nextIdx].s;          // 停在切点上
    pendingIdx = nextIdx;
    stopPlayback(true);
    playhead = queue[nextIdx].s;
    var mode = pauseMode();
    if (mode === 'hold') {
      holding = true;
      setPlayingRow(queue[nextIdx].row);
      ensurePlayheadVisible();
      drawOverlay(); paintMini(); updateTimeNow('pause'); refreshRowButtons();
      toast('⏸ 已在切点暂停 · 按空格继续');
      return;
    }
    holding = false;
    ensurePlayheadVisible();
    drawOverlay(); paintMini();
    updateTimeNow(true); refreshRowButtons();
    var wait = mode === 'auto' ? Math.max(state.gap, pauseSec()) : state.gap;
    if (wait > 0) holdTimer = setTimeout(function () { holdTimer = null; playGroup(nextIdx, 0); }, wait * 1000);
    else playGroup(nextIdx, 0);
  }

  function resumePlay() {
    if (holding && pendingIdx >= 0) {
      holding = false;
      var idx = pendingIdx; pendingIdx = -1;
      playGroup(idx, 0);
      toast('▶ 继续');
      return true;
    }
    if (!isRunning() && queue.length && pendingIdx >= 0 && pausedAt != null) {
      var u = queue[pendingIdx];
      var from = pausedAt;
      var off = clamp(from - u.s, 0, Math.max(0, u.e - u.s - 0.01));
      pausedAt = null;
      playGroup(pendingIdx, off);
      toast('▶ 继续');
      return true;
    }
    return false;
  }

  function playRows(list) {
    if (!state.buf) { toast('请先载入音频'); return; }
    if (!list.length) return;
    readControls();
    var q = unitsFor(list, state.repeat);
    if (!q.length) { toast('这一句还没有对应的音频区间'); return; }
    pausedAt = null;
    playhead = q[0].s;
    ensurePlayheadVisible();
    startQueue(q, 0, 0);
  }

  // 从任意时间点开始按句播放（空格 / 波形定位用），同样会在切点处停下
  function playFrom(t) {
    if (!state.buf) { toast('请先载入音频'); return; }
    readControls();
    var D = dur();
    t = clamp(t || 0, 0, Math.max(0, D - 0.02));
    var segs = segments(), row = -1;
    for (var i = 0; i < segs.length; i++) if (t >= segs[i].start && t < segs[i].end) { row = i; break; }
    if (row < 0) row = 0;
    var list = rowSequence(row);
    if (!list.length) { toast('没有可播放的句子'); return; }
    var q = unitsFor(list, state.repeat);
    if (!q.length) { toast('这一句还没有对应的音频区间'); return; }
    var idx = 0;
    for (var k = 0; k < q.length; k++) if (t < q[k].e - 0.005) { idx = k; break; }
    pausedAt = null;
    playhead = t;
    startQueue(q, idx, Math.max(0, t - q[idx].s));
  }

  function pausePlayback() {
    if (!isRunning()) return;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    var pos = playhead;
    stopPlayback(true);
    pausedAt = pos;
    playhead = pos;
    pendingIdx = qi;
    activeRow = queue[qi] ? queue[qi].row : -1;
    ensurePlayheadVisible();
    drawOverlay(); paintMini(); updateTimeNow(true); refreshRowButtons();
    toast('⏸ 暂停');
  }

  function togglePlay() {
    if (isRunning()) { pausePlayback(); return; }
    if (holding || (queue.length && pendingIdx >= 0)) { if (resumePlay()) return; }
    var start = (pausedAt != null) ? pausedAt : (playhead != null ? playhead : 0);
    if (start >= dur() - 0.02) start = 0;
    playFrom(start);
    toast('▶ 播放');
  }

  function seekTo(t) {
    if (!state.buf) return;
    var running = isRunning() || holding;
    stopPlayback(true);
    queue = []; pendingIdx = -1; holding = false; activeRow = -1;
    pausedAt = null;
    playhead = clamp(t, 0, dur());
    var ri = rowIndexAt(playhead);
    if (ri >= 0) select(ri, false);
    ensurePlayheadVisible();
    drawOverlay(); paintMini(); updateTimeNow();
    if (running) playFrom(playhead);
  }

  function rowIndexAt(t) {
    var segs = segments();
    for (var i = 0; i < segs.length; i++) {
      if (t >= segs[i].start && t < segs[i].end) return i < state.lines.length ? i : -1;
    }
    return -1;
  }

  /* ---------- 播放页底部：完整版文本（不分句）· 整段连播 ---------- */
  // 和逐句播放完全分开：一条 source 从头放到尾，不在切点 / 暂停点停
  var fullSrc = null, fullRaf = null, fullOn = false, fullActive = false;
  var fullPos = 0, fullStart = 0, fullBase = 0, fullRate = 1;
  var fullRow = -1, fullKey = '';

  // 把各句拼回完整版：英文之间补空格，中文直接相接
  function fullParts() {
    var arr = [];
    for (var i = 0; i < state.lines.length; i++) {
      var s = String(state.lines[i] || '').trim();
      if (s) arr.push({ i: i, t: s });
    }
    return arr;
  }
  function fullText() {
    var arr = fullParts(), out = '';
    for (var k = 0; k < arr.length; k++) {
      if (!out) { out = arr[k].t; continue; }
      var prev = out.charAt(out.length - 1), next = arr[k].t.charAt(0);
      out += ((prev.charCodeAt(0) < 128 && next.charCodeAt(0) < 128) ? ' ' : '') + arr[k].t;
    }
    return out;
  }

  // 渲染成「一句一个 span」，播放到哪句就给哪个 span 加高亮
  function fullTextFill() {
    var box = $('#fullTextArea');
    if (!box) return;
    var arr = fullParts();
    var key = arr.map(function (a) { return a.i + '\u0001' + a.t; }).join('\u0002');
    if (key === fullKey) { fullMark(fullRow); return; }
    fullKey = key;
    while (box.firstChild) box.removeChild(box.firstChild);
    for (var k = 0; k < arr.length; k++) {
      var sp = document.createElement('span');
      sp.className = 'fs';
      sp.setAttribute('data-i', arr[k].i);
      sp.textContent = arr[k].t;
      box.appendChild(sp);
      var nx = arr[k + 1];
      if (nx) {
        var a = arr[k].t.charAt(arr[k].t.length - 1), b = nx.t.charAt(0);
        if (a.charCodeAt(0) < 128 && b.charCodeAt(0) < 128) box.appendChild(document.createTextNode(' '));
      }
    }
    fullMark(fullRow, true);   // 重建后重新套上高亮
  }

  // 高亮「正在读的那一句」；i = -1 取消高亮
  function fullMark(i, force) {
    var box = $('#fullTextArea');
    if (!box) { fullRow = i; return; }
    if (i === fullRow && !force) return;
    fullRow = i;
    var cur = box.querySelectorAll('.fs.cur');
    for (var k = 0; k < cur.length; k++) cur[k].classList.remove('cur');
    if (i < 0) return;
    var el = box.querySelector('.fs[data-i="' + i + '"]');
    if (!el) return;
    el.classList.add('cur');
    // 只有「整段连播」才跟随滚动到全文区；逐句播放只同步高亮，不把页面拽到最下面的全文
    if ((fullOn || fullActive) && document.body.classList.contains('finish')) {
      try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { }
    }
  }

  // 当前播放位置落在哪一句
  function fullRowAt(t) {
    var segs = segments();
    for (var i = 0; i < segs.length; i++) {
      if (t >= segs[i].start && t < segs[i].end) return i < state.lines.length ? i : -1;
    }
    return segs.length ? state.lines.length - 1 : -1;
  }

  function fullUi() {
    var b = $('#fbPlay');
    if (b) b.textContent = fullOn ? '⏸ 暂停' : (fullPos > 0.05 ? '▶ 继续' : '▶ 播放完整音频');
    var t = $('#fbTime');
    if (t) t.textContent = fmt(fullPos) + ' / ' + fmt(dur());
    var f = $('#fbFill');
    if (f) f.style.width = (dur() ? clamp(fullPos / dur(), 0, 1) * 100 : 0).toFixed(1) + '%';
  }

  function fullStopNode() {
    if (fullRaf) { cancelAnimationFrame(fullRaf); fullRaf = null; }
    if (fullSrc) {
      try { fullSrc.onended = null; fullSrc.stop(0); } catch (e) { }
      fullSrc = null;
    }
  }

  function fullStop(reset) {
    fullStopNode();
    fullOn = false; fullActive = false;
    if (reset) fullPos = 0;
    fullMark(-1);
    fullUi();
  }

  function fullPlay(from) {
    if (!state.buf) { toast('请先载入音频'); return; }
    readControls();
    // 整段连播和逐句播放互斥：先把逐句队列停掉（不动播放头）
    stopPlayback(true);
    queue = []; pendingIdx = -1; holding = false; activeRow = -1;
    fullStopNode();
    var c = ac();
    var start = clamp(from == null ? fullPos : from, 0, Math.max(0, dur() - 0.02));
    fullRate = state.rate || 1;
    var src = c.createBufferSource();
    src.buffer = state.buf;
    src.playbackRate.value = fullRate;
    src.connect(c.destination);
    src.onended = function () {
      if (!fullOn) return;
      fullOn = false; fullActive = false; fullPos = 0;
      fullStopNode();
      fullMark(-1);
      fullUi();
    };
    fullBase = c.currentTime;
    fullStart = start;
    fullPos = start;
    try { src.start(0, start); } catch (e) { toast('播放失败'); return; }
    fullSrc = src;
    fullOn = true; fullActive = true;
    if (fullRaf) cancelAnimationFrame(fullRaf);
    fullRaf = requestAnimationFrame(fullTick);
    fullMark(fullRowAt(start));
    fullUi();
  }

  function fullTick() {
    fullRaf = null;
    if (!fullOn || !ctx) return;
    var p = fullStart + (ctx.currentTime - fullBase) * fullRate;
    var D = dur();
    if (p >= D - 0.01) {
      fullOn = false; fullActive = false; fullPos = 0;
      fullStopNode(); fullMark(-1); fullUi();
      return;
    }
    fullPos = p;
    fullMark(fullRowAt(p));      // 读到哪句就高亮哪句
    fullUi();
    fullRaf = requestAnimationFrame(fullTick);
  }

  function fullPause() {
    if (!fullOn) return;
    var p = fullStart + (ctx.currentTime - fullBase) * fullRate;
    fullStopNode();
    fullOn = false;
    fullPos = clamp(p, 0, dur());
    fullUi();
  }

  function fullToggle() {
    if (fullOn) fullPause();
    else fullPlay(fullPos >= dur() - 0.05 ? 0 : fullPos);
  }

  function readControls() {
    state.repeat = parseInt($('#repeat').value, 10) || 1;
    state.gap = Math.max(0, parseFloat($('#gap').value) || 0);
    state.rate = parseFloat($('#rate').value) || 1;
  }

  function startSources(items) {
    stopPlayback(true);
    if (fullActive) fullStop(true);          // 逐句播放开始 → 停掉整段连播
    var c = ac();
    var rate = state.rate;
    var t = c.currentTime + 0.05;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var d = Math.max(0.02, it.e - it.s);
      if (schedule.length >= MAX_SCHEDULE) break;
      var src = c.createBufferSource();
      src.buffer = state.buf;
      src.playbackRate.value = rate;
      var gain = c.createGain();
      gain.gain.value = 1;
      src.connect(gain);
      gain.connect(c.destination);
      try { src.start(t, it.s, d); }
      catch (e) { console.warn(e); continue; }
      sources.push(src);
      schedule.push({ row: it.row, t0: t, t1: t + d / rate, s: it.s, e: it.e });
      t += d / rate + (it.gapAfter || 0);
    }
    if (!schedule.length) return false;
    playingRange = { start: schedule[0].s, end: schedule[0].e };
    updateTimeNow();
    rafId = requestAnimationFrame(tick);
    return true;
  }

  function tick() {
    var now = ctx.currentTime;
    var found = null;
    for (var i = 0; i < schedule.length; i++) {
      var it = schedule[i];
      if (now >= it.t0 && now < it.t1) { found = it; break; }
    }
    if (found) {
      playhead = found.s + (now - found.t0) * state.rate;
      playingRange = { start: found.s, end: found.e };
      var frac = (playhead - found.s) / Math.max(0.001, found.e - found.s);
      if (found.row >= 0) { setPlayingRow(found.row); setRowProgress(found.row, frac); }
      else {
        var ri = rowIndexAt(playhead);
        var sg = segments()[ri];
        setPlayingRow(ri);
        setRowProgress(ri, sg ? (playhead - sg.start) / Math.max(0.001, sg.end - sg.start) : 0);
      }
    } else {
      setPlayingRow(-1);
      setRowProgress(-1, 0);
      playingRange = null;
      for (var j = 0; j < schedule.length; j++) {
        if (schedule[j].t0 > now) { playhead = schedule[j].s; break; }
      }
    }
    drawOverlay();
    updateTimeNow();
    var lastIt = schedule[schedule.length - 1];
    if (now >= lastIt.t1 + 0.02) { handleGroupDone(); return; }
    ensurePlayheadVisible();
    rafId = requestAnimationFrame(tick);
  }

  function rowSequence(from) {
    var arr = [];
    for (var i = from; i < state.lines.length; i++) arr.push(i);
    return arr;
  }

  function playRow(i, movePlayhead) {
    if (!segments()[i]) { toast('第 ' + (i + 1) + ' 句还没有音频区间'); return; }
    readControls();
    var q = unitsFor([i], state.repeat);
    if (!q.length) { toast('这一句还没有对应的音频区间'); return; }
    pausedAt = null;
    var off = 0;
    if (movePlayhead !== false) playhead = q[0].s;
    else off = Math.max(0, (playhead || 0) - q[0].s);
    select(i, false);
    startQueue(q, 0, off);
  }

  // 每句的 ▶/⏸：正在播这一句时是「暂停」，再按从暂停的位置接着播
  function toggleRow(i) {
    if (isRunning() && curRow === i) { pausePlayback(); return; }
    if (holding && queue[pendingIdx] && queue[pendingIdx].row === i) { resumePlay(); return; }
    if (!isRunning() && !holding && activeRow === i && pendingIdx >= 0 && pausedAt != null) { resumePlay(); return; }
    playRow(i);
  }

  function select(i, doPlay) {
    state.selected = i;
    var rows = document.querySelectorAll('.row');
    for (var k = 0; k < rows.length; k++) rows[k].classList.toggle('sel', k === i);
    updatePinEditor();
    focusRowIfPinned(i);    // 音轨弹窗时：当前操作/拆分的句子保持在页面中间
    if (doPlay) playRow(i);
  }

  /* ---------- 行渲染 ---------- */
  var syncing = false;
  var alignTimer = null;

  // 文本框 → 行：空行（只有空格/制表符也算）直接忽略，只保留有文字的行
  function parseLines(str) {
    var arr = String(str || '').replace(/\r/g, '').split('\n');
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var s = arr[i].replace(/[\t ]+$/, '');
      if (!s.trim()) continue;          // 空行 / 纯空白行 → 跳过
      out.push(s);
    }
    return out;
  }

  // 粘贴/导入用：去掉空行，返回 { text, dropped }
  function stripBlankLines(str) {
    var arr = String(str || '').replace(/\r/g, '').split('\n');
    var keep = [], dropped = 0;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].trim()) keep.push(arr[i]);
      else if (i < arr.length - 1) dropped++;   // 结尾那个换行不算"空行"
    }
    return { text: keep.join('\n'), dropped: dropped };
  }

  // 行 → 文本框（保留光标位置，只在非用户编辑时调用）
  function writeArea() {
    var el = $('#linesText');
    var pos = el.selectionStart || 0;
    syncing = true;
    el.value = state.lines.join('\n');
    try { el.setSelectionRange(Math.min(pos, el.value.length), Math.min(pos, el.value.length)); } catch (e) { }
    syncing = false;
  }

  /* ---------- 按句末标点自动分句 ---------- */
  var CLOSERS = '"\'”’）)》】」』」』」\]]';
  var ABBREV = ('mr mrs ms dr prof sr jr st vs etc eg ie inc ltd co no fig vol ch ' +
    'jan feb mar apr jun jul aug sep sept oct nov dec mon tue wed thu fri sat sun ' +
    'us uk usa un eu').split(' ');

  var ELLIPSIS = '…⋯';

  function isCloser(c) { return CLOSERS.indexOf(c) >= 0; }
  function isEll(c) { return ELLIPSIS.indexOf(c) >= 0; }

  // 英文句号要不要断：排除小数 / 缩写 / 句内点号
  function shouldBreak(line, i, c) {
    if (c !== '.' && c !== '．') return true;
    var prev = i > 0 ? line[i - 1] : '';
    var j = i + 1;
    while (j < line.length && /\s/.test(line[j])) j++;
    var nx = j < line.length ? line[j] : '';
    if (/[0-9]/.test(prev) && /[0-9]/.test(nx)) return false;         // 3.14
    if (/[a-z]/.test(nx)) return false;                               // e.g. this / foo. bar
    if (/[a-zA-Z]/.test(prev)) {
      var w = '', p = i;
      while (p > 0 && /[a-zA-Z]/.test(line[p - 1])) { w = line[p - 1] + w; p--; }
      if (w && ABBREV.indexOf(w.toLowerCase()) >= 0) return false;    // Mr. / etc.
      if (w && w.length <= 4 && w === w.toUpperCase()) return false;  // U.S. / A.B.
    }
    if (nx && /[，、；：,;:%）)\]】》」』"'”’]/.test(nx)) return false;
    return true;
  }

  // 分句口径：period = 只按句末标点；clause = 句末标点 + 逗号 都断开
  var COMMA = '，,';
  function punctMode() {
    var el = $('#punctMode');
    return el && el.value === 'clause' ? 'clause' : 'period';
  }
  // 按钮文案跟着口径变
  function syncPunctUI() {
    var b = $('#btnSplitPunct');
    if (!b) return;
    var clause = punctMode() === 'clause';
    b.textContent = clause ? '按句号 + 逗号分句' : '按句号分句';
    b.title = clause
      ? '按 。！？… . ! ? ，, 把长文本拆成一句一行'
      : '按 。！？… . ! ? 把长文本拆成一句一行';
  }

  // 把长文本按照 。！？… . ! ? 拆成一句一行（clause 模式再加逗号）
  function splitByPunct(str, mode) {
    var clause = (mode || punctMode()) === 'clause';
    var out = [];
    String(str || '').replace(/\r/g, '').split('\n').forEach(function (line) {
      var buf = '', i = 0, n = line.length;
      function flush() { var s = buf.trim(); if (s) out.push(s); buf = ''; }
      while (i < n) {
        var c = line[i];
        // 省略号：…… / ⋯ / ...（连续点号）
        if (isEll(c) || (c === '.' && /^\.{2,}/.test(line.slice(i)))) {
          var e = i;
          while (e < n && (isEll(line[e]) || line[e] === '.')) e++;
          buf += line.slice(i, e);
          i = e;
          while (i < n && isCloser(line[i])) { buf += line[i]; i++; }
          flush();
          continue;
        }
        if ('。．！？!?'.indexOf(c) >= 0 || c === '.' || c === '!' || c === '?') {
          buf += c;
          var brk = shouldBreak(line, i, c);
          i++;
          if (brk) {
            while (i < n && isCloser(line[i])) { buf += line[i]; i++; }
            flush();
          }
          continue;
        }
        // clause 模式：逗号也断开（数字里的千分位逗号不断）
        if (clause && COMMA.indexOf(c) >= 0) {
          var pv = i > 0 ? line[i - 1] : '', nx = i + 1 < n ? line[i + 1] : '';
          if (!(/[0-9]/.test(pv) && /[0-9]/.test(nx))) {
            buf += c; i++;
            while (i < n && isCloser(line[i])) { buf += line[i]; i++; }
            flush();
            continue;
          }
        }
        buf += c; i++;
      }
      flush();
    });
    return out;
  }

  // 统一的文本入口：行数变了就重新划分句子区间（不会覆盖手动加的音轨切点）
  function applyText(str, opts) {
    opts = opts || {};
    var prev = state.lines.length;
    state.lines = parseLines(str);
    if (opts.writeBack !== false) writeArea();
    renderRows();
    if (!state.buf) { updateCounts(); return; }
    clearTimeout(alignTimer);
    var countChanged = prev !== state.lines.length;
    alignTimer = setTimeout(function () {
      var auto = $('#autoSync') ? $('#autoSync').checked : true;
      if (!state.lines.length) {                 // 文本被清空：标记一起清掉，不弹「请先输入文本」
        state.edges = [];
        if (!state.manual) state.boundaries = [];
        drawStatic();
        updateCounts();
        saveState();
        return;
      }
      if (countChanged) {
        if (auto) {
          autoAlign();   // 行数变了 → 按新的文本重新分配切点（保留已手动加的切点）
          toast('文本 ' + state.lines.length + ' 行，已按字数重新切成 ' + segments().length + ' 段');
        } else {
          drawStatic();
          updateCounts();
        }
      } else if (segments().length !== state.lines.length) {
        autoAlign();
      } else {
        drawStatic();
        updateCounts();
      }
      saveState();
    }, 180);
  }

  function setLines(allLines) {
    state.lines = allLines.slice();
  }

  // 时长 + 字数；语速异常（过快/过慢）标红提示可能没对齐
  function durCell(sg, line) {
    if (!sg) return '—';
    var d = sg.end - sg.start;
    var chars = String(line || '').replace(/\s/g, '').length;
    if (!chars) return d.toFixed(2) + 's';
    var sp = chars / d;
    var warn = (sp < 1.2 || sp > 9) ? ' class="warn"' : '';
    return d.toFixed(2) + 's · <span' + warn + '>' + chars + '字</span>';
  }

  function autosize(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';
  }
  function autosizeAll() {
    var list = document.querySelectorAll('.rowText, .trText');
    for (var i = 0; i < list.length; i++) autosize(list[i]);
  }

  /* ---------- 词典 / 翻译服务（有道优先 → 百度兜底） ---------- */
  var dict = { base: '', ok: false, probing: false };
  var wordCache = {}, audioEl = null, popEl = null, transRunning = false;

  function paintChip() {
    var el = $('#dictChip');
    if (!el) return;
    el.classList.toggle('off', !dict.ok);
    el.textContent = dict.ok ? '词典 已连接' : '词典 未连接 · 点此重连';
    el.title = dict.ok
      ? '释义来源：有道词典（本站在线服务），整句翻译由在线翻译接口提供'
      : '在线词典暂不可用，点击重试';
  }

  function ping(base, cb) {
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; cb(false); } }, 5000);
    fetch(base + '/ping', { cache: 'no-store' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      if (done) return; done = true; clearTimeout(timer); cb(!!(j && j.ok));
    }).catch(function () {
      if (done) return; done = true; clearTimeout(timer); cb(false);
    });
  }

  function detectDict(cb) {
    if (dict.probing) { if (cb) cb(dict.ok); return; }
    dict.probing = true;
    /* 线上只走同源 /api；本地用 file:// 直接打开时才退回本地 server.js */
    var tries = location.protocol === 'file:' ? ['http://127.0.0.1:8765/api'] : ['/api'];
    var i = 0;
    (function next() {
      if (i >= tries.length) { finish(''); return; }
      var base = tries[i++];
      ping(base, function (ok) { ok ? finish(base) : next(); });
    })();
    function finish(base) {
      dict.base = base; dict.ok = !!base; dict.probing = false;
      paintChip();
      if (cb) cb(dict.ok);
    }
  }

  function apiGet(path) {
    /* 加超时：在线接口异常时不至于让「查询中…」永远转圈 */
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
    var opt = { cache: 'no-store' };
    if (ctrl) opt.signal = ctrl.signal;
    return fetch(dict.base + path, opt).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (j) {
      if (timer) clearTimeout(timer);
      return j;
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  function normKey(s) { return String(s == null ? '' : s).trim(); }

  function getTrans(i) {
    var k = normKey(state.lines[i]);
    return (k && state.trans[k]) || null;
  }
  function setTrans(i, text, src) {
    var k = normKey(state.lines[i]);
    if (!k) return;
    text = String(text == null ? '' : text).trim();
    if (!text) delete state.trans[k];
    else state.trans[k] = { text: text, src: src || '' };
    saveState();
  }

  function needDict() {
    if (dict.ok) return true;
    toast('在线词典暂不可用，正在重试…');
    detectDict();
    return false;
  }

  function fetchTrans(i, btn) {
    var line = normKey(state.lines[i]);
    if (!line) { toast('这一句还没有文本'); return Promise.resolve(false); }
    if (!needDict()) return Promise.resolve(false);
    var rowEl = document.querySelector('.row[data-i="' + i + '"]');
    var trEl = rowEl && rowEl.querySelector('.trText');
    var srcEl = rowEl && rowEl.querySelector('.trSrc');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    if (srcEl) srcEl.textContent = '查询中…';
    return apiGet('/translate?q=' + encodeURIComponent(line)).then(function (j) {
      if (j && j.ok && j.text) {
        setTrans(i, j.text, j.source);
        if (trEl) { trEl.value = j.text; autosize(trEl); }
        if (rowEl) { rowEl.querySelector('.rowTrans').classList.add('has'); rowEl.classList.add('hasTr'); }
        if (srcEl) srcEl.textContent = j.source || '';
        return true;
      }
      if (srcEl) srcEl.textContent = '未获取';
      return false;
    }).catch(function () {
      if (srcEl) srcEl.textContent = '失败';
      return false;
    }).then(function (ok) {
      if (btn) { btn.disabled = false; btn.textContent = '获取'; }
      return ok;
    });
  }

  function fetchAllTrans() {
    if (transRunning) { transRunning = false; toast('已停止获取'); return; }
    if (!needDict()) return;
    if (!state.lines.length) { toast('还没有句子'); return; }
    var idxs = [];
    for (var i = 0; i < state.lines.length; i++) {
      var k = normKey(state.lines[i]);
      if (k && !(state.trans[k] && state.trans[k].text)) idxs.push(i);
    }
    if (!idxs.length) { toast('每一句都已有释义了'); return; }
    var btn = $('#btnTransAll'), old = btn.textContent;
    var total = idxs.length, done = 0, okCount = 0;
    transRunning = true;
    btn.textContent = '🌐 获取中 0/' + total + '（点击停止）';
    (function step() {
      if (!transRunning || !idxs.length) {
        transRunning = false;
        btn.textContent = old;
        toast(done ? ('完成：' + okCount + '/' + done + ' 句拿到释义') : '已停止');
        return;
      }
      var i = idxs.shift();
      fetchTrans(i).then(function (ok) {
        done++; if (ok) okCount++;
        if (transRunning) btn.textContent = '🌐 获取中 ' + done + '/' + total + '（点击停止）';
        setTimeout(step, 100);
      });
    })();
  }

  /* ---------- 划词查询浮窗 ---------- */
  function selectedWord(el) {
    if (!el || el.selectionStart == null) return '';
    var s = el.selectionStart, e = el.selectionEnd;
    if (e - s < 1 || e - s > 40) return '';
    var w = el.value.slice(s, e).trim();
    if (!w) return '';
    if (/^[A-Za-z][A-Za-z'’\-]*$/.test(w)) return w;
    if (/^[\u3400-\u9fff]{1,6}$/.test(w)) return w;
    return '';
  }

  // 普通 DOM 文本（完整版文本区）里选中的词
  function domSelectedWord() {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || !sel.rangeCount || sel.isCollapsed) return '';
    var w = String(sel.toString() || '').trim();
    if (!w || w.length > 40) return '';
    if (/^[A-Za-z][A-Za-z'’\-]*$/.test(w)) return w;
    if (/^[\u3400-\u9fff]{1,6}$/.test(w)) return w;
    return '';
  }
  function domSelectionPoint() {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r || (!r.width && !r.height)) return null;
    return { x: r.left, y: r.bottom };
  }

  function hidePop() { if (popEl) popEl.setAttribute('hidden', ''); }

  function playVoice(w, type) {
    if (!w) return;
    if (!dict.ok) { toast('词典服务未连接，无法朗读'); return; }
    try {
      if (!audioEl) audioEl = new Audio();
      audioEl.pause();
      audioEl.src = dict.base + '/voice?w=' + encodeURIComponent(w) + '&type=' + (type || 2);
      audioEl.play().catch(function () { });
    } catch (e) { }
  }

  function placePop(x, y) {
    var pw = popEl.offsetWidth || 320;
    popEl.style.left = clamp(x + 8, 8, Math.max(8, window.innerWidth - pw - 12)) + 'px';
    var h = popEl.offsetHeight || 160;
    popEl.style.top = clamp(y + 14, 8, Math.max(8, window.innerHeight - h - 12)) + 'px';
  }

  function renderWord(j) {
    if (!j || !j.ok) {
      $('#wpSrc').textContent = '';
      $('#wpSenses').innerHTML = '<div class="wpRow muted">' + esc((j && j.err) || '有道与百度均未收录该词') + '</div>';
      return;
    }
    $('#wpSrc').textContent = j.source || '';
    $('#wpWord').textContent = j.word || $('#wpWord').textContent;
    var ph = [];
    if (j.uk) ph.push('<span class="wpIpa">英 <b>/' + esc(j.uk) + '/</b></span><button class="spk" data-t="1" title="英式发音">🔊</button>');
    if (j.us) ph.push('<span class="wpIpa">美 <b>/' + esc(j.us) + '/</b></span><button class="spk" data-t="2" title="美式发音">🔊</button>');
    if (!ph.length && j.word) ph.push('<button class="spk wide" data-t="2">🔊 朗读</button>');
    $('#wpPhon').innerHTML = ph.join('<span class="wpGap"></span>');
    var rows = (j.senses || []).map(function (s) {
      return '<div class="wpRow">' + (s.pos ? '<i>' + esc(s.pos) + '</i>' : '') +
        '<span>' + esc(s.def) + '</span></div>';
    }).join('');
    $('#wpSenses').innerHTML = rows || '<div class="wpRow muted">暂无义项</div>';
    $('#wpForms').textContent = j.forms ? ('变形：' + j.forms) : '';
    placelast();
  }
  function placelast() {
    var h = popEl.offsetHeight || 160;
    var top = parseFloat(popEl.style.top) || 0;
    popEl.style.top = clamp(top, 8, Math.max(8, window.innerHeight - h - 12)) + 'px';
  }

  function showWordPop(w, x, y) {
    if (!popEl) return;
    popEl.removeAttribute('hidden');
    $('#wpWord').textContent = w;
    $('#wpSrc').textContent = '查询中…';
    $('#wpPhon').innerHTML = '';
    $('#wpSenses').innerHTML = '<div class="wpRow muted">正在查询…</div>';
    $('#wpForms').textContent = '';
    placePop(x, y);
    if (wordCache[w] !== undefined) { renderWord(wordCache[w]); return; }
    if (!dict.ok) {
      $('#wpSrc').textContent = '';
      $('#wpSenses').innerHTML = '<div class="wpRow muted">在线词典暂未连接，请点右上角「词典」重试</div>';
      placelast();
      return;
    }
    apiGet('/lookup?q=' + encodeURIComponent(w)).then(function (j) {
      wordCache[w] = j;
      if ($('#wpWord').textContent === w) renderWord(j);
    }, function () {
      wordCache[w] = null;
      if ($('#wpWord').textContent === w) {
        $('#wpSrc').textContent = '';
        $('#wpSenses').innerHTML = '<div class="wpRow muted">查询失败，稍后再试</div>';
        placelast();
      }
    });
  }

  function bindWordPopup() {
    popEl = $('#wordPop');
    if (!popEl) return;
    document.addEventListener('mouseup', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('#wordPop')) return;
      var el = ev.target;
      // 完整版文本区：普通文本节点，用 window.getSelection 取词（双击时选区稍后才定）
      if (el && el.closest && el.closest('#fullTextArea')) {
        setTimeout(function () {
          var w2 = domSelectedWord();
          if (!w2) { hidePop(); return; }
          var pt = domSelectionPoint();
          showWordPop(w2, pt ? pt.x : ev.clientX, pt ? pt.y : ev.clientY);
        }, 10);
        return;
      }
      if (!el || el.tagName !== 'TEXTAREA') { hidePop(); return; }
      if (el.id !== 'linesText' && el.id !== 'pinText' && !el.classList.contains('rowText')) { hidePop(); return; }
      var w = selectedWord(el);
      if (!w) { hidePop(); return; }
      showWordPop(w, ev.clientX, ev.clientY);
    });
    document.addEventListener('keyup', function (ev) {
      if (!ev.shiftKey) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(ev.key) < 0) return;
      var el = ev.target;
      if (!el || el.tagName !== 'TEXTAREA') return;
      var w = selectedWord(el);
      if (!w) return;
      var r = el.getBoundingClientRect();
      showWordPop(w, r.left + 24, r.bottom - 8);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') hidePop();
    });
    window.addEventListener('scroll', hidePop, true);
    popEl.addEventListener('click', function (ev) {
      var spk = ev.target.closest ? ev.target.closest('.spk') : null;
      if (spk) { playVoice($('#wpWord').textContent, spk.getAttribute('data-t')); return; }
      if (ev.target.closest && ev.target.closest('#wpClose')) hidePop();
    });
  }

  // 渲染句子行。from：只重建该下标及之后的行——
  // 拆句/加切点时，位置之前的行 DOM 原样保留（不闪动、不重取释义），位置之后按新状态刷新。
  // from 缺省 = 全量重建（导入、自动对齐等整体变化时用）
  function renderRows(from) {
    var wrap = $('#rows');
    var segs = segments();
    rowBars = []; lastBarIdx = -1;
    fullTextFill();                       // 底部完整版文本跟着文本走
    if (!state.buf && !state.lines.length) {
      wrap.innerHTML = '<div class="rowsEmpty">加载音频并输入文本后，这里会列出每一句</div>';
      updateCounts();
      updatePinEditor();
      return;
    }
    if (!state.lines.length) {
      wrap.innerHTML = '<div class="rowsEmpty">请在上方「2 · 文本」里输入内容，一行一句</div>';
      updateCounts();
      updatePinEditor();
      return;
    }
    var fromIdx = (from == null || from < 0) ? 0 : Math.min(from, state.lines.length);
    // 先清掉占位提示（静态 HTML 或上次空状态留下的），只保留句子行
    for (k = wrap.children.length - 1; k >= 0; k--) {
      var c0 = wrap.children[k];
      if (!(c0.classList && c0.classList.contains('row')) && c0.parentNode) c0.parentNode.removeChild(c0);
    }
    // 现有行 DOM
    var old = [], k;
    for (k = 0; k < wrap.children.length; k++) {
      var c = wrap.children[k];
      if (c.classList && c.classList.contains('row')) old.push(c);
    }
    if (old.length < fromIdx) fromIdx = 0;          // 结构对不上 → 退回全量
    // 位置之前的行：保留 DOM，只重新收集进度条引用
    for (k = 0; k < fromIdx && k < old.length; k++) rowBars.push(old[k].querySelector('.rowBar i'));
    // 位置之后的行：删掉重建
    for (k = fromIdx; k < old.length; k++) { if (old[k].parentNode) old[k].parentNode.removeChild(old[k]); }
    state.lines.forEach(function (line, i) {
      if (i < fromIdx) return;
      var sg = segs[i];
      var inner = sg ? stopsIn(sg.start, sg.end).length : 0;
      var trans = getTrans(i) || {};
      var row = document.createElement('div');
      row.className = 'row' + (state.selected === i ? ' sel' : '') + (trans.text ? ' hasTr' : '');
      row.dataset.i = i;
      row.innerHTML =
        '<div class="rowHead">' +
        '<div class="rowIdx">' + (i + 1) + '</div>' +
        '<textarea class="rowText" rows="1" spellcheck="false"></textarea>' +
        '<span class="txtPh" title="句子已隐藏 · 顶栏勾选「显示句子」恢复">···</span>' +
        '<button class="btn playBtn">▶ 播放</button>' +
        '<button class="btn tiny splitBtn" title="音频切点 = 播放线位置，文本断点 = 光标位置，两者都不移动；⌘/Ctrl + Enter 只按光标拆分">✂ 拆分</button>' +
        '</div>' +
        '<div class="rowTrans' + (trans.text ? ' has' : '') + '" data-i="' + i + '">' +
        '<span class="trTag">释义</span>' +
        '<textarea class="trText" rows="1" spellcheck="false" placeholder="点右侧按钮获取这一句的释义"></textarea>' +
        '<span class="trSrc" title="来源"></span>' +
        '<button class="btn tiny trBtn">获取</button>' +
        '</div>' +
        '<div class="rowMeta">' +
        '<input class="tS" type="text" value="' + fmt(sg && sg.start) + '" placeholder="起"' + (sg && i > 0 ? '' : ' disabled') + '>' +
        '<span class="arr">→</span>' +
        '<input class="tE" type="text" value="' + fmt(sg && sg.end) + '" placeholder="止"' +
        (sg && i < state.lines.length - 1 ? '' : ' disabled') + '>' +
        '<span class="rowDur" title="时长 · 字数">' + durCell(sg, line) + '</span>' +
        (inner ? '<span class="rowStops" title="句内有 ' + inner + ' 个暂停点，播放会在这里停一下">⏸' + inner + '</span>' : '') +
        '<span class="rowBar"><i></i></span>' +
        '</div>';
      // 释义区直接填值，避免多次 HTML 转义
      var trEl = row.querySelector('.trText'), trSrc = row.querySelector('.trSrc');
      if (trans.text) { trEl.value = trans.text; trSrc.textContent = trans.src || ''; row.querySelector('.rowTrans').className = 'rowTrans has'; }
      trEl.addEventListener('input', function () {
        autosize(trEl);
        setTrans(i, trEl.value, trSrc.textContent);
      });
      trEl.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); trEl.blur(); }
      });
      row.querySelector('.trBtn').addEventListener('click', function (ev) {
        ev.stopPropagation();
        fetchTrans(i, ev.currentTarget);
      });
      var txtEl = row.querySelector('.rowText');
      txtEl.value = line;
      txtEl.readOnly = document.body.classList.contains('finish');   // 播放页里句子只读
      txtEl.addEventListener('input', function () {
        autosize(txtEl);
        state.lines[i] = txtEl.value.replace(/\n/g, ' ');
        writeArea();
        var durEl = row.querySelector('.rowDur');
        if (durEl) durEl.innerHTML = durCell(segments()[i], state.lines[i]);
        saveState();
      });
      txtEl.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          if (ev.metaKey || ev.ctrlKey) { splitRowAtCaret(i, txtEl.selectionStart); return; }
          txtEl.blur();                             // 回车不换行，换行请在文本框里做
        }
      });
      // 聚焦文本框时，橙色虚影 = 播放线位置（与拆分按钮完全一致）
      var ghost = function () {
        ghostRow = i;
        drawOverlay();
      };
      ['click', 'keyup', 'select', 'focus'].forEach(function (evt) {
        txtEl.addEventListener(evt, ghost);
      });
      txtEl.addEventListener('blur', function () { if (ghostRow >= 0) { ghostRow = -1; drawOverlay(); } });
      row.querySelector('.splitBtn').addEventListener('click', function (ev) {
        ev.stopPropagation();
        splitRowAtCaret(i, txtEl.selectionStart, playhead);   // 播放线在哪，切点就在哪
      });

      var apply = function (el, which) {
        var v = parseT(el.value);
        if (v == null) { renderRows(); return; }
        if (which === 'end') {
          if (i >= state.lines.length - 1) { el.value = fmt(dur()); return; }
          setBoundary(i, v);
        } else {
          if (i === 0) { el.value = fmt(0); return; }
          setBoundary(i - 1, v);
        }
      };
      var tS = row.querySelector('.tS'), tE = row.querySelector('.tE');
      tS.addEventListener('change', function () { apply(tS, 'start'); });
      tE.addEventListener('change', function () { apply(tE, 'end'); });
      [tS, tE].forEach(function (el) {
        el.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
        });
      });

      row.querySelector('.playBtn').addEventListener('click', function (ev) {
        ev.stopPropagation();
        toggleRow(i);
      });
      row.addEventListener('click', function (ev) {
        // 播放页：点句子任意位置就是播放 / 暂停（句子文本已 pointer-events:none，
        // 点到的是行壳；释义框里点击不触发播放，方便边听边改释义）
        if (document.body.classList.contains('finish')) {
          var selTxt = '';
          try { selTxt = String(window.getSelection ? window.getSelection() : ''); } catch (e) { }
          if (selTxt) return;
          if (ev.target.closest('input, button, textarea')) return;
          select(i, false);
          toggleRow(i);
          return;
        }
        if (ev.target.closest('input, button, textarea')) return;
        select(i, true);
      });
      wrap.appendChild(row);
      rowBars.push(row.querySelector('.rowBar i'));
    });
    // 等布局完成后按内容高度撑开，保证整句文本完整显示（放不下自动换行）
    if (window.requestAnimationFrame) requestAnimationFrame(autosizeAll);
    else autosizeAll();
    updateCounts();
    refreshRowButtons();
    updatePinEditor();
  }

  function updateCounts() {
    var n = state.lines.length;
    var segs = segments();
    var el = $('#countStat');
    if (!state.buf) {
      el.textContent = n ? ('文本 ' + n + ' 句（载入音频后自动对口型）') : '尚未输入文本';
      return;
    }
    var ok = n === segs.length;
    el.innerHTML = '文本 <b>' + n + '</b> 句 · 句子区间 <b>' + segs.length + '</b> 段 ' +
      (ok ? '<span class="okStat">✓ 已同步</span>' : '<span class="badStat">⚠ 句数不一致</span>') +
      ' · 切点 ' + state.boundaries.length + ' 个 · 暂停点 ' + state.stops.length + ' 个' +
      ' · 气口 ' + state.pauses.length + ' 个';
  }

  /* ---------- 载入 ---------- */
  function loadAudioFile(file) {
    $('#fileInfo').innerHTML = '正在解析 <b>' + esc(file.name) + '</b> …';
    var acx = new (window.AudioContext || window.webkitAudioContext)();
    file.arrayBuffer().then(function (ab) {
      // decodeAudioData 会「接管」这块 ArrayBuffer（之后会被 detach），
      // 分享页要打包原始音频，先留一份副本
      try { state.srcBytes = new Uint8Array(ab.slice(0)); } catch (e) { state.srcBytes = null; }
      state.srcMime = guessMime(file.name, file.type);
      return new Promise(function (res, rej) {
        var p = acx.decodeAudioData(ab, res, rej);
        if (p && p.then) p.then(res, rej);
      });
    }).then(function (buf) {
      state.buf = buf;
      state.fileName = file.name;
      state.fileSize = file.size;
      $('#fileInfo').innerHTML = '<b>' + esc(file.name) + '</b> · ' + fmt(buf.duration) + ' · ' +
        buf.sampleRate + ' Hz · ' + (file.size / 1048576).toFixed(1) + ' MB';
      $('#waveEmpty').style.display = 'none';
      state.env = computeEnvelope(buf);
      state.mm = computeMinMax(buf);
      state.chans = [];
      for (var ci = 0; ci < buf.numberOfChannels; ci++) state.chans.push(buf.getChannelData(ci));
      detect();
      playhead = null;
      pausedAt = null;
      queue = []; holding = false; pendingIdx = -1; activeRow = -1;
      state.stops = [];
      state.boundaries = [];
      state.edges = [];
      state.manual = false;
      view.start = 0; view.span = 0;
      syncZoomUI();
      updateTimeNow();
      var restored = restoreState();
      if (!restored) autoAlign();
      else {
        renderRows();
        if (segments().length !== state.lines.length) maybeAutoAlign();
        drawStatic();
        updateCounts();
      }
      paintMini();
      updateWavePin();
      acx.close();
    }).catch(function (e) {
      console.error(e);
      $('#fileInfo').textContent = '解析失败：' + file.name;
      toast('音频解析失败，试试换成 wav / mp3 格式');
    });
  }

  // 从文件/外部导入文本
  function setText(str) { applyText(str, { writeBack: true }); }

  // 导入入口：先忽略空行，再按标点把长文本拆成一句一行，最后按文本划分句子区间
  function importText(str, opts) {
    opts = opts || {};
    var want = opts.punct == null
      ? ($('#autoPunct') ? $('#autoPunct').checked : true)
      : !!opts.punct;
    // 复制粘贴来的文本常有空行，直接忽略，只保留有文字的行
    var cleaned = stripBlankLines(str);
    var raw = cleaned.text;
    if (cleaned.dropped > 0) {
      toast('已忽略 ' + cleaned.dropped + ' 个空行，只按有文字的行分句');
    }
    if (!want) { setText(raw); return raw; }
    var mode = opts.mode || punctMode();
    var how = mode === 'clause' ? '按句号 + 逗号' : '按句号';
    var lines = splitByPunct(raw, mode);
    var before = parseLines(raw).length;
    var out = lines.join('\n');
    // 新导入的文本 = 全新的一套句子，切点重新跟着生成
    state.manual = false;
    setText(out);
    if (state.buf && lines.length !== before) {
      toast(how + '拆成 ' + lines.length + ' 句，正在按文本划分区间…');
    } else if (lines.length !== before) {
      toast(how + '拆成 ' + lines.length + ' 句（载入音频后会自动划分区间）');
    }
    return out;
  }

  /* ---------- 导出 ---------- */
  function sliceToWav(startSec, endSec) {
    var buf = state.buf, sr = buf.sampleRate;
    var s0 = clamp(Math.floor(startSec * sr), 0, buf.length);
    var e0 = clamp(Math.floor(endSec * sr), s0 + 1, buf.length);
    var len = e0 - s0, nc = buf.numberOfChannels;
    var chans = [];
    for (var c = 0; c < nc; c++) chans.push(buf.getChannelData(c).subarray(s0, e0));
    var bytes = len * nc * 2;
    var ab = new ArrayBuffer(44 + bytes), dv = new DataView(ab);
    var put = function (off, str) { for (var i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i)); };
    put(0, 'RIFF'); dv.setUint32(4, 36 + bytes, true); put(8, 'WAVE');
    put(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, nc, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * nc * 2, true); dv.setUint16(32, nc * 2, true); dv.setUint16(34, 16, true);
    put(36, 'data'); dv.setUint32(40, bytes, true);
    var off = 44;
    for (var i = 0; i < len; i++) {
      for (var c2 = 0; c2 < nc; c2++) {
        var v = Math.max(-1, Math.min(1, chans[c2][i]));
        dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7FFF, true);
        off += 2;
      }
    }
    return new Uint8Array(ab);
  }

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function buildZip(files) {
    var locals = [], centrals = [], offset = 0;
    var now = new Date();
    var dostime = (now.getHours() << 11) | (now.getMinutes() << 5) | (Math.floor(now.getSeconds() / 2));
    var dosdate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    var enc = new TextEncoder();
    files.forEach(function (f) {
      var name = enc.encode(f.name);
      var crc = crc32(f.data), sz = f.data.length;
      var l = new Uint8Array(30 + name.length), lv = new DataView(l.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true); lv.setUint16(10, dostime, true); lv.setUint16(12, dosdate, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, sz, true); lv.setUint32(22, sz, true);
      lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
      l.set(name, 30);
      locals.push(l, f.data);

      var cd = new Uint8Array(46 + name.length), cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true); cv.setUint16(12, dostime, true); cv.setUint16(14, dosdate, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, sz, true); cv.setUint32(24, sz, true);
      cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(name, 46);
      centrals.push(cd);
      offset += l.length + sz;
    });
    var cdSize = centrals.reduce(function (a, c) { return a + c.length; }, 0);
    var tail = new Uint8Array(22), tv = new DataView(tail.buffer);
    tv.setUint32(0, 0x06054b50, true);
    tv.setUint16(4, 0, true); tv.setUint16(6, 0, true);
    tv.setUint16(8, files.length, true); tv.setUint16(10, files.length, true);
    tv.setUint32(12, cdSize, true); tv.setUint32(16, offset, true);
    tv.setUint16(20, 0, true);
    return new Blob(locals.concat(centrals, [tail]), { type: 'application/zip' });
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function srtTime(t) {
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var ms = Math.round((s - Math.floor(s)) * 1000);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' +
      String(Math.floor(s)).padStart(2, '0') + ',' + String(ms).padStart(3, '0');
  }

  function expIncludeTrans() {
    var el = $('#expTrans');
    return el ? el.checked : true;
  }
  function transFor(text) {
    if (!expIncludeTrans()) return '';
    var t = state.trans[normKey(text)];
    return t && t.text ? t.text : '';
  }

  function pairs() {
    var segs = segments(), out = [];
    for (var i = 0; i < state.lines.length; i++) {
      if (segs[i]) out.push({
        i: i + 1, text: state.lines[i], start: segs[i].start, end: segs[i].end, trans: transFor(state.lines[i])
      });
    }
    return out;
  }

  function exportZip() {
    if (!state.buf) { toast('请先载入音频'); return; }
    var ps = pairs();
    if (!ps.length) { toast('没有可导出的句子'); return; }
    toast('正在导出 ' + ps.length + ' 个片段…');
    setTimeout(function () {
      var files = [];
      ps.forEach(function (p) {
        files.push({
          name: pad3(p.i) + '_' + safeName(p.text || ('audio_' + pad3(p.i)), 40) + '.wav',
          data: sliceToWav(p.start, p.end)
        });
      });
      files.push({ name: '对照文本.txt', data: new TextEncoder().encode(buildTxt(ps)) });
      files.push({ name: '字幕.srt', data: new TextEncoder().encode(buildSrt(ps)) });
      var base = state.fileName.replace(/\.[^.]+$/, '') || 'audio';
      download(buildZip(files), safeName(base, 60) + '_' + ps.length + '句.zip');
      toast('导出完成');
    }, 60);
  }

  function buildTxt(ps) {
    var lines = ['# ' + state.fileName, '# 共 ' + ps.length + ' 句', ''];
    ps.forEach(function (p) {
      lines.push(pad3(p.i) + '\t' + fmt(p.start) + ' - ' + fmt(p.end) + '\t' + p.text);
      if (p.trans) lines.push('\t\t\t释义：' + p.trans);
    });
    return lines.join('\n');
  }
  function buildSrt(ps) {
    var arr = [];
    ps.forEach(function (p) {
      arr.push(String(p.i), srtTime(p.start) + ' --> ' + srtTime(p.end), p.text);
      if (p.trans) arr.push(p.trans);
      arr.push('');
    });
    return arr.join('\n');
  }

  /* ---------- 分享：打包成一个独立的播放页（单文件 HTML） ---------- */
  // 音频以 base64 内嵌，句子/切点/暂停点/释义/播放设置一起写进页面，
  // 对方双击 .html 就能在任意电脑的浏览器里逐句听练，不联网、不依赖本机服务
  var shareBlob = null, shareName = '', shareUrl = '';
  var shareAudioUrl = null, shareJson = '';

  function shareData() {
    var segs = segments(), out = [];
    for (var i = 0; i < state.lines.length; i++) {
      var sg = segs[i];
      if (!sg) continue;
      var tr = state.trans[normKey(state.lines[i])] || {};
      out.push({
        t: state.lines[i],
        s: Math.round(sg.start * 1000) / 1000,
        e: Math.round(sg.end * 1000) / 1000,
        x: tr.text || '', src: tr.src || ''
      });
    }
    return {
      name: state.fileName || 'audio',
      dur: Math.round(dur() * 1000) / 1000,
      lines: out,
      stops: state.stops.map(function (t) { return Math.round(t * 1000) / 1000; }),
      repeat: state.repeat, gap: state.gap, rate: state.rate,
      pauseMode: pauseMode(), pauseSec: pauseSec(),
      made: new Date().toISOString().slice(0, 10)
    };
  }

  function audioToDataUrl(cb) {
    if (!state.srcBytes || !state.srcBytes.length) { cb(null); return; }
    try {
      var blob = new Blob([state.srcBytes], { type: state.srcMime || 'audio/mpeg' });
      var fr = new FileReader();
      fr.onload = function () { cb(String(fr.result || '')); };
      fr.onerror = function () { cb(null); };
      fr.readAsDataURL(blob);
    } catch (e) { cb(null); }
  }

  // 独立播放页模板：__TITLE__ / __DATA__ / __AUDIO__ 三处占位
  function sharePageHtml(title, json, audioUrl) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__ · 逐句听练</title>
<style>
:root{--bg:#f5f6f8;--card:#fff;--bd:#e4e7ec;--bst:#d3d8e0;--tx:#1f2937;--mu:#6b7280;--fa:#9aa3af;--ac:#4f46e5;--dn:#ef4444}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.head{position:sticky;top:0;z-index:30;background:rgba(255,255,255,.97);border-bottom:1px solid var(--bd);padding:9px 18px 10px;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.hrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.hrow+.hrow{margin-top:7px}
.brand{display:flex;align-items:center;gap:8px;min-width:0}
.badge{flex:0 0 auto;font-size:11px;font-weight:600;color:var(--ac);background:#eef2ff;border:1px solid #c7d2fe;border-radius:999px;padding:2px 9px}
.brand b{font-size:14px;font-weight:650;max-width:46vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 左上角名称：点击改名（需密码） */
#brandName{cursor:pointer;border-bottom:1px dashed transparent}
#brandName:hover{border-bottom-color:var(--ac)}
.rnEdit{flex:0 0 auto;border:0;background:none;color:var(--fa);font-size:13px;line-height:1;cursor:pointer;padding:3px 4px}
.rnEdit:hover{color:var(--ac)}
.rnPop[hidden]{display:none}
.rnPop{position:fixed;inset:0;z-index:80;background:rgba(17,24,39,.42);display:flex;align-items:center;justify-content:center;padding:20px}
.rnCard{width:400px;max-width:100%;background:#fff;border-radius:12px;box-shadow:0 20px 50px rgba(15,23,42,.25);overflow:hidden}
.rnHead{display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--bd)}
.rnHead b{font-size:14px}
.rnX{margin-left:auto;border:0;background:none;font-size:19px;color:var(--fa);cursor:pointer;line-height:1;padding:0 2px}
.rnX:hover{color:var(--tx)}
.rnBody{padding:14px 16px 16px;display:flex;flex-direction:column;gap:9px}
.rnTip{margin:0;font-size:12.5px;color:var(--mu)}
.rnLb{font-size:12px;color:var(--mu)}
.rnBody input{font:inherit;font-size:13.5px;color:var(--tx);background:#fff;border:1px solid var(--bst);border-radius:7px;padding:6px 9px;outline:none;width:100%}
.rnBody input:focus{border-color:var(--ac);box-shadow:0 0 0 3px rgba(79,70,229,.1)}
.rnErr{font-size:12px;color:#b91c1c}
.rnErr[hidden],.rnStep[hidden]{display:none}
.rnHint{margin:0;font-size:11.5px;color:var(--fa);line-height:1.6}
.rnBtns{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.meta{font-size:12px;color:var(--fa);font-variant-numeric:tabular-nums;white-space:nowrap}
.sp{flex:1}
.tool{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--mu)}
.tool input[type=number]{width:60px}
.tool select{width:auto}
input[type=number],select{font:inherit;font-size:12px;color:var(--tx);background:#fff;border:1px solid var(--bst);border-radius:7px;padding:3px 6px;outline:none}
input:focus,select:focus{border-color:var(--ac);box-shadow:0 0 0 3px rgba(79,70,229,.1)}
input[type=checkbox]{accent-color:var(--ac)}
.chk{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--tx);cursor:pointer;user-select:none}
.btn{font:inherit;font-size:12.5px;background:#fff;border:1px solid var(--bst);border-radius:8px;padding:6px 11px;cursor:pointer;color:var(--tx);white-space:nowrap;transition:.12s}
.btn:hover{background:#f3f4f6;border-color:#b9bfca}
.btn.primary{background:var(--ac);border-color:var(--ac);color:#fff}
.btn.primary:hover{background:#4338ca}
.btn.danger{color:#b91c1c;border-color:#fca5a5;background:#fef2f2}
.btn.danger:hover{background:#fee2e2}
.btn:disabled{opacity:.45;cursor:not-allowed}
.tn{font-size:12px;color:var(--mu);font-variant-numeric:tabular-nums;background:#f4f6f8;border-radius:6px;padding:3px 9px;white-space:nowrap}
main{max-width:1080px;margin:0 auto;padding:16px 18px 80px;display:flex;flex-direction:column;gap:9px}
.row{background:var(--card);border:1px solid var(--bd);border-radius:11px;padding:14px 18px;cursor:pointer;transition:.12s}
.row:hover{border-color:var(--bst);background:#fcfcfd}
.row.playing{border-color:#fda4af;background:#fff5f6;box-shadow:0 0 0 3px rgba(244,63,94,.08)}
.row.waiting{border-color:#fcd34d;background:#fffbeb}
.rh{display:flex;align-items:flex-start;gap:9px}
.idx{flex:0 0 30px;text-align:center;font-size:13px;color:var(--mu);background:#f1f3f6;border-radius:5px;padding:4px 0;margin-top:4px}
.row.playing .idx{background:#fff;color:var(--dn);font-weight:600}
.txt{flex:1 1 auto;min-width:0;font-size:19px;line-height:1.8;word-break:break-word}
.play{flex:0 0 auto;margin-top:2px;min-width:88px;font:inherit;font-size:13.5px;border:1px solid var(--bst);background:#fff;border-radius:8px;padding:6px 11px;cursor:pointer;color:var(--tx);white-space:nowrap}
.play:hover{background:#f3f4f6}
.row.playing .play,.row.waiting .play{border-color:var(--dn);color:var(--dn)}
.tr{display:flex;gap:7px;margin-top:6px;padding-left:41px;font-size:16px;line-height:1.7;color:#374151}
.tr .tag{flex:0 0 auto;font-size:12px;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:4px;padding:1px 6px;height:20px;line-height:17px;margin-top:3px}
.tr .tx{flex:1 1 auto;min-width:0}
.tr .src{color:var(--fa);font-size:12px;white-space:nowrap;align-self:center}
.m2{display:flex;align-items:center;gap:10px;margin-top:7px;padding-left:41px;font-size:12.5px;color:var(--fa);font-variant-numeric:tabular-nums}
.bar2{position:relative;flex:1 1 auto;height:4px;min-width:60px;background:#eef0f3;border-radius:2px;overflow:hidden}
.bar2 i{position:absolute;left:0;top:0;bottom:0;width:0;background:var(--ac);border-radius:2px}
.row.playing .bar2 i{background:var(--dn)}
.tph{display:none;font-size:14px;color:var(--fa);letter-spacing:3px;padding:2px 6px}
body.noTx .txt{display:none}
body.noTx .tph{display:block;flex:1 1 auto;min-width:0}   /* 占位撑满整行：播放按钮位置不随隐藏句子移动 */
body.noTr .tr{display:none}
.foot{max-width:1080px;margin:0 auto;padding:0 18px 40px;font-size:11.5px;color:var(--fa);text-align:center}
.empty{color:var(--fa);text-align:center;padding:60px 0;font-size:13px}
#list{display:flex;flex-direction:column;gap:9px}
/* 底部：完整版文本（不分句）· 整段连播 */
.fullBlock{margin-top:6px;padding-top:16px;border-top:1px dashed var(--bst)}
.fbHead{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}
.fbHead h3{margin:0;font-size:14px;font-weight:650;display:flex;align-items:center;gap:8px}
.fbTag{font-size:11px;font-weight:500;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:999px;padding:1px 8px}
.fbTools{margin-left:auto;display:flex;align-items:center;gap:9px}
.fbTime{font-size:12px;color:var(--mu);font-variant-numeric:tabular-nums;background:#f4f6f8;border-radius:6px;padding:3px 9px}
.fbBar{position:relative;height:5px;background:#eef0f3;border-radius:3px;overflow:hidden;cursor:pointer;margin-bottom:12px}
.fbBar i{position:absolute;left:0;top:0;bottom:0;width:0;background:var(--ac);border-radius:3px}
.fullTextArea{display:block;width:100%;min-height:120px;font-size:19px;line-height:2;color:var(--tx);white-space:pre-wrap;word-break:break-word;text-align:justify;text-justify:inter-ideograph;-webkit-user-select:text;user-select:text}
.fullTextArea .fs{border-radius:5px;transition:background .16s,box-shadow .16s}
.fullTextArea .fs.cur{background:rgba(250,204,21,.36);box-shadow:0 0 0 3px rgba(250,204,21,.36);-webkit-box-decoration-break:clone;box-decoration-break:clone}
.fullTextArea ::selection{background:#c7d2fe}
.fbHint{margin-top:10px;font-size:11.5px;color:var(--fa)}
@media (max-width:640px){.fbTools{margin-left:0}}
.toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,20px);background:#1f2937;color:#fff;font-size:13px;padding:9px 16px;border-radius:8px;opacity:0;pointer-events:none;transition:.22s;z-index:60;max-width:80vw}
.toast.show{opacity:1;transform:translate(-50%,0)}
@media (max-width:640px){.brand b{max-width:56vw}.txt{font-size:17px}.fullTextArea{font-size:17px}.hrow.ctrl .tool{font-size:11.5px}}
</style>
</head>
<body>
<div class="head">
  <div class="hrow">
    <div class="brand"><span class="badge">播放页</span><b id="brandName" title="点击修改名称（需要密码）">__TITLE__</b><button class="rnEdit" id="rnEdit" type="button" title="修改名称（需要密码）">✎</button></div>
    <span class="meta" id="meta"></span>
    <span class="sp"></span>
    <label class="chk"><input type="checkbox" id="showTx" checked> 显示句子</label>
    <label class="chk"><input type="checkbox" id="showTr" checked> 显示全部释义</label>
  </div>
  <div class="hrow ctrl">
    <label class="tool">重复 <input id="rep" type="number" min="1" max="30" step="1" value="1"> 遍</label>
    <label class="tool">间隔 <input id="gap" type="number" min="0" max="10" step="0.1" value="0.6"> s</label>
    <label class="tool">速度
      <select id="rate">
        <option value="0.6">0.6x</option><option value="0.75">0.75x</option><option value="0.9">0.9x</option>
        <option value="1" selected>1.0x</option><option value="1.15">1.15x</option><option value="1.3">1.3x</option>
      </select>
    </label>
    <label class="tool">切点处
      <select id="pm">
        <option value="hold" selected>停住等手动继续</option>
        <option value="auto">停留数秒自动继续</option>
        <option value="off">不暂停（连续播）</option>
      </select>
    </label>
    <label class="tool">停留 <input id="psec" type="number" min="0" max="30" step="0.5" value="1"> s</label>
    <span class="sp"></span>
    <span class="tn" id="tn">00:00.0 / 00:00.0</span>
    <button class="btn primary" id="playAll">▶ 播放全文</button>
    <button class="btn danger" id="stop" disabled>⏹ 停止</button>
  </div>
</div>
<main>
  <div id="list"></div>
  <section class="fullBlock" id="fullBlock">
    <div class="fbHead">
      <h3>完整版文本 <span class="fbTag">不分句 · 整段连播</span></h3>
      <div class="fbTools">
        <span class="fbTime" id="fbTime">00:00.0 / 00:00.0</span>
        <button class="btn primary" id="fbPlay">▶ 播放完整音频</button>
        <button class="btn" id="fbStop" disabled>⏹ 停止</button>
      </div>
    </div>
    <div class="fbBar" id="fbBar" title="点击可跳到对应位置"><i id="fbFill"></i></div>
    <div id="fullTextArea" class="fullTextArea"></div>
    <div class="fbHint">整段连续播放，不在切点或暂停点停，读到哪句高亮哪句</div>
  </section>
</main>
<div class="foot">由「音频拆分 · 逐句听练」生成 · __VER__ · 音频已内嵌在本文件里，离线可用 · 空格 播放 / 暂停</div>
<audio id="au" preload="auto" src="__AUDIO__"></audio>
<div class="toast" id="toast"></div>
<div class="rnPop" id="rnPop" hidden>
  <div class="rnCard">
    <div class="rnHead"><b>修改名称</b><button class="rnX" id="rnX" type="button" title="关闭">×</button></div>
    <div class="rnBody">
      <p class="rnTip">左上角名称需要密码才能修改</p>
      <div class="rnStep" id="rnStep1">
        <label class="rnLb" for="rnPass">密码</label>
        <input id="rnPass" type="password" placeholder="请输入密码" autocomplete="off">
        <div class="rnErr" id="rnErr" hidden>密码不对，请重试</div>
        <div class="rnBtns"><button class="btn primary" id="rnOk" type="button">下一步</button></div>
      </div>
      <div class="rnStep" id="rnStep2" hidden>
        <label class="rnLb" for="rnName">新名称</label>
        <input id="rnName" type="text" maxlength="80" autocomplete="off">
        <p class="rnHint">保存后立即生效，并下载一份改名后的新网页（原文件不变）。</p>
        <div class="rnBtns">
          <button class="btn" id="rnCancel" type="button">取消</button>
          <button class="btn primary" id="rnSave" type="button">保存</button>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
(function () {
  'use strict';
  var D = __DATA__;
  var au = document.getElementById('au');
  var list = document.getElementById('list');
  var elMeta = document.getElementById('meta');
  var elTn = document.getElementById('tn');
  var btnStop = document.getElementById('stop');
  var rows = [], bars = [], btns = [];
  var units = [], qi = -1, pendingIdx = -1, pendingOff = 0;
  var playing = false, holding = false, timer = null, raf = null, cur = -1, lastBar = -1;
  var toastTimer = null;

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    var m = Math.floor(t / 60), s = t - m * 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  function toast(m) {
    var el = document.getElementById('toast');
    el.textContent = m; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }
  function num(id, d) { var el = document.getElementById(id); var v = parseFloat(el.value); return isFinite(v) ? v : d; }
  function repN() { return Math.max(1, Math.round(num('rep', 1))); }
  function gapS() { return Math.max(0, num('gap', 0.6)); }
  function rate() { var v = num('rate', 1); return v > 0 ? v : 1; }
  function psec() { return Math.max(0, num('psec', 1)); }
  function pmode() { return document.getElementById('pm').value; }

  if (!D.lines.length) {
    list.innerHTML = '<div class="empty">这个播放页里还没有句子</div>';
  }
  elMeta.textContent = D.lines.length + ' 句 · ' + fmt(D.dur) + (D.made ? ' · ' + D.made : '');

  // 默认值
  document.getElementById('rep').value = D.repeat || 1;
  document.getElementById('gap').value = D.gap == null ? 0.6 : D.gap;
  document.getElementById('psec').value = D.pauseSec == null ? 1 : D.pauseSec;
  document.getElementById('pm').value = D.pauseMode || 'hold';
  (function () {
    var r = String(D.rate || 1), sel = document.getElementById('rate'), hit = false;
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === r) { sel.selectedIndex = i; hit = true; }
    if (!hit) sel.value = '1';
  })();

  // 句子列表
  D.lines.forEach(function (L, i) {
    var row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('data-i', i);
    var head = document.createElement('div');
    head.className = 'rh';
    var idx = document.createElement('div');
    idx.className = 'idx'; idx.textContent = i + 1;
    var txt = document.createElement('div');
    txt.className = 'txt'; txt.textContent = L.t;
    var btn = document.createElement('button');
    btn.className = 'play'; btn.type = 'button'; btn.textContent = '▶ 播放';
    // 句子隐藏时的占位（由页头「显示句子」一键开关控制）
    var tph = document.createElement('span');
    tph.className = 'tph'; tph.title = '句子已隐藏 · 勾选页头「显示句子」恢复'; tph.textContent = '···';
    head.appendChild(idx); head.appendChild(txt); head.appendChild(tph); head.appendChild(btn);
    row.appendChild(head);
    if (L.x) {
      var tr = document.createElement('div');
      tr.className = 'tr';
      var tag = document.createElement('span');
      tag.className = 'tag'; tag.textContent = '释义';
      var tx = document.createElement('span');
      tx.className = 'tx'; tx.textContent = L.x;
      tr.appendChild(tag); tr.appendChild(tx);
      if (L.src) {
        var src = document.createElement('span');
        src.className = 'src'; src.textContent = L.src;
        tr.appendChild(src);
      }
      row.appendChild(tr);
    }
    var m2 = document.createElement('div');
    m2.className = 'm2';
    var tm = document.createElement('span');
    tm.textContent = fmt(L.s) + ' → ' + fmt(L.e);
    var bar = document.createElement('span');
    bar.className = 'bar2';
    var fill = document.createElement('i');
    bar.appendChild(fill);
    m2.appendChild(tm); m2.appendChild(bar);
    row.appendChild(m2);

    row.addEventListener('click', function (ev) {
      if (ev.target && ev.target.className === 'play') return;
      clickRow(i);
    });
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); clickRow(i); });
    list.appendChild(row);
    rows.push(row); bars.push(fill); btns.push(btn);
  });

  /* ---------- 底部：完整版文本（不分句）· 整段连播 ---------- */
  // 和逐句播放共用同一个 <audio>，但播法完全不同：从当前位置一路放到结尾，
  // 不在任何切点 / 暂停点停；读到哪一句，完整版文本里就高亮哪一句。
  var fbox = document.getElementById('fullTextArea');
  var fbBtn = document.getElementById('fbPlay');
  var fbStopBtn = document.getElementById('fbStop');
  var fbTimeEl = document.getElementById('fbTime');
  var fbFillEl = document.getElementById('fbFill');
  var fbBarEl = document.getElementById('fbBar');
  var fbOn = false, fbPos = 0, fbRaf = null, fbRow = -1, fbKey = '';

  function fparts() {
    var arr = [];
    for (var i = 0; i < D.lines.length; i++) {
      var s = String(D.lines[i].t || '').trim();
      if (s) arr.push({ i: i, t: s });
    }
    return arr;
  }
  // 一句一个 span（英文句子之间自动补空格），高亮时只给当前句加类
  function renderFull() {
    var arr = fparts();
    var key = arr.map(function (a) { return a.i + '#' + a.t; }).join('~');
    if (key === fbKey) { markFull(fbRow, true); return; }
    fbKey = key;
    while (fbox.firstChild) fbox.removeChild(fbox.firstChild);
    for (var k = 0; k < arr.length; k++) {
      var sp = document.createElement('span');
      sp.className = 'fs';
      sp.setAttribute('data-i', arr[k].i);
      sp.textContent = arr[k].t;
      fbox.appendChild(sp);
      var nx = arr[k + 1];
      if (nx) {
        var a = arr[k].t.charAt(arr[k].t.length - 1), b = nx.t.charAt(0);
        if (a.charCodeAt(0) < 128 && b.charCodeAt(0) < 128) fbox.appendChild(document.createTextNode(' '));
      }
    }
    markFull(fbRow, true);
  }
  function markFull(i, force) {
    if (i === fbRow && !force) return;
    fbRow = i;
    var old = fbox.querySelectorAll('.fs.cur');
    for (var k = 0; k < old.length; k++) old[k].classList.remove('cur');
    if (i < 0) return;
    var el = fbox.querySelector('.fs[data-i="' + i + '"]');
    if (!el) return;
    el.classList.add('cur');
    if (fbOn) { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { } }
  }
  function rowAtT(t) {
    for (var i = 0; i < D.lines.length; i++) {
      var L = D.lines[i];
      if (t >= L.s && t < L.e) return i;
    }
    return D.lines.length ? D.lines.length - 1 : -1;
  }
  function fbUi() {
    fbBtn.textContent = fbOn ? '⏸ 暂停' : (fbPos > 0.05 ? '▶ 继续' : '▶ 播放完整音频');
    fbTimeEl.textContent = fmt(fbPos) + ' / ' + fmt(D.dur);
    fbFillEl.style.width = (D.dur ? Math.min(1, Math.max(0, fbPos / D.dur)) * 100 : 0).toFixed(1) + '%';
    fbStopBtn.disabled = !fbOn && fbPos <= 0.05;
  }
  // 逐句播放要开始时让路：清掉整段连播的状态（不动音频元素本身）
  function fbAbort() {
    if (fbRaf) { cancelAnimationFrame(fbRaf); fbRaf = null; }
    fbOn = false; fbPos = 0;
    fbUi();
  }
  function fbStart(from) {
    if (!D.lines.length) { toast('这个播放页里还没有句子'); return; }
    if (fbRaf) { cancelAnimationFrame(fbRaf); fbRaf = null; }
    resetAll();                                    // 停掉逐句队列（不重置播放头）
    var start = from == null ? fbPos : from;
    start = Math.max(0, Math.min(start, Math.max(0, D.dur - 0.02)));
    try { au.currentTime = start; } catch (e) { }
    au.playbackRate = rate();
    fbPos = start; fbOn = true;
    var p = au.play();
    if (p && p.catch) p.catch(function () { toast('浏览器拦下了播放，请再点一次'); });
    markFull(rowAtT(start), true);
    fbUi();
    fbRaf = requestAnimationFrame(fbTick);
  }
  function fbTick() {
    fbRaf = null;
    if (!fbOn) return;
    var t = au.currentTime || 0;
    if (au.ended || t >= D.dur - 0.02) { fbReset(true); return; }
    fbPos = t;
    markFull(rowAtT(t));                            // 读到哪句高亮哪句
    fbUi();
    fbRaf = requestAnimationFrame(fbTick);
  }
  function fbPause() {
    if (!fbOn) return;
    if (fbRaf) { cancelAnimationFrame(fbRaf); fbRaf = null; }
    fbPos = Math.min(au.currentTime || 0, D.dur);
    try { au.pause(); } catch (e) { }
    fbOn = false;
    fbUi();
  }
  function fbReset(reset) {
    if (fbRaf) { cancelAnimationFrame(fbRaf); fbRaf = null; }
    try { au.pause(); } catch (e) { }
    fbOn = false;
    if (reset) fbPos = 0;
    markFull(-1);
    fbUi();
  }
  function fbToggle() {
    if (fbOn) { fbPause(); return; }
    fbStart(fbPos >= D.dur - 0.05 ? 0 : fbPos);
  }
  fbBtn.addEventListener('click', fbToggle);
  fbStopBtn.addEventListener('click', function () { fbReset(true); });
  fbBarEl.addEventListener('click', function (ev) {
    var r = fbBarEl.getBoundingClientRect();
    var frac = Math.min(1, Math.max(0, (ev.clientX - r.left) / Math.max(1, r.width)));
    var t = frac * D.dur;
    if (fbOn) { fbStart(t); return; }
    fbPos = t; fbUi(); markFull(rowAtT(t), true);
    try { au.currentTime = t; } catch (e) { }
  });
  renderFull();
  fbUi();

  /* 完整版文本区只保留整段连播 + 跟读高亮（不提供选词释义） */

  /* 队列：一句按句内暂停点切成若干段 */
  function buildQueue(idxList, repeat) {
    var out = [];
    for (var r = 0; r < repeat; r++) {
      for (var k = 0; k < idxList.length; k++) {
        var i = idxList[k], L = D.lines[i];
        if (!L) continue;
        var cuts = [];
        for (var s = 0; s < D.stops.length; s++) {
          var t = D.stops[s];
          if (t > L.s + 0.05 && t < L.e - 0.05) cuts.push(t);
        }
        cuts.sort(function (a, b) { return a - b; });
        var pts = [L.s].concat(cuts, [L.e]);
        for (var j = 0; j < pts.length - 1; j++) {
          if (pts[j + 1] - pts[j] >= 0.02) out.push({ row: i, s: pts[j], e: pts[j + 1] });
        }
      }
    }
    return out;
  }
  function allRows() { var a = []; for (var i = 0; i < D.lines.length; i++) a.push(i); return a; }

  function setProg(i, frac) {
    if (lastBar >= 0 && bars[lastBar] && lastBar !== i) bars[lastBar].style.width = '0%';
    lastBar = i;
    if (i >= 0 && bars[i]) bars[i].style.width = Math.round(Math.min(1, Math.max(0, frac)) * 100) + '%';
  }
  function markRow(i) {
    if (cur === i) return;
    if (cur >= 0 && rows[cur]) rows[cur].classList.remove('playing');
    cur = i;
    if (i >= 0 && rows[i]) {
      rows[i].classList.add('playing');
      if (!focusRowIfPinned(i)) {
        try { rows[i].scrollIntoView({ block: 'nearest' }); } catch (e) { }
      }
    }
    markFull(i);            // 逐句播放时，底部完整版文本同步高亮同一句
    updateBtns();
  }
  function updateBtns() {
    for (var i = 0; i < btns.length; i++) {
      var isP = playing && cur === i;
      var isW = !playing && pendingIdx >= 0 && units[pendingIdx] && units[pendingIdx].row === i;
      btns[i].textContent = isP ? '⏸ 暂停' : (isW ? '▶ 继续' : '▶ 播放');
      if (rows[i]) {
        rows[i].classList.toggle('waiting', !!isW);
      }
    }
    btnStop.disabled = !playing && pendingIdx < 0;
  }
  function showTime() {
    var p = au.currentTime || 0;
    var tail = playing ? ' · 播放中' : (holding ? ' · 切点暂停（空格继续）' : '');
    elTn.textContent = fmt(p) + ' / ' + fmt(D.dur) + tail;
  }

  function playUnit(idx, off) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (idx < 0 || idx >= units.length) { resetAll(); return; }
    if (fbOn || fbPos > 0.05) fbAbort();     // 逐句播放开始 → 让出整段连播
    var u = units[idx];
    qi = idx; holding = false; pendingIdx = -1;
    try { au.pause(); } catch (e) { }
    au.playbackRate = rate();
    var t = Math.min(u.s + (off || 0), Math.max(u.s, u.e - 0.02));
    try { au.currentTime = t; } catch (e) { }
    markRow(u.row);
    setProg(u.row, (t - u.s) / Math.max(0.001, u.e - u.s));
    playing = true;
    updateBtns();
    var p = au.play();
    if (p && p.catch) p.catch(function () { toast('浏览器拦下了播放，请再点一次'); });
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    showTime();
  }

  function tick() {
    raf = null;
    var u = units[qi];
    if (!u || !playing) return;
    var t = au.currentTime;
    if (t >= u.e - 0.012 || au.ended) { endUnit(); return; }
    setProg(u.row, (t - u.s) / Math.max(0.001, u.e - u.s));
    showTime();
    raf = requestAnimationFrame(tick);
  }

  function endUnit() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    var u = units[qi];
    if (!u) { resetAll(); return; }
    try { au.pause(); } catch (e) { }
    setProg(u.row, 1);
    var nx = qi + 1;
    if (nx >= units.length) { resetAll(); return; }
    playing = false;
    pendingIdx = nx; pendingOff = 0;
    var nu = units[nx];
    markRow(nu.row);
    setProg(nu.row, 0);
    var mode = pmode();
    if (mode === 'hold') { holding = true; updateBtns(); showTime(); return; }
    holding = false;
    updateBtns(); showTime();
    var wait = mode === 'auto' ? Math.max(gapS(), psec()) : gapS();
    timer = setTimeout(function () {
      timer = null;
      if (pendingIdx === nx) playUnit(nx, 0);
    }, wait * 1000);
  }

  function resetAll() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    playing = false; holding = false; pendingIdx = -1; qi = -1;
    markRow(-1); setProg(-1, 0); updateBtns(); showTime();
  }

  function pauseNow() {
    if (!playing) return;
    var u = units[qi];
    var off = u ? Math.max(0, au.currentTime - u.s) : 0;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    try { au.pause(); } catch (e) { }
    playing = false;
    pendingIdx = qi; pendingOff = off;
    updateBtns(); showTime();
  }
  function resume() {
    if (pendingIdx < 0) return false;
    var idx = pendingIdx, off = pendingOff;
    playUnit(idx, off);
    return true;
  }
  function playRow(i) {
    units = buildQueue([i], repN());
    if (!units.length) { toast('这一句还没有对应的音频区间'); return; }
    pendingIdx = -1; pendingOff = 0;
    playUnit(0, 0);
  }
  function clickRow(i) {
    if (playing && cur === i) { pauseNow(); return; }
    if (!playing && pendingIdx >= 0 && units[pendingIdx] && units[pendingIdx].row === i) { resume(); return; }
    playRow(i);
  }
  function playAll() {
    units = buildQueue(allRows(), repN());
    if (!units.length) { toast('没有可播放的句子'); return; }
    pendingIdx = -1; pendingOff = 0;
    playUnit(0, 0);
  }
  function stopAll() {
    try { au.pause(); } catch (e) { }
    try { au.currentTime = 0; } catch (e) { }
    fbReset(true);                 // 「⏹ 停止」同时停掉整段连播
    resetAll();
  }

  document.getElementById('playAll').addEventListener('click', playAll);
  btnStop.addEventListener('click', stopAll);
  au.addEventListener('error', function () { toast('音频无法播放，试试换一个浏览器打开'); });
  document.getElementById('rep').addEventListener('change', function () { if (!playing) resetAll(); });
  document.getElementById('rate').addEventListener('change', function () { au.playbackRate = rate(); });

  // 一键显示 / 隐藏句子（原文）
  var sx = document.getElementById('showTx');
  try {
    var sxv = localStorage.getItem('asplit_share_text');
    sx.checked = sxv == null ? true : sxv === '1';
  } catch (e) { }
  function applyTx() {
    document.body.classList.toggle('noTx', !sx.checked);
    try { localStorage.setItem('asplit_share_text', sx.checked ? '1' : '0'); } catch (e) { }
  }
  sx.addEventListener('change', applyTx);
  applyTx();

  // 显示 / 隐藏全部释义
  var st = document.getElementById('showTr');
  try {
    var sv = localStorage.getItem('asplit_share_trans');
    st.checked = sv == null ? true : sv === '1';
  } catch (e) { }
  function applyTr() {
    document.body.classList.toggle('noTr', !st.checked);
    try { localStorage.setItem('asplit_share_trans', st.checked ? '1' : '0'); } catch (e) { }
  }
  st.addEventListener('change', applyTr);
  applyTr();

  /* ---- 左上角名称：点名字 / ✎ → 验证密码 → 改名（离线校验，密码以散列值内嵌） ---- */
  var rnPop = document.getElementById('rnPop');
  var rnStep1 = document.getElementById('rnStep1'), rnStep2 = document.getElementById('rnStep2');
  var rnPass = document.getElementById('rnPass'), rnName = document.getElementById('rnName');
  var rnErr = document.getElementById('rnErr');
  function pageName() {
    var b = document.getElementById('brandName');
    return b ? String(b.textContent || '').trim() : '逐句听练';
  }
  function applyName(n) {
    document.title = n + ' · 逐句听练';
    var b = document.getElementById('brandName');
    if (b) b.textContent = n;
  }
  // 32 位 FNV-1a（带盐）：明文密码不写进这个页面，避免被直接翻源码看到
  function pwHash(s) {
    var h = 2166136261, t = 'asplit-ren-v1:' + s, i;
    for (i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  function pwOk(s) { return pwHash(String(s || '')) === 1001612192; }
  function safeFileName(n) {
    var s = String(n || ''), out = '', i, c, k;
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i); k = s.charCodeAt(i);
      out += (k < 32 || k === 92 || '/:*?"<>|'.indexOf(c) >= 0) ? '_' : c;
    }
    while (out.charAt(0) === '.') out = out.slice(1);
    out = out.trim();
    return out.slice(0, 80) || '逐句听练';
  }
  function openRename() {
    rnPop.hidden = false;
    rnStep1.hidden = false; rnStep2.hidden = true;
    rnErr.hidden = true; rnPass.value = '';
    setTimeout(function () { rnPass.focus(); }, 30);
  }
  function closeRename() { rnPop.hidden = true; }
  function checkPw() {
    if (!pwOk(rnPass.value)) { rnErr.hidden = false; rnPass.focus(); rnPass.select(); return; }
    rnErr.hidden = true; rnStep1.hidden = true; rnStep2.hidden = false;
    rnName.value = pageName();
    setTimeout(function () { rnName.focus(); rnName.select(); }, 30);
  }
  // 生成「改名副本」：克隆整页，但把运行时动态渲染的内容清空，重新打开时脚本会自建
  function renamedHtml(n) {
    var c = document.documentElement.cloneNode(true);
    var t = c.querySelector('title'); if (t) t.textContent = n + ' · 逐句听练';
    var b = c.querySelector('#brandName'); if (b) b.textContent = n;
    var l = c.querySelector('#list'); if (l) l.innerHTML = '';
    var f = c.querySelector('#fullTextArea'); if (f) f.innerHTML = '';
    var ff = c.querySelector('#fbFill'); if (ff) ff.setAttribute('style', 'width:0');
    var tn = c.querySelector('#tn'); if (tn) tn.textContent = '00:00.0 / 00:00.0';
    var ft = c.querySelector('#fbTime'); if (ft) ft.textContent = '00:00.0 / 00:00.0';
    var fp = c.querySelector('#fbPlay'); if (fp) fp.textContent = '▶ 播放完整音频';
    var sb = c.querySelector('#stop'); if (sb) sb.setAttribute('disabled', '');
    var fs = c.querySelector('#fbStop'); if (fs) fs.setAttribute('disabled', '');
    var ps = c.querySelectorAll('.play'), i;
    for (i = 0; i < ps.length; i++) ps[i].textContent = '▶ 播放';
    var tp = c.querySelector('#toast'); if (tp) { tp.textContent = ''; tp.setAttribute('class', 'toast'); }
    // 改名弹窗本身此刻是开着的，副本里必须复位成关闭 + 第一步，避免新网页一打开就弹框
    var rp = c.querySelector('#rnPop'); if (rp) rp.setAttribute('hidden', '');
    var s1 = c.querySelector('#rnStep1'); if (s1) s1.removeAttribute('hidden');
    var s2 = c.querySelector('#rnStep2'); if (s2) s2.setAttribute('hidden', '');
    var er = c.querySelector('#rnErr'); if (er) er.setAttribute('hidden', '');
    return '<!DOCTYPE html>' + String.fromCharCode(10) + c.outerHTML;
  }
  function saveRename() {
    var n = String(rnName.value || '').trim();
    if (n.slice(-5).toLowerCase() === '.html') n = n.slice(0, -5);
    else if (n.slice(-4).toLowerCase() === '.htm') n = n.slice(0, -4);
    if (!n) { toast('名称不能为空'); return; }
    applyName(n);
    var fn = safeFileName(n) + '.html';
    try {
      var url = URL.createObjectURL(new Blob([renamedHtml(n)], { type: 'text/html;charset=utf-8' }));
      var a = document.createElement('a');
      a.href = url; a.download = fn;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      toast('已改名，并下载了新网页：' + fn);
    } catch (e) { toast('名称已改，但生成新网页失败（不影响当前显示）'); }
    closeRename();
  }
  document.getElementById('brandName').addEventListener('click', openRename);
  document.getElementById('rnEdit').addEventListener('click', openRename);
  document.getElementById('rnX').addEventListener('click', closeRename);
  document.getElementById('rnCancel').addEventListener('click', closeRename);
  document.getElementById('rnOk').addEventListener('click', checkPw);
  document.getElementById('rnSave').addEventListener('click', saveRename);
  rnPop.addEventListener('click', function (ev) { if (ev.target === rnPop) closeRename(); });
  rnPass.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); checkPw(); } });
  rnName.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); saveRename(); } });
  // 只暴露自检需要的两个只读/生成函数，不暴露 applyName 等，避免绕过密码
  window.__shareDbg = { renamedHtml: renamedHtml, pwOk: pwOk };

  document.addEventListener('keydown', function (ev) {
    if (!rnPop.hidden && ev.key === 'Escape') { ev.preventDefault(); closeRename(); return; }
    var el = ev.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
    if (ev.key === ' ' || ev.code === 'Space') {
      ev.preventDefault();
      if (playing) pauseNow();
      else if (fbOn) fbPause();
      else if (resume()) { }
      else if (fbPos > 0.05) fbStart(fbPos);
      else playAll();
    } else if (ev.key === 'Escape') {
      pauseNow();
    }
  });

  showTime();
})();
</script>
</body>
</html>`.replace(/__TITLE__/g, title).replace('__DATA__', json).replace('__AUDIO__', audioUrl || '')
      .replace('__VER__', '版本 ' + APP_VER + ' · 生成于 ' + new Date().toLocaleString('zh-CN', { hour12: false }));
  }

  // 文件名输入框：可改。改完立即重打包，分享页里的标题也跟着用这个名字
  function shareTitle() {
    var el = $('#shareName');
    var v = el ? String(el.value || '').trim() : '';
    if (!v) v = '逐句听练';
    return v.replace(/\.html?$/i, '');
  }
  function shareFileName() { return safeName(shareTitle(), 80) + '.html'; }

  function rebuildShare() {
    var note = $('#shareNote'), elLines = $('#shareLines'), elSize = $('#shareSize');
    var bSave = $('#shareSave'), bOpen = $('#shareOpen');
    if (!shareAudioUrl || !shareJson) return;
    var html = sharePageHtml(esc(shareTitle()), shareJson, shareAudioUrl);
    shareBlob = new Blob([html], { type: 'text/html;charset=utf-8' });
    shareName = shareFileName();
    var mb = shareBlob.size / 1048576;
    if (elSize) elSize.textContent = mb < 0.1 ? shareBlob.size + ' B' : mb.toFixed(1) + ' MB';
    if (note) note.textContent = (mb > 40
      ? '提示：文件偏大（' + mb.toFixed(0) + ' MB），微信里可能发不出去，建议先压缩音频或改用网盘 / 邮件发送。'
      : '用法：把下载到的 .html 文件发给对方（微信 / 邮件 / 网盘都行），对方双击用 Chrome、Edge、Safari 打开即可；不需要联网，也不需要共享本机的 server.js。分享页里显示的标题就是这个文件名。')
      + '（分享页版本 ' + APP_VER + '，页脚可见）';
    if (bSave) bSave.disabled = false;
    if (bOpen) bOpen.disabled = false;
  }

  function openShare() {
    if (!state.buf) { toast('请先载入音频'); return; }
    if (!state.lines.length) { toast('还没有句子，先输入文本'); return; }
    var pop = $('#sharePop');
    var note = $('#shareNote');
    var elName = $('#shareName'), elLines = $('#shareLines'), elSize = $('#shareSize');
    var bSave = $('#shareSave'), bOpen = $('#shareOpen');
    pop.hidden = false;
    note.textContent = '';
    if (elName) { elName.disabled = true; elName.value = ''; }
    if (elLines) elLines.textContent = '正在打包音频与文本…（音频越大越慢，请稍等）';
    if (elSize) elSize.textContent = '—';
    bSave.disabled = true; bOpen.disabled = true;
    if (shareUrl) { try { URL.revokeObjectURL(shareUrl); } catch (e) { } shareUrl = ''; }

    var data = shareData();
    audioToDataUrl(function (url) {
      if (!url) {
        if (elLines) elLines.textContent = '读不到原始音频字节（可能是浏览器限制）。请重新导入一次这个音频文件，再点分享。';
        return;
      }
      shareAudioUrl = url;
      shareJson = JSON.stringify(data)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
      var nTr = data.lines.filter(function (l) { return l.x; }).length;
      var defName = (state.fileName || '逐句听练').replace(/\.[^.]+$/, '') || '逐句听练';
      if (elName) { elName.value = defName; elName.disabled = false; }
      if (elLines) elLines.innerHTML = '<b>' + data.lines.length + '</b> 句 · 释义 <b>' + nTr + '</b> 条 · 音频 <b>' + fmt(data.dur) + '</b>';
      rebuildShare();
    });
  }

  function closeShare() {
    var pop = $('#sharePop');
    if (pop) pop.hidden = true;
  }

  /* ---------- 本地保存 ---------- */
  function savePrefs() {
    try {
      localStorage.setItem('asplit_prefs', JSON.stringify({
        follow: $('#followPlay') ? $('#followPlay').checked : true,
        snapDrag: dragSnapOn(),
        pauseMode: pauseMode(), pauseSec: pauseSec()
      }));
    } catch (e) { }
  }
  function loadPrefs() {
    try {
      var o = JSON.parse(localStorage.getItem('asplit_prefs') || '{}');
      if (!o || typeof o !== 'object') return;
      state.pauseMode = o.pauseMode || 'hold';
      state.pauseSec = o.pauseSec == null ? 1 : o.pauseSec;
      var pm = $('#pauseMode'), ps = $('#pauseSec'), fp = $('#followPlay'), sd = $('#snapDrag');
      if (pm) pm.value = state.pauseMode;
      if (ps) ps.value = state.pauseSec;
      if (fp) fp.checked = o.follow !== false;
      if (sd) sd.checked = o.snapDrag !== false;
    } catch (e) { }
  }

  function saveState() {
    if (!state.fileName) return;
    try {
      localStorage.setItem('asplit_' + state.fileName + '_' + state.fileSize, JSON.stringify({
        lines: state.lines, edges: state.edges, boundaries: state.boundaries, stops: state.stops, manual: state.manual,
        trans: state.trans, repeat: state.repeat, gap: state.gap, rate: state.rate
      }));
    } catch (e) { }
  }
  // 规则归一化：分句必须有分割线——没有切点线的句子分界一律取消，前后两句合并成一句。
  // 用于修复旧存档（之前「句子播放里拆句」只加分界不加切点线留下的状态）
  function normalizeMarks() {
    var es = (state.edges || []).slice().sort(function (a, b) { return a - b; });
    var bs = (state.boundaries || []).slice();
    var kept = [], merged = 0;
    for (var i = 0; i < es.length; i++) {
      var e = es[i], has = false;
      for (var j = 0; j < bs.length; j++) {
        if (Math.abs(bs[j] - e) < 0.35) { has = true; break; }
      }
      if (has) { kept.push(e); continue; }
      // 这条分界没有切点线 → 它前后的两句本就是一句，合并文本
      var k = kept.length;   // kept 里有 k 条分界 → 分界后面那句是第 k+1 句（下标 k）
      if (k >= 0 && k + 1 < state.lines.length) {
        state.lines.splice(k, 2, joinText(state.lines[k], state.lines[k + 1]));
        merged++;
      }
    }
    if (merged || kept.length !== es.length) {
      state.edges = kept;
      state.boundaries = kept.slice();
      writeArea();
      if (merged) toast('已按「分句必须有分割线」修复：合并了 ' + merged + ' 处没有分割线的句子');
    }
  }

  function restoreState() {
    try {
      var s = localStorage.getItem('asplit_' + state.fileName + '_' + state.fileSize);
      if (!s) return false;
      var o = JSON.parse(s);
      if (!o || !o.lines || !o.lines.length) return false;
      state.lines = o.lines;
      state.boundaries = o.boundaries || [];
      // 旧存档没有 edges：那时切点就等于句子分界，直接迁移
      state.edges = Array.isArray(o.edges) ? o.edges : state.boundaries.slice();
      state.stops = o.stops || [];
      state.manual = !!o.manual;
      state.trans = o.trans && typeof o.trans === 'object' ? o.trans : {};
      if (o.repeat != null) state.repeat = o.repeat;
      if (o.gap != null) state.gap = o.gap;
      if (o.rate != null) state.rate = o.rate;
      normalizeMarks();          // 旧存档：没有切点线的分界 → 前后两句合并
      writeArea();
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    bindWavePin();
    bindPinEditor();
    var btnFinish = $('#btnFinish');
    if (btnFinish) btnFinish.addEventListener('click', function () {
      if (!state.lines.length) { toast('还没有句子，先输入文本'); return; }
      setFinish(true);
      toast('已进入播放页 · 空格 播放/暂停 · Esc 返回编辑');
    });
    var eb = $('#editBack');
    if (eb) eb.addEventListener('click', function () { setFinish(false); });

    // 播放页顶栏：一键显示/隐藏句子 · 一键显示/隐藏全部释义 · 分享 · 返回编辑
    var sTx = $('#showText');
    if (sTx) {
      try {
        var tv = localStorage.getItem('asplit_showText');
        sTx.checked = tv == null ? true : tv === '1';
      } catch (e) { }
      document.body.classList.toggle('noText', !sTx.checked);   // 打开页面即应用上次的选择
      sTx.addEventListener('change', function () {
        document.body.classList.toggle('noText', !sTx.checked);
        try { localStorage.setItem('asplit_showText', sTx.checked ? '1' : '0'); } catch (e) { }
      });
    }
    var st = $('#showTrans');
    if (st) {
      try {
        var sv = localStorage.getItem('asplit_showTrans');
        st.checked = sv == null ? true : sv === '1';
      } catch (e) { }
      st.addEventListener('change', function () {
        applyTransVisible();
        try { localStorage.setItem('asplit_showTrans', st.checked ? '1' : '0'); } catch (e) { }
      });
    }
    var bShare = $('#btnShare');
    if (bShare) bShare.addEventListener('click', openShare);
    var sn = $('#shareName');
    if (sn) sn.addEventListener('input', function () {
      if (shareAudioUrl && shareJson) rebuildShare();   // 改名即时生效：文件名 + 分享页标题
    });
    var sc = $('#shareClose');
    if (sc) sc.addEventListener('click', closeShare);
    var sp = $('#sharePop');
    if (sp) sp.addEventListener('click', function (ev) { if (ev.target === sp) closeShare(); });
    var bs = $('#shareSave');
    if (bs) bs.addEventListener('click', function () {
      if (!shareBlob) { toast('还没打包好，稍等一下'); return; }
      download(shareBlob, shareName);
      toast('已下载 ' + shareName + '，发给对方双击打开即可');
    });
    var bo = $('#shareOpen');
    if (bo) bo.addEventListener('click', function () {
      if (!shareBlob) { toast('还没打包好，稍等一下'); return; }
      if (shareUrl) { try { URL.revokeObjectURL(shareUrl); } catch (e) { } }
      shareUrl = URL.createObjectURL(shareBlob);
      window.open(shareUrl, '_blank');
    });

    var audioInput = $('#audioFile');
    $('#dropAudio').addEventListener('click', function () { audioInput.click(); });
    audioInput.addEventListener('change', function (e) {
      if (e.target.files[0]) loadAudioFile(e.target.files[0]);
    });

    var textInput = $('#textFile');
    $('#dropText').addEventListener('click', function () { textInput.click(); });
    textInput.addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (f) f.text().then(function (t) { importText(t); });
      e.target.value = '';
    });

    [['#dropAudio', '#audioFile'], ['#dropText', '#textFile']].forEach(function (pair) {
      var zone = $(pair[0]);
      ['dragenter', 'dragover'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('over'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('over'); });
      });
      zone.addEventListener('drop', function (e) {
        var f = e.dataTransfer.files[0];
        if (!f) return;
        if (pair[0] === '#dropAudio') loadAudioFile(f);
        else f.text().then(function (t) { importText(t); });
      });
    });

    $('#linesText').addEventListener('input', function (e) {
      if (syncing) return;
      // 不回写文本框，避免打断输入/中文输入法
      applyText(e.target.value, { writeBack: false });
    });

    // 粘贴：复制来的文本里常有空行，插入前先扔掉，只留有文字的行
    $('#linesText').addEventListener('paste', function (e) {
      var cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      var t = cd.getData('text');
      if (t == null || t === '') return;
      var cleaned = stripBlankLines(t);
      if (cleaned.dropped === 0) return;         // 没空行就走浏览器默认粘贴
      e.preventDefault();
      var el = e.target;
      var s = el.selectionStart == null ? el.value.length : el.selectionStart;
      var en = el.selectionEnd == null ? s : el.selectionEnd;
      var next = el.value.slice(0, s) + cleaned.text + el.value.slice(en);
      el.value = next;
      var caret = s + cleaned.text.length;
      try { el.setSelectionRange(caret, caret); } catch (err) { }
      applyText(next, { writeBack: false });
      toast('已忽略 ' + cleaned.dropped + ' 个空行，只按有文字的行分句');
    });

    // 手工触发：把当前文本框内容按当前口径（句号 / 句号+逗号）拆成一句一行
    $('#btnSplitPunct').addEventListener('click', function () {
      var raw = $('#linesText').value;
      if (!raw.trim()) { toast('文本框还没有内容'); return; }
      var mode = punctMode();
      var how = mode === 'clause' ? '按句号 + 逗号' : '按句号';
      var before = parseLines(raw).length;
      var lines = splitByPunct(raw, mode);
      if (lines.length === before) { toast('没找到需要拆开的' + (mode === 'clause' ? '句号或逗号' : '句号')); return; }
      setText(lines.join('\n'));
      toast(how + '拆成 ' + lines.length + ' 句');
    });
    var pmSel = $('#punctMode');
    if (pmSel) pmSel.addEventListener('change', syncPunctUI);

    var deb = null;
    ['#sens', '#minSil', '#smooth'].forEach(function (sel) {
      $(sel).addEventListener('input', function () {
        clearTimeout(deb);
        deb = setTimeout(function () {
          if (!state.buf) return;
          detect();
          if (!state.manual) autoAlign(); else { drawStatic(); updateCounts(); }
        }, 260);
      });
    });
    ['#tail', '#minSeg'].forEach(function (sel) {
      $(sel).addEventListener('change', function () {
        if (!state.buf) return;
        if (!state.manual) autoAlign();
        drawStatic();
      });
    });

    $('#zoomR').addEventListener('input', function (e) {
      setZoom(sliderToZoom(parseFloat(e.target.value) || 0));
    });
    $('#zoomOut').addEventListener('click', function () { setZoom(state.zoom / 1.6); });
    $('#zoomIn').addEventListener('click', function () { setZoom(state.zoom * 1.6); });
    $('#zoomFit').addEventListener('click', function () { setZoom(1); });
    $('#followPlay').addEventListener('change', savePrefs);
    $('#pauseMode').addEventListener('change', function () { state.pauseMode = this.value; savePrefs(); });
    $('#pauseSec').addEventListener('change', function () { state.pauseSec = pauseSec(); savePrefs(); });

    $('#btnDetect').addEventListener('click', function () {
      if (!state.buf) { toast('请先载入音频'); return; }
      detect();
      if (state.manual) { drawStatic(); updateCounts(); }
      else autoAlign();
      toast('已重新检测：气口 ' + state.pauses.length + ' 个，阈值 ' + state.thr.toFixed(1) + ' dB');
    });
    $('#btnAlign').addEventListener('click', function () {
      if (!state.buf) { toast('请先载入音频'); return; }
      if (!state.lines.length) { toast('请先输入文本'); return; }
      state.manual = false;                 // 手动点按钮 = 明确要求按文本重切
      autoAlign(true);
      toast('已按文本 ' + state.lines.length + ' 行切成 ' + segments().length + ' 段（气口只做了位置微调）');
    });
    // 三个标记操作：工具栏按钮与键盘快捷键（C / P / X）共用
    function actAddCut(t, snap) {
      if (t == null) { toast('先在波形上点一下确定位置'); return; }
      if (addBoundaryAt(t, snap)) {
        toast(snap ? ('已加切点 · 吸附到气口 ' + fmt(t) + ' · 该句拆成两句') : ('已加切点（' + fmt(t) + '）· 该句已拆成两句，序号已更新'));
      }
    }
    function actAddStop(t) {
      if (t == null) { toast('先在波形上点一下确定位置'); return; }
      if (addStopAt(t)) toast('已加暂停点 · 播到这里会停一下');
    }
    function actDelMark(t) {
      if (t == null) { toast('先在波形上点一下确定位置'); return; }
      var kind = removeBoundaryNear(t);
      if (kind === 'merge') toast('已删除切点 · 前后两句已合并成一句');
      else if (kind === 'hard') toast('已删除切点 · 该处不是句子分界，句子不受影响');
      else if (kind === 'soft') toast('已删除暂停点');
      else toast('没有可删除的标记');
    }
    $('#btnAddCut').addEventListener('click', function () { actAddCut(playhead); });
    $('#btnAddStop').addEventListener('click', function () { actAddStop(playhead); });
    $('#btnDelCut').addEventListener('click', function () { actDelMark(playhead); });
    $('#btnClearStop').addEventListener('click', function () {
      if (!state.stops.length) { toast('当前没有暂停点'); return; }
      state.stops = [];
      afterAlign();
      toast('已清空全部暂停点');
    });
    $('#btnPauseToStop').addEventListener('click', function () {
      if (!state.buf) { toast('请先载入音频'); return; }
      if (!state.pauses.length) { toast('没有检测到气口'); return; }
      var n = addStopAtBatch(state.pauses.map(boundaryPoint));
      toast(n ? ('已把 ' + n + ' 个气口转成暂停点') : '这些气口上已经有标记了');
    });
    $('#btnSnapAll').addEventListener('click', function () {
      if (!state.buf) { toast('请先载入音频'); return; }
      snapAllBoundaries();
    });
    $('#btnClearCut').addEventListener('click', function () {
      if (!state.boundaries.length && !state.stops.length) { toast('音轨上没有标记'); return; }
      state.boundaries = [];
      state.stops = [];
      afterAlign();
      toast('已清空音轨上的切点与暂停点（句子与文本不受影响）');
    });

    // 波形交互：单击=定位 / 拖动=平移 / 双击=加标记 / Alt+单击=删标记 / 滚轮=缩放
    var wrap = $('#waveWrap');
    function xToTime(clientX) {
      var cv = $('#wave');
      var rect = cv.getBoundingClientRect();
      var x = clamp(clientX - rect.left, 0, Math.max(1, rect.width));
      viewEnsure();
      if (!view.span) return 0;
      return clamp(view.start + (x / rect.width) * view.span, 0, dur());
    }
    var drag = null;
    wrap.addEventListener('pointerdown', function (e) {
      if (!state.buf) return;
      if (e.button != null && e.button !== 0) return;
      // 先判断是否按在分割线上 → 进入拖动标记模式
      var hit = hitMarker(e.clientX);
      if (hit) {
        if (isRunning()) stopPlayback(true);   // 拖动切点时先停下，避免播放队列错乱
        dragMark = hit;
        dragMark.moved = false;
        dragMark.free = !!e.altKey;
        dragMark.snapped = false;
        dragMark.t0 = hit.t;          // 记录起点，吸附时跳过它所在的那个气口
        updateWaveCursor(e.clientX);
        try { wrap.setPointerCapture(e.pointerId); } catch (err) { }
        drawOverlay();
        return;
      }
      drag = { x: e.clientX, moved: 0 };
    });
    // 悬停在分割线上时给出「可左右拖」的光标
    function updateWaveCursor(clientX) {
      if (!state.buf) { wrap.style.cursor = ''; return; }
      wrap.style.cursor = hitMarker(clientX) ? 'ew-resize' : 'pointer';
    }
    wrap.addEventListener('pointermove', function (e) {
      if (drag || dragMark || !state.buf) return;
      var h = hitMarker(e.clientX);
      var changed = (!h !== !hoverMark) ||
        (h && hoverMark && (h.kind !== hoverMark.kind || h.idx !== hoverMark.idx || h.t !== hoverMark.t));
      hoverMark = h;
      updateWaveCursor(e.clientX);
      if (changed) drawOverlay();
    });
    wrap.addEventListener('pointerleave', function () {
      if (hoverMark) { hoverMark = null; drawOverlay(); }
    });
    window.addEventListener('pointermove', function (e) {
      if (dragMark) {
        var r = dragMarkerTime(dragMark, xToTime(e.clientX), dragMark.free);
        if (Math.abs(r.t - dragMark.t) > 1e-6 || r.snapped !== dragMark.snapped) {
          dragMark.t = r.t;
          dragMark.snapped = r.snapped;
          dragMark.moved = true;
          applyMarkerMove(dragMark, r.t);
          // 拖到视窗边缘时自动跟着滚，方便继续往远处拖
          var rct = wrap.getBoundingClientRect(), edge = 26;
          if (state.zoom > 1.002) {
            if (e.clientX < rct.left + edge) panView(-view.span * 0.03);
            else if (e.clientX > rct.right - edge) panView(view.span * 0.03);
          }
          drawStatic();
        }
        return;
      }
      if (!drag) return;
      var dx = e.clientX - drag.x;
      if (Math.abs(dx) > 3) drag.moved = Math.abs(dx);
      if (drag.moved && state.zoom > 1.002) {
        var w = wrap.clientWidth || 1;
        panView(-(dx / w) * view.span);
        drag.x = e.clientX;
      }
    });
    window.addEventListener('pointerup', function (e) {
      if (dragMark) {
        var mk = dragMark;
        dragMark = null;
        if (mk.moved) {
          applyMarkerMove(mk, mk.t);
          hoverMark = { kind: mk.kind, idx: mk.idx, t: mk.t };
          afterAlign(mk.kind === 'hard' ? mk.idx : rowIndexAt(mk.t));
          toast((mk.kind === 'hard' ? '切点已移到 ' : '暂停点已移到 ') + fmt(mk.t) +
            (mk.snapped ? ' · 已吸附到最近气口' : ' · 该处没有气口，可点「切点吸附气口」修正'));
          return;
        }
        // 按在线上但没拖动 → 当作点击定位
        if (!state.buf) return;
        seekTo(mk.t);
        return;
      }
      if (!drag) return;
      var moved = drag.moved;
      drag = null;
      if (moved || !state.buf) return;
      seekTo(xToTime(e.clientX));
    });
    // 右键单击 = 删除最近的标记（按屏幕像素距离，不超过 14px，避免误删远处的切点）
    // 取代旧的「Alt + 单击」——Alt 单击会和 Alt + 双击（加暂停点）冲突：
    // 双击会先触发两次 Alt 单击，把附近切点误删掉
    wrap.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (!state.buf) return;
      var hit = hitMarker(e.clientX, 14);
      if (!hit) { toast('附近没有标记'); return; }
      if (hit.kind === 'hard') {
        var kind = removeBoundaryNear(hit.t);
        if (kind === 'merge') toast('已删除切点（' + fmt(hit.t) + '）· 前后两句已合并成一句');
        else toast('已删除切点（' + fmt(hit.t) + '）· 该处不是句子分界，句子不受影响');
      } else {
        state.stops.splice(hit.idx, 1);
        state.manual = true;
        afterAlign(rowIndexAt(hit.t));
        toast('已删除暂停点（' + fmt(hit.t) + '）');
      }
    });
    wrap.addEventListener('wheel', function (e) {
      if (!state.buf) return;
      e.preventDefault();
      viewEnsure();
      var dy = e.deltaY || 0, dx = e.deltaX || 0;
      // ⌘ / Ctrl / Alt + 滚轮 = 以光标为中心缩放大小
      if (e.ctrlKey || e.metaKey || e.altKey) {
        var anchor = xToTime(e.clientX);
        setZoom(state.zoom * Math.pow(1.0015, -dy), anchor);
        return;
      }
      // 滚轮 / 触控板 = 左右移动波形位置（不改变大小）
      var delta = (Math.abs(dx) > Math.abs(dy) ? dx : dy) * (e.deltaMode === 1 ? 16 : 1);
      panView((delta / 320) * view.span);
    }, { passive: false });
    wrap.addEventListener('dblclick', function (e) {
      if (!state.buf) return;
      var t = xToTime(e.clientX);
      if (e.altKey) {
        // Alt + 双击 = 加暂停点（删除改用右键，二者不再冲突）
        addStopAt(t);
        return;
      }
      if (addBoundaryAt(t, e.shiftKey)) toast('已加切点（' + fmt(t) + '）· 该句拆成两句，序号已更新');
    });

    // 底部总览条：点击/拖动快速定位视窗
    var mini = $('#mini');
    if (mini) {
      var mdrag = false;
      function miniMove(e) {
        if (!state.buf) return;
        var r = mini.getBoundingClientRect();
        var t = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1) * dur();
        centerView(t);
      }
      mini.addEventListener('pointerdown', function (e) {
        mdrag = true;
        try { mini.setPointerCapture(e.pointerId); } catch (err) { }
        miniMove(e);
      });
      mini.addEventListener('pointermove', function (e) { if (mdrag) miniMove(e); });
      mini.addEventListener('pointerup', function () { mdrag = false; });
      mini.addEventListener('pointercancel', function () { mdrag = false; });
    }

    // 空格 = 播放 / 暂停；C / P / X = 在播放头处加切点 / 加暂停点 / 删除最近标记
    document.addEventListener('keydown', function (ev) {
      var el = ev.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;   // 不抢系统/浏览器快捷键
      if (ev.key === 'Escape' && document.body.classList.contains('finish')) {
        setFinish(false);
        return;
      }
      if (ev.key === ' ' || ev.code === 'Space') {
        ev.preventDefault();
        if (fullActive) { fullToggle(); return; }   // 整段连播时空格只控制它
        togglePlay();
        return;
      }
      if (!state.buf) return;
      var k = (ev.key || '').toLowerCase();
      if (k === 'c') { ev.preventDefault(); actAddCut(playhead, ev.shiftKey); }
      else if (k === 'p') { ev.preventDefault(); actAddStop(playhead); }
      else if (k === 'x' || ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); actDelMark(playhead); }
    });

    $('#btnPlayAll').addEventListener('click', function () { playRows(rowSequence(0)); });
    $('#btnPlayFrom').addEventListener('click', function () { playRows(rowSequence(Math.max(0, state.selected))); });
    $('#btnStop').addEventListener('click', function () {
      stopPlayback();
      fullStop(true);
      toast('⏹ 停止');
    });

    // 播放页底部：完整版文本 · 整段连播
    var fbPlay = $('#fbPlay');
    if (fbPlay) fbPlay.addEventListener('click', fullToggle);
    var fbStop = $('#fbStop');
    if (fbStop) fbStop.addEventListener('click', function () { fullStop(true); });
    var fbBar = $('#fbBar');
    if (fbBar) fbBar.addEventListener('click', function (ev) {
      if (!state.buf) return;
      var r = fbBar.getBoundingClientRect();
      var t = clamp((ev.clientX - r.left) / Math.max(1, r.width), 0, 1) * dur();
      if (fullOn) fullPlay(t);
      else { fullPos = t; fullUi(); }
    });
    $('#btnTransAll').addEventListener('click', fetchAllTrans);
    $('#dictChip').addEventListener('click', function () {
      detectDict(function (ok) { toast(ok ? '在线词典已连接' : '在线词典仍未连上，请稍后重试'); });
    });
    $('#expTrans').addEventListener('change', saveState);

    ['#repeat', '#gap', '#rate'].forEach(function (s) {
      $(s).addEventListener('change', saveState);
    });

    $('#btnExportZip').addEventListener('click', exportZip);
    $('#btnExportTxt').addEventListener('click', function () {
      var ps = pairs();
      if (!ps.length) { toast('没有可导出的句子'); return; }
      download(new Blob([new TextEncoder().encode(buildTxt(ps))], { type: 'text/plain;charset=utf-8' }),
        safeName(state.fileName.replace(/\.[^.]+$/, '') || 'audio', 60) + '_对照文本.txt');
    });
    $('#btnExportSrt').addEventListener('click', function () {
      var ps = pairs();
      if (!ps.length) { toast('没有可导出的句子'); return; }
      download(new Blob([new TextEncoder().encode(buildSrt(ps))], { type: 'application/x-subrip' }),
        safeName(state.fileName.replace(/\.[^.]+$/, '') || 'audio', 60) + '.srt');
    });

    window.addEventListener('resize', function () {
      if (state.buf) drawStatic();
    });
  }

  // 初始示例文本
  function init() {
    bind();
    bindWordPopup();
    loadPrefs();
    $('#linesText').value = '';
    syncZoomUI();
    syncPunctUI();
    renderRows();
    paintChip();
    detectDict();
  }
  init();

  // 调试入口（便于脚本化自检，不影响页面）
  window.__asplit = {
    state: state, segments: segments, detect: detect, autoAlign: autoAlign,
    setText: setText, applyText: applyText, parseLines: parseLines,
    playFrom: playFrom, playRows: playRows, togglePlay: togglePlay, playRow: playRow,
    toggleRow: toggleRow, resumePlay: resumePlay, unitsFor: unitsFor,
    seekTo: seekTo, pausePlayback: pausePlayback, stopPlayback: stopPlayback,
    isRunning: isRunning, isHolding: isHolding, activeRowRef: function () { return activeRow; },
    rowIndexAt: rowIndexAt, playheadRef: function () { return playhead; },
    viewRef: function () { return view; }, setZoom: setZoom, centerView: centerView,
    pausePoints: pausePoints, stopsIn: stopsIn, addStopAt: addStopAt,
    removeBoundaryNear: removeBoundaryNear, pauseModeRef: pauseMode,
    computeEnvelope: computeEnvelope, computeMinMax: computeMinMax,
    sliceToWav: sliceToWav, buildZip: buildZip, boundaryPoint: boundaryPoint, pairs: pairs,
    buildTxt: buildTxt, buildSrt: buildSrt,
    addBoundaryAt: addBoundaryAt, removeBoundaryNear: removeBoundaryNear,
    nearestPauseBp: nearestPauseBp, snapAllBoundaries: snapAllBoundaries,
    splitLineAtTime: splitLineAtTime, fitEdges: fitEdges,
    selectedWord: selectedWord, getTrans: getTrans, setTrans: setTrans,
    joinText: joinText, showWordPop: showWordPop, hidePop: hidePop, dict: dict,
    loadAudioFile: loadAudioFile, fetchTrans: fetchTrans, fetchAllTrans: fetchAllTrans,
    detectDict: detectDict, renderRows: renderRows, select: select,
    splitRowAtCaret: splitRowAtCaret, splitLineAtTime: splitLineAtTime,
    hitMarker: hitMarker, dragMarkerTime: dragMarkerTime, applyMarkerMove: applyMarkerMove,
    timeToClientX: timeToClientX, snapRadius: snapRadius,
    markRef: function () { return { hover: hoverMark, drag: dragMark }; },
    previewSplitTime: previewSplitTime, detectSplitTime: detectSplitTime,
    caretRatio: caretRatio, charWeight: charWeight, minSegSec: minSegSec,
    ghostRef: function () { return ghostTimeForRow(ghostRow); },
    splitByPunct: splitByPunct, importText: importText, updateWavePin: updateWavePin,
    parseLines: parseLines, stripBlankLines: stripBlankLines,
    textWeight: textWeight, textTargets: textTargets, speechSpan: speechSpan,
    refineEdge: refineEdge, normalizeMarks: normalizeMarks, restoreState: restoreState,
    panView: panView, pinTopOffset: pinTopOffset,
    shareData: shareData, sharePageHtml: sharePageHtml, openShare: openShare, rebuildShare: rebuildShare,
    fullText: fullText, fullTextFill: fullTextFill, fullPlay: fullPlay, fullStop: fullStop,
    fullPause: fullPause, fullToggle: fullToggle,
    fullState: function () { return { on: fullOn, active: fullActive, pos: fullPos }; }
  };
})();
