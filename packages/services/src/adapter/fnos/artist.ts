import type { Artist, ISuccessResponse } from "../../models";
import { IArtistAdapter } from "../interface";
import { FnosClient } from "./client";
import { mapFnosArtists } from "./mapper";
import { FNOS_ALL, listSortToFnos, pageTotal, skipToPage } from "./query";
import type { FnosArtist } from "./types";

const NOT_SUPPORTED = "飞牛音乐数据源不支持该操作";

export class FnosArtistAdapter implements IArtistAdapter {
  constructor(private client: FnosClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  private async fetchArtists(params: Record<string, unknown>) {
    const page = await this.client.get<{ list: FnosArtist[]; total: number }>("/artist/list", params);
    const list = await mapFnosArtists(page?.list || [], this.client);
    return { list, total: pageTotal(page) };
  }

  async getArtistList(pageSize: number, loadCount: number, type?: string, sortBy?: string) {
    const safeSize = Math.max(1, pageSize || 20);
    const skip = Math.max(0, loadCount || 0);
    const { list, total } = await this.fetchArtists({
      page: skipToPage(skip, safeSize),
      size: safeSize,
      sort: listSortToFnos(sortBy, "name,asc"),
    });
    return this.response({
      pageSize: safeSize,
      loadCount: skip + list.length,
      list,
      total,
      hasMore: skip + list.length < total,
    });
  }

  async getArtistTableList(params: { pageSize: number; current: number }) {
    const pageSize = Math.max(1, params.pageSize || 20);
    const { list, total } = await this.fetchArtists({
      page: Math.max(1, params.current || 1),
      size: pageSize,
      sort: "name,asc",
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
    const raw = await this.client.get<FnosArtist>("/artist/detail", { guid: String(id) });
    const [artist] = await mapFnosArtists(raw ? [raw] : [], this.client);
    return this.response(artist);
  }

  async getLatestArtists(type: string, random?: boolean, pageSize?: number) {
    // 歌手列表用 size=-1 一次拉全：飞牛歌手数量级通常不大，端侧还要做字母索引
    const { list } = await this.fetchArtists({
      page: 1,
      size: pageSize && pageSize > 0 ? pageSize : FNOS_ALL,
      sort: "name,asc",
    });
    return this.response(list);
  }

  async uploadArtistAvatar() {
    return {
      code: 501,
      message: "飞牛音乐数据源不支持上传歌手头像",
      data: null as unknown as Artist,
    };
  }
}
