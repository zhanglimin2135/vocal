/** 词典服务探活：拆分工具通过 GET /api/ping 判断在线词典可用 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./_dict";

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  sendJson(res, 200, { ok: true, service: "vocal-dict" }, "no-store");
}
