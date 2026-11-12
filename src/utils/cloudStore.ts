/**
 * 听力精听目录的云端存储（Supabase）
 *   目录条目 → 数据表 listening_entries
 *   导入的 .html 网页 → Storage 的公开 bucket「listening」
 *
 * 未配置环境变量时（本地开发 / 未部署），所有函数都会静默跳过，
 * 页面继续使用浏览器本地存储（localStorage + IndexedDB）。
 */

import type { ListeningCategory, ListeningEntry } from '@/types';

/**
 * 允许把控制台里的「REST endpoint」直接粘进来：
 *   https://xxx.supabase.co/rest/v1/  →  https://xxx.supabase.co
 * 否则会拼出 /rest/v1/rest/v1/... 导致全部 404
 */
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '')
  .replace(/\/+$/, '');
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** 数据表名 */
const TABLE = 'listening_entries';
/** Storage bucket 名（需设为 public，便于所有人直接读取） */
const BUCKET = 'listening';

/** 是否已配置云端存储 */
export const isCloudEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** 云端条目的原始行结构（数据库为 snake_case） */
interface EntryRow {
  id: string;
  title: string;
  kind: 'link' | 'html';
  category: string | null;
  url: string | null;
  html_key: string | null;
  line_count: number | null;
  duration: number | null;
  created_at: number | null;
  sort_order: number | null;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY as string,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...extra,
  };
}

/** 应用内的驼峰条目 → 数据库行 */
function toRow(entry: ListeningEntry): EntryRow {
  return {
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    category: entry.category ?? 'toefl-new',
    url: entry.url ?? null,
    html_key: entry.htmlKey ?? null,
    line_count: entry.lineCount ?? null,
    duration: entry.duration ?? null,
    created_at: entry.createdAt ?? null,
    sort_order: entry.order ?? 0,
  };
}

/** 数据库行 → 应用内的驼峰条目 */
function fromRow(row: EntryRow): ListeningEntry {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    category: (row.category as ListeningCategory) || 'toefl-new',
    url: row.url ?? undefined,
    htmlKey: row.html_key ?? undefined,
    lineCount: row.line_count ?? undefined,
    duration: row.duration ?? undefined,
    createdAt: row.created_at ?? Date.now(),
    order: row.sort_order ?? 0,
  };
}

/** 拉取全部目录条目；失败返回 null（调用方回退到本地缓存） */
export async function cloudGetEntries(): Promise<ListeningEntry[] | null> {
  if (!isCloudEnabled) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=sort_order.asc`,
      { headers: authHeaders() },
    );
    if (!res.ok) throw new Error(`读取目录失败：${res.status}`);
    const rows = (await res.json()) as EntryRow[];
    return rows.map(fromRow);
  } catch (e) {
    console.warn('[cloud] 读取目录失败，使用本地缓存', e);
    return null;
  }
}

/** 新增或更新一条目录条目 */
export async function cloudUpsertEntry(entry: ListeningEntry): Promise<void> {
  if (!isCloudEnabled) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: authHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify(toRow(entry)),
    });
  } catch (e) {
    console.warn('[cloud] 保存条目失败', e);
  }
}

/** 删除一条目录条目（同时删除 Storage 里的网页文件） */
export async function cloudDeleteEntry(entry: ListeningEntry): Promise<void> {
  if (!isCloudEnabled) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(entry.id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (entry.kind === 'html' && entry.htmlKey) {
      await cloudDeleteHtml(entry.htmlKey);
    }
  } catch (e) {
    console.warn('[cloud] 删除条目失败', e);
  }
}

/** 批量更新排序（只更新 sort_order 字段） */
export async function cloudReorder(entries: ListeningEntry[]): Promise<void> {
  if (!isCloudEnabled) return;
  try {
    await Promise.all(
      entries.map((e) =>
        fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(e.id)}`, {
          method: 'PATCH',
          headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
          body: JSON.stringify({ sort_order: e.order }),
        }),
      ),
    );
  } catch (e) {
    console.warn('[cloud] 更新排序失败', e);
  }
}

/** 上传网页文件到 Storage；成功返回 true */
export async function cloudUploadHtml(key: string, html: string): Promise<boolean> {
  if (!isCloudEnabled) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(key)}.html`,
      {
        method: 'POST',
        headers: authHeaders({
          'Content-Type': 'text/html; charset=utf-8',
          'x-upsert': 'true',
        }),
        body: html,
      },
    );
    if (!res.ok) throw new Error(`上传网页失败：${res.status}`);
    return true;
  } catch (e) {
    console.warn('[cloud] 上传网页失败', e);
    return false;
  }
}

/** 读取云端网页内容；失败返回 null */
export async function cloudFetchHtml(key: string): Promise<string | null> {
  if (!isCloudEnabled) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(key)}.html`,
    );
    if (!res.ok) throw new Error(`下载网页失败：${res.status}`);
    return await res.text();
  } catch (e) {
    console.warn('[cloud] 下载网页失败', e);
    return null;
  }
}

/** 删除 Storage 中的网页文件 */
export async function cloudDeleteHtml(key: string): Promise<void> {
  if (!isCloudEnabled) return;
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(key)}.html`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  } catch (e) {
    console.warn('[cloud] 删除网页失败', e);
  }
}
