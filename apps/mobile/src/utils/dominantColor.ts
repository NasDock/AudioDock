/**
 * 封面主题色提取（mobile）。
 *
 * 移动端没有 canvas，取色走服务端 GET /image/dominant-color（sharp 缩小 32px 平均色，
 * 算法与 desktop useCoverDominantColor 对齐，结果服务端磁盘缓存）。
 *
 * 仅 AudioDock 源的 /covers/ 路径可用（服务端白名单）；Emby/Subsonic 外链封面
 * 或旧版服务端（无此接口，404）一律返回 null，调用方回退默认主题色。
 */
import { getBaseURL } from "../https";

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

const cache = new Map<string, Rgb | null>();
const inflight = new Map<string, Promise<Rgb | null>>();

/**
 * 按封面路径取主题色。
 * @param cover track.cover（/covers/xxx 或 http(s) 外链）
 */
export function fetchDominantColor(cover?: string | null): Promise<Rgb | null> {
  if (!cover) return Promise.resolve(null);
  // 外链封面（Emby/Subsonic）服务端白名单不支持，直接跳过
  if (cover.startsWith("http://") || cover.startsWith("https://")) {
    return Promise.resolve(null);
  }
  const cleanPath = cover.startsWith("/") ? cover.substring(1) : cover;
  if (!cleanPath.startsWith("covers/")) return Promise.resolve(null);

  if (cache.has(cleanPath)) return Promise.resolve(cache.get(cleanPath)!);
  if (inflight.has(cleanPath)) return inflight.get(cleanPath)!;

  const baseURL = getBaseURL().replace(/\/$/, "");
  const src = encodeURIComponent(`/${cleanPath}`);
  const p = fetch(`${baseURL}/image/dominant-color?src=${src}`)
    .then(async (res): Promise<Rgb | null> => {
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
    })
    .catch(() => null)
    .then((color) => {
      cache.set(cleanPath, color);
      inflight.delete(cleanPath);
      return color;
    });
  inflight.set(cleanPath, p);
  return p;
}
