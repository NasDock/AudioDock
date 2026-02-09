import { getBaseURL } from "../https";
import { Track } from "../models";
import { downloadTrack, isCached, resolveLocalPath } from "./cache";

interface ResolveOptions {
  cacheEnabled: boolean;
  shouldDownload?: boolean; // 新增：是否触发后台下载
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
  const { cacheEnabled, shouldDownload } = options;

  // 1. Construct the URI via backend stream endpoint
  const remoteUri = `${getBaseURL()}/track/stream/${track.id}`;

  // 2. Check for cached version if enabled
  if (cacheEnabled && track.id && !track.path.startsWith('http')) {
    const localPath = await isCached(track.id, track.path);
    if (localPath) {
      console.log(`[TrackResolver] Playing from cache: ${track.id}`);
      return resolveLocalPath(localPath);
    }

    // 3. If not cached but features is enabled AND shouldDownload is not explicitly false, trigger background download
    if (shouldDownload !== false) {
      console.log(`[TrackResolver] Not cached, starting background download: ${track.id}`);
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
    : `${getBaseURL()}${encodeURI(track.cover)}`;
};
