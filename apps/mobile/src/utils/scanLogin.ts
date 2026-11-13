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

// 服务端要求 sourceBundles 的 internal/external 均非空（否则整个 claim 被 400 拒绝），
// 单地址配置用另一侧地址互补回填，双侧皆空的配置丢弃
const sanitizeConfigs = (
  configs: Array<{ id: string; internal: string; external: string; name?: string }>,
) =>
  configs
    .map((config) => ({
      ...config,
      internal: config.internal || config.external || "",
      external: config.external || config.internal || "",
    }))
    .filter((config) => config.internal && config.external);

// 读取某数据源配置在本机的登录凭据（登录时按 `creds_${type}_${address}` 落盘，
// 内/外网地址各试一次），第三方源（Subsonic/Emby/飞牛）没有 token，扫码迁移必须带上
const loadConfigCreds = async (
  type: string,
  config: { internal: string; external: string },
): Promise<{ username?: string; password?: string }> => {
  for (const address of [config.internal, config.external]) {
    if (!address) continue;
    const raw = await AsyncStorage.getItem(`creds_${type}_${address}`);
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

/**
 * 收集扫码登录 payload。
 * @param onlyType 只同步指定数据源（从具体数据源登录页进入扫码时传入）；
 *                 不传则同步全部数据源（个人中心入口）。
 */
export async function collectMobileScanLoginPayload(
  onlyType?: string,
): Promise<ScanLoginClaimPayload> {
  const savedAddress = (await AsyncStorage.getItem("serverAddress")) || "";
  const sourceType = (await AsyncStorage.getItem("selectedSourceType")) || "AudioDock";
  const token = savedAddress ? await AsyncStorage.getItem(`token_${savedAddress}`) : null;
  const user = savedAddress ? await AsyncStorage.getItem(`user_${savedAddress}`) : null;
  const device = savedAddress ? await AsyncStorage.getItem(`device_${savedAddress}`) : null;
  const plusToken = await AsyncStorage.getItem("plus_token");
  const plusUserId = await AsyncStorage.getItem("plus_user_id");

  const types = onlyType ? [onlyType] : Object.keys(SOURCEMAP);
  const sourceBundles = await Promise.all(
    types.map(async (type) => {
      const raw = await AsyncStorage.getItem(`sourceConfig_${type}`);
      const parsed = raw ? JSON.parse(raw) : [];
      const configs = sanitizeConfigs(Array.isArray(parsed) ? parsed : []);
      return {
        type,
        configs: await Promise.all(
          configs.map(async (config) => ({
            ...config,
            ...(await loadConfigCreds(type, config)),
          })),
        ),
      };
    }),
  );

  const nativeAuth =
    token && user && savedAddress
      ? {
          baseUrl: savedAddress,
          sourceType,
          token,
          user: JSON.parse(user),
          device: device ? JSON.parse(device) : undefined,
        }
      : null;

  return {
    deviceName: Device.modelName || "Mobile Device",
    // 单源同步时，若当前登录态不属于该数据源则不下发，
    // 避免目标端被切到无关的 AudioDock 服务器
    nativeAuth: !onlyType || nativeAuth?.sourceType === onlyType ? nativeAuth : null,
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
    // 凭据不进 sourceConfig 存储（单独走 creds_ key），先剥离再合并
    const configsWithoutCreds = bundle.configs.map(({ username, password, ...rest }) => rest);
    const merged = dedupeConfigs(Array.isArray(current) ? current : [], configsWithoutCreds);
    await AsyncStorage.setItem(key, JSON.stringify(merged));

    // 随配置同步过来的第三方源凭据按 `creds_${type}_${address}` 落盘（内/外网地址各存一份），
    // 与登录页 handleSubmit 的存储约定一致，目标端免密直接可用
    for (const config of bundle.configs) {
      if (!config.username) continue;
      const creds = JSON.stringify({ username: config.username, password: config.password || "" });
      for (const address of [config.internal, config.external]) {
        if (address) {
          await AsyncStorage.setItem(`creds_${bundle.type}_${address}`, creds);
        }
      }
    }
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
