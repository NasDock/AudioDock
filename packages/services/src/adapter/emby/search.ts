import type { Album, Artist, ISuccessResponse, Playlist, Track } from "../../models";
import { TrackType } from "../../models";
import type { ISearchAdapter } from "../interface";
import type { EmbyClient } from "./client";
import { mapEmbyItemToAlbum, mapEmbyItemToArtist, mapEmbyItemToTrack } from "./mapper";
import { sanitizeUserId } from "./media";
import type { EmbyItem, EmbyItemsResponse } from "./types";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
/** 一次请求拿混合结果（歌手/专辑/单曲/歌单），按 tab 分桶；多要点避免某类被挤没 */
const FETCH_LIMIT = 60;

const response = <T>(data: T): ISuccessResponse<T> => ({
  code: 200,
  message: "success",
  data,
});

/**
 * Emby 搜索适配器。
 *
 * 之前 Emby 源没有实现 ISearchAdapter，services/search.ts 回退去打官方服务端的
 * `/track/search`、`/album/search`、`/artist/search`；切到 Emby 后 baseURL 指向
 * Emby，这些路径并不存在 → 搜索框一直是空的。
 *
 * Emby Web 的搜索是 `GET /emby/Users/{userId}/Items?SearchTerm=许&Recursive=true...`，
 * 一次返回混合类型（MusicArtist / MusicAlbum / Audio / Playlist），这里对齐这个
 * 口径，按 Type 分桶到四个 tab。歌单与搜索复用同一条接口，不需要单独请求。
 */
export class EmbySearchAdapter implements ISearchAdapter {
  /** searchAll 的 4 个并发调用共用一次 Items 请求 */
  private pending = new Map<string, Promise<EmbyItem[]>>();

  constructor(private client: EmbyClient) {}

  /** userId 优先取运行时配置，兜底读本地持久化的登录用户（与 playlist 适配器一致） */
  private getUserId(): string {
    const config = this.client.getConfig() as any;
    const fromConfig = sanitizeUserId(config?.userId);
    if (fromConfig) return fromConfig;
    if (typeof localStorage === "undefined") return "";
    try {
      const baseUrl = String(config?.baseUrl || localStorage.getItem("serverAddress") || "").trim();
      if (!baseUrl) return "";
      const rawUser = localStorage.getItem(`user_${baseUrl}`);
      const parsed = rawUser ? JSON.parse(rawUser) : null;
      return sanitizeUserId(parsed?.id || parsed?.user?.id) || "";
    } catch {
      return "";
    }
  }

  private fetchItems(query: string): Promise<EmbyItem[]> {
    const key = query.toLowerCase();
    const existing = this.pending.get(key);
    if (existing) return existing;

    const task = (async () => {
      const userId = this.getUserId();
      if (!userId) return [];
      const res = await this.client.get<EmbyItemsResponse>(
        `Users/${encodeURIComponent(userId)}/Items`,
        {
          SearchTerm: query,
          Recursive: true,
          Fields: "PrimaryImageAspectRatio,PremiereDate,ProductionYear",
          EnableUserData: false,
          Limit: FETCH_LIMIT,
        },
      );
      return res?.Items || [];
    })();

    this.pending.set(key, task);
    const clear = () => {
      if (this.pending.get(key) === task) this.pending.delete(key);
    };
    task.then(clear, clear);
    return task;
  }

  private searchItems(keyword: string): Promise<EmbyItem[]> {
    const query = String(keyword ?? "").trim();
    return query ? this.fetchItems(query) : Promise.resolve([]);
  }

  private limitOf(limit?: number): number {
    const value = Math.floor(Number(limit) || DEFAULT_LIMIT);
    return Math.min(MAX_LIMIT, Math.max(1, value));
  }

  async searchTracks(keyword: string, limit?: number): Promise<ISuccessResponse<Track[]>> {
    const items = await this.searchItems(keyword);
    const tracks = items
      .filter((item) => item.Type === "Audio")
      .map((item) =>
        mapEmbyItemToTrack(
          item,
          this.client.getImageUrl.bind(this.client),
          this.client.getStreamUrl.bind(this.client),
        ),
      );
    return response(tracks.slice(0, this.limitOf(limit)));
  }

  async searchAlbums(keyword: string, limit?: number): Promise<ISuccessResponse<Album[]>> {
    const items = await this.searchItems(keyword);
    const albums = items
      .filter((item) =>
        ["MusicAlbum", "AudioBook", "Book"].includes(item.Type),
      )
      .map((item) => mapEmbyItemToAlbum(item, this.client.getImageUrl.bind(this.client)));
    return response(albums.slice(0, this.limitOf(limit)));
  }

  async searchArtists(keyword: string, limit?: number): Promise<ISuccessResponse<Artist[]>> {
    const items = await this.searchItems(keyword);
    const artists = items
      .filter((item) => item.Type === "MusicArtist")
      .map((item) => mapEmbyItemToArtist(item, this.client.getImageUrl.bind(this.client)));
    return response(artists.slice(0, this.limitOf(limit)));
  }

  async searchPlaylists(keyword: string, limit?: number): Promise<ISuccessResponse<Playlist[]>> {
    const items = await this.searchItems(keyword);
    const playlists = items
      .filter((item) => item.Type === "Playlist")
      .map(
        (item) =>
          ({
            id: item.Id,
            name: item.Name,
            type: TrackType.MUSIC,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            userId: this.getUserId(),
            _count: { tracks: (item as any).ChildCount || 0 },
          }) as Playlist,
      );
    return response(playlists.slice(0, this.limitOf(limit)));
  }
}
