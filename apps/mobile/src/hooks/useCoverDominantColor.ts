/**
 * 播放页封面视觉 hook：输入 track.cover，异步取主题色（服务端接口 + 内存缓存）。
 * 服务端不可用/外链封面时走本地纯 JS 兜底，并附带本地生成的磨砂底图。
 * 失败/不支持时 color 为 null，调用方回退默认主题色。
 */
import { useEffect, useState } from "react";
import {
  fetchCoverVisual,
  fetchDominantColor,
  getCachedCoverVisual,
  type CoverVisual,
  type Rgb,
} from "../utils/dominantColor";

const EMPTY_VISUAL: CoverVisual = { color: null, resolved: false };

export function useCoverVisual(cover?: string | null): CoverVisual {
  // 与 desktop 对齐：已缓存结果首帧同步可读，避免重进播放页先闪中性黑再跳色
  const [visual, setVisual] = useState<CoverVisual>(
    () => getCachedCoverVisual(cover) ?? EMPTY_VISUAL,
  );

  useEffect(() => {
    let cancelled = false;
    if (!cover) {
      setVisual(EMPTY_VISUAL);
      return;
    }
    const cached = getCachedCoverVisual(cover);
    if (cached) {
      setVisual(cached);
      return;
    }
    // 新封面未解析前标记 unresolved：播放页先不渲染服务端 blur URL，
    // 防止旧服务端忽略 blur 参数时先闪一张清晰原图。
    setVisual(EMPTY_VISUAL);
    void fetchCoverVisual(cover).then((result) => {
      if (!cancelled) setVisual(result);
    });
    return () => {
      cancelled = true;
    };
  }, [cover]);

  return visual;
}

/** 兼容只需要主题色的调用方 */
export function useCoverDominantColor(cover?: string | null): Rgb | null {
  const [color, setColor] = useState<Rgb | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!cover) {
      setColor(null);
      return;
    }
    void fetchDominantColor(cover).then((c) => {
      if (!cancelled) setColor(c);
    });
    return () => {
      cancelled = true;
    };
  }, [cover]);

  return color;
}
