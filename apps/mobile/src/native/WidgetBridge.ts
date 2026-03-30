import { NativeModules } from "react-native";
import { cacheCover } from "../services/cache";
import { getImageUrl } from "../utils/image";
import { Track, Playlist } from "../models";

type WidgetUpdatePayload = {
  title: string;
  artist: string;
  coverPath?: string | null;
  isPlaying: boolean;
  playMode?: string;
  isLiked?: boolean;
  position?: number;
  duration?: number;
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

type WidgetBridgeModule = {
  updateWidget: (payload: WidgetUpdatePayload) => Promise<void>;
  updateWidgetCollections?: (payload: {
    playlists: WidgetPlaylistItem[];
    history: WidgetHistoryItem[];
    latest: WidgetLatestItem[];
  }) => Promise<void>;
};

const NativeWidgetBridge = NativeModules.WidgetBridge as WidgetBridgeModule | undefined;

const normalizeLocalPath = (path: string): string => {
  if (path.startsWith("file://")) return path.replace("file://", "");
  return path;
};

export const updateWidget = async (payload: WidgetUpdatePayload): Promise<void> => {
  if (!NativeWidgetBridge?.updateWidget) return;

  const safePayload: WidgetUpdatePayload = {
    title: payload.title,
    artist: payload.artist,
    coverPath: payload.coverPath ? normalizeLocalPath(payload.coverPath) : null,
    isPlaying: payload.isPlaying,
    playMode: payload.playMode,
    isLiked: payload.isLiked,
    position: payload.position ?? 0,
    duration: payload.duration ?? 0,
  };

  try {
    await NativeWidgetBridge.updateWidget(safePayload);
  } catch (error) {
    if (__DEV__) {
      console.warn("[WidgetBridge] updateWidget failed", error);
    }
  }
};

export const updateWidgetCollections = async (params: {
  playlists?: Playlist[];
  history?: (Track | Record<string, any>)[];
  latest?: Track[];
}): Promise<void> => {
  if (!NativeWidgetBridge?.updateWidgetCollections) return;

  const playlists = params.playlists || [];
  const history = params.history || [];
  const latest = params.latest || [];

  const playlistItems: WidgetPlaylistItem[] = await Promise.all(
    playlists.slice(0, 3).map(async (playlist) => {
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
  );

  const historyItems: WidgetHistoryItem[] = await Promise.all(
    history.slice(0, 3).map(async (track) => {
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
  );

  const latestItems: WidgetLatestItem[] = await Promise.all(
    latest.slice(0, 5).map(async (track) => {
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
  );

  try {
    await NativeWidgetBridge.updateWidgetCollections({
      playlists: playlistItems,
      history: historyItems,
      latest: latestItems,
    });
  } catch (error) {
    if (__DEV__) {
      console.warn("[WidgetBridge] updateWidgetCollections failed", error);
    }
  }
};
