/**
 * 解析「四级词汇」HTML文件里内嵌的 const D = {...} JSON 数据。
 * 格式：
 *   <script>
 *     const D = {"names": [...], "data": {"四级词汇 List 09-1": {"w": [{"w": "...", "m": "...", ...}, ...], "h": "...", ...}}}
 *     ...JS 逻辑...
 *   </script>
 * 返回合并后的扁平单词列表：{ uid, word, meaning, phonetic, sheetName, extra }[]
 *
 * 另外提供 findCet4Mnemonic(word)：按单词文本在全册范围内查助记信息，
 * 供背诵页「助记」弹窗对上传词表里同名单词做内容补全。
 *
 * @param sheetFilter 可选：只保留 sheet 名在该 Set 里的单词；undefined 表示全部保留
 */
import cet4Html from '@/data/cet4-list.html?raw';
import type { StudyWord, WordMnemonic } from '@/types';

interface Cet4Word {
  w: string;   // word
  m: string;   // meaning
  p?: string;  // phonetic
  s?: string[]; // split parts
  x?: string;   // etymology
  h?: string;   // 口诀（hook）
  q?: string;   // 速记
  f?: string[]; // family
  n?: string;   // note / 易错
  a?: string;   // accent color
  b?: string;   // bg color
}

interface Cet4Sheet {
  w: Cet4Word[];
  h?: string;   // header topic
  s?: string;   // sub title
  r?: Record<string, unknown>; // roots
}

interface Cet4Data {
  names: string[];
  data: Record<string, Cet4Sheet>;
}

let dataCache: Cet4Data | null = null;
let mnemonicCache: Map<string, WordMnemonic> | null = null;

/** 从 HTML 里提取并缓存 const D = {...} 对象 */
function getCet4Data(): Cet4Data | null {
  if (dataCache) return dataCache;
  const match = cet4Html.match(/const\s+D\s*=\s*(\{[\s\S]*?\});\s*\n/);
  if (!match) {
    console.error('CET4 HTML: 未能找到 const D = {...}');
    return null;
  }
  try {
    // eslint-disable-next-line no-new-func
    dataCache = (new Function(`return ${match[1]}`)()) as Cet4Data;
    return dataCache;
  } catch (e) {
    console.error('解析 CET4 HTML 失败', e);
    return null;
  }
}

/** 把原始单词条目映射成助记信息（字段为空时不显示，由弹窗按需判断） */
function toMnemonic(w: Cet4Word): WordMnemonic {
  return {
    splitParts: w.s || [],
    etymology: w.x || '',
    rhyme: w.h || '',
    quick: w.q || '',
    family: w.f || [],
    caution: w.n || '',
    phonetic: w.p || '',
    accent: w.a || '',
    tint: w.b || '',
  };
}

export function parseCet4Words(sheetFilter?: Set<string>): StudyWord[] {
  const data = getCet4Data();
  if (!data) return [];

  const out: StudyWord[] = [];
  const sheets = data.names || Object.keys(data.data);
  for (const sheetName of sheets) {
    // 过滤：没有勾选的 sheet 跳过
    if (sheetFilter && !sheetFilter.has(sheetName)) continue;

    const sheet = data.data[sheetName];
    if (!sheet || !Array.isArray(sheet.w)) continue;
    for (let i = 0; i < sheet.w.length; i++) {
      const w = sheet.w[i];
      out.push({
        uid: `cet4_${sheetName}_${i}`,
        word: w.w.trim(),
        meaning: (w.m || '').trim(),
        phonetic: (w.p || '').trim(),
        sheetName,
        extra: toMnemonic(w),
      });
    }
  }
  return out;
}

/**
 * 按单词（忽略大小写）查询助记信息，全册范围内的第一个同名单词生效。
 * 找不到（或该词没有口诀/速记等任何扩展内容）时返回 null。
 */
export function findCet4Mnemonic(word: string): WordMnemonic | null {
  const data = getCet4Data();
  if (!data) return null;

  if (!mnemonicCache) {
    const map = new Map<string, WordMnemonic>();
    for (const sheetName of data.names || Object.keys(data.data)) {
      const sheet = data.data[sheetName];
      if (!sheet || !Array.isArray(sheet.w)) continue;
      for (const w of sheet.w) {
        const key = w.w.trim().toLowerCase();
        if (!key || map.has(key)) continue;
        map.set(key, toMnemonic(w));
      }
    }
    mnemonicCache = map;
  }

  const found = mnemonicCache.get(word.trim().toLowerCase());
  if (!found) return null;
  const hasContent =
    (found.rhyme || '') !== '' ||
    (found.quick || '') !== '' ||
    (found.etymology || '') !== '' ||
    (found.splitParts || []).length > 0 ||
    (found.family || []).length > 0 ||
    (found.caution || '') !== '';
  return hasContent ? found : null;
}

/** 按 Sheet 名分组返回（可选，用于侧边目录） */
export function getCet4Sheets(): { name: string; wordCount: number }[] {
  const data = getCet4Data();
  if (!data) return [];
  return (data.names || []).map((name) => ({
    name,
    wordCount: (data.data[name]?.w?.length) || 0,
  }));
}
