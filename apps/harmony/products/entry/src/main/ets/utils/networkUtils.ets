import http from '@ohos.net.http';
import { Logger } from 'audiodock_common';
import { probeFnos } from 'features_network';

const TAG = 'LoginDiag';

// ============ 数据源映射（对齐 mobile 端 packages/services） ============
// 'Feiniu' 是本端展示用的 key，映射到后端/适配器口径的 'fnos'（飞牛音乐 trim.music）
export const SOURCEMAP: Record<string, string> = {
  'AudioDock': 'audiodock',
  'Subsonic': 'subsonic',
  'Emby': 'emby',
  'Feiniu': 'fnos',
};

export const SOURCETIPSMAP: Record<string, string> = {
  'AudioDock': '所有支持 AudioDock 官方服务端',
  'Subsonic': '所有支持 Subsonic 协议的服务端，例如：Navidrome、Gonic 等',
  'Emby': '所有支持 Emby 协议的服务端',
  'Feiniu': '飞牛 fnOS 自带的音乐应用（trim.music），地址填 NAS，如 http://192.168.1.10:5666',
};

/** 数据源展示名（SOURCEMAP 的 key 是技术标识，这里负责本地化） */
export const SOURCE_LABELS: Record<string, string> = {
  'AudioDock': 'AudioDock',
  'Subsonic': 'Subsonic',
  'Emby': 'Emby',
  'Feiniu': '飞牛',
};

// ============ 服务器连通性探测（对齐 mobile networkUtils.checkServerConnectivity） ============
export async function checkServerConnectivity(address: string, sourceType: string): Promise<boolean> {
  if (!address) {
    return false;
  }
  if (!address.startsWith('http://') && !address.startsWith('https://')) {
    return false;
  }

  const mappedType: string = SOURCEMAP[sourceType] || 'audiodock';

  // 飞牛音乐：`/sys/config` 免登录且必定返回服务器身份，能拿到 serverGUID 即视为存活。
  // 地址归一化（补协议/端口、去 /music 尾巴）在 fnos 客户端里做，这里直接交给它。
  if (mappedType === 'fnos') {
    const alive: boolean = await probeFnos(address);
    Logger.i(TAG, `fnos probe url=${address} alive=${alive}`);
    return alive;
  }

  const base: string = address.replace(/\/+$/, '');
  let pingUrl: string;
  if (mappedType === 'subsonic') {
    pingUrl = `${base}/rest/ping.view?v=1.16.1&c=SoundX&f=json`;
  } else if (mappedType === 'emby') {
    pingUrl = `${base}/emby/System/Info/Public`;
  } else {
    pingUrl = `${base}/hello`;
  }

  const httpRequest = http.createHttp();
  try {
    const opts: http.HttpRequestOptions = {
      method: http.RequestMethod.GET,
      readTimeout: 3000,
      connectTimeout: 3000,
    };
    const response: http.HttpResponse = await httpRequest.request(pingUrl, opts);
    Logger.i(TAG, `ping url=${pingUrl} code=${response.responseCode} alive=${response.responseCode >= 200 && response.responseCode < 300}`);
    if (response.responseCode >= 200 && response.responseCode < 300) {
      return true;
    }
    // Subsonic 协议未授权时返回 401，但说明服务存活
    if (mappedType === 'subsonic' && response.responseCode === 401) {
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    httpRequest.destroy();
  }
}

// ============ 选择最优服务器（对齐 mobile networkUtils.selectBestServer） ============
// 优先内网地址（局域网直连更快），不可达时回退到外网地址。
export async function selectBestServer(
  internalAddress: string,
  externalAddress: string,
  sourceType: string,
): Promise<string | null> {
  if (internalAddress) {
    const internalAlive: boolean = await checkServerConnectivity(internalAddress, sourceType);
    if (internalAlive) {
      return internalAddress;
    }
  }
  if (externalAddress) {
    const externalAlive: boolean = await checkServerConnectivity(externalAddress, sourceType);
    if (externalAlive) {
      return externalAddress;
    }
  }
  return null;
}
