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

export class SharedSocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, Function[]> = new Map();

  /**
   * Initialize a connection. 
   * Safe to call multiple times; will ignore if already connected with same socket instance (but usually you should check connected status).
   */
  connect(options: SocketConnectOptions) {
    if (this.socket?.connected) {
        // Optional: logic to disconnect if options changed significantly?
        // For now, assume single connection per instance lifecycle or manual disconnect first.
        return;
    }

    const { url, token, userId, deviceName, deviceId, platform, query } = options;

    this.socket = io(url, {
      query: {
        userId,
        deviceName,
        ...(deviceId ? { deviceId } : {}),
        ...(platform ? { platform } : {}),
        ...query
      },
      transports: ["websocket"],
      auth: {
        token,
      }
    });

    this.socket.on("connect", () => {
      console.log(`[SharedSocket] Connected: ${this.socket?.id} (deviceId=${deviceId}, deviceName=${deviceName}, platform=${platform})`);
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

    // Re-attach listeners if any were added before connection
    this.listeners.forEach((callbacks, event) => {
      callbacks.forEach(cb => this.socket?.on(event, cb as any));
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
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
