/**
 * 封面主题色（hm）统一入口。
 *
 * 与 mobile src/utils/dominantColor.ts 一致：播放详情页主题色**纯本地计算**，
 * 不再请求服务端 GET /image/dominant-color。具体的下载候选、图片解码、32×32 采样与
 * 阈值取色规则见 utils/dominantColorLocal.ets（与 mobile dominantColorLocal.ts 同源）。
 *
 * 本文件只负责颜色工具 + 内存缓存 + 并发去重；调用方（PlayerPage）拿不到色时
 * 回退默认主题色，异步刷新不阻塞首帧渲染。
 */
import { resolveLocalDominantColor } from './dominantColorLocal';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Rgb → '#RRGGBB' */
export function rgbToHex(c: Rgb): string {
  const h = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Rgb + alpha → '#AARRGGBB'（ArkUI 8 位 hex 是 alpha 在前） */
export function alphaHex(c: Rgb, a: number): string {
  const h = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(a * 255)}${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Rgb + alpha → 'rgba(r, g, b, a)' */
export function rgba(c: Rgb, a: number): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;
}

/** 按比例压暗（factor 0~1），用于由主题色推导渐变暗部 */
export function shade(c: Rgb, factor: number): Rgb {
  const out: Rgb = {
    r: Math.round(c.r * factor),
    g: Math.round(c.g * factor),
    b: Math.round(c.b * factor),
  };
  return out;
}

/** 按比例向白色混合（factor 0~1），用于亮色模式由主题色推导浅色渐变（保黑字可读） */
export function tint(c: Rgb, factor: number): Rgb {
  const out: Rgb = {
    r: Math.round(c.r + (255 - c.r) * factor),
    g: Math.round(c.g + (255 - c.g) * factor),
    b: Math.round(c.b + (255 - c.b) * factor),
  };
  return out;
}

/** 缓存上限：长期播放不让它无限增长（与 mobile MAX_CACHE_ENTRIES 一致） */
const MAX_CACHE_ENTRIES = 100;

const cache = new Map<string, Rgb | null>();
const inflight = new Map<string, Promise<Rgb | null>>();

/** 与 mobile normalizeCover 一致：相对路径只认 covers/；外链与 file:// 一律本地解析 */
function normalizeCover(cover?: string | null): string | null {
  if (!cover) return null;
  const isRemote: boolean = cover.startsWith('http://') || cover.startsWith('https://') ||
    cover.startsWith('file://');
  const cleanPath: string = isRemote ? cover : (cover.startsWith('/') ? cover.substring(1) : cover);
  if (!isRemote && !cleanPath.startsWith('covers/')) return null;
  return cleanPath;
}

function setCache(key: string, color: Rgb | null): void {
  if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) {
    // Map.forEach 按插入顺序遍历，取第一条即最旧（ArkTS 不支持 Array.from(map.keys())）
    let oldest: string = '';
    cache.forEach((_v: Rgb | null, k: string): void => {
      if (oldest.length === 0) oldest = k;
    });
    if (oldest.length > 0) cache.delete(oldest);
  }
  cache.set(key, color);
}

/** 同步读取内存缓存（播放页首帧用，对齐 mobile getCachedCoverVisual / desktop hook） */
export function getCachedDominantColor(cover?: string | null): Rgb | null {
  const key: string | null = normalizeCover(cover);
  if (key === null) return null;
  const cached: Rgb | null | undefined = cache.get(key);
  return cached === undefined ? null : cached;
}

/**
 * 按封面取主题色：本地下载 + 本地解码 + 本地取色，失败一律 null。
 * 同封面并发请求复用同一个 Promise；结果（含失败）进内存缓存。
 */
export function fetchDominantColor(cover: string | null | undefined): Promise<Rgb | null> {
  const key: string | null = normalizeCover(cover);
  if (key === null) return Promise.resolve<Rgb | null>(null);

  const cached: Rgb | null | undefined = cache.get(key);
  if (cached !== undefined) return Promise.resolve<Rgb | null>(cached);
  const pending: Promise<Rgb | null> | undefined = inflight.get(key);
  if (pending !== undefined) return pending;

  const task: Promise<Rgb | null> = resolveLocalDominantColor(cover)
    .catch((): Rgb | null => null)
    .then((c: Rgb | null): Rgb | null => {
      setCache(key, c);
      inflight.delete(key);
      return c;
    });
  inflight.set(key, task);
  return task;
}
