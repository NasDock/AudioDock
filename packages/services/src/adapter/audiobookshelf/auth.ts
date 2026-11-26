import type { IAuthAdapter, IUserAdapter } from "../interface-user-auth";
import type { ISuccessResponse, User } from "../../models";
import { getServiceConfig } from "../../config";
import type { AudiobookshelfClient } from "./client";
import type { AbsUser } from "./types";

const response = <T>(data: T): ISuccessResponse<T> => ({
  code: 200,
  message: "success",
  data,
});

const mapUser = (user: AbsUser): User => ({
  id: user.id,
  username: user.username,
  avatar: null,
  is_admin: user.type === "root" || user.type === "admin",
  createdAt: new Date(0).toISOString(),
});

export class AudiobookshelfAuthAdapter implements IAuthAdapter {
  constructor(private client: AudiobookshelfClient) {}

  async login(_user: Partial<User> & { deviceName?: string; deviceId?: string; platform?: string }) {
    const res = await this.client.login();
    const token = String(getServiceConfig().token || res?.user?.token || "");
    const user = res?.user
      ? mapUser(res.user)
      : ({ id: "audiobookshelf", username: String(getServiceConfig().username || ""), is_admin: false } as User);
    return response({ token, user });
  }

  async register(): Promise<ISuccessResponse<any>> {
    throw new Error("Audiobookshelf 不支持注册，请在服务端创建账号");
  }

  async check(): Promise<ISuccessResponse<boolean>> {
    await this.client.check();
    return response(true);
  }

  async hello(): Promise<ISuccessResponse<string>> {
    return response("audiobookshelf");
  }

  async verifyDevice(): Promise<ISuccessResponse<boolean>> {
    return response(true);
  }

  async resetPassword(): Promise<ISuccessResponse<any>> {
    throw new Error("Audiobookshelf 不支持通过本应用重置密码");
  }
}

/**
 * 用户相关能力：Audiobookshelf 的收听进度存在它自己的服务端，
 * 这里只保证登录/当前用户可用，其余能力返回空结果，避免第三方源下 UI 报错。
 */
export class AudiobookshelfUserAdapter implements IUserAdapter {
  constructor(private client: AudiobookshelfClient) {}

  async getCurrentUser(): Promise<ISuccessResponse<User>> {
    let data: { user?: AbsUser } | null = null;
    try {
      data = await this.client.get<{ user?: AbsUser }>("/api/authorize");
    } catch {
      data = await this.client.get<{ user?: AbsUser }>("/api/me");
    }
    const absUser = data?.user;
    if (!absUser) {
      return response({
        id: "audiobookshelf",
        username: String(getServiceConfig().username || ""),
        is_admin: false,
      } as User);
    }
    return response(mapUser(absUser));
  }

  async addToHistory(): Promise<ISuccessResponse<any>> {
    return response(null);
  }

  async getLatestHistory(): Promise<ISuccessResponse<any>> {
    return response(null);
  }

  async addAlbumToHistory(): Promise<ISuccessResponse<any>> {
    return response(null);
  }

  async getAlbumHistory(): Promise<ISuccessResponse<any>> {
    return response({
      pageSize: 20,
      loadCount: 0,
      list: [],
      total: 0,
      hasMore: false,
    });
  }

  async getTrackHistory(): Promise<ISuccessResponse<any>> {
    return response({
      pageSize: 20,
      loadCount: 0,
      list: [],
      total: 0,
      hasMore: false,
    });
  }

  async getUserList(): Promise<ISuccessResponse<any[]>> {
    return response([]);
  }

  async getUserDevices(): Promise<ISuccessResponse<any[]>> {
    return response([]);
  }

  async transferSession(): Promise<ISuccessResponse<{ delivered: boolean }>> {
    // 第三方源走 AudioDock 平台服务（syncPlatformConfig），这里不重复投递
    return response({ delivered: false });
  }

  async uploadUserAvatar(): Promise<ISuccessResponse<any>> {
    return response(null);
  }
}
