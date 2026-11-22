/**
 * 共享书目接口（同源，代理 Supabase，避免把 anon key 暴露到页面里）
 *   GET    /api/books            全部共享书目
 *   POST   /api/books            新增或更新一本
 *   DELETE /api/books?id=xxx     删除一本
 *
 * 数据表：public.reading_books（建表 SQL 见交付说明）
 * 在 Vercel 上作为 Serverless Function 运行；本地开发由 vite.config.ts 的同名中间件代理。
 */
import type { IncomingMessage, ServerResponse } from "node:http";

interface Row {
  id: string;
  title: string;
  subtitle: string | null;
  intro: string | null;
  group_name: string | null;
  cat_name: string | null;
  tags: unknown;
  paragraphs: unknown;
  created_at: number | null;
}

function supabaseUrl(): string {
  const raw =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    "";
  return raw.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "").replace(/\/+$/, "");
}
function supabaseKey(): string {
  return (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const key = supabaseKey();
  return {
    apikey: key,
    Authorization: "Bearer " + key,
    ...extra,
  };
}

function readBody(req: IncomingMessage & { body?: unknown }): Promise<string> {
  const parsed = (req as { body?: unknown }).body;
  if (parsed && typeof parsed === "object") return Promise.resolve(JSON.stringify(parsed));
  if (typeof parsed === "string") return Promise.resolve(parsed);
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

function toClient(row: Row) {
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle || "",
    intro: row.intro || "",
    group: row.group_name || "",
    cat: row.cat_name || "",
    tags: arr(row.tags),
    paragraphs: arr(row.paragraphs),
    createdAt: row.created_at || 0,
  };
}

function send(res: ServerResponse, code: number, payload: unknown) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://localhost");
  const base = supabaseUrl();
  const key = supabaseKey();
  if (!base || !key) {
    send(res, 200, { ok: false, enabled: false, books: [] });
    return;
  }
  const table = base + "/rest/v1/reading_books";
  const method = (req.method || "GET").toUpperCase();

  try {
    if (method === "GET") {
      const r = await fetch(table + "?select=*&order=created_at.desc&limit=500", {
        headers: headers(),
      });
      if (!r.ok) throw new Error("upstream " + r.status);
      const rows = (await r.json()) as Row[];
      send(res, 200, { ok: true, enabled: true, books: rows.map(toClient) });
      return;
    }

    if (method === "POST") {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(await readBody(req)) || {};
      } catch {
        throw new Error("bad json");
      }
      const id = String(data.id || "").trim();
      const title = String(data.title || "").trim();
      if (!id || !title) {
        send(res, 400, { ok: false, error: "id/title required" });
        return;
      }
      const paragraphs = Array.isArray(data.paragraphs)
        ? (data.paragraphs as unknown[]).map((s) => String(s)).slice(0, 2000)
        : [];
      const tags = Array.isArray(data.tags)
        ? (data.tags as unknown[]).map((s) => String(s)).slice(0, 8)
        : [];
      const row = {
        id,
        title: title.slice(0, 200),
        subtitle: String(data.subtitle || "").slice(0, 200),
        intro: String(data.intro || "").slice(0, 2000),
        group_name: String(data.group || "").slice(0, 60),
        cat_name: String(data.cat || "").slice(0, 60),
        tags,
        paragraphs,
        created_at: Number(data.createdAt) || Date.now(),
      };
      const r = await fetch(table, {
        method: "POST",
        headers: headers({
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        }),
        body: JSON.stringify(row),
      });
      if (!r.ok) throw new Error("upstream " + r.status);
      send(res, 200, { ok: true });
      return;
    }

    if (method === "DELETE") {
      const id = (url.searchParams.get("id") || "").trim();
      if (!id) {
        send(res, 400, { ok: false, error: "id required" });
        return;
      }
      const r = await fetch(table + "?id=eq." + encodeURIComponent(id), {
        method: "DELETE",
        headers: headers(),
      });
      if (!r.ok) throw new Error("upstream " + r.status);
      send(res, 200, { ok: true });
      return;
    }

    send(res, 405, { ok: false, error: "method not allowed" });
  } catch {
    send(res, 502, { ok: false, error: "cloud unavailable" });
  }
}
