/**
 * 飞牛音乐的请求签名（authx）。
 *
 * 算法来自 fn-music-player（Electron 桌面端）的实现，与官方前端同构：
 *
 * ```
 * nonce       = 6 位随机数字（100000~999999）
 * timestamp   = Date.now() 毫秒
 * payloadHash = GET ? md5(decodeURIComponent(规范化 query)) : md5(body 原文)
 * sign        = md5(`AUTHX_PREFIX_path_nonce_timestamp_payloadHash_CLIENT_KEY`)
 * authx       = `nonce=<nonce>&timestamp=<ts>&sign=<sign>`
 * ```
 *
 * 其中 `AUTHX_PREFIX` / `CLIENT_KEY` 是飞牛前端内置的两个常量，不在公开文档里。
 * 通过 `setFnosAuthKeys()` 注入后，所有请求会自动带 authx；不注入则按裸请求发出
 * （实测 1.1.19 的服务端登录/列表接口并不校验 authx，但媒体接口和别的版本可能会）。
 *
 * 需要完全自定义时也可以用 `setFnosSigner()` 整个替换本实现。
 */
import { md5Hex } from "./hash";

/** 签名入参：path 为不含 host 的完整网关路径，如 `/music/api/v1/track/list` */
export interface FnosSignInput {
  method: "GET" | "POST";
  path: string;
  query: Record<string, string>;
  /** POST 的 JSON body 原文；GET 为 undefined */
  body?: unknown;
}

export interface FnosSignature {
  /** 追加到 URL query 上（给 <img src> / <audio src> 这类无法加请求头的场景用） */
  query?: Record<string, string>;
  /** 追加到请求头（authx 等） */
  headers?: Record<string, string>;
}

export type FnosSigner = (
  input: FnosSignInput,
) => FnosSignature | Promise<FnosSignature>;

let signer: FnosSigner | null = null;

/** 注入签名器；传 null 取消注入 */
export const setFnosSigner = (next: FnosSigner | null) => {
  signer = next;
};

export const getFnosSigner = (): FnosSigner | null => signer;

// ------------------------------------------------------------- authx 内置实现

export interface FnosAuthKeys {
  /** 飞牛前端内置的签名前缀常量 */
  authxPrefix?: string;
  /** 飞牛前端内置的 clientKey */
  clientKey?: string;
}

let authKeys: FnosAuthKeys = {};

/**
 * 注入 authx 需要的两个常量（不注入就按不签名发出）。
 * 端侧登录成功后从配置里读出来调一次即可。
 */
export const setFnosAuthKeys = (keys: FnosAuthKeys | null) => {
  const authxPrefix = String(keys?.authxPrefix || "").trim();
  const clientKey = String(keys?.clientKey || "").trim();
  authKeys = authxPrefix && clientKey ? { authxPrefix, clientKey } : {};
  // 有常量时挂上内置签名器，但不覆盖外部显式注入的签名器
  if (authKeys.authxPrefix && !signer) signer = createFnosAuthxSigner(authKeys);
};

export const getFnosAuthKeys = (): FnosAuthKeys => ({ ...authKeys });

export const hasFnosAuthKeys = (): boolean =>
  Boolean(authKeys.authxPrefix && authKeys.clientKey);

/** query 规范化：key 排序 + URLSearchParams + `+` → `%20`（与官方前端一致） */
export const canonicalFnosQuery = (query?: Record<string, string>): string => {
  const params = new URLSearchParams();
  Object.keys(query || {})
    .sort()
    .forEach((key) => {
      const value = (query as Record<string, string>)[key];
      if (value === undefined || value === null) return;
      params.append(key, String(value));
    });
  return params.toString().replace(/\+/g, "%20");
};

/** 与官方前端一致：先修补孤立 `%`，再 decode，decode 失败退回原文 */
export const hashFnosPayload = (raw: string): string => {
  try {
    const fixed = raw.replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
    return md5Hex(decodeURIComponent(fixed));
  } catch {
    return md5Hex(raw);
  }
};

/** 生成 authx 头的值（nonce/timestamp 可注入，便于单测比对） */
export const buildFnosAuthx = (params: {
  method: "GET" | "POST";
  /** 完整网关路径，含 /music/api/v1 前缀 */
  path: string;
  query?: Record<string, string>;
  /** POST 的 JSON 原文 */
  body?: string;
  authxPrefix: string;
  clientKey: string;
  nonce?: string;
  timestamp?: string;
}): string => {
  const isGet = String(params.method).toUpperCase() === "GET";
  const nonce = params.nonce || String(Math.floor(Math.random() * 900000) + 100000);
  const timestamp = params.timestamp || String(Date.now());
  const payloadHash = isGet
    ? hashFnosPayload(canonicalFnosQuery(params.query))
    : md5Hex(params.body == null ? "" : params.body);
  const source = [
    params.authxPrefix,
    params.path,
    nonce,
    timestamp,
    payloadHash,
    params.clientKey,
  ].join("_");
  return `nonce=${nonce}&timestamp=${timestamp}&sign=${md5Hex(source)}`;
};

/** 用 authx 常量构造一个签名器（GET 拼 query 签名，POST 用 body 原文签名） */
export const createFnosAuthxSigner = (keys: FnosAuthKeys): FnosSigner => {
  const authxPrefix = String(keys.authxPrefix || "");
  const clientKey = String(keys.clientKey || "");
  return (input) => ({
    headers: {
      authx: buildFnosAuthx({
        method: input.method,
        path: input.path,
        query: input.query,
        body:
          input.method === "POST" && input.body !== undefined
            ? JSON.stringify(input.body)
            : undefined,
        authxPrefix,
        clientKey,
      }),
    },
  });
};

/** 便捷方法：算一次签名，失败不阻断主流程（签名模块异常时至少能看到真实错误码） */
export const applyFnosSignature = async (
  input: FnosSignInput,
): Promise<FnosSignature> => {
  if (!signer) return {};
  try {
    return (await signer(input)) || {};
  } catch (error) {
    console.warn("[Fnos] 签名器执行失败，按未签名请求发出", error);
    return {};
  }
};
