import { SharedSocketService } from "@soundx/ws";
import { useAuthStore } from "../store/auth";
import { tauriGetDeviceName, isWeb, getDevicePlatform, computeStableDeviceId, resolveWebDeviceName } from "../utils/platform";
import { resolvePlatformConfig, shouldUsePlatformServer } from "../utils/platformServer";

class SocketService extends SharedSocketService {
  async connect() {
    // 1. Get Dependencies
    let { token, user } = useAuthStore.getState();
    let userId: number | undefined = user?.id as number | undefined;
    // 不再用 `this.connected` 早退：token 刷新 / 服务器地址切换时，
    // SharedSocketService 会按 url|token|userId|deviceId 判断是否需要断开重连。

    // 2. Get Device Name (Desktop Specific)
    // 纯 web 环境直接解析 UA 得到友好名（避免整段 UA 被其他端显示成 unknown device）
    let deviceName = resolveWebDeviceName();
    const device = JSON.parse(localStorage.getItem("device") || "{}");
    if (device?.name) {
        deviceName = device.name;
    } else if (!isWeb()) {
        try {
            const tauriName = await tauriGetDeviceName();
            if (tauriName) {
                deviceName = tauriName;
            }
        } catch (e) {
            console.error("Failed to get device name", e);
        }
    }

    // 3. Get Base URL (Desktop Specific - matches `http` client logic)
    // Web (Docker) 下默认用当前站点 origin，由 nginx 同源代理 /api 与 /socket.io/ 到后端；
    // Tauri 桌面端仍回退 localhost:3000 或构建期注入的 VITE_API_URL。
    let url = import.meta.env.VITE_API_URL || (isWeb() ? window.location.origin : "http://localhost:3000");
    try {
        const storedAddress = localStorage.getItem("serverAddress");
        if (storedAddress) {
            // Web 模式下用户把服务器地址填成 "/api"（同源 nginx 代理路径）时，
            // socket.io 无法解析相对路径 → 必须回落到 window.location.origin（nginx 已代理 /socket.io/）。
            // 否则生产环境 desktop 永远连不上 WS，流转必然失败。
            if (isWeb() && storedAddress.startsWith("/")) {
                url = window.location.origin;
            } else {
                url = storedAddress;
            }
        }
    } catch (e) {
        console.error("Failed to get server address for socket:", e);
    }

    // 第三方音乐源（飞牛等）下，当前地址/token 都是第三方服务的，
    // 而设备注册与播放流转挂在 AudioDock 服务端 → 改连平台服务
    // （复用最近一次 AudioDock 源登录态；没有则设备功能整体缺席，与修复前一致）。
    if (shouldUsePlatformServer()) {
        const platform = resolvePlatformConfig();
        if (!platform) {
            console.log("[Socket] 第三方源下无 AudioDock 平台登录态，跳过 WS 连接（设备流转不可用）");
            return;
        }
        url = platform.baseUrl;
        token = platform.token;
        userId = platform.userId ? Number(platform.userId) : undefined;
    }

    if (!token || !userId) return;

    // 4. Connect using Shared Implementation
    // WS 注册是「必须稳定」场景，await 拿确定性 deviceId（避免拿到首次的临时 boot id）
    const deviceId = await computeStableDeviceId();
    console.log(`[Socket] connecting: url=${url} deviceId=${deviceId} platform=${getDevicePlatform()}`);
    super.connect({
        url,
        token,
        userId,
        deviceName,
        deviceId,
        platform: getDevicePlatform(),
    });
  }
}

export const socketService = new SocketService();
