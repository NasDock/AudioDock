import { getBaseURL } from "../https";
import { Track } from "../models";
import {
  cacheCover,
  downloadTrack,
  getCachedCover,
  isCached,
  resolveLocalPath,
} from "./cache";

interface ResolveOptions {
  cacheEnabled: boolean;
  shouldDownload?: boolean; // 新增：是否触发后台下载
  fast?: boolean; // 新增：快速解析，不检查缓存
}

/**
 * Resolves a track into a playable URI for TrackPlayer
 * Handles:
 * 1. Online URLs (with base URL mapping)
 * 2. Cached local files (if available and enabled)
 * 3. Background caching while listening
 */
export const resolveTrackUri = async (
  track: Track,
  options: ResolveOptions
): Promise<string> => {
  const { cacheEnabled, shouldDownload, fast } = options;

  // 1. Construct the remote URI
  const remoteUri = track.path.startsWith("http")
    ? track.path
    : `${getBaseURL()}${track.path.split('/').map(encodeURIComponent).join('/')}`;

  // 2. Check for cached version if enabled
  if (fast) return remoteUri;

  if (cacheEnabled && track.id) {
    const localPath = await isCached(track.id, track.path);
    if (localPath) {
      console.log(`[TrackResolver] Playing from cache: ${track.id}`);
      return resolveLocalPath(localPath);
    }

    // 3. If not cached but features is enabled, trigger background download
    console.log(`[TrackResolver] Not cached, starting background download: ${track.id}`);
    if (shouldDownload) {
      downloadTrack(track, remoteUri).catch((e) =>
        console.error("[TrackResolver] Cache download failed", e)
      );
    }
  }

  // 4. Return remote URI by default
  return remoteUri;
};

/**
 * Resolves artwork URI
 */
export const resolveArtworkUri = (track: Track): string | undefined => {
  if (!track.cover) return undefined;
  
  return track.cover.startsWith("http")
    ? track.cover
    : `${getBaseURL()}${track.cover.split('/').map(encodeURIComponent).join('/')}`;
};

interface ArtworkResolveOptions {
  shouldDownload?: boolean;
  fast?: boolean;
}

export const resolveArtworkUriForPlayer = async (
  track: Track,
  options: ArtworkResolveOptions = {}
): Promise<string | undefined> => {
  const remoteArtwork = resolveArtworkUri(track);
  if (!remoteArtwork) return undefined;

  if (options.fast) return remoteArtwork;

  const cached = await getCachedCover(remoteArtwork);
  if (cached) {
    return resolveLocalPath(cached);
  }

  if (options.shouldDownload) {
    const localOrRemote = await cacheCover(remoteArtwork);
    if (localOrRemote.startsWith("http://") || localOrRemote.startsWith("https://")) {
      return localOrRemote;
    }
    return resolveLocalPath(localOrRemote);
  }

  return remoteArtwork;
};
