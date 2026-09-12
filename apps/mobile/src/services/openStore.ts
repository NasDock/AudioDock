import { ANDROID_STORES, IOS_STORE } from '../constants/store';
import * as Device from 'expo-device';
import { getPlatform, isIOS, isNative } from '../utils/platform';
import { openExternalURL } from '../utils/openURL';

/**
 * Android 国内分发渠道
 *
 * ⚠️ 自 2026-09 起 mobile 端版本更新统一走 APK 直装（SystemDownloadManager），
 * 本文件中的 getCurrentStoreUrl / openStoreByPlatform 已不再被 useCheckUpdate 调用。
 * 保留它们仅作兜底/调试用途（openStoreDebug 仍可用，且依赖本文件内的常量）。
 *
 * 按设备品牌路由到对应应用商店（各品牌跳自家的市场）：
 *   荣耀 → 荣耀应用市场
 *   OPPO（含 realme/一加）→ OPPO 软件商店
 *   vivo（含 iQOO）→ vivo 应用商店
 *   华为 → 华为 AppGallery
 *   其他品牌 → 兜底按 ANDROID_STORE_ORDER 顺序取第一家（当前为华为）
 *
 * 注意：
 *   - 上架哪家就填哪家的真实 URL；未上架的渠道保持 PLACEHOLDER。
 */
export const ANDROID_STORE_ORDER = ['huawei', 'oppo', 'vivo', 'honor'] as const;
export type AndroidStoreKey = (typeof ANDROID_STORE_ORDER)[number];

/**
 * 根据设备品牌返回对应商店 key（Android 专用）。
 *
 * 通过 expo-device 读 brand / manufacturer，按国内主流品牌映射。
 * 未识别品牌 → 返回 ANDROID_STORE_ORDER[0]（华为）作为兜底。
 */
export const getAndroidStoreKey = (): AndroidStoreKey => {
  const brand = (Device.brand || '').toLowerCase();
  const manufacturer = (Device.manufacturer || '').toLowerCase();
  const combined = `${brand} ${manufacturer}`;

  if (combined.includes('honor')) return 'honor';
  if (combined.includes('oppo') || combined.includes('realme') || combined.includes('oneplus')) {
    return 'oppo';
  }
  if (combined.includes('vivo') || combined.includes('iqoo')) return 'vivo';
  if (combined.includes('huawei')) return 'huawei';

  return ANDROID_STORE_ORDER[0];
};

/** Android 当前渠道探测返回结果 */
export interface AndroidStoreProbeResult {
  /** 命中的渠道 key（按设备品牌映射） */
  key: AndroidStoreKey;
  /** 命中渠道对应的商店 URL */
  url: string | null;
}

/**
 * 探测 Android 当前可用的应用商店渠道
 *
 * 策略：按设备品牌（荣耀/OPPO/vivo/华为）映射到对应商店 URL；
 * 未识别品牌取优先级第一家的 URL。
 */
export const probeAndroidStore = (): AndroidStoreProbeResult => {
  const key = getAndroidStoreKey();
  return {
    key,
    url: ANDROID_STORES[key],
  };
};

/**
 * 获取当前平台对应的商店 URL
 *
 * - iOS → iOS App Store
 * - Android → 按设备品牌映射的国内分发渠道（荣耀/OPPO/vivo/华为；小米不走这里）
 * - Web / 其他 → null
 */
export const getCurrentStoreUrl = (): string | null => {
  if (!isNative()) return null;
  if (isIOS()) return IOS_STORE.appStoreUrl;

  const androidProbe = probeAndroidStore();
  return androidProbe.url;
};

/** 调试用：当前平台与匹配到的渠道 */
export const describeStoreTarget = (): string => {
  const platform = getPlatform();
  if (isIOS()) return `${platform} → iOS App Store`;
  if (platform === 'android') {
    const probe = probeAndroidStore();
    return `${platform} → Android (${probe.key ?? 'unknown'})`;
  }
  return `${platform} → no store configured`;
};

/**
 * 打开当前平台对应的应用商店
 *
 * @returns 是否成功触发（true=已打开/fallback，false=完全失败）
 */
export const openStoreByPlatform = async (): Promise<boolean> => {
  const url = getCurrentStoreUrl();
  if (!url) {
    console.warn('[openStore] no store url for current platform:', getPlatform());
    return false;
  }
  return openExternalURL(url);
};

/* ---------- 调试专用入口（我的页测试按钮） ---------- */

/** Android 包名（与 android/app/build.gradle#applicationId 一致） */
export const ANDROID_PACKAGE_NAME = 'com.audiodock.app';
/** iOS App Store 应用详情页 URL（与 constants/store.ts#IOS_STORE.appStoreUrl 一致） */
export const IOS_APP_STORE_URL = 'https://apps.apple.com/cn/app/audiodock/id6761128589';

/**
 * 调试专用：按平台跳转到"对应的"应用商店
 *
 * 方案对比（与 openStoreByPlatform 的区别）：
 *   - openStoreByPlatform: 走各家硬编码的 https URL（store.ts）。每上架/换 URL 都要发版。
 *   - openStoreDebug:      Android 走系统级 market:// 协议，**无需任何商店 URL**，
 *                          系统自动路由到已装商店（华为/小米/OPPO/vivo/...）。
 *                          上架新渠道零改动。详见 https://levent-j.com/2020/09/18/android-start-app-market/
 *
 * 行为：
 *   - Android: Linking.openURL('market://details?id=com.audiodock.app')
 *   - iOS:     Linking.openURL('https://apps.apple.com/cn/app/audiodock/id6761128589')
 *   - Web:     noop + console.warn
 *
 * @returns 是否成功触发（true=已打开/fallback，false=完全失败）
 */
export const openStoreDebug = async (): Promise<boolean> => {
  if (!isNative()) {
    console.warn('[openStoreDebug] web 端不支持跳转应用商店');
    return false;
  }

  const url = isIOS()
    ? IOS_APP_STORE_URL
    : `market://details?id=${ANDROID_PACKAGE_NAME}`;

  console.log('[openStoreDebug] jump to:', url);
  return openExternalURL(url);
};
