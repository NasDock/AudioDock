import { useEffect, useState, type RefObject } from "react";

interface AdaptiveCoverOptions {
  /** 封面自然尺寸（专辑 170 / 艺术家头像 120） */
  naturalSize: number;
  /** 网格间距（Row gutter 水平值，目前全站 24） */
  gap: number;
  /** 每行最少展示个数（专辑 4 / 艺术家 5） */
  minCount: number;
  /** 容器水平 padding 合计（左右各 30 → 60） */
  padding?: number;
  /** 缩放下界，极端窄窗口避免封面缩到不可用 */
  minSize?: number;
}

/** 均分放大上限：自然尺寸的 1.5 倍，与首页（Recommended）MAX_COVER_SCALE 一致，
 *  避免超宽窗口下封面被拉得过大 */
const MAX_COVER_SCALE = 1.5;

/**
 * 与首页（Recommended）一致的封面自适应缩放方案：
 * - 每行展示数量 = max(能放下的个数, minCount)；
 * - 放不下 minCount 个时封面等比缩小，保证每行至少展示 minCount 个；
 * - 剩余空间不足以新增一个时，本行元素按数量均分剩余宽度（放大填满整行），
 *   上限为自然尺寸的 1.5 倍。
 *
 * 宽度通过 ResizeObserver 实测容器 clientWidth（不含纵向滚动条，
 * 车机模式下容器本身会被压缩，无需再手动扣媒体栏宽度），
 * 只改封面尺寸，不触发任何数据重拉。
 */
export function useAdaptiveCoverSize(
  containerRef: RefObject<HTMLElement | null>,
  {
    naturalSize,
    gap,
    minCount,
    padding = 60,
    minSize = 60,
  }: AdaptiveCoverOptions,
): number {
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // containerRef 为稳定的 ref 对象，无需依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 首次渲染尚未测量时退回估算：窗口宽 - Sidebar 200 - padding
  const availableWidth =
    containerWidth > 0
      ? containerWidth - padding
      : window.innerWidth - 200 - padding;

  const fitCount = Math.floor(availableWidth / (naturalSize + gap));
  const count = Math.max(fitCount, minCount);

  // 按每行数量均分剩余宽度；减 1px 容差，避免亚像素渲染时刚好卡边界换行
  const filled =
    Math.floor((availableWidth - gap * (count - 1)) / count) - 1;
  return Math.max(
    minSize,
    Math.min(filled, Math.floor(naturalSize * MAX_COVER_SCALE)),
  );
}
