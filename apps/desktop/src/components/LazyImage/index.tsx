import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

interface LazyImageProps {
  src: string | undefined;
  /**
   * 低档占位图 URL（可选）。用于"先复用已缓存的小图、再异步升级到高清"的场景：
   * 例如从播放列表点击播放后，列表已加载 96 档封面，mini/详情页直接请求 128/600 档会
   * 因 URL 不同而重新下载、期间黑屏。传入与列表同参数的低档 URL 后，本组件首帧即显示
   * 它（命中浏览器缓存，秒开），后台预载高清 src 完成后无缝替换。
   * 必须与 src 指向同一张图（仅尺寸/质量档位不同），否则会先显示错误封面。
   */
  placeholderSrc?: string | undefined;
  alt?: string;
  /** 目标显示宽度（像素）。必须传，避免 CLS */
  width: number | string;
  /** 目标显示高度（像素）。必须传，避免 CLS */
  height: number | string;
  className?: string;
  style?: React.CSSProperties;
  /** 自定义占位组件；不传则使用统一的灰色背景 */
  renderPlaceholder?: (size: { width: number | string; height: number | string }) => React.ReactNode;
  /** 当 src 缺失时是否仍渲染占位（默认 true） */
  showPlaceholderWhenMissing?: boolean;
  /** 提前触发加载的 rootMargin（默认 "200px"） */
  rootMargin?: string;
  onClick?: React.MouseEventHandler<HTMLImageElement>;
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
  onError?: React.ReactEventHandler<HTMLImageElement>;
}

/**
 * 视口懒加载的 <img> 包装
 *
 * 用法：
 *   <LazyImage src={getCoverUrl(track.cover, track.id, 128)} width={80} height={80} alt={track.name} />
 *                                              ^^^^^^^^ 目标设备像素宽度（按显示尺寸 ×2 估算）
 *
 * 关键点：
 *  - width / height 强制约束（消除 CLS / 布局抖动）
 *  - 进入视口 + rootMargin 缓冲才设置 src，控制并发
 *  - 原生 loading="lazy" + decoding="async" 作为额外兜底
 *  - 占位与最终图片布局完全一致（避免抖动）
 */
export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  placeholderSrc,
  alt,
  width,
  height,
  className,
  style,
  renderPlaceholder,
  showPlaceholderWhenMissing = true,
  rootMargin = "200px",
  onClick,
  onLoad,
  onError,
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  // 实际展示的图片地址：src 变化时保持旧图显示，新图后台预载完成后无缝切换，
  // 避免尺寸/缩放导致的 src 变化闪出占位符。
  // 有 placeholderSrc 时首帧直接用它（低档图，列表刚加载过→命中缓存秒开），不留黑屏窗口。
  const [displaySrc, setDisplaySrc] = useState<string | undefined>(placeholderSrc);

  // 视口判定只在挂载时执行一次；src 后续变化不重置（否则已展示的图片会闪回占位符）
  useEffect(() => {
    if (!wrapperRef.current) return;
    if (typeof IntersectionObserver === "undefined") {
      // 极旧环境兜底：直接加载
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            observer.disconnect();
            return;
          }
        }
      },
      { rootMargin, threshold: 0.01 },
    );
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootMargin]);

  // 曲目变化（低档占位 URL 变化）时立即切到新占位图，避免切歌瞬间显示上一首封面。
  // 低档 URL 绑定曲目封面，所以它的变化等价于"换了首歌"；新占位命中列表缓存秒开，
  // 随后下方 effect 后台预载高清 src 再替换。无 placeholderSrc 时本 effect 不生效。
  const lastPlaceholderRef = useRef(placeholderSrc);
  useLayoutEffect(() => {
    if (placeholderSrc !== lastPlaceholderRef.current) {
      lastPlaceholderRef.current = placeholderSrc;
      setDisplaySrc(placeholderSrc);
    }
  }, [placeholderSrc]);

  // 进入视口后加载；src 变化时后台预载新图，加载完成再切换，切换前始终显示旧图。
  // 触发键用 src（而非 displaySrc），避免切歌重置 displaySrc 时重复发起同一预载请求。
  const displaySrcRef = useRef(displaySrc);
  displaySrcRef.current = displaySrc;
  useEffect(() => {
    if (!shouldLoad) return;
    if (!src) {
      setDisplaySrc(undefined);
      return;
    }
    if (src === displaySrcRef.current) return;
    let cancelled = false;
    const preloader = new Image();
    preloader.onload = () => {
      if (!cancelled) setDisplaySrc(src);
    };
    preloader.onerror = () => {
      // 有低档占位时预载失败保留它（比破图好看）；无占位则切到 src 触发原生 onError
      if (!cancelled && !placeholderSrc) setDisplaySrc(src);
    };
    preloader.src = src;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, shouldLoad, placeholderSrc]);

  const placeholder =
    renderPlaceholder?.({ width, height }) ??
    (typeof width === "number" && typeof height === "number" ? (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(90deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.08) 50%, rgba(0,0,0,0.04) 100%)",
        }}
      />
    ) : null);

  const hasSrc = !!src;

  return (
    <div
      ref={wrapperRef}
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        flexShrink: 0,
        ...style,
      }}
      className={className}
    >
      {displaySrc ? (
        <img
          src={displaySrc}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          onClick={onClick}
          onLoad={onLoad}
          onError={onError}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : showPlaceholderWhenMissing || !hasSrc ? (
        placeholder
      ) : null}
    </div>
  );
};

export default LazyImage;
