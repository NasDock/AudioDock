import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { UserService } from '../services/user';

interface SocketMeta {
  userId: number;
  deviceName: string;
  deviceId?: string;
  platform?: string;
  username?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class SyncGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  // Map<UserId, SocketId[]> - Stores all active socket IDs for a user
  private userSockets = new Map<number, string[]>();
  // Map<SocketId, SocketMeta>
  private socketMetadata = new Map<string, SocketMeta>();

  /**
   * 从 handshake 中解析并校验用户身份。
   * 优先使用 auth.token（JWT），解析失败则回退 query.userId（兼容旧客户端，逐步收紧）。
   */
  private async resolveAuth(client: Socket): Promise<{ userId: number; username?: string } | null> {
    const token = (client.handshake.auth?.token || client.handshake.query?.token) as string | undefined;
    if (token) {
      try {
        const payload = this.jwtService.verify(token);
        return { userId: Number(payload.sub), username: payload.username };
      } catch (e) {
        console.warn(`WS auth token invalid for socket ${client.id}:`, (e as Error).message);
        return null;
      }
    }
    // 兼容未升级的客户端：query.userId（无鉴权，后续版本将移除）
    const rawUserId = client.handshake.query.userId;
    if (rawUserId) {
      return { userId: parseInt(rawUserId as string, 10) };
    }
    return null;
  }

  async handleConnection(client: Socket) {
    const deviceName = client.handshake.query.deviceName as string;
    const deviceId = client.handshake.query.deviceId as string | undefined;
    const platform = client.handshake.query.platform as string | undefined;

    const auth = await this.resolveAuth(client);
    if (!auth) {
      console.warn(`Client ${client.id} rejected: no valid auth`);
      client.emit('auth_error', { message: 'unauthorized' });
      client.disconnect(true);
      return;
    }
    const uid = auth.userId;

    console.log(`Client connected: ${client.id}, User: ${uid}, Device: ${deviceName}, Platform: ${platform}, DeviceId: ${deviceId}`);

    const sockets = this.userSockets.get(uid) || [];
    sockets.push(client.id);
    this.userSockets.set(uid, sockets);

    this.socketMetadata.set(client.id, {
      userId: uid,
      deviceName,
      deviceId,
      platform,
      username: auth.username,
    });

    // Join a room named by user ID for easy broadcasting to specific users
    client.join(`user_${uid}`);

    // Set device online
    if (deviceName) {
      try {
        const device = await this.userService.saveDevice(uid, deviceName, deviceId, platform);
        // 广播设备上线（含本端其他设备）
        this.server.to(`user_${uid}`).emit('device_online', {
          deviceId: device.deviceId ?? deviceId ?? null,
          deviceName: device.name,
          platform: device.platform ?? platform ?? null,
          lastSeen: device.lastSeen,
        });
      } catch (e) {
        console.error(`Failed to set device online: ${e}`);
      }
    }
  }

  async handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    const meta = this.socketMetadata.get(client.id);
    if (!meta) return;

    const uid = meta.userId;
    const sockets = this.userSockets.get(uid) || [];
    const updatedSockets = sockets.filter((id) => id !== client.id);

    if (updatedSockets.length > 0) {
      this.userSockets.set(uid, updatedSockets);
    } else {
      this.userSockets.delete(uid);
    }

    // 仅当同一设备（deviceId 或 deviceName）没有其他活跃 socket 时才置离线
    if (meta.deviceName) {
      const deviceStillConnected = updatedSockets.some((sid) => {
        const m = this.socketMetadata.get(sid);
        if (!m) return false;
        if (meta.deviceId) return m.deviceId === meta.deviceId;
        return m.deviceName === meta.deviceName;
      });

      if (!deviceStillConnected) {
        try {
          await this.userService.setDeviceOffline(uid, meta.deviceName, meta.deviceId);
          this.server.to(`user_${uid}`).emit('device_offline', {
            deviceId: meta.deviceId ?? null,
            deviceName: meta.deviceName,
          });
        } catch (e) {
          console.error(`Failed to set device offline: ${e}`);
        }
      }
    }

    this.socketMetadata.delete(client.id);
  }

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(client: Socket) {
    const meta = this.socketMetadata.get(client.id);
    if (meta?.deviceId) {
      await this.userService.touchDevice(meta.userId, meta.deviceId);
    }
  }

  @SubscribeMessage('invite')
  async handleInvite(client: Socket, payload: { targetUserIds: number[]; currentTrack?: any; playlist?: any; progress?: number; sessionId?: string }) {
    const meta = this.socketMetadata.get(client.id);
    const senderId = meta?.userId ?? parseInt(client.handshake.query.userId as string, 10);
    const senderDeviceName = meta?.deviceName || 'Unknown Device';

    const senderUser = await this.userService.getUserById(senderId);
    const senderUsername = senderUser?.username || `User ${senderId}`;

    const sessionId = payload.sessionId || `sync_session_${senderId}_${Date.now()}`;

    console.log(`User ${senderId} (${senderDeviceName}) inviting users: ${payload.targetUserIds} to session ${sessionId}`);

    payload.targetUserIds.forEach((targetId) => {
      this.server.to(`user_${targetId}`).emit('invite_received', {
        fromUserId: senderId,
        fromUsername: senderUsername,
        fromDeviceName: senderDeviceName,
        fromSocketId: client.id,
        sessionId: sessionId,
        currentTrack: payload.currentTrack,
        playlist: payload.playlist,
        progress: payload.progress,
        timestamp: new Date(),
      });
    });
  }

  @SubscribeMessage('respond_invite')
  handleRespondInvite(client: Socket, payload: { fromUserId: number; fromSocketId?: string; sessionId?: string; accept: boolean }) {
    const meta = this.socketMetadata.get(client.id);
    const responderId = meta?.userId ?? parseInt(client.handshake.query.userId as string, 10);
    const targetRoom = payload.sessionId || `sync_session_${payload.fromUserId}_${responderId}_${Date.now()}`;

    const responderSockets = this.userSockets.get(responderId) || [];
    responderSockets.forEach((sid) => {
      if (sid !== client.id) {
        this.server.to(sid).emit('invite_handled', {
          fromUserId: payload.fromUserId,
          handledByDevice: this.socketMetadata.get(client.id)?.deviceName,
        });
      }
    });

    if (payload.accept) {
      console.log(`User ${responderId} accepted invite from ${payload.fromUserId} for session ${targetRoom}`);

      if (payload.fromSocketId) {
        const senderSocket = this.server.sockets.sockets.get(payload.fromSocketId);
        if (senderSocket) {
          senderSocket.join(targetRoom);
        } else {
          console.warn(`Sender socket ${payload.fromSocketId} not found, sync might fail for sender.`);
        }
      } else {
        const senderSockets = this.userSockets.get(Number(payload.fromUserId)) || [];
        senderSockets.forEach((sid) => {
          const s = this.server.sockets.sockets.get(sid);
          s?.join(targetRoom);
        });
      }

      client.join(targetRoom);

      this.server.to(targetRoom).emit('sync_session_started', {
        sessionId: targetRoom,
        users: [payload.fromUserId, responderId],
      });

      if (payload.fromSocketId) {
        this.server.to(payload.fromSocketId).emit('request_initial_state', { targetRoom });
      } else {
        this.server.to(`user_${payload.fromUserId}`).emit('request_initial_state', { targetRoom });
      }

      this.broadcastParticipants(targetRoom);
    } else {
      console.log(`User ${responderId} rejected invite from ${payload.fromUserId}`);
      if (payload.fromSocketId) {
        this.server.to(payload.fromSocketId).emit('invite_rejected', { fromUserId: responderId });
      } else {
        this.server.to(`user_${payload.fromUserId}`).emit('invite_rejected', { fromUserId: responderId });
      }
    }
  }

  @SubscribeMessage('sync_command')
  handleSyncCommand(client: Socket, payload: {
    sessionId: string;
    type: 'play' | 'pause' | 'seek' | 'track_change' | 'playlist_change' | 'playlist';
    data: any;
    targetSocketId?: string;
  }) {
    // 若指定了目标 socket，则定向发送；否则广播到会话内除发送者外所有人
    if (payload.targetSocketId) {
      this.server.to(payload.targetSocketId).emit('sync_event', {
        type: payload.type,
        data: payload.data,
        senderId: this.socketMetadata.get(client.id)?.userId,
      });
      return;
    }
    client.to(payload.sessionId).emit('sync_event', {
      type: payload.type,
      data: payload.data,
      senderId: this.socketMetadata.get(client.id)?.userId,
    });
  }

  /**
   * 供 REST 接口调用：把播放流转请求转发给目标设备（小程序/TV 等无常驻 WS 的端用）。
   * 返回是否送达（目标设备在线）。
   */
  async forwardTransfer(userId: number, payload: {
    targetDeviceId: string;
    currentTrack?: any;
    playlist?: any;
    progress?: number;
    fromDeviceName?: string;
  }): Promise<boolean> {
    const targetSockets = (this.userSockets.get(userId) || []).filter((sid) => {
      const m = this.socketMetadata.get(sid);
      return m?.deviceId === payload.targetDeviceId;
    });
    if (targetSockets.length === 0) return false;
    targetSockets.forEach((sid) => {
      this.server.to(sid).emit('transfer_received', {
        fromDeviceName: payload.fromDeviceName ?? 'Unknown Device',
        fromDeviceId: null,
        currentTrack: payload.currentTrack,
        playlist: payload.playlist,
        progress: payload.progress,
        timestamp: new Date(),
      });
    });
    return true;
  }

  /**
   * 播放流转：把当前播放内容推给同账号下的目标设备。
   * payload: { targetDeviceId, currentTrack, playlist, progress }
   */
  @SubscribeMessage('transfer_session')
  async handleTransferSession(client: Socket, payload: {
    targetDeviceId: string;
    currentTrack?: any;
    playlist?: any;
    progress?: number;
  }) {
    const meta = this.socketMetadata.get(client.id);
    if (!meta) return;
    const uid = meta.userId;

    console.log(`User ${uid} transferring session from ${meta.deviceName} to device ${payload.targetDeviceId}`);

    // 找到目标设备的 socket（同 userId 且 deviceId 匹配）
    const targetSockets = (this.userSockets.get(uid) || []).filter((sid) => {
      const m = this.socketMetadata.get(sid);
      return m?.deviceId === payload.targetDeviceId && sid !== client.id;
    });

    if (targetSockets.length === 0) {
      client.emit('transfer_failed', { targetDeviceId: payload.targetDeviceId, reason: 'device_offline' });
      return;
    }

    targetSockets.forEach((sid) => {
      this.server.to(sid).emit('transfer_received', {
        fromDeviceName: meta.deviceName,
        fromDeviceId: meta.deviceId ?? null,
        currentTrack: payload.currentTrack,
        playlist: payload.playlist,
        progress: payload.progress,
        timestamp: new Date(),
      });
    });

    client.emit('transfer_sent', { targetDeviceId: payload.targetDeviceId });
  }

  @SubscribeMessage('player_left')
  async handlePlayerLeft(client: Socket, payload: { sessionId: string }) {
    const meta = this.socketMetadata.get(client.id);
    const userId = meta?.userId ?? parseInt(client.handshake.query.userId as string, 10);
    const deviceName = meta?.deviceName || 'Unknown Device';

    let username = meta?.username || `User ${userId}`;
    if (!meta?.username) {
      try {
        const user = await this.userService.getUserById(userId);
        username = user?.username || username;
      } catch (e) {
        console.error('Failed to get username:', e);
      }
    }

    console.log(`Player ${username} (${deviceName}) left session ${payload.sessionId}`);

    client.leave(payload.sessionId);

    this.server.to(payload.sessionId).emit('player_left', {
      userId,
      username,
      deviceName,
    });

    const room = this.server.sockets.adapter.rooms.get(payload.sessionId);
    if (!room || room.size === 0) {
      console.log(`Session ${payload.sessionId} is now empty, ending session`);
      this.server.to(payload.sessionId).emit('session_ended', { sessionId: payload.sessionId });
    } else {
      await this.broadcastParticipants(payload.sessionId);
    }
  }

  // Helper to get and broadcast participants
  private async broadcastParticipants(sessionId: string) {
    const room = this.server.sockets.adapter.rooms.get(sessionId);
    console.log(`Broadcasting participants for session ${sessionId}. Room size: ${room?.size}`);

    if (!room) return;

    const participants: { socketId: string; userId: number; username: string; deviceName: string; platform?: string }[] = [];

    for (const socketId of room) {
      const meta = this.socketMetadata.get(socketId);
      const socket = this.server.sockets.sockets.get(socketId);

      if (socket && meta) {
        let username = meta.username || `User ${meta.userId}`;
        if (!meta.username) {
          const user = await this.userService.getUserById(meta.userId);
          username = user?.username || username;
          meta.username = username;
        }

        participants.push({
          socketId,
          userId: meta.userId,
          username,
          deviceName: meta.deviceName || 'Unknown Device',
          platform: meta.platform,
        });
      }
    }

    console.log('Sending participants update:', participants);
    this.server.to(sessionId).emit('participants_update', { participants });
  }
}
