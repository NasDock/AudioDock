import { SharedSocketService } from "@soundx/ws";
import { useAuthStore } from "../store/auth";
import { tauriGetDeviceName, isWeb, getDevicePlatform, getOrCreateDeviceId } from "../utils/platform";

class SocketService extends SharedSocketService {
  async connect() {
    // 1. Get Dependencies
    const { token, user } = useAuthStore.getState();
    if (!token || !user || this.connected) return;

    // 2. Get Device Name (Desktop Specific)
    let deviceName = window.navigator.userAgent;
    const device = JSON.parse(localStorage.getItem("device") || "{}");
    if (device?.name) {
        deviceName = device.name;
    } else {
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
            url = storedAddress;
        }
    } catch (e) {
        console.error("Failed to get server address for socket:", e);
    }

    // 4. Connect using Shared Implementation
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
