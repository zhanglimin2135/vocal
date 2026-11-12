/**
 * 听力精听「导入网页」文件的本地存储
 *   用户在外部拆分工具里点「⬇️ 下载网页」会得到一个内嵌音频的独立 .html 文件。
 *   文件体积通常在几 MB 到几十 MB，localStorage 存不下，因此放进 IndexedDB。
 *   目录条目只保存 htmlKey，点击卡片时再取出内容生成 Blob URL 打开。
 */

const DB_NAME = 'vocal_listening';
const DB_VERSION = 1;
const STORE_NAME = 'pages';

/** 打开（或首次创建）IndexedDB 数据库 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 保存一份网页 HTML */
export async function saveHtmlPage(key: string, html: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(html, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** 读取一份网页 HTML；不存在时返回 null */
export async function getHtmlPage(key: string): Promise<string | null> {
  const db = await openDb();
  const html = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as string) || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return html;
}

/** 删除一份网页 HTML */
export async function deleteHtmlPage(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
