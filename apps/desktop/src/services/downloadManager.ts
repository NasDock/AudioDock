import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../models";
import { useAuthStore } from "../store/auth";
import { useSettingsStore } from "../store/settings";
import { isTauri } from "../utils/platform";
import { resolveArtworkUri } from "./trackResolver";
import { buildTrackPlaybackUrl } from "./trackQuality";

interface TrackMetadata {
  id: number | string;
  path: string;
  name: string;
  artist: string;
  album: string;
  albumId?: number | string;
  duration: number | null;
  type: string;
  cover?: string | null;
  lyrics?: string | null;
  localPath?: string;
}

export const downloadTrack = async (track: Track): Promise<boolean> => {
  if (!isTauri()) return false;

  const settings = useSettingsStore.getState();
  const downloadPath = settings.download.downloadPath;
  const token = useAuthStore.getState().token;
  const albumName = track.albumEntity?.name || track.album || "Unknown Album";

  // 统一下载源也走 /track/stream/:id 代理（对齐 trackResolver/buildTrackPlaybackUrl），
  // 避免直连 /music/ 命中 transcoded-mv 目录导致 404 或错误 Content-Type。
  let remoteUri = "";
  if (track.path) {
    remoteUri = buildTrackPlaybackUrl({ id: track.id, path: track.path });
  }

  if (!remoteUri) return false;

  const metadata: TrackMetadata = {
    id: track.id,
    path: track.path,
    name: track.name,
    artist: track.artist,
    album: albumName,
    albumId: track.albumEntity?.id || (track as any).albumId,
    duration: track.duration,
    type: track.type,
    // 这张封面会被下载并嵌入离线文件的 ID3 标签，所以强制走缩略图档（≤300），
    // 否则内网下载时会把 5MB 原图塞进音频文件里。
    cover: track.cover ? resolveArtworkUri(track.cover, { width: 300 }) ?? null : null,
    lyrics: track.lyrics
  };

  try {
    const res = await invoke("cache_download", {
      trackId: track.id,
      url: remoteUri,
      downloadPath,
      trackType: track.type,
      albumName,
      metadata,
      token,
    }) as string | null;
    return !!res;
  } catch (error) {
    console.error(`[DownloadManager] Failed to download track ${track.id}`, error);
    return false;
  }
};

export const downloadTracks = async (tracks: Track[], onProgress?: (completed: number, total: number) => void): Promise<void> => {
  let completed = 0;
  const total = tracks.length;

  // We can do them in batches or one by one. One by one is safer for simple progress.
  for (const track of tracks) {
    await downloadTrack(track);
    completed++;
    if (onProgress) {
        onProgress(completed, total);
    }
  }
};
