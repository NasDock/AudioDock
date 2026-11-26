import type { AudiobookCollection, AudiobookCollectionAlbum, ISuccessResponse } from "../../models";
import { TrackType } from "../../models";
import type { IAudioCollectionAdapter } from "../interface";
import type { AudiobookshelfClient } from "./client";
import type { AbsItemStore } from "./items";
import { mapAbsItemToAlbum, toDate } from "./mapper";
import type { AbsItemsResponse, AbsLibraryItem, AbsSeriesBooks, AbsSeriesResponse } from "./types";

const notSupported = <T>(data: T): ISuccessResponse<T> => ({
  // 系列由服务端元数据生成，只读；写操作用 500 让 UI 走「失败」分支提示
  code: 500,
  message: "Audiobookshelf 的系列是只读的",
  data,
});

const success = <T>(data: T): ISuccessResponse<T> => ({
  code: 200,
  message: "success",
  data,
});

/** RN（Hermes）没有 btoa/Buffer，手写一份 ASCII 安全的 base64 */
const b64 = (input: string): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = unescape(encodeURIComponent(input));
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes.charCodeAt(i);
    const b = i + 1 < bytes.length ? bytes.charCodeAt(i + 1) : NaN;
    const c = i + 2 < bytes.length ? bytes.charCodeAt(i + 2) : NaN;
    const e1 = a >> 2;
    const e2 = ((a & 3) << 4) | (Number.isNaN(b) ? 0 : (b >> 4));
    const e3 = Number.isNaN(b) ? 64 : ((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6);
    const e4 = Number.isNaN(c) ? 64 : c & 63;
    output += chars[e1] + chars[e2] + (e3 === 64 ? "=" : chars[e3]) + (e4 === 64 ? "=" : chars[e4]);
  }
  return output;
};

const toCollectionAlbum = (
  seriesId: string,
  book: AbsLibraryItem,
  order: number,
  client: AudiobookshelfClient,
): AudiobookCollectionAlbum => ({
  id: `${seriesId}:${book.id}`,
  collectionId: seriesId,
  albumId: book.id,
  order,
  createdAt: toDate(book?.addedAt),
  album: mapAbsItemToAlbum(book, client),
});

const mapSeriesToCollection = (
  series: AbsSeriesBooks,
  client: AudiobookshelfClient,
): AudiobookCollection => {
  const books = series?.books || [];
  const coverBook = books.find((book) => book?.media?.coverPath);
  return {
    id: series.id,
    name: series.name || series.nameIgnorePrefix || "未命名系列",
    cover: coverBook ? client.getCoverUrl(coverBook.id) : null,
    type: TrackType.AUDIOBOOK,
    userId: "",
    createdAt: toDate(series?.addedAt),
    updatedAt: toDate(series?.updatedAt),
    items: books.map((book, index) => toCollectionAlbum(series.id, book, index, client)),
    _count: { items: series.numBooks ?? books.length },
  };
};

/**
 * Audiobookshelf 没有可编辑的「合集」概念，对应的是「系列」（Series）——
 * 由书内元数据自动生成，只读。因此这里只实现列表与详情，写操作全部 notSupported。
 */
export class AudiobookshelfCollectionAdapter implements IAudioCollectionAdapter {
  constructor(private client: AudiobookshelfClient, private store: AbsItemStore) {}

  async createCollection(): Promise<ISuccessResponse<AudiobookCollection>> {
    return notSupported(null as unknown as AudiobookCollection);
  }

  /** 系列列表：/api/libraries/{id}/series（一次性全量，按名称排序） */
  async getCollections(): Promise<ISuccessResponse<AudiobookCollection[]>> {
    const libraryId = await this.store.defaultLibraryId();
    if (!libraryId) return success([]);
    const res = await this.client.get<AbsSeriesResponse>(
      `/api/libraries/${encodeURIComponent(libraryId)}/series`,
      { limit: 1000, page: 0 },
    );
    return success((res?.results || []).map((series) => mapSeriesToCollection(series, this.client)));
  }

  /**
   * 系列详情：/api/series/{id}。
   * 部分服务端详情不带 books，此时用 items?filter=series.<base64>&sort=sequence
   * 拉全量并按章节序号排序（文档与实测一致，filterBy 回显为 `series.<base64>`）。
   */
  async getCollectionById(id: number | string): Promise<ISuccessResponse<AudiobookCollection>> {
    const seriesId = String(id);
    const series = await this.client
      .get<AbsSeriesBooks>(`/api/series/${encodeURIComponent(seriesId)}`)
      .catch(() => null);
    if (!series?.id) return notSupported(null as unknown as AudiobookCollection);

    if (!series.books?.length) {
      const libraryId = series.books?.[0]?.libraryId || (await this.store.defaultLibraryId());
      if (libraryId) {
        const res = await this.client
          .get<AbsItemsResponse>(`/api/libraries/${encodeURIComponent(libraryId)}/items`, {
            filter: `series.${b64(seriesId)}`,
            limit: 0,
            sort: "sequence",
            minified: 1,
          })
          .catch(() => null);
        if (res?.results?.length) series.books = res.results;
      }
    }
    return success(mapSeriesToCollection(series, this.client));
  }

  async updateCollection(): Promise<ISuccessResponse<AudiobookCollection>> {
    return notSupported(null as unknown as AudiobookCollection);
  }
  async uploadCollectionCover(): Promise<ISuccessResponse<AudiobookCollection>> {
    return notSupported(null as unknown as AudiobookCollection);
  }
  async deleteCollection(): Promise<ISuccessResponse<boolean>> {
    return notSupported(false);
  }
  async addAlbumToCollection(): Promise<ISuccessResponse<AudiobookCollectionAlbum | boolean>> {
    return notSupported(false);
  }
  async removeAlbumFromCollection(): Promise<ISuccessResponse<boolean>> {
    return notSupported(false);
  }
  async reorderCollection(): Promise<ISuccessResponse<boolean>> {
    return notSupported(false);
  }
  async getCollectionMembership(): Promise<ISuccessResponse<number[]>> {
    return notSupported([]);
  }
}
