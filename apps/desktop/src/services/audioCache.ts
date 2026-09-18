/**
 * 秒播优化：web 模式（浏览器）音频缓存，基于 Cache Storage API。
 *
 * 背景：`<audio>` 拉流带 `Range: bytes=0-`，响应是 206 Partial Content，
 * Chrome HTTP 缓存对 206 不缓存，且媒体栈强制 `Cache-Control: no-cache`。
 * 所以「服务端加 Cache-Control」对 web 复播无效，只能 App 层自己缓存。
 *
 * 策略：
 * - 播放时后台 fetch 整首（不带 Range）存进 CacheStorage，key 用完整 URL
 * - 复播时 caches.match(url) 命中 → blob → URL.createObjectURL 喂给 <audio>
 * - Tauri 模式不用这个（走 Rust 本地流服务器），web 模式专用
 * - 失败静默（缓存是优化不是必需，网络/配额问题不影响播放）
 */

const CACHE_NAME = "audiodock-audio-v1";

// 正在下载的 URL 去重，避免同一首歌并发拉多次
const inflight = new Map<string, Promise<void>>();

/**
 * 后台把整首音频下载进 CacheStorage。不阻塞调用方，失败静默。
 */
export const cacheAudioInBackground = (url: string): void => {
  if (!url || !url.startsWith("http")) return;
  if (typeof caches === "undefined") return;
  if (inflight.has(url)) return;

  const task = (async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      // 已缓存则跳过
      const existing = await cache.match(url);
      if (existing) return;
      // 整首下载（不带 Range），拿到完整 200 响应才能被 CacheStorage 存
      const resp = await fetch(url);
      if (!resp.ok) return;
      await cache.put(url, resp);
      console.log(`[AudioCache] cached: ${url}`);
    } catch (e) {
      console.warn(`[AudioCache] cache failed: ${url}`, e);
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, task);
};

/**
 * 查询缓存命中。命中返回 blob URL（可直接喂给 <audio src>），未命中返回 null。
 * blob URL 由调用方负责在不需要时 URL.revokeObjectURL（这里不管理生命周期，
 * 因为 <audio> 的加载是异步的，调用方换 src 时统一 revoke）。
 */
export const getCachedAudioUrl = async (
  url: string,
): Promise<string | null> => {
  if (!url || !url.startsWith("http")) return null;
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const resp = await cache.match(url);
    if (!resp) return null;
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
};

/**
 * 清空音频缓存（设置页「清除缓存」可调用）。
 */
export const clearAudioCache = async (): Promise<void> => {
  if (typeof caches === "undefined") return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    /* ignore */
  }
};
