import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import {
  type ScanLoginClaimPayload,
  type ScanLoginConfirmResult,
  SOURCEMAP,
} from "@soundx/services";
import { setBaseURL } from "../https";

type SwitchServerFn = (url: string, type?: string, skipToken?: boolean) => Promise<void>;
type SetPlusTokenFn = (token: string | null) => Promise<void>;

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

export async function collectMobileScanLoginPayload(): Promise<ScanLoginClaimPayload> {
  const savedAddress = (await AsyncStorage.getItem("serverAddress")) || "";
  const sourceType = (await AsyncStorage.getItem("selectedSourceType")) || "AudioDock";
  const token = savedAddress ? await AsyncStorage.getItem(`token_${savedAddress}`) : null;
  const user = savedAddress ? await AsyncStorage.getItem(`user_${savedAddress}`) : null;
  const device = savedAddress ? await AsyncStorage.getItem(`device_${savedAddress}`) : null;
  const plusToken = await AsyncStorage.getItem("plus_token");
  const plusUserId = await AsyncStorage.getItem("plus_user_id");

  const sourceBundles = await Promise.all(
    Object.keys(SOURCEMAP).map(async (type) => {
      const raw = await AsyncStorage.getItem(`sourceConfig_${type}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return {
        type,
        configs: Array.isArray(parsed) ? parsed : [],
      };
    }),
  );

  return {
    deviceName: Device.modelName || "Mobile Device",
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
    sourceBundles: sourceBundles.filter((bundle) => bundle.configs.length > 0),
  };
}

export async function applyMobileScanLoginResult(
  result: ScanLoginConfirmResult,
  deps: {
    switchServer: SwitchServerFn;
    setPlusToken: SetPlusTokenFn;
  },
) {
  for (const bundle of result.sourceBundles) {
    const key = `sourceConfig_${bundle.type}`;
    const raw = await AsyncStorage.getItem(key);
    const current = raw ? JSON.parse(raw) : [];
    const merged = dedupeConfigs(Array.isArray(current) ? current : [], bundle.configs);
    await AsyncStorage.setItem(key, JSON.stringify(merged));
  }

  if (result.plusAuth) {
    await AsyncStorage.setItem("plus_token", result.plusAuth.token);
    await AsyncStorage.setItem("plus_user_id", JSON.stringify(result.plusAuth.userId));
    await deps.setPlusToken(result.plusAuth.token);
  }

  if (result.nativeAuth) {
    const { baseUrl, sourceType, token, user, device } = result.nativeAuth;
    setBaseURL(baseUrl);
    await AsyncStorage.setItem("serverAddress", baseUrl);
    await AsyncStorage.setItem(`serverAddress_${sourceType}`, baseUrl);
    await AsyncStorage.setItem("selectedSourceType", sourceType);
    await AsyncStorage.setItem(`token_${baseUrl}`, token);
    await AsyncStorage.setItem(`user_${baseUrl}`, JSON.stringify(user));
    if (device) {
      await AsyncStorage.setItem(`device_${baseUrl}`, JSON.stringify(device));
    }
    await deps.switchServer(baseUrl, sourceType);
    return;
  }

  const fallback = getFirstSourceSelection(result.sourceBundles);
  if (fallback) {
    setBaseURL(fallback.address);
    await AsyncStorage.setItem("serverAddress", fallback.address);
    await AsyncStorage.setItem(`serverAddress_${fallback.type}`, fallback.address);
    await AsyncStorage.setItem("selectedSourceType", fallback.type);
    await deps.switchServer(fallback.address, fallback.type);
  }
}
