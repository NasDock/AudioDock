import type { Album, Artist, ISuccessResponse, Playlist, Track } from "../../models";
import type { ISearchAdapter } from "../interface";
import type { FnosClient } from "./client";
import { mapFnosAlbums, mapFnosArtists, mapFnosPlaylists, mapFnosTracks } from "./mapper";
import { pageTotal } from "./query";
import type { FnosAlbum, FnosArtist, FnosPage, FnosPlaylist, FnosTrack } from "./types";

/** 默认返回条数，对齐官方前端 `/search/*?page=1&size=24` 的量级 */
const DEFAULT_LIMIT = 24;
/** 上限：飞牛超过 2000 会静默降级成 50，自己先夹住更可控 */
const MAX_LIMIT = 500;

/**
 * 飞牛音乐搜索适配器。
 *
 * 官方前端点一次搜索会**并发**打四个接口（实测 2026-11-10）：
 * ```
 * GET /search/track?q=花粥            → { list: TrackVO[], total }
 * GET /search/album?q=花粥&page=1&size=24
 * GET /search/artist?q=花粥&page=1&size=24
 * GET /search/playlist?q=花粥&page=1&size=24
 * ```
 * 全部走 `q` 作为关键词参数，条目里带 `score`（相关度），没有 `hasMore`。
 *
 * 另外还有一个 `/search/suggest?q=`，返回 `{ track:{total,items}, album?, artist? }`，
 * 目前 UI 没有联想面板，先不接。
 *
 * 注意：飞牛**没有**搜索历史接口（前端历史是本地存的），历史走 `search-record.ts`。
 */
export class FnosSearchAdapter implements ISearchAdapter {
  constructor(private client: FnosClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  private normalizeLimit(limit?: number): number {
    const size = Math.floor(Number(limit) || DEFAULT_LIMIT);
    return Math.min(MAX_LIMIT, Math.max(1, size));
  }

  /**
   * 统一的搜索分页请求。
   *
   * 关键词为空时直接返回空结果：飞牛对空 `q` 的处理是「返回全库」，
   * 搜索框清空的瞬间不应该把整个曲库拉回来。
   */
  private async searchPage<T>(
    path: string,
    keyword: string,
    limit?: number,
  ): Promise<{ list: T[]; total: number }> {
    const q = String(keyword ?? "").trim();
    if (!q) return { list: [], total: 0 };
    const page = await this.client.get<FnosPage<T>>(path, {
      q,
      page: 1,
      size: this.normalizeLimit(limit),
    });
    return { list: page?.list || [], total: pageTotal(page) };
  }

  async searchTracks(
    keyword: string,
    limit?: number,
    _type?: string,
  ): Promise<ISuccessResponse<Track[]>> {
    const { list } = await this.searchPage<FnosTrack>("/search/track", keyword, limit);
    return this.response(await mapFnosTracks(list, this.client));
  }

  async searchAlbums(
    keyword: string,
    limit?: number,
    _type?: string,
  ): Promise<ISuccessResponse<Album[]>> {
    const { list } = await this.searchPage<FnosAlbum>("/search/album", keyword, limit);
    return this.response(await mapFnosAlbums(list, this.client));
  }

  async searchArtists(
    keyword: string,
    limit?: number,
    _type?: string,
  ): Promise<ISuccessResponse<Artist[]>> {
    const { list } = await this.searchPage<FnosArtist>("/search/artist", keyword, limit);
    return this.response(await mapFnosArtists(list, this.client));
  }

  async searchPlaylists(keyword: string, limit?: number): Promise<ISuccessResponse<Playlist[]>> {
    const { list } = await this.searchPage<FnosPlaylist>("/search/playlist", keyword, limit);
    return this.response(await mapFnosPlaylists(list, this.client));
  }
}
