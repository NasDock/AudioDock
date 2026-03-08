// 数据源类型映射
export const SOURCEMAP = {
  AudioDock: "audiodock",
  Subsonic: "subsonic",
  Emby: "emby",
} as const;

// 数据源提示信息
export const SOURCETIPSMAP = {
  AudioDock: "所有支持 AudioDock 官方服务端",
  Subsonic: "所有支持 Subsonic 协议的服务端，例如：Navidrome、Gonic 等",
  Emby: "所有支持 Emby 协议的服务端",
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

// 获取数据源Logo
export function getSourceLogo(sourceType: string): string {
  switch (sourceType) {
    case "Emby":
      return "/assets/images/emby.png";
    case "Subsonic":
      return "/assets/images/subsonic.png";
    default:
      return "/assets/images/logo.png";
  }
}
import Taro from "@tarojs/taro";
