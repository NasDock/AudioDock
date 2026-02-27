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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    // 根据数据源类型确定ping URL
    const pingUrl =
      mappedType === "subsonic"
        ? `${address.replace(/\/+$/, "")}/rest/ping.view?v=1.16.1&c=SoundX&f=json`
        : mappedType === "emby"
          ? `${address.replace(/\/+$/, "")}/emby/System/Info/Public`
        : `${address.replace(/\/+$/, "")}/hello`;

    const response = await fetch(pingUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (
      response.ok ||
      (mappedType === "subsonic" && response.status === 401)
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
  // 小程序中获取网络类型
  const networkInfo = await wx.getNetworkType();
  const isWifi = networkInfo.networkType === 'wifi';

  console.log('Network State:', networkInfo.networkType, 'Is WiFi:', isWifi);
  console.log('Candidates:', { internalAddress, externalAddress });

  // 优先级逻辑
  if (isWifi) {
    // 1. 先尝试内网
    if (internalAddress) {
      const internalAlive = await checkServerConnectivity(internalAddress, sourceType);
      if (internalAlive) return internalAddress;
    }
    // 2. 再尝试外网
    if (externalAddress) {
      const externalAlive = await checkServerConnectivity(externalAddress, sourceType);
      if (externalAlive) return externalAddress;
    }
  } else {
    // 移动网络/其他：只尝试外网
    if (externalAddress) {
      const externalAlive = await checkServerConnectivity(externalAddress, sourceType);
      if (externalAlive) return externalAddress;
    }
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