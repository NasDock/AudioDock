import type { AudiobookshelfClient } from "./client";
import type { AbsItemsResponse, AbsLibrary, AbsLibraryItem } from "./types";

/**
 * 书目缓存。
 *
 * Audiobookshelf 的 expanded 条目会把每本书的全部 audioFiles 都带回来
 * （一本书 300+ 集时，一次全库列表就是几十 MB，走隧道/弱网必超时）。
 * 所以列表一律用 `minified=1`（只带 metadata/coverPath/numTracks，够专辑、
 * 艺术家、系列列表用）；需要音轨详情时按 id 走 `/api/items/{id}` 并缓存。
 */
export class AbsItemStore {
  private cache: AbsLibraryItem[] | null = null;
  private cachedAt = 0;
  private libs: AbsLibrary[] | null = null;
  /** 完整条目（含 audioFiles）的缓存，按 id 存，与列表共用同一个 TTL */
  private details = new Map<string, { item: AbsLibraryItem; at: number }>();
  private ttl = 5 * 60 * 1000;

  constructor(private client: AudiobookshelfClient) {}

  async libraries(): Promise<AbsLibrary[]> {
    if (this.libs?.length) return this.libs;
    const res = await this.client.get<{ libraries?: AbsLibrary[] }>("/api/libraries");
    this.libs = res?.libraries || [];
    return this.libs;
  }

  /** 优先有声书库，其次第一个库 */
  async defaultLibraryId(): Promise<string | undefined> {
    const libs = await this.libraries();
    return libs.find((lib) => lib.mediaType === "book")?.id || libs[0]?.id;
  }

  /** minified 全库列表：轻量，不含 audioFiles */
  async allItems(): Promise<AbsLibraryItem[]> {
    if (this.cache && Date.now() - this.cachedAt < this.ttl) return this.cache;
    const libs = await this.libraries();
    const groups = await Promise.all(
      libs.map((lib) =>
        this.client
          .get<AbsItemsResponse>(`/api/libraries/${encodeURIComponent(lib.id)}/items`, {
            limit: 1000,
            page: 0,
            sort: "media.metadata.title",
            minified: 1,
          })
          .catch(() => ({ results: [] })),
      ),
    );
    this.cache = groups.flatMap((group) => group?.results || []);
    this.cachedAt = Date.now();
    return this.cache;
  }

  /** 完整条目（含 audioFiles），按需拉取并缓存；失败返回 null */
  async itemDetail(id: string): Promise<AbsLibraryItem | null> {
    const cached = this.details.get(id);
    if (cached && Date.now() - cached.at < this.ttl) return cached.item;
    const item = await this.client
      .get<AbsLibraryItem>(`/api/items/${encodeURIComponent(id)}`)
      .catch(() => null);
    if (item?.id) this.details.set(id, { item, at: Date.now() });
    return item;
  }

  /** 全量详情：并发分批拉，单本失败跳过（单曲全量/按作者过滤用） */
  async allItemDetails(concurrency = 8): Promise<AbsLibraryItem[]> {
    const items = await this.allItems();
    const out: AbsLibraryItem[] = [];
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = await Promise.all(
        items.slice(i, i + concurrency).map((item) => this.itemDetail(item.id)),
      );
      batch.forEach((item) => item && out.push(item));
    }
    return out;
  }

  /** 详情优先（含 audioFiles），拿不到退回 minified 版本 */
  async itemById(id: string): Promise<AbsLibraryItem | null> {
    return (
      (await this.itemDetail(id)) ||
      (await this.allItems()).find((item) => item.id === id) ||
      null
    );
  }

  clear(): void {
    this.cache = null;
    this.libs = null;
    this.cachedAt = 0;
    this.details.clear();
  }
}
