/**
 * 封面主题色提取（mobile）。
 *
 * mobile 播放详情页**纯本地计算**，不再请求服务端 /image/dominant-color：
 *  - AudioDock 源封面按「96px PNG → 原图 → 96px JPEG」下载像素（见
 *    utils/dominantColorLocal.ts）；
 *  - 外链封面（Emby / Subsonic）直接下载原图；
 *  - 解码后按 desktop canvas 同源阈值算法（32×32，跳过死黑/死白/低饱和灰）取色。
 *
 * 本地解码同时生成一张 96px 磨砂 PNG data URI，供播放详情页在服务端不支持
 * blur 参数或外链封面时使用；主题色仍是主结果，磨砂图生成失败不影响取色。
 */
import {
  resolveLocalCoverVisual,
  type LocalCoverVisual,
} from "./dominantColorLocal";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface CoverVisual {
  color: Rgb | null;
  /** 本地解码成功时提供 */
  blurredCoverUri?: string;
  /** 本地解析是否已结束；未结束时调用方可暂缓渲染清晰背景，避免旧服务端先闪未模糊原图 */
  resolved: boolean;
}

export const rgba = (c: Rgb, a: number) =>
  `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;

/** 按比例压暗（factor 0~1），用于由主题色推导渐变暗部 */
export const shade = (c: Rgb, factor: number): Rgb => ({
  r: Math.round(c.r * factor),
  g: Math.round(c.g * factor),
  b: Math.round(c.b * factor),
});

/** 按比例向白色混合（factor 0~1），用于亮色模式由主题色推导浅色渐变（保黑字可读） */
export const tint = (c: Rgb, factor: number): Rgb => ({
  r: Math.round(c.r + (255 - c.r) * factor),
  g: Math.round(c.g + (255 - c.g) * factor),
  b: Math.round(c.b + (255 - c.b) * factor),
});

/** data URI 磨砂图会放大单条缓存体积；限制条数防长期播放无限增长 */
const MAX_CACHE_ENTRIES = 100;

const cache = new Map<string, CoverVisual>();
const inflight = new Map<string, Promise<CoverVisual>>();

function normalizeCover(cover?: string | null): string | null {
  if (!cover) return null;
  const isRemote = /^https?:\/\//i.test(cover);
  const cleanPath = isRemote
    ? cover
    : cover.startsWith("/")
      ? cover.substring(1)
      : cover;
  // 本地路径只认 /covers/（与图片代理白名单一致）；外链一律本地解析
  if (!isRemote && !cleanPath.startsWith("covers/")) return null;
  return cleanPath;
}

function setCache(key: string, visual: CoverVisual) {
  if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, visual);
}

/** 同步读取内存缓存（播放页首帧用，对齐 desktop hook 的 cache 初始化行为） */
export function getCachedCoverVisual(cover?: string | null): CoverVisual | null {
  const cleanPath = normalizeCover(cover);
  return cleanPath ? cache.get(cleanPath) ?? null : null;
}

const toCoverVisual = (local: LocalCoverVisual | null): Omit<CoverVisual, "resolved"> =>
  local
    ? { color: local.color, blurredCoverUri: local.blurredCoverUri }
    : { color: null };

/**
 * 按封面路径取播放页视觉信息（主题色 + 本地磨砂图）。
 * @param cover track.cover（/covers/xxx 或 http(s) 外链）
 */
export function fetchCoverVisual(cover?: string | null): Promise<CoverVisual> {
  const cleanPath = normalizeCover(cover);
  if (!cleanPath) return Promise.resolve({ color: null, resolved: true });

  if (cache.has(cleanPath)) return Promise.resolve(cache.get(cleanPath)!);
  if (inflight.has(cleanPath)) return inflight.get(cleanPath)!;

  const p = (async (): Promise<Omit<CoverVisual, "resolved">> =>
    toCoverVisual(await resolveLocalCoverVisual(cover)))()
    .catch((): Omit<CoverVisual, "resolved"> => ({ color: null }))
    .then((visual) => {
      const resolvedVisual: CoverVisual = { ...visual, resolved: true };
      setCache(cleanPath, resolvedVisual);
      return resolvedVisual;
    })
    .finally(() => {
      inflight.delete(cleanPath);
    });
  inflight.set(cleanPath, p);
  return p;
}

/**
 * 按封面路径取主题色。
 * @param cover track.cover（/covers/xxx 或 http(s) 外链）
 */
export function fetchDominantColor(cover?: string | null): Promise<Rgb | null> {
  return fetchCoverVisual(cover).then((visual) => visual.color);
}
