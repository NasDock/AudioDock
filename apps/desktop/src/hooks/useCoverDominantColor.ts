import { useEffect, useState } from "react";

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

// 跨组件复用：同一封面 URL 只取色一次
const cache = new Map<string, Rgb | null>();

/**
 * 从封面图提取主题色（canvas 平均色，跳过过暗/过亮/低饱和像素，
 * 让结果更贴近"封面主色调"而非灰扑扑的全局平均）。
 *
 * 跨源封面（Subsonic/Emby 外链）若无 CORS 头，canvas 会污染报错，
 * 此时返回 null，调用方回退到默认主题色。
 */
export function useCoverDominantColor(src?: string | null): Rgb | null {
  const [color, setColor] = useState<Rgb | null>(
    src ? cache.get(src) ?? null : null,
  );

  useEffect(() => {
    if (!src) {
      setColor(null);
      return;
    }
    if (cache.has(src)) {
      setColor(cache.get(src) ?? null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    img.onload = () => {
      try {
        const size = 32; // 缩到小尺寸取色，性能开销可忽略
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i],
            pg = data[i + 1],
            pb = data[i + 2];
          const max = Math.max(pr, pg, pb),
            min = Math.min(pr, pg, pb);
          if (max < 40 || min > 215) continue; // 跳过死黑/死白
          if (max - min < 20) continue; // 跳过低饱和灰
          r += pr;
          g += pg;
          b += pb;
          n++;
        }
        if (n === 0) {
          // 灰阶封面：退化为整体平均色
          for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            n++;
          }
        }
        const rgb: Rgb = {
          r: Math.round(r / n),
          g: Math.round(g / n),
          b: Math.round(b / n),
        };
        cache.set(src, rgb);
        if (!cancelled) setColor(rgb);
      } catch {
        cache.set(src, null);
        if (!cancelled) setColor(null);
      }
    };
    img.onerror = () => {
      cache.set(src, null);
      if (!cancelled) setColor(null);
    };
    return () => {
      cancelled = true;
    };
  }, [src]);

  return color;
}
