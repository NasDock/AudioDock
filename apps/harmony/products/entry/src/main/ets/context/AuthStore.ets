import { kvStore } from 'features_storage';
import { httpClient } from 'features_network';
import { authApi } from 'features_network';
import { socketService, SocketConnectOptions, SocketConnectQuery } from 'features_socket';
import deviceInfo from '@ohos.deviceInfo';
import type { AuthMe, LoginResponse, LoginDto, RegisterDto } from 'features_network';
import { refreshNetworkMode } from '../utils/networkMode';
import { getDevicePlatform, getOrCreateDeviceId } from '../utils/device';

type Listener = () => void;

export type SourceType = 'audiodock' | 'subsonic' | 'emby';

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
    if (socketService.isConnected()) return;
    const user = this.state.user;
    const token = this.state.token;
    const url = this.state.serverAddress;
    if (!user || !token || !url) return;
    const name = this.resolveDeviceName();
    this.state.deviceName = name;
    try {
      const deviceId = await getOrCreateDeviceId();
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