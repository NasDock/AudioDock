/**
 * 播放页封面主题色 hook：输入 track.cover，异步取色（服务端接口 + 内存缓存）。
 * 失败/不支持时返回 null，调用方回退默认主题色。
 */
import { useEffect, useState } from "react";
import { fetchDominantColor, type Rgb } from "../utils/dominantColor";

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
