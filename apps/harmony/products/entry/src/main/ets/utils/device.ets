import deviceInfo from '@ohos.deviceInfo';
import { kvStore } from 'features_storage';

/**
 * 设备平台（用于在线设备列表 / 播放流转）。
 * 复用 @ohos.deviceInfo 的 deviceType：phone / tablet / tv / watch / 2in1 等。
 */
export function getDevicePlatform(): string {
  try {
    const type: string = String(deviceInfo.deviceType ?? '');
    const t = type.toLowerCase();
    if (t === 'tablet') return 'tablet';
    if (t === 'tv') return 'tv';
    if (t === 'watch' || t === 'wearable') return 'watch';
    // phone / 2in1 / 其他统一归为 phone（手机）
    return 'phone';
  } catch {
    return 'phone';
  }
}

const DEVICE_ID_KEY = 'audiodock_device_id';

function genUuid(): string {
  // ArkTS 无内置 uuid 包时用时间戳 + 随机串兜底
  return `harmony_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * 获取稳定唯一设备标识。首次调用生成并持久化到 kvStore。
 */
export async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await kvStore.get(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = genUuid();
    await kvStore.set(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // kvStore 不可用时退化为内存态（同一进程内有效）
    return genUuid();
  }
}
