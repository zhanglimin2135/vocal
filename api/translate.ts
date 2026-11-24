/** 整句翻译：GET /api/translate?q=句子（英文→中文 / 中文→英文自动判断） */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, translateText } from "./_dict";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://localhost");
  const q = (url.searchParams.get("q") || "").trim().slice(0, 500);
  if (!q) return sendJson(res, 400, { ok: false, text: "" }, "no-store");
  try {
    sendJson(res, 200, await translateText(q));
  } catch {
    sendJson(res, 200, { ok: false, text: "", source: "" }, "no-store");
  }
}
