/** 单词发音：GET /api/voice?w=word&type=1|2（1 英式 / 2 美式，走有道 dictvoice） */
import type { IncomingMessage, ServerResponse } from "node:http";
import { UA } from "./_dict";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://localhost");
  const w = (url.searchParams.get("w") || "").trim().slice(0, 60);
  const type = url.searchParams.get("type") === "1" ? "1" : "2";
  if (!w) {
    res.statusCode = 400;
    res.end();
    return;
  }
  try {
    const r = await fetch(
      "https://dict.youdao.com/dictvoice?audio=" + encodeURIComponent(w) + "&type=" + type,
      { headers: { "User-Agent": UA, Referer: "https://dict.youdao.com/" } },
    );
    if (!r.ok) throw new Error("upstream " + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    res.statusCode = 200;
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=2592000");
    res.end(buf);
  } catch {
    res.statusCode = 502;
    res.end();
  }
}
