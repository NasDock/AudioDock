import { setServiceConfig } from "../../config";
import type { Device, ILoadMoreData, ISuccessResponse, User } from "../../models";
import type { DeviceLoginInfo, IAuthAdapter, IUserAdapter } from "../interface-user-auth";
import { FnosClient, normalizeFnosDeviceId } from "./client";
import { sha256Hex } from "./hash";
import { fnosSecondsToIso, mapFnosTracks, mapFnosUser } from "./mapper";
import { pageTotal, skipToPage } from "./query";
import type { FnosLoginResult, FnosPage, FnosTrack, FnosUser } from "./types";

export class FnosUserAdapter implements IUserAdapter {
  constructor(private client: FnosClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  /** 播放上报：飞牛用 event/report 写历史，payload 复用 track_play 事件 */
  async addToHistory(
    trackId: number | string,
    userId: number | string,
    progress: number = 0,
    deviceName?: string,
    deviceId?: number | string,
  ) {
    try {
      await this.client.post("/event/report", {
        events: [
          {
            eventType: "track_play",
            payload: {
              trackGUID: String(trackId),
              progress,
              deviceName,
              deviceId,
            },
          },
        ],
      });
    } catch (error) {
      // 历史写入失败不能影响播放
      console.warn("[Fnos] 上报播放历史失败", error);
    }
    return this.response(null);
  }

  async getLatestHistory(userId: number | string) {
    try {
      const page = await this.client.get<FnosPage<FnosTrack>>("/play-history/list", {
        page: 1,
        size: 1,
      });
      const raw = page?.list?.[0];
      if (!raw) return this.response(null);
      const [track] = await mapFnosTracks([raw], this.client);
      return this.response({
        id: `${raw.guid}-latest`,
        listenedAt: fnosSecondsToIso(raw.updatedAt || raw.createdAt),
        deviceName: undefined,
        track,
      });
    } catch (error) {
      console.warn("[Fnos] 获取最近播放失败", error);
      return this.response(null);
    }
  }

  async addAlbumToHistory() {
    return this.response(null);
  }

  async getAlbumHistory(
    userId: number | string,
    loadCount: number,
    pageSize: number,
  ) {
    // 飞牛没有专辑维度的播放历史
    return this.response({
      pageSize,
      loadCount,
      list: [] as any[],
      total: 0,
      hasMore: false,
    });
  }

  async getTrackHistory(
    userId: number | string,
    loadCount: number,
    pageSize: number,
  ): Promise<ISuccessResponse<ILoadMoreData<any>>> {
    const safeSize = Math.max(1, pageSize || 20);
    const skip = Math.max(0, loadCount || 0);
    const page = await this.client.get<FnosPage<FnosTrack>>("/play-history/list", {
      page: skipToPage(skip, safeSize),
      size: safeSize,
    });
    const raws = page?.list || [];
    const tracks = await mapFnosTracks(raws, this.client);
    const total = pageTotal(page);
    const list = tracks.map((track, index) => ({
      id: `${track.id}-${skip + index}`,
      listenedAt: fnosSecondsToIso(raws[index]?.updatedAt || raws[index]?.createdAt),
      track,
    }));
    return this.response({
      pageSize: safeSize,
      loadCount: skip + list.length,
      list,
      total,
      hasMore: skip + list.length < total,
    });
  }

  async getUserList() {
    const current = await this.getCurrentUser();
    return this.response(current.data ? [current.data] : []);
  }

  async getCurrentUser(): Promise<ISuccessResponse<User>> {
    try {
      const raw = await this.client.get<FnosUser>("/user/me");
      return this.response(mapFnosUser(raw));
    } catch (error) {
      console.warn("[Fnos] 获取当前用户失败", error);
      return {
        code: 401,
        message: "飞牛音乐未登录",
        data: null as unknown as User,
      };
    }
  }

  /** 飞牛不提供设备列表，播放流转也不支持 */
  async getUserDevices(): Promise<ISuccessResponse<Device[]>> {
    return { code: 200, message: "success", data: [] };
  }

  async transferSession(): Promise<ISuccessResponse<{ delivered: boolean }>> {
    return { code: 500, message: "飞牛音乐数据源不支持播放流转", data: { delivered: false } };
  }

  async uploadUserAvatar() {
    return {
      code: 501,
      message: "飞牛音乐数据源不支持修改头像",
      data: null,
    };
  }
}

export class FnosAuthAdapter implements IAuthAdapter {
  constructor(private client: FnosClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  /**
   * 密码登录（对齐官方客户端 TrimMusicApi.login）：
   *
   * 1. 先打 `GET /sys/config`（免登录）确认地址确实指向一台飞牛音乐，顺便拿到 serverName；
   * 2. `POST /user/password-login`，body = `{ username, password: sha256(明文), deviceId }`，
   *    **不能带 `X-Music-API: v1` 版本头**，也不需要任何逐请求签名；
   * 3. 从 `data.userToken` 取会话 token，之后所有请求以 `Authorization: <token>` 发出（无 Bearer 前缀）。
   */
  async login(user: Partial<User> & DeviceLoginInfo) {
    const username = String(user.username || "").trim();
    const plainPassword = String(user.password || "");
    if (!username || !plainPassword) {
      throw new Error("请填写飞牛账号和密码");
    }

    // 1) 预检：地址/网络/服务类型有问题时，这里就能给出可读错误
    const system = await this.client.getSystemConfig();

    // 2) 登录（对齐官方客户端：password 先 sha256，deviceId 必须是 32 位 hex）
    const password = await sha256Hex(plainPassword);
    const deviceId = user.deviceId
      ? normalizeFnosDeviceId(String(user.deviceId))
      : this.client.getDeviceId();
    const result = await this.client.request<FnosLoginResult>(
      "POST",
      "/user/password-login",
      undefined,
      { username, password, deviceId },
      // 登录接口拿到 120001 表示账号或密码错误，不是会话失效
      { skipVersionHeader: true, skipAuth: true, loginFlow: true },
    );

    const token = result?.userToken;
    if (!token) {
      throw new Error("飞牛音乐登录未返回 userToken，请确认服务端版本");
    }
    this.client.setSessionToken(token);

    // 3) 补一次用户信息（登录返回里通常已经带了）
    let profile: FnosUser | undefined = result?.user;
    if (!profile?.guid) {
      profile = await this.client.get<FnosUser>("/user/me").catch(() => undefined);
    }

    setServiceConfig({
      username,
      password: plainPassword,
      token,
      userId: profile?.guid || username,
    });

    const userId = profile?.guid || username;
    const device: Device = {
      id: 1,
      name: user.deviceName || "飞牛音乐",
      userId,
      isOnline: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Device;

    return this.response({
      id: userId,
      username: profile?.name || username,
      is_admin: profile?.role === "admin",
      avatar: null,
      token,
      device,
      serverName: system?.serverName,
      serverGUID: system?.serverGUID,
      ...(profile ? { user: mapFnosUser(profile) } : {}),
    });
  }

  async register(): Promise<ISuccessResponse<any>> {
    throw new Error("飞牛音乐账号请在 fnOS 系统里创建，不能在这里注册");
  }

  /**
   * 连通性探测：`/sys/config` 免登录且必定返回服务器身份，
   * 能拿到 serverGUID 就说明地址正确且网关活着。
   */
  async check() {
    try {
      const config = await this.client.getSystemConfig();
      return this.response(Boolean(config?.serverGUID));
    } catch (error) {
      console.warn("[Fnos] 连通性探测失败", error);
      return {
        code: 500,
        message: error instanceof Error ? error.message : "飞牛音乐连接失败",
        data: false,
      };
    }
  }

  async hello() {
    return this.response("Hello from Fnos Music Adapter");
  }

  async verifyDevice() {
    return { code: 501, message: "飞牛音乐数据源不支持设备验证", data: false };
  }

  async resetPassword() {
    return { code: 501, message: "飞牛音乐数据源不支持重置密码", data: null };
  }
}
