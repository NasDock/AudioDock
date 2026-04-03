import type { User } from "../models";
import {
  type ScanLoginClaimPayload,
  type ScanLoginConfirmResult,
  SOURCEMAP,
} from "@soundx/services";
import { useAuthStore } from "../store/auth";

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
      return {
        type,
        configs: Array.isArray(parsed) ? parsed : [],
      };
    })
    .filter((bundle) => bundle.configs.length > 0);

  let deviceName = window.navigator.userAgent;
  try {
    if (window.ipcRenderer?.getName) {
      deviceName = await window.ipcRenderer.getName();
    }
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
    const merged = dedupeConfigs(Array.isArray(current) ? current : [], bundle.configs);
    localStorage.setItem(key, JSON.stringify(merged));
    mergeServerHistory(bundle.type, bundle.configs);
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
    localStorage.setItem(`serverAddress_${fallback.type}`, fallback.address);
    localStorage.setItem("serverAddress", fallback.address);
    useAuthStore.getState().switchServer(fallback.address);
  }
}
