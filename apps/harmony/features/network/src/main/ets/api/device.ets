import { httpClient } from '../HarmonyHttpClient';

/**
 * 在线设备（跨端播放流转）相关接口。
 * 字段对齐后端 GET /user/devices 返回的 Device 模型。
 */

/** 设备平台：desktop / web / tablet / phone / mini / tv / watch */
export type DevicePlatform = 'desktop' | 'web' | 'tablet' | 'phone' | 'mini' | 'tv' | 'watch';

export interface OnlineDevice {
  id: number;
  name: string;
  deviceId?: string | null;
  platform?: string | null;
  isOnline: boolean;
  lastSeen?: string | null;
  userId: number;
}

export interface DeviceApi {
  /** 当前登录用户的设备列表（在线优先 + lastSeen 倒序） */
  listMyDevices(): Promise<OnlineDevice[]>;
}

class DeviceApiImpl implements DeviceApi {
  async listMyDevices(): Promise<OnlineDevice[]> {
    return httpClient.get<OnlineDevice[]>('/user/devices');
  }
}

export const deviceApi: DeviceApi = new DeviceApiImpl();
