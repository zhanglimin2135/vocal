/**
 * 自动翻译工具：有道词典优先，MyMemory 兜底
 *   - 有道 dict.youdao.com/jsonapi：CORS 友好，返回整句中文翻译
 *   - MyMemory api.mymemory.translated.net：开源翻译服务，纯前端无鉴权
 *   - 两者都失败返回空字符串（上层显示"自动翻译失败，请手动填写"）
 *   - 加并发防抖，避免分句拆分时瞬间发出几十条请求
 */

const pendingMap = new Map<string, Promise<string>>();

/** 把 Youdao 词典接口的返回数据提取出中文翻译 */
function extractYoudao(json: unknown): string | null {
  try {
    const obj = json as Record<string, unknown>;
    const simple = (obj.simpleDict as Record<string, unknown>) || (obj as Record<string, unknown>);
    const translations = simple.translations;
    if (Array.isArray(translations)) {
      const first = translations[0] as Record<string, unknown> | undefined;
      const t = first?.trs;
      if (Array.isArray(t) && t.length > 0) {
        const inner = (t[0] as Array<{ l?: { i?: string } }>);
        const trsBlock = Array.isArray(t[0]) ? t[0] : inner;
        const li = (trsBlock as unknown as Array<{ l?: { i?: string } }>)?.[0];
        const text = li?.l?.i;
        if (typeof text === 'string') return text;
      }
    }
    // fallback 到 web_trans 下的 web-trans-key
    const webTrans = (obj.web_trans as Record<string, unknown>) || obj;
    if (Array.isArray(webTrans?.web_trans)) {
      const first = webTrans.web_trans[0] as Record<string, unknown> | undefined;
      if (Array.isArray(first?.trans)) {
        const inner = first.trans[0] as Record<string, unknown> | undefined;
        if (typeof inner?.trans === 'string') return inner.trans;
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** 有道优先，MyMemory 兜底，并发请求会被合并成一个 */
export function translateSentence(text: string): Promise<string> {
  const key = text.trim().toLowerCase();
  if (!key) return Promise.resolve('');

  // 去重：同一个句子的翻译请求只发一次，后续共享
  if (pendingMap.has(key)) return pendingMap.get(key)!;

  const task = (async () => {
    // 1) 有道词典 dictapi
    try {
      const url = `https://dict.youdao.com/jsonapi?le=en&q=${encodeURIComponent(key)}&t=1`;
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) {
        const json = await res.json();
        const got = extractYoudao(json);
        if (got && got.length > 0) return got;
      }
    } catch { /* ignore: CORS / 网络失败 */ }

    // 2) MyMemory 开源翻译（纯前端无鉴权，稳定、速度略慢）
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(key)}&langpair=en|zh-CN`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const got = json?.responseData?.translatedText;
        if (typeof got === 'string' && got.length > 0) return got;
      }
    } catch { /* ignore */ }

    return '';
  })().finally(() => pendingMap.delete(key));

  pendingMap.set(key, task);
  return task;
}
