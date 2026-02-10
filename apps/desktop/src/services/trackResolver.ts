import type { Album, Track } from "@soundx/services";
import { getBaseURL } from "../https";
import { useAuthStore } from "../store/auth";
import { useSettingsStore } from "../store/settings";

interface ResolveOptions {
  cacheEnabled: boolean;
}

/**
 * Resolves a track into a playable URI for the desktop player
 */
export const resolveTrackUri = async (
  track: Track,
  options: ResolveOptions
): Promise<string> => {
  const { cacheEnabled } = options;

  // 1. Construct the remote URI (if path exists)
  let remoteUri = "";
  if (track.path) {
    remoteUri = track.path.startsWith("http")
      ? track.path
      : `${getBaseURL()}${track.path}`;
  }

  // Support playback from local list even if path is missing (for legacy or offline tracks)
  const localPath = (track as any).localPath;
  if (!track.path && localPath) {
    return `media://audio/${localPath}`;
  }

  if (!track.path) {
    console.warn(`[TrackResolver] Track ${track.id} has no path and no localPath`);
    return "";
  }

  // 2. Check for cached version if enabled
  const settings = useSettingsStore.getState();
  const downloadPath = settings.download.downloadPath;
  const albumName = track.albumEntity?.name || track.album || "Unknown Album";

  if (cacheEnabled && track.id && (window as any).ipcRenderer) {
    try {
      const cachedPath = await (window as any).ipcRenderer.invoke(
        "cache:check", 
        track.id, 
        track.path, 
        downloadPath, 
        track.type, 
        albumName
      );
      
      if (cachedPath) {
        return cachedPath;
      }

      // 3. If not cached, trigger background download
      const token = useAuthStore.getState().token;
      
      // Prepare metadata for offline use
      const metadata = {
        id: track.id,
        path: track.path,
        name: track.name,
        artist: track.artist,
        album: albumName,
        albumId: track.albumEntity?.id || (track as any).albumId,
        duration: track.duration,
        type: track.type,
        cover: track.cover ? (track.cover.startsWith('http') ? track.cover : `${getBaseURL()}${track.cover}`) : null,
        lyrics: track.lyrics
      };

      (window as any).ipcRenderer.invoke(
        "cache:download", 
        track.id, 
        remoteUri, 
        downloadPath, 
        track.type, 
        albumName, 
        metadata, 
        token
      ).catch((e: any) =>
        console.error("[TrackResolver] Unified download IPC failed", e)
      );
    } catch (error) {
      console.error("[TrackResolver] IPC communication failed", error);
    }
  }

  // 4. Return remote URI by default
  return remoteUri;
};

/**
 * Resolves artwork URI
 */
export const resolveArtworkUri = (item: Track | Album | string): string | undefined => {
  const cover = typeof item === "string" ? item : item?.cover;
  if (!cover) return undefined;
  
  let uri: string;
  if (cover.startsWith("media://")) {
    uri = cover;
  } else {
    uri = cover.startsWith("http")
      ? cover
      : `${getBaseURL()}${cover}`;
  }
  return uri;
};
