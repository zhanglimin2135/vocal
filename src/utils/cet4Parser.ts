/**
 * 解析「四级词汇」HTML文件里内嵌的 const D = {...} JSON 数据。
 * 格式：
 *   <script>
 *     const D = {"names": [...], "data": {"四级词汇 List 09-1": {"w": [{"w": "...", "m": "...", ...}, ...], "h": "...", ...}}}
 *     ...JS 逻辑...
 *   </script>
 * 返回合并后的扁平单词列表：{ uid, word, meaning, phonetic, sheetName, extra }[]
 *
 * @param sheetFilter 可选：只保留 sheet 名在该 Set 里的单词；undefined 表示全部保留
 */
import cet4Html from '@/data/cet4-list.html?raw';
import type { StudyWord } from '@/types';

interface Cet4Word {
  w: string;   // word
  m: string;   // meaning
  p?: string;  // phonetic
  s?: string[]; // split parts
  x?: string;   // etymology
  h?: string;   // hook
  q?: string;   // 口诀
  f?: string[]; // family
  n?: string;   // note
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

let parsedCache: StudyWord[] | null = null;

export function parseCet4Words(sheetFilter?: Set<string>): StudyWord[] {
  const useCache = parsedCache && !sheetFilter;
  if (useCache) return parsedCache!;

  // 从 HTML 里的 <script> 中提取 const D = ... 对象
  const match = cet4Html.match(/const\s+D\s*=\s*(\{[\s\S]*?\});\s*\n/);
  if (!match) {
    console.error('CET4 HTML: 未能找到 const D = {...}');
    return [];
  }
  try {
    const raw = match[1];
    // eslint-disable-next-line no-new-func
    const data = (new Function(`return ${raw}`)()) as Cet4Data;

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
          extra: {
            etymology: w.x || '',
            hook: w.h || '',
            split: (w.s || []).join(' '),
            phonetic: w.p || '',
          },
        });
      }
    }
    if (!sheetFilter) parsedCache = out;
    return out;
  } catch (e) {
    console.error('解析 CET4 HTML 失败', e);
    return [];
  }
}

/** 按 Sheet 名分组返回（可选，用于侧边目录） */
export function getCet4Sheets(): { name: string; wordCount: number }[] {
  const match = cet4Html.match(/const\s+D\s*=\s*(\{[\s\S]*?\});\s*\n/);
  if (!match) return [];
  try {
    // eslint-disable-next-line no-new-func
    const data = (new Function(`return ${match[1]}`)()) as Cet4Data;
    return (data.names || []).map((name) => ({
      name,
      wordCount: (data.data[name]?.w?.length) || 0,
    }));
  } catch { return []; }
}
