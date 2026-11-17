/**
 * 单词释义抓取（共享工具）
 *   释义：有道词典 suggest 接口（JSONP，无跨域限制），返回「词性 + 中文释义」，
 *         例：n. （非正式的）谈话，交谈；<旧>社交，交际
 *   音标：dictionaryapi.dev（CORS 允许），取英/美两套
 *   发音：有道 dictvoice（type 1=英音, 2=美音）
 *   兜底：MyMemory 机器翻译（仅在找不到有道词条时使用）
 */

export interface LookupResult {
  word: string;
  uk: string;         // 英音音频 URL
  us: string;         // 美音音频 URL
  ukPhonetic: string; // 英式音标
  usPhonetic: string; // 美式音标
  meaning: string;    // 含词性的释义（n. xxx；v. xxx）
  pos: string;        // 保留字段（释义中已含词性，此处不再重复拼接）
}

const cache = new Map<string, LookupResult>();
let cbSeq = 0;

/** 有道发音地址（type 1=英音, 2=美音） */
export function youdaoVoice(word: string, type: 1 | 2): string {
  return `https://dict.youdao.com/dictvoice?type=${type}&audio=${encodeURIComponent(word)}`;
}

/** JSONP 请求（用于有道接口，绕过 CORS） */
function jsonp<T>(url: string, param: string, timeout = 7000): Promise<T | null> {
  return new Promise((resolve) => {
    const name = `__vocal_cb_${Date.now().toString(36)}_${cbSeq++}`;
    const script = document.createElement('script');
    let settled = false;
    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
      try { delete (window as unknown as Record<string, unknown>)[name]; } catch { /* ignore */ }
    };
    const finish = (data: T | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };
    (window as unknown as Record<string, unknown>)[name] = (data: T) => finish(data);
    script.onerror = () => finish(null);
    window.setTimeout(() => finish(null), timeout);
    script.src = `${url}${url.includes('?') ? '&' : '?'}${param}=${name}`;
    document.body.appendChild(script);
  });
}

interface YoudaoEntry { entry?: string; explain?: string }

/** 有道 suggest：优先取与查询词完全一致的词条，否则取第一条 */
async function youdaoExplain(word: string): Promise<string> {
  const res = await jsonp<{ data?: { entries?: YoudaoEntry[] } }>(
    `https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=en&q=${encodeURIComponent(word)}`,
    'callback',
  );
  const entries = res?.data?.entries;
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const lower = word.trim().toLowerCase();
  const exact = entries.find((e) => String(e.entry || '').trim().toLowerCase() === lower);
  const picked = exact || entries[0];
  return String(picked.explain || '').trim();
}

/** 音标：dictionaryapi.dev（带简单词形还原） */
async function fetchPhonetics(word: string): Promise<{ uk: string; us: string }> {
  if (/[\u4e00-\u9fa5]/.test(word) || word.includes(' ')) return { uk: '', us: '' };
  const base = word.trim().toLowerCase();
  const forms = Array.from(new Set([
    base,
    base.replace(/s$/, ''),
    base.replace(/es$/, ''),
    base.replace(/ed$/, ''),
    base.replace(/ing$/, ''),
  ])).filter(Boolean);

  for (const form of forms) {
    try {
      const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(form)}`);
      if (!r.ok) continue;
      const arr = await r.json();
      if (!Array.isArray(arr) || arr.length === 0) continue;
      let uk = '';
      let us = '';
      for (const item of arr) {
        const phs = Array.isArray(item?.phonetics) ? item.phonetics : [];
        for (const p of phs) {
          const text = String(p?.text || '');
          const audio = String(p?.audio || '');
          if (!us && /[-_]us\./i.test(audio)) us = text;
          if (!uk && /[-_]uk\./i.test(audio)) uk = text;
        }
      }
      if (!uk && !us) {
        const single = String(arr[0]?.phonetic || '');
        if (single) uk = single;
      }
      if (uk || us) return { uk, us };
    } catch { /* 继续尝试下一个词形 */ }
  }
  return { uk: '', us: '' };
}

/** MyMemory 兜底翻译 */
async function fallbackMyMemory(word: string): Promise<string> {
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|zh-CN`);
    if (!res.ok) return '';
    const json = await res.json();
    const t = json?.responseData?.translatedText;
    return typeof t === 'string' ? t.trim() : '';
  } catch {
    return '';
  }
}

/**
 * 查一个单词/短语：释义（含词性）+ 英/美音标 + 发音地址
 * 抓取失败时 meaning 仍会返回兜底文本，不会抛错
 */
export async function lookupWord(raw: string): Promise<LookupResult> {
  const word = raw.trim();
  if (!word) {
    return { word, uk: '', us: '', ukPhonetic: '', usPhonetic: '', meaning: '', pos: '' };
  }
  const key = word.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  const [explain, phonetics] = await Promise.all([
    youdaoExplain(word).catch(() => ''),
    fetchPhonetics(word).catch(() => ({ uk: '', us: '' })),
  ]);
  const meaning = explain || (await fallbackMyMemory(word));

  const result: LookupResult = {
    word,
    uk: youdaoVoice(word, 1),
    us: youdaoVoice(word, 2),
    ukPhonetic: phonetics.uk,
    usPhonetic: phonetics.us,
    meaning,
    pos: '',
  };
  cache.set(key, result);
  return result;
}

/** 并发批量抓取 */
export async function lookupBatch(
  words: string[],
  onProgress?: (done: number, total: number, current: string) => void,
  concurrency = 4,
): Promise<LookupResult[]> {
  const clean = Array.from(new Set(words.map((w) => w.trim()).filter(Boolean)));
  const out: LookupResult[] = new Array(clean.length);
  let idx = 0;
  let done = 0;
  const total = clean.length;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= total) return;
      const w = clean[i];
      onProgress?.(done, total, w);
      try {
        out[i] = await lookupWord(w);
      } catch {
        out[i] = { word: w, uk: '', us: '', ukPhonetic: '', usPhonetic: '', meaning: '', pos: '' };
      }
      done++;
      onProgress?.(done, total, w);
    }
  }

  const n = Math.max(1, Math.min(concurrency, total));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out.filter(Boolean);
}
