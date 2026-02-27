import { TrackType } from "../../models";
import { EmbyClient } from "./client";
import { EmbyItem } from "./types";

type MediaMode = "MUSIC" | "AUDIOBOOK";

interface EmbyVirtualFolderItem {
  Id?: string;
  ItemId?: string;
  CollectionType?: string;
  LibraryOptions?: {
    ContentType?: string;
  };
}

interface EmbyVirtualFoldersResponse {
  Items: EmbyVirtualFolderItem[];
}

const modeParentIdCache = new Map<string, string | undefined>();
const loadedScopeCache = new Set<string>();

const AUDIOBOOK_COLLECTION_TYPES = new Set(["audiobooks", "audiobook", "books", "book"]);
const MUSIC_COLLECTION_TYPES = new Set(["music"]);

export const normalizeMediaMode = (type?: string): MediaMode => {
  return String(type || "").toUpperCase() === TrackType.AUDIOBOOK
    ? TrackType.AUDIOBOOK
    : TrackType.MUSIC;
};

export const mediaModeToTrackType = (type?: string): TrackType => {
  return normalizeMediaMode(type) === TrackType.AUDIOBOOK
    ? TrackType.AUDIOBOOK
    : TrackType.MUSIC;
};

export const sanitizeUserId = (userId?: number | string): string | undefined => {
  if (userId === undefined || userId === null) return undefined;
  const value = String(userId).trim();
  if (!value || value === "undefined" || value === "null" || value === "0") {
    return undefined;
  }
  return value;
};

export const albumItemTypesForMode = (type?: string): string => {
  return normalizeMediaMode(type) === TrackType.AUDIOBOOK ? "AudioBook" : "MusicAlbum";
};

export const inferTrackTypeFromItem = (item: EmbyItem, fallback: TrackType = TrackType.MUSIC): TrackType => {
  const itemType = String(item.Type || "").toLowerCase();
  const collectionType = String(item.CollectionType || "").toLowerCase();
  if (itemType === "audiobook" || itemType === "book" || collectionType === "audiobooks" || collectionType === "books") {
    return TrackType.AUDIOBOOK;
  }
  return fallback;
};

const getScopeKey = (client: EmbyClient): string => {
  const config = client.getConfig() as any;
  const baseUrl = String(client.getBaseUrl() || "");
  const token = String(config?.token || "");
  return `${baseUrl}::${token}`;
};

const setModeParentId = (scopeKey: string, mode: MediaMode, parentId?: string) => {
  modeParentIdCache.set(`${scopeKey}:${mode}`, parentId);
};

const findParentIdByMode = (folders: EmbyVirtualFolderItem[], mode: MediaMode): string | undefined => {
  const targetTypes = mode === TrackType.AUDIOBOOK ? AUDIOBOOK_COLLECTION_TYPES : MUSIC_COLLECTION_TYPES;
  for (const folder of folders) {
    const collectionType = String(folder.CollectionType || "").toLowerCase();
    const contentType = String(folder.LibraryOptions?.ContentType || "").toLowerCase();
    if (targetTypes.has(collectionType) || targetTypes.has(contentType)) {
      return folder.ItemId || folder.Id;
    }
  }
  return undefined;
};

export const preloadEmbyLibraryParents = async (client: EmbyClient): Promise<void> => {
  const scopeKey = getScopeKey(client);
  if (loadedScopeCache.has(scopeKey)) return;

  try {
    const response = await client.get<EmbyVirtualFoldersResponse>("Library/VirtualFolders/Query", {
      Limit: 50,
    });
    const folders = response.Items || [];
    setModeParentId(scopeKey, TrackType.MUSIC, findParentIdByMode(folders, TrackType.MUSIC));
    setModeParentId(scopeKey, TrackType.AUDIOBOOK, findParentIdByMode(folders, TrackType.AUDIOBOOK));
  } catch {
    setModeParentId(scopeKey, TrackType.MUSIC, undefined);
    setModeParentId(scopeKey, TrackType.AUDIOBOOK, undefined);
  } finally {
    loadedScopeCache.add(scopeKey);
  }
};

export const getModeParentId = async (
  client: EmbyClient,
  type?: string,
  userId?: number | string
): Promise<string | undefined> => {
  void userId;
  const mode = normalizeMediaMode(type);
  const scopeKey = getScopeKey(client);
  const cacheKey = `${scopeKey}:${mode}`;

  if (!modeParentIdCache.has(cacheKey)) {
    await preloadEmbyLibraryParents(client);
  }
  return modeParentIdCache.get(cacheKey);
};

