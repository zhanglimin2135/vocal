/** 整句翻译：GET /api/translate?q=句子（英文→中文 / 中文→英文自动判断） */
import type { IncomingMessage, ServerResponse } from "node:http";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function translateText(text: string) {
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
  };
  const out = String(j?.responseData?.translatedText || "").trim();
  if (!out || /MYMEMORY WARNING/i.test(out)) throw new Error("empty");
  return { ok: true, text: out, source: "在线翻译" };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://localhost");
  const q = (url.searchParams.get("q") || "").trim().slice(0, 500);
  if (!q) {
    sendJson(res, 400, { ok: false, text: "" });
    return;
  }
  try {
    sendJson(res, 200, await translateText(q));
  } catch {
    sendJson(res, 200, { ok: false, text: "", source: "" });
  }
}
