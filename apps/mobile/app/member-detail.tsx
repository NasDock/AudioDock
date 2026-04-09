import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { plusGetMe } from "@soundx/services";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../src/context/AuthContext";
import { useTheme } from "../src/context/ThemeContext";
import { syncWidgetMembership } from "../src/native/WidgetBridge";

export default function MemberDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { setPlusToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [vipData, setVipData] = useState<any>(null);

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
    Alert.alert("退出/切换会员账号", "确定要退出/切换会员账号吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "确定",
        style: "destructive",
        onPress: async () => {
          await setPlusToken(null);
          router.replace("/member-login");
        },
      },
    ]);
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
  const tierName = vipData?.vipTier === "LIFETIME" ? "永久会员" : "年度会员";
  const expiryDate = vipData?.vipTier === "LIFETIME" ? "永久有效" : (vipData?.vipExpiresAt ? new Date(vipData.vipExpiresAt).toLocaleDateString() : "未知");

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>会员详情</Text>
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
                {isVip ? "您的会员状态：已激活" : "您的会员状态：未激活"}
            </Text>
          </View>

          {isVip && (
            <View style={styles.details}>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.secondary }]}>会员等级</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>{tierName}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.secondary }]}>到期时间</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>{expiryDate}</Text>
              </View>
            </View>
          )}

          {!isVip && (
            <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: colors.primary }]}
                onPress={() => router.push("/member-benefits" as any)}
            >
                <Text style={styles.actionButtonText}>了解会员权益</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.benefitsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.benefitsHeader}>
            <Text style={[styles.benefitsHeaderText, { flex: 2, color: colors.secondary }]}>权益功能</Text>
            <Text style={[styles.benefitsHeaderText, { flex: 1, textAlign: "center", color: colors.secondary }]}>非会员</Text>
            <Text style={[styles.benefitsHeaderText, { flex: 1, textAlign: "center", color: colors.secondary }]}>会员</Text>
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
          style={[styles.logoutButton, { backgroundColor: "#FF3B30", borderColor: "#FF3B30" }]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={20} color="#FFFFFF" />
          <Text style={[styles.logoutText, { color: "#FFFFFF" }]}>退出/切换会员账号</Text>
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
  },
  logoutText: {
    color: "#FF3B30",
    fontSize: 16,
    fontWeight: "600",
  },
});
