import deviceInfo from '@ohos.deviceInfo';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { buffer } from '@kit.ArkTS';
import { kvStore } from 'features_storage';

/**
 * 当前数据源的稳定标识（用于本地缓存按源隔离）。
 *
 * 背景：hm 音频缓存只按 track_id 存（{trackId}.{ext}），多数据源下 track_id 撞车会
 * 串歌（A 源缓存的歌，切到 B 源同 track_id 被误命中）。把 serverAddress 归一化后
 * 哈希成 sourceKey，缓存文件按源隔离，不同源互不命中。
 *
 * 从 kvStore 读 serverAddress（authStore 已写入），归一化后 FNV-1a 哈希。
 * 与 desktop/mobile 的 getSourceKey 算法一致（FNV-1a 32bit → base36）。
 */
export async function getSourceKey(): Promise<string> {
  let raw = '';
  try {
    raw = (await kvStore.get('serverAddress')) ?? '';
  } catch {
    raw = '';
  }
  const normalized = raw.trim().toLowerCase().replace(/\/+$/, '');
  if (normalized === '') return 'default';
  // FNV-1a 32bit
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 转无符号后 base36
  return (h >>> 0).toString(36);
}

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

/**
 * 归一化字段：去首尾空白、转小写、折叠连续空白。
 * 与 @soundx/ws 的 norm 完全一致（全端跨端去重的前提）。
 */
function norm(v: string | undefined): string {
  if (!v) return '';
  return v.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 组装设备指纹串。字段顺序与分隔符（SOH）必须和 @soundx/ws buildFingerprintString 完全一致：
 *   clientType ␟ osName ␟ osVersion ␟ brand ␟ manufacturer ␟ model ␟ deviceName
 */
function buildFingerprintString(): string {
  const SEP = '';
  const fields: string[] = [
    norm(getDevicePlatform()),          // clientType: phone / tablet / tv / watch
    norm('HarmonyOS'),                  // osName
    norm(String(deviceInfo.osFullName ?? deviceInfo.displayVersion ?? '')), // osVersion
    norm(String(deviceInfo.brand ?? '')),        // brand
    norm(String(deviceInfo.manufacture ?? '')),  // manufacturer
    norm(String(deviceInfo.productModel ?? deviceInfo.marketName ?? '')), // model
    norm(String(deviceInfo.marketName ?? '')),   // deviceName（用户可见名）
  ];
  return fields.join(SEP);
}

/** DataBlob(Uint8Array) → 小写 hex 字符串 */
function toHex(data: Uint8Array): string {
  const HEXC = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    out += HEXC.charAt((b >> 4) & 0x0f) + HEXC.charAt(b & 0x0f);
  }
  return out;
}

/** 计算字符串的 MD5（hex）。与 @soundx/ws 的 md5（js-md5，标准 MD5）结果一致。 */
function md5Hex(input: string): string {
  const md = cryptoFramework.createMd('MD5');
  const bytes = new Uint8Array(buffer.from(input, 'utf-8').buffer);
  md.updateSync({ data: bytes });
  const result = md.digestSync();
  return toHex(result.data);
}

/**
 * 由设备指纹生成确定性 deviceId。
 * 输出形如 `phone_a1b2c3d4e5`（端类型前缀 + md5 前 12 位），与 @soundx/ws computeDeviceId 一致。
 */
function computeDeviceId(): string {
  const fingerprint = buildFingerprintString();
  const hash = md5Hex(fingerprint).substring(0, 12);
  const prefix = getDevicePlatform() || 'device';
  return `${prefix}_${hash}`;
}

/**
 * 获取稳定唯一设备标识（确定性）。
 *
 * deviceId 由设备固有信息推导：clientType + osName/osVersion + brand/manufacturer + model，
 * 同一台物理设备无论何时算出来都是同一个 ID，免疫 kvStore 被清 / App 重装导致的漂移。
 * 算法与 desktop / mobile / web 端一致（@soundx/ws computeDeviceId），保证跨端去重有效。
 *
 * 结果仍写入 kvStore 做缓存（省去每次重算），但即使缓存丢失也能重新算出同一个值。
 */
export async function getOrCreateDeviceId(): Promise<string> {
  // 每次直接重算确定性 ID（不依赖缓存命中），保证永不过期；缓存仅作兜底日志参考
  try {
    const id = computeDeviceId();
    // 顺手刷新缓存，供其它（若有）读旧缓存的代码参考
    try {
      await kvStore.set(DEVICE_ID_KEY, id);
    } catch {
      // 忽略持久化失败
    }
    return id;
  } catch (e) {
    // crypto/deviceInfo 不可用时退化为缓存值或随机值
    try {
      const existing = await kvStore.get(DEVICE_ID_KEY);
      if (existing) return existing;
    } catch {
      // 忽略
    }
    const fallback = `harmony_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    try {
      await kvStore.set(DEVICE_ID_KEY, fallback);
    } catch {
      // 忽略
    }
    return fallback;
  }
}
