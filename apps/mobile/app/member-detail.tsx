import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { plusGetMe, TrackingEvent as TE, TrackingFeature as TF } from "@soundx/services";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    ActivityIndicator,
    Alert,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    ToastAndroid,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../src/context/AuthContext";
import { useTheme } from "../src/context/ThemeContext";
import { syncWidgetMembership } from "../src/native/WidgetBridge";
import { trackEvent } from "../src/services/tracking";

export default function MemberDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { setPlusToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [vipData, setVipData] = useState<any>(null);

  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    trackEvent({ feature: TF.VIP, eventName: TE.VIP_PAGE_OPEN });
  }, []);

  const maskPhone = (value?: string | null) => {
    const normalized = String(value || "").replace(/\D/g, "");
    if (normalized.length < 7) return "";
    return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
  };

  useEffect(() => {
    fetchVipStatus();
  }, []);

  const fetchVipStatus = async () => {
    try {
      const plusUserId = await AsyncStorage.getItem("plus_user_id");
      if (plusUserId) {
        let id = plusUserId;
        try {
          id = JSON.parse(plusUserId);
        } catch (e) {}

        const res = await plusGetMe(id);
        if (res.data.code === 200 && res.data.data) {
          setVipData(res.data.data);
          await syncWidgetMembership(
            !!(res.data.data.vipTier && res.data.data.vipTier !== "NONE")
          );
        }
      }
    } catch (err) {
      console.error("Failed to fetch plus profile", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(t("memberDetailPage.logoutTitle"), t("memberDetailPage.logoutMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        style: "destructive",
        onPress: async () => {
          await setPlusToken(null);
          router.replace("/member-login");
        },
      },
    ]);
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

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isVip = vipData?.vipTier && vipData?.vipTier !== "NONE";
  const maskedPhone = maskPhone(vipData?.phone || vipData?.mobile);
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
  const tierName = vipData?.vipTier === "LIFETIME" ? t("memberDetailPage.lifetime") : t("memberDetailPage.annual");
  const expiryDate = vipData?.vipTier === "LIFETIME" ? t("memberDetailPage.lifetimeValid") : (vipData?.vipExpiresAt ? new Date(vipData.vipExpiresAt).toLocaleDateString() : t("memberDetailPage.unknown"));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t("memberDetailPage.title")}</Text>
        <View style={styles.headerRight}>
          {maskedPhone ? (
            <Text style={[styles.headerPhone, { color: colors.secondary }]}>
              {maskedPhone}
            </Text>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.vipInfo}>
            <MaterialCommunityIcons 
              name="crown" 
              size={64} 
              color={isVip ? "#FFD700" : colors.secondary} 
            />
            <Text style={[styles.vipStatus, { color: colors.text }]}>
                {isVip ? t("memberDetailPage.activated") : t("memberDetailPage.notActivated")}
            </Text>
          </View>

          {isVip && (
            <View style={styles.details}>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.secondary }]}>{t("memberDetailPage.tier")}</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>{tierName}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.secondary }]}>{t("memberDetailPage.expiry")}</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>{expiryDate}</Text>
              </View>
            </View>
          )}

          {!isVip && (
            <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: colors.primary }]}
                onPress={() => router.push("/member-benefits" as any)}
            >
                <Text style={styles.actionButtonText}>{t("memberDetailPage.benefits")}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.benefitsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.benefitsHeader}>
            <Text style={[styles.benefitsHeaderText, { flex: 2, color: colors.secondary }]}>{t("memberDetailPage.feature")}</Text>
            <Text style={[styles.benefitsHeaderText, { flex: 1, textAlign: "center", color: colors.secondary }]}>{t("memberDetailPage.nonMember")}</Text>
            <Text style={[styles.benefitsHeaderText, { flex: 1, textAlign: "center", color: colors.secondary }]}>{t("memberDetailPage.member")}</Text>
          </View>
          {comparisonData.map((item, index) => (
            <View
              key={item.feature}
              style={[
                styles.benefitsRow,
                { borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: colors.border },
              ]}
            >
              <Text style={[styles.benefitsFeatureText, { flex: 2, color: colors.text }]}>{item.feature}</Text>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Ionicons
                  name={item.free ? "checkmark-circle" : "close-circle"}
                  size={18}
                  color={item.free ? colors.primary : colors.secondary}
                  style={{ opacity: item.free ? 1 : 0.3 }}
                />
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Ionicons name="checkmark-circle" size={20} color="#FFD700" />
              </View>
            </View>
          ))}
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
            {t("memberDetailPage.contactSupport")}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.logoutButton, { backgroundColor: "#FF3B30", borderColor: "#FF3B30" }]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={20} color="#FFFFFF" />
          <Text style={[styles.logoutText, { color: "#FFFFFF" }]}>{t("memberDetailPage.logoutAction")}</Text>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 15,
    paddingBottom: 15,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  headerRight: {
    minWidth: 72,
    alignItems: "flex-end",
  },
  headerPhone: {
    fontSize: 12,
  },
  backButton: {
    padding: 5,
  },
  content: {
    padding: 20,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 10,
  },
  vipInfo: {
    alignItems: 'center',
    marginBottom: 24,
  },
  vipStatus: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 16,
  },
  details: {
    width: '100%',
    gap: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
    paddingTop: 24,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 15,
  },
  detailValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  actionButton: {
    width: '100%',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  actionButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  benefitsCard: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 10,
    overflow: "hidden",
    marginBottom: 10,
  },
  benefitsHeader: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  benefitsHeaderText: {
    fontSize: 12,
    fontWeight: "600",
  },
  benefitsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  benefitsFeatureText: {
    fontSize: 14,
    fontWeight: "500",
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
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
    marginTop: 24,
  },
  contactSupportText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
