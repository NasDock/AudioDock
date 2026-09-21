import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnModuleInit } from '@nestjs/common';
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
export class SyncGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async onModuleInit() {
    // 服务重启后所有 socket 均已断开，清空遗留的在线标记，避免设备列表显示「僵尸在线」设备
    try {
      await this.userService.markAllDevicesOffline();
      console.log('[WS] onModuleInit: 已清空所有设备的 isOnline 状态');
    } catch (e) {
      console.warn('[WS] onModuleInit: 清空 isOnline 失败', e);
    }
  }

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
        console.warn(`[WS] auth token invalid for socket ${client.id}:`, (e as Error).message);
        return null;
      }
    }
    // 兼容未升级的客户端：query.userId（无鉴权，后续版本将移除）
    const rawUserId = client.handshake.query.userId;
    if (rawUserId) {
      console.log(`[WS] socket ${client.id} auth via legacy query.userId=${rawUserId}（无 token，建议客户端升级）`);
      return { userId: parseInt(rawUserId as string, 10) };
    }
    return null;
  }

  async handleConnection(client: Socket) {
    // ⚠️ harmony 端（ohos webSocket）对 URL query 校验极严（自定义参数即 401 Parameter error），
    // 所有业务参数都走 socket.io CONNECT 的 auth payload；其他端仍走 query。这里按 query → auth 兜底。
    const authData = (client.handshake.auth ?? {}) as Record<string, any>;
    const deviceName = (client.handshake.query.deviceName as string | undefined)
      || (authData.deviceName as string | undefined)
      || 'Unknown Device';
    const deviceId = (client.handshake.query.deviceId as string | undefined)
      || (authData.deviceId as string | undefined);
    const platform = (client.handshake.query.platform as string | undefined)
      || (authData.platform as string | undefined);

    const auth = await this.resolveAuth(client);
    if (!auth) {
      console.warn(`Client ${client.id} rejected: no valid auth`);
      client.emit('auth_error', { message: 'unauthorized' });
      client.disconnect(true);
      return;
    }
    const uid = auth.userId;

    console.log(`[WS] connected: socket=${client.id} user=${uid} deviceName=${deviceName} deviceId=${deviceId} platform=${platform}`);

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
    console.log(`[WS] user ${uid} online sockets: ${sockets.length} -> [${this.describeSockets(sockets)}]`);

    // Set device online
    if (deviceName) {
      try {
        const device = await this.userService.saveDevice(uid, deviceName, deviceId, platform);
        console.log(`[WS] device_online: user=${uid} deviceId=${device.deviceId ?? deviceId} name=${device.name} platform=${device.platform}`);
        // 广播设备上线（含本端其他设备）
        this.server.to(`user_${uid}`).emit('device_online', {
          deviceId: device.deviceId ?? deviceId ?? null,
          deviceName: device.name,
          platform: device.platform ?? platform ?? null,
          lastSeen: device.lastSeen,
        });
      } catch (e) {
        console.error(`[WS] Failed to set device online: ${e}`);
      }
    }
  }

  /** 打印一组 socket 的设备信息（排查流转送达问题时用） */
  private describeSockets(socketIds: string[]): string {
    return socketIds
      .map((sid) => {
        const m = this.socketMetadata.get(sid);
        return m ? `${sid}(dev=${m.deviceId ?? '∅'}/name=${m.deviceName})` : sid;
      })
      .join(', ');
  }

  async handleDisconnect(client: Socket) {
    const meta = this.socketMetadata.get(client.id);
    console.log(`[WS] disconnected: socket=${client.id} user=${meta?.userId} deviceName=${meta?.deviceName} deviceId=${meta?.deviceId} platform=${meta?.platform}`);
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
    const all = this.userSockets.get(userId) || [];
    const targetSockets = all.filter((sid) => {
      const m = this.socketMetadata.get(sid);
      return m?.deviceId === payload.targetDeviceId;
    });
    console.log(`[WS][Transfer] REST forwardTransfer: user=${userId} targetDeviceId=${payload.targetDeviceId} online=[${this.describeSockets(all)}] matched=${targetSockets.length}`);
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
    /** 目标设备名（deviceId 漂移时的兜底匹配维度） */
    targetDeviceName?: string;
    /** 目标平台（配合 deviceName 兜底，避免同名不同端误中） */
    targetPlatform?: string;
    currentTrack?: any;
    playlist?: any;
    progress?: number;
  }) {
    const meta = this.socketMetadata.get(client.id);
    if (!meta) {
      console.warn(`[WS][Transfer] transfer_session from unknown socket ${client.id}（无 meta，可能未注册），直接拒绝`);
      client.emit('transfer_failed', { targetDeviceId: payload?.targetDeviceId, reason: 'sender_not_registered' });
      return;
    }
    const uid = meta.userId;

    const all = this.userSockets.get(uid) || [];
    const trackName = payload?.currentTrack?.name ?? '(none)';
    console.log(`[WS][Transfer] transfer_session: user=${uid} from=${meta.deviceName}(${meta.deviceId}) target=${payload?.targetDeviceId} track=${trackName} progress=${payload?.progress}s online=[${this.describeSockets(all)}]`);

    // 找到目标设备的 socket（同 userId 且 deviceId 匹配）
    let targetSockets = all.filter((sid) => {
      const m = this.socketMetadata.get(sid);
      return m?.deviceId === payload.targetDeviceId && sid !== client.id;
    });

    // 兜底：deviceId 匹配不到时（旧端 deviceId 漂移 / DB 脏数据），
    // 回退按 deviceName + platform 匹配。deviceName（主机名/设备名）通常比 deviceId 更稳定。
    if (targetSockets.length === 0 && payload.targetDeviceName) {
      targetSockets = all.filter((sid) => {
        const m = this.socketMetadata.get(sid);
        return (
          sid !== client.id &&
          m?.deviceName === payload.targetDeviceName &&
          (!payload.targetPlatform || m?.platform === payload.targetPlatform)
        );
      });
      if (targetSockets.length > 0) {
        console.log(`[WS][Transfer] deviceId 未命中，已按 deviceName+platform 兜底命中 ${targetSockets.length} 个 socket（targetName=${payload.targetDeviceName}）`);
      }
    }

    if (targetSockets.length === 0) {
      const onlineDeviceIds = all.map((sid) => this.socketMetadata.get(sid)?.deviceId ?? '∅');
      console.warn(`[WS][Transfer] ❌ no match for targetDeviceId=${payload.targetDeviceId}，用户 ${uid} 在线设备 deviceIds=[${onlineDeviceIds.join(', ')}]`);
      // 把服务端视角的在线 deviceIds 一并回给发起端，前端日志可直接对比，不用翻服务端日志
      client.emit('transfer_failed', {
        targetDeviceId: payload.targetDeviceId,
        reason: 'device_offline',
        onlineDeviceIds: onlineDeviceIds,
      });
      return;
    }

    console.log(`[WS][Transfer] ✅ delivering transfer_received to ${targetSockets.length} socket(s): [${targetSockets.join(', ')}]`);
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
