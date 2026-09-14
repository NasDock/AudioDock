import { httpClient } from '../HarmonyHttpClient';

export interface LoginDto {
  username: string; password: string;
  deviceName?: string; deviceId?: string; platform?: string;
}
export interface RegisterDto {
  username: string; password: string; nickname?: string;
  deviceName?: string; deviceId?: string; platform?: string;
}
export interface AuthMe { id: string; username: string; nickname?: string; avatar?: string }
export interface DeviceInfo { id: number }
// 后端 data 是 user 平铺 + token + 可选 device（auth.controller.ts login/register）
export interface LoginResponse extends AuthMe { token: string; device?: DeviceInfo }
export interface CheckResponse { needRegister: boolean }

export interface ResetPasswordDto {
  username: string;
  newPassword: string;
  deviceName: string;
}

export interface VerifyDeviceDto {
  username: string;
  deviceName: string;
}

export interface VerifyDeviceResponse {
  verified: boolean;
}

export interface AuthApi {
  login(dto: LoginDto): Promise<LoginResponse>;
  register(dto: RegisterDto): Promise<LoginResponse>;
  me(): Promise<AuthMe>;
  check(username: string): Promise<CheckResponse>;
  resetPassword(dto: ResetPasswordDto): Promise<void>;
  verifyDevice(dto: VerifyDeviceDto): Promise<VerifyDeviceResponse>;
}

class AuthApiImpl implements AuthApi {
  async login(dto: LoginDto): Promise<LoginResponse> {
    return httpClient.post<LoginResponse>('/auth/login', dto);
  }
  async register(dto: RegisterDto): Promise<LoginResponse> {
    return httpClient.post<LoginResponse>('/auth/register', dto);
  }
  async me(): Promise<AuthMe> {
    return httpClient.get<AuthMe>('/auth/me');
  }
  async check(username: string): Promise<CheckResponse> {
    const p = new Map<string, string | number | boolean>();
    p.set('username', username);
    const record: Record<string, string | number | boolean> = {};
    const keys = Array.from(p.keys());
    for (let i = 0; i < keys.length; i++) {
      record[keys[i]] = p.get(keys[i])!;
    }
    return httpClient.get<CheckResponse>('/auth/check', record);
  }
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    return httpClient.post<void>('/auth/reset-password', dto);
  }
  async verifyDevice(dto: VerifyDeviceDto): Promise<VerifyDeviceResponse> {
    return httpClient.post<VerifyDeviceResponse>('/auth/verify-device', dto);
  }
}

export const authApi: AuthApi = new AuthApiImpl();