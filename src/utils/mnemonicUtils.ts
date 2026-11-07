/**
 * 助记联网查询工具
 *   背诵页把鼠标移到「助记」图标时调用 getMnemonic(word)：
 *     1. 先查本地四级词库（命中且字段齐全则直接返回，无需联网）；
 *     2. 有道词典 jsonapi：音标、词源、同族词；
 *     3. 免费大模型（Pollinations）：口诀、速记、词根拆分、易错。
 *   结果按单词缓存在 localStorage，避免重复请求。
 */

import type { WordMnemonic } from '@/types';
import { findCet4Mnemonic } from './cet4Parser';
import { CET4_EMBEDDED_BOOK } from '@/data/cet4Embedded';
import { SENIOR_EMBEDDED_BOOK } from '@/data/seniorEmbedded';
import { JUNIOR_EMBEDDED_BOOK } from '@/data/juniorEmbedded';

const CACHE_KEY = 'vocal:mnemonic:v1';
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 天

interface CacheEntry {
  data: WordMnemonic;
  ts: number;
  ttl?: number;
}

/** 免费大模型的全局冷却时间（接口限流时避免连续撞墙） */
let llmCooldownUntil = 0;
const LLM_COOLDOWN_MS = 45 * 1000;
const PARTIAL_TTL = 10 * 60 * 1000;
/** 主题色 / 浅底色（与词表原始配色风格一致） */
const PALETTE: [string, string][] = [
  ['#185FA5', '#E6F1FB'],
  ['#0F6E56', '#E1F5EE'],
  ['#993C1D', '#FAECE7'],
  ['#534AB7', '#EEEDFE'],
  ['#8A5A2B', '#FAEEDA'],
  ['#A32D6B', '#FBEAF0'],
];

function paletteFor(word: string): [string, string] {
  let h = 0;
  for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function cacheGet(key: string): WordMnemonic | null {
  const entry = readCache()[key];
  if (!entry || !entry.data) return null;
  if (Date.now() - entry.ts > (entry.ttl || CACHE_TTL)) return null;
  return entry.data;
}

function cacheSet(key: string, data: WordMnemonic, ttl = CACHE_TTL): void {
  try {
    const map = readCache();
    map[key] = { data, ts: Date.now(), ttl };
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage 不可用时忽略，仅当前会话内无法复用 */
  }
}

/** 本地词典字段是否已经足够完整（齐了就不联网） */
function isComplete(m: WordMnemonic | null | undefined): boolean {
  return !!(
    m &&
    m.phonetic && m.etymology && m.rhyme && m.quick &&
    (m.splitParts || []).length > 0 &&
    (m.family || []).length > 0
  );
}

/** 有道词典：音标 / 词源 / 同族词 */
async function fetchYoudao(word: string): Promise<WordMnemonic | null> {
  try {
    const res = await fetch(
      `https://dict.youdao.com/jsonapi?le=en&q=${encodeURIComponent(word)}&t=1`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;

    const ecWord = (json.ec as { word?: unknown[] } | undefined)?.word?.[0] as
      | { usphone?: string; ukphone?: string }
      | undefined;
    const simpleWord = (json.simple as { word?: unknown[] } | undefined)?.word?.[0] as
      | { usphone?: string; ukphone?: string }
      | undefined;

    const etym = (json.etym as { etyms?: { zh?: { value?: string }[] } } | undefined)
      ?.etyms?.zh?.[0]?.value;

    const family: string[] = [];
    const rels = (json.rel_word as { rels?: { rel?: { words?: { word?: string }[] } }[] } | undefined)
      ?.rels;
    for (const item of rels || []) {
      for (const w of item?.rel?.words || []) {
        const v = w?.word?.trim();
        if (v && !family.includes(v)) family.push(v);
      }
    }

    return {
      phonetic: ecWord?.usphone || ecWord?.ukphone || simpleWord?.usphone || '',
      etymology: typeof etym === 'string' ? etym.slice(0, 400) : '',
      family: family.slice(0, 6),
    };
  } catch {
    return null;
  }
}

/** 从大模型返回的文本中提取 JSON 对象 */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 免费大模型：口诀 / 速记 / 词根拆分 / 易错 */
async function fetchGenerated(
  word: string,
  meaning?: string,
): Promise<WordMnemonic | null> {
  if (Date.now() < llmCooldownUntil) return null;

  const prompt = [
    '你是英语单词助记专家，请为下面的单词生成简洁、好记的中文助记内容。',
    `单词：${word}`,
    meaning ? `已知释义：${meaning}` : '',
    '只输出一个 JSON 对象，不要输出任何解释文字，格式：',
    '{"splitParts":["词根1","中文说明1","词根2","中文说明2"],"rhyme":"口诀，不超过40字","quick":"速记，不超过60字","caution":"易错提示，不超过40字，没有就空字符串"}',
    '要求：splitParts 必须成对出现（词根 + 中文说明）；口诀要朗朗上口，可利用词根、谐音或联想；内容必须准确，不要编造词源。',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai-fast',
        messages: [
          { role: 'system', content: '你只输出合法 JSON，不输出多余文字。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        reasoning_effort: 'low',
        max_tokens: 300,
      }),
    });
    if (!res.ok) {
      // 免费接口有频率限制：进入全局冷却，避免连续请求继续失败
      llmCooldownUntil = Date.now() + LLM_COOLDOWN_MS;
      return null;
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    const obj = parseJsonObject(content);
    if (!obj) return null;

    const splitParts = Array.isArray(obj.splitParts)
      ? (obj.splitParts as unknown[]).map((x) => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 8)
      : [];

    return {
      splitParts,
      rhyme: typeof obj.rhyme === 'string' ? obj.rhyme.trim().slice(0, 80) : '',
      quick: typeof obj.quick === 'string' ? obj.quick.trim().slice(0, 120) : '',
      caution: typeof obj.caution === 'string' ? obj.caution.trim().slice(0, 80) : '',
    };
  } catch {
    llmCooldownUntil = Date.now() + LLM_COOLDOWN_MS;
    return null;
  }
}

/**
 * 获取单词的助记信息（表格自带优先 → 本地四级词库 → 有道 → 免费大模型）。
 *   existing: 该词在导入表格里已有的助记字段（若有，优先使用）。
 *   onUpdate 会在本地数据、有道数据、AI 生成结果到达时各回调一次，
 *   便于悬浮卡片先显示已有内容，再逐步补全，而不是一直等所有来源。
 * 所有来源都失败时返回 null；结果按单词缓存到 localStorage。
 */
export async function getMnemonic(
  word: string,
  meaning?: string,
  onUpdate?: (data: WordMnemonic) => void,
  existing?: WordMnemonic,
): Promise<WordMnemonic | null> {
  const key = word.trim().toLowerCase();
  if (!key) return null;

  // 数据来源优先级：导入表格自带 > 固定词表（四级/高中/初中）> 旧版本地四级词库
  const builtIn = getBuiltInIndex().get(key) || findCet4Mnemonic(word);
  let seed = fillGaps(existing, builtIn);

  // 固定词表命中且字段齐全 → 直接返回，不联网
  if (isComplete(seed)) {
    cacheSet(key, seed!);
    onUpdate?.(seed!);
    return seed;
  }

  // 缓存里的历史结果（例如之前联网补全过的）用来补齐剩余字段
  const cached = cacheGet(key);
  seed = fillGaps(seed, cached);
  if (isComplete(seed)) {
    cacheSet(key, seed!);
    onUpdate?.(seed!);
    return seed;
  }

  const [accent, tint] = paletteFor(word);
  const merged: WordMnemonic = {
    splitParts: seed?.splitParts || [],
    etymology: seed?.etymology || '',
    rhyme: seed?.rhyme || '',
    quick: seed?.quick || '',
    family: seed?.family || [],
    caution: seed?.caution || '',
    phonetic: seed?.phonetic || '',
    accent: seed?.accent || accent,
    tint: seed?.tint || tint,
  };

  const emit = () => {
    if (hasContent(merged)) onUpdate?.({ ...merged });
  };
  emit();

  await Promise.allSettled([
    fetchYoudao(word).then((yd) => {
      if (!yd) return;
      if (!merged.phonetic) merged.phonetic = yd.phonetic || '';
      if (!merged.etymology) merged.etymology = yd.etymology || '';
      if (!merged.family?.length) merged.family = yd.family || [];
      emit();
    }),
    fetchGenerated(word, meaning).then((gen) => {
      if (!gen) return;
      if (!merged.splitParts?.length && gen.splitParts?.length) merged.splitParts = gen.splitParts;
      if (!merged.rhyme) merged.rhyme = gen.rhyme || '';
      if (!merged.quick) merged.quick = gen.quick || '';
      if (!merged.caution) merged.caution = gen.caution || '';
      emit();
    }),
  ]);

  if (!hasContent(merged)) return null;

  // 口诀/速记没拿到（例如免费模型限流）时只短期缓存，稍后还能重试
  const complete = !!merged.rhyme && !!merged.quick;
  cacheSet(key, merged, complete ? CACHE_TTL : PARTIAL_TTL);
  onUpdate?.({ ...merged });
  return { ...merged };
}

function hasContent(m: WordMnemonic): boolean {
  return !!(
    m.rhyme || m.quick || m.etymology || m.caution ||
    (m.splitParts || []).length > 0 || (m.family || []).length > 0
  );
}

/** 计算一份助记信息的"完整度分数"（填充字段越多分越高） */
function completeness(m: WordMnemonic | null | undefined): number {
  if (!m) return 0;
  let s = 0;
  if (m.phonetic) s++;
  if (m.etymology) s++;
  if (m.rhyme) s++;
  if (m.quick) s++;
  if (m.caution) s++;
  if ((m.splitParts || []).length) s += 2;
  if ((m.family || []).length) s += 2;
  return s;
}

// ============================================
// 固定词表索引：用户自导入词表缺少助记时，从这里兜底查找
// ============================================

/** word(小写) → 助记，来源为四级 / 高中 / 初中三份内置词表 */
let builtInMnemonicIndex: Map<string, WordMnemonic> | null = null;

/** 惰性构建内置词表索引（约 7000 词，只在首次使用时构建一次） */
function getBuiltInIndex(): Map<string, WordMnemonic> {
  if (builtInMnemonicIndex) return builtInMnemonicIndex;
  const map = new Map<string, WordMnemonic>();
  for (const book of [CET4_EMBEDDED_BOOK, SENIOR_EMBEDDED_BOOK, JUNIOR_EMBEDDED_BOOK]) {
    for (const sheet of book.sheets) {
      for (const item of sheet.words) {
        const extra = item.extra;
        if (!extra) continue;
        const key = item.word.trim().toLowerCase();
        if (!key) continue;
        // 同一单词在多份词表里出现时，保留字段更完整的那份
        const prev = map.get(key);
        if (!prev || completeness(extra) > completeness(prev)) map.set(key, extra);
      }
    }
  }
  builtInMnemonicIndex = map;
  return map;
}

/** 以 base 为准，用 donor 补全 base 里缺失的字段（不覆盖已有内容） */
function fillGaps(
  base: WordMnemonic | null | undefined,
  donor: WordMnemonic | null | undefined,
): WordMnemonic | null {
  if (!base) return donor || null;
  if (!donor) return base;
  return {
    ...base,
    phonetic: base.phonetic || donor.phonetic,
    etymology: base.etymology || donor.etymology,
    rhyme: base.rhyme || donor.rhyme,
    quick: base.quick || donor.quick,
    caution: base.caution || donor.caution,
    splitParts: base.splitParts?.length ? base.splitParts : donor.splitParts,
    family: base.family?.length ? base.family : donor.family,
  };
}
