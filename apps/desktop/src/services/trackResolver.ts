import { invoke } from "@tauri-apps/api/core";
import type { Album, Mv, Track } from "@soundx/services";
import { getBaseURL } from "../https";
import { useAuthStore } from "../store/auth";
import { useSettingsStore } from "../store/settings";
import { bucketWidth, isThumbnailBucket } from "../utils/imageBucket";
import { isTauri } from "../utils/platform";
import { isCurrentInternalAddress } from "../utils/playbackQuality";
import { buildTrackPlaybackUrl } from "./trackQuality";

interface ResolveOptions {
  cacheEnabled: boolean;
}

/**
 * The origin of the backend's local streaming media server (e.g.
 * `http://127.0.0.1:39571`). Cached audio is served from `<origin>/audio/<rel>`,
 * which AVPlayer streams progressively with range requests. Cached once.
 */
let mediaOrigin: string | null = null;
const getMediaOrigin = async (): Promise<string> => {
  if (mediaOrigin) return mediaOrigin;
  try {
    mediaOrigin = await invoke<string>("get_media_origin");
  } catch {
    mediaOrigin = "";
  }
  return mediaOrigin || "";
};

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

/**
 * Resolves a track into a playable URI for the desktop player
 */
export const resolveTrackUri = async (
  track: Track,
  options: ResolveOptions
): Promise<string> => {
  const { cacheEnabled } = options;

  // 1. Construct the remote URI (if path exists).
  // 统一走 /track/stream/:id 代理（对齐 buildTrackPlaybackUrl 的口径），
  // 让后端处理音质参数 / STRM 外链 / Range / Content-Type，
  // 避免直连 /music/ 命中 transcoded-mv 目录导致 404 或错误 Content-Type。
  let remoteUri = "";
  if (track.path) {
    remoteUri = buildTrackPlaybackUrl({ id: track.id, path: track.path });
  }

  // Support playback from local list even if path is missing (for legacy or offline tracks)
  const localPath = (track as any).localPath;
  if (!track.path && localPath) {
    return `${await getMediaOrigin()}/audio/${localPath}`;
  }

  if (!track.path) {
    console.warn(`[TrackResolver] Track ${track.id} has no path and no localPath`);
    return "";
  }

  // 2. Check for cached version if enabled
  const settings = useSettingsStore.getState();
  const downloadPath = settings.download.downloadPath;
  const albumName = track.albumEntity?.name || track.album || "Unknown Album";

  if (cacheEnabled && track.id && isTauri()) {
    try {
      const cachedPath = await invoke("cache_check", {
        trackId: track.id,
        originalPath: track.path,
        downloadPath,
        trackType: track.type,
        albumName,
      }) as string | null;
      
      if (cachedPath) {
        // cache_check returns a streaming http:// URL for the cached file.
        return cachedPath;
      }

      // 3. If not cached, trigger background download
      const token = useAuthStore.getState().token;
      
      // Prepare metadata for offline use
      const metadata: TrackMetadata = {
        id: track.id,
        path: track.path,
        name: track.name,
        artist: track.artist,
        album: albumName,
        albumId: track.albumEntity?.id || (track as any).albumId,
        duration: track.duration,
        type: track.type,
        cover: track.cover ? (track.cover.startsWith('http') ? track.cover : `${getBaseURL()}${track.cover.split('/').map(encodeURIComponent).join('/')}`) : null,
        lyrics: track.lyrics
      };

      invoke("cache_download", {
        trackId: track.id,
        url: remoteUri,
        downloadPath,
        trackType: track.type,
        albumName,
        metadata,
        token,
      }).catch((e: any) =>
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
 *
 * 分级加载策略（详见 `../utils/imageBucket.ts`）：
 *
 * 1. 传入的 width 会先量化到固定档位 [96,128,300,600,900,1200]，避免后端
 *    `.optimized/` 缓存碎片化（后端按 w 逐个落盘）。
 * 2. 缩略图档位（≤300，即列表行 / MiniPlayer / 网格小卡）**恒走 /image/optimize**，
 *    不区分内外网 —— 列表一屏 N 张图，瓶颈是解码内存而非网速（50 张 3000×3000
 *    原图 = 1.8GB 位图，必然 OOM）。
 * 3. 大图档位（>300，即详情页 Hero / 全屏封面 / 艺术家大头像）才看网络环境：
 *    内网直连原图（零 CPU 开销、零画质损失），外网走 optimize。
 *
 * 不传 width，或 cover 是 http(s) 外链、Tauri `media://` 协议、`/music/` 路径时，
 * 一律回退到原 URI。
 */
export interface ResolveArtworkOptions {
  /** 目标设备像素宽度（非 CSS 尺寸，按显示尺寸 ×2 估算）。常见档位：96/128/300/600/900 */
  width?: number;
  /** webp 质量 1-100（默认 72） */
  quality?: number;
  /** 输出格式：默认 webp */
  format?: "webp" | "jpeg";
}

export const resolveArtworkUri = (
  item: Track | Album | Mv | string,
  options: ResolveArtworkOptions = {},
): string | undefined => {
  const cover = typeof item === "string" ? item : item?.cover;
  if (!cover) return undefined;

  // media:// 是 Tauri 自定义协议，原样返回
  if (cover.startsWith("media://")) {
    return cover;
  }

  // http(s) 外链直接返回（外部源 Subsonic/Emby 的封面不走本服务代理）
  if (cover.startsWith("http://") || cover.startsWith("https://")) {
    return cover;
  }

  const originalUri = `${getBaseURL()}${cover.split('/').map(encodeURIComponent).join('/')}`;

  // 只有 /covers/ 能走缩略图代理。
  // /music/ 虽然在后端白名单里，但 `resolveLocalSource` 对它返回 null
  // （image-optimize.service.ts:142-149），请求必 404。
  const isCoversPath = cover.startsWith("/covers/") || cover.startsWith("covers/");
  if (!isCoversPath || !options.width || options.width < 16) {
    return originalUri;
  }

  const bucket = bucketWidth(options.width);

  // 大图档位才按网络环境区分；缩略图档位恒压缩（理由见文件头注释）。
  if (!isThumbnailBucket(bucket) && isCurrentInternalAddress()) {
    return originalUri;
  }

  const src = "/" + cover.replace(/^\/+/, "");
  const q = options.quality ?? 72;
  const fmt = options.format ?? "webp";
  return `${getBaseURL()}/image/optimize?src=${encodeURIComponent(src)}&w=${bucket}&q=${q}&fmt=${fmt}`;
};
