/**
 * 封面主题色提取（hm）。
 *
 * 与 mobile src/utils/dominantColor.ts 一致：走服务端 GET /image/dominant-color
 * （sharp 缩小 32px 平均色，算法同 desktop canvas 版，服务端磁盘缓存）。
 * 仅 AudioDock 源 /covers/ 路径可用；外链封面或旧版服务端（404）返回 null，调用方回退默认主题色。
 */
import http from '@ohos.net.http';
import { httpClient } from 'features_network';
import { Logger } from 'audiodock_common';

const TAG = 'DominantColor';

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
  return {
    r: Math.round(c.r * factor),
    g: Math.round(c.g * factor),
    b: Math.round(c.b * factor),
  };
}

const cache = new Map<string, Rgb | null>();

/** 按封面路径取主题色；不支持的来源/失败一律 null */
export async function fetchDominantColor(cover: string | null | undefined): Promise<Rgb | null> {
  if (!cover) return null;
  // 外链封面（Emby/Subsonic）服务端白名单不支持，直接跳过
  if (cover.startsWith('http://') || cover.startsWith('https://')) return null;
  const cleanPath = cover.startsWith('/') ? cover.substring(1) : cover;
  if (!cleanPath.startsWith('covers/')) return null;

  const cached = cache.get(cleanPath);
  if (cached !== undefined) return cached;

  const base = httpClient.getBaseURL();
  if (!base) return null;

  const req = http.createHttp();
  try {
    const url = `${base}/image/dominant-color?src=${encodeURIComponent('/' + cleanPath)}`;
    const resp = await req.request(url, {
      method: http.RequestMethod.GET,
      readTimeout: 5000,
      connectTimeout: 5000,
    });
    if (resp.responseCode === 200 && typeof resp.result === 'string') {
      const data = JSON.parse(resp.result) as Rgb;
      if (typeof data.r === 'number' && typeof data.g === 'number' && typeof data.b === 'number') {
        cache.set(cleanPath, data);
        return data;
      }
    }
    cache.set(cleanPath, null);
    return null;
  } catch (e) {
    Logger.w(TAG, `fetchDominantColor failed: ${String(e)}`);
    return null;
  } finally {
    req.destroy();
  }
}
