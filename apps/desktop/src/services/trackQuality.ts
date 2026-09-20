import { getBaseURL } from "../https";
import { cacheUtils } from "../utils/cache";

export type AudioQuality = "lossless" | "high" | "standard";

export interface AudioQualityOption {
  quality: AudioQuality;
  label: string;
  codec: string;
  bitrate: string;
}

export interface AudioQualityProfile {
  defaultQuality: AudioQuality;
  options: AudioQualityOption[];
}

const AUDIO_QUALITY_PRIORITY: AudioQuality[] = ["lossless", "high", "standard"];

export const getFallbackAudioQualityProfile = (): AudioQualityProfile => ({
  defaultQuality: "lossless",
  options: [
    {
      quality: "lossless",
      label: "无损",
      codec: "原始",
      bitrate: "原始",
    },
  ],
});

// 秒播优化：音质 profile 缓存 5 分钟。
// 同一首歌反复切换时不再重复请求 /track/:id/playback-qualities，
// 减少切歌时的网络往返（虽然该请求是异步不阻塞播放，但缓存后连异步延迟也省掉）。
const QUALITY_PROFILE_CACHE_KEY = (trackId: number | string) =>
  `quality_profile_${trackId}`;
const QUALITY_PROFILE_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

export const getTrackAudioQualityProfile = async (track: {
  id: number | string;
  path: string;
}): Promise<AudioQualityProfile> => {
  if (track.path.startsWith("http")) {
    return getFallbackAudioQualityProfile();
  }

  // 先查缓存
  const cacheKey = QUALITY_PROFILE_CACHE_KEY(track.id);
  const cached = cacheUtils.get<AudioQualityProfile>(
    cacheKey,
    QUALITY_PROFILE_CACHE_TTL,
  );
  if (cached) return cached;

  try {
    const response = await fetch(
      `${getBaseURL().replace(/\/$/, "")}/track/${track.id}/playback-qualities`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch playback qualities: ${response.status}`);
    }
    const payload = await response.json();
    const profile: AudioQualityProfile =
      payload?.data || getFallbackAudioQualityProfile();
    cacheUtils.set(cacheKey, profile);
    return profile;
  } catch (error) {
    console.error("Failed to load track audio quality profile:", error);
    return getFallbackAudioQualityProfile();
  }
};

export const resolveTrackAudioQuality = (
  profile: AudioQualityProfile,
  preferredQuality?: AudioQuality,
): AudioQuality => {
  if (preferredQuality && profile.options.some((option) => option.quality === preferredQuality)) {
    return preferredQuality;
  }

  if (profile.options.some((option) => option.quality === profile.defaultQuality)) {
    return profile.defaultQuality;
  }

  for (const quality of AUDIO_QUALITY_PRIORITY) {
    if (profile.options.some((option) => option.quality === quality)) {
      return quality;
    }
  }

  return "lossless";
};

export const buildTrackPlaybackUrl = (
  track: { id: number | string; path: string },
  quality?: AudioQuality,
): string => {
  // 统一走 /track/stream/:id 代理，让后端处理：
  //   - 音质参数（?quality=high 转码）
  //   - STRM 外链（http 开头但 host 不同的，proxyStream 转发）
  //   - 本地文件的 Range / Content-Type 正确性
  //
  // 历史包袱：曾经有过「path 是同 host 完整 URL 就直连」的内网加速分支，
  // 但后端 `/music/` 实际挂的是 transcoded-mv 目录（不是真实音乐目录），
  // 直连会 404 或拿到错误 Content-Type，AVPlayer 报 NotSupportedError。
  // 内网多一跳转发对带宽影响可忽略，稳定性优先。
  const baseURL = getBaseURL().replace(/\/$/, "");
  const qualityQuery = quality ? `?quality=${quality}` : "";
  return `${baseURL}/track/stream/${track.id}${qualityQuery}`;
};
