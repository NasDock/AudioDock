import webSocket from '@ohos.net.webSocket';
import { BusinessError } from '@ohos.base';
import { Logger } from 'audiodock_common';

/** socket 连接附加 query（ArkTS 严格模式禁未声明接口的对象字面量，用 class） */
export class SocketConnectQuery {
  deviceId?: string;
  platform?: string;
}

export class SocketConnectOptions {
  url: string = '';
  token?: string;
  userId?: string | number;
  deviceName?: string;
  query?: SocketConnectQuery;
}

interface SocketMessage {
  event?: string;
  payload?: Object | null;
}

export interface SocketWildcardPayload {
  event: string;
  payload: Object | null;
}

type Listener = (payload: Object | null | undefined) => void;

/**
 * HarmonyOS 原生 WebSocket 客户端，内置 engine.io v4 / socket.io v4 协议握手层，
 * 与后端 NestJS socket.io gateway（sync.gateway.ts）完全对齐。
 *
 * 协议要点（engine.io v4 over WebSocket，EIO=4）：
 *  - URL: /socket.io/?EIO=4&transport=websocket
 *  - 服务端首帧: `0{...handshake json...}`（engine.io OPEN）
 *  - 客户端回: `40{"token":"..."}`（engine.io MESSAGE + socket.io CONNECT，auth 随包）
 *  - 服务端回: `40{"sid":"..."}`（socket.io CONNECT_OK）
 *  - 心跳: 服务端 `2`（ping）→ 客户端必须回 `3`（pong）
 *  - 业务事件: `42["event",{payload}]`（engine.io MESSAGE + socket.io EVENT）
 *  - 客户端发事件: `42["event",{...}]`
 */
export class HarmonySocketService {
  private wsObj: webSocket.WebSocket | null = null;
  private url: string = '';
  private connected: boolean = false;
  private manualClose: boolean = false;
  private reconnectAttempt: number = 0;
  private maxReconnectMs: number = 30_000;
  private listeners = new Map<string, Set<Listener>>();
  private reconnectTimer: number | null = null;

  /** socket.io CONNECT 的 auth payload */
  private connectAuthToken: string = '';
  /** 是否已完成 socket.io 握手（收到 CONNECT_OK） */
  private socketIoReady: boolean = false;
  /** 握手失败兜底定时器：发出 CONNECT 后若超时未收到 CONNECT_OK 则判定失败重连 */
  private handshakeTimer: number | null = null;

  async connect(opts: SocketConnectOptions): Promise<void> {
    this.manualClose = false;
    this.connectAuthToken = opts.token ?? '';
    this.url = this.buildUrl(opts);
    await this.openSocket();
  }

  disconnect(): void {
    this.manualClose = true;
    this.socketIoReady = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearHandshakeTimer();
    if (this.wsObj) {
      const wsRef: webSocket.WebSocket = this.wsObj;
      this.wsObj = null;
      try {
        const closeResult = wsRef.close({ code: 1000, reason: 'manual' });
        closeResult.catch((err: BusinessError) => {
          Logger.w('Socket', `close rejected: ${err.message ?? String(err)}`);
        });
      } catch (e) {
        Logger.w('Socket', `close threw: ${String(e)}`);
      }
    }
    this.connected = false;
  }

  on(event: string, cb: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: string, cb?: Listener): void {
    const set = this.listeners.get(event);
    if (!set) return;
    if (cb) set.delete(cb); else set.clear();
  }

  emit(event: string, payload: Object): void {
    if (!this.wsObj || !this.connected || !this.socketIoReady) {
      Logger.w('Socket', `emit ${event} while not ready (connected=${this.connected}, ready=${this.socketIoReady})`);
      return;
    }
    // socket.io EVENT 帧: 42["event",payload]
    this.sendRaw(`42${JSON.stringify([event, payload])}`);
  }

  isConnected(): boolean { return this.connected && this.socketIoReady; }

  // ── engine.io 帧处理 ─────────────────────────────────────────

  private sendRaw(text: string): void {
    if (!this.wsObj) return;
    const promise = this.wsObj.send(text);
    promise.catch((err: BusinessError) => {
      Logger.e('Socket', `send failed: ${err.message ?? String(err)}`);
    });
  }

  private handleFrame(text: string): void {
    if (!text) return;
    const head = text.charAt(0);

    // engine.io OPEN: "0{...}"
    if (head === '0') {
      this.onEngineOpen();
      return;
    }
    // engine.io PING: "2" → 回 PONG "3"
    if (head === '2') {
      this.sendRaw('3');
      return;
    }
    // engine.io MESSAGE: "4..."（socket.io 数据包）
    if (head === '4') {
      this.onSocketIoPacket(text.substring(1));
      return;
    }
    // 其他（CLOSE "1"、NOOP "3" 等）忽略
  }

  private onEngineOpen(): void {
    // engine.io 握手完成 → 发 socket.io CONNECT（auth 里带 token）
    const authPayload = this.connectAuthToken
      ? JSON.stringify({ token: this.connectAuthToken })
      : '{}';
    this.sendRaw(`40${authPayload}`);
    // 兜底：5s 内没收到 CONNECT_OK 视为握手失败
    this.clearHandshakeTimer();
    this.handshakeTimer = setTimeout(() => {
      this.handshakeTimer = null;
      if (!this.socketIoReady) {
        Logger.e('Socket', 'socket.io handshake timeout, reconnecting');
        this.forceReconnect();
      }
    }, 5000) as number;
  }

  private onSocketIoPacket(body: string): void {
    const type = body.charAt(0);
    // CONNECT_OK: "0{...}"
    if (type === '0') {
      this.socketIoReady = true;
      this.clearHandshakeTimer();
      this.reconnectAttempt = 0;
      Logger.i('Socket', 'socket.io connected');
      this.dispatch('connect', null);
      return;
    }
    // EVENT / BINARY_EVENT: "2[...]"（binary 不支持，按 event 处理）
    if (type === '2' || type === '3') {
      const arrText = body.substring(1);
      try {
        const arr = JSON.parse(arrText) as Object[];
        const event = String(arr[0]);
        const payload = arr.length > 1 ? arr[1] : null;
        this.dispatch(event, payload);
      } catch (e) {
        Logger.w('Socket', `bad socket.io event: ${String(e)}`);
      }
      return;
    }
    // CONNECT_ERROR: "4{\"message\":\"...\"}"
    if (type === '4') {
      Logger.e('Socket', `socket.io connect error: ${body.substring(1)}`);
      this.forceReconnect();
      return;
    }
    // DISCONNECT: "1" → 服务端断开 socket.io namespace
    if (type === '1') {
      Logger.w('Socket', 'socket.io disconnected by server');
      this.forceReconnect();
      return;
    }
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer !== null) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private forceReconnect(): void {
    this.socketIoReady = false;
    this.clearHandshakeTimer();
    if (this.wsObj) {
      const wsRef = this.wsObj;
      this.wsObj = null;
      wsRef.close({ code: 1000, reason: 'handshake_failed' }).catch(() => undefined);
    }
    this.connected = false;
    if (!this.manualClose) this.scheduleReconnect();
  }

  // ── WebSocket 生命周期 ──────────────────────────────────────

  private async openSocket(): Promise<void> {
    this.socketIoReady = false;
    this.wsObj = webSocket.createWebSocket();
    this.wsObj.on('open', (err: BusinessError, _value: Object) => {
      if (err) {
        Logger.e('Socket', `open error: ${err.message}`);
        return;
      }
      // WS 已建立，等待服务端 engine.io OPEN 帧
      this.connected = true;
      Logger.i('Socket', 'ws connected, waiting engine.io handshake');
    });
    this.wsObj.on('message', (err: BusinessError, data: string | ArrayBuffer) => {
      if (err) {
        Logger.e('Socket', `message error: ${err.message}`);
        return;
      }
      const text = typeof data === 'string' ? data : '';
      this.handleFrame(text);
    });
    this.wsObj.on('close', (err: BusinessError, _value: webSocket.CloseResult) => {
      this.connected = false;
      this.socketIoReady = false;
      this.clearHandshakeTimer();
      if (err) {
        Logger.w('Socket', `close error: ${err.message}`);
      } else {
        Logger.w('Socket', 'closed');
      }
      this.dispatch('disconnect', null);
      if (!this.manualClose) this.scheduleReconnect();
    });
    this.wsObj.on('error', (err: BusinessError) => {
      Logger.e('Socket', `error: ${err.message}`);
    });
    try {
      await this.wsObj.connect(this.url, undefined);
    } catch (e) {
      Logger.e('Socket', `connect failed: ${String(e)}`);
      if (!this.manualClose) this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), this.maxReconnectMs);
    this.reconnectAttempt += 1;
    Logger.i('Socket', `reconnect in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualClose) return;
      this.openSocket().catch(() => undefined);
    }, delay) as number;
  }

  private dispatch(event: string, payload: Object | null | undefined): void {
    const set = this.listeners.get(event);
    if (set) for (const cb of set) cb(payload);
    // 透传给 wildcard 订阅者
    const wild = this.listeners.get('*');
    if (wild) {
      const wc: SocketWildcardPayload = { event, payload: payload ?? null };
      for (const cb of wild) cb(wc);
    }
  }

  private buildUrl(opts: SocketConnectOptions): string {
    // 规范化：http→ws / https→wss，并拼上 socket.io 的 engine.io 路径
    let u = opts.url
      .replace(/^http:\/\//, 'ws://')
      .replace(/^https:\/\//, 'wss://')
      .replace(/\/$/, '');
    u += '/socket.io/';

    const q: string[] = ['EIO=4', 'transport=websocket'];
    if (opts.userId !== undefined) q.push(`userId=${encodeURIComponent(String(opts.userId))}`);
    if (opts.deviceName) q.push(`deviceName=${encodeURIComponent(opts.deviceName)}`);
    if (opts.query?.deviceId) q.push(`deviceId=${encodeURIComponent(opts.query.deviceId)}`);
    if (opts.query?.platform) q.push(`platform=${encodeURIComponent(opts.query.platform)}`);
    return `${u}?${q.join('&')}`;
  }
}

export const socketService: HarmonySocketService = new HarmonySocketService();
