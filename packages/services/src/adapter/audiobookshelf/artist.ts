import type { Artist, ILoadMoreData, ISuccessResponse, ITableData } from "../../models";
import type { IArtistAdapter } from "../interface";
import type { AudiobookshelfClient } from "./client";
import type { AbsItemStore } from "./items";
import { absAuthorId, absAuthorName, mapAbsItemToArtist } from "./mapper";

const response = <T>(data: T): ISuccessResponse<T> => ({
  code: 200,
  message: "success",
  data,
});

/** ABS 的作者映射为 Artist（同样标成 AUDIOBOOK） */
export class AudiobookshelfArtistAdapter implements IArtistAdapter {
  constructor(private client: AudiobookshelfClient, private store: AbsItemStore) {}

  private async allArtists(): Promise<Artist[]> {
    const items = await this.store.allItems();
    const seen = new Set<string>();
    const artists: Artist[] = [];
    items.forEach((item) => {
      const id = absAuthorId(item);
      if (seen.has(id)) return;
      seen.add(id);
      artists.push(mapAbsItemToArtist(item, this.client));
    });
    return artists;
  }

  async getArtistList(pageSize: number, loadCount: number) {
    const artists = await this.allArtists();
    const list = artists.slice(loadCount, loadCount + pageSize);
    const data: ILoadMoreData<Artist> = {
      pageSize,
      loadCount: loadCount + list.length,
      list,
      total: artists.length,
      hasMore: loadCount + list.length < artists.length,
    };
    return response(data);
  }

  async getArtistTableList(params: { pageSize: number; current: number }) {
    const artists = await this.allArtists();
    const offset = (params.current - 1) * params.pageSize;
    const table: ITableData<Artist[]> = {
      pageSize: params.pageSize,
      current: params.current,
      list: artists.slice(offset, offset + params.pageSize),
      total: artists.length,
    };
    return response(table);
  }

  async loadMoreArtist(params: { pageSize: number; loadCount: number }) {
    return this.getArtistList(params.pageSize, params.loadCount);
  }

  async getArtistById(id: number | string) {
    const artist = (await this.allArtists()).find((item) => item.id === String(id));
    if (!artist) throw new Error(`未找到作者 ${id}`);
    return response(artist);
  }

  async getLatestArtists(_type: string, _random?: boolean, pageSize?: number) {
    return response((await this.allArtists()).slice(0, pageSize || 10));
  }

  async createArtist(): Promise<ISuccessResponse<Artist>> {
    throw new Error("Audiobookshelf 不支持创建作者");
  }

  async updateArtist(): Promise<ISuccessResponse<Artist>> {
    throw new Error("Audiobookshelf 不支持修改作者");
  }

  async deleteArtist(): Promise<ISuccessResponse<boolean>> {
    throw new Error("Audiobookshelf 不支持删除作者");
  }

  async batchCreateArtists(): Promise<ISuccessResponse<boolean>> {
    throw new Error("Audiobookshelf 不支持批量创建作者");
  }

  async batchDeleteArtists(): Promise<ISuccessResponse<boolean>> {
    throw new Error("Audiobookshelf 不支持批量删除作者");
  }

  async uploadArtistAvatar(): Promise<ISuccessResponse<Artist>> {
    throw new Error("Audiobookshelf 不支持上传作者头像");
  }
}
