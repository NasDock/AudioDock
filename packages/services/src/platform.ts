import axios, { type AxiosAdapter, type AxiosInstance } from "axios";
import type { TransferSessionPayload } from "./adapter/interface-user-auth";
import type { Device, ISuccessResponse } from "./models";

/**
 * AudioDock 平台服务通道。
 *
 * 背景：设备列表（/user/devices）与播放流转（/user/devices/transfer）是
 * AudioDock 服务端的账号体系能力（JWT + WS 设备注册），与当前音乐数据源无关。
 * 当用户切到第三方音乐源（飞牛/Subsonic/Emby）时，主适配器的这两个接口是空实现，
 * 导致小爱音箱弹层里的「我的在线设备」整个消失。
 *
 * 这里维护一条指向 AudioDock 服务端的独立请求通道：各端在 AudioDock 源下登录过的
 * 地址 + token 会被持久化（JWT 100 年有效），切到第三方源后由端侧调用
 * setPlatformConfig() 恢复，设备相关接口即可继续工作。
 */
export interface PlatformConfig {
  /** AudioDock 服务端地址（用户最近一次在 AudioDock 源下登录成功的地址） */
  baseUrl: string;
  /** AudioDock 服务端 JWT */
  token: string;
  /** AudioDock 账号用户 id（WS 注册用） */
  userId?: string;
}

let platformConfig: PlatformConfig | null = null;
let platformClient: AxiosInstance | null = null;
/**
 * 自定义请求适配器（微信小程序等无 XHR 的环境必须注入，例如 mini 端的 taroAdapter）。
 * 端侧在注入后再调用 setPlatformConfig 才会真正生效。
 */
let platformAdapter: AxiosAdapter | undefined;

const buildPlatformClient = () => {
  if (!platformConfig) {
    platformClient = null;
    return;
  }
  platformClient = axios.create({
    baseURL: platformConfig.baseUrl,
    timeout: 15000,
    headers: { Authorization: `Bearer ${platformConfig.token}` },
    ...(platformAdapter ? { adapter: platformAdapter } : {}),
  });
  // AudioDock 的 HttpExceptionFilter 把所有异常包成 HTTP 200 + body code，
  // 与主 request 实例行为对齐：拦截器直接取 body。
  platformClient.interceptors.response.use((res) => res.data);
};

/** 注入平台通道的请求适配器（仅小程序等无 XHR 环境需要；browser/RN 用默认即可） */
export const setPlatformAdapter = (adapter: AxiosAdapter) => {
  platformAdapter = adapter;
  buildPlatformClient();
};

export const setPlatformConfig = (config: PlatformConfig | null) => {
  platformConfig =
    config && config.baseUrl && config.token
      ? { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") }
      : null;
  buildPlatformClient();
};

export const getPlatformConfig = (): PlatformConfig | null => platformConfig;

/** 是否已配置可用的 AudioDock 平台服务（第三方源下没有则设备功能静默降级为空） */
export const hasPlatformConfig = (): boolean => platformClient !== null;

/** 平台版的在线设备列表；未配置或网络异常时返回 null（调用方按空列表处理） */
export const getPlatformUserDevices = async (): Promise<ISuccessResponse<
  Device[]
> | null> => {
  if (!platformClient) return null;
  try {
    return await platformClient.get("/user/devices");
  } catch (error) {
    console.warn("[Platform] 获取在线设备失败", error);
    return null;
  }
};

/** 平台版的播放流转 REST 兜底；未配置或网络异常时返回 null（调用方按失败处理） */
export const platformTransferSession = async (
  payload: TransferSessionPayload,
): Promise<ISuccessResponse<{ delivered: boolean }> | null> => {
  if (!platformClient) return null;
  try {
    return await platformClient.post("/user/devices/transfer", payload);
  } catch (error) {
    console.warn("[Platform] 播放流转失败", error);
    return null;
  }
};
