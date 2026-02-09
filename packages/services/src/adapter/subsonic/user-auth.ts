import { getServiceConfig } from "../../config";
import { ISuccessResponse, User } from "../../models";
import { IAuthAdapter, IUserAdapter } from "../interface-user-auth";
import { SubsonicClient } from "./client";

export class SubsonicUserAdapter implements IUserAdapter {
    constructor(private client: SubsonicClient) {}

    private response<T>(data: T): ISuccessResponse<T> {
        return {
            code: 200,
            message: "success",
            data
        };
    }

  async addToHistory(trackId: number | string, userId: number | string, progress: number = 0, deviceName?: string, deviceId?: number | string, isSyncMode?: boolean) {
     // scrobble
     await this.client.get("scrobble", { id: trackId.toString(), submission: true });
     return this.response(null);
  }

  async getLatestHistory(userId: number | string) {
      // Subsonic doesn't have "latest single history item" easily.
      return this.response(null);
  }

  async addAlbumToHistory(albumId: number | string, userId: number | string) {
     return this.response(null);
  }

  async getAlbumHistory(userId: number | string, loadCount: number, pageSize: number, type?: string) {
     return this.response({
         pageSize, loadCount, list: [], total: 0, hasMore: false
     });
  }


  async getTrackHistory(userId: number | string, loadCount: number, pageSize: number, type?: string) {
     // getNowPlaying? or we can't get history really?
     // Actually there is no simple "User History" in standard subsonic without extensions maybe?
     // There is "getNowPlaying".
     return this.response({
         pageSize, list: [], total: 0, hasMore: false, loadCount: 0
     });
  }

  async getUserList() {
    const res = await this.client.get<{users: { user: any[] }}>("getUsers");
    return this.response(res.users?.user || []);
  }
}

export class SubsonicAuthAdapter implements IAuthAdapter {
    constructor(private client: SubsonicClient) {}
    
    private response<T>(data: T): ISuccessResponse<T> {
        return {
            code: 200,
            message: "success",
            data
        };
    }

    async login(user: Partial<User> & { deviceName?: string }) {
       const { deviceName } = user;
       // We assume "login" in Subsonic context means "ping settings are valid".
       // The actual login happens by configuring the client.
       // So this might just be a ping.
       console.log("ping", user);
       
       const config = getServiceConfig();
       // Try to get real user info if username is provided in config
       // Note: Subsonic getUser requires username, which we have in config
       const userRes = await this.client.get<{ user: { username: string, email?: string, adminRole?: boolean } }>("getUser", { username: (user as any).username || config.username });
       return this.response({
           id: 1, // Subsonic doesn't really allow numeric ID retrieval for users easily, use dummy
           username: userRes.user.username,
           email: userRes.user.email,
           is_admin: userRes.user.adminRole || false,
           token: "subsonic-session-token", // Dummy, auth is via config
           device: { id: 1, name: deviceName || "Subsonic", userId: 1, isOnline: true, createdAt: new Date(), updatedAt: new Date() }
       });
    }

    async register(user: Partial<User> & { deviceName?: string }): Promise<ISuccessResponse<any>> {
       throw new Error("Register not supported in Subsonic");
    }

    async check() {
        try {
            console.log("ping2222");
            await this.client.get("ping");
            return this.response(true);
        } catch {
            return this.response(false);
        }
    }

    async hello() {
        return this.response("Hello from Subsonic Adapter");
    }

    async verifyDevice(username: string, deviceName: string) {
         return {
            code: 501,
            message: "Subsonic 数据源不支持设备验证",
            data: false
         };
    }

    async resetPassword(username: string, deviceName: string, newPassword: string) {
        return {
            code: 501,
            message: "Subsonic 数据源不支持重置密码",
            data: null
        };
    }
}
