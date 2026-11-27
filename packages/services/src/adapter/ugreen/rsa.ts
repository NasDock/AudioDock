/**
 * 纯 JS RSA PKCS#1 v1.5 加密（BigInt 实现）。
 *
 * 绿联登录要求用 `verify/check` 响应头 `X-Rsa-Token` 里的公钥加密密码。
 * 各端（Chromium / Hermes / Node）都有 BigInt，这里不引第三方依赖：
 * 只做「PEM → 模数/指数 → 单块加密」这一条路径，约百行。
 */

const bytesToBigInt = (bytes: Uint8Array): bigint => {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
};

const bigIntToBytes = (value: bigint, length: number): Uint8Array => {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
};

/** 模幂运算：base^exponent mod modulus */
const modPow = (base: bigint, exponent: bigint, modulus: bigint): bigint => {
  if (modulus === 1n) return 0n;
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
};

/** base64 → 字节（不依赖 atob：Hermes 上 atob 存在但行为有坑，这里自实现） */
const base64ToBytes = (input: string): Uint8Array => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, "");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    if (ch === "=") break;
    const value = alphabet.indexOf(ch);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? alphabet[b2 & 0x3f] : "=";
  }
  return out;
};

/** DER 读取：tag + length，返回 [contentOffset, contentLength, nextOffset] */
const readDerElement = (
  der: Uint8Array,
  offset: number,
): { tag: number; start: number; length: number; next: number } => {
  const tag = der[offset];
  let cursor = offset + 1;
  let length = der[cursor];
  if (length & 0x80) {
    const byteCount = length & 0x7f;
    length = 0;
    for (let i = 0; i < byteCount; i++) length = (length << 8) | der[cursor + 1 + i];
    cursor += byteCount;
  }
  cursor += 1;
  return { tag, start: cursor, length, next: cursor + length };
};

/**
 * 解析 SubjectPublicKeyInfo / RSAPublicKey PEM，取出 modulus 和 exponent。
 * 绿联返回的是 `-----BEGIN RSA PUBLIC KEY-----`（PKCS#1），
 * 但也兼容 `-----BEGIN PUBLIC KEY-----`（X.509 SPKI，套一层 BIT STRING）。
 */
export const parseRsaPublicKey = (pemBase64: string): { n: bigint; e: bigint } => {
  const der = base64ToBytes(pemBase64);
  let top = readDerElement(der, 0);
  let seq = top;
  // X.509 SPKI：SEQUENCE { SEQUENCE { OID... }, BIT STRING { RSAPublicKey } }
  const first = readDerElement(der, seq.start);
  if (first.tag === 0x30) {
    const second = readDerElement(der, first.next);
    if (second.tag === 0x03) {
      // BIT STRING：首字节是 unused-bits 计数（应为 0）
      seq = readDerElement(der, second.start + 1);
    }
  }
  const modulusEl = readDerElement(der, seq.start);
  const exponentEl = readDerElement(der, modulusEl.next);
  // INTEGER 可能带前导 0x00（正数符号位），去掉
  const strip = (bytes: Uint8Array): Uint8Array =>
    bytes.length > 1 && bytes[0] === 0 ? bytes.subarray(1) : bytes;
  const modulus = strip(der.subarray(modulusEl.start, modulusEl.start + modulusEl.length));
  const exponent = strip(der.subarray(exponentEl.start, exponentEl.start + exponentEl.length));
  return { n: bytesToBigInt(modulus), e: bytesToBigInt(exponent) };
};

const randomBytes = (length: number): Uint8Array => {
  const out = new Uint8Array(length);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(out);
  } else {
    for (let i = 0; i < length; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
};

/**
 * RSA PKCS#1 v1.5 加密单块明文，返回 base64。
 * 绿联密码长度远小于密钥块，单块足够。
 */
export const rsaEncryptBase64 = (
  pemBase64PublicKey: string,
  plaintext: string,
): string => {
  const { n, e } = parseRsaPublicKey(pemBase64PublicKey);
  const modulusBytes = Math.ceil(n.toString(2).length / 8);
  const data = new TextEncoder().encode(plaintext);
  if (data.length > modulusBytes - 11) {
    throw new Error("RSA 明文过长，无法加密");
  }
  // EM = 0x00 || 0x02 || PS(非零随机) || 0x00 || M
  const psLength = modulusBytes - data.length - 3;
  const em = new Uint8Array(modulusBytes);
  em[0] = 0;
  em[1] = 2;
  const ps = randomBytes(psLength);
  for (let i = 0; i < psLength; i++) {
    em[2 + i] = ps[i] === 0 ? 1 : ps[i];
  }
  em[2 + psLength] = 0;
  em.set(data, 3 + psLength);
  const encrypted = modPow(bytesToBigInt(em), e, n);
  return bytesToBase64(bigIntToBytes(encrypted, modulusBytes));
};
