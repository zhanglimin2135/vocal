/** 单词/词组释义：GET /api/lookup?q=word（有道词典） */
import type { IncomingMessage, ServerResponse } from "node:http";
import { UA, curateWord, sendJson } from "./_dict";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://localhost");
  const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
  if (!q) return sendJson(res, 400, { ok: false, err: "missing q" }, "no-store");
  try {
    const r = await fetch("https://dict.youdao.com/jsonapi?q=" + encodeURIComponent(q), {
      headers: { "User-Agent": UA, Referer: "https://dict.youdao.com/" },
    });
    if (!r.ok) throw new Error("upstream " + r.status);
    sendJson(res, 200, curateWord(await r.json(), q));
  } catch {
    sendJson(res, 200, { ok: false, err: "查询失败，稍后再试", word: q }, "no-store");
  }
}
