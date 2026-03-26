import { setServiceConfig } from "../../config";
import { ILoadMoreData, ISuccessResponse, User } from "../../models";
import { IAuthAdapter, IUserAdapter } from "../interface-user-auth";
import { EmbyClient } from "./client";
import { preloadEmbyLibraryParents } from "./media";
import { EmbyAuthResponse } from "./types";

export class EmbyAuthAdapter implements IAuthAdapter {
  constructor(private client: EmbyClient) {}

  async login(params: any): Promise<ISuccessResponse<{ user: User; token: string }>> {
    const response = await this.client.request<EmbyAuthResponse>("POST", "Users/AuthenticateByName", {}, {
      Username: params.username,
      Pw: params.password,
    });

    const user: User = {
      id: response.User.Id,
      username: response.User.Name,
      is_admin: false,
    };

    setServiceConfig({
      token: response.AccessToken,
      userId: response.User.Id
    });
    await preloadEmbyLibraryParents(this.client).catch(() => undefined);

    return {
      code: 200,
      message: "success",
      data: {
        user,
        token: response.AccessToken,
      },
    };
  }

  async register(params: any): Promise<ISuccessResponse<User>> {
    throw new Error("Register not supported for Emby");
  }

  async check(): Promise<ISuccessResponse<boolean>> {
    try {
      await this.client.get("System/Info");
      return { code: 200, message: "success", data: true };
    } catch (e) {
      return { code: 500, message: "connection failed", data: false };
    }
  }

  async hello(): Promise<ISuccessResponse<string>> {
    return { code: 200, message: "success", data: "Hello from Emby" };
  }

  async logout(): Promise<ISuccessResponse<boolean>> {
    return { code: 0, message: "success", data: true };
  }

  async forgotPassword(params: any): Promise<ISuccessResponse<any>> {
    throw new Error("Not supported");
  }

  async resetPassword(username: string, deviceName: string, newPassword: string): Promise<ISuccessResponse<any>> {
    throw new Error("Not supported");
  }

  async verifyDevice(username: string, deviceName: string): Promise<ISuccessResponse<boolean>> {
    return { code: 0, message: "success", data: true };
  }
}

export class EmbyUserAdapter implements IUserAdapter {
  constructor(private client: EmbyClient) {}

  private resolveUserId(userId?: number | string): string {
    const value = userId !== undefined && userId !== null ? String(userId).trim() : "";
    if (value && value !== "0" && value !== "undefined" && value !== "null") {
      return value;
    }

    const config = this.client.getConfig() as any;
    const fallback = config?.userId ? String(config.userId).trim() : "";
    if (fallback && fallback !== "0" && fallback !== "undefined" && fallback !== "null") {
      return fallback;
    }

    throw new Error("Emby userId is required");
  }

  async addToHistory(trackId: number | string, userId: number | string, progress?: number, deviceName?: string, deviceId?: number | string, isSyncMode?: boolean): Promise<ISuccessResponse<any>> {
    const ticks = Number.isFinite(progress as number) && (progress as number) > 0
      ? Math.floor((progress as number) * 10000000)
      : 0;
    const finalUserId = this.resolveUserId(userId);
    const finalTrackId = String(trackId ?? "").trim();
    if (!finalTrackId) {
      throw new Error("Emby trackId is required");
    }
    await this.client.request(
      "POST",
      `Users/${finalUserId}/PlayingItems/${encodeURIComponent(finalTrackId)}`,
      {
        PositionTicks: ticks,
      },
      undefined
    );
    return { code: 0, message: "success", data: true };
  }

  async getLatestHistory(userId: number | string): Promise<ISuccessResponse<any>> {
    return { code: 200, message: "success", data: [] };
  }

  async addAlbumToHistory(albumId: number | string, userId: number | string): Promise<ISuccessResponse<any>> {
    this.resolveUserId(userId);
    return { code: 0, message: "success", data: true };
  }

  async getAlbumHistory(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<any>>> {
    return {
        code: 200,
        message: "success",
        data: {
            pageSize,
            loadCount,
            list: [],
            total: 0,
            hasMore: false
        }
    };
  }

  async getTrackHistory(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<any>>> {
    return {
        code: 200,
        message: "success",
        data: {
            pageSize,
            loadCount,
            list: [],
            total: 0,
            hasMore: false
        }
    };
  }

  async getUserList(): Promise<ISuccessResponse<any[]>> {
    const response = await this.client.get<any[]>("Users");
    return { code: 200, message: "success", data: response };
  }

  async getCurrentUser(): Promise<ISuccessResponse<User>> {
    const { userId } = this.client.getConfig();
    if (userId) {
        return this.getUserById(userId);
    }
     return {
         code: 200,
         message: "success",
         data: {
             id: "",
             username: "Emby User",
             is_admin: false
         }
     }
  }

  async getUserById(id: number | string): Promise<ISuccessResponse<User>> {
    const response = await this.client.get<any>(`Users/${id}`);
    return {
      code: 200,
      message: "success",
      data: {
        id: response.Id,
        username: response.Name,
        is_admin: response.Policy?.IsAdministrator || false,
      },
    };
  }

  async updateUser(id: number | string, data: any): Promise<ISuccessResponse<User>> {
    throw new Error("Not supported");
  }

  async deleteUser(id: number | string): Promise<ISuccessResponse<boolean>> {
    throw new Error("Not supported");
  }

  async getUserTableList(params: any): Promise<ISuccessResponse<any>> {
    throw new Error("Not supported");
  }

  async uploadUserAvatar(id: number | string, file: any): Promise<ISuccessResponse<any>> {
    return {
      code: 501,
      message: "Emby adapter does not support avatar upload.",
      data: null
    };
  }
}
