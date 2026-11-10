import cryptoFramework from '@ohos.security.cryptoFramework';
import util from '@ohos.util';

/**
 * 飞牛音乐用到的摘要：登录密码要求 `SHA-256(明文)` 的小写十六进制。
 *
 * desktop / mobile 侧自己实现了一份纯 JS 版本（packages/services/src/adapter/fnos/hash.ts），
 * 原因是浏览器里 Web Crypto 没有 MD5、且在非安全上下文不可用。
 * 鸿蒙这边直接用系统 cryptoFramework（MD 能力见 @ohos.security.cryptoFramework），
 * 不需要再搬一份纯 JS 实现。
 */

function toHex(bytes: Uint8Array): string {
  let out: string = '';
  for (let i = 0; i < bytes.length; i++) {
    const part: string = bytes[i].toString(16);
    out += part.length === 1 ? `0${part}` : part;
  }
  return out;
}

/** SHA-256 的小写十六进制；失败时抛错（登录流程不能静默用空串顶替） */
export async function sha256Hex(input: string): Promise<string> {
  const md: cryptoFramework.Md = cryptoFramework.createMd('SHA256');
  const encoder: util.TextEncoder = new util.TextEncoder();
  const bytes: Uint8Array = encoder.encodeInto(input);
  const blob: cryptoFramework.DataBlob = { data: bytes };
  await md.update(blob);
  const digest: cryptoFramework.DataBlob = await md.digest();
  return toHex(digest.data);
}

/**
 * 飞牛登录上报的 `deviceId` 必须是 32 位小写 hex（官方客户端首次随机生成后持久化）。
 * 端侧已有稳定设备标识（带端前缀），这里统一摘要成 32 位，
 * 既满足格式要求，又能保证同一台机器每次都一样。
 */
export async function normalizeFnosDeviceId(raw: string): Promise<string> {
  const value = (raw || '').trim();
  if (/^[0-9a-f]{32}$/i.test(value)) return value.toLowerCase();
  const seed = value.length > 0 ? value : `fnos-${Date.now()}`;
  const digest = await sha256Hex(seed);
  return digest.substring(0, 32);
}
