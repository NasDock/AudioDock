import { httpClient } from '../HarmonyHttpClient';
import { isFnosSource } from '../fnos';
import { hasPlatformConfig, platformClient } from '../platform';

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
  /**
   * 播放流转 REST 兜底（对齐 desktop/mobile）：WS 不可用时调用。
   * 返回是否已实时送达；目标暂离线时由服务端决定是否暂存补投。
   */
  transferSession(payload: object): Promise<boolean>;
}

/** POST /user/devices/transfer 的 data 载荷 */
interface TransferDeliveredResp {
  delivered: boolean;
}

class DeviceApiImpl implements DeviceApi {
  async listMyDevices(): Promise<OnlineDevice[]> {
    // 飞牛音乐源下，设备列表挂在 AudioDock 服务端 → 走平台服务通道；
    // 未配置平台服务（从未登录过 AudioDock 源）时返回空列表，与修复前表现一致
    if (isFnosSource()) {
      if (!hasPlatformConfig()) return [];
      return platformClient.get<OnlineDevice[]>('/user/devices');
    }
    return httpClient.get<OnlineDevice[]>('/user/devices');
  }

  async transferSession(payload: object): Promise<boolean> {
    // 飞牛音乐源下同样走平台服务通道（设备体系在 AudioDock 服务端）
    if (isFnosSource()) {
      if (!hasPlatformConfig()) return false;
      const resp = await platformClient.post<TransferDeliveredResp>('/user/devices/transfer', payload);
      return resp !== null && resp !== undefined && resp.delivered === true;
    }
    const resp = await httpClient.post<TransferDeliveredResp>('/user/devices/transfer', payload);
    return resp !== null && resp !== undefined && resp.delivered === true;
  }
}

export const deviceApi: DeviceApi = new DeviceApiImpl();
