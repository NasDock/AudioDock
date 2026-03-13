import { Alert, Linking, Platform } from "react-native";
import {
  plusCreatePayment,
  CreatePaymentDto,
} from "@soundx/services";
import * as WeChat from "react-native-wechat-lib";
import Alipay from "@0x5e/react-native-alipay";
import * as RNIap from "react-native-iap";

export type PaymentPlan = "annual" | "lifetime";
export type PaymentMethod = "WECHAT" | "ALIPAY";

export type WechatPayPayload = {
  appId: string;
  partnerId: string;
  prepayId: string;
  nonceStr: string;
  timeStamp: string;
  sign: string;
  package?: string;
  signType?: string;
};

export type AlipayPayPayload = {
  orderString: string;
  scheme?: string;
};

export type PlusPaymentPayload = {
  orderId: string;
  paymentUrl?: string;
  qrCode?: string;
  wechatPay?: WechatPayPayload;
  alipayPay?: AlipayPayPayload;
};

export const VIP_PLAN_PRICE: Record<PaymentPlan, number> = {
  annual: 20,
  lifetime: 60,
};

export const VIP_PLAN_TIER: Record<PaymentPlan, "BASIC" | "LIFETIME"> = {
  annual: "BASIC",
  lifetime: "LIFETIME",
};

export const IAP_PRODUCT_IDS: Record<PaymentPlan, string> = {
  annual: "soundx_vip_annual",
  lifetime: "soundx_vip_lifetime",
};

const normalizeUserId = (raw: string): string => {
  try {
    return String(JSON.parse(raw));
  } catch {
    return String(raw);
  }
};

export const createPlusPayment = async (
  userIdRaw: string,
  plan: PaymentPlan,
  method: PaymentMethod
) => {
  const payload: CreatePaymentDto = {
    userId: normalizeUserId(userIdRaw),
    amount: VIP_PLAN_PRICE[plan],
    currency: "CNY",
    method,
    forVip: true,
    vipTier: VIP_PLAN_TIER[plan],
    forPoints: false,
    pointsAmount: 0,
  };

  return plusCreatePayment(payload);
};

export const ensureWeChatRegistered = async (appId: string, universalLink?: string) => {
  if (!appId) {
    throw new Error("WeChat AppID 缺失");
  }
  await WeChat.registerApp(appId, universalLink);
};

export const payWithWeChat = async (
  payload: WechatPayPayload,
  fallbackUrl?: string
) => {
  try {
    await WeChat.pay({
      appId: payload.appId,
      partnerId: payload.partnerId,
      prepayId: payload.prepayId,
      nonceStr: payload.nonceStr,
      timeStamp: payload.timeStamp,
      package: payload.package ?? "Sign=WXPay",
      sign: payload.sign,
      signType: payload.signType ?? "MD5",
    });
    return;
  } catch (error) {
    if (fallbackUrl) {
      const supported = await Linking.canOpenURL(fallbackUrl);
      if (supported) {
        await Linking.openURL(fallbackUrl);
        return;
      }
    }
    throw error;
  }
};

export const payWithAlipay = async (
  payload: AlipayPayPayload,
  fallbackUrl?: string
) => {
  try {
    await Alipay.pay(payload.orderString, true);
    return;
  } catch (error) {
    if (fallbackUrl) {
      const supported = await Linking.canOpenURL(fallbackUrl);
      if (supported) {
        await Linking.openURL(fallbackUrl);
        return;
      }
    }
    throw error;
  }
};

export const initIapConnection = async (productIds: string[]) => {
  if (Platform.OS !== "ios") return [] as RNIap.Product[];
  await RNIap.initConnection();
  let products: RNIap.Product[] = [];
  try {
    products = await (RNIap.getProducts as any)({ skus: productIds });
  } catch {
    products = await (RNIap.getProducts as any)(productIds);
  }
  return products;
};

export const endIapConnection = async () => {
  if (Platform.OS !== "ios") return;
  await RNIap.endConnection();
};

export const requestIapPurchase = async (productId: string) => {
  if (Platform.OS !== "ios") return;
  try {
    await (RNIap.requestPurchase as any)({ sku: productId });
  } catch {
    await (RNIap.requestPurchase as any)(productId);
  }
};

export const registerIapListeners = (
  onPurchase: (purchase: RNIap.Purchase) => void,
  onError: (error: RNIap.PurchaseError) => void
) => {
  const purchaseSub = RNIap.purchaseUpdatedListener(onPurchase);
  const errorSub = RNIap.purchaseErrorListener(onError);

  return () => {
    purchaseSub.remove();
    errorSub.remove();
  };
};

export const finalizeIapPurchase = async (purchase: RNIap.Purchase) => {
  await RNIap.finishTransaction({ purchase, isConsumable: false });
};

export const assertIosIapPolicy = () => {
  if (Platform.OS === "ios") {
    Alert.alert("提示", "iOS 版本需使用 App Store 内购支付。微信/支付宝不可用。");
  }
};
