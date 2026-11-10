import { getAdapter } from "./adapter/manager";
import request from "./request";
import type { Album, Artist, ISuccessResponse, Playlist, Track } from "./models";

export interface SearchResults {
  tracks: Track[];
  artists: Artist[];
  albums: Album[];
  /** 只有实现了搜索能力的适配器（当前是飞牛）才会返回歌单结果 */
  playlists?: Playlist[];
}

/**
 * 取当前数据源的搜索实现。
 *
 * native / subsonic / emby 在对接时都没做搜索，`getAdapter().search` 是 undefined，
 * 这些源继续走官方服务端的 request；飞牛则走自己的 `/search/*`。
 */
const searchImpl = () => getAdapter().search;

const FAILED_DATA = [] as never[];

/** 单个请求失败不影响其它栏目的结果 */
const settled = async <T>(task: Promise<ISuccessResponse<T>>): Promise<ISuccessResponse<T>> => {
  try {
    return await task;
  } catch (error) {
    console.warn("[Search] 搜索请求失败", error);
    return { code: 500, message: "search failed", data: FAILED_DATA as unknown as T };
  }
};

export const searchTracks = async (
  keyword: string,
  type?: string,
  limit: number = 10,
): Promise<ISuccessResponse<Track[]>> => {
  const impl = searchImpl();
  if (impl) return impl.searchTracks(keyword, limit, type);
  return request.get<any, ISuccessResponse<Track[]>>("/track/search", {
    params: { keyword, type, limit },
  });
};

export const searchArtists = async (
  keyword: string,
  type?: string,
  limit: number = 10,
): Promise<ISuccessResponse<Artist[]>> => {
  const impl = searchImpl();
  if (impl) return impl.searchArtists(keyword, limit, type);
  return request.get<any, ISuccessResponse<Artist[]>>("/artist/search", {
    params: { keyword, type, limit },
  });
};

export const searchAlbums = async (
  keyword: string,
  type?: string,
  limit: number = 10,
): Promise<ISuccessResponse<Album[]>> => {
  const impl = searchImpl();
  if (impl) return impl.searchAlbums(keyword, limit, type);
  return request.get<any, ISuccessResponse<Album[]>>("/album/search", {
    params: { keyword, type, limit },
  });
};

/** 歌单搜索：官方服务端没有这个接口，未实现搜索能力的源返回空数组 */
export const searchPlaylists = async (
  keyword: string,
  limit: number = 10,
): Promise<ISuccessResponse<Playlist[]>> => {
  const impl = searchImpl();
  if (impl) return impl.searchPlaylists(keyword, limit);
  return { code: 200, message: "success", data: [] };
};

/**
 * 一次搜全（曲目 / 歌手 / 专辑 / 歌单）。
 *
 * 官方前端也是点一次搜索并发打多个接口（飞牛是 4 个），这里对齐这个口径。
 * 用 allSettled 而不是 all：某一栏失败（比如歌单接口报错）不应该让整屏搜索结果空掉。
 */
export const searchAll = async (keyword: string, type?: string): Promise<SearchResults> => {
  const text = String(keyword ?? "").trim();
  if (!text) return { tracks: [], artists: [], albums: [], playlists: [] };

  const [tracksRes, artistsRes, albumsRes, playlistsRes] = await Promise.all([
    settled(searchTracks(text, type, 5)),
    settled(searchArtists(text, type, 5)),
    settled(searchAlbums(text, type, 5)),
    settled(searchPlaylists(text, 5)),
  ]);

  return {
    tracks: tracksRes.code === 200 ? tracksRes.data : [],
    artists: artistsRes.code === 200 ? artistsRes.data : [],
    albums: albumsRes.code === 200 ? albumsRes.data : [],
    playlists: playlistsRes.code === 200 ? playlistsRes.data : [],
  };
};
