/**
 * 播放页视觉预热（mini 态闲时执行，mobile）。
 *
 * 背景：从 MiniPlayer push 到 /player 时，播放页是**首次挂载**：
 *  - `useCoverVisual` 首帧同步读 `utils/dominantColor.ts` 的内存缓存，但此前只有播放页
 *    会触发取色，缓存是空的 → 先渲染中性黑，等「下载 96px PNG + JS 解码取色」完成才
 *    突然叠加主题色渐变，肉眼就是「背景色闪一下」；
 *  - MiniPlayer 封面走 96 档（app/player.tsx 主封面走 900 档、横屏轮播走 300 档），
 *    URL 不同 → RN Image 缓存不命中，进全屏才从头下载大图。
 *
 * 解法：曲目一确定就在 PlayerProvider 层（mini 与全屏共享同一个 Provider）把两件事提前做完：
 *  1. 立即 `fetchCoverVisual(cover)` 填主题色 + 本地磨砂图缓存（自带 cache/inflight 去重）；
 *  2. 延迟到闲时 `Image.prefetch` 900/300 档大封面，进全屏时 Image 直接命中缓存。
 *
 * 放在 Provider 而不是 MiniPlayer 组件里：车机 embedded 常驻、通知栏冷启动恢复、
 * 播放流转等所有入口都会经过 currentTrack，一处即可覆盖，且 mini 隐藏时也能预热。
 */
import { Image } from "react-native";
import {
  fetchCoverVisual,
  getCachedCoverVisual,
  invalidateCoverVisual,
} from "./dominantColor";
import { getImageUrl } from "./image";
import { getMediaHeaders, hasMediaHeaders } from "./mediaAuth";

/** 与 app/player.tsx 主封面 / VinylCover 的 900 档保持一致 */
const FULLSCREEN_COVER_WIDTH = 900;
/** 与 app/player.tsx 横屏封面轮播的 300 档保持一致 */
const CAROUSEL_COVER_WIDTH = 300;
/** 大图可能几 MB（内网直连原图），延迟到起播缓冲之后，不与音频流抢带宽 */
const IDLE_DELAY_MS = 3000;
/** 与 dominantColor 的 MAX_CACHE_ENTRIES 对齐，防长期播放时 Set 无限增长 */
const MAX_PRIMED = 100;

/** 已调度过闲时预热的封面；React 严格模式 / 重复切歌不会重复排队 */
const primed = new Set<string>();

/**
 * 预热当前曲目的播放页视觉。可重复调用（同封面只调度一次闲时任务）。
 * @param cover track.cover（/covers/xxx 或 http(s) 外链）
 */
export function primePlayerVisuals(cover?: string | null): void {
  if (!cover) return;

  // ① 主题色 + 本地磨砂图：必须立即起步，不能等闲时延迟。
  //    这是消除「背景色闪一下」的关键 —— 取色要下载 96px PNG 并在 JS 侧解码，
  //    若也压到 3s 后，用户切歌立刻点开全屏时仍会闪。
  //    生成的 blurredCoverUri 是 data URI，顺带把磨砂底图也备好了（无需再请求服务端 blur 图）。
  if (!getCachedCoverVisual(cover)) {
    void fetchCoverVisual(cover)
      .then((visual) => {
        // 冷启动早期源配置可能还没水合，取色会失败。别把 null 结果留在缓存里，
        // 否则播放页首帧会一直读到「已解析但无色」，反而彻底没有主题色；
        // 清掉后播放页挂载时会重新解析一次（那时配置已就绪）。
        if (!visual.color && !visual.blurredCoverUri) {
          invalidateCoverVisual(cover);
        }
      })
      .catch(() => undefined);
  }

  if (primed.has(cover)) return;
  if (primed.size >= MAX_PRIMED) primed.clear();
  primed.add(cover);

  // ② 大封面：延迟到闲时预取。
  //    外链封面（飞牛/Emby/Subsonic）getImageUrl 直返原 URL、与尺寸无关，
  //    mini 已经把同一张原图加载进 RN Image 缓存，不需要再取；
  //    带鉴权头的源也不能用 Image.prefetch（它不支持 headers），故一并跳过。
  //    本地磨砂图走 expo-image 且是 data URI，不在这里预热。
  setTimeout(() => {
    if (hasMediaHeaders(getMediaHeaders())) return;
    if (cover.startsWith("http://") || cover.startsWith("https://")) return;
    void Image.prefetch(getImageUrl(cover, undefined, FULLSCREEN_COVER_WIDTH)).catch(
      () => undefined,
    );
    void Image.prefetch(getImageUrl(cover, undefined, CAROUSEL_COVER_WIDTH)).catch(
      () => undefined,
    );
  }, IDLE_DELAY_MS);
}
