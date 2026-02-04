import type { Device, ISuccessResponse, User } from "../../models";
import request from "../../request";
import { IAuthAdapter } from "../interface-user-auth";

export class NativeAuthAdapter implements IAuthAdapter {
  async login(user: Partial<User> & { deviceName?: string }) {
    console.log("login", user);
    const { deviceName = "Unknown Device", ...userData } = user;
    return request.post<any, ISuccessResponse<User & { token: string, device: Device }>>(
      "/auth/login",
      { ...userData, deviceName }
    );
  }

  async register(user: Partial<User> & { deviceName?: string }) {
    const { deviceName = "Unknown Device", ...userData } = user;
    return request.post<any, ISuccessResponse<User & { token: string, device: Device }>>(
      "/auth/register",
      { ...userData, deviceName }
    );
  }

  async check() {
    return request.get<any, ISuccessResponse<boolean>>("/auth/check");
  }

  async hello() {
      return request.get<any, ISuccessResponse<string>>("/hello");
  }

  async verifyDevice(username: string, deviceName: string) {
    return request.post<any, ISuccessResponse<boolean>>("/auth/verify-device", { username, deviceName });
  }

  async resetPassword(username: string, deviceName: string, newPassword: string) {
    return request.post<any, ISuccessResponse<User & { token: string; device: Device }>>("/auth/reset-password", { username, deviceName, newPassword });
  }
}
