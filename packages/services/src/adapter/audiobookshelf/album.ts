import type { Album, ISuccessResponse, ITableData, ILoadMoreData } from "../../models";
import type { IAlbumAdapter } from "../interface";
import type { AudiobookshelfClient } from "./client";
import type { AbsItemStore } from "./items";
import { mapAbsAudioFileToTrack, mapAbsItemToAlbum, mapAbsItemToTracks, absAuthorName } from "./mapper";

const response = <T>(data: T): ISuccessResponse<T> => ({
  code: 200,
  message: "success",
  data,
});

/** 一本书映射成一张「专辑」，所有内容 type 都是 AUDIOBOOK */
export class AudiobookshelfAlbumAdapter implements IAlbumAdapter {
  constructor(private client: AudiobookshelfClient, private store: AbsItemStore) {}

  async getAlbumList() {
    const items = await this.store.allItems();
    return response(items.slice(0, 50).map((item) => mapAbsItemToAlbum(item, this.client)));
  }

  async getAlbumTableList(params: { pageSize: number; current: number }) {
    const items = await this.store.allItems();
    const offset = (params.current - 1) * params.pageSize;
    const table: ITableData<Album[]> = {
      pageSize: params.pageSize,
      current: params.current,
      list: items.slice(offset, offset + params.pageSize).map((item) => mapAbsItemToAlbum(item, this.client)),
      total: items.length,
    };
    return response(table);
  }

  async loadMoreAlbum(params: { pageSize: number; loadCount: number; type?: string; sortBy?: string }) {
    const items = await this.store.allItems();
    const list = items.slice(params.loadCount, params.loadCount + params.pageSize).map((item) =>
      mapAbsItemToAlbum(item, this.client),
    );
    const data: ILoadMoreData<Album> = {
      pageSize: params.pageSize,
      loadCount: params.loadCount + list.length,
      list,
      total: items.length,
      hasMore: params.loadCount + list.length < items.length,
    };
    return response(data);
  }

  async getRecommendedAlbums(_type?: string, random?: boolean, pageSize?: number) {
    const items = await this.store.allItems();
    const size = pageSize || 10;
    const picked = random
      ? [...items].sort(() => Math.random() - 0.5).slice(0, size)
      : items.slice(0, size);
    return response(picked.map((item) => mapAbsItemToAlbum(item, this.client)));
  }

  async getRecentAlbums(_type?: string, _random?: boolean, pageSize?: number) {
    const items = [...(await this.store.allItems())].sort(
      (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    );
    return response(items.slice(0, pageSize || 10).map((item) => mapAbsItemToAlbum(item, this.client)));
  }

  async getAlbumById(id: number | string) {
    const item = await this.store.itemById(String(id));
    if (!item) throw new Error(`未找到有声书 ${id}`);
    return response(mapAbsItemToAlbum(item, this.client));
  }

  async getAlbumTracks(
    id: number | string,
    pageSize: number,
    skip: number,
    _sort?: "asc" | "desc",
    keyword?: string,
  ) {
    const item = await this.store.itemById(String(id));
    if (!item) return response({ list: [], total: 0 });
    let tracks = mapAbsItemToTracks(item, this.client);
    if (keyword) {
      const q = keyword.toLowerCase();
      tracks = tracks.filter((track) => track.name.toLowerCase().includes(q));
    }
    return response({
      list: tracks.slice(skip, skip + pageSize),
      total: tracks.length,
    });
  }

  async getAlbumsByArtist(artist: string) {
    const items = (await this.store.allItems()).filter(
      (item) => absAuthorName(item) === artist,
    );
    return response(items.map((item) => mapAbsItemToAlbum(item, this.client)));
  }

  async getCollaborativeAlbumsByArtist(): Promise<ISuccessResponse<Album[]>> {
    return response([]);
  }

  async createAlbum(): Promise<ISuccessResponse<Album>> {
    throw new Error("Audiobookshelf 不支持创建书目");
  }

  async updateAlbum(): Promise<ISuccessResponse<Album>> {
    throw new Error("Audiobookshelf 不支持修改书目");
  }

  async deleteAlbum(): Promise<ISuccessResponse<boolean>> {
    throw new Error("Audiobookshelf 不支持删除书目");
  }

  async batchCreateAlbums(): Promise<ISuccessResponse<boolean>> {
    throw new Error("Audiobookshelf 不支持批量创建书目");
  }

  async batchDeleteAlbums(): Promise<ISuccessResponse<boolean>> {
    throw new Error("Audiobookshelf 不支持批量删除书目");
  }

  async uploadAlbumCover(): Promise<ISuccessResponse<Album>> {
    throw new Error("Audiobookshelf 不支持上传封面");
  }

  async toggleLike(): Promise<ISuccessResponse<any>> {
    // ABS 没有 star 概念，返回成功让 UI 不报错
    return response(null);
  }

  async toggleUnLike(): Promise<ISuccessResponse<any>> {
    return response(null);
  }

  async getFavoriteAlbums(
    _userId: number | string,
    loadCount: number,
    pageSize: number,
  ): Promise<ISuccessResponse<ILoadMoreData<{ album: Album; createdAt: string | Date }>>> {
    return response({
      pageSize,
      loadCount,
      list: [],
      total: 0,
      hasMore: false,
    });
  }
}
