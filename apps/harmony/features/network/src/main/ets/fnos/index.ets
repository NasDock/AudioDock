import { FnosClient, fnosClient, FnosApiError, resolveFnosServer } from './client';
import type { FnosResolvedServer } from './client';
import { fnosAdapter } from './adapter';
import type { FnosLoginResult, FnosSystemConfig } from './types';

export { FnosClient, fnosClient, FnosApiError, resolveFnosServer };
export type { FnosResolvedServer };
export { fnosAdapter };

/**
 * 飞牛音乐数据源在 hm 端的会话门面。
 *
 * 为什么要有 `active` 这个开关：
 * features_network 里的 trackApi/albumApi/... 是「当前数据源」的统一入口，
 * 但它们不知道用户在选源页选了谁（AuthStore 在 entry 模块，HAR 不能反向依赖）。
 * 所以由 entry 在登录成功 / 冷启动恢复时调用 `enableFnos()`，
 * 各 API 实现里用 `isFnosSource()` 决定转调适配器还是打 AudioDock 服务端。
 */

let active: boolean = false;

export interface FnosSessionInfo {
  origin: string;
  apiBase: string;
  token: string;
  userId: string;
  username: string;
  relayMode: boolean;
}

/** 当前是否处于飞牛音乐数据源模式（各 API 实现的分发依据） */
export function isFnosSource(): boolean {
  return active;
}

export function enableFnos(info: FnosSessionInfo): void {
  fnosClient.setSession(info.origin, info.apiBase, info.token, info.relayMode);
  fnosClient.setIdentity(info.userId, info.username);
  active = true;
}

export function disableFnos(): void {
  fnosClient.reset();
  active = false;
}

/** 把用户输入的地址归一化后取会话所需的 origin/apiBase */
export function resolveFnosAddress(address: string): FnosResolvedServer {
  return resolveFnosServer(address);
}

/**
 * 连通性探测：`/sys/config` 免登录且必定返回服务器身份，
 * 能拿到 serverGUID 就说明地址正确且网关活着。
 */
export async function probeFnos(address: string): Promise<boolean> {
  try {
    const probe: FnosClient = new FnosClient();
    probe.applyAddress(address);
    const config: FnosSystemConfig = await probe.getSystemConfig();
    return config !== null && config !== undefined
      && config.serverGUID !== undefined && config.serverGUID.length > 0;
  } catch (e) {
    return false;
  }
}

export interface FnosLoginOutcome {
  session: FnosSessionInfo;
  serverName: string;
  userToken: string;
  userId: string;
  username: string;
}

/**
 * 登录飞牛音乐：先归一化地址 → `/sys/config` 预检 → 密码登录拿 userToken。
 * 成功后把会话灌进全局客户端并打开 fnos 分发开关，返回落盘所需的信息。
 */
export async function loginFnos(
  address: string,
  username: string,
  password: string,
  deviceSeed: string,
): Promise<FnosLoginOutcome> {
  const probe: FnosClient = new FnosClient();
  const resolved: FnosResolvedServer = probe.applyAddress(address);
  probe.setDeviceSeed(deviceSeed);

  const config: FnosSystemConfig = await probe.getSystemConfig();
  const result: FnosLoginResult = await probe.passwordLogin(username, password, deviceSeed);

  const info: FnosSessionInfo = {
    origin: resolved.origin,
    apiBase: resolved.apiBase,
    token: result.userToken,
    userId: probe.userGuid,
    username: probe.username,
    relayMode: resolved.relayMode,
  };
  enableFnos(info);

  const outcome: FnosLoginOutcome = {
    session: info,
    serverName: config !== null && config !== undefined && config.serverName !== undefined
      ? config.serverName : '',
    userToken: result.userToken,
    userId: probe.userGuid,
    username: probe.username,
  };
  return outcome;
}

/**
 * 判断一个媒体地址是不是飞牛网关上的资源。
 * 飞牛的 `/static/cover`、`/track/stream` 只认 Cookie/Authorization，
 * ArkUI 的 Image 组件加不了请求头，端侧必须自己带鉴权下载。
 */
export function isFnosMediaUrl(url: string): boolean {
  if (!active || url === undefined || url === null || url.length === 0) return false;
  const origin: string = fnosClient.getOrigin();
  if (origin.length === 0) return false;
  return url.startsWith(`${origin}/`);
}

/** 带鉴权拉取飞牛媒体二进制（封面） */
export function fetchFnosMediaBytes(url: string): Promise<ArrayBuffer> {
  return fnosClient.fetchMediaBytes(url);
}

/** 拉某首曲目的 LRC 文本（播放入口在解析队列时补一次，避免列表阶段 N 次请求） */
export function fetchFnosLyrics(trackId: string): Promise<string> {
  return fnosAdapter.lyrics(trackId);
}

/**
 * 播放飞牛音频流需要的请求头。
 *
 * `/track/stream` 只认 Cookie / Authorization，AVPlayer 通过
 * `media.createMediaSourceWithUrl(url, headers)` 透传（见 features/player/AVPlayerBackend）。
 * 这里按需现取，不落到 Track 上 —— 避免 token 被写进播放状态持久化文件。
 *
 * ⚠️ 中继域名（*.fnos.net / *.5ddd.com）必须带 `Cookie: mode=relay`：
 * 少了它网关直接 302 到 FN Connect 登录页，AVPlayer 收到的是 HTML，
 * 报 `5400106 Unsupported Format: CONTAINER_ERR` —— 表现为「点了没声音、还自动跳下一首」。
 * 真实设备（JUY-AL80 / HarmonyOS 7）踩过，别删。
 */
export function getFnosPlaybackHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const cookies: string[] = [];
  if (fnosClient.getRelayMode()) cookies.push('mode=relay');
  const token: string = fnosClient.getToken();
  if (token.length > 0) {
    headers['Authorization'] = token;
    cookies.push(`music-token=${encodeURIComponent(token)}`);
  }
  if (cookies.length > 0) headers['Cookie'] = cookies.join('; ');
  return headers;
}
