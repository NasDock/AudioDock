import type { Album, Artist, ISuccessResponse, Playlist, Track } from "../../models";
import type { ISearchAdapter } from "../interface";
import type { UgreenClient } from "./client";
import {
  mapUgreenAlbums,
  mapUgreenArtists,
  mapUgreenPlaylists,
  mapUgreenTracks,
} from "./mapper";
import { UGREEN_SORT } from "./query";
import type { UgreenSearchPage } from "./types";

/** 默认返回条数，对齐官方前端的量级 */
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 500;

/**
 * 绿联音乐搜索适配器。
 *
 * 官方搜索是单接口按类型取数：
 * `GET /music/search/by_type/ai?keyword=&search_type=1|2|3|4&page=&page_size=...`
 * search_type：1 曲目 / 2 专辑 / 3 歌手 / 4 歌单。
 *
 * 注意：曲目搜索匹配标题和专辑名，**不匹配歌手名**。
 * 绿联没有搜索历史接口，历史走 fnos 的端侧实现（search-record）。
 */
export class UgreenSearchAdapter implements ISearchAdapter {
  constructor(private client: UgreenClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  private normalizeLimit(limit?: number): number {
    const size = Math.floor(Number(limit) || DEFAULT_LIMIT);
    return Math.min(MAX_LIMIT, Math.max(1, size));
  }

  /** 关键词为空时直接返回空结果，避免空 keyword 拉回全库 */
  private async searchPage(
    keyword: string,
    searchType: 1 | 2 | 3 | 4,
    limit?: number,
  ): Promise<UgreenSearchPage | null> {
    const q = String(keyword ?? "").trim();
    if (!q) return null;
    // 注意：AI 搜索只认 sort_type=0（默认/相关度），传 1（按名称）会静默返回空
    return this.client.get<UgreenSearchPage>("/music/search/by_type/ai", {
      keyword: q,
      search_type: searchType,
      page: 1,
      page_size: this.normalizeLimit(limit),
      split_version_flag: true,
      has_invalid_song: true,
      sort_type: UGREEN_SORT.addTime,
    });
  }

  async searchTracks(
    keyword: string,
    limit?: number,
    _type?: string,
  ): Promise<ISuccessResponse<Track[]>> {
    const page = await this.searchPage(keyword, 1, limit);
    return this.response(mapUgreenTracks(page?.file_arr || [], this.client));
  }

  async searchAlbums(
    keyword: string,
    limit?: number,
    _type?: string,
  ): Promise<ISuccessResponse<Album[]>> {
    const page = await this.searchPage(keyword, 2, limit);
    return this.response(mapUgreenAlbums(page?.album_arr || [], this.client));
  }

  async searchArtists(
    keyword: string,
    limit?: number,
    _type?: string,
  ): Promise<ISuccessResponse<Artist[]>> {
    const page = await this.searchPage(keyword, 3, limit);
    return this.response(mapUgreenArtists(page?.singer_arr || []));
  }

  async searchPlaylists(keyword: string, limit?: number): Promise<ISuccessResponse<Playlist[]>> {
    const page = await this.searchPage(keyword, 4, limit);
    return this.response(mapUgreenPlaylists(page?.songlist_arr || [], this.client));
  }
}
