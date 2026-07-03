/**
 * 发音工具：调用有道词典的发音 API，让单词能"读出声来"
 * 使用的是有道公开接口：https://dict.youdao.com/dictvoice?audio=单词&type=1
 *  - type=1 → 美式发音（推荐默认）
 *  - type=2 → 英式发音
 */

// 音频缓存：已经加载过的单词音频不重复下载，点击时立即播放
const audioCache = new Map<string, HTMLAudioElement>();

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
 * 播放指定单词的发音（美音）
 * 用 Promise 包装，方便调用方知道播放完成了还是失败了
 * @param word 要发音的英文单词
 */
export function playWordAudio(word: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 空单词直接返回，不做任何事
    if (!word) {
      resolve();
      return;
    }
    try {
      // 第一步：查缓存。播过的单词不重复创建 Audio
      let audio = audioCache.get(word);
      if (!audio) {
        // 没缓存过：创建一个新的 HTMLAudioElement（相当于浏览器内置的音乐播放器）
        audio = new Audio(getAudioUrl(word, 1));
        // preload="auto" 告诉浏览器尽量提前把音频下好，点击就播，不会等
        audio.preload = 'auto';
        // 放进缓存里，下次同一个单词直接取
        audioCache.set(word, audio);
      } else {
        // 已经播过：把播放进度拉回 0（从头开始）
        audio.currentTime = 0;
      }

      // 事件：播放自然结束
      const onEnded = () => {
        audio?.removeEventListener('ended', onEnded);
        resolve();
      };
      // 事件：加载失败（没网、URL不对等）
      const onError = () => {
        audio?.removeEventListener('error', onError);
        reject(new Error('音频加载失败'));
      };

      // 用 once: true 确保事件触发后自动解绑，不会重复监听
      audio.addEventListener('ended', onEnded, { once: true });
      audio.addEventListener('error', onError, { once: true });

      // 调用浏览器原生 play() 开始播放
      const playPromise = audio.play();
      // 有些浏览器 play() 本身会返回 Promise，catch 一下以防被浏览器阻止自动播放
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          reject(new Error('播放被阻止或失败'));
        });
      }
    } catch (e) {
      reject(e);
    }
  });
}
