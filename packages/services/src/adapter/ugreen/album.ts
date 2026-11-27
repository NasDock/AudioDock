import type { Album, ISuccessResponse } from "../../models";
import { IAlbumAdapter } from "../interface";
import { UgreenClient } from "./client";
import { mapUgreenAlbums } from "./mapper";
import {
  listSortToUgreen,
  pageHasMore,
  pageTotal,
  skipToPage,
  UGREEN_ALL,
  UGREEN_SORT,
} from "./query";
import type { UgreenTrackAdapter } from "./track";
import type { UgreenAlbumDetail, UgreenAlbumPage } from "./types";

const NOT_SUPPORTED = "绿联音乐数据源不支持该操作";

export class UgreenAlbumAdapter implements IAlbumAdapter {
  constructor(
    private client: UgreenClient,
    private trackAdapter: UgreenTrackAdapter,
  ) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  private async fetchAlbums(params: Record<string, unknown>) {
    const page = await this.client.get<UgreenAlbumPage>("/music/library/by_album", params);
    const raws = page?.album_arr || [];
    return {
      list: mapUgreenAlbums(raws, this.client),
      total: pageTotal(page, raws.length),
      hasMore: pageHasMore(
        page,
        (((params.page as number) || 1) - 1) * ((params.page_size as number) || raws.length || 1) +
          raws.length,
      ),
    };
  }

  async getAlbumList() {
    const { list } = await this.fetchAlbums({ page: 1, page_size: 100 });
    return this.response(list);
  }

  async getAlbumTableList(params: { pageSize: number; current: number }) {
    const pageSize = Math.max(1, params.pageSize || 20);
    const { list, total } = await this.fetchAlbums({
      page: Math.max(1, params.current || 1),
      page_size: pageSize,
    });
    return this.response({ pageSize, current: params.current, list, total });
  }

  async loadMoreAlbum(params: {
    pageSize: number;
    loadCount: number;
    type?: string;
    sortBy?: string;
  }) {
    const pageSize = Math.max(1, params.pageSize || 20);
    const skip = Math.max(0, params.loadCount || 0);
    const sortType = listSortToUgreen(params.sortBy);
    const { list, total, hasMore } = await this.fetchAlbums({
      page: skipToPage(skip, pageSize),
      page_size: pageSize,
      sort_type: sortType,
      asc: sortType === UGREEN_SORT.name ? 1 : 0,
    });
    return this.response({
      pageSize,
      loadCount: skip + list.length,
      list,
      total,
      hasMore,
    });
  }

  async createAlbum(): Promise<ISuccessResponse<Album>> {
    throw new Error(NOT_SUPPORTED);
  }

  async updateAlbum(): Promise<ISuccessResponse<Album>> {
    throw new Error(NOT_SUPPORTED);
  }

  async deleteAlbum(): Promise<ISuccessResponse<boolean>> {
    throw new Error(NOT_SUPPORTED);
  }

  async batchCreateAlbums(): Promise<ISuccessResponse<boolean>> {
    throw new Error(NOT_SUPPORTED);
  }

  async batchDeleteAlbums(): Promise<ISuccessResponse<boolean>> {
    throw new Error(NOT_SUPPORTED);
  }

  /** 绿联没有推荐接口，「最近添加」是最接近的口径（同飞牛策略） */
  async getRecommendedAlbums(_type?: string, _random?: boolean, pageSize?: number) {
    const { list } = await this.fetchAlbums({
      page: 1,
      page_size: Math.max(1, pageSize || 10),
      sort_type: UGREEN_SORT.addTime,
      asc: 0,
    });
    return this.response(list);
  }

  async getRecentAlbums(type?: string, random?: boolean, pageSize?: number) {
    return this.getRecommendedAlbums(type, random, pageSize);
  }

  async getAlbumById(id: number | string) {
    const detail = await this.client.get<UgreenAlbumDetail>("/music/album/v2", {
      album_id: Number(id),
      page: 1,
      page_size: 1,
      sort_type: UGREEN_SORT.name,
      asc: 1,
    });
    const [album] = detail?.album_info
      ? mapUgreenAlbums([detail.album_info], this.client)
      : [];
    return this.response(album);
  }

  async getAlbumTracks(
    id: number | string,
    pageSize: number,
    skip: number,
    sort: "asc" | "desc" = "asc",
    keyword?: string,
    _userId?: number | string,
    sortBy?: string,
  ) {
    const { list, total } = await this.trackAdapter.getAlbumTracks({
      albumId: String(id),
      pageSize,
      skip,
      sort,
      sortBy,
      keyword,
    });
    return this.response({ list, total });
  }

  /**
   * 按歌手取专辑：singer 详情（split_version_flag=true）直接返回 album_arr。
   * 名字 → singer_id 用 search_type=3 反查，查不到时退化为按名字搜专辑再过滤。
   */
  async getAlbumsByArtist(artist: string) {
    const keyword = String(artist || "").trim();
    if (!keyword) return this.response([]);

    let singerId: number | null = null;
    try {
      const searchPage = await this.client.get<{
        singer_arr?: { singer_id: number; singer_name: string }[];
      }>("/music/search/by_type/ai", {
        keyword,
        search_type: 3,
        page: 1,
        page_size: 10,
        split_version_flag: true,
        has_invalid_song: true,
        // AI 搜索只认 sort_type=0，传其他值会静默返回空
        sort_type: UGREEN_SORT.addTime,
      });
      const list = searchPage?.singer_arr || [];
      singerId = (list.find((item) => item.singer_name === keyword) || list[0])?.singer_id ?? null;
    } catch {
      singerId = null;
    }

    if (singerId) {
      // singer 详情返回该歌手的专辑列表；page_size 上限 200（300 起报 1005），翻页聚合
      const raws: Parameters<typeof mapUgreenAlbums>[0] = [];
      for (let page = 1; page <= 50; page++) {
        const detail = await this.client
          .get<{
            album_arr?: Parameters<typeof mapUgreenAlbums>[0];
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
          })
          .catch(() => null);
        raws.push(...(detail?.album_arr || []));
        if (!detail || detail.is_last_page !== false) break;
      }
      return this.response(mapUgreenAlbums(raws, this.client));
    }

    // 兜底：按名字搜专辑，过滤歌手名匹配
    const page = await this.client
      .get<UgreenAlbumPage>("/music/search/by_type/ai", {
        keyword,
        search_type: 2,
        page: 1,
        page_size: 100,
        split_version_flag: true,
        has_invalid_song: true,
        sort_type: UGREEN_SORT.addTime,
      })
      .catch(() => null);
    const raws = (page?.album_arr || []).filter(
      (item) =>
        item.singer_name === keyword ||
        (item.singer_arr || []).some((s) => s.singer_name === keyword),
    );
    return this.response(mapUgreenAlbums(raws, this.client));
  }

  async getCollaborativeAlbumsByArtist(artist: string) {
    // 合作专辑在绿联侧没有单独口径，直接复用按歌手取专辑
    return this.getAlbumsByArtist(artist);
  }

  async uploadAlbumCover() {
    return {
      code: 501,
      message: "绿联音乐数据源不支持上传专辑封面",
      data: null as unknown as Album,
    };
  }

  async toggleLike() {
    return {
      code: 501,
      message: "绿联音乐数据源暂不支持专辑收藏",
      data: null,
    };
  }

  async toggleUnLike() {
    return {
      code: 501,
      message: "绿联音乐数据源暂不支持专辑收藏",
      data: null,
    };
  }

  async getFavoriteAlbums(
    _userId: number | string,
    loadCount: number,
    pageSize: number,
  ) {
    // 绿联收藏只有曲目维度，没有专辑收藏
    return this.response({
      pageSize,
      loadCount,
      list: [] as { album: Album; createdAt: string | Date }[],
      total: 0,
      hasMore: false,
    });
  }
}
