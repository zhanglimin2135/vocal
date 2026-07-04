/**
 * 托福阅读补全单词练习 - 文章解析工具
 * 负责把用户输入的「文章文本」和「答案文本」解析成可以渲染的 Passage 结构
 */

import type {
  ReadingPassage,
  PassageSegment,
  BlankWord,
  BlankChar,
  BlankResult,
  PassageResult,
} from '@/types';

/**
 * 生成一个简短的唯一 ID（用于空格/单词的 key）
 * 格式：随机 8 位十六进制字符
 */
function genId(): string {
  return Math.random().toString(16).slice(2, 10);
}

/**
 * 从一段文本的"第一行"提取出标题
 * 约定：
 *   - 如果文本第一行以 "Title:" / "title:" / "标题:" 开头，则去掉前缀并 trim 作为标题
 *   - 否则整段第一行就是标题
 * 返回 [标题, 剩余内容]
 */
export function extractTitleAndBody(raw: string): { title: string; body: string } {
  const trimmed = raw.replace(/\r\n/g, '\n').trimStart();
  const firstNewlineIdx = trimmed.indexOf('\n');
  let firstLine: string;
  let body: string;
  if (firstNewlineIdx === -1) {
    firstLine = trimmed.trim();
    body = '';
  } else {
    firstLine = trimmed.slice(0, firstNewlineIdx).trim();
    body = trimmed.slice(firstNewlineIdx + 1);
  }
  // 去掉前缀标记
  const prefixMatch = firstLine.match(/^(?:Title|title|标题)\s*[:：]\s*(.*)$/);
  const title = prefixMatch ? prefixMatch[1].trim() : firstLine;
  return { title: title || '未命名文章', body: body.trim() };
}

/**
 * 把用户输入的「文章内容文本」按顺序识别出：纯文本片段 + 带空格的单词
 * 例如：
 *   "The qui_k br_wn f_x."
 *   会被拆成：
 *     text("The ") + blank-word("qui_k") + text(" ") + blank-word("br_wn") + ...
 *
 * 判断一个 token 是不是"带空格单词"的规则：包含至少一个 '_' 且以字母/下划线开头
 * （这样就不会把单独的下划线或标点串误判成单词）
 */
function splitContentIntoSegments(
  contentBody: string
): { segments: PassageSegment[]; blankWords: BlankWord[]; totalBlanks: number } {
  const segments: PassageSegment[] = [];
  const blankWords: BlankWord[] = [];
  let globalBlankCounter = 0;

  // 用正则交替匹配：要么是"字母/数字/下划线/连字符组成的词"，要么是其它字符（作为 text）
  // 我们只把含 '_' 的词认定为 blank-word，其它都作为纯文本处理
  const regex = /([A-Za-z0-9_\-']+)|([^A-Za-z0-9_\-']+)/g;
  let m: RegExpExecArray | null;
  // 暂存连续的纯文本，合并后再塞进去，避免产生很多细碎的 text segment
  let pendingText = '';

  const flushText = () => {
    if (pendingText.length > 0) {
      segments.push({ type: 'text', content: pendingText });
      pendingText = '';
    }
  };

  while ((m = regex.exec(contentBody)) !== null) {
    const [, wordLike, nonWordLike] = m;
    if (nonWordLike !== undefined) {
      // 非"词"字符 → 直接追加到 pendingText
      pendingText += nonWordLike;
    } else {
      // 像词的字符串
      if (wordLike.includes('_')) {
        // 含下划线 → 这是一个带空格的单词
        flushText();
        const wordIndex = blankWords.length;
        // 扫描这个单词里的每个字符，找出 '_' 的位置并生成 BlankChar
        const blankChars: BlankChar[] = [];
        for (let i = 0; i < wordLike.length; i++) {
          if (wordLike[i] === '_') {
            blankChars.push({
              id: genId(),
              wordIndex,
              charIndexInWord: i,
              globalIndex: globalBlankCounter++,
            });
          }
        }
        const bw: BlankWord = {
          id: genId(),
          wordIndex,
          originalMasked: wordLike,
          correctWord: '', // 稍后用答案填充
          blankChars,
        };
        blankWords.push(bw);
        segments.push({ type: 'blank-word', word: bw });
      } else {
        // 普通单词 → 当文本处理
        pendingText += wordLike;
      }
    }
  }
  flushText();

  return { segments, blankWords, totalBlanks: globalBlankCounter };
}

/**
 * 解析用户输入的「答案文本」，按顺序取出每一个"正确单词"
 * 支持两种答案格式：
 *   A) 完整文本版：和文章一样的完整段落（只是没有下划线），我们按顺序提取出与第 N 个
 *      带空格单词"同位置"的普通单词作为答案
 *   B) 单词列表版：每行一个答案词，按顺序对应文章里的每个 blank-word
 *
 * 这里的识别策略：先按"有没有换行且每行看起来像一个单词"粗判，如果每行基本都是 1 个
 * 单词（不含空格）就用模式 B，否则当作模式 A。
 */
function parseAnswerWords(
  answerRaw: string,
  blankWordsCount: number
): string[] {
  const answerBody = answerRaw.replace(/\r\n/g, '\n').trim();

  // 去掉第一行的"标题行"（如果存在）以获得纯答案部分
  const { body: pureAnswer } = extractTitleAndBody(answerBody);

  // 如果是"每行一个单词"：行数 >= blankWordsCount 的 80%，并且每行去掉空白后都不含空格
  const lines = pureAnswer
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const eachLineOneWord =
    lines.length >= Math.max(1, Math.ceil(blankWordsCount * 0.8)) &&
    lines.every((l) => !/\s/.test(l));

  if (eachLineOneWord) {
    // 模式 B：每行一个单词
    // 多余的行忽略，不够的用空串补
    const result: string[] = [];
    for (let i = 0; i < blankWordsCount; i++) {
      result.push(lines[i] || '');
    }
    return result;
  }

  // 模式 A：完整文本。我们从答案文本里按顺序"抽取"和 blank-word 相同位置的普通单词
  // 做法：把文章内容里的 blank-word 当作"占位符"，在答案文本里按同样的顺序取词
  // 简单实现：直接用正则把答案里的"所有英文单词"抽出来，按 blankWordsCount 截前 N 个
  // （对于托福补全题来说，文章里空的位置通常恰好是答案段落里的第 N 个词——
  //   如果用户给的是完整答案文本，就按此假设匹配。如果实际位置对不上，用户也可以
  //   用单词列表版 B 精确指定。）
  const allWords = pureAnswer.match(/[A-Za-z0-9\-']+/g) || [];
  const result: string[] = [];
  for (let i = 0; i < blankWordsCount; i++) {
    result.push(allWords[i] || '');
  }
  return result;
}

/**
 * 核心入口：把用户提供的（文章原始文本，答案原始文本）解析成一篇 ReadingPassage
 * 会做这些事：
 *   1. 从文章文本提取标题（如果有 Title: 前缀则使用，否则第一行作为标题）
 *   2. 解析文章内容：识别出所有带 _ 的"空词"，生成 BlankWord + BlankChar
 *   3. 解析答案文本：按顺序得到每个空词对应的正确单词
 *   4. 把正确单词写回每个 BlankWord 的 correctWord 字段
 *
 * @throws 如果解析出来的空词数量和答案词数量差距过大，会抛错提示用户
 */
export function parseReadingPassage(
  rawContentInput: string,
  rawAnswerInput: string
): ReadingPassage {
  if (!rawContentInput.trim()) {
    throw new Error('文章内容不能为空');
  }
  if (!rawAnswerInput.trim()) {
    throw new Error('答案内容不能为空');
  }

  const { title, body: contentBody } = extractTitleAndBody(rawContentInput);
  const { segments, blankWords, totalBlanks } = splitContentIntoSegments(
    contentBody
  );

  const answerWords = parseAnswerWords(rawAnswerInput, blankWords.length);

  // 把答案填入每个 blank-word
  blankWords.forEach((bw, idx) => {
    bw.correctWord = answerWords[idx] || '';
  });

  // 校验：是否有某个空词的 correctWord 长度和 originalMasked 不一致
  // （只是警告性质，这里不报错，避免过于严格影响使用）
  for (const bw of blankWords) {
    if (bw.correctWord && bw.correctWord.length !== bw.originalMasked.length) {
      // 这里我们只打印一条警告，不中断流程
      console.warn(
        `[PassageParser] 警告：单词 "${bw.originalMasked}" (长度 ${bw.originalMasked.length}) 与答案 "${bw.correctWord}" (长度 ${bw.correctWord.length}) 长度不一致，请核对。`
      );
    }
  }

  return {
    id: genId(),
    title,
    rawContent: rawContentInput,
    rawAnswer: rawAnswerInput,
    segments,
    blankWords,
    totalBlanks,
    createdAt: Date.now(),
  };
}

/**
 * 给「用户答案 Map」和一篇 Passage，计算答题结果
 * @param userAnswers Map<blankCharId, 用户输入的字母>
 */
export function gradePassage(
  passage: ReadingPassage,
  userAnswers: Record<string, string>
): PassageResult {
  const blankResults: BlankResult[] = [];
  let correctCount = 0;

  for (const bw of passage.blankWords) {
    for (const bc of bw.blankChars) {
      const userInput = (userAnswers[bc.id] || '').trim();
      const correctLetter =
        bw.correctWord && bc.charIndexInWord < bw.correctWord.length
          ? bw.correctWord[bc.charIndexInWord]
          : '';
      const isCorrect =
        correctLetter.length > 0 &&
        userInput.length > 0 &&
        userInput.toLowerCase() === correctLetter.toLowerCase();
      if (isCorrect) correctCount++;
      blankResults.push({
        blankCharId: bc.id,
        userInput,
        correctLetter,
        isCorrect,
      });
    }
  }

  const totalCount = blankResults.length;
  return {
    passageId: passage.id,
    blankResults,
    correctCount,
    totalCount,
    accuracy: totalCount === 0 ? 1 : correctCount / totalCount,
    submittedAt: Date.now(),
  };
}
