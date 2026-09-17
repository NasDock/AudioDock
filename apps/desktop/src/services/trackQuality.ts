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
  // 只有当 path 的 host 就是当前 baseURL 的 host（即本来就是服务器自己的地址）时才直返；
  // 否则（如 strm 曲目指向 Alist 内网地址）改走 /track/stream 服务端代理，避免外网/跨网段不可达。
  if (track.path.startsWith("http")) {
    try {
      const pathUrl = new URL(track.path);
      const baseUrl = new URL(getBaseURL().replace(/\/$/, ""));
      if (pathUrl.host === baseUrl.host) {
        return track.path;
      }
    } catch {
      // URL parse failed, fall through to proxy
    }
    const qualityQuery = quality ? `?quality=${quality}` : "";
    return `${getBaseURL().replace(/\/$/, "")}/track/stream/${track.id}${qualityQuery}`;
  }

  const baseURL = getBaseURL().replace(/\/$/, "");
  const qualityQuery = quality ? `?quality=${quality}` : "";
  return `${baseURL}/track/stream/${track.id}${qualityQuery}`;
};
