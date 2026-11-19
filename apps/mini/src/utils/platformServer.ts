import Taro from '@tarojs/taro';
import { setPlatformConfig, type PlatformConfig } from '@soundx/services';
import { SOURCEMAP } from './sourceUtils';

/**
 * AudioDock 平台服务（设备列表 / 播放流转所依赖的服务端账号体系）。
 *
 * 设备注册、JWT 鉴权都在 AudioDock 服务端；切到第三方音乐源（Subsonic/Emby）后，
 * 当前地址/token 都是第三方服务的，设备功能会失去依托。
 *
 * mini 的登录态是单槽存储（token/user 随切源覆盖），所以在 AudioDock 源登录成功时
 * 额外把地址/token/userId 抄一份到 platform_* 键（见 AuthContext.login/register），
 * 第三方源下用这份快照恢复设备能力。JWT 100 年有效，重新登录 AudioDock 源即刷新。
 */

const PLATFORM_ADDRESS_KEY = 'platform_audiodock_address';
const PLATFORM_TOKEN_KEY = 'platform_audiodock_token';
const PLATFORM_USER_ID_KEY = 'platform_audiodock_user_id';

const isNativeSource = (): boolean => {
  const type = Taro.getStorageSync('currentSourceType') || 'AudioDock';
  const mapped = SOURCEMAP[type as keyof typeof SOURCEMAP] || 'audiodock';
  return mapped === 'audiodock';
};

/** AudioDock 源登录成功后调用：把当前会话快照为平台服务配置 */
export const capturePlatformSession = (
  address: string,
  token: string,
  userId?: string | number,
) => {
  try {
    if (!address || !token) return;
    Taro.setStorageSync(PLATFORM_ADDRESS_KEY, address);
    Taro.setStorageSync(PLATFORM_TOKEN_KEY, token);
    if (userId !== undefined && userId !== null && String(userId) !== 'undefined') {
      Taro.setStorageSync(PLATFORM_USER_ID_KEY, String(userId));
    }
  } catch {
    /* 存储失败不影响登录主流程 */
  }
};

/** 解析当前应使用的平台服务配置；无可用配置（从未登录过 AudioDock 源）时返回 null */
export const resolvePlatformConfig = (): PlatformConfig | null => {
  try {
    if (isNativeSource()) {
      const address = Taro.getStorageSync('serverAddress') || '';
      const token = Taro.getStorageSync('token') || '';
      if (!address || !token) return null;
      let userId: string | undefined;
      const userStr = Taro.getStorageSync('user');
      if (userStr) {
        try {
          const parsed = JSON.parse(userStr);
          const id = parsed?.id ?? parsed?.user?.id;
          if (id !== undefined && id !== null && String(id) !== 'undefined') {
            userId = String(id);
          }
        } catch {
          /* userId 可选 */
        }
      }
      return { baseUrl: address, token, userId };
    }
    const address = Taro.getStorageSync(PLATFORM_ADDRESS_KEY) || '';
    const token = Taro.getStorageSync(PLATFORM_TOKEN_KEY) || '';
    if (!address || !token) return null;
    const userId = Taro.getStorageSync(PLATFORM_USER_ID_KEY) || undefined;
    return { baseUrl: address, token, userId };
  } catch {
    return null;
  }
};

/** 把平台服务配置同步进 @soundx/services（幂等，启动 / 切源 / 登录后都可调用） */
export const syncPlatformConfig = (): PlatformConfig | null => {
  const config = resolvePlatformConfig();
  setPlatformConfig(config);
  return config;
};
