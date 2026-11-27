// 数据源类型映射
export const SOURCEMAP = {
  AudioDock: "audiodock",
  Subsonic: "subsonic",
  Emby: "emby",
  Audiobookshelf: "audiobookshelf",
} as const;

// 数据源提示信息
export const SOURCETIPSMAP = {
  AudioDock: "所有支持 AudioDock 官方服务端",
  Subsonic: "所有支持 Subsonic 协议的服务端，例如：Navidrome、Gonic 等",
  Emby: "所有支持 Emby 协议的服务端",
  Audiobookshelf: "Audiobookshelf 有声书服务（支持 /audiobookshelf 子路径）",
} as const;

// 数据源配置类型
export interface SourceConfig {
  id: string;
  internal: string;
  external: string;
  name?: string;
}

// 检查服务器连通性
export async function checkServerConnectivity(address: string, sourceType: string): Promise<boolean> {
  if (!address) return false;
  
  // 简单的URL验证
  if (!address.startsWith("http://") && !address.startsWith("https://")) {
    return false;
  }

  const mappedType = SOURCEMAP[sourceType as keyof typeof SOURCEMAP] || "audiodock";
  
  try {
    // Audiobookshelf 的 /api/authorize 未登录时返回 401，说明服务可达；
    // 部署可能在根路径或 /audiobookshelf 子路径，两个都试。
    if (mappedType === 'audiobookshelf') {
      const clean = address.replace(/\/+$/, '');
      for (const path of ['/api/authorize', '/audiobookshelf/api/authorize']) {
        try {
          const res = await Taro.request({
            url: `${clean}${path}`,
            method: 'GET',
            timeout: 3000,
          });
          if ((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 401) {
            return true;
          }
        } catch {
          // 试下一个候选路径
        }
      }
      return false;
    }

    // 根据数据源类型确定ping URL
    const pingUrl =
      mappedType === "subsonic"
        ? `${address.replace(/\/+$/, "")}/rest/ping.view?v=1.16.1&c=SoundX&f=json`
        : mappedType === "emby"
          ? `${address.replace(/\/+$/, "")}/emby/System/Info/Public`
        : `${address.replace(/\/+$/, "")}/hello`;

    const response = await Taro.request({
      url: pingUrl,
      method: "GET",
      timeout: 3000,
    });

    if (
      (response.statusCode >= 200 && response.statusCode < 300) ||
      (mappedType === "subsonic" && response.statusCode === 401)
    ) {
      return true;
    }
  } catch (error) {
    return false;
  }
  return false;
}

// 选择最佳服务器
export async function selectBestServer(
  internalAddress: string, 
  externalAddress: string, 
  sourceType: string
): Promise<string | null> {
  let networkType = "unknown";
  try {
    const networkInfo = await Taro.getNetworkType();
    networkType = networkInfo.networkType || "unknown";
  } catch (error) {
    networkType = "unknown";
  }

  const isWifi = networkType === "wifi";
  const isCellular = ["2g", "3g", "4g", "5g"].includes(networkType);

  console.log('Network State:', networkType, 'Is WiFi:', isWifi);
  console.log('Candidates:', { internalAddress, externalAddress });

  const candidates: string[] = [];
  if (internalAddress && externalAddress) {
    if (isWifi) {
      candidates.push(internalAddress, externalAddress);
    } else if (isCellular) {
      candidates.push(externalAddress);
    } else {
      candidates.push(internalAddress, externalAddress);
    }
  } else {
    if (internalAddress) candidates.push(internalAddress);
    if (externalAddress) candidates.push(externalAddress);
  }

  for (const candidate of candidates) {
    const alive = await checkServerConnectivity(candidate, sourceType);
    if (alive) return candidate;
  }

  return null;
}

// 引入图片资源，供 Taro 编译工具静态分析
import audiobookshelfLogo from '../assets/images/audiobookshelf.png';
import embyLogo from '../assets/images/emby.png';
import subsonicLogo from '../assets/images/subsonic.png';
import audiodockLogo from '../assets/images/logo.png';

// 获取数据源Logo
export function getSourceLogo(sourceType: string): string {
  switch (sourceType) {
    case "Emby":
      return embyLogo;
    case "Subsonic":
      return subsonicLogo;
    case "Audiobookshelf":
      return audiobookshelfLogo;
    default:
      return audiodockLogo;
  }
}
import Taro from "@tarojs/taro";
