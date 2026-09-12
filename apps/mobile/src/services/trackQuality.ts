import request, { getBaseURL } from "../https";

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

const AUDIO_QUALITY_PRIORITY: AudioQuality[] = ['lossless', 'high', 'standard'];

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

export const getTrackAudioQualityProfile = async (track: { id: number | string; path: string }): Promise<AudioQualityProfile> => {
  if (track.path.startsWith("http")) {
    return getFallbackAudioQualityProfile();
  }
  // Some adapters may provide an absolute http(s) `path`. That should not block
  // fetching quality profile (it is keyed by track id).

  try {
    const res = await request.get<any, { code: number; data: AudioQualityProfile }>(
      `/track/${track.id}/playback-qualities`
    );
    return res?.data || getFallbackAudioQualityProfile();
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

  return 'lossless';
};

const upsertQueryParam = (url: string, key: string, value?: string): string => {
  const idx = url.indexOf("?");
  const base = idx >= 0 ? url.slice(0, idx) : url;
  const query = idx >= 0 ? url.slice(idx + 1) : "";
  const parts = query ? query.split("&").filter(Boolean) : [];
  const filtered = parts.filter((p) => decodeURIComponent(p.split("=")[0] || "") !== key);

  if (value !== undefined) {
    filtered.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }

  return filtered.length ? `${base}?${filtered.join("&")}` : base;
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
  const streamPrefix = `${baseURL}/track/stream/${track.id}`;

  // If we already have a stream URL from our server, just upsert quality param.
  // Otherwise (third-party URL), keep the original.
  if (track.path.startsWith("http")) {
    if (!track.path.startsWith(streamPrefix)) return track.path;
    return upsertQueryParam(track.path, "quality", quality);
  }

  const qualityQuery = quality ? `?quality=${quality}` : "";
  return `${baseURL}/track/stream/${track.id}${qualityQuery}`;
};
