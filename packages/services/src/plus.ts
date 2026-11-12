import axios from "axios";
import { ISuccessResponse } from "./models";
import { io, type Socket } from "socket.io-client";

export const PLUS_API_BASE_URL = "https://www.audiodock.cn/api";
export const PLUS_WS_BASE_URL = "https://www.audiodock.cn/ws";

export const plusRequest = axios.create({
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
export type PaymentClientType = "app" | "web" | "desktop" | "mobile" | "mini" | "miniprogram";

export interface CreatePaymentDto {
  userId: string;
  couponCode?: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  clientType?: PaymentClientType;
  forVip: boolean;
  vipTier: VipTier;
  forPoints: boolean;
  pointsAmount: number;
  /** clientType=miniprogram 时必填：用户在微信小程序下的 openid */
  openId?: string;
}

export interface WechatPayPayload {
  appId: string;
  partnerId: string;
  prepayId: string;
  nonceStr: string;
  timeStamp: string;
  /** App 支付的签名字段 */
  sign: string;
  /** 小程序 JSAPI 支付的签名字段（与 sign 同值，字段名不同） */
  paySign?: string;
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

// 服务端 platform 是自由字符串（@IsString 无枚举校验）。
// mobile 端细分到操作系统：ios / android；历史数据里的 "mobile" 为未细分时期的存量值。
export type TrackingPlatform = "mobile" | "ios" | "android" | "desktop" | "web" | "mini";

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

export interface MyCouponItem {
  id: string;
  code: string;
  discountPercent: number;
  expiresAt: string;
  createdAt: string;
}

export interface MyCouponsResponse {
  data: MyCouponItem[];
  total: number;
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
 * AuthController_wechatMpSession: Exchange wx.login code for mini program openid
 */
export const plusWechatMpSession = async (code: string) => {
  return plusRequest.post<ISuccessResponse<{ openId: string }>>("/auth/wechat-mp/session", { code });
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

/**
 * CouponController_getMine: Get my active coupons
 */
export const plusGetMyCoupons = async () => {
  return plusRequest.get<ISuccessResponse<MyCouponsResponse>>("/coupons/mine");
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

// ============== 账号 / 家庭 / bind / rebind ==============
//
// 约定：
// - 公开接口（/auth/*）无需 token，plusRequest 默认不带 Authorization，调用方无需处理。
// - 其余接口依赖 setPlusToken 注入 Bearer Token，401 走拦截器自动清理 + 触发外部登出回调。
// - 类型对齐 web 端 account-api：Identifier.identifierMasked 已是脱敏展示字段，
//   客户端不要再做二次脱敏。

// --- Types ---

export type FamilyRole = "OWNER" | "MEMBER" | "NONE";

export interface Identifier {
  type: "PHONE" | "EMAIL" | "WECHAT";
  identifierMasked: string;
}

export interface FamilyMember {
  userId: string;
  role: "MEMBER";
  joinedAt: string;
  identifiers: Identifier[];
}

export interface FamilyState {
  role: FamilyRole;
  familyId?: string;
  maxMembers?: number;
  remainingSlots?: number;
  owner?: {
    userId: string;
    identifiers: Identifier[];
  };
  members?: FamilyMember[];
}

export interface InviteCode {
  code: string;
  expiresAt: string;
  createdAt: string;
}

export interface InviteListResponse {
  data: InviteCode[];
}

export interface FamilyOkResponse {
  ok: boolean;
}

export type BindType = "PHONE" | "EMAIL";

export interface SendEmailCodeDto {
  email: string;
}

export interface LoginWithEmailDto {
  email: string;
  code: string;
}

export interface BindSendCodeDto {
  type: BindType;
  identifier: string;
}

export interface BindConfirmDto {
  type: BindType;
  identifier: string;
  code: string;
}

export interface BindSendResult {
  type: BindType;
  identifier: string;
  /** 该 identifier 已绑定其他账号 → confirm 时会走合并分支 */
  mergeCandidate: boolean;
  expiresAt: number | null;
}

export type BindConfirmMode = "NEW_BINDING" | "MERGED";

export interface BindConfirmResult {
  ok: true;
  mode: BindConfirmMode;
  type: BindType;
  identifier: string;
  /** 合并分支附带：被合并的原 userId */
  mergedFromUserId?: string;
}

export interface RebindSendOldCodeDto {
  type: BindType;
}

export interface RebindVerifyOldCodeDto {
  type: BindType;
  code: string;
}

export interface RebindVerifyOldResult {
  ticket: string;
  expiresIn: number;
}

export interface RebindSendNewCodeDto {
  ticket: string;
  newIdentifier: string;
}

export interface RebindConfirmDto {
  ticket: string;
  code: string;
}

export interface RebindConfirmResult {
  ok: boolean;
  type: BindType;
  identifier: string;
}

// --- Email auth (公开) ---

/**
 * AuthController_sendEmailCode: Send login code to email
 */
export const plusSendEmailCode = async (data: SendEmailCodeDto) => {
  return plusRequest.post<ISuccessResponse<{ email: string; expiresAt: number }>>(
    "/auth/send-email-code",
    data,
  );
};

/**
 * AuthController_loginEmail: Login with email + code
 */
export const plusLoginWithEmail = async (data: LoginWithEmailDto) => {
  return plusRequest.post<ISuccessResponse<{ userId: string; token: string }>>(
    "/auth/login-email",
    data,
  );
};

// --- Family ---

/**
 * FamilyController_get: Get current family state
 */
export const plusGetFamily = async () => {
  return plusRequest.get<ISuccessResponse<FamilyState>>("/family");
};

/**
 * FamilyController_create: Create a family (current user becomes OWNER)
 */
export const plusCreateFamily = async () => {
  return plusRequest.post<ISuccessResponse<FamilyState>>("/family");
};

/**
 * FamilyController_dissolve: Dissolve the family (OWNER only)
 */
export const plusDissolveFamily = async () => {
  return plusRequest.delete<ISuccessResponse<FamilyOkResponse>>("/family");
};

/**
 * FamilyController_createInvite: Generate an invite code (OWNER only)
 */
export const plusCreateInvite = async () => {
  return plusRequest.post<ISuccessResponse<InviteCode>>("/family/invites");
};

/**
 * FamilyController_listInvites: List active invite codes (OWNER only)
 */
export const plusListInvites = async () => {
  return plusRequest.get<ISuccessResponse<InviteListResponse>>("/family/invites");
};

/**
 * FamilyController_join: Join a family via invite code
 */
export const plusJoinFamily = async (code: string) => {
  return plusRequest.post<ISuccessResponse<FamilyState>>("/family/join", { code });
};

/**
 * FamilyController_leave: Leave the family (MEMBER only)
 */
export const plusLeaveFamily = async () => {
  return plusRequest.post<ISuccessResponse<FamilyOkResponse>>("/family/leave");
};

/**
 * FamilyController_removeMember: Remove a member from family (OWNER only)
 */
export const plusRemoveMember = async (userId: string) => {
  return plusRequest.delete<ISuccessResponse<FamilyOkResponse>>(
    `/family/members/${encodeURIComponent(userId)}`,
  );
};

// --- Bind (添加新登录方式 / 账号合并) ---

/**
 * UserController_sendBindCode: Step 1 — 向新凭证发验证码。
 * 返回 mergeCandidate 供 UI 决定文案（命中时提示「即将合并」二次确认）。
 */
export const plusSendBindCode = async (data: BindSendCodeDto) => {
  return plusRequest.post<ISuccessResponse<BindSendResult>>(
    "/users/me/bind/send-code",
    data,
  );
};

/**
 * UserController_confirmBind: Step 2 — 校验验证码 + 执行新绑定或合并。
 * - mode=NEW_BINDING：单纯添加新登录方式
 * - mode=MERGED：合并另一个账号到当前账号（不可逆）
 */
export const plusConfirmBind = async (data: BindConfirmDto) => {
  return plusRequest.post<ISuccessResponse<BindConfirmResult>>(
    "/users/me/bind/confirm",
    data,
  );
};

// --- Rebind (更换已绑定手机/邮箱，4 步) ---

/**
 * UserController_sendRebindOldCode: Step 1 — 向当前已绑定的旧凭证发验证码。
 * 返回结构随 type 变化（email 或 phone），这里用宽松 Record 承接，调用方只需判断成功。
 */
export const plusSendRebindOldCode = async (data: RebindSendOldCodeDto) => {
  return plusRequest.post<ISuccessResponse<Record<string, unknown>>>(
    "/users/me/rebind/send-old-code",
    data,
  );
};

/**
 * UserController_verifyRebindOldCode: Step 2 — 校验旧凭证验证码，返回一次性 ticket（10 分钟有效）。
 */
export const plusVerifyRebindOldCode = async (data: RebindVerifyOldCodeDto) => {
  return plusRequest.post<ISuccessResponse<RebindVerifyOldResult>>(
    "/users/me/rebind/verify-old",
    data,
  );
};

/**
 * UserController_sendRebindNewCode: Step 3 — 向新凭证发验证码；后端会占用检查（已被他人绑定则 409）。
 */
export const plusSendRebindNewCode = async (data: RebindSendNewCodeDto) => {
  return plusRequest.post<ISuccessResponse<Record<string, unknown>>>(
    "/users/me/rebind/send-new-code",
    data,
  );
};

/**
 * UserController_confirmRebind: Step 4 — 校验新凭证验证码，事务完成换绑。
 */
export const plusConfirmRebind = async (data: RebindConfirmDto) => {
  return plusRequest.post<ISuccessResponse<RebindConfirmResult>>(
    "/users/me/rebind/confirm",
    data,
  );
};
