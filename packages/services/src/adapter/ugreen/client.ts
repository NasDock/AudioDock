import axios from "axios";
import { getServiceConfig } from "../../config";
import { getBaseURL } from "../../request";
import type { UgreenEnvelope } from "./types";

export interface UgreenConfig {
  /** NAS 根地址，如 http://192.168.1.10:9999 或 https://xxx.ug.link */
  baseUrl?: string;
  username?: string;
  password?: string;
  /** 已登录拿到的 api_token（verify/login 返回的 data.token） */
  token?: string;
  /** 登录返回的 static_token（静态资源备用，实测 api_token 也能取媒体） */
  staticToken?: string;
  /** 网关路径，默认 /ugreen/v1 */
  apiPath?: string;
}

// ---------------------------------------------------------------- 错误与状态码

/**
 * 绿联错误码（实测）：
 * - 1024 登录失效（token 过期/未带）
 * - 1005 参数错误（如该接口不允许的 sort_type）
 * - 9405 未授权/参数无效（未带 token 时所有 music 接口返回此码）
 * - 3003 歌单不存在
 * - 9999 操作失败
 */
export const UGREEN_CODES = {
  OK: 200,
  PARAM_ERROR: 1005,
  LOGIN_EXPIRED: 1024,
  PLAYLIST_NOT_FOUND: 3003,
  UNAUTHORIZED: 9405,
  OPERATION_FAILED: 9999,
} as const;

export type UgreenErrorKind =
  | "unauthorized"
  | "not-found"
  | "http"
  | "unknown";

const KIND_LABELS: Record<UgreenErrorKind, string> = {
  unauthorized: "绿联音乐登录已失效，请重新登录",
  "not-found": "绿联音乐中找不到该资源",
  http: "绿联音乐请求失败",
  unknown: "绿联音乐接口错误",
};

/** 绿联接口错误：code 非 200 时抛出，kind 便于上层判断要不要踢回登录页 */
export class UgreenApiError extends Error {
  code: number;
  kind: UgreenErrorKind;

  constructor(code: number, message: string, kind: UgreenErrorKind = "unknown") {
    super(message);
    this.name = "UgreenApiError";
    this.code = code;
    this.kind = kind;
  }

  get isUnauthorized() {
    return this.kind === "unauthorized";
  }
}

const kindOfCode = (code: number): UgreenErrorKind => {
  switch (code) {
    case UGREEN_CODES.LOGIN_EXPIRED:
    case UGREEN_CODES.UNAUTHORIZED:
      return "unauthorized";
    case UGREEN_CODES.PLAYLIST_NOT_FOUND:
      return "not-found";
    default:
      return "unknown";
  }
};

// -------------------------------------------------------------- 地址归一化

const DEFAULT_API_PATH = "/ugreen/v1";
/** UGOS Pro 网页端默认端口（裸地址不带端口时补上） */
const UGREEN_DEFAULT_HTTP_PORT = 9999;
/** 远程访问域名（*.ug.link / *.ugapp.link / *.ugdocker.link）走 https */
const RELAY_HOST_PATTERN = /\.(ug\.link|ugapp\.link|ugdocker\.link)$/i;

export interface UgreenResolvedServer {
  /** 协议 + host + 端口，无路径，如 https://xxx.ug.link */
  origin: string;
  /** 网关根地址，如 https://xxx.ug.link/ugreen/v1 */
  apiBase: string;
  host: string;
}

/**
 * 归一化用户输入的地址：
 * - 缺协议补 http://（ug.link 系域名补 https://）
 * - 去掉尾部斜杠和误粘的 /desktop、/music、/ugreen、/ugreen/v1 尾巴
 * - 裸地址（无协议无端口）补默认端口 9999
 *
 * 不用 `new URL()`：React Native 的全局 URL 是存根（同飞牛处理）。
 */
export const resolveUgreenServer = (raw: string, apiPath?: string): UgreenResolvedServer => {
  const value = String(raw || "").trim();
  if (!value) throw new Error("绿联音乐未配置服务器地址");

  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(value);
  const explicitScheme = schemeMatch?.[1]?.toLowerCase();
  if (explicitScheme && explicitScheme !== "http" && explicitScheme !== "https") {
    throw new Error(`不支持的协议：${explicitScheme}://，绿联音乐只支持 http/https`);
  }

  const rest = explicitScheme ? value.slice(schemeMatch![0].length) : value;
  const slashIndex = rest.indexOf("/");
  const authority = (slashIndex >= 0 ? rest.slice(0, slashIndex) : rest).trim();
  let path = slashIndex >= 0 ? rest.slice(slashIndex) : "";
  if (!authority) throw new Error("绿联音乐服务器地址格式不正确");
  path = path.split(/[?#]/)[0];

  const atIndex = authority.lastIndexOf("@");
  const hostPort = atIndex >= 0 ? authority.slice(atIndex + 1) : authority;
  if (!hostPort) throw new Error("绿联音乐服务器地址缺少主机名");

  let hostname = "";
  let port = "";
  if (hostPort.startsWith("[")) {
    const closeIndex = hostPort.indexOf("]");
    if (closeIndex < 0) throw new Error("绿联音乐服务器地址格式不正确");
    hostname = hostPort.slice(0, closeIndex + 1);
    const tail = hostPort.slice(closeIndex + 1);
    if (tail.startsWith(":")) port = tail.slice(1);
    else if (tail) throw new Error("绿联音乐服务器地址格式不正确");
  } else {
    const colonIndex = hostPort.lastIndexOf(":");
    if (colonIndex >= 0) {
      hostname = hostPort.slice(0, colonIndex);
      port = hostPort.slice(colonIndex + 1);
    } else {
      hostname = hostPort;
    }
  }
  if (!hostname) throw new Error("绿联音乐服务器地址缺少主机名");
  if (port && (!/^\d{1,5}$/.test(port) || Number(port) > 65535)) {
    throw new Error("绿联音乐服务器地址格式不正确");
  }

  // 去掉误粘的路径尾巴
  path = path.replace(/\/+$/, "");
  path = path.replace(/\/ugreen\/v1$/i, "");
  path = path.replace(/\/ugreen$/i, "");
  path = path.replace(/\/desktop$/i, "");
  path = path.replace(/\/music$/i, "");
  if (path === "/") path = "";

  const isRelayHost = RELAY_HOST_PATTERN.test(hostname);
  let scheme = explicitScheme || "http";
  if (!explicitScheme && !port && isRelayHost) scheme = "https";
  if (!port && scheme === "http" && !explicitScheme) {
    port = String(UGREEN_DEFAULT_HTTP_PORT);
  }
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
    host,
  };
};

// ------------------------------------------------------------------ 工具函数

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

// ------------------------------------------------------------------- 客户端

export interface UgreenRequestOptions {
  /** 不附带 token（登录/check 接口） */
  skipAuth?: boolean;
  /** 登录流程：非 200 code 直接透出 msg（账号或密码错误），不套「登录失效」话术 */
  loginFlow?: boolean;
}

/** 传输层响应需要把 header 带回来：check 接口的公钥在 X-Rsa-Token 响应头里 */
export interface UgreenRawResponse {
  status: number;
  data: unknown;
  contentType?: string;
  headers?: Record<string, string>;
}

export class UgreenClient {
  private config: UgreenConfig;
  /** 登录后由 login() 回填，优先于全局 config */
  private sessionToken?: string;

  constructor(config?: UgreenConfig) {
    this.config = config || {};
  }

  private resolve(): UgreenResolvedServer {
    const fromConfig = this.config.baseUrl || getServiceConfig().baseUrl || getBaseURL() || "";
    return resolveUgreenServer(fromConfig, this.config.apiPath);
  }

  /** API 根地址（带 /ugreen/v1） */
  public getApiBase(): string {
    return this.resolve().apiBase;
  }

  public setSessionToken(token?: string) {
    this.sessionToken = token;
  }

  public getSessionToken(): string | undefined {
    return this.sessionToken || this.config.token || getServiceConfig().token || undefined;
  }

  // ------------------------------------------------------------------ 请求层

  /**
   * 发请求并把传输层异常翻译成可读错误。
   * CORS：绿联网关返回 `Access-Control-Allow-Origin: *`，浏览器可直连，不需要代理通道。
   */
  private async send(
    method: "GET" | "POST",
    url: string,
    body: unknown,
    path: string,
    options?: { binary?: boolean },
  ): Promise<UgreenRawResponse> {
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN",
    };
    if (method === "POST") headers["Content-Type"] = "application/json";

    console.info(`[Ugreen] → ${method} ${url}`);
    try {
      const response = await axios.request({
        method,
        url,
        headers,
        data: method === "POST" ? (body ?? {}) : undefined,
        timeout: 20000,
        withCredentials: false,
        validateStatus: () => true,
        responseType: options?.binary ? "arraybuffer" : "text",
        transformResponse: [(data) => data],
      });
      console.info(`[Ugreen] ← ${response.status} ${path}`);
      const responseHeaders: Record<string, string> = {};
      Object.entries(response.headers || {}).forEach(([key, value]) => {
        if (typeof value === "string") responseHeaders[key.toLowerCase()] = value;
      });
      return {
        status: response.status,
        data: response.data,
        contentType: String(response.headers?.["content-type"] || ""),
        headers: responseHeaders,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[Ugreen] ✗ ${method} ${url}`, error);
      const isAbort = detail.includes("abort") || detail.includes("cancel");
      throw new UgreenApiError(
        isAbort ? -2 : -3,
        isAbort
          ? `绿联音乐请求已取消（${path}）`
          : `无法连接绿联音乐服务（${path}）：${detail}。请确认地址和网络是否正确`,
        "http",
      );
    }
  }

  private unwrap<T>(payload: unknown, options?: UgreenRequestOptions): T {
    if (typeof payload === "string") {
      const text = payload.trim();
      if (!text) throw new UgreenApiError(-1, "绿联音乐返回了空响应");
      if (text.startsWith("<")) {
        throw new UgreenApiError(
          -1,
          "绿联音乐返回了非 JSON 内容（通常是地址填错，或该服务不是 UGOS）",
        );
      }
      try {
        payload = JSON.parse(text);
      } catch {
        throw new UgreenApiError(-1, "绿联音乐返回内容无法解析为 JSON");
      }
    }

    const envelope = payload as UgreenEnvelope<T> | undefined;
    if (!envelope || typeof envelope.code !== "number") {
      throw new UgreenApiError(-1, "绿联音乐返回格式异常");
    }
    if (envelope.code === UGREEN_CODES.OK) {
      return envelope.data as T;
    }

    // 登录流程：直接透出服务端 msg（如「账号或密码错误」）
    if (options?.loginFlow) {
      throw new UgreenApiError(
        envelope.code,
        envelope.msg || `绿联登录失败（code=${envelope.code}）`,
        "unauthorized",
      );
    }

    const kind = kindOfCode(envelope.code);
    const fallback = KIND_LABELS[kind];
    throw new UgreenApiError(
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
    options?: UgreenRequestOptions,
  ): Promise<T> {
    const query = toQueryRecord(params);
    // 绿联鉴权 = query 参数 token（api_token）
    const token = options?.skipAuth ? undefined : this.getSessionToken();
    if (token) query.token = token;

    const response = await this.send(
      method,
      `${this.getApiBase()}${path}${toQueryString(query)}`,
      body,
      path,
    );

    if (response.status >= 400) {
      throw new UgreenApiError(
        response.status,
        `绿联音乐请求失败：HTTP ${response.status} ${path}`,
        response.status === 401 ? "unauthorized" : "http",
      );
    }
    return this.unwrap<T>(response.data, options);
  }

  public get<T>(path: string, params?: Record<string, unknown>) {
    return this.request<T>("GET", path, params);
  }

  public post<T>(path: string, body?: unknown, options?: UgreenRequestOptions) {
    return this.request<T>("POST", path, undefined, body, options);
  }

  // ------------------------------------------------------------ 登录预检

  /**
   * `POST /verify/check {username}`：免登录，响应头 `X-Rsa-Token` 是 base64 的
   * RSA 公钥（每次登录都会轮换，不要缓存）。能拿到公钥 + JSON 信封就说明
   * 地址指向一台 UGOS，可直接当作「连接成功」的判据。
   */
  public async fetchRsaPublicKey(username: string): Promise<string> {
    const response = await this.send(
      "POST",
      `${this.getApiBase()}/verify/check`,
      { username },
      "/verify/check",
    );
    if (response.status >= 400) {
      throw new UgreenApiError(
        response.status,
        `绿联音乐连接失败：HTTP ${response.status}`,
        "http",
      );
    }
    // 先解一次信封，确认服务是 UGOS（非 JSON 会在这里抛可读错误）
    this.unwrap<unknown>(response.data);
    const rsaToken = response.headers?.["x-rsa-token"];
    if (!rsaToken) {
      throw new UgreenApiError(-1, "绿联音乐未返回 RSA 公钥（缺少 X-Rsa-Token 响应头）");
    }
    return rsaToken;
  }

  // ---------------------------------------------------------- 媒体地址/内容

  /**
   * 媒体地址（裸 URL，token 已经拼进 query）。
   * 封面/音频都走 `get_file?file_path=...`，音频支持 Range，可直接给
   * `<img src>` / `<audio src>` / AVPlayer 用——绿联媒体接口鉴权就是 query token，
   * 不需要任何请求头代理。
   */
  public buildMediaUrl(filePath: string, updateTime?: number): string {
    const query = toQueryRecord({ file_path: filePath, update_time: updateTime });
    const token = this.getSessionToken();
    if (token) query.token = token;
    return `${this.getApiBase()}/music/get_file${toQueryString(query)}`;
  }

  /** 封面：audio_cover_url / album_cover_url / cover_url 都是 get_file 的 file_path */
  public getCoverUrl(filePath?: string | null, updateTime?: number): string | null {
    const path = String(filePath || "").trim();
    if (!path) return null;
    return this.buildMediaUrl(path, updateTime);
  }

  /** 音频流：直接用曲目的 file_path，支持 Range */
  public getStreamUrl(filePath: string): string {
    return this.buildMediaUrl(filePath);
  }

  /** 拉取歌词等文本文件（get_file 按文本读回） */
  public async fetchTextFile(filePath: string): Promise<string> {
    const response = await this.send(
      "GET",
      this.buildMediaUrl(filePath),
      undefined,
      "/music/get_file",
    );
    if (response.status >= 400) {
      throw new UgreenApiError(
        response.status,
        `绿联音乐媒体请求失败：HTTP ${response.status}`,
        response.status === 401 ? "unauthorized" : "http",
      );
    }
    if (typeof response.data === "string") return response.data;
    if (response.data instanceof ArrayBuffer) {
      return new TextDecoder().decode(response.data);
    }
    throw new UgreenApiError(-1, "绿联音乐媒体响应类型不支持");
  }
}
