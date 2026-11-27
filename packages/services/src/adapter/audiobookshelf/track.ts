import type { ILoadMoreData, ISuccessResponse, Track } from "../../models";
import type { ITrackAdapter } from "../interface";
import type { AudiobookshelfClient } from "./client";
import type { AbsItemStore } from "./items";
import { mapAbsItemToTracks } from "./mapper";

const response = <T>(data: T): ISuccessResponse<T> => ({
  code: 200,
  message: "success",
  data,
});

/** 音频文件映射为 AUDIOBOOK 类型的 Track */
export class AudiobookshelfTrackAdapter implements ITrackAdapter {
  constructor(private client: AudiobookshelfClient, private store: AbsItemStore) {}

  /**
   * 按 [offset, offset+size) 窗口取音轨。
   *
   * minified 列表自带 numTracks，先用它做 offset 记账；只有窗口覆盖到的书
   * 才拉详情（含 audioFiles），避免把全库几百集的 audioFiles 一次性拉回来。
   * 某本书没有 numTracks 时又落在窗口外，就拉一次详情补真实条数。
   */
  private async tracksWindow(
    offset: number,
    size: number,
  ): Promise<{ list: Track[]; total: number }> {
    const items = await this.store.allItems();
    const list: Track[] = [];
    let acc = 0;
    let total = 0;

    for (const item of items) {
      const known =
        item?.media?.numTracks ??
        item?.media?.audioFiles?.length ??
        item?.media?.tracks?.length;
      const inWindow = acc < offset + size && (known == null || acc + known > offset);

      if (!inWindow && known != null) {
        acc += known;
        total += known;
        continue;
      }

      const detail = await this.store.itemDetail(item.id);
      const tracks = detail ? mapAbsItemToTracks(detail, this.client) : [];
      total += tracks.length;
      if (inWindow) {
        list.push(...tracks.slice(Math.max(0, offset - acc)));
      }
      acc += tracks.length;
    }
    return { list: list.slice(0, size), total };
  }

  private async allTracks(): Promise<Track[]> {
    const items = await this.store.allItemDetails();
    return items.flatMap((item) => mapAbsItemToTracks(item, this.client));
  }

  async getTrackList() {
    return response((await this.tracksWindow(0, 50)).list);
  }

  async getAllTracks() {
    return response(await this.allTracks());
  }

  async getTrackTableList(params: { pageSize: number; current: number }) {
    const offset = (params.current - 1) * params.pageSize;
    const { list, total } = await this.tracksWindow(offset, params.pageSize);
    return response({
      pageSize: params.pageSize,
      current: params.current,
      list,
      total,
    });
  }

  async loadMoreTrack(params: { pageSize: number; loadCount: number; type?: string; sortBy?: string }) {
    const { list, total } = await this.tracksWindow(params.loadCount, params.pageSize);
    const data: ILoadMoreData<Track> = {
      pageSize: params.pageSize,
      loadCount: params.loadCount + list.length,
      list,
      total,
      hasMore: params.loadCount + list.length < total,
    };
    return response(data);
  }

  async getLatestTracks(_type?: string, _random?: boolean, pageSize?: number) {
    const items = [...(await this.store.allItems())].sort(
      (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    );
    const size = pageSize || 20;
    const out: Track[] = [];
    // 最新的几本书凑满一页即停，详情有缓存，成本可控
    for (const item of items) {
      if (out.length >= size) break;
      const detail = await this.store.itemDetail(item.id);
      if (detail) out.push(...mapAbsItemToTracks(detail, this.client));
    }
    return response(out.slice(0, size));
  }

  async getRecommendedTracks(_type?: string, pageSize?: number) {
    return this.getLatestTracks(undefined, false, pageSize);
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
    const tracks = (await this.allTracks()).filter((track) => track.artist === artist);
    if (!opts || (opts.skip === undefined && opts.pageSize === undefined)) {
      return response(tracks);
    }
    const skip = Math.max(0, opts.skip ?? 0);
    const pageSize = Math.max(1, opts.pageSize ?? 100);
    const list = tracks.slice(skip, skip + pageSize);
    return response({
      pageSize,
      loadCount: skip,
      list,
      total: tracks.length,
      hasMore: skip + list.length < tracks.length,
    });
  }

  async getLyrics(): Promise<ISuccessResponse<string | null>> {
    return response(null);
  }

  async toggleLike(): Promise<ISuccessResponse<any>> {
    return response(null);
  }

  async toggleUnLike(): Promise<ISuccessResponse<any>> {
    return response(null);
  }

  async getFavoriteTracks(
    _userId: number | string,
    loadCount: number,
    pageSize: number,
  ): Promise<ISuccessResponse<ILoadMoreData<{ track: Track; createdAt: string | Date }>>> {
    return response({
      pageSize,
      loadCount,
      list: [],
      total: 0,
      hasMore: false,
    });
  }

  async createTrack(): Promise<ISuccessResponse<Track>> {
    throw new Error("Audiobookshelf 不支持创建音轨");
  }

  async updateTrack(): Promise<ISuccessResponse<Track>> {
    throw new Error("Audiobookshelf 不支持修改音轨");
  }

  async deleteTrack(): Promise<ISuccessResponse<boolean>> {
    throw new Error("Audiobookshelf 不支持删除音轨");
  }

  async getDeletionImpact() {
    return response({ isLastTrackInAlbum: false, albumName: null });
  }

  async batchCreateTracks(): Promise<ISuccessResponse<boolean>> {
    throw new Error("Audiobookshelf 不支持批量创建音轨");
  }

  async batchDeleteTracks(): Promise<ISuccessResponse<boolean>> {
    throw new Error("Audiobookshelf 不支持批量删除音轨");
  }
}
