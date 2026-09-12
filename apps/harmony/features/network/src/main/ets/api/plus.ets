import http from '@ohos.net.http';
import { Logger } from 'audiodock_common';

const PLUS_BASE_URL = 'https://www.audiodock.cn/api';
const DEFAULT_TIMEOUT = 30_000;

interface PlusEnvelope<T> {
  code: number;
  message?: string;
  data: T;
}

export interface PlusLoginResponse {
  token: string;
  userId: string;
}

export interface PlusUserProfile {
  id: string;
  phone?: string;
  mobile?: string;
  vipTier: string;
  vipExpiresAt?: string | null;
}

export interface VipPlanPrice {
  currentPrice: number;
  originalPrice: number;
  discountPercent: number;
}

export interface VipCurrentLowestPriceData {
  /** 活动 ID，无活动时为 null */
  activityId?: string | null;
  name?: string;
  description?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  annual?: VipPlanPrice;
  lifetime?: VipPlanPrice;
}

export interface CouponItem {
  code: string;
  name?: string;
  discountAmount?: number;
  discountPercent?: number;
  expiresAt?: string;
}

export interface CreatePaymentResponse {
  orderId: string;
  paymentUrl?: string;
  wechatPay?: WechatPayPayload | null;
  alipayPay?: object | null;
}

/**
 * 与 mobile 端 apps/mobile/src/services/payments.ts 的 WechatPayPayload 字段对齐。
 * 后端 /payment/create 的 CreatePaymentDto.wechatPay 直接透传微信支付下单结果。
 */
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

export interface VipStatusResponse {
  isVip: boolean;
  tier: string;
  expiresAt: string | null;
}

/**
 * 注销会员账号返回结构（对齐 mobile packages/services/src/plus.ts 的 DeletePlusMeResponse）。
 * 后端 UserController_removeMe 返回 ISuccessResponse<{ok: true}>。
 * hm 端 plus.ets 的 plusRequest 会解 envelope 直接返回 data，所以这里只声明 data 字段。
 */
export interface DeleteMeResponse {
  ok: boolean;
}

export interface CouponsResponse {
  data: CouponItem[];
  total: number;
}

interface SendCodeRequest {
  phone: string;
}

interface LoginRequest {
  phone: string;
  code: string;
}

/** 对齐 mobile packages/services/src/plus.ts 的 SendEmailCodeDto */
interface SendEmailCodeRequest {
  email: string;
}

/** 对齐 mobile packages/services/src/plus.ts 的 LoginWithEmailDto */
interface LoginWithEmailRequest {
  email: string;
  code: string;
}

/** 对齐 mobile packages/services/src/plus.ts plusSendEmailCode 返回值 */
export interface PlusSendEmailCodeResult {
  email: string;
  expiresAt: number;
}

/**
 * 与 mobile packages/services/src/plus.ts 的 CreatePaymentDto 字段完全对齐。
 * 后端 PaymentController_create 的 class-validator 必填校验项是 amount/currency/method/forVip/vipTier/forPoints/pointsAmount，
 * 缺一即返回 400。harmony 之前发的是 {plan, price}，全部校验失败。
 */
interface CreatePaymentBody {
  userId: string;
  couponCode?: string;
  amount: number;
  currency: string;
  method: string;
  clientType: string;
  forVip: boolean;
  vipTier: string;
  forPoints: boolean;
  pointsAmount: number;
}

/** 与 mobile 的 VIP_PLAN_TIER 保持一致（apps/mobile/src/services/payments.ts）。 */
function createVipPlanTier(): Record<string, string> {
  const map: Record<string, string> = {};
  map['annual'] = 'BASIC';
  map['lifetime'] = 'LIFETIME';
  return map;
}
const VIP_PLAN_TIER: Record<string, string> = createVipPlanTier();

interface UserIdParams {
  userId: string;
}

let plusToken: string | null = null;

export function setPlusAuthToken(token: string | null): void {
  plusToken = token;
}

export function getPlusAuthToken(): string | null {
  return plusToken;
}

async function plusRequest<T>(method: string, path: string, data?: object, params?: object): Promise<T> {
  const httpReq = http.createHttp();
  let url = `${PLUS_BASE_URL}${path}`;
  if (params) {
    const parts: string[] = [];
    const keys = Object.keys(params);
    for (let i = 0; i < keys.length; i++) {
      const value = (params as Record<string, string>)[keys[i]];
      parts.push(`${encodeURIComponent(keys[i])}=${encodeURIComponent(value)}`);
    }
    if (parts.length > 0) url += `?${parts.join('&')}`;
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (plusToken) headers['Authorization'] = `Bearer ${plusToken}`;
  try {
    const resp = await httpReq.request(url, {
      method: method as http.RequestMethod,
      header: headers,
      readTimeout: DEFAULT_TIMEOUT,
      connectTimeout: DEFAULT_TIMEOUT,
      extraData: data ? JSON.stringify(data) : undefined,
    });
    let parsed: object = resp.result as object;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed as string); } catch { /* keep */ }
    }
    const env = parsed as PlusEnvelope<T>;
    if (env && typeof env === 'object' && env.code !== undefined) {
      if (env.code !== 200 && env.code !== 201) {
        throw new Error(env.message || `plus api error code=${env.code}`);
      }
      return env.data;
    }
    return parsed as T;
  } finally {
    httpReq.destroy();
  }
}

export interface PlusApi {
  sendCode(phone: string): Promise<void>;
  login(phone: string, code: string): Promise<PlusLoginResponse>;
  /** 对齐 mobile packages/services/src/plus.ts plusSendEmailCode：POST /auth/send-email-code */
  sendEmailCode(email: string): Promise<PlusSendEmailCodeResult>;
  /** 对齐 mobile packages/services/src/plus.ts plusLoginWithEmail：POST /auth/login-email */
  loginWithEmail(email: string, code: string): Promise<PlusLoginResponse>;
  getMe(userId: string): Promise<PlusUserProfile>;
  getVipCurrentLowestPrice(): Promise<VipCurrentLowestPriceData>;
  getMyCoupons(): Promise<CouponItem[]>;
  createPayment(userId: string, plan: string, method: string, price: number, couponCode?: string): Promise<CreatePaymentResponse>;
  getVipStatus(userId: string): Promise<VipStatusResponse>;
  deleteMe(): Promise<DeleteMeResponse>;
  /** 对齐 mobile packages/services/src/plus.ts plusParticipateInternalTest：POST /users/internal-test-codes/participate */
  participateInternalTest(vipStartsAt: string, vipEndsAt: string): Promise<ParticipateInternalTestResponse>;
}

/** 与 mobile ParticipateInternalTestResponse 对齐：ok + vipTier + vipStartsAt + vipEndsAt */
export interface ParticipateInternalTestResponse {
  ok: boolean;
  vipTier?: string;
  vipStartsAt?: string;
  vipEndsAt?: string;
}

/** participateInternalTest 请求体（对齐 mobile packages/services/src/plus.ts plusParticipateInternalTest）。 */
interface ParticipateInternalTestBody {
  vipStartsAt: string;
  vipEndsAt: string;
}

class PlusApiImpl implements PlusApi {
  async sendCode(phone: string): Promise<void> {
    const req: SendCodeRequest = { phone };
    await plusRequest<object>('POST', '/auth/send-code', req);
  }

  async login(phone: string, code: string): Promise<PlusLoginResponse> {
    const req: LoginRequest = { phone, code };
    return plusRequest<PlusLoginResponse>('POST', '/auth/login', req);
  }

  async sendEmailCode(email: string): Promise<PlusSendEmailCodeResult> {
    const req: SendEmailCodeRequest = { email };
    return plusRequest<PlusSendEmailCodeResult>('POST', '/auth/send-email-code', req);
  }

  async loginWithEmail(email: string, code: string): Promise<PlusLoginResponse> {
    const req: LoginWithEmailRequest = { email, code };
    return plusRequest<PlusLoginResponse>('POST', '/auth/login-email', req);
  }

  async getMe(userId: string): Promise<PlusUserProfile> {
    const params: UserIdParams = { userId };
    return plusRequest<PlusUserProfile>('GET', '/users/me', undefined, params);
  }

  async getVipCurrentLowestPrice(): Promise<VipCurrentLowestPriceData> {
    return plusRequest<VipCurrentLowestPriceData>('GET', '/vip/current-lowest-price');
  }

  async getMyCoupons(): Promise<CouponItem[]> {
    const res = await plusRequest<CouponsResponse>('GET', '/coupons/mine');
    return res?.data ?? [];
  }

  async createPayment(userId: string, plan: string, method: string, price: number, couponCode?: string): Promise<CreatePaymentResponse> {
    const body: CreatePaymentBody = {
      userId,
      amount: price,
      currency: 'CNY',
      method,
      clientType: 'app',
      forVip: true,
      vipTier: VIP_PLAN_TIER[plan] ?? plan.toUpperCase(),
      forPoints: false,
      pointsAmount: 0,
    };
    if (couponCode) body.couponCode = couponCode;
    return plusRequest<CreatePaymentResponse>('POST', '/payment/create', body);
  }

  async getVipStatus(userId: string): Promise<VipStatusResponse> {
    const params: UserIdParams = { userId };
    return plusRequest<VipStatusResponse>('GET', '/vip/status', undefined, params);
  }

  async deleteMe(): Promise<DeleteMeResponse> {
    // 对齐 mobile packages/services/src/plus.ts plusDeleteMe：DELETE /users/me
    return plusRequest<DeleteMeResponse>('DELETE', '/users/me');
  }

  async participateInternalTest(vipStartsAt: string, vipEndsAt: string): Promise<ParticipateInternalTestResponse> {
    // 对齐 mobile packages/services/src/plus.ts plusParticipateInternalTest
    const body: ParticipateInternalTestBody = { vipStartsAt, vipEndsAt };
    return plusRequest<ParticipateInternalTestResponse>('POST', '/users/internal-test-codes/participate', body);
  }
}

export const plusApi: PlusApi = new PlusApiImpl();
