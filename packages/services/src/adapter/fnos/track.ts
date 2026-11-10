import type { ILoadMoreData, ISuccessResponse, Track } from "../../models";
import { ITrackAdapter } from "../interface";
import { FnosClient } from "./client";
import { extractLyricText, mapFnosTracks } from "./mapper";
import {
  albumTrackSortToFnos,
  FNOS_ALL,
  listSortToFnos,
  pageTotal,
  resolveArtistGuid,
  skipToPage,
} from "./query";
import type { FnosPage, FnosTrack } from "./types";

export class FnosTrackAdapter implements ITrackAdapter {
  constructor(private client: FnosClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  private async fetchTracks(params: Record<string, unknown>): Promise<{ tracks: Track[]; total: number }> {
    const page = await this.client.get<FnosPage<FnosTrack>>("/track/list", params);
    const tracks = await mapFnosTracks(page?.list || [], this.client);
    return { tracks, total: pageTotal(page) };
  }

  async getTrackList(): Promise<ISuccessResponse<Track[]>> {
    const { tracks } = await this.fetchTracks({ page: 1, size: 200, sort: "createdAt,desc" });
    return this.response(tracks);
  }

  /** 全量曲库；飞牛约定 size=-1 = 返回全部 */
  async getAllTracks(): Promise<ISuccessResponse<Track[]>> {
    const { tracks } = await this.fetchTracks({ page: 1, size: FNOS_ALL, sort: "createdAt,desc" });
    return this.response(tracks);
  }

  async getTrackTableList(params: { pageSize: number; current: number }) {
    const pageSize = Math.max(1, params.pageSize || 20);
    const { tracks, total } = await this.fetchTracks({
      page: Math.max(1, params.current || 1),
      size: pageSize,
      sort: "createdAt,desc",
    });
    return this.response({
      pageSize,
      current: params.current,
      list: tracks,
      total,
    });
  }

  async loadMoreTrack(params: {
    pageSize: number;
    loadCount: number;
    type?: string;
    sortBy?: string;
  }): Promise<ISuccessResponse<ILoadMoreData<Track>>> {
    const pageSize = Math.max(1, params.pageSize || 20);
    const skip = Math.max(0, params.loadCount || 0);
    const { tracks, total } = await this.fetchTracks({
      page: skipToPage(skip, pageSize),
      size: pageSize,
      sort: listSortToFnos(params.sortBy),
    });
    return this.response({
      pageSize,
      loadCount: skip + tracks.length,
      list: tracks,
      total,
      hasMore: skip + tracks.length < total,
    });
  }

  async createTrack(): Promise<ISuccessResponse<Track>> {
    throw new Error("飞牛音乐数据源不支持新建曲目");
  }

  async updateTrack(): Promise<ISuccessResponse<Track>> {
    throw new Error("飞牛音乐数据源不支持修改曲目元数据");
  }

  async deleteTrack(): Promise<ISuccessResponse<boolean>> {
    throw new Error("飞牛音乐数据源不支持删除曲目");
  }

  async getDeletionImpact() {
    return this.response({ isLastTrackInAlbum: false, albumName: null });
  }

  async batchCreateTracks(): Promise<ISuccessResponse<boolean>> {
    throw new Error("飞牛音乐数据源不支持批量新建曲目");
  }

  async batchDeleteTracks(): Promise<ISuccessResponse<boolean>> {
    throw new Error("飞牛音乐数据源不支持批量删除曲目");
  }

  async getLatestTracks(type?: string, random?: boolean, pageSize?: number) {
    const { tracks } = await this.fetchTracks({
      page: 1,
      size: Math.max(1, pageSize || 20),
      sort: "createdAt,desc",
    });
    return this.response(tracks);
  }

  async getRecommendedTracks(type?: string, pageSize?: number) {
    // 飞牛没有推荐接口，「最近添加」是最接近的口径
    return this.getLatestTracks(type, false, pageSize);
  }

  async getTracksByArtist(artist: string): Promise<ISuccessResponse<Track[]>>;
  async getTracksByArtist(
    artist: string,
    opts: { skip?: number; pageSize?: number },
  ): Promise<ISuccessResponse<ILoadMoreData<Track>>>;
  async getTracksByArtist(
    artist: string,
    opts?: { skip?: number; pageSize?: number },
  ): Promise<ISuccessResponse<Track[]> | ISuccessResponse<ILoadMoreData<Track>>> {
    const guid = await resolveArtistGuid(this.client, artist);
    if (!guid) {
      // 找不到歌手实体时退化为按名字搜曲目，避免整个页面空掉
      const page = await this.client
        .get<FnosPage<FnosTrack>>("/search/track", {
          q: artist,
          page: 1,
          size: opts?.pageSize || 100,
        })
        .catch(() => null);
      const tracks = await mapFnosTracks(page?.list || [], this.client);
      if (!opts) return this.response(tracks);
      const pageSize = Math.max(1, opts.pageSize || 100);
      return this.response({
        pageSize,
        loadCount: tracks.length,
        list: tracks,
        total: tracks.length,
        hasMore: false,
      });
    }

    const usePage = !!(opts && (opts.skip !== undefined || opts.pageSize !== undefined));
    const pageSize = Math.max(1, opts?.pageSize || 100);
    const skip = Math.max(0, opts?.skip || 0);
    const page = await this.client.get<FnosPage<FnosTrack>>("/track/artist-detail/list", {
      artistGUID: guid,
      page: usePage ? skipToPage(skip, pageSize) : 1,
      size: usePage ? pageSize : FNOS_ALL,
      sort: "trackNo,asc",
    });
    const tracks = await mapFnosTracks(page?.list || [], this.client);
    const total = pageTotal(page);
    if (!usePage) return this.response(tracks);
    return this.response({
      pageSize,
      loadCount: skip + tracks.length,
      list: tracks,
      total,
      hasMore: skip + tracks.length < total,
    });
  }

  /** 收藏 / 取消收藏：飞牛是 favorite-track，body 用 trackGUID */
  async toggleLike(id: number | string) {
    await this.client.post("/favorite-track/create", { trackGUID: String(id) });
    return this.response(null);
  }

  async toggleUnLike(id: number | string) {
    await this.client.post("/favorite-track/delete", { trackGUID: String(id) });
    return this.response(null);
  }

  async getFavoriteTracks(
    userId: number | string,
    loadCount: number,
    pageSize: number,
    type?: string,
  ): Promise<ISuccessResponse<ILoadMoreData<{ track: Track; createdAt: string | Date }>>> {
    const safeSize = Math.max(1, pageSize || 20);
    const skip = Math.max(0, loadCount || 0);
    const page = await this.client.get<FnosPage<FnosTrack>>("/favorite-track/list", {
      page: skipToPage(skip, safeSize),
      size: safeSize,
      sort: "favoriteAt,desc",
    });
    const tracks = await mapFnosTracks(page?.list || [], this.client);
    const total = pageTotal(page);
    return this.response({
      pageSize: safeSize,
      loadCount: skip + tracks.length,
      list: tracks.map((track) => ({ track, createdAt: track.createdAt })),
      total,
      hasMore: skip + tracks.length < total,
    });
  }

  async getLyrics(id: number | string) {
    const guid = String(id);
    // 实测只认 trackGUID；guid 是历史写法，仅在上面的请求真失败时才回退，
    // 避免「本来就没歌词」的曲目白跑两次请求
    let payload: unknown = null;
    try {
      payload = await this.client.get<unknown>("/lyric/list", { trackGUID: guid });
    } catch {
      payload = await this.client.get<unknown>("/lyric/list", { guid }).catch(() => null);
    }
    return this.response(extractLyricText(payload));
  }

  /**
   * 专辑内曲目（给 album 适配器复用的内部方法）。
   * keyword 属于端侧过滤：飞牛该接口没有搜索参数。
   */
  async getAlbumTracks(params: {
    albumGuid: string;
    pageSize: number;
    skip: number;
    sort?: "asc" | "desc";
    sortBy?: string;
    keyword?: string;
  }): Promise<{ list: Track[]; total: number }> {
    const pageSize = Math.max(1, params.pageSize || 50);
    const skip = Math.max(0, params.skip || 0);
    const sort = albumTrackSortToFnos(params.sortBy, params.sort || "asc");

    // 有关键词时必须先全量拿再过滤，否则只能过滤当前页
    const needLocalFilter = !!params.keyword;
    const page = await this.client.get<FnosPage<FnosTrack>>("/track/album-detail/list", {
      albumGUID: params.albumGuid,
      page: needLocalFilter ? 1 : skipToPage(skip, pageSize),
      size: needLocalFilter ? FNOS_ALL : pageSize,
      sort,
    });

    let raws = page?.list || [];
    let total = pageTotal(page);
    if (needLocalFilter) {
      const keyword = String(params.keyword).toLowerCase();
      raws = raws.filter((item) => item.title?.toLowerCase().includes(keyword));
      total = raws.length;
      raws = raws.slice(skip, skip + pageSize);
    }

    return { list: await mapFnosTracks(raws, this.client), total };
  }
}
