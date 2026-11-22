/**
 * 百度汉语查询代理（同源，避免浏览器跨域限制）
 *   GET /api/hanyu?q=词语
 *
 * 返回精简后的词条：拼音、发音音频、释义（按词性）、例句、近义、反义。
 * 在 Vercel 上作为 Serverless Function 运行；本地开发由 vite.config.ts 的同名中间件代理。
 */
import type { IncomingMessage, ServerResponse } from "node:http";

interface MeanItem {
  pinyin?: string[];
  definition?: string[];
  tone_py?: string[];
}

interface RetItem {
  name?: string[];
  pinyin?: string[];
  definition?: string[];
  synonym?: string[];
  antonym?: string[];
  mean_list?: MeanItem[];
  detail_definition?: Array<{
    definitions?: Array<{ list?: Array<{ examples?: string[]; definition?: string[] }> }>;
  }>;
}

function pickExamples(item: RetItem): string[] {
  const out: string[] = [];
  const dd = item.detail_definition || [];
  for (const d of dd) {
    for (const def of d.definitions || []) {
      for (const l of def.list || []) {
        for (const ex of l.examples || []) {
          const s = String(ex).replace(/\s+/g, " ").trim();
          if (s && out.length < 6) out.push(s);
        }
      }
    }
  }
  return out;
}

export function curate(data: unknown, q: string) {
  const list = (data as { ret_array?: RetItem[] } | null)?.ret_array || [];
  const item = list[0];
  if (!item) return { ok: false, word: q };
  const means = item.mean_list || [];
  const first = means[0] || {};
  return {
    ok: true,
    word: (item.name && item.name[0]) || q,
    pinyin: (item.pinyin && item.pinyin[0]) || (first.pinyin && first.pinyin[0]) || "",
    audio: (first.tone_py && first.tone_py[0]) || "",
    means: means.map((m) => ({
      pinyin: (m.pinyin && m.pinyin[0]) || "",
      defs: (m.definition || []).map((s) => String(s).replace(/\s+/g, " ").trim()).filter(Boolean),
    })),
    examples: pickExamples(item),
    synonyms: (item.synonym || []).slice(0, 12),
    antonyms: (item.antonym || []).slice(0, 12),
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://localhost");
  const q = (url.searchParams.get("q") || "").trim().slice(0, 40);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!q) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "missing q" }));
    return;
  }
  try {
    const target =
      "https://hanyu.baidu.com/hanyu/ajax/search_list?wd=" +
      encodeURIComponent(q) +
      "&pn=0&_=" +
      Date.now();
    const r = await fetch(target, {
      headers: {
        Referer: "https://hanyu.baidu.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      },
    });
    if (!r.ok) throw new Error("upstream " + r.status);
    const data = await r.json();
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.statusCode = 200;
    res.end(JSON.stringify(curate(data, q)));
  } catch {
    res.statusCode = 502;
    res.end(JSON.stringify({ ok: false, word: q }));
  }
}
