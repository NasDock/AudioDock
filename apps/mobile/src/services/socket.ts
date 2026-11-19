import AsyncStorage from "@react-native-async-storage/async-storage";
import { SharedSocketService } from "@soundx/ws";
import { AppState } from "react-native";
import * as Device from "expo-device";
import { getBaseURL } from "../https";
import { getDevicePlatform, getOrCreateDeviceId } from "../utils/platform";
import { resolvePlatformConfig, shouldUsePlatformServer } from "../utils/platformServer";

class MobileSocketService extends SharedSocketService {
  private appStateBound = false;
  private lastUserId: number | null = null;
  private lastToken: string = "";

  async connectWithContext(userId: number, token: string) {
    this.lastUserId = userId;
    this.lastToken = token;
    const deviceName = Device.modelName || "Mobile Device";
    const deviceId = await getOrCreateDeviceId();
    const platform = getDevicePlatform();

    // ⚠️ 必须用 HTTP 客户端的内存态 baseURL，不能直接读 AsyncStorage 的 "serverAddress"：
    // AuthContext.autoSwitchServer() 会在启动 / 网络切换时把内外网地址写回 activeBaseURL，
    // 而 AsyncStorage 里的值可能滞后（或带 /api 之类的路径），导致 WS 连到另一台服务端，
    // 该设备在其它端的在线设备列表里就永远不出现，流转也必然 device_offline。
    let url = getBaseURL();
    let connToken = token;
    let connUserId = userId;
    const legacyAddress = await AsyncStorage.getItem("serverAddress");
    if (legacyAddress && legacyAddress !== url) {
      console.log(`[MobileSocket] serverAddress 与 HTTP baseURL 不一致，以 HTTP 为准: http=${url} storage=${legacyAddress}`);
    }

    // 第三方音乐源（飞牛等）下，当前地址/token 都是第三方服务的，
    // 而设备注册与播放流转挂在 AudioDock 服务端 → 改连平台服务
    // （复用最近一次 AudioDock 源登录态；没有则设备功能整体缺席，与修复前一致）。
    if (await shouldUsePlatformServer()) {
      const platformConfig = await resolvePlatformConfig();
      if (!platformConfig) {
        console.log("[MobileSocket] 第三方源下无 AudioDock 平台登录态，跳过 WS 连接（设备流转不可用）");
        return;
      }
      url = platformConfig.baseUrl;
      connToken = platformConfig.token;
      connUserId = platformConfig.userId ? Number(platformConfig.userId) : userId;
    }

    console.log(`[MobileSocket] connecting: url=${url} userId=${connUserId} deviceId=${deviceId} deviceName=${deviceName} platform=${platform}`);

    // 不再用 `if (this.connected) return` 早退：
    // SharedSocketService.connect 内部按 url|token|userId|deviceId 判断是否需要重连，
    // 切服务器（内外网）/ 换账号时才能把旧连接换掉。
    super.connect({
      url,
      token: connToken,
      userId: connUserId,
      deviceName,
      deviceId,
      platform,
    });

    this.bindAppState();
  }

  /** 登出时必须清掉缓存凭据，否则回前台会用旧 token 把连接拉回来 */
  disconnect() {
    super.disconnect();
    this.lastUserId = null;
    this.lastToken = "";
  }

  /**
   * Android 后台会冻结 JS 定时器，socket.io 自带重连经常不再触发；
   * 回前台时重新走一次 connectWithContext，同时能感知内外网地址切换
   * （SharedSocketService 内部按 url|token|userId|deviceId 判断是否需要重连）。
   */
  private bindAppState() {
    if (this.appStateBound) return;
    this.appStateBound = true;
    AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      console.log("[MobileSocket] AppState active → 检查并重连 WS");
      // 没有登录凭据时不主动拉连接（避免登出后被重新连回来）
      if (this.lastUserId !== null && this.lastToken) {
        void this.connectWithContext(this.lastUserId, this.lastToken);
      }
    });
  }
}

export const socketService = new MobileSocketService();
