/**
 * 拆分工具在线词典的公共逻辑（供 /api/ping /api/lookup /api/translate /api/voice 复用）
 *   - 释义：有道词典 jsonapi
 *   - 发音：有道 dictvoice
 *   - 整句翻译：MyMemory 免费接口
 * 文件名以 _ 开头，Vercel 不会把它当成路由。
 */
import type { ServerResponse } from "node:http";

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  cache = "public, s-maxage=86400, stale-while-revalidate=604800",
) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.end(JSON.stringify(body));
}

export interface Sense {
  pos: string;
  def: string;
}

interface TrItem {
  tr?: Array<{ l?: { i?: string[] } }>;
}

interface EcWord {
  ukphone?: string;
  usphone?: string;
  trs?: TrItem[];
}

/** 把 "v. 维持，保持；" 拆成词性与释义 */
function splitPos(line: string): Sense {
  const m = /^([a-z]{1,6}\.)\s*(.+)$/i.exec(line.trim());
  if (m) return { pos: m[1], def: m[2].trim() };
  return { pos: "", def: line.trim() };
}

/** 有道词条 → 工具需要的数据结构 */
export function curateWord(data: unknown, q: string) {
  const j = (data || {}) as {
    ec?: { word?: EcWord[] };
    web_trans?: { "web-translation"?: Array<{ trans?: Array<{ value?: string }> }> };
  };
  const w = j.ec?.word?.[0];
  const senses: Sense[] = [];
  for (const tr of w?.trs || []) {
    for (const one of tr.tr || []) {
      for (const line of one.l?.i || []) {
        const s = splitPos(String(line));
        if (s.def) senses.push(s);
      }
    }
  }
  if (!senses.length) {
    const web = j.web_trans?.["web-translation"]?.[0]?.trans?.[0]?.value;
    if (web) senses.push({ pos: "", def: String(web) });
  }
  if (!senses.length) {
    return { ok: false, err: "未收录该词", word: q };
  }
  return {
    ok: true,
    word: q,
    uk: (w?.ukphone || "").trim(),
    us: (w?.usphone || "").trim(),
    senses: senses.slice(0, 12),
    forms: "",
    source: "有道词典",
  };
}

/** 整句翻译：自动判断方向，走 MyMemory */
export async function translateText(text: string) {
  const isCN = /[\u4e00-\u9fa5]/.test(text);
  const pair = isCN ? "zh-CN|en" : "en|zh-CN";
  const target =
    "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(text.slice(0, 500)) +
    "&langpair=" +
    pair;
  const r = await fetch(target, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("upstream " + r.status);
  const j = (await r.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number;
  };
  const out = String(j?.responseData?.translatedText || "").trim();
  if (!out || /MYMEMORY WARNING/i.test(out)) throw new Error("empty");
  return { ok: true, text: out, source: "在线翻译" };
}
