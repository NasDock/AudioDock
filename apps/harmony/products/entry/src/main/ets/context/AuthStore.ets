import { kvStore } from 'features_storage';
import { httpClient } from 'features_network';
import { authApi } from 'features_network';
import {
  enableFnos, disableFnos, isFnosSource,
} from 'features_network';
import type { FnosLoginOutcome, FnosSessionInfo } from 'features_network';
import { socketService, SocketConnectOptions, SocketConnectQuery } from 'features_socket';
import { Logger } from 'audiodock_common';
import deviceInfo from '@ohos.deviceInfo';
import type { AuthMe, LoginResponse, LoginDto, RegisterDto } from 'features_network';
import { refreshNetworkMode } from '../utils/networkMode';
import { getDevicePlatform, getOrCreateDeviceId } from '../utils/device';

type Listener = () => void;

/** 飞牛音乐会话（origin/apiBase/token/用户）落盘 key —— 飞牛只保持一个当前会话 */
const FNOS_SESSION_KEY = 'fnos_session';

export type SourceType = 'audiodock' | 'subsonic' | 'emby' | 'fnos';

export interface AuthState {
  user: AuthMe | null;
  token: string | null;
  sourceType: SourceType;
  serverAddress: string;
  /** 设备名（用于同步邀请展示）。初始化时按需通过 ensureDeviceName() 填充。 */
  deviceName: string;
}

const FALLBACK_DEVICE_NAME = 'HarmonyOS Device';

export class AuthStore {
  private state: AuthState = {
    user: null,
    token: null,
    sourceType: 'audiodock',
    serverAddress: '',
    deviceName: FALLBACK_DEVICE_NAME,
  };
  private listeners = new Set<Listener>();

  get state_(): AuthState { return this.state; }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private defaultState(): AuthState {
    return {
      user: null,
      token: null,
      sourceType: this.state.sourceType,
      serverAddress: '',
      deviceName: this.state.deviceName,
    };
  }

  async loadFromStorage(): Promise<void> {
    const url = await kvStore.get('serverAddress');
    const sourceType = (await kvStore.get('selectedSourceType')) as SourceType | null;
    // 飞牛音乐：AudioDock 的 token/baseURL 都不适用，单独恢复一份会话
    if (sourceType === 'fnos') {
      await this.restoreFnosSession();
      return;
    }
    if (url) {
      httpClient.setBaseURL(url);
      const normalized = httpClient.getBaseURL();
      const token = await kvStore.get(`token_${normalized}`);
      const userRaw = await kvStore.get(`user_${normalized}`);
      let user: AuthMe | null = null;
      if (userRaw) {
        try {
          user = JSON.parse(userRaw) as AuthMe;
        } catch {
          user = null;
        }
      }
      this.state = {
        serverAddress: normalized,
        sourceType: sourceType ?? 'audiodock',
        token,
        user,
        deviceName: this.state.deviceName,
      };
      httpClient.setAuthToken(token);
    }
    // 服务器地址恢复后重新判定内网/外网（封面分级加载依赖它）
    await refreshNetworkMode();
  }

  async login(dto: LoginDto): Promise<void> {
    const res = await authApi.login(await this.withDeviceInfo(dto));
    await this.persist(res);
  }

  // ────────────────────────────────────────────────────────────
  // 飞牛音乐（fnos）会话
  // ────────────────────────────────────────────────────────────

  /**
   * 登录成功后应用飞牛会话：
   * 1. 打开 features_network 的分发开关（trackApi 等直接转调飞牛适配器）
   * 2. 内存 state 对齐 page 层的 sourceType/user 判定
   * 3. 会话落盘，供冷启动恢复
   */
  async applyFnosSession(outcome: FnosLoginOutcome): Promise<void> {
    const info: FnosSessionInfo = outcome.session;
    enableFnos(info);
    const user: AuthMe = { id: outcome.userId, username: outcome.username };
    this.state = {
      serverAddress: info.origin,
      sourceType: 'fnos',
      token: info.token,
      user: user,
      deviceName: this.state.deviceName,
    };
    await kvStore.set('serverAddress', info.origin);
    await kvStore.set('selectedSourceType', 'fnos');
    await kvStore.set(FNOS_SESSION_KEY, JSON.stringify(info));
    this.notify();
  }

  /** 冷启动恢复飞牛会话；没有落盘会话时什么也不做（页面会兜底回登录页） */
  async restoreFnosSession(): Promise<void> {
    try {
      const raw = await kvStore.get(FNOS_SESSION_KEY);
      if (raw === null || raw.length === 0) return;
      const info: FnosSessionInfo = JSON.parse(raw) as FnosSessionInfo;
      if (info.origin === undefined || info.origin.length === 0) return;
      enableFnos(info);
      const user: AuthMe = { id: info.userId, username: info.username };
      this.state = {
        serverAddress: info.origin,
        sourceType: 'fnos',
        token: info.token,
        user: user,
        deviceName: this.state.deviceName,
      };
      Logger.i('AuthStore', `restoreFnosSession origin=${info.origin} user=${info.username}`);
      this.notify();
    } catch (e) {
      Logger.w('AuthStore', `restoreFnosSession failed: ${String(e)}`);
    }
  }

  /** 清除飞牛会话（退出登录 / 切回 AudioDock 源时调用） */
  async clearFnosSession(): Promise<void> {
    disableFnos();
    await kvStore.delete(FNOS_SESSION_KEY).catch((): void => undefined);
  }

  /**
   * 从飞牛音乐切回 AudioDock 系数据源（AudioDock / Subsonic / Emby）前调用：
   * 关掉 fnos 分发开关并复位 sourceType，否则随后的 switchServer 会被 fnos 分支拦下。
   */
  async leaveFnosSource(): Promise<void> {
    if (!isFnosSource() && this.state.sourceType !== 'fnos') return;
    await this.clearFnosSession();
    this.state = {
      user: null,
      token: null,
      sourceType: 'audiodock',
      serverAddress: '',
      deviceName: this.state.deviceName,
    };
    this.notify();
  }

  async register(dto: RegisterDto): Promise<void> {
    const res = await authApi.register(await this.withDeviceInfo(dto));
    await this.persist(res);
  }

  /** 给登录/注册 DTO 注入设备信息（deviceName / deviceId / platform） */
  private async withDeviceInfo<T extends LoginDto | RegisterDto>(dto: T): Promise<T> {
    dto.deviceName = dto.deviceName ?? this.resolveDeviceName();
    dto.deviceId = await getOrCreateDeviceId();
    dto.platform = getDevicePlatform();
    return dto;
  }

  async logout(): Promise<void> {
    const url = this.state.serverAddress;
    // 飞牛音乐没有 AudioDock 的 token/user 存储，走自己的清理
    if (isFnosSource() || this.state.sourceType === 'fnos') {
      await this.clearFnosSession();
      // 选源状态一并清掉：退出后应回到默认的 AudioDock 登录页
      await kvStore.delete('selectedSourceType').catch((): void => undefined);
      await kvStore.delete('serverAddress').catch((): void => undefined);
      socketService.disconnect();
      this.state = this.defaultState();
      this.notify();
      return;
    }
    if (!url) return;
    await kvStore.delete(`token_${url}`);
    await kvStore.delete(`user_${url}`);
    await kvStore.delete(`device_${url}`);
    httpClient.setAuthToken(null);
    socketService.disconnect();
    this.state = this.defaultState();
    this.notify();
  }

  async switchServer(url: string): Promise<void> {
    // 飞牛音乐：没有 AudioDock 的登录态概念，切地址等同于重新登录，
    // 这里清掉旧的 fnos 会话并打开开关交给 SourceManagePage 引导去登录页。
    if (this.state.sourceType === 'fnos') {
      await this.clearFnosSession();
      this.state = this.defaultState();
      this.notify();
      return;
    }
    httpClient.setBaseURL(url);
    const normalized = httpClient.getBaseURL();
    const token = await kvStore.get(`token_${normalized}`);
    const userRaw = await kvStore.get(`user_${normalized}`);
    this.state = {
      serverAddress: normalized,
      sourceType: this.state.sourceType,
      token,
      user: userRaw ? JSON.parse(userRaw) as AuthMe : null,
      deviceName: this.state.deviceName,
    };
    httpClient.setAuthToken(token);
    await kvStore.set('serverAddress', normalized);
    // 切了服务器就要重新判定内网/外网，否则封面会继续用旧网络环境下的 URL
    await refreshNetworkMode();
    this.notify();
  }

  private async persist(res: LoginResponse): Promise<void> {
    const url = httpClient.getBaseURL();
    const user: AuthMe = {
      id: String(res.id),
      username: res.username,
      nickname: res.nickname,
      avatar: res.avatar,
    };
    this.state = {
      serverAddress: url,
      sourceType: this.state.sourceType,
      token: res.token,
      user: user,
      deviceName: this.state.deviceName,
    };
    await kvStore.set(`token_${url}`, res.token);
    await kvStore.set(`user_${url}`, JSON.stringify(user));
    if (res.device) await kvStore.set(`device_${url}`, String(res.device.id));
    httpClient.setAuthToken(res.token);
    this.notify();
  }

  /**
   * 头像上传后更新当前用户头像：同步内存 state + 落盘 kvStore（user_{url}）+ 通知订阅者。
   * 对齐 mobile personal.tsx 上传成功后写 AsyncStorage user_{baseUrl}。
   */
  async updateAvatar(avatarUrl: string): Promise<void> {
    const url = this.state.serverAddress;
    const current = this.state.user;
    if (!url || !current) return;
    const next: AuthMe = {
      id: current.id,
      username: current.username,
      nickname: current.nickname,
      avatar: avatarUrl,
    };
    this.state.user = next;
    await kvStore.set(`user_${url}`, JSON.stringify(next)).catch((): void => undefined);
    this.notify();
  }

  // ────────────────────────────────────────────────────────────
  // 同步播放 socket 连接管理（对齐 mobile socketService.connectWithContext）
  // ────────────────────────────────────────────────────────────

  /**
   * 取一个友好的设备名（marketName > productModel > deviceType > 兜底字符串）。
   * 对齐 mobile 的 `Device.modelName || "Mobile Device"`。
   */
  resolveDeviceName(): string {
    try {
      // @ohos.deviceInfo 只提供默认导出，ArkTS 不允许对其 namespace 做 cast；
      // 直接读取三个属性并 String() 兜底，遇到任何异常退回 FALLBACK_DEVICE_NAME。
      const market: string = String(deviceInfo.marketName ?? '');
      const model: string = String(deviceInfo.productModel ?? '');
      const type: string = String(deviceInfo.deviceType ?? '');
      return market || model || type || FALLBACK_DEVICE_NAME;
    } catch {
      return FALLBACK_DEVICE_NAME;
    }
  }

  /**
   * 登录态变化（token/user 就绪）后调用：建立 socket 连接。
   * 幂等：已连接则直接返回；切换账号/重新登录由调用方先 disconnectSyncSocket 再 connect。
   */
  async connectSyncSocket(): Promise<void> {
    // 飞牛音乐不是 AudioDock 服务端，没有 sync socket 网关
    if (this.state.sourceType === 'fnos') return;
    if (socketService.isConnected()) return;
    const user = this.state.user;
    const token = this.state.token;
    const url = this.state.serverAddress;
    if (!user || !token || !url) {
      Logger.w('AuthStore', `connectSyncSocket skipped: user=${user ? 'ok' : 'null'} token=${token ? 'ok' : 'null'} url=${url ?? 'null'}`);
      return;
    }
    const name = this.resolveDeviceName();
    this.state.deviceName = name;
    try {
      const deviceId = await getOrCreateDeviceId();
      Logger.i('AuthStore', `connectSyncSocket: deviceId=${deviceId} deviceName=${name} url=${url}`);
      const query = new SocketConnectQuery();
      query.deviceId = deviceId;
      query.platform = getDevicePlatform();
      const opts = new SocketConnectOptions();
      opts.url = url;
      opts.token = token;
      opts.userId = user.id;
      opts.deviceName = name;
      opts.query = query;
      await socketService.connect(opts);
    } catch (e) {
      Logger.w('AuthStore', `connectSyncSocket failed: ${String(e)}`);
      // 同步 socket 连接失败不应阻塞主流程；PlayerStore 在未连接时也不会广播，
      // 收到 sync_event 时无 listener 直接忽略。
      // 这里仅日志，由重连机制（HarmonySocketService 内部）兜底。
    }
  }

  disconnectSyncSocket(): void {
    socketService.disconnect();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

export const authStore: AuthStore = new AuthStore();