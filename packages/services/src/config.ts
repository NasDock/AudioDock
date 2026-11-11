export interface ServiceConfig {
  username?: string;
  password?: string; // For Subsonic (plaintext or hex-encoded if we want to separate)
  token?: string;    // For Native
  clientName?: string;
  baseUrl?: string;
  userId?: string;
  /** 稳定设备标识（飞牛登录等需要上报设备信息的协议用） */
  deviceId?: string;
}

let globalConfig: ServiceConfig = {
    clientName: "SoundX",
};

export const setServiceConfig = (config: Partial<ServiceConfig>) => {
  globalConfig = { ...globalConfig, ...config };
};

export const getServiceConfig = () => {
  return globalConfig;
};
