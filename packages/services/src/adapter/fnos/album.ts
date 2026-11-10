import type { Album, ISuccessResponse } from "../../models";
import { IAlbumAdapter } from "../interface";
import { FnosClient } from "./client";
import { mapFnosAlbums } from "./mapper";
import type { FnosTrackAdapter } from "./track";
import {
  listSortToFnos,
  pageTotal,
  resolveArtistGuid,
  skipToPage,
} from "./query";
import type { FnosAlbum } from "./types";

const NOT_SUPPORTED = "飞牛音乐数据源不支持该操作";

export class FnosAlbumAdapter implements IAlbumAdapter {
  constructor(
    private client: FnosClient,
    private trackAdapter: FnosTrackAdapter,
  ) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  private async fetchAlbums(params: Record<string, unknown>) {
    const page = await this.client.get<{ list: FnosAlbum[]; total: number }>("/album/list", params);
    const list = await mapFnosAlbums(page?.list || [], this.client);
    return { list, total: pageTotal(page) };
  }

  async getAlbumList() {
    const { list } = await this.fetchAlbums({ page: 1, size: 100, sort: "createdAt,desc" });
    return this.response(list);
  }

  async getAlbumTableList(params: { pageSize: number; current: number }) {
    const pageSize = Math.max(1, params.pageSize || 20);
    const { list, total } = await this.fetchAlbums({
      page: Math.max(1, params.current || 1),
      size: pageSize,
      sort: "createdAt,desc",
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
    const { list, total } = await this.fetchAlbums({
      page: skipToPage(skip, pageSize),
      size: pageSize,
      sort: listSortToFnos(params.sortBy),
    });
    return this.response({
      pageSize,
      loadCount: skip + list.length,
      list,
      total,
      hasMore: skip + list.length < total,
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

  async getRecommendedAlbums(type?: string, random?: boolean, pageSize?: number) {
    const { list } = await this.fetchAlbums({
      page: 1,
      size: Math.max(1, pageSize || 10),
      sort: "createdAt,desc",
    });
    return this.response(list);
  }

  async getRecentAlbums(type?: string, random?: boolean, pageSize?: number) {
    return this.getRecommendedAlbums(type, random, pageSize);
  }

  async getAlbumById(id: number | string) {
    const raw = await this.client.get<FnosAlbum>("/album/detail", { guid: String(id) });
    const [album] = await mapFnosAlbums(raw ? [raw] : [], this.client);
    return this.response(album);
  }

  async getAlbumTracks(
    id: number | string,
    pageSize: number,
    skip: number,
    sort: "asc" | "desc" = "asc",
    keyword?: string,
    userId?: number | string,
    sortBy?: string,
  ) {
    const { list, total } = await this.trackAdapter.getAlbumTracks({
      albumGuid: String(id),
      pageSize,
      skip,
      sort,
      sortBy,
      keyword,
    });
    return this.response({ list, total });
  }

  /**
   * 飞牛没有「按歌手取专辑」的一等接口，这里用搜索兜底：
   * 搜专辑名 → 过滤 artists 里包含该歌手的结果。
   */
  async getAlbumsByArtist(artist: string) {
    const keyword = String(artist || "").trim();
    if (!keyword) return this.response([]);
    const guid = await resolveArtistGuid(this.client, keyword);
    const page = await this.client
      .get<{ list: FnosAlbum[]; total: number }>("/search/album", {
        q: keyword,
        page: 1,
        size: 100,
      })
      .catch(() => null);
    let raws = page?.list || [];
    if (guid) {
      raws = raws.filter((item) => (item.artists || []).some((a) => a.guid === guid));
    } else {
      raws = raws.filter((item) => (item.artists || []).some((a) => a.name === keyword));
    }
    return this.response(await mapFnosAlbums(raws, this.client));
  }

  async getCollaborativeAlbumsByArtist(artist: string) {
    // 合作专辑在飞牛侧没有单独口径，直接复用按歌手搜索
    return this.getAlbumsByArtist(artist);
  }

  async uploadAlbumCover() {
    return {
      code: 501,
      message: "飞牛音乐数据源不支持上传专辑封面",
      data: null as unknown as Album,
    };
  }

  async toggleLike() {
    return {
      code: 501,
      message: "飞牛音乐数据源暂不支持专辑收藏",
      data: null,
    };
  }

  async toggleUnLike() {
    return {
      code: 501,
      message: "飞牛音乐数据源暂不支持专辑收藏",
      data: null,
    };
  }

  async getFavoriteAlbums(
    userId: number | string,
    loadCount: number,
    pageSize: number,
  ) {
    return this.response({
      pageSize,
      loadCount,
      list: [] as { album: Album; createdAt: string | Date }[],
      total: 0,
      hasMore: false,
    });
  }
}
