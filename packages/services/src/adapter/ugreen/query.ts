import type { UgreenPageBase } from "./types";

/**
 * AudioDock 用 `skip + pageSize`，绿联用 `page(1 起) + page_size`。
 * 这里统一换算，避免每个适配器各写一遍。
 */
export const skipToPage = (skip: number, pageSize: number): number => {
  const safeSize = Math.max(1, pageSize || 1);
  const safeSkip = Math.max(0, skip || 0);
  return Math.floor(safeSkip / safeSize) + 1;
};

/** 拉全量的哨兵值：绿联没有「-1 全量」约定，给一个足够大的 page_size */
export const UGREEN_ALL = 10000;

/**
 * sort_type 值映射（官方前端 valueMap）：
 * 0 添加时间 / 1 名称 / 2 歌手 / 3 碟号 / 4 年份 / 5 手动 / 6 收藏时间 / 7 加入歌单时间
 *
 * 注意：collect/v2、songlist/by_id/v2 不接受 sort_type=0（报 1005/9405）。
 */
export const UGREEN_SORT = {
  addTime: 0,
  name: 1,
  singer: 2,
  disc: 3,
  year: 4,
  manual: 5,
  collectTime: 6,
  addToSheetTime: 7,
} as const;

const LIST_SORT_MAP: Record<string, number> = {
  name: UGREEN_SORT.name,
  createdAt: UGREEN_SORT.addTime,
  updatedAt: UGREEN_SORT.addTime,
  artist: UGREEN_SORT.singer,
  singer: UGREEN_SORT.singer,
  year: UGREEN_SORT.year,
};

/** 列表排序：UI 传的 sortBy（'name'/'createdAt' 等）→ 绿联 sort_type */
export const listSortToUgreen = (
  sortBy?: string,
  fallback: number = UGREEN_SORT.addTime,
): number => {
  if (!sortBy) return fallback;
  return LIST_SORT_MAP[sortBy] ?? fallback;
};

/** 专辑内曲目排序：绿联专辑详情只有 sort_type 枚举，碟内顺序用名称(1)近似 */
export const albumTrackSortToUgreen = (sortBy?: string): number => {
  if (sortBy === "index" || sortBy === "id" || sortBy === "episodeNumber") {
    return UGREEN_SORT.disc;
  }
  if (sortBy === "fileCreatedAt" || sortBy === "fileModifiedAt" || sortBy === "scanOrder") {
    return UGREEN_SORT.addTime;
  }
  return UGREEN_SORT.name;
};

/** 响应里的 total_num 缺失时用当前页长度兜底 */
export const pageTotal = (page?: UgreenPageBase | null, currentLength = 0): number => {
  if (!page) return currentLength;
  if (typeof page.total_num === "number") return page.total_num;
  return currentLength;
};

/** 是否还有下一页：优先 is_last_page，缺失时按 total_num 推算 */
export const pageHasMore = (
  page: UgreenPageBase | null | undefined,
  loaded: number,
): boolean => {
  if (!page) return false;
  if (typeof page.is_last_page === "boolean") return !page.is_last_page;
  if (typeof page.total_num === "number") return loaded < page.total_num;
  return false;
};
