/**
 * 整句翻译：GET /api/translate?q=句子（英文→中文 / 中文→英文自动判断）
 *
 * 译准率优先，按以下顺序挑选，前一个拿到可信结果就不再往下走：
 *   1. 有道词典「双语例句」里与原文完全一致的句子 → 专业人工译文，质量最高
 *   2. 有道词典「网络释义」里与原文一致的短语（≤ 4 个词）→ 人工约定俗成的译法
 *   3. Google 翻译（无需 key 的 web 通道）→ 通用机器翻译，语境把握较好
 *   4. MyMemory 兜底：只在启发式校验通过（原文功能词在译文中有对应）时采用其记忆库译文，
 *      否则用它的 MT 结果 —— 之前直接取第一条，导致 "Really?" 被译成 "发光?" 这类脏翻译。
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const REQ_TIMEOUT = 6000;

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function withTimeout(ms = REQ_TIMEOUT): { signal?: AbortSignal; done: () => void } {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  return {
    signal: ctrl ? ctrl.signal : undefined,
    done: () => {
      if (t) clearTimeout(t);
    },
  };
}

/* 判断是不是一整句（带空格分隔的多个词） */
function isSentence(s: string) {
  return s.trim().split(/\s+/).length > 4;
}

function normEn(s: string) {
  return s
    .toLowerCase()
    .replace(/[\s]+/g, " ")
    .replace(/[.?!,;:"'’“”]+$/g, "")
    .trim();
}

function hasCN(s: string) {
  return /[\u4e00-\u9fa5]/.test(s);
}

/* ============================ 1 & 2：有道词典 ============================ */
async function youdaoTranslate(
  q: string,
  allowPhrase: boolean,
): Promise<{ text: string; source: string } | null> {
  const { signal, done } = withTimeout();
  try {
    const r = await fetch("https://dict.youdao.com/jsonapi?q=" + encodeURIComponent(q), {
      headers: { "User-Agent": UA, Referer: "https://dict.youdao.com/" },
      signal,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as Record<string, any>;

    /* 1) 双语例句里与原文完全一致的人工译文 */
    const pairs = (j?.blng_sents_part?.["sentence-pair"] || []) as Array<{
      sentence?: string;
      "sentence-translation"?: string;
    }>;
    const target = normEn(q);
    for (const p of pairs) {
      const seg = String(p.sentence || "");
      if (!seg || seg.includes(":")) continue; /* 带 "Dean:" 这类说话人前缀的跳过 */
      if (normEn(seg) !== target) continue;
      const trans = String(p["sentence-translation"] || "").trim();
      if (trans && (hasCN(trans) !== hasCN(q)) && trans.length >= 1) {
        return { text: trans, source: "有道例句" };
      }
    }

    /* 2) 四词以内的短语，取网络释义里支持度最高的一条 */
    if (allowPhrase && !isSentence(q)) {
      const list = (j?.web_trans?.["web-translation"] || []) as Array<{
        key?: string;
        trans?: Array<{ value?: string; support?: number }>;
      }>;
      const k = normEn(q);
      const hit = list.find((it) => normEn(String(it.key || "")) === k);
      if (hit) {
        const vals = (hit.trans || [])
          .map((t) => ({ v: String(t.value || "").trim(), s: Number(t.support || 0) }))
          .filter((t) => t.v)
          /* 先看译法是否覆盖了原文的关键词，再看支持度，避免选到张冠李戴的释义 */
          .sort((a, b) => hintScore(q, b.v) - hintScore(q, a.v) || b.s - a.s);
        if (vals.length && hasCN(vals[0].v)) {
          return { text: vals[0].v, source: "有道释义" };
        }
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    done();
  }
}

/* ============================ 3：Bing 翻译（LLM，质量最好） ============================ */
type BingToken = { host: string; ig: string; iid: string; token: string; key: number; exp: number };
let bingCache: BingToken | null = null;

async function bingToken(): Promise<BingToken | null> {
  if (bingCache && Date.now() < bingCache.exp) return bingCache;
  for (const host of ["https://cn.bing.com", "https://www.bing.com"]) {
    const { signal, done } = withTimeout(6000);
    try {
      const r = await fetch(host + "/translator", {
        headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
        signal,
      });
      if (!r.ok) continue;
      const html = await r.text();
      const ig = /IG:"([^"]+)"/.exec(html)?.[1];
      const iid = /data-iid="(translator\.\d+)"/.exec(html)?.[1];
      const p = /params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)",(\d+)\]/.exec(html);
      if (ig && iid && p) {
        /* 令牌约 1 小时有效，这里保守按 50 分钟缓存，暖实例内可复用，批量获取释义会快很多 */
        bingCache = { host, ig, iid, token: p[2], key: Number(p[1]), exp: Date.now() + 50 * 60 * 1000 };
        return bingCache;
      }
    } catch {
      /* 换下一个域名 */
    } finally {
      done();
    }
  }
  return null;
}

async function bingTranslate(q: string, toCN: boolean): Promise<string | null> {
  const tk = await bingToken();
  if (!tk) return null;
  const body = new URLSearchParams({
    fromLang: toCN ? "en" : "zh-Hans",
    to: toCN ? "zh-Hans" : "en",
    text: q,
    token: tk.token,
    key: String(tk.key),
  });
  const { signal, done } = withTimeout(6000);
  try {
    const r = await fetch(
      tk.host + "/ttranslatev3?isVertical=1&IG=" + tk.ig + "&IID=" + tk.iid + ".1",
      {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal,
      },
    );
    if (!r.ok) {
      if (r.status === 400) bingCache = null; /* 令牌失效，下次重新取 */
      return null;
    }
    const j = (await r.json()) as any;
    const t = j?.[0]?.translations?.[0]?.text;
    return typeof t === "string" && t.trim() ? t.trim() : null;
  } catch {
    return null;
  } finally {
    done();
  }
}

/* ============================ 4：Google 翻译 ============================ */
/* 两个免费通道互为备份：gtx（单行 JSON）与 dict-chrome-ex（数组），任一成功即可 */
function pickByScript(list: string[], toCN: boolean): string {
  const ok = list.filter((s) => (toCN ? hasCN(s) : /[A-Za-z]/.test(s)) && s.trim());
  return ok.length ? ok[ok.length - 1].trim() : list.filter((s) => s.trim()).join("").trim();
}

async function googleOnce(url: string, toCN: boolean): Promise<string | null> {
  const { signal, done } = withTimeout(4000);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal,
    });
    if (!r.ok) return null;
    const data = (await r.json()) as unknown;
    if (!Array.isArray(data)) return null;

    /* 形态一：gtx → [[["译文","原文",…], …], …] */
    const first = data[0];
    if (Array.isArray(first) && Array.isArray(first[0])) {
      const text = first
        .map((s: any) => (Array.isArray(s) ? String(s[0] || "") : ""))
        .join("")
        .trim();
      if (text) return text;
    }

    /* 形态二：dict-chrome-ex → [["原文","译文",…]] 或 ["译文"] */
    const flat: string[] = [];
    for (const item of data) {
      if (typeof item === "string") flat.push(item);
      else if (Array.isArray(item)) {
        for (const x of item) if (typeof x === "string") flat.push(x);
      }
    }
    const picked = pickByScript(flat, toCN);
    return picked || null;
  } catch {
    return null;
  } finally {
    done();
  }
}

async function googleTranslate(q: string, toCN: boolean): Promise<string | null> {
  const tl = toCN ? "zh-CN" : "en";
  const enc = encodeURIComponent(q);
  const urls = [
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" + tl + "&dt=t&q=" + enc,
    "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=" + tl + "&q=" + enc,
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" + tl + "&dt=t&q=" + enc,
  ];
  for (const u of urls) {
    const t = await googleOnce(u, toCN);
    if (t) return t;
  }
  return null;
}

/* ============================ 4：MyMemory 兜底 ============================ */
const EN_TO_ZH_HINTS: Array<[RegExp, string[]]> = [
  [/\byou\b/i, ["你", "您", "你们"]],
  [/\bI\b/i, ["我"]],
  [/\bme\b/i, ["我"]],
  [/\bmy\b/i, ["我的"]],
  [/\bmine\b/i, ["我的"]],
  [/\bwe\b/i, ["我们"]],
  [/\bus\b/i, ["我们"]],
  [/\bour\b/i, ["我们的"]],
  [/\bthey\b/i, ["他们", "她们", "它们"]],
  [/\bthem\b/i, ["他们", "她们", "它们"]],
  [/\btheir\b/i, ["他们的", "她们的", "它们的"]],
  [/\bhe\b/i, ["他"]],
  [/\bhim\b/i, ["他"]],
  [/\bhis\b/i, ["他的"]],
  [/\bshe\b/i, ["她"]],
  [/\bher\b/i, ["她", "她的"]],
  [/\bit\b/i, ["它"]],
  [/\bwhat\b/i, ["什么", "咋"]],
  [/\bwho\b/i, ["谁"]],
  [/\bwhen\b/i, ["什么时候", "何时"]],
  [/\bwhere\b/i, ["哪里", "哪儿"]],
  [/\bwhy\b/i, ["为什么", "为何"]],
  [/\bhow\b/i, ["怎么", "怎样", "如何"]],
  [/\bmean(s|ing)?\b|\bmeaning\b/i, ["意思", "意味", "含义"]],
  [/\bknow\b/i, ["知道", "晓得"]],
  [/\bthink\b/i, ["觉得", "想", "认为"]],
  [/\bwant\b/i, ["想要", "要"]],
  [/\blike\b/i, ["喜欢", "像"]],
  [/\bis\b|\bare\b|\bam\b|\bwere?\b|\bbe\b/i, ["是"]],
];

interface MemoryMatch {
  segment?: string;
  translation?: string;
  quality?: number;
  usage_count?: number;
}

function hintScore(seg: string, trans: string): number {
  let score = 0;
  const s = seg.toLowerCase();
  for (const [re, targets] of EN_TO_ZH_HINTS) {
    if (!re.test(s)) continue;
    if (targets.some((t) => trans.includes(t))) score += 8;
    else score -= 10;
  }
  return score;
}

async function myMemoryTranslate(
  q: string,
  toCN: boolean,
): Promise<{ text: string; source: string } | null> {
  const { signal, done } = withTimeout();
  try {
    const pair = toCN ? "en|zh-CN" : "zh-CN|en";
    const r = await fetch(
      "https://api.mymemory.translated.net/get?q=" +
        encodeURIComponent(q.slice(0, 500)) +
        "&langpair=" +
        pair,
      { headers: { "User-Agent": UA }, signal },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      responseData?: { translatedText?: string };
      matches?: MemoryMatch[];
    };
    const mt = String(j?.responseData?.translatedText || "").trim();
    if (mt && !/MYMEMORY WARNING/i.test(mt)) {
      /* MT 结果里如果和 memory 完全一致、且启发式判定为脏翻译，就不采用 */
      const matches = j?.matches || [];
      const same = matches.find(
        (m) => String(m.translation || "").trim() === mt && toCN && hintScore(q, mt) < -5,
      );
      if (!same) return { text: mt, source: "在线翻译" };
    }
    const cands = (j?.matches || [])
      .map((m) => ({
        seg: String(m.segment || "").trim(),
        trans: String(m.translation || "").trim(),
      }))
      .filter((c) => c.trans && normEn(c.seg) === normEn(q))
      .filter((c) => (toCN ? hintScore(q, c.trans) >= 8 : true))
      .sort((a, b) => hintScore(q, b.trans) - hintScore(q, a.trans));
    if (cands.length) return { text: cands[0].trans, source: "在线翻译" };
    return mt && !/MYMEMORY WARNING/i.test(mt) ? { text: mt, source: "在线翻译" } : null;
  } catch {
    return null;
  } finally {
    done();
  }
}

/* 译文尾部标点跟随原文（"Really?" → "真的吗？"），避免丢标点后语气变味 */
function polish(src: string, out: string) {
  const t = out.replace(/[\u200b\u200c\u200d\ufeff]/g, "").trim(); /* 清掉 Google 输出里的零宽字符 */
  if (!t) return t;
  const last = src.trim().slice(-1);
  if (/[?？]/.test(last) && !/[?？!！。.]$/.test(t)) return t + "？";
  if (/[!！]/.test(last) && !/[?？!！。.]$/.test(t)) return t + "！";
  return t;
}

/* 通道熔断：某个通道整体不可用时，60 秒内不再尝试，避免批量获取释义被拖慢 */
let bingDownUntil = 0;
let googleDownUntil = 0;

async function translateText(q: string) {
  const toCN = !hasCN(q);
  const sentence = isSentence(q);

  /* 1) 整句先看有道「双语例句」里有没有完全一致的人工译文 */
  if (sentence) {
    const yd = await youdaoTranslate(q, false);
    if (yd && (toCN ? hasCN(yd.text) : /[A-Za-z]/.test(yd.text))) {
      return { ok: true, text: polish(q, yd.text), source: yd.source };
    }
  }

  /* 2) Bing 翻译（LLM 引擎，语境与口语表达最自然） */
  if (Date.now() > bingDownUntil) {
    const b = await bingTranslate(q, toCN);
    if (b) return { ok: true, text: polish(q, b), source: "Bing 翻译" };
    bingDownUntil = Date.now() + 60 * 1000;
  }

  /* 3) Google 机器翻译 */
  if (Date.now() > googleDownUntil) {
    const g = await googleTranslate(q, toCN);
    if (g) return { ok: true, text: polish(q, g), source: "Google 翻译" };
    googleDownUntil = Date.now() + 60 * 1000;
  }

  /* 4) 有道网络释义（短语） */
  const yd2 = await youdaoTranslate(q, true);
  if (yd2) return { ok: true, text: polish(q, yd2.text), source: yd2.source };

  /* 5) MyMemory 兜底 */
  const mm = await myMemoryTranslate(q, toCN);
  if (mm) return { ok: true, text: polish(q, mm.text), source: mm.source };

  throw new Error("no translation");
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
