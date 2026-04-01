import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

type ScanRole = 'scanner' | 'target';
type DeviceKind = 'mobile' | 'desktop';
type SessionStatus =
  | 'waiting_scan'
  | 'waiting_confirm'
  | 'confirmed'
  | 'consumed'
  | 'expired';

export interface ScanLoginSourceConfig {
  id: string;
  internal: string;
  external: string;
  name?: string;
}

export interface ScanLoginSourceBundle {
  type: string;
  configs: ScanLoginSourceConfig[];
}

export interface ScanLoginAuthBundle {
  baseUrl: string;
  sourceType: string;
  token: string;
  user: any;
  device?: any;
}

export interface ScanLoginPlusBundle {
  token: string;
  userId: string | number;
}

export interface ScanLoginClaimPayload {
  nativeAuth?: ScanLoginAuthBundle | null;
  plusAuth?: ScanLoginPlusBundle | null;
  sourceBundles: ScanLoginSourceBundle[];
  deviceName?: string;
}

interface SessionRecord {
  id: string;
  secret: string;
  role: ScanRole;
  deviceKind: DeviceKind;
  createdAt: number;
  expiresAt: number;
  status: SessionStatus;
  claimedByUserId?: number;
  claimedAt?: number;
  confirmedAt?: number;
  payload?: ScanLoginClaimPayload;
}

@Injectable()
export class ScanLoginService {
  private readonly ttlMs = 5 * 60 * 1000;
  private readonly sessions = new Map<string, SessionRecord>();

  createSession(role: ScanRole, deviceKind: DeviceKind) {
    this.cleanupExpiredSessions();
    const id = randomBytes(12).toString('hex');
    const secret = randomBytes(18).toString('hex');
    const now = Date.now();

    const session: SessionRecord = {
      id,
      secret,
      role,
      deviceKind,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      status: 'waiting_scan',
    };

    this.sessions.set(id, session);

    return {
      sessionId: id,
      secret,
      role,
      deviceKind,
      expiresAt: session.expiresAt,
    };
  }

  getSessionStatus(sessionId: string, secret: string) {
    const session = this.getValidSession(sessionId, secret);

    return {
      sessionId: session.id,
      status: session.status,
      expiresAt: session.expiresAt,
      role: session.role,
      deviceKind: session.deviceKind,
      deviceName: session.payload?.deviceName,
      sourceBundles: (session.payload?.sourceBundles || []).map((bundle) => ({
        type: bundle.type,
        configs: bundle.configs,
      })),
      hasNativeAuth: !!session.payload?.nativeAuth,
      hasPlusAuth: !!session.payload?.plusAuth,
    };
  }

  claimSession(
    sessionId: string,
    secret: string,
    userId: number,
    payload: ScanLoginClaimPayload,
  ) {
    const session = this.getValidSession(sessionId, secret);

    if (session.status !== 'waiting_scan') {
      throw new Error('二维码状态已变化，请刷新后重试');
    }

    session.status = 'waiting_confirm';
    session.claimedByUserId = userId;
    session.claimedAt = Date.now();
    session.payload = payload;

    return this.getSessionStatus(sessionId, secret);
  }

  confirmSession(
    sessionId: string,
    secret: string,
    selections?: { type: string; configIds: string[] }[],
  ) {
    const session = this.getValidSession(sessionId, secret);

    if (session.status !== 'waiting_confirm' || !session.payload) {
      throw new Error('当前二维码还没有可确认的登录信息');
    }

    const selectedBundles = this.filterSelectedBundles(
      session.payload.sourceBundles,
      selections,
    );

    session.status = 'consumed';
    session.confirmedAt = Date.now();

    return {
      nativeAuth: session.payload.nativeAuth || null,
      plusAuth: session.payload.plusAuth || null,
      sourceBundles: selectedBundles,
    };
  }

  private filterSelectedBundles(
    bundles: ScanLoginSourceBundle[],
    selections?: { type: string; configIds: string[] }[],
  ) {
    if (!selections?.length) {
      return bundles;
    }

    const selectionMap = new Map(
      selections.map((item) => [item.type, new Set(item.configIds || [])]),
    );

    return bundles
      .map((bundle) => {
        const selectedIds = selectionMap.get(bundle.type);
        if (!selectedIds) {
          return {
            ...bundle,
            configs: [],
          };
        }
        return {
          ...bundle,
          configs: bundle.configs.filter((config) =>
            selectedIds.has(config.id),
          ),
        };
      })
      .filter((bundle) => bundle.configs.length > 0);
  }

  private getValidSession(sessionId: string, secret: string) {
    this.cleanupExpiredSessions();

    const session = this.sessions.get(sessionId);
    if (!session || session.secret !== secret) {
      throw new Error('二维码已失效，请重新生成');
    }

    if (session.expiresAt <= Date.now()) {
      session.status = 'expired';
      this.sessions.delete(sessionId);
      throw new Error('二维码已过期，请重新生成');
    }

    return session;
  }

  private cleanupExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id);
      }
    }
  }
}
