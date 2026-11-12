import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { Camera, CameraView } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "../src/context/ThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { claimScanLoginSession } from "@soundx/services";
import { collectMobileScanLoginPayload } from "../src/utils/scanLogin";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { StatusBar } from "expo-status-bar";
import { trackEvent } from "../src/services/tracking";

export default function ScanScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  // 从具体数据源登录页进入时只同步该数据源；个人中心进入不同步该参数 → 全量
  const onlyType = (params.sourceType as string) || undefined;
  const [permission, setPermission] = useState<any>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);

  useEffect(() => {
    Camera.getCameraPermissionsAsync().then(setPermission);
  }, []);

  const requestPermission = async () => {
    trackEvent({
      feature: "scan_login",
      eventName: "scan_login_permission_request",
    });
    const nextPermission = await Camera.requestCameraPermissionsAsync();
    setPermission(nextPermission);
  };

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (hasScanned) return;
    setHasScanned(true);
    console.log("[scan-login] qr detected", data);
    trackEvent({
      feature: "scan_login",
      eventName: "scan_login_qr_detected",
    });

    try {
      setScanBusy(true);
      const parsed = JSON.parse(data);
      if (parsed?.kind !== "soundx-scan-login") {
        throw new Error("不是有效的扫码登录二维码");
      }

      const payload = await collectMobileScanLoginPayload(onlyType);
      const hasBundles = payload.sourceBundles.some((bundle) => bundle.configs.length > 0);
      if (!payload.nativeAuth && !payload.plusAuth && !hasBundles) {
        throw new Error("当前设备还没有可供迁移的登录态，请先在本机登录");
      }

      await claimScanLoginSession(parsed.sessionId, {
        secret: parsed.secret,
        payload,
      });
      trackEvent({
        feature: "scan_login",
        eventName: "scan_login_qr_scanned",
      });

      router.replace(`/scan-confirm?sessionId=${parsed.sessionId}&secret=${parsed.secret}` as any);
    } catch (error: any) {
      console.error(error);
      trackEvent({
        feature: "scan_login",
        eventName: "scan_login_scan_failed",
        metadata: {
          message: error?.message || "unknown_error",
        },
      });
      Alert.alert("扫码失败", error.message || "请重试");
      setHasScanned(false);
    } finally {
      setScanBusy(false);
    }
  };

  if (!permission) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>扫码登录</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.content}>
          <Text style={[styles.desc, { color: colors.secondary }]}>
            需要开启相机权限，用于扫码快捷登录，无需手动填写多个服务器地址信息。
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={requestPermission}
          >
            <Text style={[styles.buttonText, { color: colors.background }]}>去扫码</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 已授权：相机全屏预览（对齐 hm ScanKit 全屏扫码），头部/提示悬浮在预览之上
  return (
    <View style={styles.container}>
      {/* 相机预览为深色背景，状态栏强制浅色图标（同 player.tsx 全屏页） */}
      <StatusBar style="light" />
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={handleBarcodeScanned}
      />

      {/* 顶部渐变遮罩 + 头部栏 */}
      <View style={[styles.headerOverlay, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.titleOverlay}>扫码登录</Text>
          <View style={{ width: 24 }} />
        </View>
      </View>

      {/* 扫描框引导 */}
      <View style={styles.frameContainer} pointerEvents="none">
        <View style={styles.scanFrame}>
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
        </View>
        <Text style={styles.hintOverlay}>请对准桌面端或横屏设备上的二维码</Text>
      </View>

      {scanBusy && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.overlayText}>处理中...</Text>
        </View>
      )}
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
    flex: 1,
    padding: 24,
    alignItems: "center",
  },
  desc: {
    fontSize: 14,
    marginBottom: 24,
    textAlign: "center",
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "bold",
  },
  // ── 全屏预览悬浮层 ──
  headerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  titleOverlay: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#FFFFFF",
  },
  frameContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  scanFrame: {
    width: 240,
    height: 240,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: 28,
    height: 28,
    borderColor: "#FFFFFF",
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 8,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 8,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 8,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 8,
  },
  hintOverlay: {
    marginTop: 24,
    fontSize: 14,
    color: "#FFFFFF",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  overlayText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: "bold",
    color: "#FFFFFF",
  },
});
