/**
 * 发音工具：多音源自动降级，尽量让每个词条都用「真人 / 高音质」发声
 *
 * 播放优先级：
 *   1) 指定口音（美音→有道 type=2 / 英音→有道 type=1）
 *   2) 另一口音的有道录音
 *   3) 百度翻译 TTS（自然音色，短语/整句全覆盖）
 *
 *   有道 / 百度 都失败时直接静音，不再使用机械合成，避免听感混叠。
 *
 * 额外保障：
 *   - 每次新的调用会取消前一次播放（audio + speechSynthesis），快速点击不会串音
 *   - 记住每个词条上次成功的音源，下次直接用它减少等待
 */

// 音频缓存：按 URL 缓存 HTMLAudioElement，同一个音频不重复下载，点击立即播放
const audioCache = new Map<string, HTMLAudioElement>();

// 每个词条上次成功的音源下标（0=首选口音，1=次选口音，2=百度）
const preferredStart = new Map<string, number>();

// 当前正在播放的音频元素；每次新调用都会先停掉它，防止多音源串音
let currentAudio: HTMLAudioElement | null = null;

// 播放代次计数器：每次 stopPrevious() 自增，playUrl 收到代次后若与当前代次不符就不再更新状态，
// 避免上一次播放的 Promise 意外影响到这一次（尤其是缓存 Audio 元素复用时）
let playGen = 0;

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

/** 按指定口音构建音源列表，失败时自动降级到另一口音，最后百度 TTS */
function buildSources(word: string, preferAccent: 'us' | 'uk'): AudioSource[] {
  const firstType = preferAccent === 'us' ? 2 : 1;
  const secondType = preferAccent === 'us' ? 1 : 2;
  const firstName = preferAccent === 'us' ? '有道美音' : '有道英音';
  const secondName = preferAccent === 'us' ? '有道英音' : '有道美音';
  return [
    { name: firstName, url: getAudioUrl(word, firstType) },
    { name: secondName, url: getAudioUrl(word, secondType) },
    { name: '百度发音', url: getBaiduAudioUrl(word) },
  ];
}

/** 停掉上一次还在播放的音频 + speechSynthesis，避免多音源串音；并推进播放代次 */
function stopPrevious() {
  playGen++;
  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
  } catch { /* ignore */ }
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}

/**
 * 播放指定的一个音频地址
 * 播完 → resolve；加载/解码失败、超时、被新代次取消 → reject，由上层换下一个音源
 * gen: 播放代次，stopPrevious() 时会递增；只有 gen === playGen 的回调才会真正生效
 */
function playUrl(url: string, gen: number, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    // 查缓存：同一音频播过就不再重新下载
    let audio = audioCache.get(url);
    if (!audio) {
      audio = new Audio(url);
      audio.preload = 'auto';
      audioCache.set(url, audio);
    } else {
      audio.currentTime = 0;
    }

    const el = audio;
    let settled = false;

    // 统一收尾：保证 ended / error / 超时 / 代次变更 只生效一次
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      el.removeEventListener('ended', handleEnded);
      el.removeEventListener('error', handleError);
      window.clearTimeout(timeoutId);
      if (gen !== playGen) {
        // 被新代次取消（stopPrevious 已调用）：静默 reject，不影响 currentAudio
        reject(new Error('cancelled'));
        return;
      }
      if (ok) {
        currentAudio = el;
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
 *   依次尝试 首选口音（有道）→ 另一口音（有道）→ 百度 TTS，第一个能播的就停。
 *   三个音源都失败时直接静音，不再用机械合成。
 *   快速重复调用会取消前一次播放，不会串音。
 * @param word 要发音的英文单词或短语（支持任意长度的短语、句子）
 * @param preferAccent 首选口音：'us'=美音（有道 type=2）、'uk'=英音（type=1）
 */
export async function playWordAudio(word: string, preferAccent: 'us' | 'uk' = 'us'): Promise<void> {
  // 空内容直接返回
  if (!word) return;

  // 先停掉上一次还在播的，并推进播放代次，旧代次的回调不再生效
  stopPrevious();
  const gen = playGen;

  const sources = buildSources(word, preferAccent);
  // 该词条上次成功的音源下标（没记录就从 0 首选口音开始）
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
      await playUrl(sources[i].url, gen);
      // 成功：记住这个音源，下次直接从它开始，省掉前面失败音源的等待
      if (playGen === gen) preferredStart.set(word, i);
      return;
    } catch (e) {
      if (playGen !== gen) {
        // 被新的 playWordAudio 调用打断 → 立刻退出旧循环
        return;
      }
      // 当前音源没有这个词条 / 播放失败 → 继续尝试下一个音源
    }
  }

  // 三个音源都读不出来：直接结束，不再播放机械音
}
