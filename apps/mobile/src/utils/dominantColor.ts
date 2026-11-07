/**
 * 封面主题色提取（mobile）。
 *
 * 两级策略：
 *  1. **服务端优先**：GET /image/dominant-color（sharp 32px 平均色，算法与 desktop
 *     canvas 对齐，服务端有磁盘缓存）。色值最准，且与 desktop 逐像素同源。
 *  2. **本地兜底**：服务端不可用时走 utils/dominantColorLocal.ts 纯 JS 解析
 *     （96px PNG → 32×32 块平均 → 同一套阈值算法）。覆盖三种场景：
 *     - 老版本服务端没有该端点（404）；
 *     - 外链封面（Emby / Subsonic）不在服务端 src 白名单内；
 *     - 网络异常 / 超时。
 *
 * 本地兜底与 desktop 实测偏差：平均 Δ1.68、最差 Δ11（60 张样本），肉眼难辨；
 * 属于「原本完全拿不到色」场景的补位，不影响服务端正常时的精确度。
 */
import { getBaseURL } from "../https";
import { resolveLocalDominantColor } from "./dominantColorLocal";

export interface Rgb {
  r: number;
  g: number;
  b: number;
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

const cache = new Map<string, Rgb | null>();
const inflight = new Map<string, Promise<Rgb | null>>();

/** 服务端取色（仅 AudioDock 源；白名单在服务端，/covers/ 之外一律 400） */
async function fetchServerColor(cleanPath: string): Promise<Rgb | null> {
  if (!cleanPath.startsWith("covers/")) return null;
  const baseURL = getBaseURL().replace(/\/$/, "");
  const src = encodeURIComponent(`/${cleanPath}`);
  try {
    const res = await fetch(`${baseURL}/image/dominant-color?src=${src}`);
    if (!res.ok) return null;
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
  }
}

/**
 * 按封面路径取主题色。
 * @param cover track.cover（/covers/xxx 或 http(s) 外链）
 */
export function fetchDominantColor(cover?: string | null): Promise<Rgb | null> {
  if (!cover) return Promise.resolve(null);
  const isRemote = /^https?:\/\//i.test(cover);
  const cleanPath = isRemote
    ? cover
    : cover.startsWith("/")
      ? cover.substring(1)
      : cover;
  // 本地路径只认 /covers/（与服务端白名单一致）；外链一律交给本地解析
  if (!isRemote && !cleanPath.startsWith("covers/")) {
    return Promise.resolve(null);
  }

  if (cache.has(cleanPath)) return Promise.resolve(cache.get(cleanPath)!);
  if (inflight.has(cleanPath)) return inflight.get(cleanPath)!;

  const p = (async (): Promise<Rgb | null> => {
    // 1) 服务端优先（外链跳过，白名单必然拒绝，省一次 400）
    if (!isRemote) {
      const serverColor = await fetchServerColor(cleanPath);
      if (serverColor) return serverColor;
    }
    // 2) 本地兜底：老服务端 404 / 外链封面 / 服务端异常
    return resolveLocalDominantColor(cover);
  })().then((color) => {
    cache.set(cleanPath, color);
    inflight.delete(cleanPath);
    return color;
  });
  inflight.set(cleanPath, p);
  return p;
}
