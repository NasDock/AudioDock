/**
 * 播放页大封面闲时预热（mini）。
 *
 * 背景：mini 条封面走 128 档，播放页主封面走 600 档；`GET /image/optimize` 的
 * `w` 是 URL 的一部分，微信 `<image>` 按 URL 缓存 → 进 player 页不命中，才从头
 * 下载大图，封面卡片先露出 `#eee` 灰底再跳成图片。
 * （mini 端没有封面取色 / 主题色渐变，全屏背景恒为 #fff、mini 条也是 #fff，
 *   所以不存在 desktop/mobile/hm 那种「背景色闪一下」，这里只解决大图重新下载。）
 *
 * 解法：mini 态闲时把 600 档大图提前加载好，播放页首帧直接复用：
 *  1. 渲染一个 2rpx 的隐藏 `<image>`，让微信客户端把该 URL 下载进图片缓存；
 *     播放页用**同一个 URL** 渲染即命中 —— 小程序没有 RN 的 Image.prefetch，
 *     隐藏 image 是唯一不依赖 downloadFile 合法域名的预加载手段；
 *  2. 同时试一次 `Taro.getImageInfo`，成功则把返回的本地缓存路径记进内存，
 *     播放页首帧同步读它（零网络）。它走 downloadFile 合法域名 + 真机 https，
 *     内网 http / 未配白名单会失败 —— 静默降级，隐藏 image 仍会兜住。
 *
 * 约束：
 *  - 预取 URL 与渲染 URL 必须来自同一个 `buildPlayerCoverUrl()`，否则缓存不命中；
 *  - 外链封面（Subsonic / Emby）`getImageUrl` 直返原 URL、与 width 无关，
 *    mini 条已加载过同一张图，跳过；
 *  - `getImageInfo` 的 path 仅本次小程序生命周期有效，与这里的模块级 Map 同生命周期，
 *    不需要持久化，冷启动自动为空。
 */
import Taro from '@tarojs/taro';
import { getImageUrl } from './image';

/** 与 pages/player/index.tsx 主封面档位一致（mini 条是 128 档） */
export const PLAYER_COVER_WIDTH = 600;
/** 与 pages/player/index.tsx 局部 getImageUrl 的占位图一致 */
const PLAYER_COVER_PLACEHOLDER = 'https://picsum.photos/400/400';
/**
 * 让音频先完成初始缓冲，不与音频流抢带宽。
 * 比 mobile/hm 的 3s 短：那两端有「立即预热主题色」兜住首帧，mini 的大图是唯一闪源。
 */
export const IDLE_DELAY_MS = 1500;
/** 防长期播放内存无限增长 */
const MAX_CACHED = 12;

/** 大图 URL → getImageInfo 拿到的本地缓存路径 */
const localPathByUrl = new Map<string, string>();
/** 同一 URL 的并发去重（页面栈里多个 mini 条实例会各自触发一次） */
const inflight = new Set<string>();

/** 预取与渲染共用的唯一 URL 构造入口 */
export function buildPlayerCoverUrl(cover?: string | null): string {
  return getImageUrl(cover, PLAYER_COVER_PLACEHOLDER, PLAYER_COVER_WIDTH);
}

/** 外链封面与 width 无关，mini 条已把同一张图加载进缓存，无需预取 */
export function shouldPrefetchPlayerCover(cover?: string | null): boolean {
  if (!cover) return false;
  return !cover.startsWith('http://') && !cover.startsWith('https://');
}

/**
 * 播放页 `<Image src>` 用这个：命中预热就直接给本地缓存路径（零网络），
 * 否则回退网络 URL（此时隐藏 image 已让微信按 URL 缓存命中）。
 * 同步函数，保证首帧就能拿到，不需要等异步结果。
 */
export function resolvePlayerCoverSrc(cover?: string | null): string {
  const url = buildPlayerCoverUrl(cover);
  return localPathByUrl.get(url) ?? url;
}

/** 尝试把大图下载成本地缓存路径；失败静默降级，不影响主链路 */
export async function prefetchPlayerCover(url: string): Promise<void> {
  if (!url || localPathByUrl.has(url) || inflight.has(url)) return;
  inflight.add(url);
  try {
    const res = await Taro.getImageInfo({ src: url });
    const path = res && res.path ? res.path : '';
    // 开发者工具里 path 有时仍是原网络 URL，那不算本地缓存，不必记
    if (path && path !== url) {
      localPathByUrl.set(url, path);
      if (localPathByUrl.size > MAX_CACHED) {
        const oldest = localPathByUrl.keys().next();
        if (!oldest.done) localPathByUrl.delete(oldest.value);
      }
    }
  } catch {
    // 域名白名单 / 内网 http / 网络抖动：隐藏 image 兜底
  } finally {
    inflight.delete(url);
  }
}
