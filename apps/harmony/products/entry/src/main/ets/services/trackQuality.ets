import { kvStore } from 'features_storage';
import { trackApi } from 'features_network';

export type Quality = 'lossless' | 'high' | 'standard';

function asQuality(raw: string | null, fallback: Quality): Quality {
  if (raw === 'lossless' || raw === 'high' || raw === 'standard') return raw;
  return fallback;
}

/**
 * ArkTS 没有全局 URL 类，手写解析 host（含端口）。
 * 解析失败返回空串，调用方按「不匹配 → 走代理」处理。
 */
function extractHost(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return '';
  let rest = url.substring(url.indexOf('://') + 3);
  const slashIdx = rest.indexOf('/');
  if (slashIdx >= 0) rest = rest.substring(0, slashIdx);
  return rest;
}

export async function getInternalQuality(): Promise<Quality> {
  return asQuality(await kvStore.get('internalPlaybackQuality'), 'high');
}

export async function getExternalQuality(): Promise<Quality> {
  return asQuality(await kvStore.get('externalPlaybackQuality'), 'standard');
}

export async function resolveTrackUrl(trackId: string, quality: Quality, path?: string): Promise<string> {
  // 对齐 mobile/desktop/mini 的 buildTrackPlaybackUrl：
  // 只有当 path 的 host 就是当前 baseURL 的 host（即本来就是服务器自己的地址）时才直返；
  // 否则（如 strm 曲目指向 Alist 内网地址）改走 /track/stream 服务端代理，避免外网/跨网段不可达。
  if (path && (path.startsWith('http://') || path.startsWith('https://'))) {
    const baseUrl = trackApi.streamUrl('', '').split('/track/stream')[0];
    const pathHost = extractHost(path);
    const baseHost = extractHost(baseUrl);
    if (pathHost !== '' && pathHost === baseHost) {
      return path;
    }
    return trackApi.streamUrl(trackId, quality);
  }
  // 本地曲目：直接用 baseURL 拼出绝对流媒体地址。
  // 后端 playback-qualities 返回的 url 可能是相对路径，AVPlayer 无法直接播放，
  // 从而导致点了播放但系统没有声音。
  return trackApi.streamUrl(trackId, quality);
}
