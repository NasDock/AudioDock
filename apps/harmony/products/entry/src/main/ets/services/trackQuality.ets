import { kvStore } from 'features_storage';
import { trackApi } from 'features_network';
import { isInternalNetwork } from '../utils/networkMode';

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

// 音质默认「原音质」（无损直连原始文件，服务端不转码）；
// 用户可在设置里按内/外网分别降档省流量。
export async function getInternalQuality(): Promise<Quality> {
  return asQuality(await kvStore.get('internalPlaybackQuality'), 'lossless');
}

export async function getExternalQuality(): Promise<Quality> {
  return asQuality(await kvStore.get('externalPlaybackQuality'), 'lossless');
}

/**
 * 按当前网络环境（isInternalNetwork 由 refreshNetworkMode 在服务器切换时刷新）
 * 选出设置页对应的音质档位。播放入口统一走这里，不要直接调内/外网 getter。
 */
export async function getCurrentQuality(): Promise<Quality> {
  return isInternalNetwork() ? getInternalQuality() : getExternalQuality();
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
