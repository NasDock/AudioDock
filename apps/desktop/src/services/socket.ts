import { SharedSocketService } from "@soundx/ws";
import { useAuthStore } from "../store/auth";
import { tauriGetDeviceName, isWeb, getDevicePlatform, getOrCreateDeviceId, resolveWebDeviceName } from "../utils/platform";

class SocketService extends SharedSocketService {
  async connect() {
    // 1. Get Dependencies
    const { token, user } = useAuthStore.getState();
    if (!token || !user || this.connected) return;

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

    // 4. Connect using Shared Implementation
    console.log(`[Socket] connecting: url=${url} deviceId=${getOrCreateDeviceId()} platform=${getDevicePlatform()}`);
    super.connect({
        url,
        token,
        userId: user.id as number,
        deviceName,
        deviceId: getOrCreateDeviceId(),
        platform: getDevicePlatform(),
    });
  }
}

export const socketService = new SocketService();
