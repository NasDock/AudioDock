import { io, Socket } from "socket.io-client";

export * from "./deviceId";

export interface SocketConnectOptions {
    /** Connection URL */
    url: string;
    /** Auth Token */
    token: string;
    /** User ID */
    userId: number;
    /** Device Name for identification */
    deviceName: string;
    /** 稳定唯一设备标识（各端首次启动生成 UUID 并持久化） */
    deviceId?: string;
    /** 设备平台：desktop / web / tablet / phone / mini / tv / watch */
    platform?: string;
    /** Extra query params */
    query?: Record<string, any>;
}

/**
 * 把服务器地址归一化为 socket.io 可识别的「协议 + 主机」。
 *
 * ⚠️ socket.io-client 会把 URL 里的 path 当成 **namespace**：
 *   io("http://192.168.1.6:3000/api") → namespace "/api"（服务端没有这个 namespace，直接连不上）
 *   io("/api")                        → 相对路径在 RN / Tauri 下根本无法解析
 * 而各端 HTTP 客户端允许把服务器地址填成 "http://x/api" 或 "/api"（nginx 同源代理形态），
 * 之前 socket 直接沿用该地址，导致这些端 WS 永远注册不上 → 设备列表看不到、流转必然 device_offline。
 *
 * 这里纯字符串解析（RN 全局 URL 是存根，只有 getter，不能用 new URL / 赋值 protocol）。
 */
export function normalizeSocketUrl(raw: string): string {
    const s = (raw || "").trim();
    if (!s) return "http://localhost:3000";

    // 相对路径（同源部署时 serverAddress 常填 "/api"）→ 回落到当前站点 origin
    if (s.startsWith("/")) {
        const origin = typeof window !== "undefined" ? (window as any).location?.origin : undefined;
        return origin || "http://localhost:3000";
    }

    const match = s.match(/^(wss?|https?):\/\/[^\/?#]+/i);
    if (!match) return s.replace(/\/+$/, "");
    return match[0]
        .replace(/^ws:\/\//i, "http://")
        .replace(/^wss:\/\//i, "https://");
}

/**
 * 把服务器地址拆成 socket.io 客户端需要的 origin + path：
 *
 * - 无路径（`http://192.168.1.6:8865`）→ 默认 `/socket.io`；
 * - 相对路径 `/api`（自建 nginx 同源部署：`/api` 只是 HTTP 前缀，`/socket.io` 在根路径单独代理）
 *   → 回落当前站点 origin + 默认 `/socket.io`；
 * - 其他路径前缀（云端按租户路径挂载，如 `https://cloud.audiodock.cn/<user>/ad`）
 *   → `path = <前缀>/socket.io`。
 *
 * ⚠️ 云端网关按路径路由到租户后端，根路径 `/socket.io` 会被拒绝（实测返回
 * `{"error":"User not found"}`）：此前一律剥掉路径，导致云端部署下所有端 WS
 * 永远注册不上 → 设备表全离线 → 在线设备列表为空、流转必败。
 */
export function resolveSocketEndpoint(raw: string): { url: string; path?: string } {
    const s = (raw || "").trim();
    if (!s) return { url: "http://localhost:3000" };

    // 相对路径（同源部署时 serverAddress 常填 "/api"）→ 回落到当前站点 origin
    if (s.startsWith("/")) {
        const origin = typeof window !== "undefined" ? (window as any).location?.origin : undefined;
        return { url: origin || "http://localhost:3000" };
    }

    const match = s.match(/^((?:wss?|https?):\/\/[^\/?#]+)(\/[^?#]*)?/i);
    if (!match) return { url: s.replace(/\/+$/, "") };
    const origin = match[1]
        .replace(/^ws:\/\//i, "http://")
        .replace(/^wss:\/\//i, "https://");
    const p = (match[2] || "").replace(/\/+$/, "");
    // "/api" 是自建 nginx 的 HTTP 前缀约定（/socket.io 在根路径单独代理），不带进 socket path
    if (!p || p === "/api") return { url: origin };
    return { url: origin, path: `${p}/socket.io` };
}

export class SharedSocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, Function[]> = new Map();
  /** 上一次连接的关键参数，用于判断是否需要断开重连 */
  private signature: string = "";
  private lastOptions: SocketConnectOptions | null = null;

  /**
   * Initialize a connection.
   * 关键参数（服务器地址 / token / 用户 / deviceId）变化时会自动断开重连，
   * 否则切服务器或换账号后 socket 仍挂在旧连接上，服务端设备表与端侧永远对不上。
   */
    connect(options: SocketConnectOptions) {
        const { token, userId, deviceName, deviceId, platform, query } = options;
        const endpoint = resolveSocketEndpoint(options.url);
        const url = endpoint.url;
        const socketPath = endpoint.path;
        const signature = `${url}|${socketPath ?? ""}|${token}|${userId}|${deviceId ?? ""}`;

    if (this.socket && this.signature === signature) {
        // 参数没变：已连接直接返回；尚未连上 / 正在重连时绝不重建 socket，
        // 否则 React StrictMode、AppState 回前台等重复调用会不断销毁刚发起的握手，
        // 连接永远建不起来（移动端尤其容易踩）。
        if (!this.socket.connected) this.socket.connect();
        return;
    }
    // 关键参数变化（切源 / 换账号 / 服务器地址变化）才彻底断开旧连接，
    // 避免两个 socket 并存导致服务端 userSockets 里出现「同设备多条」并互相挤下线。
    if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
    }
    this.signature = signature;
    this.lastOptions = options;

    // 业务参数双通道：query 给所有已部署服务端读，auth 给新版服务端 / 对 URL query
    // 校验严格的客户端（HarmonyOS webSocket、部分 Android OkHttp 链路）兜底。
    // 服务端 handleConnection 已实现 query → auth 逐字段回退读取。
    const auth: Record<string, any> = {
        token,
        userId,
        deviceName,
        ...(deviceId ? { deviceId } : {}),
        ...(platform ? { platform } : {}),
    };

        this.socket = io(url, {
          // 云端按租户路径挂载时（如 /mmdctjj/ad），socket.io 必须走 <前缀>/socket.io
          ...(socketPath ? { path: socketPath } : {}),
          query: {
            userId,
            deviceName,
            ...(deviceId ? { deviceId } : {}),
            ...(platform ? { platform } : {}),
            ...query
          },
      // polling 起手再升级 websocket（socket.io 默认顺序）：
      // 云端网关（cloud.audiodock.cn 按租户路径挂载）实测不支持 websocket 直连
      // （upgrade 请求无响应直至超时），polling 握手则正常；直连后端两种都行。
      transports: ["polling", "websocket"],
      auth,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    });

    this.socket.on("connect", () => {
      console.log(`[SharedSocket] Connected: ${this.socket?.id} (deviceId=${deviceId}, deviceName=${deviceName}, platform=${platform}, url=${url})`);
    });

    this.socket.on("disconnect", (reason: string) => {
      console.log(`[SharedSocket] Disconnected, reason=${reason}`);
    });

    this.socket.on("connect_error", (err: Error) => {
      console.warn(`[SharedSocket] connect_error: ${err.message} (url=${url})`);
    });

    this.socket.on("auth_error", (data: any) => {
      console.warn(`[SharedSocket] auth_error:`, data);
    });

    this.socket.on("transfer_received", (payload: any) => {
      console.log(`[SharedSocket] transfer_received: from=${payload?.fromDeviceName} track=${payload?.currentTrack?.name ?? "(none)"} progress=${payload?.progress}s`);
    });

    // 重连时也重新带上最新 auth（token 刷新 / 切源后不会被旧 auth 卡住）
    this.socket.io.on("reconnect_attempt", () => {
      if (this.socket) this.socket.auth = { ...auth };
    });

    // Re-attach listeners if any were added before connection
    this.listeners.forEach((callbacks, event) => {
      callbacks.forEach(cb => this.socket?.on(event, cb as any));
    });
  }

  /**
   * 确保连接可用。供 App 从后台回前台、网络切换等场景调用：
   * WS 断开后 socket.io 自身会重连，但移动端（尤其 Android）系统可能冻结定时器，
   * 需要显式补一次 connect() 才能恢复。
   */
  ensureConnected() {
    if (this.socket?.connected) return;
    if (this.socket) {
      this.socket.connect();
      console.log(`[SharedSocket] ensureConnected: 主动恢复断开的连接 (url=${(this.lastOptions && normalizeSocketUrl(this.lastOptions.url)) || "?"})`);
    } else if (this.lastOptions) {
      this.connect(this.lastOptions);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.signature = "";
    // 登出后不能让 ensureConnected() 用旧凭据把连接拉回来
    this.lastOptions = null;
  }

  emit(event: string, data: any) {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    } else {
      console.warn("[SharedSocket] Not connected, cannot emit:", event);
    }
  }

  /**
   * 注册一次性监听（收到一次后自动移除）。用于 transfer_session 的
   * transfer_sent / transfer_failed ack 场景。
   */
  once(event: string, callback: Function) {
    if (!this.socket) {
      console.warn("[SharedSocket] once() called before connect, event:", event);
      return;
    }
    this.socket.once(event, callback as any);
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(callback);

    if (this.socket) {
      this.socket.on(event, callback as any);
    }
  }

  off(event: string, callback?: Function) {
    if (callback) {
      const callbacks = this.listeners.get(event) || [];
      const idx = callbacks.indexOf(callback);
      if (idx !== -1) {
        callbacks.splice(idx, 1);
      }
      this.socket?.off(event, callback as any);
    } else {
      this.listeners.delete(event);
      this.socket?.off(event);
    }
  }

  get id() {
    return this.socket?.id;
  }
  
  get connected() {
      return this.socket?.connected || false;
  }
}

export const socketService = new SharedSocketService();
