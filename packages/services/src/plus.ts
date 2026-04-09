import axios from "axios";
import { ISuccessResponse } from "./models";
import { io, type Socket } from "socket.io-client";

export const PLUS_API_BASE_URL = "https://www.audiodock.cn/api";
export const PLUS_WS_BASE_URL = "https://www.audiodock.cn/ws";

const plusRequest = axios.create({
  baseURL: PLUS_API_BASE_URL,
});

let plusSocket: Socket | null = null;
let plusUnauthorizedHandler: (() => void | Promise<void>) | null = null;
let isHandlingPlusUnauthorized = false;

export const getPlusSocket = (): Socket => {
  if (!plusSocket) {
    plusSocket = io(PLUS_WS_BASE_URL, {
      transports: ["websocket"],
    });
  }
  return plusSocket;
};

/**
 * 设置 Plus 服务的验证 Token
 * @param token JWT Token
 */
export const setPlusToken = (token: string) => {
  plusRequest.defaults.headers.common["Authorization"] = `Bearer ${token}`;
};

/**
 * 移除 Plus 服务的验证 Token
 */
export const removePlusToken = () => {
  delete plusRequest.defaults.headers.common["Authorization"];
};

export const setPlusUnauthorizedHandler = (
  handler: (() => void | Promise<void>) | null,
) => {
  plusUnauthorizedHandler = handler;
};

const hasPlusAuthHeader = (headers: any) => {
  if (!headers) return false;
  const authHeader =
    headers.Authorization ||
    headers.authorization ||
    headers.common?.Authorization ||
    headers.common?.authorization;
  return Boolean(authHeader);
};

const isPlusUnauthorizedPayload = (payload: any) => {
  if (!payload || typeof payload !== "object") return false;
  if (payload.code !== 401) return false;
  const message = String(payload.message || "").toLowerCase();
  return message === "invalid token" || message === "missing token";
};

const handlePlusUnauthorized = async () => {
  if (isHandlingPlusUnauthorized) return;
  isHandlingPlusUnauthorized = true;

  try {
    removePlusToken();
    await plusUnauthorizedHandler?.();
  } finally {
    setTimeout(() => {
      isHandlingPlusUnauthorized = false;
    }, 0);
  }
};

plusRequest.interceptors.response.use(
  async (response) => {
    if (
      hasPlusAuthHeader(response.config?.headers) &&
      isPlusUnauthorizedPayload(response.data)
    ) {
      await handlePlusUnauthorized();
    }
    return response;
  },
  async (error) => {
    const status = error?.response?.status;
    if (
      status === 401 &&
      hasPlusAuthHeader(error?.config?.headers)
    ) {
      await handlePlusUnauthorized();
    }
    return Promise.reject(error);
  },
);

// --- DTO Types ---

export interface SendCodeDto {
  /** Phone number in E.164 format, e.g. +8613812345678 */
  phone: string;
}

export interface LoginDto {
  /** Phone number in E.164 format */
  phone: string;
  /** Verification code */
  code: string;
}

export type PaymentMethod = "WECHAT" | "ALIPAY" | "STRIPE" | "PAYPAL" | "OTHER";
export type VipTier = "NONE" | "BASIC" | "PREMIUM" | "LIFETIME";
export type PaymentClientType = "app" | "web" | "desktop" | "mobile" | "mini";

export interface CreatePaymentDto {
  userId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  clientType?: PaymentClientType;
  forVip: boolean;
  vipTier: VipTier;
  forPoints: boolean;
  pointsAmount: number;
}

export interface WechatPayPayload {
  appId: string;
  partnerId: string;
  prepayId: string;
  nonceStr: string;
  timeStamp: string;
  sign: string;
  package?: string;
  signType?: string;
}

export interface AlipayPayPayload {
  orderString: string | null;
  scheme?: string;
}

export interface CreatePaymentResponse {
  orderId: string;
  paymentUrl?: string;
  qrCode?: string;
  wechatPay?: WechatPayPayload;
  alipayPay?: AlipayPayPayload;
}

export interface ConsumePointsDto {
  userId: string;
  amount: number;
  description?: string;
}

export type TrackingPlatform = "mobile" | "desktop" | "web" | "mini";

export interface TrackingEventDto {
  platform: TrackingPlatform;
  feature: string;
  eventName: string;
  userId?: string | null;
  sessionId?: string;
  deviceId?: string;
  value?: number;
  occurredAt?: string;
  metadata?: Record<string, any>;
}

export interface AppleIapVerifyDto {
  userId: string;
  productId: string;
  receipt: string;
  transactionId?: string;
  originalTransactionId?: string;
  transactionDate?: string;
}

export interface VipCurrentLowestPricePlan {
  originalPrice: number;
  discountPercent: number;
  currentPrice: number;
}

export interface VipCurrentLowestPriceData {
  activityId: string | null;
  name?: string | null;
  description?: string | null;
  startsAt: string | null;
  endsAt: string | null;
  annual: VipCurrentLowestPricePlan | null;
  lifetime: VipCurrentLowestPricePlan | null;
}

export interface RedeemInternalTestCodeDto {
  userId: string;
  code: string;
}

export interface RedeemInternalTestCodeResponse {
  ok: boolean;
  vipTier: VipTier;
  vipStartsAt: string;
  vipEndsAt: string;
}

export interface ParticipateInternalTestDto {
  vipStartsAt: string;
  vipEndsAt: string;
}

export interface ParticipateInternalTestResponse {
  ok: true;
  id: string;
  batchId: string;
  code: string;
  vipTier: VipTier;
  vipStartsAt: string;
  vipEndsAt: string;
  usedAt: string | null;
  usedByUserId: string | null;
  createdAt: string;
}

export interface DeletePlusMeResponse {
  ok: boolean;
  userId: string;
  deletedAt: string;
}

// --- API Functions ---

/**
 * AuthController_sendCode: Send login code to phone
 */
export const plusSendCode = async (data: SendCodeDto) => {
  return plusRequest.post<ISuccessResponse<any>>("/auth/send-code", data);
};

/**
 * AuthController_login: Login with phone and code
 */
export const plusLogin = async (data: LoginDto) => {
  return plusRequest.post<ISuccessResponse<{ token: string; userId: string }>>("/auth/login", data);
};

/**
 * UserController_getMe: Get current user profile
 */
export const plusGetMe = async (userId: string) => {
  return plusRequest.get<ISuccessResponse<any>>("/users/me", { params: { userId } });
};

/**
 * UserController_removeMe: Delete current plus user
 */
export const plusDeleteMe = async () => {
  return plusRequest.delete<ISuccessResponse<DeletePlusMeResponse>>("/users/me");
};

/**
 * PaymentController_create: Create a payment order
 */
export const plusCreatePayment = async (data: CreatePaymentDto) => {
  return plusRequest.post<ISuccessResponse<CreatePaymentResponse>>("/payment/create", data);
};

/**
 * PaymentController_wechatNotify: WeChat Pay notify callback
 */
export const plusWechatNotify = async (data: any) => {
  return plusRequest.post<ISuccessResponse<any>>("/payment/wechat/notify", data);
};

/**
 * PaymentController_alipayNotify: Alipay notify callback
 */
export const plusAlipayNotify = async (data: any) => {
  return plusRequest.post<ISuccessResponse<any>>("/payment/alipay/notify", data);
};

/**
 * PointsController_getBalance: Get points balance
 */
export const plusGetPointsBalance = async (userId: string) => {
  return plusRequest.get<ISuccessResponse<{ balance: number }>>("/points/balance", { params: { userId } });
};

/**
 * PointsController_consume: Consume points
 */
export const plusConsumePoints = async (data: ConsumePointsDto) => {
  return plusRequest.post<ISuccessResponse<any>>("/points/consume", data);
};

/**
 * TrackingController_create: Report a single tracking event
 */
export const plusTrackEvent = async (data: TrackingEventDto) => {
  return plusRequest.post<ISuccessResponse<any>>("/tracking/events", data);
};

/**
 * PaymentController_verifyAppleIap: Verify Apple IAP receipt
 */
export const plusVerifyAppleIap = async (data: AppleIapVerifyDto) => {
  return plusRequest.post<ISuccessResponse<any>>("/payment/apple/verify", data);
};

/**
 * VipController_currentLowestPrice: Get current lowest VIP price
 */
export const plusGetVipCurrentLowestPrice = async () => {
  return plusRequest.get<ISuccessResponse<VipCurrentLowestPriceData>>("/vip/current-lowest-price");
};

/**
 * VipController_status: Get VIP status
 */
export const plusGetVipStatus = async (userId: string) => {
  return plusRequest.get<ISuccessResponse<{ isVip: boolean; tier: VipTier; expiresAt: string | null }>>("/vip/status", { params: { userId } });
};

export const plusRedeemInternalTestCode = async (
  data: RedeemInternalTestCodeDto,
) => {
  return plusRequest.post<ISuccessResponse<RedeemInternalTestCodeResponse>>(
    "/users/internal-test-codes/redeem",
    data,
  );
};

export const plusParticipateInternalTest = async (
  data: ParticipateInternalTestDto,
) => {
  return plusRequest.post<ISuccessResponse<ParticipateInternalTestResponse>>(
    "/users/internal-test-codes/participate",
    data,
  );
};
