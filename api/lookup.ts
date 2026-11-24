/** 单词/词组释义：GET /api/lookup?q=word（有道词典 jsonapi） */
import type { IncomingMessage, ServerResponse } from "node:http";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

interface Sense {
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

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  res.end(JSON.stringify(body));
}

function splitPos(line: string): Sense {
  const m = /^([a-z]{1,6}\.)\s*(.+)$/i.exec(line.trim());
  if (m) return { pos: m[1], def: m[2].trim() };
  return { pos: "", def: line.trim() };
}

function curateWord(data: unknown, q: string) {
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

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://localhost");
  const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
  if (!q) {
    sendJson(res, 400, { ok: false, err: "missing q" });
    return;
  }
  try {
    const r = await fetch("https://dict.youdao.com/jsonapi?q=" + encodeURIComponent(q), {
      headers: { "User-Agent": UA, Referer: "https://dict.youdao.com/" },
    });
    if (!r.ok) throw new Error("upstream " + r.status);
    sendJson(res, 200, curateWord(await r.json(), q));
  } catch {
    sendJson(res, 200, { ok: false, err: "查询失败，稍后再试", word: q });
  }
}
