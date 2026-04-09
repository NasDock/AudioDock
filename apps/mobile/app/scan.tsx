import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { Camera, CameraView } from "expo-camera";
import { useRouter } from "expo-router";
import { useTheme } from "../src/context/ThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { claimScanLoginSession } from "@soundx/services";
import { collectMobileScanLoginPayload } from "../src/utils/scanLogin";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

export default function ScanScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, setPermission] = useState<any>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);

  useEffect(() => {
    Camera.getCameraPermissionsAsync().then(setPermission);
  }, []);

  const requestPermission = async () => {
    const nextPermission = await Camera.requestCameraPermissionsAsync();
    setPermission(nextPermission);
  };

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (hasScanned) return;
    setHasScanned(true);

    try {
      setScanBusy(true);
      const parsed = JSON.parse(data);
      if (parsed?.kind !== "soundx-scan-login") {
        throw new Error("不是有效的扫码登录二维码");
      }

      const payload = await collectMobileScanLoginPayload();
      if (!payload.nativeAuth && !payload.plusAuth) {
        throw new Error("当前设备还没有可供迁移的登录态，请先在本机登录");
      }

      await claimScanLoginSession(parsed.sessionId, {
        secret: parsed.secret,
        payload,
      });

      router.replace(`/scan-confirm?sessionId=${parsed.sessionId}&secret=${parsed.secret}` as any);
    } catch (error: any) {
      console.error(error);
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>扫码登录</Text>
        <View style={{ width: 24 }} />
      </View>

      {!permission.granted ? (
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
      ) : (
        <View style={styles.content}>
          <Text style={[styles.desc, { color: colors.secondary }]}>
            请对准桌面端或横屏设备上的二维码
          </Text>
          <View style={styles.cameraBox}>
            <CameraView
              style={styles.camera}
              facing="back"
              onBarcodeScanned={handleBarcodeScanned}
            />
            {scanBusy && (
              <View style={styles.overlay}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.overlayText, { color: colors.text }]}>处理中...</Text>
              </View>
            )}
          </View>
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
  cameraBox: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 24,
    overflow: "hidden",
    maxWidth: 400,
    position: "relative",
  },
  camera: { flex: 1 },
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
  },
});
