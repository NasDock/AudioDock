import { getServiceConfig, setServiceConfig } from "../../config";
import type { Device, ILoadMoreData, ISuccessResponse, User } from "../../models";
import {
  getPlatformUserDevices,
  platformTransferSession,
} from "../../platform";
import type { DeviceLoginInfo, IAuthAdapter, IUserAdapter, TransferSessionPayload } from "../interface-user-auth";
import { UgreenClient } from "./client";
import { mapUgreenTracks, mapUgreenUser, ugreenSecondsToIso } from "./mapper";
import { rsaEncryptBase64 } from "./rsa";
import { pageHasMore, pageTotal, skipToPage, UGREEN_SORT } from "./query";
import type {
  UgreenCurrentUser,
  UgreenLoginResult,
  UgreenRecentlyPlayed,
} from "./types";

export class UgreenUserAdapter implements IUserAdapter {
  constructor(private client: UgreenClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  /** 播放上报：绿联用 recently_played/add 写历史，失败不能影响播放 */
  async addToHistory(trackId: number | string) {
    try {
      await this.client.post("/music/recently_played/add", { audio_id: Number(trackId) });
    } catch (error) {
      console.warn("[Ugreen] 上报播放历史失败", error);
    }
    return this.response(null);
  }

  async getLatestHistory(_userId: number | string) {
    try {
      const page = await this.client.get<UgreenRecentlyPlayed>("/music/recently_played");
      const raw = page?.file_arr?.[0];
      if (!raw) return this.response(null);
      const [track] = mapUgreenTracks([raw], this.client);
      return this.response({
        id: `${raw.audio_id}-latest`,
        listenedAt: ugreenSecondsToIso(raw.update_time || raw.file_move_time),
        deviceName: undefined,
        track,
      });
    } catch (error) {
      console.warn("[Ugreen] 获取最近播放失败", error);
      return this.response(null);
    }
  }

  async addAlbumToHistory() {
    return this.response(null);
  }

  async getAlbumHistory(
    _userId: number | string,
    loadCount: number,
    pageSize: number,
  ) {
    // 绿联没有专辑维度的播放历史
    return this.response({
      pageSize,
      loadCount,
      list: [] as any[],
      total: 0,
      hasMore: false,
    });
  }

  /**
   * 播放历史：recently_played 没有分页参数（全量返回，total_num≈500），端侧切片。
   */
  async getTrackHistory(
    _userId: number | string,
    loadCount: number,
    pageSize: number,
  ): Promise<ISuccessResponse<ILoadMoreData<any>>> {
    const safeSize = Math.max(1, pageSize || 20);
    const skip = Math.max(0, loadCount || 0);
    const page = await this.client.get<UgreenRecentlyPlayed>("/music/recently_played");
    const raws = page?.file_arr || [];
    const total = pageTotal(page, raws.length);
    const tracks = mapUgreenTracks(raws.slice(skip, skip + safeSize), this.client);
    const list = tracks.map((track, index) => ({
      id: `${track.id}-${skip + index}`,
      listenedAt: ugreenSecondsToIso(
        raws[skip + index]?.update_time || raws[skip + index]?.file_move_time,
      ),
      track,
    }));
    return this.response({
      pageSize: safeSize,
      loadCount: skip + list.length,
      list,
      total,
      hasMore: pageHasMore(page, skip + list.length),
    });
  }

  async getUserList() {
    const current = await this.getCurrentUser();
    return this.response(current.data ? [current.data] : []);
  }

  async getCurrentUser(): Promise<ISuccessResponse<User>> {
    try {
      const raw = await this.client.get<UgreenCurrentUser>("/user/current/user");
      return this.response(mapUgreenUser(raw));
    } catch (error) {
      console.warn("[Ugreen] 获取当前用户失败", error);
      return {
        code: 401,
        message: "绿联音乐未登录",
        data: null as unknown as User,
      };
    }
  }

  /**
   * 设备列表/播放流转是 AudioDock 服务端的账号体系能力，与音乐源无关（同飞牛策略）。
   */
  async getUserDevices(): Promise<ISuccessResponse<Device[]>> {
    const platformRes = await getPlatformUserDevices();
    if (platformRes) return platformRes;
    return { code: 200, message: "success", data: [] };
  }

  async transferSession(
    payload: TransferSessionPayload,
  ): Promise<ISuccessResponse<{ delivered: boolean }>> {
    const platformRes = await platformTransferSession(payload);
    if (platformRes) return platformRes;
    return { code: 500, message: "绿联音乐数据源不支持播放流转", data: { delivered: false } };
  }

  async uploadUserAvatar() {
    return {
      code: 501,
      message: "绿联音乐数据源不支持修改头像",
      data: null,
    };
  }
}

export class UgreenAuthAdapter implements IAuthAdapter {
  constructor(private client: UgreenClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  /**
   * 密码登录（对齐官方 web 端）：
   *
   * 1. `POST /verify/check {username}` 预检：响应头 `X-Rsa-Token` 是 base64 的
   *    RSA 公钥（每次登录轮换，不能缓存）——这一步同时验证地址指向 UGOS；
   * 2. 用公钥把明文密码做 RSA PKCS#1 v1.5 加密（rsa.ts，纯 BigInt 实现）；
   * 3. `POST /verify/login {username, password: 密文, keepalive, otp, is_simple}`，
   *    从 `data.token` 取 api_token——之后所有请求都以 query `?token=` 携带。
   */
  async login(user: Partial<User> & DeviceLoginInfo) {
    const username = String(user.username || "").trim();
    const plainPassword = String(user.password || "");
    if (!username || !plainPassword) {
      throw new Error("请填写绿联 NAS 的账号和密码");
    }

    // 1) 预检 + 拿公钥（公钥轮换，每次登录都重新取）
    const publicKey = await this.client.fetchRsaPublicKey(username);

    // 2) RSA 加密密码后登录
    const encryptedPassword = rsaEncryptBase64(publicKey, plainPassword);
    const result = await this.client.request<UgreenLoginResult>(
      "POST",
      "/verify/login",
      undefined,
      {
        username,
        password: encryptedPassword,
        keepalive: true,
        otp: true,
        is_simple: true,
      },
      { skipAuth: true, loginFlow: true },
    );

    const token = result?.token;
    if (!token) {
      throw new Error("绿联登录未返回 token，请确认服务端版本");
    }
    this.client.setSessionToken(token);

    // 3) 补一次用户信息（登录返回里通常已经带了 uid/role）
    const profile = await this.client
      .get<UgreenCurrentUser>("/user/current/user")
      .catch(() => undefined);

    const userId = String(result.uid ?? profile?.uid ?? username);
    setServiceConfig({
      username,
      password: plainPassword,
      token,
      userId,
    });

    const device: Device = {
      id: 1,
      name: user.deviceName || "绿联音乐",
      userId,
      isOnline: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Device;

    return this.response({
      id: userId,
      username: result.username || profile?.username || username,
      is_admin: (result.role || profile?.role) === "admin",
      avatar: null,
      token,
      device,
      serverName: result.nas_name,
      ...(profile ? { user: mapUgreenUser(profile) } : {}),
    });
  }

  async register(): Promise<ISuccessResponse<any>> {
    throw new Error("绿联账号请在 UGOS 系统里创建，不能在这里注册");
  }

  /**
   * 连通性探测：verify/check 免登录且会带回 RSA 公钥头，
   * 能拿到就说明地址正确且网关活着。
   */
  async check() {
    try {
      const username = String(getServiceConfig().username || "audiodock");
      await this.client.fetchRsaPublicKey(username);
      return this.response(true);
    } catch (error) {
      console.warn("[Ugreen] 连通性探测失败", error);
      return {
        code: 500,
        message: error instanceof Error ? error.message : "绿联音乐连接失败",
        data: false,
      };
    }
  }

  async hello() {
    return this.response("Hello from Ugreen Music Adapter");
  }

  async verifyDevice() {
    return { code: 501, message: "绿联音乐数据源不支持设备验证", data: false };
  }

  async resetPassword() {
    return { code: 501, message: "绿联音乐数据源不支持重置密码", data: null };
  }
}
