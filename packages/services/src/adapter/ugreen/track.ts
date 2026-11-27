import type { ILoadMoreData, ISuccessResponse, Track } from "../../models";
import { ITrackAdapter } from "../interface";
import { UgreenClient } from "./client";
import { mapUgreenTracks } from "./mapper";
import {
  albumTrackSortToUgreen,
  listSortToUgreen,
  pageHasMore,
  pageTotal,
  skipToPage,
  UGREEN_ALL,
  UGREEN_SORT,
} from "./query";
import type {
  UgreenAlbumDetail,
  UgreenSongInfo,
  UgreenTrack,
  UgreenTrackPage,
} from "./types";

const NOT_SUPPORTED = "绿联音乐数据源不支持该操作";

export class UgreenTrackAdapter implements ITrackAdapter {
  constructor(private client: UgreenClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  private async fetchTracks(
    params: Record<string, unknown>,
  ): Promise<{ tracks: Track[]; total: number; hasMore: boolean }> {
    const page = await this.client.get<UgreenTrackPage>("/music/library/all", params);
    const raws = page?.file_arr || [];
    return {
      tracks: mapUgreenTracks(raws, this.client),
      total: pageTotal(page, raws.length),
      hasMore: pageHasMore(page, ((params.page as number) - 1) * (params.page_size as number) + raws.length),
    };
  }

  async getTrackList(): Promise<ISuccessResponse<Track[]>> {
    const { tracks } = await this.fetchTracks({
      page: 1,
      page_size: 200,
      sort_type: UGREEN_SORT.addTime,
      asc: 0,
    });
    return this.response(tracks);
  }

  /** 全量曲库；绿联没有 size=-1，用足够大的 page_size */
  async getAllTracks(): Promise<ISuccessResponse<Track[]>> {
    const { tracks } = await this.fetchTracks({
      page: 1,
      page_size: UGREEN_ALL,
      sort_type: UGREEN_SORT.addTime,
      asc: 0,
    });
    return this.response(tracks);
  }

  async getTrackTableList(params: { pageSize: number; current: number }) {
    const pageSize = Math.max(1, params.pageSize || 20);
    const { tracks, total } = await this.fetchTracks({
      page: Math.max(1, params.current || 1),
      page_size: pageSize,
      sort_type: UGREEN_SORT.addTime,
      asc: 0,
    });
    return this.response({ pageSize, current: params.current, list: tracks, total });
  }

  async loadMoreTrack(params: {
    pageSize: number;
    loadCount: number;
    type?: string;
    sortBy?: string;
  }): Promise<ISuccessResponse<ILoadMoreData<Track>>> {
    const pageSize = Math.max(1, params.pageSize || 20);
    const skip = Math.max(0, params.loadCount || 0);
    const { tracks, total, hasMore } = await this.fetchTracks({
      page: skipToPage(skip, pageSize),
      page_size: pageSize,
      sort_type: listSortToUgreen(params.sortBy),
      // 添加时间排序默认倒序（最新在前），名称排序正序
      asc: listSortToUgreen(params.sortBy) === UGREEN_SORT.name ? 1 : 0,
    });
    return this.response({
      pageSize,
      loadCount: skip + tracks.length,
      list: tracks,
      total,
      hasMore,
    });
  }

  async createTrack(): Promise<ISuccessResponse<Track>> {
    throw new Error(NOT_SUPPORTED);
  }

  async updateTrack(): Promise<ISuccessResponse<Track>> {
    throw new Error(NOT_SUPPORTED);
  }

  async deleteTrack(): Promise<ISuccessResponse<boolean>> {
    throw new Error(NOT_SUPPORTED);
  }

  async getDeletionImpact() {
    return this.response({ isLastTrackInAlbum: false, albumName: null });
  }

  async batchCreateTracks(): Promise<ISuccessResponse<boolean>> {
    throw new Error(NOT_SUPPORTED);
  }

  async batchDeleteTracks(): Promise<ISuccessResponse<boolean>> {
    throw new Error(NOT_SUPPORTED);
  }

  async getLatestTracks(_type?: string, _random?: boolean, pageSize?: number) {
    const { tracks } = await this.fetchTracks({
      page: 1,
      page_size: Math.max(1, pageSize || 20),
      sort_type: UGREEN_SORT.addTime,
      asc: 0,
    });
    return this.response(tracks);
  }

  /** 绿联没有推荐接口，「最近添加」是最接近的口径（同飞牛策略） */
  async getRecommendedTracks(type?: string, pageSize?: number) {
    return this.getLatestTracks(type, false, pageSize);
  }

  /**
   * 歌手内曲目：绿联的 song 搜索不匹配歌手名，singer 详情又是按专辑拆分的。
   * 策略：先 search_type=3 反查歌手实体 → 取该歌手的专辑列表 → 逐专辑聚合曲目；
   * 查不到歌手实体时退化为全库按歌手名过滤。
   */
  async getTracksByArtist(artist: string): Promise<ISuccessResponse<Track[]>>;
  async getTracksByArtist(
    artist: string,
    opts: { skip?: number; pageSize?: number },
  ): Promise<ISuccessResponse<ILoadMoreData<Track>>>;
  async getTracksByArtist(
    artist: string,
    opts?: { skip?: number; pageSize?: number },
  ): Promise<ISuccessResponse<Track[]> | ISuccessResponse<ILoadMoreData<Track>>> {
    const keyword = String(artist || "").trim();
    const usePage = !!(opts && (opts.skip !== undefined || opts.pageSize !== undefined));
    const pageSize = Math.max(1, opts?.pageSize || 100);
    const skip = Math.max(0, opts?.skip || 0);

    let allTracks: Track[] = [];
    const singerId = await this.resolveSingerId(keyword);
    if (singerId) {
      allTracks = await this.collectSingerTracks(singerId);
    } else {
      // 查不到实体：全库本地过滤（歌名搜索不匹配歌手名，只能从库里捞）
      console.warn("[Ugreen] 歌手实体未找到，全库过滤兜底:", keyword);
      const { tracks } = await this.fetchTracks({
        page: 1,
        page_size: UGREEN_ALL,
        sort_type: UGREEN_SORT.name,
        asc: 1,
      });
      allTracks = tracks.filter(
        (track) => track.artist === keyword || track.artist.split(" / ").includes(keyword),
      );
    }

    if (!usePage) return this.response(allTracks);
    const list = allTracks.slice(skip, skip + pageSize);
    return this.response({
      pageSize,
      loadCount: skip + list.length,
      list,
      total: allTracks.length,
      hasMore: skip + list.length < allTracks.length,
    });
  }

  /** 名字 → singer_id（search_type=3 是歌手搜索） */
  private async resolveSingerId(name: string): Promise<number | null> {
    if (!name) return null;
    try {
      const page = await this.client.get<{ singer_arr?: { singer_id: number; singer_name: string }[] }>(
        "/music/search/by_type/ai",
        {
          keyword: name,
          search_type: 3,
          page: 1,
          page_size: 10,
          split_version_flag: true,
          has_invalid_song: true,
          // AI 搜索只认 sort_type=0，传其他值会静默返回空
          sort_type: UGREEN_SORT.addTime,
        },
      );
      const list = page?.singer_arr || [];
      const exact = list.find((item) => item.singer_name === name);
      return (exact || list[0])?.singer_id ?? null;
    } catch (error) {
      console.warn("[Ugreen] 歌手名转 singer_id 失败", name, error);
      return null;
    }
  }

  /** 聚合歌手曲目：singer 详情拿专辑列表（page_size 上限 200，需翻页），再逐专辑拉曲目 */
  private async collectSingerTracks(singerId: number): Promise<Track[]> {
    try {
      const albumIds: number[] = [];
      // singer 接口 page_size 上限 200（300 起报 1005），专辑多的歌手要翻页
      for (let page = 1; page <= 50; page++) {
        const detail = await this.client.get<{
          album_arr?: { album_id: number }[];
          is_last_page?: boolean;
        }>("/music/singer", {
          singer_id: singerId,
          page,
          page_size: 200,
          split_version_flag: true,
          // 实测该接口传 sort_type=1（按名称）会静默返回空 album_arr，用 0
          sort_type: UGREEN_SORT.addTime,
          asc: 1,
          search_type: 1,
        });
        albumIds.push(...(detail?.album_arr || []).map((album) => album.album_id));
        if (!detail || detail.is_last_page !== false) break;
      }
      const raws: UgreenTrack[] = [];
      // 串行拉取，避免对 NAS 造成突发并发
      for (const albumId of albumIds) {
        const albumDetail = await this.client
          .get<UgreenAlbumDetail>("/music/album/v2", {
            album_id: albumId,
            page: 1,
            page_size: UGREEN_ALL,
            sort_type: UGREEN_SORT.name,
            asc: 1,
          })
          .catch(() => null);
        raws.push(...(albumDetail?.file_arr || []));
      }
      return mapUgreenTracks(raws, this.client);
    } catch (error) {
      console.warn("[Ugreen] 聚合歌手曲目失败", singerId, error);
      return [];
    }
  }

  /** 收藏 / 取消收藏 */
  async toggleLike(id: number | string) {
    await this.client.post("/music/collect/add", { audio_id_arr: [Number(id)] });
    return this.response(null);
  }

  async toggleUnLike(id: number | string) {
    await this.client.post("/music/collect/del", {
      del_type: 2,
      audio_collect_id_arr: [Number(id)],
    });
    return this.response(null);
  }

  /** 收藏列表：collect/v2 不接受 sort_type=0，用收藏时间(6)倒序 */
  async getFavoriteTracks(
    _userId: number | string,
    loadCount: number,
    pageSize: number,
    _type?: string,
  ): Promise<ISuccessResponse<ILoadMoreData<{ track: Track; createdAt: string | Date }>>> {
    const safeSize = Math.max(1, pageSize || 20);
    const skip = Math.max(0, loadCount || 0);
    const page = await this.client.get<UgreenTrackPage>("/music/collect/v2", {
      page: skipToPage(skip, safeSize),
      page_size: safeSize,
      sort_type: UGREEN_SORT.collectTime,
      asc: 0,
      has_invalid_song: true,
    });
    const raws = page?.file_arr || [];
    const tracks = mapUgreenTracks(raws, this.client);
    const total = pageTotal(page, raws.length);
    return this.response({
      pageSize: safeSize,
      loadCount: skip + tracks.length,
      list: tracks.map((track) => ({ track, createdAt: track.createdAt })),
      total,
      hasMore: pageHasMore(page, skip + tracks.length),
    });
  }

  /**
   * 歌词：列表接口不带，单曲 `song/info` 的 `music_file.lyric_url`
   * 指向 get_file 可读的 LRC 文件。切歌时懒加载（同飞牛）。
   */
  async getLyrics(id: number | string) {
    try {
      const info = await this.client.get<UgreenSongInfo>("/music/song/info", {
        audio_id: Number(id),
      });
      const lyricPath = info?.music_file?.lyric_url;
      if (!lyricPath) return this.response(null);
      const text = await this.client.fetchTextFile(lyricPath).catch(() => null);
      return this.response(text && text.trim() ? text : null);
    } catch (error) {
      console.warn("[Ugreen] 获取歌词失败", id, error);
      return this.response(null);
    }
  }

  /**
   * 专辑内曲目（给 album 适配器复用的内部方法）。
   * keyword 属于端侧过滤：绿联该接口没有搜索参数。
   */
  async getAlbumTracks(params: {
    albumId: string;
    pageSize: number;
    skip: number;
    sort?: "asc" | "desc";
    sortBy?: string;
    keyword?: string;
  }): Promise<{ list: Track[]; total: number }> {
    const pageSize = Math.max(1, params.pageSize || 50);
    const skip = Math.max(0, params.skip || 0);
    const sortType = albumTrackSortToUgreen(params.sortBy);
    const asc = params.sort === "desc" ? 0 : 1;

    const needLocalFilter = !!params.keyword;
    const detail = await this.client.get<UgreenAlbumDetail>("/music/album/v2", {
      album_id: Number(params.albumId),
      page: needLocalFilter ? 1 : skipToPage(skip, pageSize),
      page_size: needLocalFilter ? UGREEN_ALL : pageSize,
      sort_type: sortType,
      asc,
    });

    let raws = detail?.file_arr || [];
    let total = pageTotal(detail, raws.length);
    if (needLocalFilter) {
      const keyword = String(params.keyword).toLowerCase();
      raws = raws.filter((item) => item.song_title?.toLowerCase().includes(keyword));
      total = raws.length;
      raws = raws.slice(skip, skip + pageSize);
    }
    return { list: mapUgreenTracks(raws, this.client), total };
  }
}
