import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  setPlatformConfig,
  SOURCEMAP,
  type PlatformConfig,
} from "@soundx/services";
import { getBaseURL } from "../https";

/**
 * AudioDock 平台服务（设备列表 / 播放流转所依赖的服务端账号体系）。
 *
 * 设备注册、JWT 鉴权、WS 都在 AudioDock 服务端；切到第三方音乐源（飞牛等）后，
 * 当前地址/token 都是第三方服务的，设备功能会失去依托。
 * 这里复用「最近一次 AudioDock 源登录成功」的地址 + token（登录/切源时按
 * `serverAddress_AudioDock` + `token_<addr>` 持久化，JWT 100 年有效），
 * 让第三方源下设备列表 / 播放流转 / WS 注册继续工作。
 */

const isNativeSource = async (): Promise<boolean> => {
  const type =
    (await AsyncStorage.getItem("selectedSourceType")) || "AudioDock";
  const mapped = SOURCEMAP[type as keyof typeof SOURCEMAP] || "audiodock";
  return mapped === "audiodock";
};

/** 解析当前应使用的平台服务配置；无可用配置（从未登录过 AudioDock 源）时返回 null */
export const resolvePlatformConfig =
  async (): Promise<PlatformConfig | null> => {
    try {
      const currentAddress = getBaseURL();
      const address = (await isNativeSource())
        ? currentAddress
        : (await AsyncStorage.getItem("serverAddress_AudioDock")) || "";
      if (!address) return null;
      const token = await AsyncStorage.getItem(`token_${address}`);
      if (!token) return null;
      let userId: string | undefined;
      const userStr = await AsyncStorage.getItem(`user_${address}`);
      if (userStr) {
        try {
          const parsed = JSON.parse(userStr);
          const id = parsed?.id ?? parsed?.user?.id;
          if (id !== undefined && id !== null && String(id) !== "undefined") {
            userId = String(id);
          }
        } catch {
          /* userId 可选，WS 注册主要靠 JWT */
        }
      }
      return { baseUrl: address, token, userId };
    } catch {
      return null;
    }
  };

/** 第三方音乐源下，WS / 设备接口是否应走平台服务（而非当前音乐源地址） */
export const shouldUsePlatformServer = async (): Promise<boolean> =>
  !(await isNativeSource());

/** 把平台服务配置同步进 @soundx/services（幂等，启动 / 切源 / 登录后都可调用） */
export const syncPlatformConfig = async (): Promise<PlatformConfig | null> => {
  const config = await resolvePlatformConfig();
  setPlatformConfig(config);
  return config;
};
