import { HarmonyHttpClient } from './HarmonyHttpClient';

/**
 * AudioDock 平台服务通道（设备列表 / 播放流转所依赖的服务端账号体系）。
 *
 * 设备注册、JWT 鉴权、WS 都在 AudioDock 服务端；切到飞牛音乐源后，
 * httpClient 的 baseURL 是飞牛网关（甚至为空），设备接口会失去依托。
 * 这里维护一条指向 AudioDock 服务端的独立通道：entry 层在 AudioDock 源登录成功时
 * 把地址 + token 落盘（kvStore platform_audiodock_*，JWT 100 年有效），
 * 冷启动 / 切源后恢复调用 setPlatformConfig()，设备相关接口即可继续工作。
 */
export const platformClient: HarmonyHttpClient = new HarmonyHttpClient();

export function setPlatformConfig(baseUrl: string, token: string): void {
  platformClient.setBaseURL(baseUrl);
  platformClient.setAuthToken(token);
}

export function clearPlatformConfig(): void {
  platformClient.setBaseURL('');
  platformClient.setAuthToken(null);
}

export function hasPlatformConfig(): boolean {
  return platformClient.getBaseURL().length > 0 && platformClient.getAuthToken() !== null;
}
