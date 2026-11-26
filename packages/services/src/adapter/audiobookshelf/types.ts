/**
 * Audiobookshelf REST API 的最小类型集（实测实例 v2.38.0）。
 *
 * 完整文档：https://api.audiobookshelf.org/ （官方注明文档已过时，字段按实际响应做了兼容）。
 */

export interface AbsLibrary {
  id: string;
  name: string;
  mediaType?: "book" | "podcast";
  displayOrder?: number;
}

export interface AbsLibrariesResponse {
  libraries?: AbsLibrary[];
}

export interface AbsAudioFile {
  index: number;
  /** 文件 inode，/api/items/{id}/file/{ino} 直链用（实测 v2.38.0 存在） */
  ino?: string | number;
  duration?: number;
  mimeType?: string;
  metadata?: { filename?: string; ext?: string };
}

export interface AbsAudioTrack {
  index: number;
  startOffset?: number;
  duration?: number;
  title?: string;
  contentUrl?: string;
  mimeType?: string;
}

export interface AbsMetadata {
  title?: string;
  titleIgnorePrefix?: string;
  subtitle?: string | null;
  authorName?: string;
  authorNameLF?: string;
  narratorName?: string;
  seriesName?: string;
  authors?: Array<{ id: string; name: string }>;
  narrators?: string[];
  genres?: string[];
  publishedYear?: string;
  description?: string;
  language?: string | null;
}

export interface AbsBook {
  metadata?: AbsMetadata;
  coverPath?: string;
  duration?: number;
  numTracks?: number;
  numAudioFiles?: number;
  numChapters?: number;
  audioFiles?: AbsAudioFile[];
  tracks?: AbsAudioTrack[];
  chapters?: Array<{ id: number; start: number; end: number; title: string }>;
}

export interface AbsPodcastEpisode {
  id: string;
  title?: string;
  description?: string;
  audioFile?: AbsAudioFile;
  publishedAt?: string;
}

export interface AbsPodcast {
  metadata?: AbsMetadata;
  coverPath?: string;
  episodes?: AbsPodcastEpisode[];
}

export interface AbsLibraryItem {
  id: string;
  libraryId?: string;
  folderId?: string;
  mediaType?: "book" | "podcast";
  addedAt?: number;
  updatedAt?: number;
  path?: string;
  media?: AbsBook & AbsPodcast;
  numFiles?: number;
  size?: number;
}

export interface AbsItemsResponse {
  results?: AbsLibraryItem[];
  total?: number;
  limit?: number;
  page?: number;
}

/**
 * 搜索响应在不同版本里形状不一致，这里统一收敛成数组：
 * - 实测 v2.38.0：`{ book: [{ libraryItem: LibraryItem }] }`
 * - 其它版本：`{ audiobooks: [{ audiobook: LibraryItem }], podcasts: [...] }`
 * - 旧版：`{ books: [LibraryItem] } / { results: [...] } / 直接数组`
 *
 * 条目外面可能套一层同名 wrapper，normalizeSearch 会统一拆掉。
 */
export type AbsSearchEntry =
  | AbsLibraryItem
  | {
      libraryItem?: AbsLibraryItem;
      audiobook?: AbsLibraryItem;
      podcast?: AbsLibraryItem;
      book?: AbsLibraryItem;
    };

export type AbsSearchResponse =
  | AbsSearchEntry[]
  | {
      book?: AbsSearchEntry[];
      audiobooks?: AbsSearchEntry[];
      podcasts?: AbsSearchEntry[];
      books?: AbsSearchEntry[];
      results?: AbsSearchEntry[];
    };

export interface AbsUser {
  id: string;
  username: string;
  type?: string;
  token?: string;
  isActive?: boolean;
  permissions?: { download?: boolean; update?: boolean; delete?: boolean };
}

/** Series Books：/api/libraries/:id/series 的 results 元素，books 可选 */
export interface AbsSeriesBooks {
  id: string;
  name?: string;
  nameIgnorePrefix?: string;
  type?: string;
  numBooks?: number;
  description?: string | null;
  books?: AbsLibraryItem[];
  addedAt?: number;
  updatedAt?: number;
}

export interface AbsSeriesResponse {
  results?: AbsSeriesBooks[];
  total?: number;
  limit?: number;
  page?: number;
}

export interface AbsLoginResponse {
  user?: AbsUser;
  userDefaultLibraryId?: string;
  serverSettings?: { version?: string };
}

export interface AbsMeResponse {
  user?: AbsUser;
  userDefaultLibraryId?: string;
}
