import { getServiceConfig } from "../../config";
import type { ISuccessResponse } from "../../models";
import type { ISearchRecordAdapter } from "../interface";

/** 历史最多保留条数（超出丢最旧的） */
const MAX_HISTORY = 20;
/** 本地统计里出现次数达到这个值才算「热门」 */
const HOT_MIN_COUNT = 2;
/** 热词最多返回条数 */
const HOT_LIMIT = 10;

/**
 * 搜索历史的存储槽。
 *
 * 结构对齐 `localStorage` 的最小交集，desktop / web 直接用全局 `localStorage`，
 * RN / 鸿蒙等环境可以通过 `setSearchRecordStorage()` 注入自己的实现。
 */
export interface SearchRecordStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let injectedStorage: SearchRecordStorage | null = null;
const memoryStore = new Map<string, string>();

const memoryStorage: SearchRecordStorage = {
  getItem: (key) => memoryStore.get(key) ?? null,
  setItem: (key, value) => {
    memoryStore.set(key, value);
  },
};

/** 注入端侧存储实现；传 null 恢复到默认探测 */
export const setSearchRecordStorage = (storage: SearchRecordStorage | null) => {
  injectedStorage = storage;
};

const resolveStorage = (): SearchRecordStorage => {
  if (injectedStorage) return injectedStorage;
  try {
    // 浏览器 / WebView / Tauri webview 都有；RN 里是 undefined，走内存兜底
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Safari 隐私模式下访问 localStorage 会直接抛
  }
  return memoryStorage;
};

/** 存储槽按数据源隔离：换服务器不会串历史 */
const bucketKey = (): string => {
  const base = String(getServiceConfig().baseUrl || "")
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "");
  return `soundx_search_history::${base || "default"}`;
};

interface SearchHistoryEntry {
  keyword: string;
  /** 本地累计搜索次数，用于算热词 */
  count: number;
  /** 最近一次搜索的时间戳（毫秒），用于排序 */
  lastUsedAt: number;
}

const isEntry = (value: unknown): value is SearchHistoryEntry =>
  !!value &&
  typeof value === "object" &&
  typeof (value as SearchHistoryEntry).keyword === "string" &&
  !!(value as SearchHistoryEntry).keyword;

/**
 * 读取历史。兼容早期直接存 `string[]` 的格式（当作 count=1 的条目）。
 */
const readEntries = (): SearchHistoryEntry[] => {
  try {
    const raw = resolveStorage().getItem(bucketKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, index) => {
        if (typeof item === "string") {
          return { keyword: item, count: 1, lastUsedAt: Date.now() - index };
        }
        if (isEntry(item)) {
          return {
            keyword: item.keyword,
            count: Number(item.count) > 0 ? Number(item.count) : 1,
            lastUsedAt: Number(item.lastUsedAt) || 0,
          };
        }
        return null;
      })
      .filter((item): item is SearchHistoryEntry => !!item);
  } catch {
    // 存储被写坏时不要让搜索整个挂掉
    return [];
  }
};

const writeEntries = (entries: SearchHistoryEntry[]): void => {
  try {
    resolveStorage().setItem(bucketKey(), JSON.stringify(entries));
  } catch (error) {
    // 配额满 / 隐私模式：历史丢一次不影响搜索结果本身
    console.warn("[Fnos] 搜索历史写入失败", error);
  }
};

/**
 * 飞牛音乐的搜索历史。
 *
 * 飞牛**没有**搜索历史接口（官方前端的搜索历史存在浏览器本地），
 * 所以这里用端侧存储实现，接口签名与官方服务端的 `/search-record/*` 一致，
 * UI 不需要区分数据源。热门搜索同理：用本地累计次数统计，没有服务端热榜。
 */
export class FnosSearchRecordAdapter implements ISearchRecordAdapter {
  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  async addSearchRecord(keyword: string): Promise<ISuccessResponse<any>> {
    const text = String(keyword ?? "").trim();
    if (!text) return this.response(null);

    const entries = readEntries();
    const existing = entries.find((item) => item.keyword === text);
    if (existing) {
      existing.count += 1;
      existing.lastUsedAt = Date.now();
    } else {
      entries.push({ keyword: text, count: 1, lastUsedAt: Date.now() });
    }

    // 按最近使用排序后截断，顺便保证「刚搜的排最前」
    entries.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    writeEntries(entries.slice(0, MAX_HISTORY));
    return this.response(null);
  }

  async getSearchHistory(): Promise<ISuccessResponse<string[]>> {
    const entries = readEntries().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    return this.response(entries.map((item) => item.keyword));
  }

  /**
   * 热门搜索：本地累计次数倒序。
   *
   * 只出现一次的词不算「热门」（否则第一次搜索就会冒出一个热榜），
   * 所以新用户看到的是空热榜，而不是一条莫名其妙的关键词。
   */
  async getHotSearches(): Promise<ISuccessResponse<{ keyword: string; count: number }[]>> {
    const hot = readEntries()
      .filter((item) => item.count >= HOT_MIN_COUNT)
      .sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt)
      .slice(0, HOT_LIMIT)
      .map((item) => ({ keyword: item.keyword, count: item.count }));
    return this.response(hot);
  }

  async clearSearchHistory(): Promise<ISuccessResponse<any>> {
    writeEntries([]);
    return this.response(null);
  }
}
