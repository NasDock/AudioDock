import { getBaseURL } from "../https";
import { Track, TrackType } from "../models";
import { getImageUrl } from "../utils/image";
import { AudioQuality, buildTrackPlaybackUrl } from "./trackQuality";
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
  quality?: AudioQuality; // 播放音质（仅音乐生效）；缺省按原音质
}

/**
 * Resolves a track into a playable URI for TrackPlayer
 * Handles:
 * 1. Online URLs (with base URL mapping)
 * 2. Cached local files (if available and enabled)
 * 3. Background caching while listening
 *
 * 音质语义：返回的播放 URI 按 options.quality 走 /track/stream 转码档位；
 * 但后台缓存下载（downloadTrack）恒拉原始文件 —— 缓存按 track.id+path 去重，
 * 若把转码档缓存下来，之后切回原音质会误命中低音质副本。
 */
export const resolveTrackUri = async (
  track: Track,
  options: ResolveOptions
): Promise<string> => {
  const { cacheEnabled, shouldDownload, fast, quality } = options;

  // 1. Construct the remote URI
  // 下载/原始 URI：保持原音质（现有行为）
  const originalUri = track.path.startsWith("http")
    ? track.path
    : `${getBaseURL()}${track.path.split('/').map(encodeURIComponent).join('/')}`;
  // 播放 URI：音乐按设置音质走 /track/stream；有声书维持原样（不参与音质分档）
  const remoteUri =
    track.type === TrackType.AUDIOBOOK
      ? originalUri
      : buildTrackPlaybackUrl(track, quality);

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
      downloadTrack(track, originalUri).catch((e) =>
        console.error("[TrackResolver] Cache download failed", e)
      );
    }
  }

  // 4. Return remote URI by default
  return remoteUri;
};

/**
 * Resolves artwork URI
 *
 * 分级加载同 `utils/image.ts`：width 量化到固定档位后，缩略图档位恒压缩，
 * 大图档位才按网络环境区分。
 *
 * @param width 目标设备像素宽度，默认 300
 */
export const resolveArtworkUri = (track: Track, width = 300): string | undefined => {
  if (!track.cover) return undefined;

  return getImageUrl(track.cover, undefined, width);
};

interface ArtworkResolveOptions {
  shouldDownload?: boolean;
  fast?: boolean;
}

/**
 * 解析给原生播控（通知栏 / 锁屏）用的封面。
 *
 * 默认走 300 档（恒压缩）：
 *  - 通知栏封面本身很小，300px 绰绰有余；
 *  - 关键是它会 `cacheCover` 落盘，若用大图档位，内网时会把 5MB 原图缓存下来。
 *
 * @param width 目标设备像素宽度，默认 300
 */
export const resolveArtworkUriForPlayer = async (
  track: Track,
  options: ArtworkResolveOptions = {},
  width = 300
): Promise<string | undefined> => {
  const remoteArtwork = resolveArtworkUri(track, width);
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
