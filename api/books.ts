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
  file_key: string | null;
  file_name: string | null;
  file_ext: string | null;
  file_size: number | null;
}

const BUCKET = "reading";

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
    file: row.file_key
      ? {
          key: row.file_key,
          name: row.file_name || "",
          ext: row.file_ext || "",
          size: row.file_size || 0,
        }
      : null,
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
  res.setHeader("Cache-Control", "no-store");

  try {
    if (method === "GET") {
      const r = await fetch(table + "?select=*&order=created_at.desc&limit=500", {
        headers: headers(),
      });
      if (!r.ok) throw new Error("upstream " + r.status);
      const rows = (await r.json()) as Row[];
      send(res, 200, {
        ok: true,
        enabled: true,
        books: rows.map(toClient),
        /* 供页面直接把原书文件传到公开桶（publishable key 本就设计为公开可见） */
        storage: { url: base, key, bucket: BUCKET },
      });
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
        file_key: data.fileKey ? String(data.fileKey).slice(0, 300) : null,
        file_name: data.fileName ? String(data.fileName).slice(0, 300) : null,
        file_ext: data.fileExt ? String(data.fileExt).slice(0, 12) : null,
        file_size: Number(data.fileSize) || null,
      };
      const r = await fetch(table, {
        method: "POST",
        headers: headers({
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        }),
        body: JSON.stringify(row),
      });
      if (r.ok) {
        send(res, 200, { ok: true });
        return;
      }
      /* 表还没加 file_* 列时，退回到只同步书目基本信息，避免整条同步失败 */
      const core = { ...row } as Record<string, unknown>;
      delete core.file_key;
      delete core.file_name;
      delete core.file_ext;
      delete core.file_size;
      const r2 = await fetch(table, {
        method: "POST",
        headers: headers({
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        }),
        body: JSON.stringify(core),
      });
      if (!r2.ok) throw new Error("upstream " + r2.status);
      send(res, 200, { ok: true });
      return;
    }

    if (method === "DELETE") {
      const id = (url.searchParams.get("id") || "").trim();
      if (!id) {
        send(res, 400, { ok: false, error: "id required" });
        return;
      }
      /* 先查出原书文件在桶里的位置，删库后一并删文件 */
      let fileKey = "";
      try {
        const r0 = await fetch(
          table + "?id=eq." + encodeURIComponent(id) + "&select=file_key",
          { headers: headers() },
        );
        if (r0.ok) {
          const rows = (await r0.json()) as Array<{ file_key: string | null }>;
          fileKey = (rows[0] && rows[0].file_key) || "";
        }
      } catch {
        /* 忽略，继续删记录 */
      }
      const r = await fetch(table + "?id=eq." + encodeURIComponent(id), {
        method: "DELETE",
        headers: headers(),
      });
      if (!r.ok) throw new Error("upstream " + r.status);
      if (fileKey) {
        try {
          await fetch(base + "/storage/v1/object/" + BUCKET + "/" + fileKey, {
            method: "DELETE",
            headers: headers(),
          });
        } catch {
          /* 文件删除失败不影响书目删除 */
        }
      }
      send(res, 200, { ok: true });
      return;
    }

    send(res, 405, { ok: false, error: "method not allowed" });
  } catch {
    send(res, 502, { ok: false, error: "cloud unavailable" });
  }
}
