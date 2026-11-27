import type { Album, Artist, ISuccessResponse, Playlist, Track } from "../../models";
import type { ISearchAdapter } from "../interface";
import type { AudiobookshelfClient } from "./client";
import type { AbsItemStore } from "./items";
import { absAuthorId, mapAbsItemToAlbum, mapAbsItemToArtist, mapAbsItemToTracks } from "./mapper";
import type { AbsLibraryItem, AbsSearchResponse } from "./types";

const response = <T>(data: T): ISuccessResponse<T> => ({
  code: 200,
  message: "success",
  data,
});

/** 拆掉 `{ libraryItem: ... }` / `{ audiobook: ... }` 这类外壳 */
const unwrapEntry = (entry: any): AbsLibraryItem | null => {
  if (!entry) return null;
  const item =
    entry.libraryItem || entry.audiobook || entry.podcast || entry.book || entry;
  return item?.id ? (item as AbsLibraryItem) : null;
};

/**
 * 不同版本的搜索响应形状统一成 LibraryItem[]。
 *
 * 实测 v2.38.0 返回 `{ book: [{ libraryItem: {...} }] }` —— 键名是单数
 * `book`，且条目套了一层 libraryItem；漏掉任一层都会让搜索结果全空。
 */
const normalizeSearch = (res: AbsSearchResponse): AbsLibraryItem[] => {
  if (Array.isArray(res)) return res.map(unwrapEntry).filter(Boolean) as AbsLibraryItem[];
  const items: AbsLibraryItem[] = [];
  const groups = [res?.book, res?.audiobooks, res?.podcasts, res?.books, res?.results];
  groups.forEach((group) => {
    (group || []).forEach((entry) => {
      const item = unwrapEntry(entry);
      if (item && !items.some((existing) => existing.id === item.id)) items.push(item);
    });
  });
  return items;
};

/**
 * Audiobookshelf 搜索走 `/api/libraries/{id}/search?q=`。
 * 搜到的是「书」，曲目/作者由书展开，因此三个 tab 共用同一次请求。
 */
export class AudiobookshelfSearchAdapter implements ISearchAdapter {
  /** searchAll 会并发问曲目/歌手/专辑，同关键词只发一次请求 */
  private pending = new Map<string, Promise<AbsLibraryItem[]>>();

  constructor(private client: AudiobookshelfClient, private store: AbsItemStore) {}

  private fetchItems(query: string, limit: number): Promise<AbsLibraryItem[]> {
    const key = `${limit}|${query.toLowerCase()}`;
    const existing = this.pending.get(key);
    if (existing) return existing;

    const task = (async () => {
      const libraryId = await this.store.defaultLibraryId();
      if (!libraryId) return [];
      const res = await this.client.get<AbsSearchResponse>(
        `/api/libraries/${encodeURIComponent(libraryId)}/search`,
        { q: query, limit },
      );
      return normalizeSearch(res).slice(0, limit);
    })();

    this.pending.set(key, task);
    const clear = () => {
      // 只清自己，避免误删同 key 的后发请求
      if (this.pending.get(key) === task) this.pending.delete(key);
    };
    task.then(clear, clear);
    return task;
  }

  private async searchItems(keyword: string, limit: number): Promise<AbsLibraryItem[]> {
    const query = String(keyword ?? "").trim();
    return query ? this.fetchItems(query, limit) : [];
  }

  private limitOf(limit?: number): number {
    const value = Math.floor(Number(limit) || 24);
    return Math.min(500, Math.max(1, value));
  }

  async searchTracks(keyword: string, limit?: number): Promise<ISuccessResponse<Track[]>> {
    const items = await this.searchItems(keyword, this.limitOf(limit));
    // 部分服务端的搜索响应只给书目摘要（无 audioFiles），补一次详情再展开音轨
    const fullItems = await Promise.all(
      items.map(async (item) => {
        if (item?.media?.audioFiles?.length || item?.media?.tracks?.length) return item;
        return (await this.store.itemDetail(item.id)) || item;
      }),
    );
    return response(
      fullItems
        .flatMap((item) => mapAbsItemToTracks(item, this.client))
        .slice(0, this.limitOf(limit)),
    );
  }

  async searchAlbums(keyword: string, limit?: number): Promise<ISuccessResponse<Album[]>> {
    const items = await this.searchItems(keyword, this.limitOf(limit));
    return response(items.map((item) => mapAbsItemToAlbum(item, this.client)));
  }

  /**
   * ABS 没有独立的「艺术家」索引，作者/朗读者挂在书上。
   * 服务端已按关键词筛出书，作者名不一定包含关键词（例如搜书名《三体》，
   * 作者是「三体宇宙」/「刘慈欣」），所以不能再按名字二次过滤，否则整栏为空。
   */
  async searchArtists(keyword: string, limit?: number): Promise<ISuccessResponse<Artist[]>> {
    if (!String(keyword ?? "").trim()) return response([]);
    const items = await this.searchItems(keyword, this.limitOf(limit));
    const size = this.limitOf(limit);
    const seen = new Set<string>();
    const artists: Artist[] = [];

    const push = (id: string, name: string, item: AbsLibraryItem) => {
      const key = id || name;
      if (!name || seen.has(key)) return;
      seen.add(key);
      artists.push({ ...mapAbsItemToArtist(item, this.client), id: key, name });
    };

    items.forEach((item) => {
      const meta = item?.media?.metadata;
      const authorName = meta?.authorName || meta?.authors?.[0]?.name;
      if (authorName) push(absAuthorId(item), authorName, item);
    });
    // 有声书场景下朗读者也是用户想找的「演播/艺术家」，作者不足时补上
    if (artists.length < size) {
      items.forEach((item) => {
        (item?.media?.metadata?.narrators || []).forEach((name) => {
          push(`narrator:${name}`, name, item);
        });
      });
    }
    return response(artists.slice(0, size));
  }

  async searchPlaylists(): Promise<ISuccessResponse<Playlist[]>> {
    // Audiobookshelf 的 collection 不是可播放歌单，先返回空
    return response([]);
  }
}
