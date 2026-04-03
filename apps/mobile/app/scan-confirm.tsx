import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "../src/context/ThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { consumeScanLoginSession, getScanLoginSession, type ScanLoginSessionStatus } from "@soundx/services";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useAuth } from "../src/context/AuthContext";
import { applyMobileScanLoginResult } from "../src/utils/scanLogin";

export default function ScanConfirmScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { switchServer, setPlusToken } = useAuth();
  
  const sessionId = params.sessionId as string;
  const secret = params.secret as string;

  const [scanStatus, setScanStatus] = useState<ScanLoginSessionStatus | null>(null);
  const [selectedConfigIds, setSelectedConfigIds] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!sessionId || !secret) {
      Alert.alert("错误", "缺少会话参数", [{ text: "返回", onPress: () => router.back() }]);
      return;
    }

    const fetchSession = async () => {
      try {
        const res = await getScanLoginSession(sessionId, secret);
        setScanStatus(res.data);
        
        // Auto-select all available bundles by default
        const initialSelected: Record<string, string[]> = {};
        res.data.sourceBundles.forEach((bundle) => {
          initialSelected[bundle.type] = bundle.configs.map((c) => c.id);
        });
        setSelectedConfigIds(initialSelected);
      } catch (error: any) {
        Alert.alert("获取信息失败", error.message || "请返回重试", [{ text: "返回", onPress: () => router.back() }]);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [sessionId, secret]);

  const toggleConfigSelection = (type: string, configId: string) => {
    setSelectedConfigIds((prev) => {
      const current = new Set(prev[type] || []);
      if (current.has(configId)) current.delete(configId);
      else current.add(configId);
      return {
        ...prev,
        [type]: Array.from(current),
      };
    });
  };

  const handleConfirmScan = async () => {
    try {
      setConfirming(true);
      const selections = Object.entries(selectedConfigIds).map(([type, configIds]) => ({
        type,
        configIds,
      }));
      const res = await consumeScanLoginSession(sessionId, {
        secret,
        selections,
      });
      await applyMobileScanLoginResult(res.data, {
        switchServer,
        setPlusToken,
      });
      router.replace("/(tabs)" as any);
    } catch (error: any) {
      console.error(error);
      Alert.alert("错误", error.message || "确认扫码失败");
    } finally {
      setConfirming(false);
    }
  };

  if (loading || !scanStatus) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>确认同步内容</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.desc, { color: colors.secondary }]}>
          {scanStatus.deviceName ? `${scanStatus.deviceName} 已扫码。` : "移动设备已扫码。"}
          确认将下方选中的数据源导入当前设备，并完成自动登录。
        </Text>

        <View style={styles.list}>
          {scanStatus.sourceBundles.map((bundle) => (
            <View key={bundle.type} style={[styles.bundleCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.bundleTitle, { color: colors.text }]}>{bundle.type}</Text>
              {bundle.configs.map((config) => {
                const checked = (selectedConfigIds[bundle.type] || []).includes(config.id);
                return (
                  <TouchableOpacity
                    key={config.id}
                    style={styles.bundleItem}
                    onPress={() => toggleConfigSelection(bundle.type, config.id)}
                  >
                    <MaterialIcons
                      name={checked ? "check-circle" : "radio-button-unchecked"}
                      size={24}
                      color={checked ? colors.primary : colors.secondary}
                    />
                    <View style={styles.bundleItemInfo}>
                      <Text style={[styles.bundleItemTitle, { color: colors.text }]}>
                        {config.name || "未命名数据源"}
                      </Text>
                      <Text style={[styles.bundleItemMeta, { color: colors.secondary }]}>
                        {config.internal || "无内网地址"} / {config.external || "无外网地址"}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
          {scanStatus.sourceBundles.length === 0 && (
            <Text style={[styles.desc, { color: colors.secondary, marginTop: 24 }]}>
              扫码设备没有提供任何数据源。将仅同步用户自身状态。
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary, opacity: confirming ? 0.7 : 1 }]}
          onPress={handleConfirmScan}
          disabled={confirming}
        >
          {confirming ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={[styles.buttonText, { color: colors.background }]}>确认并登录</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: { padding: 4 },
  title: { fontSize: 18, fontWeight: "bold" },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  desc: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 24,
  },
  list: {
    gap: 16,
    marginBottom: 32,
  },
  bundleCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  bundleTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 12,
  },
  bundleItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  bundleItemInfo: {
    flex: 1,
    marginLeft: 12,
  },
  bundleItemTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  bundleItemMeta: {
    fontSize: 12,
    marginTop: 4,
  },
  button: {
    height: 54,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "bold",
  },
});
