/** 整句翻译：GET /api/translate?q=句子（英文→中文 / 中文→英文自动判断）
 *
 *  走 MyMemory 翻译记忆库 + 机器翻译混合结果，但不盲目取 MyMemory 的 "最佳"，
 *  而是从它返回的 matches 候选里用启发式规则挑一个最靠谱的：
 *    - quality=0 通常是新提交、未经投票的人工翻译，反而可能比被反复引用但有错的 memory 更准
 *    - 原文出现的功能词（代词、疑问词等）在译文中应该有对应，否则大概率是脏翻译
 *    - 译文过短/过长时不选
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/* 英文功能词 → 中文对应，用来过滤明显不相关的翻译 */
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
  [/\bmeaning\b|\bmeans?\b/i, ["意思", "意味", "含义"]],
  [/\bknow\b/i, ["知道", "晓得"]],
  [/\bthink\b/i, ["觉得", "想", "认为"]],
  [/\bwant\b/i, ["想要", "要"]],
  [/\blike\b/i, ["喜欢", "像"]],
  [/\bdo(es|n't)?\b/i, ["做", "干"]],
  [/\bis\b|\bare\b|\bam\b|\bwere?\b|\bbe\b/i, ["是"]],
];

/* 中文功能词 → 英文对应（中文→英文方向用） */
const ZH_TO_EN_HINTS: Array<[RegExp, string[]]> = [
  [/你|您/, ["you"]],
  [/我/, ["I", "me"]],
  [/他/, ["he", "him"]],
  [/她/, ["she", "her"]],
  [/它/, ["it"]],
  [/我们/, ["we", "us"]],
  [/他们|她们|它们/, ["they", "them"]],
  [/什么/, ["what"]],
  [/谁/, ["who"]],
  [/哪里|哪儿/, ["where"]],
  [/什么时候|何时/, ["when"]],
  [/为什么|为何/, ["why"]],
  [/怎么|怎样|如何/, ["how"]],
  [/意思/, ["mean", "meaning"]],
  [/知道/, ["know"]],
];

interface MemoryMatch {
  segment?: string;
  translation?: string;
  quality?: number;
  match?: number;
  subject?: string;
  usage_count?: number;
  source?: string;
}

function scoreZh(seg: string, trans: string): number {
  let score = 0;
  const segLower = seg.toLowerCase();
  for (const [re, targets] of EN_TO_ZH_HINTS) {
    if (!re.test(segLower)) continue;
    if (targets.some((t) => trans.includes(t))) score += 8;
    else score -= 10; /* 原文有关键词但译文里完全没对应 → 大概率是脏翻译 */
  }
  return score;
}

function scoreEn(seg: string, trans: string): number {
  let score = 0;
  for (const [re, targets] of ZH_TO_EN_HINTS) {
    if (!re.test(seg)) continue;
    const tLower = trans.toLowerCase();
    if (targets.some((t) => tLower.includes(t))) score += 8;
    else score -= 10;
  }
  return score;
}

function pickBest(
  text: string,
  matches: MemoryMatch[],
  isCN: boolean,
): string {
  if (!matches || matches.length === 0) return "";

  /* 先把候选归一化 */
  const candidates = matches
    .map((m) => ({
      seg: String(m.segment || "").trim(),
      trans: String(m.translation || "").trim(),
      quality: Number(m.quality ?? -1),
      match: Number(m.match ?? 0),
      usage: Number(m.usage_count ?? 0),
      subject: String(m.subject || ""),
    }))
    .filter((c) => c.trans && c.seg && c.seg.toLowerCase() === text.toLowerCase().trim())
    .filter((c) => c.trans.length >= 2);

  if (candidates.length === 0) {
    /* segment 完全对不上的也放弃，返回空让上层兜底 */
    return "";
  }

  const scorer = isCN ? scoreEn : scoreZh;
  const scored = candidates.map((c) => ({
    ...c,
    adjScore: scorer(text, c.trans) + c.quality * 0.15,
  }));

  scored.sort((a, b) => b.adjScore - a.adjScore);

  const best = scored[0];

  /* 如果最佳候选的启发式分数是负的（原文有关键词但译文完全没对应），
     说明所有 memory 都不可靠，直接让上游走 MT 结果 */
  if (best.adjScore < -5) return "";

  return best.trans;
}

async function translateText(text: string) {
  const trimmed = text.trim().slice(0, 500);
  const isCN = /[\u4e00-\u9fa5]/.test(trimmed);
  const pair = isCN ? "zh-CN|en" : "en|zh-CN";
  const target =
    "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(trimmed) +
    "&langpair=" +
    pair;
  const r = await fetch(target, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("upstream " + r.status);
  const j = (await r.json()) as {
    responseData?: { translatedText?: string };
    matches?: MemoryMatch[];
  };

  const mt = String(j?.responseData?.translatedText || "").trim();
  const best = pickBest(trimmed, j?.matches || [], isCN);

  /* 优先选经过启发式校验的 memory 候选；如果没有合适的，再退回 MT 结果 */
  let out = best || mt;
  if (!out || /MYMEMORY WARNING/i.test(out)) throw new Error("empty");

  /* 如果 MT 结果质量明显好于 best（heuristic 分数可以间接判断），也可以用 MT，
     但 MT 本身也是 MyMemory 内部的 MT，所以跟 best 大概率差不多。
     这里就简单地：best 存在且不包含明显脏词时优先用 best，否则用 mt。 */

  return { ok: true, text: out, source: isCN ? "在线翻译" : "在线翻译" };
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
