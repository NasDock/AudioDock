import { AntDesign, Ionicons, MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  plusGetMe,
  plusGetMyCoupons,
  plusGetVipCurrentLowestPrice,
  type MyCouponItem,
  type VipCurrentLowestPriceData,
  type VipCurrentLowestPricePlan,
  TrackingEvent as TE,
  TrackingFeature as TF,
} from "@soundx/services";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  ToastAndroid,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../src/context/AuthContext";
import { useTheme } from "../src/context/ThemeContext";
import { refreshVipStatus as refreshCachedVipStatus } from "../src/utils/vipStatus";
import {
  assertIosIapPolicy,
  createPlusPayment,
  endIapConnection,
  ensureWeChatRegistered,
  finalizeIapPurchase,
  IAP_PRODUCT_IDS,
  initIapConnection,
  payWithAlipay,
  payWithWeChat,
  registerIapListeners,
  requestIapPurchase,
  verifyAppleIapReceipt,
  type PaymentPlan,
} from "../src/services/payments";
import { trackEvent } from "../src/services/tracking";

const WECHAT_APP_ID = "wx1234567890abcdef";
const WECHAT_UNIVERSAL_LINK = "https://mock.example.com/";
const ALIPAY_SCHEME = "alipaymock";

export default function MemberBenefitsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { setPlusToken } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedPlan, setSelectedPlan] = useState<PaymentPlan>("lifetime");
  const [loading, setLoading] = useState(false);
  const [iapReady, setIapReady] = useState(false);
  const [pricing, setPricing] = useState<VipCurrentLowestPriceData | null>(
    null,
  );
  const [pricingLoading, setPricingLoading] = useState(true);
  const [memberPhone, setMemberPhone] = useState("");
  const [coupons, setCoupons] = useState<MyCouponItem[]>([]);
  const [selectedCouponCode, setSelectedCouponCode] = useState<string | null>(null);
  const [couponModalVisible, setCouponModalVisible] = useState(false);

  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    trackEvent({ feature: TF.VIP, eventName: TE.VIP_BENEFITS_OPEN });
  }, []);

  const maskPhone = (value?: string | null) => {
    const normalized = String(value || "").replace(/\D/g, "");
    if (normalized.length < 7) return "";
    return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
  };

  const formatPrice = (price: number | null | undefined) => {
    if (typeof price !== "number" || Number.isNaN(price)) return "--";
    return Number.isInteger(price) ? String(price) : price.toFixed(2);
  };

  const formatActivityDateRange = (
    startsAt: string | null | undefined,
    endsAt: string | null | undefined,
  ) => {
    if (!startsAt || !endsAt) return "";
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
    const pad = (value: number) => String(value).padStart(2, "0");
    const format = (value: Date) =>
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    return `${format(start)} ${t("memberBenefits.to")} ${format(end)}`;
  };

  const hasDiscount = (plan: VipCurrentLowestPricePlan | null | undefined) =>
    !!plan &&
    plan.discountPercent > 0 &&
    plan.originalPrice > plan.currentPrice;

  const selectedPlanPrice = pricing?.[selectedPlan]?.currentPrice ?? null;
  const activityDateRange = formatActivityDateRange(
    pricing?.startsAt,
    pricing?.endsAt,
  );

  const normalizeMemberUserId = (raw: string) => {
    try {
      return String(JSON.parse(raw));
    } catch {
      return String(raw);
    }
  };

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let cleanup: (() => void) | null = null;

    const bootstrapIap = async () => {
      try {
        await initIapConnection(Object.values(IAP_PRODUCT_IDS));
        setIapReady(true);
      } catch (error) {
        console.warn("IAP init failed", error);
        Alert.alert(t("memberBenefitsPage.notice"), t("memberBenefitsPage.appleInitFailed"));
      }
    };

    bootstrapIap();

    cleanup = registerIapListeners(
      async (purchase) => {
        try {
          const receipt = purchase.transactionReceipt;
          if (!receipt) {
            Alert.alert(t("memberBenefitsPage.paymentFailed"), t("memberBenefitsPage.missingReceipt"));
            return;
          }

          const memberUserId = await AsyncStorage.getItem("plus_user_id");
          if (!memberUserId) {
            Alert.alert(t("memberBenefitsPage.notice"), t("common.loginFirst"));
            return;
          }

          const verifyRes = await verifyAppleIapReceipt({
            userId: normalizeMemberUserId(memberUserId),
            productId: purchase.productId,
            receipt,
            transactionId: purchase.transactionId,
            originalTransactionId: (purchase as any)
              .originalTransactionIdentifierIOS,
            transactionDate: purchase.transactionDate?.toString(),
          });

          if (verifyRes.data.code === 200) {
            await finalizeIapPurchase(purchase);
            Alert.alert(t("memberBenefitsPage.paymentDone"), t("memberBenefitsPage.purchaseSuccess"));
          } else {
            Alert.alert(
              t("memberBenefitsPage.notice"),
              verifyRes.data.message || t("memberBenefitsPage.purchaseVerifiedFailed"),
            );
          }
        } catch (error) {
          console.warn("IAP finalize failed", error);
          Alert.alert(t("memberBenefitsPage.notice"), t("memberBenefitsPage.purchaseConfirmFailed"));
        }
      },
      (error) => {
        console.warn("IAP purchase error", error);
        Alert.alert(t("memberBenefitsPage.paymentFailed"), error?.message || t("memberBenefitsPage.applePurchaseFailed"));
      },
    );

    return () => {
      cleanup?.();
      endIapConnection();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadMemberPhone = async () => {
      try {
        const plusUserId = await AsyncStorage.getItem("plus_user_id");
        if (!plusUserId) return;
        let id: any = plusUserId;
        try {
          id = JSON.parse(plusUserId);
        } catch { }
        const res = await plusGetMe(id);
        const phone = res.data?.data?.phone || res.data?.data?.mobile || "";
        if (mounted) {
          setMemberPhone(maskPhone(phone));
        }
      } catch (error) {
        console.warn("Failed to fetch member phone", error);
      }
    };

    void loadMemberPhone();

    return () => {
      mounted = false;
    };
  }, []);


  useEffect(() => {
    let mounted = true;

    const loadCoupons = async () => {
      try {
        const res = await plusGetMyCoupons();
        if (!mounted) return;
        if (res.data.code === 200) {
          setCoupons((res.data.data?.data || []).filter((item) => !!item?.code));
        }
      } catch (error) {
        console.warn("Failed to fetch coupons", error);
      }
    };

    void loadCoupons();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadPricing = async () => {
      try {
        setPricingLoading(true);
        const res = await plusGetVipCurrentLowestPrice();
        if (!mounted) return;
        if (res.data.code === 200) {
          setPricing(res.data.data ?? null);
        } else {
          setPricing(null);
        }
      } catch (error) {
        console.warn("Failed to fetch VIP pricing", error);
        if (mounted) {
          setPricing(null);
        }
      } finally {
        if (mounted) {
          setPricingLoading(false);
        }
      }
    };

    void loadPricing();

    return () => {
      mounted = false;
    };
  }, []);

  const getUserId = async () => {
    const userIdStr = await AsyncStorage.getItem("plus_user_id");
    if (!userIdStr) {
      Alert.alert(t("memberBenefitsPage.notice"), t("common.loginFirst"), [
        { text: t("common.cancel") },
        { text: t("memberBenefitsPage.goLogin"), onPress: () => router.push("/member-login" as any) },
      ]);
      return null;
    }
    return userIdStr;
  };

  const isAlipaySuccess = (result: any) => {
    if (!result) return false;
    if (typeof result === "string") {
      return (
        result.includes("resultStatus=9000") ||
        result.includes("resultStatus={9000}")
      );
    }
    if (typeof result === "object") {
      const status =
        (result as any).resultStatus ??
        (result as any).result_status ??
        (result as any).status;
      return String(status) === "9000";
    }
    return false;
  };

  const extractAlipayTradeNo = (result: any): string => {
    const parseFromString = (value: string): string => {
      const match =
        value.match(/tradeNo=([^&}]+)/) || value.match(/trade_no=([^&}]+)/);
      return match?.[1] ? decodeURIComponent(match[1]) : "";
    };

    if (!result) return "";
    if (typeof result === "string") {
      return parseFromString(result);
    }
    if (typeof result === "object") {
      const direct =
        (result as any).tradeNo ||
        (result as any).trade_no ||
        (result as any).tradeNO ||
        "";
      if (direct) return String(direct);
      const extendInfo = (result as any).extendInfo;
      if (typeof extendInfo === "string") {
        try {
          const parsed = JSON.parse(extendInfo);
          if (parsed?.tradeNo) return String(parsed.tradeNo);
        } catch { }
      }
      if (typeof (result as any).result === "string") {
        const raw = (result as any).result as string;
        try {
          const parsed = JSON.parse(raw);
          const tradeNo =
            parsed?.alipay_trade_app_pay_response?.trade_no ||
            parsed?.alipay_trade_app_pay_response?.tradeNo;
          if (tradeNo) return String(tradeNo);
        } catch { }
        return parseFromString(raw);
      }
    }
    return "";
  };

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const refreshVipStatus = async (): Promise<boolean> => {
    try {
      const result = await refreshCachedVipStatus({
        setPlusToken,
        syncWidget: true,
      });
      const isVip = result.isVip;
      if (!isVip) {
        return false;
      }
      return true;
    } catch (error) {
      console.warn("Failed to refresh vip status", error);
      return false;
    }
  };

  const waitForVipActivation = async (shouldStop: () => boolean) => {
    const startedAt = Date.now();
    const timeoutMs = 5 * 60 * 1000;

    while (Date.now() - startedAt < timeoutMs) {
      if (shouldStop()) return false;
      const activated = await refreshVipStatus();
      if (activated) return true;
      await sleep(2000);
    }

    return false;
  };

  const openCashierAndWaitForPayment = async (
    paymentUrl: string,
    orderId: string,
  ) => {
    let browserClosed = false;
    const browserPromise = WebBrowser.openBrowserAsync(paymentUrl, {
      showTitle: true,
      controlsColor: colors.primary,
      presentationStyle:
        Platform.OS === "ios"
          ? WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET
          : undefined,
    }).then((result) => {
      browserClosed = true;
      return result;
    });

    const winner = await Promise.race([
      browserPromise.then((result) => ({ type: "browser" as const, result })),
      waitForVipActivation(() => browserClosed).then((paid) => ({
        type: "payment" as const,
        paid,
      })),
    ]);

    if (winner.type === "payment" && winner.paid) {
      try {
        await WebBrowser.dismissBrowser();
      } catch { }
      await browserPromise.catch(() => null);
      router.replace({
        pathname: "/member-payment-success",
        params: {
          orderId,
          tradeNo: "",
          paidAt: new Date().toISOString(),
          method: "ALIPAY",
        },
      } as any);
      return;
    }

    const paidAfterClose = await refreshVipStatus();
    if (paidAfterClose) {
      router.replace({
        pathname: "/member-payment-success",
        params: {
          orderId,
          tradeNo: "",
          paidAt: new Date().toISOString(),
          method: "ALIPAY",
        },
      } as any);
      return;
    }

    Alert.alert(
      t("memberBenefitsPage.notice"),
      t("memberBenefitsPage.paymentWindowClosed"),
    );
  };

  const handlePayment = async (method: "WECHAT" | "ALIPAY") => {
    if (selectedPlanPrice == null) {
      Alert.alert(t("memberBenefitsPage.notice"), t("memberBenefitsPage.priceUnavailable"));
      return;
    }

    const userIdStr = await AsyncStorage.getItem("plus_user_id");
    if (!userIdStr) {
      Alert.alert(t("memberBenefitsPage.notice"), t("common.loginFirst"), [
        { text: t("common.cancel") },
        { text: t("memberBenefitsPage.goLogin"), onPress: () => router.push("/member-login" as any) },
      ]);
      return;
    }

    trackEvent({
      feature: TF.VIP,
      eventName: TE.VIP_PAY_SUBMIT,
      metadata: { plan: selectedPlan, method },
    });
    setLoading(true);
    try {
      const res = await createPlusPayment(
        userIdStr,
        selectedPlan,
        method,
        selectedPlanPrice,
        selectedCouponCode || undefined,
      );

      if (res.data.code === 201 || res.data.code === 200) {
        const { paymentUrl, wechatPay, alipayPay, orderId } =
          res.data.data || {};
        const resolvedOrderId = orderId ?? "";
        if (method === "WECHAT") {
          if (wechatPay) {
            await ensureWeChatRegistered(wechatPay.appId, WECHAT_UNIVERSAL_LINK);
            const wechatResult = await payWithWeChat({
              appId: wechatPay.appId,
              partnerId: wechatPay.partnerId,
              prepayId: wechatPay.prepayId,
              nonceStr: wechatPay.nonceStr,
              timeStamp: wechatPay.timeStamp ?? (wechatPay as any).timestamp ?? "",
              sign: wechatPay.sign,
              package: wechatPay.package ?? "Sign=WXPay",
            }, paymentUrl);
            console.log("[Pay][WeChat] result", wechatResult);
            const wechatErrCode = typeof wechatResult === "object" ? wechatResult?.errCode : wechatResult;
            if (wechatErrCode === 0) {
              router.replace({
                pathname: "/member-payment-success",
                params: {
                  orderId: resolvedOrderId,
                  tradeNo: "",
                  paidAt: new Date().toISOString(),
                  method: "WECHAT",
                },
              } as any);
            }
          } else if (paymentUrl) {
            const supported = await Linking.canOpenURL(paymentUrl);
            if (supported) {
              await Linking.openURL(paymentUrl);
            } else {
              Alert.alert(t("memberBenefitsPage.notice"), t("memberBenefitsPage.paymentLinkFailed"));
            }
          } else {
            Alert.alert(t("memberBenefitsPage.paymentFailed"), t("memberBenefitsPage.wechatParamsMissing"));
          }
          return;
        }

        if (method === "ALIPAY") {
          if (alipayPay?.orderString) {
            const result = await payWithAlipay(
              { orderString: alipayPay.orderString, scheme: ALIPAY_SCHEME },
              paymentUrl,
            );
            if (isAlipaySuccess(result)) {
              const tradeNo = extractAlipayTradeNo(result);
              router.replace({
                pathname: "/member-payment-success",
                params: {
                  orderId: resolvedOrderId,
                  tradeNo,
                  paidAt: new Date().toISOString(),
                  method: "ALIPAY",
                },
              } as any);
            }
          } else if (paymentUrl) {
            await openCashierAndWaitForPayment(paymentUrl, resolvedOrderId);
          } else {
            Alert.alert(t("memberBenefitsPage.paymentFailed"), t("memberBenefitsPage.alipayParamsMissing"));
          }
          return;
        }
      } else {
        Alert.alert(t("memberBenefitsPage.paymentFailed"), res.data.message || t("memberBenefitsPage.requestFailedRetry"));
      }
    } catch (e: any) {
      Alert.alert(
        t("memberBenefitsPage.error"),
        e.response?.data?.message || t("memberBenefitsPage.networkFailed"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleApplePurchase = async () => {
    assertIosIapPolicy();
    if (!iapReady) {
      Alert.alert(t("memberBenefitsPage.notice"), t("memberBenefitsPage.appleInitPending"));
      return;
    }

    const userIdStr = await getUserId();
    if (!userIdStr) return;

    trackEvent({
      feature: TF.VIP,
      eventName: TE.VIP_PAY_SUBMIT,
      metadata: { plan: selectedPlan, method: "APPLE" },
    });
    try {
      setLoading(true);
      await requestIapPurchase(IAP_PRODUCT_IDS[selectedPlan]);
    } catch (error: any) {
      console.warn("IAP request failed", error);
      Alert.alert(t("memberBenefitsPage.paymentFailed"), error?.message || t("memberBenefitsPage.appleStartFailed"));
    } finally {
      setLoading(false);
    }
  };

  const showPricingDescription = () => {
    if (!pricing?.name && !pricing?.description) return;
    Alert.alert(
      pricing?.name || t("memberBenefitsPage.activityFallbackTitle"),
      pricing?.description || t("memberBenefitsPage.activityFallbackDescription"),
    );
  };

  const handleContactSupport = async () => {
    try {
      // 1. 复制邮箱到剪贴板
      await Clipboard.setStringAsync("audiodock@audiodock.cn");
      // 2. 提示已复制
      if (Platform.OS === "android") {
        ToastAndroid.show(t("common.copiedToClipboard"), ToastAndroid.SHORT);
      } else {
        Alert.alert(t("common.copiedToClipboard"));
      }
      // 3. 2s 后跳转邮件
      setTimeout(() => {
        Linking.openURL("mailto:audiodock@audiodock.cn").catch((e) =>
          console.warn("open mail failed", e),
        );
      }, 2000);
    } catch (error) {
      console.warn("Contact support failed", error);
    }
  };

  const comparisonData = [
    { feature: t("member.basicFeatures"), free: true, member: true },
    { feature: t("member.deviceRelay"), free: true, member: true },
    { feature: t("member.syncControl"), free: false, member: true },
    { feature: t("member.ttsAudiobook"), free: false, member: true },
    { feature: t("memberBenefits.desktopWidget"), free: false, member: true },
    { feature: t("memberBenefits.tvVersionComingSoon"), free: false, member: true },
    { feature: t("memberBenefits.carMode"), free: false, member: true },
    { feature: t("memberBenefits.scanLogin"), free: false, member: true },
    { feature: t("memberBenefits.voiceAssistant"), free: false, member: true },
  ];

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t("memberBenefitsPage.title")}
        </Text>
        <View style={styles.headerRight}>
          {memberPhone ? (
            <Text style={[styles.headerPhone, { color: colors.secondary }]}>
              {memberPhone}
            </Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Comparison Table */}
        <View
          style={[
            styles.tableCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.tableHeader}>
            <Text
              style={[
                styles.tableHeaderText,
                { flex: 2, color: colors.secondary },
              ]}
            >
              {t("memberBenefitsPage.feature")}
            </Text>
            <Text
              style={[
                styles.tableHeaderText,
                { flex: 1, textAlign: "center", color: colors.secondary },
              ]}
            >
              {t("memberBenefitsPage.nonMember")}
            </Text>
            <Text
              style={[
                styles.tableHeaderText,
                { flex: 1, textAlign: "center", color: colors.secondary },
              ]}
            >
              {t("memberBenefitsPage.member")}
            </Text>
          </View>
          {comparisonData.map((item, index) => (
            <View
              key={index}
              style={[
                styles.tableRow,
                {
                  borderTopWidth: index === 0 ? 0 : 0.5,
                  borderTopColor: colors.border,
                },
              ]}
            >
              <Text
                style={[styles.featureText, { flex: 2, color: colors.text }]}
              >
                {item.feature}
              </Text>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Ionicons
                  name={item.free ? "checkmark-circle" : "close-circle"}
                  size={20}
                  color={item.free ? colors.primary : colors.secondary}
                  style={{ opacity: item.free ? 1 : 0.3 }}
                />
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Ionicons name="checkmark-circle" size={22} color="#FFD700" />
              </View>
            </View>
          ))}
        </View>

        {/* Pricing Plans */}
        <View style={styles.dividerContainer}>
          <Text style={[styles.dividerText, { color: colors.secondary }]}>
            {t("memberBenefitsPage.planTitle")}
          </Text>
        </View>

        {pricing?.name ? (
          <View
            style={[
              styles.infoBanner,
              {
                backgroundColor: colors.card,
                borderColor: colors.primary + "33",
              },
            ]}
          >
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={colors.primary}
            />
            <View style={styles.infoBannerTextWrap}>
              <Text style={[styles.infoBannerTitle, { color: colors.text }]}>
                {t("memberBenefitsPage.ongoingActivity", { name: pricing.name })}
                {activityDateRange ? ` · ${activityDateRange}` : ""}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.plansContainer}>
          <TouchableOpacity
            style={[
              styles.planCard,
              {
                backgroundColor: colors.card,
                borderColor:
                  selectedPlan === "annual" ? colors.primary : colors.border,
              },
              selectedPlan === "annual" && { borderWidth: 2 },
            ]}
            onPress={() => setSelectedPlan("annual")}
          >
            <Text style={[styles.planName, { color: colors.text }]}>{t("memberBenefitsPage.yearCard")}</Text>
            <View style={styles.priceContainer}>
              <Text style={[styles.currency, { color: colors.primary }]}>
                ¥
              </Text>
              <Text style={[styles.priceAmount, { color: colors.primary }]}>
                {formatPrice(pricing?.annual?.currentPrice)}
              </Text>
              <Text style={[styles.unit, { color: colors.secondary }]}>
                {t("memberBenefitsPage.perYear")}
              </Text>
              {pricing?.name ? (
                <TouchableOpacity onPress={showPricingDescription} hitSlop={8}>
                  <Ionicons
                    name="help-circle-outline"
                    size={14}
                    color={colors.secondary}
                  />
                </TouchableOpacity>
              ) : null}
            </View>
            {hasDiscount(pricing?.annual) ? (
              <View style={styles.priceMeta}>
                <Text
                  style={[
                    styles.originalPriceText,
                    { color: colors.secondary },
                  ]}
                >
                  {t("memberBenefitsPage.originalPrice")}{" "}
                  <Text style={styles.originalPriceValue}>
                    ¥{formatPrice(pricing?.annual?.originalPrice)}
                  </Text>
                </Text>
                <Text
                  style={[styles.savedPriceText, { color: colors.secondary }]}
                >
                  {t("memberBenefitsPage.save")}{" "}
                  {formatPrice(
                    (pricing?.annual?.originalPrice ?? 0) -
                    (pricing?.annual?.currentPrice ?? 0),
                  )}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.planCard,
              {
                backgroundColor: colors.card,
                borderColor:
                  selectedPlan === "lifetime" ? "#FFD700" : colors.border,
              },
              selectedPlan === "lifetime" && { borderWidth: 2 },
            ]}
            onPress={() => setSelectedPlan("lifetime")}
          >
            <View
              style={[
                styles.recommendBadge,
                { opacity: selectedPlan === "lifetime" ? 1 : 0.6 },
              ]}
            >
              <Text style={styles.recommendText}>{t("memberBenefitsPage.recommended")}</Text>
            </View>
            <Text style={[styles.planName, { color: colors.text }]}>
              {t("memberBenefitsPage.lifetimeCard")}
            </Text>
            <View style={styles.priceContainer}>
              <Text style={[styles.currency, { color: colors.primary }]}>
                ¥
              </Text>
              <Text style={[styles.priceAmount, { color: colors.primary }]}>
                {formatPrice(pricing?.lifetime?.currentPrice)}
              </Text>
              <Text style={[styles.unit, { color: colors.secondary }]}>
                {t("memberBenefitsPage.perLifetime")}
              </Text>
              {pricing?.name ? (
                <TouchableOpacity onPress={showPricingDescription} hitSlop={8}>
                  <Ionicons
                    name="help-circle-outline"
                    size={14}
                    color={colors.secondary}
                  />
                </TouchableOpacity>
              ) : null}
            </View>
            {hasDiscount(pricing?.lifetime) ? (
              <View style={styles.priceMeta}>
                <Text
                  style={[
                    styles.originalPriceText,
                    { color: colors.secondary },
                  ]}
                >
                  {t("memberBenefitsPage.originalPrice")}{" "}
                  <Text style={styles.originalPriceValue}>
                    ¥{formatPrice(pricing?.lifetime?.originalPrice)}
                  </Text>
                </Text>
                <Text
                  style={[styles.savedPriceText, { color: colors.secondary }]}
                >
                  {t("memberBenefitsPage.save")}{" "}
                  {formatPrice(
                    (pricing?.lifetime?.originalPrice ?? 0) -
                    (pricing?.lifetime?.currentPrice ?? 0),
                  )}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        <View style={styles.dividerContainer}>
          <Text style={[styles.dividerText, { color: colors.text }]}>选择优惠券</Text>
        </View>
        <View>
          <TouchableOpacity
            style={[styles.couponPicker, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => setCouponModalVisible(true)}
          >
            <Text style={{ color: colors.text }}>
              {selectedCouponCode || "不使用优惠券"}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.text} />
          </TouchableOpacity>
          {(() => {
            const selectedCoupon = coupons.find((c) => c.code === selectedCouponCode);
            if (!selectedCoupon || selectedPlanPrice == null) return null;
            const finalPrice = selectedPlanPrice * (100 - selectedCoupon.discountPercent) / 100;
            return (
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: colors.secondary, fontSize: 13 }}>
                  优惠后价格：
                  <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 16 }}>
                    ¥{formatPrice(finalPrice)}
                  </Text>
                  <Text style={{ color: colors.secondary, fontSize: 12, textDecorationLine: "line-through", marginLeft: 16 }}>
                    ¥{formatPrice(selectedPlanPrice)}
                  </Text>
                </Text>
              </View>
            );
          })()}

          <Modal
            visible={couponModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setCouponModalVisible(false)}
          >
            <TouchableOpacity
              style={styles.modalOverlay}
              activeOpacity={1}
              onPress={() => setCouponModalVisible(false)}
            >
              <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>选择优惠券</Text>
                <ScrollView style={{ maxHeight: 360 }}>
                  <TouchableOpacity
                    style={[
                      styles.modalOption,
                      {
                        backgroundColor:
                          selectedCouponCode === null ? colors.primary + "18" : "transparent",
                        borderBottomWidth: 0.5,
                        borderBottomColor: colors.border,
                      },
                    ]}
                    onPress={() => {
                      setSelectedCouponCode(null);
                      setCouponModalVisible(false);
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: 15 }}>不使用优惠券</Text>
                    {selectedCouponCode === null && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                  {coupons.map((item) => {
                    const zhe = (100 - item.discountPercent) / 10;
                    const zheLabel = Number.isInteger(zhe) ? `${zhe}折` : `${zhe.toFixed(1)}折`;
                    const isSelected = selectedCouponCode === item.code;
                    return (
                      <TouchableOpacity
                        key={item.code}
                        style={[
                          styles.modalOption,
                          {
                            backgroundColor: isSelected ? colors.primary + "18" : "transparent",
                            borderBottomWidth: 0.5,
                            borderBottomColor: colors.border,
                          },
                        ]}
                        onPress={() => {
                          setSelectedCouponCode(item.code);
                          setCouponModalVisible(false);
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontSize: 15 }}>
                            {item.code} · {zheLabel}
                          </Text>
                        </View>
                        {isSelected && (
                          <Ionicons name="checkmark" size={20} color={colors.primary} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Modal>
        </View>

        {/* Payment Methods */}
        <View style={styles.dividerContainer}>
          <Text style={[styles.dividerText, { color: colors.secondary }]}>
            {t("memberBenefitsPage.paymentMethod")}
          </Text>
        </View>
        <Text style={[styles.paymentHintText, { color: colors.secondary }]}>
          {t("memberBenefitsPage.noRefund")}
        </Text>

        <View style={styles.paymentMethods}>
          {Platform.OS === "ios" ? (
            <TouchableOpacity
              style={[
                styles.paymentItem,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  opacity: loading ? 0.6 : 1,
                },
              ]}
              onPress={handleApplePurchase}
              disabled={loading || selectedPlanPrice == null}
            >
              <Ionicons name="logo-apple" size={22} color={colors.text} />
              <Text style={[styles.paymentText, { color: colors.text }]}>
                {t("memberBenefitsPage.appStoreIap")}
              </Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={[
                  styles.paymentItem,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    opacity: loading ? 0.6 : 1,
                  },
                ]}
                onPress={() => handlePayment("WECHAT")}
                disabled={loading || selectedPlanPrice == null}
              >
                <AntDesign name="wechat" size={24} color={"#1AAD19"} />
                <Text style={[styles.paymentText, { color: colors.text }]}>
                  {t("memberBenefitsPage.wechat")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.paymentItem,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    opacity: loading ? 0.6 : 1,
                  },
                ]}
                onPress={() => handlePayment("ALIPAY")}
                disabled={loading || selectedPlanPrice == null}
              >
                <AntDesign name="alipay-circle" size={24} color={"#02A9F1"} />
                <Text style={[styles.paymentText, { color: colors.text }]}>
                  {t("memberBenefitsPage.alipay")}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.contactSupportButton,
            { borderColor: colors.primary },
          ]}
          onPress={handleContactSupport}
        >
          <Ionicons name="mail-outline" size={20} color={colors.primary} />
          <Text style={[styles.contactSupportText, { color: colors.primary }]}>
            {t("memberBenefitsPage.contactSupport")}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.logoutButton,
            { backgroundColor: "#FF3B30", borderColor: "#FF3B30" },
          ]}
          onPress={() => {
            Alert.alert(t("memberBenefitsPage.logoutTitle"), t("memberBenefitsPage.logoutMessage"), [
              { text: t("common.cancel"), style: "cancel" },
              {
                text: t("common.confirm"),
                style: "destructive",
                onPress: async () => {
                  await AsyncStorage.removeItem("plus_user_id");
                  router.replace("/member-login" as any);
                },
              },
            ]);
          }}
        >
          <Ionicons name="log-out-outline" size={20} color="#FFFFFF" />
          <Text style={[styles.logoutText, { color: "#FFFFFF" }]}>{t("memberBenefitsPage.logoutAction")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  backButton: {
    padding: 8,
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  headerRight: {
    marginLeft: "auto",
    minWidth: 72,
    alignItems: "flex-end",
  },
  headerPhone: {
    fontSize: 12,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  tableCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 10,
    overflow: "hidden",
  },
  tableHeader: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  tableHeaderText: {
    fontSize: 12,
    fontWeight: "600",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  featureText: {
    fontSize: 14,
    fontWeight: "500",
  },
  sectionTitleContainer: {
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  plansContainer: {
    flexDirection: "row",
    gap: 15,
  },
  planCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  infoBanner: {
    marginTop: -8,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  infoBannerTextWrap: {
    flex: 1,
  },
  infoBannerTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  planName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  priceContainer: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  currency: {
    fontSize: 14,
    fontWeight: "bold",
  },
  priceAmount: {
    fontSize: 28,
    fontWeight: "bold",
    marginHorizontal: 2,
  },
  unit: {
    fontSize: 12,
  },
  originalPriceText: {
    fontSize: 11,
  },
  originalPriceValue: {
    textDecorationLine: "line-through",
  },
  priceMeta: {
    marginTop: 8,
    alignItems: "center",
    gap: 2,
  },
  savedPriceText: {
    fontSize: 11,
  },
  recommendBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: "#FFD700",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 10,
    zIndex: 1,
  },
  recommendText: {
    color: "#000",
    fontSize: 10,
    fontWeight: "bold",
  },
  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 0,
    fontSize: 12,
  },
  paymentMethods: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 15,
  },
  paymentHintText: {
    fontSize: 12,
    marginTop: -8,
    marginBottom: 12,
  },
  paymentItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    flex: 1,
    justifyContent: "center",
  },
  paymentText: {
    fontSize: 14,
    fontWeight: "600",
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 30,
  },
  logoutText: {
    color: "#FF3B30",
    fontSize: 16,
    fontWeight: "600",
  },
  contactSupportButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: "transparent",
    marginTop: 30,
  },
  contactSupportText: {
    fontSize: 16,
    fontWeight: "600",
  },
  footerText: {
    textAlign: "center",
    marginTop: 40,
    fontSize: 11,
    lineHeight: 18,
    paddingHorizontal: 20,
  },
  couponPicker: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  modalContent: {
    width: "100%",
    borderRadius: 16,
    paddingTop: 20,
    paddingBottom: 12,
    overflow: "hidden",
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
});

