import { AntDesign, Ionicons, MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  plusGetVipCurrentLowestPrice,
  type VipCurrentLowestPriceData,
  type VipCurrentLowestPricePlan,
} from "@soundx/services";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
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
  finalizeIapPurchase,
  IAP_PRODUCT_IDS,
  initIapConnection,
  payWithAlipay,
  registerIapListeners,
  requestIapPurchase,
  verifyAppleIapReceipt,
  type PaymentPlan,
} from "../src/services/payments";

const WECHAT_APP_ID = "wx1234567890abcdef";
const WECHAT_UNIVERSAL_LINK = "https://mock.example.com/";
const ALIPAY_SCHEME = "alipaymock";

export default function MemberBenefitsScreen() {
  const { colors } = useTheme();
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
    return `${format(start)} 至 ${format(end)}`;
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
        Alert.alert("提示", "Apple 内购初始化失败，请稍后重试");
      }
    };

    bootstrapIap();

    cleanup = registerIapListeners(
      async (purchase) => {
        try {
          const receipt = purchase.transactionReceipt;
          if (!receipt) {
            Alert.alert("支付失败", "未获取到支付凭证，请联系客服");
            return;
          }

          const memberUserId = await AsyncStorage.getItem("plus_user_id");
          if (!memberUserId) {
            Alert.alert("提示", "请先登录会员账号");
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
            Alert.alert("支付完成", "购买成功，会员权益已生效");
          } else {
            Alert.alert(
              "提示",
              verifyRes.data.message || "购买已完成，但校验失败",
            );
          }
        } catch (error) {
          console.warn("IAP finalize failed", error);
          Alert.alert("提示", "支付成功但确认失败，请联系客服");
        }
      },
      (error) => {
        console.warn("IAP purchase error", error);
        Alert.alert("支付失败", error?.message || "Apple 内购失败");
      },
    );

    return () => {
      cleanup?.();
      endIapConnection();
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
      Alert.alert("提示", "请先登录会员账号", [
        { text: "取消" },
        { text: "去登录", onPress: () => router.push("/member-login" as any) },
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
        } catch {}
      }
      if (typeof (result as any).result === "string") {
        const raw = (result as any).result as string;
        try {
          const parsed = JSON.parse(raw);
          const tradeNo =
            parsed?.alipay_trade_app_pay_response?.trade_no ||
            parsed?.alipay_trade_app_pay_response?.tradeNo;
          if (tradeNo) return String(tradeNo);
        } catch {}
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
      } catch {}
      await browserPromise.catch(() => null);
      router.replace({
        pathname: "/member-payment-success",
        params: {
          orderId,
          tradeNo: "",
          paidAt: new Date().toISOString(),
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
        },
      } as any);
      return;
    }

    Alert.alert(
      "提示",
      "支付窗口已关闭。如已完成支付，稍后可在会员详情查看是否生效。",
    );
  };

  const handlePayment = async (method: "WECHAT" | "ALIPAY") => {
    if (method === "WECHAT") {
      Alert.alert("提示", "微信支付正在上线中，请使用支付宝支付");
      return;
    }

    if (selectedPlanPrice == null) {
      Alert.alert("提示", "当前会员价格暂不可用，请稍后重试");
      return;
    }

    const userIdStr = await AsyncStorage.getItem("plus_user_id");
    if (!userIdStr) {
      Alert.alert("提示", "请先登录会员账号", [
        { text: "取消" },
        { text: "去登录", onPress: () => router.push("/member-login" as any) },
      ]);
      return;
    }

    setLoading(true);
    try {
      const res = await createPlusPayment(
        userIdStr,
        selectedPlan,
        method,
        selectedPlanPrice,
      );

      if (res.data.code === 201 || res.data.code === 200) {
        const { paymentUrl, wechatPay, alipayPay, orderId } =
          res.data.data || {};
        const resolvedOrderId = orderId ?? "";
        // if (method === "WECHAT") {
        //   if (wechatPay) {
        //     await ensureWeChatRegistered(WECHAT_APP_ID, WECHAT_UNIVERSAL_LINK);
        //     await payWithWeChat(wechatPay, paymentUrl);
        //   } else if (paymentUrl) {
        //     const supported = await Linking.canOpenURL(paymentUrl);
        //     if (supported) {
        //       await Linking.openURL(paymentUrl);
        //     } else {
        //       Alert.alert("提示", "订单创建成功，但无法自动打开支付链接，请尝试手动支付。");
        //     }
        //   } else {
        //     Alert.alert("支付失败", "后端未返回微信支付参数");
        //   }
        //   return;
        // }

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
                },
              } as any);
            }
          } else if (paymentUrl) {
            await openCashierAndWaitForPayment(paymentUrl, resolvedOrderId);
          } else {
            Alert.alert("支付失败", "后端未返回支付宝支付参数");
          }
          return;
        }
      } else {
        Alert.alert("支付失败", res.data.message || "请求失败，请稍后重试");
      }
    } catch (e: any) {
      Alert.alert(
        "错误",
        e.response?.data?.message || "网络请求失败，请检查网络设置",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleApplePurchase = async () => {
    assertIosIapPolicy();
    if (!iapReady) {
      Alert.alert("提示", "Apple 内购初始化中，请稍后重试");
      return;
    }

    const userIdStr = await getUserId();
    if (!userIdStr) return;

    try {
      setLoading(true);
      await requestIapPurchase(IAP_PRODUCT_IDS[selectedPlan]);
    } catch (error: any) {
      console.warn("IAP request failed", error);
      Alert.alert("支付失败", error?.message || "Apple 内购发起失败");
    } finally {
      setLoading(false);
    }
  };

  const showPricingDescription = () => {
    if (!pricing?.name && !pricing?.description) return;
    Alert.alert(
      pricing?.name || "活动说明",
      pricing?.description || "当前活动暂无更多说明",
    );
  };

  const comparisonData = [
    { feature: "基础功能", free: true, member: true },
    { feature: "设备接力", free: true, member: true },
    { feature: "同步控制", free: false, member: true },
    { feature: "TTS生成有声书", free: false, member: true },
    { feature: "桌面小部件", free: false, member: true },
    { feature: "TV版 (待上线)", free: false, member: true },
    { feature: "车机模式", free: false, member: true },
    { feature: "扫码登录", free: false, member: true },
    { feature: "语音助手", free: false, member: true },
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
          会员权益
        </Text>
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
              权益功能
            </Text>
            <Text
              style={[
                styles.tableHeaderText,
                { flex: 1, textAlign: "center", color: colors.secondary },
              ]}
            >
              非会员
            </Text>
            <Text
              style={[
                styles.tableHeaderText,
                { flex: 1, textAlign: "center", color: colors.secondary },
              ]}
            >
              会员
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
            会员方案
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
                {pricing.name} 活动正在进行中
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
            <Text style={[styles.planName, { color: colors.text }]}>年卡</Text>
            <View style={styles.priceContainer}>
              <Text style={[styles.currency, { color: colors.primary }]}>
                ¥
              </Text>
              <Text style={[styles.priceAmount, { color: colors.primary }]}>
                {formatPrice(pricing?.annual?.currentPrice)}
              </Text>
              <Text style={[styles.unit, { color: colors.secondary }]}>
                /年
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
                  原价{" "}
                  <Text style={styles.originalPriceValue}>
                    ¥{formatPrice(pricing?.annual?.originalPrice)}
                  </Text>
                </Text>
                <Text
                  style={[styles.savedPriceText, { color: colors.secondary }]}
                >
                  立省{" "}
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
              <Text style={styles.recommendText}>推荐</Text>
            </View>
            <Text style={[styles.planName, { color: colors.text }]}>
              永久卡
            </Text>
            <View style={styles.priceContainer}>
              <Text style={[styles.currency, { color: colors.primary }]}>
                ¥
              </Text>
              <Text style={[styles.priceAmount, { color: colors.primary }]}>
                {formatPrice(pricing?.lifetime?.currentPrice)}
              </Text>
              <Text style={[styles.unit, { color: colors.secondary }]}>
                /永久
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
                  原价{" "}
                  <Text style={styles.originalPriceValue}>
                    ¥{formatPrice(pricing?.lifetime?.originalPrice)}
                  </Text>
                </Text>
                <Text
                  style={[styles.savedPriceText, { color: colors.secondary }]}
                >
                  立省{" "}
                  {formatPrice(
                    (pricing?.lifetime?.originalPrice ?? 0) -
                      (pricing?.lifetime?.currentPrice ?? 0),
                  )}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {/* Payment Methods */}
        <View style={styles.dividerContainer}>
          <Text style={[styles.dividerText, { color: colors.secondary }]}>
            支付方式
          </Text>
        </View>
        <Text style={[styles.paymentHintText, { color: colors.secondary }]}>
          虚拟产品售出无法退款，请理性消费
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
                App Store 内购
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
                  微信
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
                  支付宝
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.logoutButton,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          onPress={() => {
            Alert.alert("退出会员账号", "确定要退出会员账号吗？", [
              { text: "取消", style: "cancel" },
              {
                text: "确定",
                style: "destructive",
                onPress: async () => {
                  await AsyncStorage.removeItem("plus_user_id");
                  router.replace("/member-login" as any);
                },
              },
            ]);
          }}
        >
          <Ionicons name="log-out-outline" size={20} color="#FF3B30" />
          <Text style={styles.logoutText}>退出会员账号</Text>
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
  footerText: {
    textAlign: "center",
    marginTop: 40,
    fontSize: 11,
    lineHeight: 18,
    paddingHorizontal: 20,
  },
});
