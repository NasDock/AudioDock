import type { Album, Artist, ISuccessResponse, Playlist, Track } from "../../models";
import { TrackType } from "../../models";
import type { ISearchAdapter } from "../interface";
import type { SubsonicClient } from "./client";
import { mapSubsonicAlbumToAlbum, mapSubsonicArtistToArtist, mapSubsonicSongToTrack } from "./mapper";
import type { SubsonicAlbum, SubsonicArtist, SubsonicChild, SubsonicPlaylistList, SubsonicSearchResult } from "./types";

/** Navidrome Web 的专辑列表每页 36 条；默认对齐一个稍大的量级，避免首屏只有 5 条 */
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 500;

type SearchBuckets = {
  artist?: SubsonicArtist[];
  album?: SubsonicAlbum[];
  song?: SubsonicChild[];
};

/**
 * Subsonic（Navidrome / Gonic 等）搜索适配器。
 *
 * 之前这个源没有实现 ISearchAdapter，services/search.ts 回退去打官方后端的
 * `/track/search`、`/album/search`、`/artist/search`；切换第三方源后 axios 的
 * baseURL 指向 Navidrome，这些路径并不存在，于是搜索框一直是空的。
 *
 * Subsonic 协议自带的搜索是 `search3`（老服务端为 `search2`）：
 * ```
 * GET /rest/search3.view?query=周杰伦&songCount=24&albumCount=24&artistCount=24&f=json&u=..&t=..&s=..
 * → { searchResult3: { song: [...], album: [...], artist: [...] } }
 * ```
 * 一次请求就覆盖四个 tab 中的三个；歌单没有搜索接口，只能拉列表后本地过滤。
 *
 * 搜索历史同理：Subsonic 没有 `/search-record/*`，见 subsonic/search-record.ts。
 */
export class SubsonicSearchAdapter implements ISearchAdapter {
  /** 同一轮搜索的 3 个并发调用共用一次 search3 请求 */
  private pending = new Map<string, Promise<SearchBuckets>>();

  constructor(private client: SubsonicClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  private normalizeLimit(limit?: number): number {
    const size = Math.floor(Number(limit) || DEFAULT_LIMIT);
    return Math.min(MAX_LIMIT, Math.max(1, size));
  }

  private async requestSearch(query: string, limit: number): Promise<SearchBuckets> {
    const params = {
      query,
      artistCount: limit,
      albumCount: limit,
      songCount: limit,
    };
    try {
      const res = await this.client.get<SubsonicSearchResult>("search3", params);
      if (res?.searchResult3) return res.searchResult3;
      if (res?.searchResult2) return res.searchResult2;
    } catch (error) {
      // 老服务端可能没有 search3，回落 search2
      console.warn("[Subsonic] search3 不可用，尝试 search2", error);
    }
    const fallback = await this.client.get<SubsonicSearchResult>("search2", params);
    return fallback?.searchResult2 || fallback?.searchResult3 || {};
  }

  /**
   * 带 in-flight 合并的搜索请求。key 带上关键词和条数，避免不同搜索互相串结果；
   * 请求结束后立即清掉，不缓存结果（服务端曲库可能随时变化）。
   */
  private searchBuckets(keyword: string, limit?: number): Promise<SearchBuckets> {
    const query = String(keyword ?? "").trim();
    const size = this.normalizeLimit(limit);
    if (!query) return Promise.resolve({});

    const key = `${size}|${query.toLowerCase()}`;
    const existing = this.pending.get(key);
    if (existing) return existing;

    const task = this.requestSearch(query, size);
    this.pending.set(key, task);
    const clear = () => {
      // 只清自己，避免误删同 key 的后发请求
      if (this.pending.get(key) === task) this.pending.delete(key);
    };
    task.then(clear, clear);
    return task;
  }

  async searchTracks(keyword: string, limit?: number, _type?: string): Promise<ISuccessResponse<Track[]>> {
    const buckets = await this.searchBuckets(keyword, limit);
    const list = (buckets.song || []).map((song) =>
      mapSubsonicSongToTrack(
        song,
        (id) => this.client.getCoverUrl(id),
        (id) => this.client.getStreamUrl(id),
      ),
    );
    return this.response(list);
  }

  async searchAlbums(keyword: string, limit?: number, _type?: string): Promise<ISuccessResponse<Album[]>> {
    const buckets = await this.searchBuckets(keyword, limit);
    const list = (buckets.album || []).map((album) =>
      mapSubsonicAlbumToAlbum(album, (id) => this.client.getCoverUrl(id)),
    );
    return this.response(list);
  }

  async searchArtists(keyword: string, limit?: number, _type?: string): Promise<ISuccessResponse<Artist[]>> {
    const buckets = await this.searchBuckets(keyword, limit);
    const list = (buckets.artist || []).map((artist) =>
      mapSubsonicArtistToArtist(artist, (id) => this.client.getCoverUrl(id)),
    );
    return this.response(list);
  }

  async searchPlaylists(keyword: string, limit?: number): Promise<ISuccessResponse<Playlist[]>> {
    const query = String(keyword ?? "").trim().toLowerCase();
    if (!query) return this.response<Playlist[]>([]);
    try {
      const res = await this.client.get<SubsonicPlaylistList>("getPlaylists");
      const list: Playlist[] = (res?.playlists?.playlist || [])
        .filter((item) => String(item?.name || "").toLowerCase().includes(query))
        .slice(0, this.normalizeLimit(limit))
        .map((item) => ({
          id: item.id,
          name: item.name,
          type: TrackType.MUSIC,
          createdAt: item.created || "",
          updatedAt: item.changed || item.created || "",
          userId: 0,
          _count: { tracks: item.songCount || 0 },
        }));
      return this.response(list);
    } catch (error) {
      // 部分服务端不允许普通账号列歌单；搜索页会把空数组当作「没有歌单结果」
      console.warn("[Subsonic] 歌单搜索失败", error);
      return this.response<Playlist[]>([]);
    }
  }
}
