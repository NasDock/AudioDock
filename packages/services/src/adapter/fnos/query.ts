import type { FnosClient } from "./client";
import type { FnosArtist, FnosPage } from "./types";

/**
 * AudioDock 用 `skip + pageSize`，飞牛用 `page(1 起) + size`。
 * 这里统一换算，避免每个适配器各写一遍。
 */
export const skipToPage = (skip: number, pageSize: number): number => {
  const safeSize = Math.max(1, pageSize || 1);
  const safeSkip = Math.max(0, skip || 0);
  return Math.floor(safeSkip / safeSize) + 1;
};

/** 拉全量的哨兵值（飞牛约定 size=-1 返回全部） */
export const FNOS_ALL = -1;

const ALBUM_TRACK_SORT: Record<string, string> = {
  index: "trackNo",
  id: "trackNo",
  fileName: "trackNo",
  episodeNumber: "trackNo",
  fileCreatedAt: "createdAt",
  fileModifiedAt: "createdAt",
  scanOrder: "createdAt",
};

/**
 * 专辑内曲目排序：AudioDock 传的是语义化 sortBy + asc/desc，
 * 飞牛要 `字段,方向`，字段只有 trackNo / createdAt 这类。
 */
export const albumTrackSortToFnos = (
  sortBy?: string,
  sort: "asc" | "desc" = "asc",
): string => {
  const field = (sortBy && ALBUM_TRACK_SORT[sortBy]) || "trackNo";
  return `${field},${sort}`;
};

const LIST_SORT: Record<string, string> = {
  name: "name",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  year: "year",
  trackCount: "trackCount",
  albumCount: "albumCount",
};

/**
 * 列表排序：UI 传来的 sortBy 可能是 'name' / 'createdAt' 等，
 * 也允许直接传飞牛原生写法（'name,desc'）——原样放行。
 */
export const listSortToFnos = (
  sortBy?: string,
  fallback = "createdAt,desc",
): string => {
  if (!sortBy) return fallback;
  if (sortBy.includes(",")) return sortBy;
  const field = LIST_SORT[sortBy];
  return field ? `${field},desc` : fallback;
};

/** 响应里的 total 缺失时用当前页长度兜底 */
export const pageTotal = <T>(page?: FnosPage<T> | null): number => {
  if (!page) return 0;
  if (typeof page.total === "number") return page.total;
  return page.list?.length || 0;
};

/**
 * 用名字反查歌手 guid：飞牛「歌手内曲目」接口只认 guid，
 * 而 AudioDock 的 getTracksByArtist 传的是歌手名。
 */
export const resolveArtistGuid = async (
  client: FnosClient,
  name: string,
): Promise<string | null> => {
  const keyword = String(name || "").trim();
  if (!keyword) return null;
  try {
    const page = await client.get<FnosPage<FnosArtist>>("/search/artist", {
      q: keyword,
      page: 1,
      size: 10,
    });
    const list = page?.list || [];
    const exact = list.find((item) => item.name === keyword);
    return (exact || list[0])?.guid || null;
  } catch (error) {
    console.warn("[Fnos] 歌手名转 guid 失败", keyword, error);
    return null;
  }
};

/** 同理：专辑详情用 guid，但部分调用方只有专辑名 */
export const resolveAlbumGuid = async (
  client: FnosClient,
  name: string,
): Promise<string | null> => {
  const keyword = String(name || "").trim();
  if (!keyword) return null;
  try {
    const page = await client.get<FnosPage<{ guid: string; name: string }>>(
      "/search/album",
      { q: keyword, page: 1, size: 10 },
    );
    const list = page?.list || [];
    const exact = list.find((item) => item.name === keyword);
    return (exact || list[0])?.guid || null;
  } catch (error) {
    console.warn("[Fnos] 专辑名转 guid 失败", keyword, error);
    return null;
  }
};
