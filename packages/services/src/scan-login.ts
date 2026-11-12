import type { ISuccessResponse } from "./models";
import axios from "axios";
import { PLUS_API_BASE_URL, getPlusSocket } from "./plus";

export interface ScanLoginSourceConfig {
  id: string;
  internal: string;
  external: string;
  name?: string;
  /**
   * 可选凭据：Subsonic/Emby/飞牛等第三方数据源没有 nativeAuth token，
   * 扫码迁移时必须随配置携带用户名密码，目标端才能直接登录。
   * 仅经 HTTPS 在扫码会话内透传（5 分钟 TTL，consume 后即失效）。
   */
  username?: string;
  password?: string;
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

export interface ScanLoginSession {
  sessionId: string;
  secret: string;
  role: "scanner" | "target";
  deviceKind: "mobile" | "desktop";
  expiresAt: number;
}

export interface ScanLoginSessionStatus extends Omit<ScanLoginSession, "secret"> {
  status: "waiting_scan" | "waiting_confirm" | "confirmed" | "consumed" | "success" | "failed" | "expired";
  deviceName?: string;
  sourceBundles: ScanLoginSourceBundle[];
  hasNativeAuth: boolean;
  hasPlusAuth: boolean;
}

export interface ScanLoginClaimPayload {
  nativeAuth?: ScanLoginAuthBundle | null;
  plusAuth?: ScanLoginPlusBundle | null;
  sourceBundles: ScanLoginSourceBundle[];
  deviceName?: string;
}

export interface ScanLoginConfirmResult {
  nativeAuth: ScanLoginAuthBundle | null;
  plusAuth: ScanLoginPlusBundle | null;
  sourceBundles: ScanLoginSourceBundle[];
}

const scanLoginRequest = axios.create({
  baseURL: PLUS_API_BASE_URL,
});

scanLoginRequest.interceptors.response.use((response) => {
  const body = response.data;
  // 服务端业务错误以 HTTP 200 + 错误码 envelope 返回（如 {code:400,message,..}），
  // axios 不会抛错，必须在此显式拒绝，否则调用方会误判成功、静默失败
  if (
    body &&
    typeof body === "object" &&
    typeof body.code === "number" &&
    body.code !== 200 &&
    body.code !== 201
  ) {
    throw new Error(body.message || "扫码登录请求失败");
  }
  return body;
});

export const createScanLoginSession = async (data: {
  role: "scanner" | "target";
  deviceKind: "mobile" | "desktop";
}) => {
  return scanLoginRequest.post<any, ISuccessResponse<ScanLoginSession>>("/scan-login/session", data);
};

export const getScanLoginSession = async (sessionId: string, secret: string) => {
  return scanLoginRequest.get<any, ISuccessResponse<ScanLoginSessionStatus>>(
    `/scan-login/session/${sessionId}`,
    { params: { secret } },
  );
};

export const claimScanLoginSession = async (
  sessionId: string,
  data: { secret: string; payload: ScanLoginClaimPayload },
) => {
  return scanLoginRequest.post<any, ISuccessResponse<ScanLoginSessionStatus>>(
    `/scan-login/session/${sessionId}/claim`,
    data,
  );
};

export const confirmScanLoginSession = async (
  sessionId: string,
  data: { secret: string; selections?: { type: string; configIds: string[] }[] },
) => {
  return scanLoginRequest.post<any, ISuccessResponse<ScanLoginSessionStatus>>(
    `/scan-login/session/${sessionId}/confirm`,
    data,
  );
};

export const consumeScanLoginSession = async (
  sessionId: string,
  data: { secret: string; selections?: { type: string; configIds: string[] }[] },
) => {
  return scanLoginRequest.post<any, ISuccessResponse<ScanLoginConfirmResult>>(
    `/scan-login/session/${sessionId}/consume`,
    data,
  );
};

export const reportScanLoginResult = async (
  sessionId: string,
  data: { secret: string; success: boolean; error?: string },
) => {
  return scanLoginRequest.post<any, ISuccessResponse<ScanLoginSessionStatus>>(
    `/scan-login/session/${sessionId}/report`,
    data,
  );
};

const SCAN_LOGIN_POLL_INTERVAL = 1500;
const SCAN_LOGIN_WS_GRACE_PERIOD = 3000;

const isTerminalScanLoginStatus = (status?: string) =>
  status === "consumed" ||
  status === "success" ||
  status === "failed" ||
  status === "expired";

export const subscribeScanLoginSession = (
  sessionId: string,
  secret: string,
  listener: (status: ScanLoginSessionStatus) => void,
) => {
  const socket = getPlusSocket();
  const eventName = `scan_login_session_update:${sessionId}`;
  const reportEventName = "scan_login_report_result";

  let stopped = false;
  let lastStatus = "";
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;

  const notify = (status: ScanLoginSessionStatus) => {
    if (stopped || !status) return;
    // 按状态去重：WS 推送与轮询可能同时到达同一状态
    if (status.status === lastStatus) return;
    lastStatus = status.status;
    listener(status);
    if (isTerminalScanLoginStatus(status.status)) {
      stopPolling();
    }
  };

  const handleUpdate = (payload: {
    sessionId: string;
    secret?: string;
    status: ScanLoginSessionStatus;
  }) => {
    if (payload?.sessionId !== sessionId) return;
    if (payload?.secret && payload.secret !== secret) return;
    console.log("[scan-login] received session update", {
      sessionId: payload.sessionId,
      status: payload.status?.status,
    });
    notify(payload.status);
  };

  const handleReport = (payload: {
    sessionId: string;
    secret?: string;
    success: boolean;
    error?: string;
  }) => {
    if (payload?.sessionId !== sessionId) return;
    if (payload?.secret && payload.secret !== secret) return;
    console.log("[scan-login] received report result", {
      sessionId: payload.sessionId,
      success: payload.success,
      error: payload.error,
    });
    notify({ status: payload.success ? "success" : "failed", sessionId } as any);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const startPolling = () => {
    if (stopped || pollTimer) return;
    console.log("[scan-login] ws unavailable, fallback to polling", { sessionId });
    pollTimer = setInterval(async () => {
      if (stopped) return;
      try {
        const res = await getScanLoginSession(sessionId, secret);
        const status = (res as any)?.data as ScanLoginSessionStatus | undefined;
        if (status?.status) {
          notify(status);
        }
      } catch (err) {
        // 轮询失败静默重试，等待下一次 tick
      }
    }, SCAN_LOGIN_POLL_INTERVAL);
  };

  socket.on(eventName, handleUpdate);
  socket.on(reportEventName, handleReport);
  socket.emit("scan_login_watch", { sessionId, secret });

  // 宽限期内 WS 没有任何推送（未连接/推送丢失）则降级轮询，
  // 覆盖 wss 被代理/防火墙拦截、旧版 WS 地址静默无事件等场景
  graceTimer = setTimeout(() => {
    if (!stopped && !lastStatus) {
      startPolling();
    }
  }, SCAN_LOGIN_WS_GRACE_PERIOD);

  return () => {
    stopped = true;
    // socket.emit("scan_login_unwatch", { sessionId, secret });
    socket.off(eventName, handleUpdate);
    socket.off(reportEventName, handleReport);
    stopPolling();
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  };
};

export const reportScanLoginResultViaSocket = (
  sessionId: string,
  secret: string,
  success: boolean,
  error?: string,
) => {
  const socket = getPlusSocket();
  socket.emit("scan_login_report_result", { sessionId, secret, success, error });
};
