/**
 * 封面主题色提取（mobile）。
 *
 * 两级策略：
 *  1. **服务端优先**：GET /image/dominant-color（sharp 32px 平均色，算法与 desktop
 *     canvas 对齐，服务端有磁盘缓存）。色值最准，且与 desktop 逐像素同源。
 *  2. **本地兜底**：服务端不可用时走 utils/dominantColorLocal.ts 纯 JS 解析
 *     （96px PNG 优先 → 原图 → 96px JPEG；阈值平均算法与 desktop 同源）。覆盖：
 *     - 老版本服务端没有该端点（404）或不支持 fmt=png（400）；
 *     - 外链封面（Emby / Subsonic）不在服务端 src 白名单内；
 *     - 网络异常 / 超时。
 *
 * 本地兜底同时生成一张 96px 磨砂 PNG data URI，供播放详情页在服务端不支持
 * blur 参数或外链封面时使用；主题色仍是主结果，磨砂图生成失败不影响取色。
 */
import { getBaseURL } from "../https";
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
  /** 仅本地兜底成功时提供；服务端正常时继续用 /image/optimize 的服务端磨砂图 */
  blurredCoverUri?: string;
  /** 服务端/本地解析是否已结束；未结束时调用方可暂缓渲染清晰背景，避免旧服务端先闪未模糊原图 */
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

/** 服务端取色超时：网络 hang 时必须及时进入本地兜底 */
const SERVER_TIMEOUT_MS = 8_000;
/** data URI 磨砂图会放大单条缓存体积；限制条数防长期播放无限增长 */
const MAX_CACHE_ENTRIES = 100;

const cache = new Map<string, CoverVisual>();
const inflight = new Map<string, Promise<CoverVisual>>();

interface NormalizedCover {
  isRemote: boolean;
  cleanPath: string;
}

function normalizeCover(cover?: string | null): NormalizedCover | null {
  if (!cover) return null;
  const isRemote = /^https?:\/\//i.test(cover);
  const cleanPath = isRemote
    ? cover
    : cover.startsWith("/")
      ? cover.substring(1)
      : cover;
  // 本地路径只认 /covers/（与服务端白名单一致）；外链一律交给本地解析
  if (!isRemote && !cleanPath.startsWith("covers/")) return null;
  return { isRemote, cleanPath };
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
  const normalized = normalizeCover(cover);
  return normalized ? cache.get(normalized.cleanPath) ?? null : null;
}

/** 服务端取色（仅 AudioDock 源；白名单在服务端，/covers/ 之外一律 400） */
async function fetchServerColor(cleanPath: string): Promise<Rgb | null> {
  if (!cleanPath.startsWith("covers/")) return null;
  const baseURL = getBaseURL().replace(/\/$/, "");
  const src = encodeURIComponent(`/${cleanPath}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // RN 的 AbortSignal 类型与 DOM lib 存在既有冲突；这里用 race 做逻辑超时，
    // 让「服务端 hang」能及时进入本地兜底（迟到的 fetch 结果会被 Promise.race 忽略）。
    const timeout = new Promise<Response | null>((resolve) => {
      timer = setTimeout(() => resolve(null), SERVER_TIMEOUT_MS);
    });
    const res = await Promise.race([
      fetch(`${baseURL}/image/dominant-color?src=${src}`),
      timeout,
    ]);
    if (!res || !res.ok) return null;
    const data = (await res.json()) as {
      r?: unknown;
      g?: unknown;
      b?: unknown;
    };
    if (
      typeof data?.r === "number" &&
      typeof data?.g === "number" &&
      typeof data?.b === "number"
    ) {
      return { r: data.r, g: data.g, b: data.b };
    }
    return null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const toCoverVisual = (local: LocalCoverVisual | null): Omit<CoverVisual, "resolved"> =>
  local
    ? { color: local.color, blurredCoverUri: local.blurredCoverUri }
    : { color: null };

/**
 * 按封面路径取播放页视觉信息（主题色 + 本地兜底磨砂图）。
 * @param cover track.cover（/covers/xxx 或 http(s) 外链）
 */
export function fetchCoverVisual(cover?: string | null): Promise<CoverVisual> {
  const normalized = normalizeCover(cover);
  if (!normalized) return Promise.resolve({ color: null, resolved: true });
  const { isRemote, cleanPath } = normalized;

  if (cache.has(cleanPath)) return Promise.resolve(cache.get(cleanPath)!);
  if (inflight.has(cleanPath)) return inflight.get(cleanPath)!;

  const p = (async (): Promise<Omit<CoverVisual, "resolved">> => {
    // 1) 服务端优先（外链跳过，白名单必然拒绝，省一次 400）
    if (!isRemote) {
      const serverColor = await fetchServerColor(cleanPath);
      if (serverColor) return { color: serverColor };
    }
    // 2) 本地兜底：老服务端 404/400 / 外链封面 / 服务端异常
    return toCoverVisual(await resolveLocalCoverVisual(cover));
  })()
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
