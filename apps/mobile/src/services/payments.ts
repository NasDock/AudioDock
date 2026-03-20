import { Alert, Linking, Platform } from "react-native";
import { plusCreatePayment, CreatePaymentDto } from "@soundx/services";
import type * as WeChatTypes from "react-native-wechat-lib";
import type AlipayTypes from "@uiw/react-native-alipay";
import type * as RNIapTypes from "react-native-iap";

type WeChatModule = typeof WeChatTypes;
type AlipayModule = typeof AlipayTypes;
type RNIapModule = typeof RNIapTypes;

let cachedWeChatModule: WeChatModule | null | undefined;
let cachedAlipayModule: AlipayModule | null | undefined;
let cachedIapModule: RNIapModule | null | undefined;

const loadWeChatModule = (): WeChatModule | null => {
  if (cachedWeChatModule !== undefined) return cachedWeChatModule;
  try {
    console.log("[Pay][WeChat] require start");
    cachedWeChatModule = require("react-native-wechat-lib") as WeChatModule;
    console.log("[Pay][WeChat] require success", Object.keys(cachedWeChatModule || {}));
  } catch (error) {
    console.warn("Native module missing: react-native-wechat-lib", error);
    cachedWeChatModule = null;
  }
  return cachedWeChatModule;
};

const loadAlipayModule = (): AlipayModule | null => {
  if (cachedAlipayModule !== undefined) return cachedAlipayModule;
  try {
    console.log("[Pay][Alipay] require start");
    const raw = require("@uiw/react-native-alipay") as any;
    cachedAlipayModule = (raw?.default ?? raw) as AlipayModule;
    console.log("[Pay][Alipay] require success", Object.keys((cachedAlipayModule as any) || {}));
  } catch (error) {
    console.warn("Native module missing: @uiw/react-native-alipay", error);
    cachedAlipayModule = null;
  }
  return cachedAlipayModule;
};

const loadIapModule = (): RNIapModule | null => {
  if (cachedIapModule !== undefined) return cachedIapModule;
  try {
    console.log("[Pay][IAP] require start");
    cachedIapModule = require("react-native-iap") as RNIapModule;
    console.log("[Pay][IAP] require success", Object.keys(cachedIapModule || {}));
  } catch (error) {
    console.warn("Native module missing: react-native-iap", error);
    cachedIapModule = null;
  }
  return cachedIapModule;
};

const getWeChatModule = (): WeChatModule => {
  if (Platform.OS === "web") {
    throw new Error("Web 端不支持微信支付");
  }
  const mod = loadWeChatModule();
  console.log("[Pay][WeChat] module", {
    ok: !!mod,
    hasRegister: !!(mod as any)?.registerApp,
    hasPay: !!(mod as any)?.pay,
  });
  if (!mod || !mod.registerApp) {
    throw new Error("微信支付模块不可用（已禁用或未集成）");
  }
  return mod;
};

const getAlipayModule = (): AlipayModule => {
  if (Platform.OS === "web") {
    throw new Error("Web 端不支持支付宝支付");
  }
  const mod = loadAlipayModule();
  console.log("[Pay][Alipay] module", {
    ok: !!mod,
    hasAlipay: !!(mod as any)?.alipay,
    hasSetScheme: !!(mod as any)?.setAlipayScheme,
  });
  if (!mod || !(mod as any).alipay) {
    throw new Error("支付宝模块不可用（已禁用或未集成）");
  }
  return mod;
};

const getIapModule = (): RNIapModule => {
  if (Platform.OS === "web") {
    throw new Error("Web 端不支持 Apple 内购");
  }
  const mod = loadIapModule();
  console.log("[Pay][IAP] module", {
    ok: !!mod,
    hasInit: !!(mod as any)?.initConnection,
  });
  if (!mod) {
    throw new Error("IAP 模块不可用（已禁用或未集成）");
  }
  return mod;
};

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
  annual: 0.01,
  lifetime: 0.01,
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
  const WeChat = getWeChatModule();
  await WeChat.registerApp(appId, universalLink);
};

export const payWithWeChat = async (
  payload: WechatPayPayload,
  fallbackUrl?: string
) => {
  try {
    const WeChat = getWeChatModule();
    console.log("[Pay][WeChat] payload", payload);
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
    console.log("[Pay][WeChat] pay invoked");
    return;
  } catch (error) {
    console.warn("[Pay][WeChat] error", error);
    if (fallbackUrl) {
      const supported = await Linking.canOpenURL(fallbackUrl);
      console.log("[Pay][WeChat] fallback url", { fallbackUrl, supported });
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
    const Alipay = getAlipayModule();
    console.log("[Pay][Alipay] payload", {
      scheme: payload.scheme,
      orderStringPreview: payload.orderString ? `${payload.orderString.slice(0, 80)}...` : "",
      orderStringLength: payload.orderString?.length ?? 0,
      fallbackUrl,
    });
    if ((Alipay as any).setAlipayScheme && payload.scheme) {
      console.log("[Pay][Alipay] set scheme", payload.scheme);
      (Alipay as any).setAlipayScheme(payload.scheme);
    }
    console.log("[Pay][Alipay] call alipay()");
    const result = await (Alipay as any).alipay(payload.orderString);
    console.log("[Pay][Alipay] result", result);
    return result;
  } catch (error) {
    console.warn("[Pay][Alipay] error", error);
    if (fallbackUrl) {
      const supported = await Linking.canOpenURL(fallbackUrl);
      console.log("[Pay][Alipay] fallback url", { fallbackUrl, supported });
      if (supported) {
        await Linking.openURL(fallbackUrl);
        return null;
      }
    }
    throw error;
  }
};

export const initIapConnection = async (productIds: string[]) => {
  if (Platform.OS !== "ios") return [] as RNIapTypes.Product[];
  const RNIap = getIapModule();
  await RNIap.initConnection();
  let products: RNIapTypes.Product[] = [];
  try {
    products = await (RNIap.getProducts as any)({ skus: productIds });
  } catch {
    products = await (RNIap.getProducts as any)(productIds);
  }
  return products;
};

export const endIapConnection = async () => {
  if (Platform.OS !== "ios") return;
  const RNIap = getIapModule();
  await RNIap.endConnection();
};

export const requestIapPurchase = async (productId: string) => {
  if (Platform.OS !== "ios") return;
  const RNIap = getIapModule();
  try {
    await (RNIap.requestPurchase as any)({ sku: productId });
  } catch {
    await (RNIap.requestPurchase as any)(productId);
  }
};

export const registerIapListeners = (
  onPurchase: (purchase: RNIapTypes.Purchase) => void,
  onError: (error: RNIapTypes.PurchaseError) => void
) => {
  if (Platform.OS !== "ios") {
    return () => {};
  }

  try {
    const RNIap = getIapModule();
    const purchaseSub = RNIap.purchaseUpdatedListener(onPurchase);
    const errorSub = RNIap.purchaseErrorListener(onError);

    return () => {
      purchaseSub.remove();
      errorSub.remove();
    };
  } catch (error) {
    console.warn("IAP listeners unavailable", error);
    return () => {};
  }
};

export const finalizeIapPurchase = async (purchase: RNIapTypes.Purchase) => {
  const RNIap = getIapModule();
  await RNIap.finishTransaction({ purchase, isConsumable: false });
};

export const assertIosIapPolicy = () => {
  if (Platform.OS === "ios") {
    Alert.alert("提示", "iOS 版本需使用 App Store 内购支付。微信/支付宝不可用。");
  }
};
