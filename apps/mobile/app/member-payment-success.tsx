import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../src/context/ThemeContext";
import { useAuth } from "../src/context/AuthContext";
import { refreshVipStatus } from "../src/utils/vipStatus";

export default function MemberPaymentSuccessScreen() {
  const { colors } = useTheme();
  const { setPlusToken } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const tradeNo = String(params.tradeNo || "");
  const paidAtRaw = String(params.paidAt || "");
  const [refreshing, setRefreshing] = useState(true);

  const paidAt = useMemo(() => {
    if (!paidAtRaw) return "";
    try {
      return new Date(paidAtRaw).toLocaleString();
    } catch {
      return paidAtRaw;
    }
  }, [paidAtRaw]);

  useEffect(() => {
    const refreshStatus = async () => {
      try {
        await refreshVipStatus({
          setPlusToken,
          syncWidget: true,
        });
      } catch (error) {
        console.warn("Failed to refresh vip status", error);
      } finally {
        setRefreshing(false);
      }
    };

    refreshStatus();
  }, [setPlusToken]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>支付成功</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="checkmark-circle" size={64} color="#2ECC71" />
        <Text style={[styles.successText, { color: colors.text }]}>支付成功</Text>

        <View style={styles.infoBlock}>
          <Text style={[styles.infoLabel, { color: colors.secondary }]}>支付日期</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>{paidAt || "-"}</Text>
        </View>

        <View style={styles.infoBlock}>
          <Text style={[styles.infoLabel, { color: colors.secondary }]}>支付宝交易号</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>{tradeNo || "-"}</Text>
        </View>

        {refreshing && (
          <View style={styles.refreshRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.refreshText, { color: colors.secondary }]}>
              正在同步会员状态…
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          onPress={() => router.replace("/member-detail")}
        >
          <Text style={styles.primaryButtonText}>查看会员详情</Text>
        </TouchableOpacity>
      </View>
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
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  backButton: {
    padding: 6,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  card: {
    margin: 20,
    borderRadius: 18,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  successText: {
    fontSize: 20,
    fontWeight: "700",
  },
  infoBlock: {
    width: "100%",
    marginTop: 8,
  },
  infoLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: "600",
  },
  refreshRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  refreshText: {
    fontSize: 12,
  },
  primaryButton: {
    marginTop: 18,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
