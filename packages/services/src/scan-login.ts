import type { ISuccessResponse } from "./models";
import axios from "axios";
import { PLUS_API_BASE_URL, getPlusSocket } from "./plus";

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

scanLoginRequest.interceptors.response.use((response) => response.data);

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

export const subscribeScanLoginSession = (
  sessionId: string,
  secret: string,
  listener: (status: ScanLoginSessionStatus) => void,
) => {
  const socket = getPlusSocket();
  const eventName = `scan_login_session_update:${sessionId}`;

  const handleUpdate = (payload: {
    sessionId: string;
    secret?: string;
    status: ScanLoginSessionStatus;
  }) => {
    if (payload?.sessionId !== sessionId) return;
    if (payload?.secret && payload.secret !== secret) return;
    listener(payload.status);
  };

  const handleReport = (payload: { sessionId: string; success: boolean; error?: string }) => {
    if (payload?.sessionId !== sessionId) return;
    listener({ status: payload.success ? "success" : "failed", sessionId } as any);
  };

  socket.on(eventName, handleUpdate);
  socket.on("scan_login_report_result", handleReport);
  socket.emit("scan_login_watch", { sessionId, secret });

  return () => {
    socket.emit("scan_login_unwatch", { sessionId, secret });
    socket.off(eventName, handleUpdate);
    socket.off("scan_login_report_result", handleReport);
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
