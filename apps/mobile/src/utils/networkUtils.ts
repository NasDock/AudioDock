import { SOURCEMAP } from "@soundx/services";
import * as Network from 'expo-network';
import {
  getMappedSourceType,
  isFnosRelayAddress,
  normalizeFnosAddress,
} from "../constants/sources";

export async function checkServerConnectivity(address: string, sourceType: string): Promise<boolean> {
  if (!address) return false;

  const mappedType = SOURCEMAP[sourceType as keyof typeof SOURCEMAP] || "audiodock";

  // 飞牛地址先归一化（补协议 / 默认端口 5666 / 去 /music 尾巴），
  // 保证「探测地址」和「适配器实际请求地址」一致
  const target = mappedType === "fnos" ? normalizeFnosAddress(address) : address;

  // Simple URL validation
  if (!target.startsWith("http://") && !target.startsWith("https://")) {
    return false;
  }

  const headers: Record<string, string> = {};
  if (mappedType === "fnos" && isFnosRelayAddress(target)) {
    // FN Connect 中继（*.fnos.net / *.5ddd.com）不带 `Cookie: mode=relay`
    // 会被网关 302 到 FN Connect 登录页，探测必然失败。
    headers.Cookie = "mode=relay";
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    // Determine the ping URL based on source type
    const pingUrl =
      mappedType === "subsonic"
        ? `${target.replace(/\/+$/, "")}/rest/ping.view?v=1.16.1&c=SoundX&f=json`
        : mappedType === "emby"
          ? `${target.replace(/\/+$/, "")}/emby/System/Info/Public`
          : mappedType === "fnos"
            ? `${target.replace(/\/+$/, "")}/music/api/v1/sys/config`
            : `${target.replace(/\/+$/, "")}/hello`;

    const response = await fetch(pingUrl, {
      signal: controller.signal,
      headers,
      // 必须 omit：RN 的 XHR 默认 withCredentials=true，
      // Android 侧 OkHttp 会用平台 cookie jar 里的 cookie **覆盖**我们手动设的
      // `Cookie: mode=relay`（jar 非空时 BridgeInterceptor 直接 header() 覆盖），
      // 覆盖后中继又变成 302 → 登录页。omit 会让 RN 用 CookieJar.NO_COOKIES，
      // 手动设的头原样发出。
      credentials: "omit",
    });
    clearTimeout(timeoutId);

    if (
      response.ok ||
      (mappedType === "subsonic" && response.status === 401)
    ) {
      // 飞牛的 /sys/config 免登录，但中继未放行时会 302 到 SPA 登录页
      // （fetch 默认跟随重定向 → 200 + HTML），只判状态码会误判成「连上了」。
      // 这里再确认一次响应体是飞牛的 JSON 信封。
      if (mappedType === "fnos") {
        // RN 的 Response.redirected 恒为 false，只能看最终 URL 是不是登录页
        const finalUrl = response.url || "";
        if (finalUrl && finalUrl !== pingUrl && /login|signin/i.test(finalUrl)) {
          return false;
        }
        try {
          const payload = (await response.json()) as { code?: number } | null;
          return payload?.code === 0;
        } catch {
          return false;
        }
      }
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

  const mappedType = getMappedSourceType(sourceType);
  // 飞牛地址先归一化再探测，返回值也是归一化后的地址（存下来就是适配器要用的地址）
  const internal = mappedType === "fnos" ? normalizeFnosAddress(internalAddress) : internalAddress;
  const external = mappedType === "fnos" ? normalizeFnosAddress(externalAddress) : externalAddress;

  console.log('Network State:', networkState.type, 'Is WiFi:', isWifi);
  console.log('Candidates:', { internalAddress: internal, externalAddress: external });

  // Priority Logic
  if (isWifi) {
    // 1. Try Internal
    if (internal) {
      const internalAlive = await checkServerConnectivity(internal, sourceType);
      if (internalAlive) return internal;
    }
    // 2. Try External
    if (external) {
      const externalAlive = await checkServerConnectivity(external, sourceType);
      if (externalAlive) return external;
    }
  } else {
    // Cellular / Other: Only try External
    if (external) {
      const externalAlive = await checkServerConnectivity(external, sourceType);
      if (externalAlive) return external;
    }
  }

  return null;
}
