import type { User } from "../models";
import {
  type ScanLoginClaimPayload,
  type ScanLoginConfirmResult,
  SOURCEMAP,
} from "@soundx/services";
import { useAuthStore } from "../store/auth";
import { enforceSourcePlayMode } from "./playMode";
import { tauriGetDeviceName } from "./platform";

export const getFirstSourceSelection = (
  bundles: { type: string; configs: { internal: string; external: string }[] }[],
) => {
  for (const bundle of bundles) {
    for (const config of bundle.configs) {
      const address = config.internal || config.external;
      if (address) {
        return { type: bundle.type, address };
      }
    }
  }
  return null;
};

const dedupeConfigs = (
  current: Array<{ id: string; internal: string; external: string; name?: string }>,
  incoming: Array<{ id: string; internal: string; external: string; name?: string }>,
) => {
  const map = new Map<string, { id: string; internal: string; external: string; name?: string }>();

  [...current, ...incoming].forEach((item) => {
    const key = `${item.internal || ""}__${item.external || ""}`;
    map.set(key, item);
  });

  return Array.from(map.values());
};

const mergeServerHistory = (type: string, configs: Array<{ internal: string; external: string }>) => {
  const key = `serverHistory_${type}`;
  const raw = localStorage.getItem(key);
  const current = raw ? JSON.parse(raw) : [];
  const map = new Map<string, { value: string }>();

  (Array.isArray(current) ? current : []).forEach((item) => {
    if (item?.value) {
      map.set(item.value, { value: item.value });
    }
  });

  configs.forEach((config) => {
    [config.internal, config.external].forEach((address) => {
      if (address) {
        map.set(address, { value: address });
      }
    });
  });

  localStorage.setItem(key, JSON.stringify(Array.from(map.values())));
};

// 第三方源（Subsonic/Emby/飞牛）没有 nativeAuth token，扫码迁移必须随配置携带凭据
const loadConfigCreds = (
  type: string,
  config: { internal: string; external: string },
): { username?: string; password?: string } => {
  for (const address of [config.internal, config.external]) {
    if (!address) continue;
    const raw = localStorage.getItem(`creds_${type}_${address}`);
    if (!raw) continue;
    try {
      const creds = JSON.parse(raw);
      if (creds?.username) {
        return { username: creds.username, password: creds.password };
      }
    } catch {
      // 忽略坏数据，继续尝试下一个地址
    }
  }
  return {};
};

export async function collectDesktopScanLoginPayload(): Promise<ScanLoginClaimPayload> {
  const savedAddress = localStorage.getItem("serverAddress") || "";
  const sourceType = localStorage.getItem("selectedSourceType") || "AudioDock";
  const token = savedAddress ? localStorage.getItem(`token_${savedAddress}`) : null;
  const user = savedAddress ? localStorage.getItem(`user_${savedAddress}`) : null;
  const device = savedAddress ? localStorage.getItem(`device_${savedAddress}`) : null;
  const plusToken = localStorage.getItem("plus_token");
  const plusUserId = localStorage.getItem("plus_user_id");

  const sourceBundles = Object.keys(SOURCEMAP)
    .map((type) => {
      const raw = localStorage.getItem(`sourceConfig_${type}`);
      const parsed = raw ? JSON.parse(raw) : [];
      const configs: Array<{ id: string; internal: string; external: string; name?: string }> =
        Array.isArray(parsed) ? parsed : [];
      return {
        type,
        configs: configs.map((config) => ({
          ...config,
          ...loadConfigCreds(type, config),
        })),
      };
    })
    .filter((bundle) => bundle.configs.length > 0);

  let deviceName = window.navigator.userAgent;
  try {
    deviceName = await tauriGetDeviceName();
  } catch (error) {
    console.error("Failed to resolve desktop device name", error);
  }

  return {
    deviceName,
    nativeAuth:
      token && user && savedAddress
        ? {
            baseUrl: savedAddress,
            sourceType,
            token,
            user: JSON.parse(user),
            device: device ? JSON.parse(device) : undefined,
          }
        : null,
    plusAuth:
      plusToken && plusUserId
        ? {
            token: plusToken,
            userId: JSON.parse(plusUserId),
          }
        : null,
    sourceBundles,
  };
}

export async function applyDesktopScanLoginResult(result: ScanLoginConfirmResult) {
  result.sourceBundles.forEach((bundle) => {
    const key = `sourceConfig_${bundle.type}`;
    const raw = localStorage.getItem(key);
    const current = raw ? JSON.parse(raw) : [];
    // 凭据不进 sourceConfig 存储（单独走 creds_ key），先剥离再合并
    const configsWithoutCreds = bundle.configs.map(({ username, password, ...rest }) => rest);
    const merged = dedupeConfigs(Array.isArray(current) ? current : [], configsWithoutCreds);
    localStorage.setItem(key, JSON.stringify(merged));
    mergeServerHistory(bundle.type, configsWithoutCreds);

    // 随配置同步过来的第三方源凭据按 `creds_${type}_${address}` 落盘（内/外网地址各存一份），
    // 与登录页/LoginModal 的存储约定一致，目标端免密直接可用
    bundle.configs.forEach((config) => {
      if (!config.username) return;
      const creds = JSON.stringify({ username: config.username, password: config.password || "" });
      [config.internal, config.external].forEach((address) => {
        if (address) {
          localStorage.setItem(`creds_${bundle.type}_${address}`, creds);
        }
      });
    });
  });

  if (result.plusAuth) {
    localStorage.setItem("plus_token", result.plusAuth.token);
    localStorage.setItem("plus_user_id", JSON.stringify(result.plusAuth.userId));
    useAuthStore.getState().setPlusToken(result.plusAuth.token);
  }

  if (result.nativeAuth) {
    const { baseUrl, sourceType, token, user, device } = result.nativeAuth;
    localStorage.setItem("serverAddress", baseUrl);
    localStorage.setItem(`serverAddress_${sourceType}`, baseUrl);
    localStorage.setItem("selectedSourceType", sourceType);
    enforceSourcePlayMode(sourceType);
    localStorage.setItem(`token_${baseUrl}`, token);
    localStorage.setItem(`user_${baseUrl}`, JSON.stringify(user));
    if (device) {
      localStorage.setItem(`device_${baseUrl}`, JSON.stringify(device));
    }
    useAuthStore.getState().switchServer(baseUrl);
    useAuthStore.getState().login(token, user as User, device);
    return;
  }

  const fallback = getFirstSourceSelection(result.sourceBundles);
  if (fallback) {
    localStorage.setItem("selectedSourceType", fallback.type);
    enforceSourcePlayMode(fallback.type);
    localStorage.setItem(`serverAddress_${fallback.type}`, fallback.address);
    localStorage.setItem("serverAddress", fallback.address);
    useAuthStore.getState().switchServer(fallback.address);
  }
}
