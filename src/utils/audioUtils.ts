/**
 * 发音工具：多音源自动降级，尽量让每个词条都用「真人 / 高音质」发声
 *
 * 为什么需要多个音源（均经实测确认）：
 *   1) 有道美音（type=1）：真人录音，音质最好，但音频库有缺口。
 *      例如「their body」「carry fifty times their body weight」直接返回 HTTP 500
 *      （服务器消息 returned null audio），根本没有录音。这与词条长短无关；
 *   2) 有道英音（type=2）：与美音是两套独立录音，恰好能补上一部分美音缺失的词条
 *      （实测「their body」英音有 16KB 音频，美音是 500）；
 *   3) 百度翻译 TTS：覆盖面几乎 100%，任意短语整句都能读，音色自然（实测稳定返回 MP3）。
 *
 * 播放顺序：有道美音 → 有道英音 → 百度 TTS。
 * 百度是最后一道，若它也读不出来就直接放弃（不再使用机械音合成，避免听感太差）。
 * 会记住每个词条「哪个音源成功过」，下次优先用它，避免每次重复试错、减少延迟。
 */

// 音频缓存：按 URL 缓存 HTMLAudioElement，同一个音频不重复下载，点击立即播放
const audioCache = new Map<string, HTMLAudioElement>();

// 每个词条上次成功的音源下标：下次直接从该音源开始尝试（1 = 英音，2 = 百度…），
// 减少每次点击都先等一次失败请求的时间
const preferredStart = new Map<string, number>();

/**
 * 根据单词获取有道发音的完整 URL 链接
 * 一般情况下直接用 playWordAudio 播放就行，这个函数主要用于调试
 * @param word 要发音的英文单词
 * @param type 1=美音，2=英音
 */
export function getAudioUrl(word: string, type: 1 | 2 = 1): string {
  // encodeURIComponent 把空格、特殊字符转义成合法 URL（例如 "ice cream" → "ice%20cream"）
  const encoded = encodeURIComponent(word);
  return `https://dict.youdao.com/dictvoice?audio=${encoded}&type=${type}`;
}

/**
 * 百度翻译的发音接口（备用高音质音源）
 * 特点：任意英文短语、整句都能朗读，不挑词条
 */
function getBaiduAudioUrl(text: string): string {
  const encoded = encodeURIComponent(text);
  // spd=3 为语速档位（3 是自然语速），source=web 表示网页端来源
  return `https://fanyi.baidu.com/gettts?lan=en&text=${encoded}&spd=3&source=web`;
}

/** 单个音源：名称用于调试，url 用于实际加载 */
interface AudioSource {
  name: string;
  url: string;
}

/** 按优先级构建该词条要尝试的音源列表（不含最后的语音合成兜底） */
function buildSources(word: string): AudioSource[] {
  return [
    { name: '有道美音', url: getAudioUrl(word, 1) },
    { name: '有道英音', url: getAudioUrl(word, 2) },
    { name: '百度发音', url: getBaiduAudioUrl(word) },
  ];
}

/**
 * 播放指定的一个音频地址
 * 播完 → resolve；加载/解码失败、超时 → reject，由上层换下一个音源
 */
function playUrl(url: string, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    // 查缓存：同一音频播过就不再重新下载
    let audio = audioCache.get(url);
    if (!audio) {
      audio = new Audio(url);
      // preload="auto" 让浏览器尽量提前下载，点击即可播放
      audio.preload = 'auto';
      audioCache.set(url, audio);
    } else {
      // 已经播过：进度拉回 0，从头开始
      audio.currentTime = 0;
    }

    const el = audio;
    let settled = false;

    // 统一收尾：保证 ended / error / 超时 只生效一次
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      el.removeEventListener('ended', handleEnded);
      el.removeEventListener('error', handleError);
      window.clearTimeout(timeoutId);
      if (ok) {
        resolve();
        return;
      }
      // 失败：删掉这个失效的缓存对象（下次换音源时不会拿到坏对象）
      audioCache.delete(url);
      reject(new Error('该音源播放失败'));
    };

    // 播放自然结束
    const handleEnded = () => finish(true);
    // 加载 / 解码失败（例如有道返回 500 的 JSON、断网等）
    const handleError = () => finish(false);

    // 短超时：音源不可用时尽快换下一个，不让用户干等
    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);

    el.addEventListener('ended', handleEnded);
    el.addEventListener('error', handleError);

    // 浏览器原生播放
    const playPromise = el.play();
    // 被浏览器拦截自动播放或解码失败时，也进入换源流程
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => finish(false));
    }
  });
}

/**
 * 播放指定词条的发音
 *   依次尝试有道美音 → 有道英音 → 百度 TTS，第一个能播的就用
 *   三个音源都失败时直接静音返回（不再使用机械音合成）
 * @param word 要发音的英文单词或短语（支持任意长度的短语、句子）
 */
export async function playWordAudio(word: string): Promise<void> {
  // 空内容直接返回
  if (!word) return;

  const sources = buildSources(word);
  // 该词条上次成功的音源下标（没记录就从 0 有道美音开始）
  let startIndex = preferredStart.get(word) ?? 0;
  // 防御：历史记录越界时回到第一个音源
  if (startIndex >= sources.length) startIndex = 0;

  // 尝试顺序：优先从上次成功的音源开始；若它后面全失败，再回头试前面更高质量的音源，
  // 这样偶发故障不会让某个词条被永久「降级」
  const allIndexes = sources.map((_, i) => i);
  const attempts = [
    ...allIndexes.slice(startIndex),
    ...allIndexes.slice(0, startIndex),
  ];

  for (const i of attempts) {
    try {
      await playUrl(sources[i].url);
      // 成功：记住这个音源，下次直接从它开始，省掉前面失败音源的等待
      preferredStart.set(word, i);
      return;
    } catch {
      // 当前音源没有这个词条 / 播放失败 → 继续尝试下一个音源
    }
  }

  // 三个音源都读不出来：直接结束，不再播放机械音
}
