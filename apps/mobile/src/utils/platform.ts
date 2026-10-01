import { Platform } from 'react-native';
import * as Device from 'expo-device';

/**
 * 平台判断统一封装
 *
 * 项目内禁止直接使用 `Platform.OS === 'xxx'`，一律通过本文件导出的
 * `isIOS` / `isAndroid` / `isWeb`，便于：
 *   1. 集中后续扩展（如 `isHarmony` / `isPad` 等）
 *   2. TypeScript 友好（避免到处写裸字符串）
 *   3. 后续如果引入 `expo-application` / `Device.osName` 可以一处替换
 */

export const isIOS = (): boolean => Platform.OS === 'ios';

export const isAndroid = (): boolean => Platform.OS === 'android';

export const isWeb = (): boolean => Platform.OS === 'web';

/**
 * 当前平台标识（用于版本检查 / 商店路由等业务分支判断）。
 *
 * 返回值与 React Native 的 `Platform.OS` 一致。
 */
export const getPlatform = (): 'ios' | 'android' | 'web' | (typeof Platform.OS extends string ? typeof Platform.OS : never) => {
  return Platform.OS;
};

/**
 * 是否原生环境（iOS / Android）。Web 端不算原生。
 */
export const isNative = (): boolean => isIOS() || isAndroid();

/**
 * 是否小米系设备（含红米）。
 *
 * 小米手机走「国内仓库 APK 直装」更新，其他 Android 品牌（OPPO/vivo/荣耀…）
 * 走应用商店跳转，所以版本检查 / 更新入口需要按品牌分流。
 */
export const isXiaomiDevice = (): boolean => {
  if (!isAndroid()) return false;
  const brand = (Device.brand || '').toLowerCase();
  const manufacturer = (Device.manufacturer || '').toLowerCase();
  return (
    brand.includes('xiaomi') ||
    brand.includes('redmi') ||
    manufacturer.includes('xiaomi') ||
    manufacturer.includes('redmi')
  );
};

/**
 * 设备平台（用于在线设备列表 / 播放流转）。
 * phone=手机，tablet=平板（含 iPad / Android 平板）
 */
export const getDevicePlatform = (): 'phone' | 'tablet' => {
  // expo-device 的 deviceType: PHONE=1, TABLET=2
  return Device.deviceType === Device.DeviceType.TABLET ? 'tablet' : 'phone';
};

const DEVICE_ID_KEY = '@audiodock_device_id';

/**
 * 获取稳定唯一设备标识（确定性）。
 *
 * deviceId 由设备固有信息推导：clientType + osName/osVersion + brand/manufacturer + model，
 * 同一台物理设备无论何时算出来都是同一个 ID，免疫 AsyncStorage 被清 / App 重装导致的漂移。
 * 算法与 desktop / harmony / web 端一致（@soundx/ws computeDeviceId），保证跨端去重有效。
 *
 * 结果仍会写入 AsyncStorage 做缓存（省去每次重算），但即使缓存丢失也能重新算出同一个值。
 */
export const getOrCreateDeviceId = async (): Promise<string> => {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  const { computeDeviceId } = await import('@soundx/ws');
  const id = computeDeviceId({
    clientType: getDevicePlatform(), // phone | tablet
    osName: Device.osName ?? Platform.OS,
    osVersion: Device.osVersion != null ? String(Device.osVersion) : '',
    brand: Device.brand ?? '',
    manufacturer: Device.manufacturer ?? '',
    model: Device.modelName ?? '',
  });
  // 缓存结果（非必须，丢失可重算出同一值）
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    // 忽略持久化失败
  }
  return id;
};

// 预留：未来如果支持 HarmonyOS React Native 包，可启用
// export const isHarmony = (): boolean => Platform.OS === 'harmony' || Platform.OS === 'openharmony';
