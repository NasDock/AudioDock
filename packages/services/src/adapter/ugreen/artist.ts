import type { Artist, ISuccessResponse } from "../../models";
import { IArtistAdapter } from "../interface";
import { UgreenClient } from "./client";
import { mapUgreenArtists } from "./mapper";
import {
  listSortToUgreen,
  pageHasMore,
  pageTotal,
  skipToPage,
  UGREEN_ALL,
  UGREEN_SORT,
} from "./query";
import type { UgreenArtistDetail, UgreenArtistPage } from "./types";

const NOT_SUPPORTED = "绿联音乐数据源不支持该操作";

export class UgreenArtistAdapter implements IArtistAdapter {
  constructor(private client: UgreenClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  private async fetchArtists(params: Record<string, unknown>) {
    const page = await this.client.get<UgreenArtistPage>("/music/library/by_singer", params);
    const raws = page?.singer_arr || [];
    return {
      list: mapUgreenArtists(raws),
      total: pageTotal(page, raws.length),
      hasMore: pageHasMore(
        page,
        (((params.page as number) || 1) - 1) * ((params.page_size as number) || raws.length || 1) +
          raws.length,
      ),
    };
  }

  async getArtistList(pageSize: number, loadCount: number, _type?: string, sortBy?: string) {
    const safeSize = Math.max(1, pageSize || 20);
    const skip = Math.max(0, loadCount || 0);
    const { list, total, hasMore } = await this.fetchArtists({
      page: skipToPage(skip, safeSize),
      page_size: safeSize,
      sort_type: listSortToUgreen(sortBy, UGREEN_SORT.name),
      asc: 1,
    });
    return this.response({
      pageSize: safeSize,
      loadCount: skip + list.length,
      list,
      total,
      hasMore,
    });
  }

  async getArtistTableList(params: { pageSize: number; current: number }) {
    const pageSize = Math.max(1, params.pageSize || 20);
    const { list, total } = await this.fetchArtists({
      page: Math.max(1, params.current || 1),
      page_size: pageSize,
      sort_type: UGREEN_SORT.name,
      asc: 1,
    });
    return this.response({ pageSize, current: params.current, list, total });
  }

  async loadMoreArtist(params: { pageSize: number; loadCount: number }) {
    return this.getArtistList(params.pageSize, params.loadCount);
  }

  async createArtist(): Promise<ISuccessResponse<Artist>> {
    throw new Error(NOT_SUPPORTED);
  }

  async updateArtist(): Promise<ISuccessResponse<Artist>> {
    throw new Error(NOT_SUPPORTED);
  }

  async deleteArtist(): Promise<ISuccessResponse<boolean>> {
    throw new Error(NOT_SUPPORTED);
  }

  async batchCreateArtists(): Promise<ISuccessResponse<boolean>> {
    throw new Error(NOT_SUPPORTED);
  }

  async batchDeleteArtists(): Promise<ISuccessResponse<boolean>> {
    throw new Error(NOT_SUPPORTED);
  }

  async getArtistById(id: number | string) {
    const detail = await this.client.get<UgreenArtistDetail>("/music/singer", {
      singer_id: Number(id),
      page: 1,
      page_size: 1,
      split_version_flag: true,
      sort_type: UGREEN_SORT.name,
      asc: 1,
      search_type: 1,
    });
    const [artist] = detail?.singer_info ? mapUgreenArtists([detail.singer_info]) : [];
    return this.response(artist);
  }

  async getLatestArtists(_type: string, _random?: boolean, pageSize?: number) {
    // 歌手列表一次拉全：数量级通常不大，端侧还要做字母索引
    const { list } = await this.fetchArtists({
      page: 1,
      page_size: pageSize && pageSize > 0 ? pageSize : UGREEN_ALL,
      sort_type: UGREEN_SORT.name,
      asc: 1,
    });
    return this.response(list);
  }

  async uploadArtistAvatar() {
    return {
      code: 501,
      message: "绿联音乐数据源不支持上传歌手头像",
      data: null as unknown as Artist,
    };
  }
}
