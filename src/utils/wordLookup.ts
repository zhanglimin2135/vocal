/**
 * 单词释义抓取（共享工具）
 *   优先有道 dict.youdao.com/jsonapi（返回英/美音标、词性释义）
 *   失败时降级 MyMemory 取中文释义
 *   有道发音接口：https://dict.youdao.com/dictvoice?type={1|2}&audio={word}
 *
 * 被两处使用：
 *   - 听力精听播放页（Shadow DOM 脚本里内联了一份等价逻辑）
 *   - 生词整理页面（本文件）
 */

export interface LookupResult {
  word: string;
  uk: string;       // 英音 URL
  us: string;       // 美音 URL
  ukPhonetic: string; // 英式音标字符串（如 /ɡəˈzɪt/）
  usPhonetic: string; // 美式音标
  meaning: string;  // 「词性. 释义；…」格式
  pos: string;      // 主要词性（n./v./adj./adv.）
}

const cache = new Map<string, LookupResult>();

/** 有道发音接口（type 1=英音, 2=美音） */
function youdaoVoice(word: string, type: 1 | 2): string {
  return `https://dict.youdao.com/dictvoice?type=${type}&audio=${encodeURIComponent(word)}`;
}

/** 从有道 dictapi 返回里抠出音标 + 词性释义 */
function parseYoudao(raw: unknown): Partial<LookupResult> | null {
  try {
    const obj = raw as Record<string, unknown>;
    const simple = (obj.simpleDict as Record<string, unknown>) || null;
    if (!simple) return null;

    // 音标：simpleDict.phonetic（英文）、simpleDict.phoneticUS（美音）
    const ukPhonetic = String(simple.phonetic || '').trim();
    const usPhonetic = String(simple.phoneticUS || simple.phonetic || '').trim();

    // 词性释义：simpleDict.translations[] → trs[0][0].l.i
    const meanings: string[] = [];
    const translations = simple.translations as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(translations)) {
      for (const t of translations) {
        const trs = t?.trs as Array<unknown> | undefined;
        if (!Array.isArray(trs)) continue;
        for (const tr of trs) {
          const arr = Array.isArray(tr) ? tr as Array<{ l?: { i?: string } }> : null;
          const li = arr?.[0]?.l;
          const text = typeof li?.i === 'string' ? li.i.trim() : '';
          if (text) meanings.push(text);
        }
      }
    }

    if (!ukPhonetic && !usPhonetic && meanings.length === 0) return null;

    let pos = '';
    // 从第一条里抠「n./v./adj./adv.」
    const first = meanings[0] || '';
    const m = first.match(/^((?:n|v|adj|adv|prep|conj|pron|aux|interj|art|num|vt|vi)\.?)/i);
    if (m) pos = m[1].replace(/\.$/, '').toLowerCase() + '.';

    return {
      ukPhonetic,
      usPhonetic,
      meaning: meanings.join('；'),
      pos,
    };
  } catch {
    return null;
  }
}

async function fallbackMyMemory(word: string): Promise<string> {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|zh-CN`;
    const res = await fetch(url);
    if (!res.ok) return '';
    const json = await res.json();
    const t = json?.responseData?.translatedText;
    return typeof t === 'string' ? t.trim() : '';
  } catch {
    return '';
  }
}

/**
 * 查一个单词/短语；短语也能查（有道 dictapi 支持）。
 * 失败时 meaning 仍会返回 MyMemory 的兜底翻译，不会抛错。
 */
export async function lookupWord(raw: string): Promise<LookupResult> {
  const word = raw.trim();
  if (!word) {
    return { word: raw.trim(), uk: '', us: '', ukPhonetic: '', usPhonetic: '', meaning: '', pos: '' };
  }
  const key = word.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  let parsed: Partial<LookupResult> | null = null;
  try {
    const url = `https://dict.youdao.com/jsonapi?le=en&q=${encodeURIComponent(word)}&t=1`;
    const res = await fetch(url);
    if (res.ok) parsed = parseYoudao(await res.json());
  } catch { /* ignore */ }

  const meaning = parsed?.meaning || (await fallbackMyMemory(word));
  const result: LookupResult = {
    word,
    uk: youdaoVoice(word, 1),
    us: youdaoVoice(word, 2),
    ukPhonetic: parsed?.ukPhonetic || '',
    usPhonetic: parsed?.usPhonetic || '',
    meaning,
    pos: parsed?.pos || '',
  };
  cache.set(key, result);
  return result;
}

/** 并发批量抓取，带限流 */
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
