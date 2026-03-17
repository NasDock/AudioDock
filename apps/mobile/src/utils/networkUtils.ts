import { SOURCEMAP } from "@soundx/services";
import * as Network from 'expo-network';

export async function checkServerConnectivity(address: string, sourceType: string): Promise<boolean> {
  if (!address) return false;
  
  // Simple URL validation
  if (!address.startsWith("http://") && !address.startsWith("https://")) {
    return false;
  }

  const mappedType = SOURCEMAP[sourceType as keyof typeof SOURCEMAP] || "audiodock";
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    // Determine the ping URL based on source type
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

export async function selectBestServer(
  internalAddress: string, 
  externalAddress: string, 
  sourceType: string
): Promise<string | null> {
  const networkState = await Network.getNetworkStateAsync();
  const isWifi = networkState.type === Network.NetworkStateType.WIFI;

  console.log('Network State:', networkState.type, 'Is WiFi:', isWifi);
  console.log('Candidates:', { internalAddress, externalAddress });

  // Priority Logic
  if (isWifi) {
    // 1. Try Internal
    if (internalAddress) {
      const internalAlive = await checkServerConnectivity(internalAddress, sourceType);
      if (internalAlive) return internalAddress;
    }
    // 2. Try External
    if (externalAddress) {
      const externalAlive = await checkServerConnectivity(externalAddress, sourceType);
      if (externalAlive) return externalAddress;
    }
  } else {
    // Cellular / Other: Only try External
    if (externalAddress) {
      const externalAlive = await checkServerConnectivity(externalAddress, sourceType);
      if (externalAlive) return externalAddress;
    }
  }

  return null;
}
