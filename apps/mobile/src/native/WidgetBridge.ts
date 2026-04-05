import { NativeModules } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cacheCover } from "../services/cache";
import { getImageUrl } from "../utils/image";
import { Album, Playlist, Track } from "../models";

type WidgetUpdatePayload = {
  title: string;
  artist: string;
  coverPath?: string | null;
  isPlaying: boolean;
  playMode?: string;
  isLiked?: boolean;
  position?: number;
  duration?: number;
  isVip?: boolean;
};

type WidgetPlaylistItem = {
  id: number | string;
  name: string;
  coverPath?: string | null;
};

type WidgetHistoryItem = {
  id: number | string;
  title: string;
  artist: string;
  album?: string | null;
  coverPath?: string | null;
  type?: string;
};

type WidgetLatestItem = {
  id: number | string;
  title: string;
  artist: string;
  coverPath?: string | null;
  type?: string;
};

type WidgetRecommendationItem = {
  id: number | string;
  title: string;
  artist: string;
  coverPath?: string | null;
  type?: string;
};

type WidgetBridgeModule = {
  updateWidget: (payload: WidgetUpdatePayload) => Promise<void>;
  updateWidgetCollections?: (payload: {
    playlists: WidgetPlaylistItem[];
    history: WidgetHistoryItem[];
    latest: WidgetLatestItem[];
    recommendations: WidgetRecommendationItem[];
    isVip?: boolean;
  }) => Promise<void>;
  updateWidgetMembership?: (payload: { isVip: boolean }) => Promise<void>;
};

const NativeWidgetBridge = NativeModules.WidgetBridge as WidgetBridgeModule | undefined;
let latestSyncedVipState: boolean | undefined;

const normalizeLocalPath = (path: string): string => {
  if (path.startsWith("file://")) return path.replace("file://", "");
  return path;
};

const getStoredVipState = async (): Promise<boolean | undefined> => {
  try {
    const plusVipStatus = await AsyncStorage.getItem("plus_vip_status");
    if (plusVipStatus === "true") return true;
    if (plusVipStatus === "false") return false;

    const plusVipData = await AsyncStorage.getItem("plus_vip_data");
    if (!plusVipData) return undefined;

    const parsed = JSON.parse(plusVipData);
    if (parsed?.vipTier === undefined) return undefined;
    return !!(parsed.vipTier && parsed.vipTier !== "NONE");
  } catch {
    return undefined;
  }
};

export const updateWidget = async (payload: WidgetUpdatePayload): Promise<void> => {
  if (!NativeWidgetBridge?.updateWidget) return;

  const storedVipState = await getStoredVipState();
  const resolvedVipState =
    payload.isVip !== undefined
      ? payload.isVip
      : storedVipState !== undefined
        ? storedVipState
        : latestSyncedVipState;

  const safePayload: WidgetUpdatePayload = {
    title: payload.title,
    artist: payload.artist,
    coverPath: payload.coverPath ? normalizeLocalPath(payload.coverPath) : null,
    isPlaying: payload.isPlaying,
    playMode: payload.playMode,
    isLiked: payload.isLiked,
    position: payload.position ?? 0,
    duration: payload.duration ?? 0,
    ...(resolvedVipState !== undefined ? { isVip: resolvedVipState } : {}),
  };

  try {
    await NativeWidgetBridge.updateWidget(safePayload);
  } catch (error) {
    if (__DEV__) {
      console.warn("[WidgetBridge] updateWidget failed", error);
    }
  }
};

export const syncWidgetMembership = async (isVip: boolean): Promise<void> => {
  if (!NativeWidgetBridge?.updateWidgetMembership) return;

  try {
    latestSyncedVipState = isVip;
    await NativeWidgetBridge.updateWidgetMembership({ isVip });
  } catch (error) {
    if (__DEV__) {
      console.warn("[WidgetBridge] updateWidgetMembership failed", error);
    }
  }
};

export const updateWidgetCollections = async (params: {
  playlists?: Playlist[];
  history?: (Track | Record<string, any>)[];
  latest?: Track[];
  recommendations?: Album[];
}): Promise<void> => {
  if (!NativeWidgetBridge?.updateWidgetCollections) return;

  const storedVipState = await getStoredVipState();
  const resolvedVipState =
    storedVipState !== undefined ? storedVipState : latestSyncedVipState;

  const playlistItems: WidgetPlaylistItem[] | undefined = params.playlists
    ? await Promise.all(
      params.playlists.slice(0, 3).map(async (playlist) => {
      const firstTrack = (playlist as any).tracks?.[0] as Track | undefined;
      const coverUrl = firstTrack?.cover ? getImageUrl(firstTrack.cover) : null;
      let coverPath: string | null = null;
      if (coverUrl) {
        const cached = await cacheCover(coverUrl);
        if (!cached.startsWith("http://") && !cached.startsWith("https://")) {
          coverPath = normalizeLocalPath(cached);
        }
      }
      return {
        id: playlist.id,
        name: playlist.name,
        coverPath,
      };
      })
    )
    : undefined;

  const historyItems: WidgetHistoryItem[] | undefined = params.history
    ? await Promise.all(
      params.history.slice(0, 4).map(async (track) => {
      const title = (track as any).name || (track as any).title || "未命名";
      const artist = (track as any).artist || "";
      const album = (track as any).album || "";
      const coverUrl = (track as any).cover ? getImageUrl((track as any).cover) : null;
      let coverPath: string | null = null;
      if (coverUrl) {
        const cached = await cacheCover(coverUrl);
        if (!cached.startsWith("http://") && !cached.startsWith("https://")) {
          coverPath = normalizeLocalPath(cached);
        }
      }
      return {
        id: (track as any).id ?? (track as any).resumeTrackId ?? "",
        title,
        artist,
        album,
        coverPath,
        type: (track as any).type,
      };
      })
    )
    : undefined;

  const latestItems: WidgetLatestItem[] | undefined = params.latest
    ? await Promise.all(
      params.latest.slice(0, 7).map(async (track) => {
      const coverUrl = track.cover ? getImageUrl(track.cover) : null;
      let coverPath: string | null = null;
      if (coverUrl) {
        const cached = await cacheCover(coverUrl);
        if (!cached.startsWith("http://") && !cached.startsWith("https://")) {
          coverPath = normalizeLocalPath(cached);
        }
      }
      return {
        id: track.id,
        title: track.name,
        artist: track.artist || "",
        coverPath,
        type: (track as any).type,
      };
      })
    )
    : undefined;

  const recommendationItems: WidgetRecommendationItem[] | undefined = params.recommendations
    ? await Promise.all(
      params.recommendations.slice(0, 4).map(async (album) => {
      const coverUrl = album.cover ? getImageUrl(album.cover) : null;
      let coverPath: string | null = null;
      if (coverUrl) {
        const cached = await cacheCover(coverUrl);
        if (!cached.startsWith("http://") && !cached.startsWith("https://")) {
          coverPath = normalizeLocalPath(cached);
        }
      }
      return {
        id: album.id,
        title: album.name,
        artist: album.artist || "",
        coverPath,
        type: (album as any).type,
      };
      })
    )
    : undefined;

  try {
    const payload: Record<string, unknown> = {};
    if (playlistItems) payload.playlists = playlistItems;
    if (historyItems) payload.history = historyItems;
    if (latestItems) payload.latest = latestItems;
    if (recommendationItems) payload.recommendations = recommendationItems;
    if (resolvedVipState !== undefined) {
      payload.isVip = resolvedVipState;
    }
    await NativeWidgetBridge.updateWidgetCollections(payload as {
      playlists: WidgetPlaylistItem[];
      history: WidgetHistoryItem[];
      latest: WidgetLatestItem[];
      recommendations: WidgetRecommendationItem[];
      isVip?: boolean;
    });
  } catch (error) {
    if (__DEV__) {
      console.warn("[WidgetBridge] updateWidgetCollections failed", error);
    }
  }
};
