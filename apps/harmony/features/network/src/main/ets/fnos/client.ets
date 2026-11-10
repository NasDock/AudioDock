import http from '@ohos.net.http';
import { Logger } from 'audiodock_common';
import { normalizeFnosDeviceId, sha256Hex } from './crypto';
import type {
  FnosCoverResolver, FnosEnvelope, FnosLoginResult, FnosPasswordLoginBody, FnosSystemConfig,
} from './types';

const TAG = 'FnosClient';

// ---------------------------------------------------------------- 错误与状态码

/**
 * 飞牛网关错误码（对齐官方客户端 ApiDecoder.mapCode）：
 * - 99999 / 120001 未登录或会话失效
 * - 120002 账号被禁用
 * - 100004 曲目不可用（无权限/文件丢失）
 * - 100005 资源不存在
 */
export interface FnosCodes {
  OK: number;
  INVALID_TOKEN: number;
  SESSION_EXPIRED: number;
  ACCOUNT_DISABLED: number;
  TRACK_UNAVAILABLE: number;
  NOT_FOUND: number;
}

export const FNOS_CODES: FnosCodes = {
  OK: 0,
  INVALID_TOKEN: 99999,
  SESSION_EXPIRED: 120001,
  ACCOUNT_DISABLED: 120002,
  TRACK_UNAVAILABLE: 100004,
  NOT_FOUND: 100005,
};

export type FnosErrorKind =
  'unauthorized' | 'account-disabled' | 'not-found' | 'track-unavailable' | 'http' | 'unknown';

const KIND_LABELS: Record<string, string> = {
  'unauthorized': '飞牛音乐登录已失效，请重新登录',
  'account-disabled': '飞牛音乐账号已被禁用',
  'not-found': '飞牛音乐中找不到该资源',
  'track-unavailable': '该曲目在飞牛音乐中不可用（无权限或文件已丢失）',
  'http': '飞牛音乐请求失败',
  'unknown': '飞牛音乐接口错误',
};

function kindOfCode(code: number): FnosErrorKind {
  if (code === FNOS_CODES.INVALID_TOKEN || code === FNOS_CODES.SESSION_EXPIRED) return 'unauthorized';
  if (code === FNOS_CODES.ACCOUNT_DISABLED) return 'account-disabled';
  if (code === FNOS_CODES.TRACK_UNAVAILABLE) return 'track-unavailable';
  if (code === FNOS_CODES.NOT_FOUND) return 'not-found';
  return 'unknown';
}

/** 飞牛接口错误：code 非 0 时抛出，kind 便于上层判断要不要踢回登录页 */
export class FnosApiError extends Error {
  code: number;
  kind: FnosErrorKind;

  constructor(code: number, message: string, kind: FnosErrorKind = 'unknown') {
    super(message);
    this.name = 'FnosApiError';
    this.code = code;
    this.kind = kind;
  }

  isUnauthorized(): boolean {
    return this.kind === 'unauthorized';
  }
}

// ------------------------------------------------------------------ 地址归一化

const DEFAULT_API_PATH: string = '/music/api/v1';
const FNOS_DEFAULT_HTTP_PORT: string = '5666';
const RELAY_HOST_PATTERN: RegExp = /\.(fnos\.net|5ddd\.com)$/i;

export interface FnosResolvedServer {
  /** 协议 + host + 端口，无路径，如 http://192.168.1.10:5666 */
  origin: string;
  /** 网关根地址，如 http://192.168.1.10:5666/music/api/v1 */
  apiBase: string;
  /** 是否 FN Connect 中继（需要 Cookie: mode=relay） */
  relayMode: boolean;
  host: string;
}

interface ParsedAddr {
  scheme: string;
  host: string;
  port: string;
  path: string;
}

/** ArkTS 没有 URL 类，手写拆解（与 utils/trackQuality.ets 同思路，但要拿到端口与路径） */
function parseAddr(value: string): ParsedAddr {
  const schemeIdx: number = value.indexOf('://');
  const scheme: string = schemeIdx >= 0 ? value.substring(0, schemeIdx).toLowerCase() : '';
  let rest: string = schemeIdx >= 0 ? value.substring(schemeIdx + 3) : value;

  // 去掉 userinfo
  const at: number = rest.indexOf('@');
  if (at >= 0) rest = rest.substring(at + 1);

  // 拆路径 / query
  let path: string = '';
  const stop: number = firstIndexOfAny(rest, ['/', '?', '#']);
  if (stop >= 0) {
    path = rest.substring(stop);
    rest = rest.substring(0, stop);
  }

  let port: string = '';
  if (rest.startsWith('[')) {
    // IPv6：[::1]:5666
    const end: number = rest.indexOf(']');
    if (end > 0) {
      const after: string = rest.substring(end + 1);
      if (after.startsWith(':')) port = after.substring(1);
      rest = rest.substring(0, end + 1);
    }
  } else {
    const colon: number = rest.lastIndexOf(':');
    if (colon >= 0) {
      port = rest.substring(colon + 1);
      rest = rest.substring(0, colon);
    }
  }

  return { scheme: scheme, host: rest, port: port, path: path };
}

function firstIndexOfAny(value: string, chars: string[]): number {
  let found: number = -1;
  for (let i = 0; i < chars.length; i++) {
    const idx: number = value.indexOf(chars[i]);
    if (idx >= 0 && (found < 0 || idx < found)) found = idx;
  }
  return found;
}

/**
 * 归一化用户输入的地址（对齐 desktop 的 resolveFnosServer）：
 * - 缺协议补 http://
 * - 去掉尾部斜杠，并把误粘的 `/music`、`/api/v1`、`/music/api/v1` 去掉
 * - 没有显式端口时：https 用 443（不写），显式 http:// 用 80（不写），裸地址用 5666
 * - host 是 fnos.net / 5ddd.com 时判定为中继模式
 */
export function resolveFnosServer(raw: string): FnosResolvedServer {
  const value: string = (raw || '').trim();
  if (value.length === 0) {
    throw new Error('飞牛音乐未配置服务器地址');
  }

  const schemeMatch: RegExpMatchArray | null = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\//);
  const hasScheme: boolean = schemeMatch !== null;
  if (hasScheme) {
    const proto: string = schemeMatch !== null ? schemeMatch[1].toLowerCase() : '';
    if (proto !== 'http' && proto !== 'https') {
      throw new Error(`不支持的协议：${proto}://，飞牛音乐只支持 http/https`);
    }
  }

  const withScheme: string = hasScheme ? value : `http://${value}`;
  const parsed: ParsedAddr = parseAddr(withScheme);
  if (parsed.host.length === 0) {
    throw new Error('飞牛音乐服务器地址缺少主机名');
  }

  // 去掉误粘的路径尾巴
  let apiPath: string = parsed.path.replace(/\/+$/, '');
  if (/\/music\/api\/v1$/i.test(apiPath)) {
    apiPath = apiPath.replace(/\/music\/api\/v1$/i, '');
  } else if (/\/api\/v1$/i.test(apiPath)) {
    apiPath = apiPath.replace(/\/api\/v1$/i, '');
  }
  if (/\/music$/i.test(apiPath)) {
    apiPath = apiPath.replace(/\/music$/i, '');
  }
  if (apiPath === '/') apiPath = '';

  let scheme: string = parsed.scheme;
  if (!hasScheme && parsed.port.length === 0 && RELAY_HOST_PATTERN.test(parsed.host)) {
    scheme = 'https';
  }

  let port: string = parsed.port;
  if (port.length === 0) {
    if (scheme === 'https' || hasScheme) {
      // https 默认 443、显式 http:// 默认 80，都不写进 origin
      port = '';
    } else {
      port = FNOS_DEFAULT_HTTP_PORT;
    }
  }

  const host: string = port.length > 0 ? `${parsed.host}:${port}` : parsed.host;
  const origin: string = `${scheme}://${host}`;

  return {
    origin: origin,
    apiBase: `${origin}${apiPath}${DEFAULT_API_PATH}`,
    relayMode: RELAY_HOST_PATTERN.test(parsed.host),
    host: parsed.host,
  };
}

// -------------------------------------------------------------------- 请求层

export interface FnosRequestOptions {
  /** 不附带 Authorization（登录 / 预热接口） */
  skipAuth?: boolean;
  /** 登录流程：此时的 120001 其实是「账号或密码错误」 */
  loginFlow?: boolean;
}

function toQueryString(params?: Record<string, string | number | boolean>): string {
  if (params === undefined || params === null) return '';
  const keys: string[] = Object.keys(params);
  const parts: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key: string = keys[i];
    const raw = params[key];
    if (raw === undefined || raw === null) continue;
    const text: string = `${raw}`;
    if (text.length === 0) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(text)}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/**
 * query 构造器。
 *
 * ArkTS 禁止无类型对象字面量，`{ page: 1, size: 20 }` 这样直接传给
 * `Record<string, string | number | boolean>` 会报 arkts-no-untyped-obj-literals，
 * 统一用这个链式构造器拼参数，调用点也更短。
 */
export class FnosQuery {
  private q: Record<string, string | number | boolean> = {};

  set(key: string, value: string | number | boolean): FnosQuery {
    this.q[key] = value;
    return this;
  }

  build(): Record<string, string | number | boolean> {
    return this.q;
  }
}

/**
 * 飞牛音乐客户端（ArkTS 版）。
 *
 * 与 desktop 的差异：
 * - desktop 需要 `setFnosTransport()` 注入 Tauri 的 fetch 绕 CORS，鸿蒙原生 http 不受限制；
 * - authx 逐请求签名依赖两个飞牛前端内置常量，实测 1.1.19 的服务端不校验，
 *   这里不实现签名（desktop 也是「没配常量就不签」）；
 * - 会话 token 由外部（AuthStore）落盘后通过 setSession() 注入，客户端自身不碰存储
 *   （features_network 不依赖 features_storage）。
 */
export class FnosClient implements FnosCoverResolver {
  private origin: string = '';
  private apiBase: string = '';
  private token: string = '';
  private relayMode: boolean = false;
  private deviceSeed: string = '';
  /** 飞牛当前登录用户的 guid（登录后写入） */
  userGuid: string = '';
  username: string = '';

  /** 用用户输入的地址初始化（会做归一化，凭据另行注入） */
  applyAddress(raw: string): FnosResolvedServer {
    const resolved: FnosResolvedServer = resolveFnosServer(raw);
    this.origin = resolved.origin;
    this.apiBase = resolved.apiBase;
    this.relayMode = resolved.relayMode;
    return resolved;
  }

  /** 恢复已登录会话：origin/apiBase/token 一起灌进来 */
  setSession(origin: string, apiBase: string, token: string, relayMode: boolean): void {
    this.origin = origin;
    this.apiBase = apiBase;
    this.token = token;
    this.relayMode = relayMode;
  }

  setToken(token: string): void {
    this.token = token;
  }

  setIdentity(userGuid: string, username: string): void {
    this.userGuid = userGuid;
    this.username = username;
  }

  /** 稳定设备标识种子（登录上报的 deviceId 由它摘要而来） */
  setDeviceSeed(seed: string): void {
    this.deviceSeed = seed;
  }

  isReady(): boolean {
    return this.apiBase.length > 0;
  }

  getOrigin(): string {
    return this.origin;
  }

  getApiBase(): string {
    return this.apiBase;
  }

  getToken(): string {
    return this.token;
  }

  /** 中继模式（*.fnos.net / *.5ddd.com）：媒体请求也必须带 `Cookie: mode=relay` */
  getRelayMode(): boolean {
    return this.relayMode;
  }

  reset(): void {
    this.origin = '';
    this.apiBase = '';
    this.token = '';
    this.relayMode = false;
    this.userGuid = '';
    this.username = '';
  }

  private buildHeaders(skipAuth: boolean, hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN',
    };
    // 官方实现只用 Cookie 传会话：Cookie: music-token=<token>；
    // 中继模式还要多带 mode=relay，否则网关 302 到 FN Connect 登录页。
    // Authorization 保留一份，兼容只认请求头的服务端版本（两种方式 desktop 实测都通）。
    const cookies: string[] = [];
    if (this.relayMode) cookies.push('mode=relay');
    if (!skipAuth && this.token.length > 0) {
      headers['Authorization'] = this.token;
      cookies.push(`music-token=${encodeURIComponent(this.token)}`);
    }
    if (cookies.length > 0) headers['Cookie'] = cookies.join('; ');
    if (hasBody) headers['Content-Type'] = 'application/json';
    return headers;
  }

  private unwrap<T>(text: string, options?: FnosRequestOptions): T {
    const trimmed: string = (text || '').trim();
    if (trimmed.length === 0) {
      throw new FnosApiError(-1, '飞牛音乐返回了空响应');
    }
    // 未登录 / 中继未放行时网关会返回登录页 HTML
    if (trimmed.startsWith('<')) {
      throw new FnosApiError(-1, '飞牛音乐返回了非 JSON 内容（通常是地址填错、中继未放行，或服务不是飞牛音乐）');
    }
    let envelope: FnosEnvelope<T>;
    try {
      envelope = JSON.parse(trimmed) as FnosEnvelope<T>;
    } catch (e) {
      throw new FnosApiError(-1, '飞牛音乐返回内容无法解析为 JSON');
    }
    if (envelope === null || envelope === undefined || typeof envelope.code !== 'number') {
      throw new FnosApiError(-1, '飞牛音乐返回格式异常');
    }
    if (envelope.code === FNOS_CODES.OK) {
      return envelope.data;
    }

    const loginFlow: boolean = options !== undefined && options.loginFlow === true;
    if (loginFlow && envelope.code === FNOS_CODES.SESSION_EXPIRED) {
      throw new FnosApiError(envelope.code, '飞牛音乐账号或密码错误', 'unauthorized');
    }

    const kind: FnosErrorKind = kindOfCode(envelope.code);
    const fallback: string = KIND_LABELS[kind];
    const msg: string = envelope.msg !== undefined && envelope.msg.length > 0
      ? `${fallback}（${envelope.msg}）`
      : `${fallback}（code=${envelope.code}）`;
    throw new FnosApiError(envelope.code, msg, kind);
  }

  /** 发 JSON 请求并拆信封 */
  async request<T>(
    method: string,
    path: string,
    params?: Record<string, string | number | boolean>,
    body?: Object,
    options?: FnosRequestOptions,
  ): Promise<T> {
    if (!this.isReady()) {
      throw new FnosApiError(-1, '飞牛音乐未配置服务器地址');
    }
    const url: string = `${this.apiBase}${path}${toQueryString(params)}`;
    const isPost: boolean = method === 'POST';
    const skipAuth: boolean = options !== undefined && options.skipAuth === true;
    const opts: http.HttpRequestOptions = {
      method: isPost ? http.RequestMethod.POST : http.RequestMethod.GET,
      header: this.buildHeaders(skipAuth, isPost),
      expectDataType: http.HttpDataType.STRING,
      connectTimeout: 10000,
      readTimeout: 20000,
    };
    if (isPost) {
      opts.extraData = JSON.stringify(body === undefined ? {} : body);
    }

    const request: http.HttpRequest = http.createHttp();
    try {
      const response: http.HttpResponse = await request.request(url, opts);
      const code: number = response.responseCode;
      const text: string = typeof response.result === 'string'
        ? response.result
        : JSON.stringify(response.result);

      if (code >= 300 && code < 400) {
        throw new FnosApiError(code,
          '飞牛音乐返回重定向，通常是 FN Connect 中继未放行（Cookie: mode=relay 丢失）或会话已失效',
          'unauthorized');
      }
      if (code === 401) {
        const loginFlow: boolean = options !== undefined && options.loginFlow === true;
        throw new FnosApiError(FNOS_CODES.INVALID_TOKEN,
          loginFlow ? '飞牛音乐账号或密码错误' : KIND_LABELS['unauthorized'],
          'unauthorized');
      }
      if (code >= 400) {
        throw new FnosApiError(code, `飞牛音乐请求失败：HTTP ${code} ${path}`, 'http');
      }
      return this.unwrap<T>(text, options);
    } catch (e) {
      if (e instanceof FnosApiError) throw e;
      const detail: string = e instanceof Error ? e.message : String(e);
      Logger.w(TAG, `✗ ${method} ${url} ${detail}`);
      throw new FnosApiError(-3, `无法连接飞牛音乐服务（${path}）：${detail}。请确认地址与网络`, 'http');
    } finally {
      request.destroy();
    }
  }

  get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
    return this.request<T>('GET', path, params);
  }

  post<T>(path: string, body?: Object, options?: FnosRequestOptions): Promise<T> {
    return this.request<T>('POST', path, undefined, body, options);
  }

  // ------------------------------------------------------------------ 服务端

  /**
   * 服务端配置：**免登录**接口，用来在做登录前确认地址是否指向一台飞牛音乐服务。
   * 返回 serverGUID / serverName，可直接当作「连接成功」的判据。
   */
  getSystemConfig(): Promise<FnosSystemConfig> {
    const options: FnosRequestOptions = { skipAuth: true };
    return this.request<FnosSystemConfig>('GET', '/sys/config', undefined, undefined, options);
  }

  /** 密码登录：password 必须是 SHA-256(明文) 的小写十六进制 */
  async passwordLogin(username: string, password: string, deviceSeed: string): Promise<FnosLoginResult> {
    const user: string = (username || '').trim();
    if (user.length === 0 || (password || '').length === 0) {
      throw new Error('请填写飞牛账号和密码');
    }
    // 1) 预检：地址/网络/服务类型有问题时，这里就能给出可读错误
    await this.getSystemConfig();

    // 2) 登录（对齐官方客户端：password 先摘要，deviceId 必须 32 位 hex）
    const hashed: string = await sha256Hex(password);
    const deviceId: string = await normalizeFnosDeviceId(deviceSeed);
    const payload: FnosPasswordLoginBody = {
      username: user,
      password: hashed,
      deviceId: deviceId,
    };
    const options: FnosRequestOptions = { skipAuth: true, loginFlow: true };
    const result: FnosLoginResult =
      await this.request<FnosLoginResult>('POST', '/user/password-login', undefined, payload, options);

    const token: string = result !== null && result !== undefined ? result.userToken : '';
    if (token === undefined || token === null || token.length === 0) {
      throw new Error('飞牛音乐登录未返回 userToken，请确认服务端版本');
    }
    this.token = token;

    const guid: string = result.user !== undefined && result.user !== null ? result.user.guid : '';
    const name: string = result.user !== undefined && result.user !== null ? result.user.name : '';
    this.userGuid = guid.length > 0 ? guid : user;
    this.username = name.length > 0 ? name : user;
    return result;
  }

  // -------------------------------------------------------------------- 媒体

  /** 封面地址：coverId 形如 track_xxx / album_xxx / artist_xxx */
  coverUrl(coverId: string, size: number): string {
    const params: Record<string, string | number | boolean> =
      new FnosQuery().set('coverId', coverId).set('size', size).build();
    return `${this.apiBase}/static/cover${toQueryString(params)}`;
  }

  /** 音频流地址（支持 Range，可 seek） */
  streamUrl(guid: string): string {
    const params: Record<string, string | number | boolean> =
      new FnosQuery().set('guid', guid).build();
    return `${this.apiBase}/track/stream${toQueryString(params)}`;
  }

  /**
   * 拉媒体二进制（封面）。`/static/cover`、`/track/stream` 只认 Cookie / Authorization，
   * ArkUI 的 Image 组件加不了请求头，必须由端侧带鉴权下载后再落盘给 Image 用。
   */
  async fetchMediaBytes(url: string): Promise<ArrayBuffer> {
    const options: http.HttpRequestOptions = {
      method: http.RequestMethod.GET,
      header: this.buildHeaders(false, false),
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
      connectTimeout: 10000,
      readTimeout: 30000,
    };
    const request: http.HttpRequest = http.createHttp();
    try {
      const response: http.HttpResponse = await request.request(url, options);
      if (response.responseCode !== 200 && response.responseCode !== 206) {
        throw new FnosApiError(response.responseCode,
          `飞牛音乐媒体请求失败：HTTP ${response.responseCode}`,
          response.responseCode === 401 ? 'unauthorized' : 'http');
      }
      return response.result as ArrayBuffer;
    } finally {
      request.destroy();
    }
  }
}

/** 全局单例：整个 App 只有一个飞牛会话 */
export const fnosClient: FnosClient = new FnosClient();
