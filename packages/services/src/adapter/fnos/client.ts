import axios from "axios";
import { getServiceConfig } from "../../config";
import { getBaseURL } from "../../request";
import { applyFnosSignature } from "./auth";
import type { FnosEnvelope, FnosSystemConfig } from "./types";

export interface FnosConfig {
  /** NAS 根地址，如 http://192.168.1.10:5666 或 https://xxx.fnos.net */
  baseUrl?: string;
  username?: string;
  password?: string;
  /** 直连网关路径，默认 /music/api/v1 */
  apiPath?: string;
  /** 完整 API 根地址覆盖（走 AudioDock 服务端代理时填代理地址） */
  apiBase?: string;
  /** 已登录拿到的会话 token（飞牛叫 userToken） */
  token?: string;
  /** 稳定设备标识，飞牛登录会写进会话里 */
  deviceId?: string;
  /**
   * FN Connect 中继模式：走 `*.fnos.net` / `*.5ddd.com` 时服务端要求带 `Cookie: mode=relay`。
   * 不传则按 host 自动判断。
   */
  relayMode?: boolean;
  /** authx 签名前缀常量（飞牛前端内置；不填则不签名） */
  authxPrefix?: string;
  /** authx 签名 clientKey（飞牛前端内置；不填则不签名） */
  clientKey?: string;
  clientName?: string;
}

// ---------------------------------------------------------------- 错误与状态码

/**
 * 飞牛网关错误码（对齐官方客户端 ApiDecoder.mapCode）：
 * - 99999 / 120001 未登录或会话失效
 * - 120002 账号被禁用
 * - 100004 曲目不可用（无权限/文件丢失）
 * - 100005 资源不存在
 */
export const FNOS_CODES = {
  OK: 0,
  INVALID_TOKEN: 99999,
  SESSION_EXPIRED: 120001,
  ACCOUNT_DISABLED: 120002,
  TRACK_UNAVAILABLE: 100004,
  NOT_FOUND: 100005,
} as const;

/** 兼容旧引用：会话失效码 */
export const FNOS_CODE_SESSION_EXPIRED = FNOS_CODES.SESSION_EXPIRED;

export type FnosErrorKind =
  | "unauthorized"
  | "account-disabled"
  | "not-found"
  | "track-unavailable"
  | "http"
  | "unknown";

const KIND_LABELS: Record<FnosErrorKind, string> = {
  unauthorized: "飞牛音乐登录已失效，请重新登录",
  "account-disabled": "飞牛音乐账号已被禁用",
  "not-found": "飞牛音乐中找不到该资源",
  "track-unavailable": "该曲目在飞牛音乐中不可用（无权限或文件已丢失）",
  http: "飞牛音乐请求失败",
  unknown: "飞牛音乐接口错误",
};

/** 飞牛的接口错误：code 非 0 时抛出，kind 便于上层判断要不要踢回登录页 */
export class FnosApiError extends Error {
  code: number;
  kind: FnosErrorKind;

  constructor(code: number, message: string, kind: FnosErrorKind = "unknown") {
    super(message);
    this.name = "FnosApiError";
    this.code = code;
    this.kind = kind;
  }

  get isUnauthorized() {
    return this.kind === "unauthorized";
  }
}

const kindOfCode = (code: number): FnosErrorKind => {
  switch (code) {
    case FNOS_CODES.INVALID_TOKEN:
    case FNOS_CODES.SESSION_EXPIRED:
      return "unauthorized";
    case FNOS_CODES.ACCOUNT_DISABLED:
      return "account-disabled";
    case FNOS_CODES.TRACK_UNAVAILABLE:
      return "track-unavailable";
    case FNOS_CODES.NOT_FOUND:
      return "not-found";
    default:
      return "unknown";
  }
};

// ------------------------------------------------------------------- 传输层

/**
 * 传输层请求（已经拼好完整 URL，headers 也已经是最终值）。
 *
 * 为什么要这一层：飞牛网关**不带任何 CORS 响应头**，浏览器/WebView 里直接 XHR 会被拦。
 * desktop 的 Tauri 环境可以注入 `@tauri-apps/plugin-http` 的 fetch 走 Rust 发请求绕开 CORS。
 */
export interface FnosTransportRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  /** POST 的 JSON 字符串 */
  body?: string;
  /** true 时按二进制读响应（封面、音频），data 返回 Blob/ArrayBuffer */
  binary?: boolean;
}

export interface FnosTransportResponse {
  status: number;
  /** 原始响应体：JSON 字符串 / 文本 /（二进制由传输层自行处理） */
  data: unknown;
  contentType?: string;
}

export type FnosTransport = (
  request: FnosTransportRequest,
) => Promise<FnosTransportResponse>;

let activeTransport: FnosTransport | null = null;

/** 注入自定义传输层（传 null 恢复默认 axios） */
export const setFnosTransport = (transport: FnosTransport | null) => {
  activeTransport = transport;
};

export const getFnosTransport = (): FnosTransport | null => activeTransport;

/**
 * 媒体代理前缀（web 版用）。
 *
 * 飞牛的 `/static/cover`、`/track/stream` 都只认 `Cookie`/`Authorization` 头，
 * 而 `<img src>` / `<audio src>` 加不了请求头。web 版由 dev server 代理转发，
 * 这里只需把媒体 URL 指向代理，并把 origin/token 放进 query。
 */
let mediaProxyBase: string | null = null;

/** 设置媒体代理前缀（如 `/__fnos`）；传 null 关闭 */
export const setFnosMediaProxy = (base: string | null) => {
  mediaProxyBase = base ? base.replace(/\/+$/, "") : null;
};

export const getFnosMediaProxy = (): string | null => mediaProxyBase;

/** 默认传输层：axios。浏览器里会受 CORS 限制。 */
const defaultTransport: FnosTransport = async (request) => {
  const response = await axios.request({
    method: request.method,
    url: request.url,
    headers: request.headers,
    data: request.body,
    timeout: 20000,
    // 显式关掉 credentials：React Native 的 XHR 默认 withCredentials=true，
    // Android 侧 OkHttp 在 cookie jar 非空时会用 jar 里的 cookie **覆盖**
    // 我们手动设的 `Cookie: mode=relay`（中继必需），覆盖后网关直接 302。
    // false → RN 用 CookieJar.NO_COOKIES，手动设的头原样发出。
    withCredentials: false,
    // 自己判状态码，便于给出「返回非 JSON」这类可读错误
    validateStatus: () => true,
    responseType: request.binary ? "arraybuffer" : "text",
    transformResponse: [(data) => data],
  });
  return {
    status: response.status,
    data: response.data,
    contentType: String(response.headers?.["content-type"] || ""),
  };
};

const transport = (): FnosTransport => activeTransport || defaultTransport;

// -------------------------------------------------------------- 地址归一化

const DEFAULT_API_PATH = "/music/api/v1";
const FNOS_DEFAULT_HTTP_PORT = 5666;
const RELAY_HOST_PATTERN = /\.(fnos\.net|5ddd\.com)$/i;

export interface FnosResolvedServer {
  /** 协议 + host + 端口，无路径，如 http://192.168.1.10:5666 */
  origin: string;
  /** 网关根地址，如 http://192.168.1.10:5666/music/api/v1 */
  apiBase: string;
  /** 是否 FN Connect 中继（需要 Cookie: mode=relay） */
  relayMode: boolean;
  host: string;
}

/**
 * 归一化用户输入的地址（对齐官方 ServerUrlNormalizer）：
 * - 缺协议补 http://
 * - 去掉尾部斜杠，并把误粘的 `/music`、`/api/v1`、`/music/api/v1` 去掉
 * - 没有显式端口时：https 用 443，显式 http:// 用 80，裸地址用 5666
 * - host 是 fnos.net / 5ddd.com 时判定为中继模式
 *
 * 这里**不用 `new URL()`**：React Native 的全局 `URL` 是 `Libraries/Blob/URL`
 * 存根，`protocol` / `port` 只有 getter 没有 setter，赋值会直接抛 TypeError
 * （ES module 是严格模式）。所以改成纯字符串解析，各端（Chromium / Hermes /
 * Node）行为一致。
 */
export const resolveFnosServer = (raw: string, apiPath?: string): FnosResolvedServer => {
  const value = String(raw || "").trim();
  if (!value) throw new Error("飞牛音乐未配置服务器地址");

  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(value);
  const explicitScheme = schemeMatch?.[1]?.toLowerCase();
  if (explicitScheme && explicitScheme !== "http" && explicitScheme !== "https") {
    throw new Error(`不支持的协议：${explicitScheme}://，飞牛音乐只支持 http/https`);
  }

  // 拆 authority / path
  const rest = explicitScheme ? value.slice(schemeMatch![0].length) : value;
  const slashIndex = rest.indexOf("/");
  const authority = (slashIndex >= 0 ? rest.slice(0, slashIndex) : rest).trim();
  let path = slashIndex >= 0 ? rest.slice(slashIndex) : "";
  if (!authority) throw new Error("飞牛音乐服务器地址格式不正确");
  // 去掉 query / hash
  path = path.split(/[?#]/)[0];

  // 去掉 userinfo（http://user@host）
  const atIndex = authority.lastIndexOf("@");
  const hostPort = atIndex >= 0 ? authority.slice(atIndex + 1) : authority;
  if (!hostPort) throw new Error("飞牛音乐服务器地址缺少主机名");

  let hostname = "";
  let port = "";
  if (hostPort.startsWith("[")) {
    // IPv6 字面量：[::1]:5666
    const closeIndex = hostPort.indexOf("]");
    if (closeIndex < 0) throw new Error("飞牛音乐服务器地址格式不正确");
    hostname = hostPort.slice(0, closeIndex + 1);
    const tail = hostPort.slice(closeIndex + 1);
    if (tail.startsWith(":")) port = tail.slice(1);
    else if (tail) throw new Error("飞牛音乐服务器地址格式不正确");
  } else {
    const colonIndex = hostPort.lastIndexOf(":");
    if (colonIndex >= 0) {
      hostname = hostPort.slice(0, colonIndex);
      port = hostPort.slice(colonIndex + 1);
    } else {
      hostname = hostPort;
    }
  }
  if (!hostname) throw new Error("飞牛音乐服务器地址缺少主机名");
  if (port) {
    if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) {
      throw new Error("飞牛音乐服务器地址格式不正确");
    }
  }

  // 去掉误粘的路径尾巴
  path = path.replace(/\/+$/, "");
  if (/\/music\/api\/v1$/i.test(path)) path = path.replace(/\/music\/api\/v1$/i, "");
  else if (/\/api\/v1$/i.test(path)) path = path.replace(/\/api\/v1$/i, "");
  if (/\/music$/i.test(path)) path = path.replace(/\/music$/i, "");
  if (path === "/") path = "";

  const isRelayHost = RELAY_HOST_PATTERN.test(hostname);
  const hasExplicitPort = Boolean(port);
  // 裸写的中继域名（xxx.fnos.net / xxx.5ddd.com）走 https，不要硬套 5666
  let scheme = explicitScheme || "http";
  if (!explicitScheme && !hasExplicitPort && isRelayHost) scheme = "https";
  if (!hasExplicitPort && scheme === "http" && !explicitScheme) {
    // 裸地址（没写协议也没写端口）按 5666 走
    port = String(FNOS_DEFAULT_HTTP_PORT);
  }
  // 默认端口不写进 host（与浏览器 URL 行为一致）
  if ((scheme === "http" && port === "80") || (scheme === "https" && port === "443")) {
    port = "";
  }

  const host = port ? `${hostname}:${port}` : hostname;
  const origin = `${scheme}://${host}`;
  const gatewayPath = (apiPath || DEFAULT_API_PATH).replace(/\/+$/, "");
  const normalizedGatewayPath = gatewayPath.startsWith("/") ? gatewayPath : `/${gatewayPath}`;

  return {
    origin,
    apiBase: `${origin}${path}${normalizedGatewayPath}`,
    relayMode: isRelayHost,
    host,
  };
};

/** 兼容旧 API：只取 origin */
export const normalizeFnosBaseUrl = (raw: string): string => {
  try {
    return resolveFnosServer(raw).origin;
  } catch {
    return "";
  }
};

// ------------------------------------------------------------------ 工具函数

/** sha256 / md5 放在 hash.ts（Web Crypto 在非安全上下文不可用，带纯 JS 兜底）；这里保留导出兼容旧引用 */
export { sha256Hex, md5Hex } from "./hash";
import { md5Hex } from "./hash";

const toQueryRecord = (params?: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!params) return out;
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    out[key] = String(value);
  });
  return out;
};

const toQueryString = (query: Record<string, string>): string => {
  const search = new URLSearchParams(query).toString();
  return search ? `?${search}` : "";
};

/** 进程内兜底的设备标识（调用方最好自己传稳定 deviceId） */
let fallbackDeviceId = "";
const createDeviceId = (): string => {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  return `fnos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * 飞牛登录上报的 `deviceId` 是 **32 位小写 hex**（官方客户端首次随机生成后持久化）。
 * 端侧传进来的稳定设备标识可能带前缀（如 `dt_ab12cd34`），这里统一摘要成 32 位，
 * 既满足格式要求，又能保证同一台机器每次都一样。
 */
export const normalizeFnosDeviceId = (raw?: string): string => {
  const value = String(raw || "").trim();
  if (/^[0-9a-f]{32}$/i.test(value)) return value.toLowerCase();
  if (!value) {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return md5Hex(uuid);
    return md5Hex(`fnos-${Date.now()}-${Math.random()}`);
  }
  return md5Hex(value);
};

// ------------------------------------------------------------------- 客户端

export interface FnosRequestOptions {
  /** 登录类接口不能带 X-Music-API 版本头 */
  skipVersionHeader?: boolean;
  /** 登录流程：此时的 120001 其实是「账号或密码错误」 */
  loginFlow?: boolean;
  /** 不附带 Authorization（登录/预热接口） */
  skipAuth?: boolean;
}

export class FnosClient {
  private config: FnosConfig;
  /** 登录后由 login() 回填，优先于全局 config */
  private sessionToken?: string;

  constructor(config?: FnosConfig) {
    this.config = config || {};
  }

  // ---------------------------------------------------------------- 基础地址

  private resolve(): FnosResolvedServer {
    if (this.config.apiBase) {
      const apiBase = this.config.apiBase.replace(/\/+$/, "");
      return { origin: apiBase, apiBase, relayMode: !!this.config.relayMode, host: "" };
    }
    const fromConfig = this.config.baseUrl || getServiceConfig().baseUrl || getBaseURL() || "";
    const resolved = resolveFnosServer(fromConfig, this.config.apiPath);
    return {
      ...resolved,
      relayMode:
        this.config.relayMode === undefined ? resolved.relayMode : this.config.relayMode,
    };
  }

  /** API 根地址（带 /music/api/v1） */
  public getApiBase(): string {
    return this.resolve().apiBase;
  }

  /** 网关路径前缀，签名时用 */
  public getApiPath(): string {
    const path = this.config.apiPath || DEFAULT_API_PATH;
    return path.startsWith("/") ? path : `/${path}`;
  }

  /** 是否 FN Connect 中继（决定要不要发 Cookie: mode=relay） */
  public isRelayMode(): boolean {
    return this.resolve().relayMode;
  }

  /** 登录接口拿到 token 后立即生效，避免依赖一次全局 config 刷新 */
  public setSessionToken(token?: string) {
    this.sessionToken = token;
  }

  public getSessionToken(): string | undefined {
    return this.sessionToken || this.config.token || getServiceConfig().token || undefined;
  }

  /** 飞牛登录要上报的稳定设备标识 */
  public getDeviceId(): string {
    if (this.config.deviceId) return normalizeFnosDeviceId(this.config.deviceId);
    const fromGlobal = getServiceConfig().deviceId;
    if (fromGlobal) return normalizeFnosDeviceId(fromGlobal);
    if (!fallbackDeviceId) fallbackDeviceId = createDeviceId();
    return normalizeFnosDeviceId(fallbackDeviceId);
  }

  // ------------------------------------------------------------------ 请求层

  private buildHeaders(options?: FnosRequestOptions, hasBody?: boolean) {
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN",
    };
    const { relayMode } = this.resolve();
    const token = options?.skipAuth ? undefined : this.getSessionToken();

    // 官方实现（fn-music-player 的代理层）只用 Cookie 传会话：
    //   Cookie: music-token=<token>
    // 中继模式还要多带一个 mode=relay，否则网关 302 到 FN Connect 登录页。
    // Authorization 保留一份，兼容只认头的服务端版本（两种方式实测都通）。
    const cookies: string[] = [];
    if (relayMode) cookies.push("mode=relay");
    if (token) {
      headers.Authorization = token;
      cookies.push(`music-token=${encodeURIComponent(token)}`);
    }
    if (cookies.length) headers.Cookie = cookies.join("; ");

    if (hasBody) headers["Content-Type"] = "application/json";
    return headers;
  }

  /** 发请求并把传输层异常（断网、DNS、CORS 被拦）翻译成可读错误 */
  private async send(
    request: FnosTransportRequest,
    path: string,
  ): Promise<FnosTransportResponse> {
    // 排查用：能在 devtools / 终端里看到「到底有没有发出去」
    const via = activeTransport ? "custom" : "axios";
    console.info(`[Fnos] → ${request.method} ${request.url} (via ${via})`);
    try {
      const response = await transport()(request);
      console.info(`[Fnos] ← ${response.status} ${path}`);
      return response;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[Fnos] ✗ ${request.method} ${request.url}`, error);
      const isAbort = detail.includes("abort") || detail.includes("cancel");
      throw new FnosApiError(
        isAbort ? -2 : -3,
        isAbort
          ? `飞牛音乐请求已取消（${path}）`
          : `无法连接飞牛音乐服务（${path}）：${detail}。请确认地址、网络，或该环境是否被跨域策略拦截`,
        "http",
      );
    }
  }

  private unwrap<T>(payload: unknown, options?: FnosRequestOptions): T {
    if (typeof payload === "string") {
      const text = payload.trim();
      if (!text) throw new FnosApiError(-1, "飞牛音乐返回了空响应");
      // 未登录/中继未放行时网关会返回登录页 HTML
      if (text.startsWith("<")) {
        throw new FnosApiError(
          -1,
          "飞牛音乐返回了非 JSON 内容（通常是地址填错、中继未放行，或服务不是飞牛音乐）",
        );
      }
      try {
        payload = JSON.parse(text);
      } catch {
        throw new FnosApiError(-1, "飞牛音乐返回内容无法解析为 JSON");
      }
    }

    const envelope = payload as FnosEnvelope<T> | undefined;
    if (!envelope || typeof envelope.code !== "number") {
      throw new FnosApiError(-1, "飞牛音乐返回格式异常");
    }
    if (envelope.code === FNOS_CODES.OK) {
      return envelope.data as T;
    }

    // 登录流程里 120001 实际是「账号或密码错误」，不要误导成会话失效
    if (options?.loginFlow && envelope.code === FNOS_CODES.SESSION_EXPIRED) {
      throw new FnosApiError(
        envelope.code,
        "飞牛音乐账号或密码错误",
        "unauthorized",
      );
    }

    const kind = kindOfCode(envelope.code);
    const fallback = KIND_LABELS[kind];
    throw new FnosApiError(
      envelope.code,
      envelope.msg ? `${fallback}（${envelope.msg}）` : `${fallback}（code=${envelope.code}）`,
      kind,
    );
  }

  public async request<T>(
    method: "GET" | "POST",
    path: string,
    params?: Record<string, unknown>,
    body?: unknown,
    options?: FnosRequestOptions,
  ): Promise<T> {
    const query = toQueryRecord(params);
    const apiPath = `${this.getApiPath()}${path}`;

    const signature = await applyFnosSignature({
      method,
      path: apiPath,
      query,
      body,
    });

    const headers = this.buildHeaders(options, method === "POST");
    Object.assign(headers, signature.headers || {});
    const mergedQuery = { ...query, ...(signature.query || {}) };

    const response = await this.send({
      method,
      url: `${this.getApiBase()}${path}${toQueryString(mergedQuery)}`,
      headers,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    }, path);

    if (response.status >= 300 && response.status < 400) {
      // 未登录 / 中继没放行时网关不是报错，而是 302 到 SPA 登录页
      throw new FnosApiError(
        response.status,
        "飞牛音乐返回重定向，通常是 FN Connect 中继未放行（Cookie: mode=relay 丢失）或会话已失效",
        "unauthorized",
      );
    }
    if (response.status === 401) {
      const parsed = typeof response.data === "string" ? safeJson(response.data) : response.data;
      const code = (parsed as FnosEnvelope<unknown> | null)?.code ?? FNOS_CODES.INVALID_TOKEN;
      const message = options?.loginFlow
        ? "飞牛音乐账号或密码错误"
        : KIND_LABELS.unauthorized;
      throw new FnosApiError(code, message, "unauthorized");
    }
    if (response.status >= 400) {
      throw new FnosApiError(
        response.status,
        `飞牛音乐请求失败：HTTP ${response.status} ${path}`,
        "http",
      );
    }
    return this.unwrap<T>(response.data, options);
  }

  public get<T>(path: string, params?: Record<string, unknown>) {
    return this.request<T>("GET", path, params);
  }

  public post<T>(
    path: string,
    body?: unknown,
    options?: FnosRequestOptions,
  ) {
    return this.request<T>("POST", path, undefined, body, options);
  }

  // ------------------------------------------------------------ 服务端信息

  /**
   * 服务端配置：**免登录**接口，用来在做登录前确认地址是否指向一台飞牛音乐服务。
   * 返回 serverGUID / serverName / serverVersion，可直接当作「连接成功」的判据。
   */
  public getSystemConfig(): Promise<FnosSystemConfig> {
    return this.request<FnosSystemConfig>("GET", "/sys/config", undefined, undefined, {
      skipAuth: true,
    });
  }

  // ---------------------------------------------------------- 媒体地址/内容

  /**
   * 媒体地址（裸 URL）。注意：飞牛的 `/static/cover`、`/track/stream` 都要求
   * `Authorization` 请求头，`<img src>` / `<audio src>` 这种方式带不上头，
   * 必须走 `fetchMedia()` / `fetchMediaObjectUrl()`。
   */
  public async buildMediaUrl(
    path: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    const query = toQueryRecord(params);
    const signature = await applyFnosSignature({
      method: "GET",
      path: `${this.getApiPath()}${path}`,
      query,
    });
    const merged = { ...query, ...(signature.query || {}) };

    // web 版：走 dev server 代理（同源，能带 Cookie）。token 由代理按 origin 记住，
    // 不写进 URL —— 否则会被应用把整条地址缓存进 localStorage，重新登录后 token 失效
    if (mediaProxyBase) {
      try {
        // 不用 new URL()：RN 的全局 URL 是存根，pathname 解析不可靠
        const resolved = this.resolve();
        const apiPathname = resolved.apiBase.slice(resolved.origin.length);
        const search = new URLSearchParams({ ...merged, __b: resolved.origin });
        return `${mediaProxyBase}${apiPathname}${path}?${search.toString()}`;
      } catch {
        // apiBase 是相对路径时退回直连
      }
    }

    return `${this.getApiBase()}${path}${toQueryString(merged)}`;
  }

  /** 带鉴权拉取媒体二进制（封面等）；返回 Blob */
  public async fetchMedia(
    path: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const query = toQueryRecord(params);
    const url = `${this.getApiBase()}${path}${toQueryString(query)}`;
    const headers = this.buildHeaders();
    delete headers.Accept;
    headers.Accept = "*/*";

    const raw = await this.send({ method: "GET", url, headers, binary: true }, path);
    if (raw.status >= 400) {
      throw new FnosApiError(
        raw.status,
        `飞牛音乐媒体请求失败：HTTP ${raw.status}`,
        raw.status === 401 ? "unauthorized" : "http",
      );
    }
    if (raw.data instanceof Blob) return raw.data;
    if (raw.data instanceof ArrayBuffer) {
      return new Blob([raw.data], { type: raw.contentType || "application/octet-stream" });
    }
    if (typeof raw.data === "string") {
      // 传输层按文本读回来时（例如 base64），按二进制重建
      return new Blob([raw.data], { type: raw.contentType || "application/octet-stream" });
    }
    throw new FnosApiError(-1, "飞牛音乐媒体响应类型不支持");
  }

  /** 拉媒体并转成可直接给 <img> 用的 objectURL；调用方负责 revoke */
  public async fetchMediaObjectUrl(
    path: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    const blob = await this.fetchMedia(path, params);
    if (typeof URL?.createObjectURL !== "function") {
      throw new FnosApiError(-1, "当前环境不支持 objectURL，无法展示飞牛音乐媒体");
    }
    return URL.createObjectURL(blob);
  }

  /** 封面：coverId 形如 track_xxx / album_xxx / artist_xxx */
  public async getCoverUrl(coverId?: string | null, size?: number): Promise<string | null> {
    if (!coverId) return null;
    try {
      return await this.buildMediaUrl("/static/cover", { coverId, size });
    } catch (error) {
      console.warn("[Fnos] 生成封面地址失败", error);
      return null;
    }
  }

  /** 音频流：支持 Range，可直接给 <audio src> 用（但需要能带头，见 buildMediaUrl 注释） */
  public async getStreamUrl(guid: string | number): Promise<string> {
    return this.buildMediaUrl("/track/stream", { guid: String(guid) });
  }
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
