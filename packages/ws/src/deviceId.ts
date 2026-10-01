/**
 * 确定性设备标识（deterministic deviceId）
 *
 * 背景：旧实现 `xxx_${Date.now()}_${random}` 依赖 localStorage/AsyncStorage/kvStore 持久化，
 * 一旦本地存储被清（Tauri WebView 缓存清理、浏览器清站点数据、App 重装、切换服务器），
 * 就会生成全新 deviceId —— 导致 WS 实际在连的 deviceId 与数据库设备列表里的 deviceId 对不上，
 * 播放流转永远报 device_offline、设备显示 isOnline:false。
 *
 * 新方案：deviceId 由「设备固有信息」确定性推导 ——
 *   deviceId = md5( clientType | osName/osVersion | brand/manufacturer | model | deviceName )
 * 同一台物理设备 + 同一端，无论何时何地算出来都是同一个 ID，天然免疫存储丢失。
 *
 * 全端（desktop / mobile / harmony / web）必须使用同一套拼接规则与哈希算法，
 * 规则有任何改动都必须五端同步，否则跨端设备去重会失效。
 */

/** 设备指纹输入：各端用自己的 API 采集后填入，字段缺省给空串即可 */
export interface DeviceFingerprint {
  /** 端类型：desktop / web / phone / tablet / tv / watch / mini */
  clientType: string;
  /** 系统名，如 macOS / Windows / Android / iOS / HarmonyOS */
  osName?: string;
  /** 系统版本，如 15.1 / 14 / 5.0.0 */
  osVersion?: string;
  /** 品牌，如 Apple / Xiaomi / HUAWEI */
  brand?: string;
  /** 制造商（与品牌二选一或都填），如 Xiaomi / HUAWEI */
  manufacturer?: string;
  /** 型号，如 Mac mini / 24072PX77C / 华为畅享90 */
  model?: string;
  /** 设备名（主机名 / 用户可见名），如 mmdctjjdeMini.bbrouter */
  deviceName?: string;
}

/**
 * 归一化单个字段：去首尾空白、转小写、折叠连续空白。
 * 统一小写避免 "MacOS" vs "macOS" 这类大小写差异导致 ID 不同。
 */
function norm(v?: string): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 把设备指纹拼成规范串。字段顺序固定，全端必须一致。
 * 用 \u0001（SOH）分隔，避免字段内容含 "|" 时拼串歧义。
 */
export function buildFingerprintString(fp: DeviceFingerprint): string {
  const SEP = "\u0001";
  return [
    norm(fp.clientType),
    norm(fp.osName),
    norm(fp.osVersion),
    norm(fp.brand),
    norm(fp.manufacturer),
    norm(fp.model),
    norm(fp.deviceName),
  ].join(SEP);
}

/* ------------------------------------------------------------------ *
 * MD5 使用 js-md5（业界验证实现，支持中文/UTF-8，无 Node 依赖），
 * 保证在浏览器 / Tauri WebView / React Native(Hermes) 结果一致且正确。
 * 仅用于生成稳定设备指纹，不用于安全场景，MD5 足够。
 * ------------------------------------------------------------------ */
import { md5 as jsMd5 } from 'js-md5';

/** 计算字符串的 MD5（hex）。输入按 UTF-8 编码，支持中文。与标准 MD5 完全一致。 */
export function md5(input: string): string {
  return jsMd5(input);
}


/**
 * 由设备指纹生成确定性 deviceId。
 * 输出形如 `desktop_a1b2c3d4e5`（端类型前缀 + md5 前 12 位），
 * 前缀保留端类型便于日志/列表肉眼区分，12 位哈希足以避免同设备碰撞。
 */
export function computeDeviceId(fp: DeviceFingerprint): string {
  const hash = md5(buildFingerprintString(fp)).slice(0, 12);
  const prefix = norm(fp.clientType) || "device";
  return `${prefix}_${hash}`;
}
