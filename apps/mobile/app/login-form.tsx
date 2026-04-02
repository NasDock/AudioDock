import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  claimScanLoginSession,
  consumeScanLoginSession,
  createScanLoginSession,
  getScanLoginSession,
  type ScanLoginSession,
  type ScanLoginSessionStatus,
  subscribeScanLoginSession,
  SOURCEMAP,
  SOURCETIPSMAP,
} from "@soundx/services";
import { Camera, CameraView } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../src/context/AuthContext";
import { useTheme } from "../src/context/ThemeContext";
import { selectBestServer } from "../src/utils/networkUtils";
import {
  applyMobileScanLoginResult,
  collectMobileScanLoginPayload,
} from "../src/utils/scanLogin";

const logo = require("../assets/images/logo.png");
const subsonicLogo = require("../assets/images/subsonic.png");
const embyLogo = require("../assets/images/emby.png");

type PanelMode = "scan" | "manual";

export default function LoginFormScreen() {
  const { colors } = useTheme();
  const {
    login,
    register,
    switchServer,
    setPlusToken,
  } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const sourceType = (params.type as string) || "AudioDock";

  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>(isLandscape ? "manual" : "scan");
  const [scanSession, setScanSession] = useState<ScanLoginSession | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanLoginSessionStatus | null>(null);
  const [selectedConfigIds, setSelectedConfigIds] = useState<Record<string, string[]>>({});
  const [externalAddress, setExternalAddress] = useState("");
  const [internalAddress, setInternalAddress] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [permission, setPermission] = useState<any>(null);
  const [hasScanned, setHasScanned] = useState(false);

  const requestPermission = async () => {
    const nextPermission = await Camera.requestCameraPermissionsAsync();
    setPermission(nextPermission);
    return nextPermission;
  };

  useEffect(() => {
    setPanelMode(isLandscape ? "manual" : "scan");
  }, [isLandscape]);

  useEffect(() => {
    Camera.getCameraPermissionsAsync()
      .then(setPermission)
      .catch((error) => console.error("Failed to load camera permission:", error));
  }, []);

  useEffect(() => {
    loadSourceConfig(sourceType);
  }, [sourceType]);

  useEffect(() => {
    if (!isLandscape) {
      setScanSession(null);
      setScanStatus(null);
      return;
    }

    createTargetSession();
  }, [isLandscape]);

  useEffect(() => {
    if (!scanSession || !isLandscape) return;

    refreshScanStatus(scanSession).catch((error) => console.error(error));
    const unsubscribe = subscribeScanLoginSession(
      scanSession.sessionId,
      scanSession.secret,
      (status) => setScanStatus(status),
    );

    return () => unsubscribe();
  }, [scanSession, isLandscape]);

  useEffect(() => {
    if (scanStatus?.status !== "waiting_confirm") return;

    const nextSelected: Record<string, string[]> = {};
    scanStatus.sourceBundles.forEach((bundle) => {
      nextSelected[bundle.type] = bundle.configs.map((config) => config.id);
    });
    setSelectedConfigIds(nextSelected);
  }, [scanStatus?.sessionId, scanStatus?.status]);

  useEffect(() => {
    if (!scanSession || scanStatus?.status !== "confirmed") return;

    const consumeConfirmedScan = async () => {
      try {
        setScanBusy(true);
        const res = await consumeScanLoginSession(scanSession.sessionId, {
          secret: scanSession.secret,
        });
        await applyMobileScanLoginResult(res.data, {
          switchServer,
          setPlusToken,
        });
        router.replace("/(tabs)" as any);
      } catch (error: any) {
        console.error(error);
        Alert.alert("错误", error.message || "确认扫码登录失败");
      } finally {
        setScanBusy(false);
      }
    };

    consumeConfirmedScan();
  }, [scanSession?.sessionId, scanStatus?.status]);

  const qrValue = useMemo(() => {
    if (!scanSession) return "";
    return JSON.stringify({
      kind: "soundx-scan-login",
      version: 1,
      sessionId: scanSession.sessionId,
      secret: scanSession.secret,
      role: "target",
      deviceKind: "mobile",
    });
  }, [scanSession]);

  const loadSourceConfig = async (type: string) => {
    try {
      const configKey = `sourceConfig_${type}`;
      const savedConfig = await AsyncStorage.getItem(configKey);

      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const lastConfig = parsed[parsed.length - 1];
          setInternalAddress(lastConfig.internal || "");
          setExternalAddress(lastConfig.external || "");

          if (lastConfig.external) await restoreCredentials(lastConfig.external, type);
          else if (lastConfig.internal) await restoreCredentials(lastConfig.internal, type);
        } else if (!Array.isArray(parsed)) {
          const { internal, external } = parsed;
          setInternalAddress(internal || "");
          setExternalAddress(external || "");
          if (external) await restoreCredentials(external, type);
          else if (internal) await restoreCredentials(internal, type);
        }
      } else {
        setInternalAddress(type === "AudioDock" ? "http://localhost:3000" : "");
        setExternalAddress("");
        setUsername("");
        setPassword("");
      }
    } catch (error) {
      console.error("Failed to load source config:", error);
    }
  };

  const restoreCredentials = async (address: string, type: string) => {
    try {
      const credsKey = `creds_${type}_${address}`;
      const savedCreds = await AsyncStorage.getItem(credsKey);
      if (savedCreds) {
        const { username: u, password: p } = JSON.parse(savedCreds);
        if (u) setUsername(u);
        if (p) setPassword(p);
      }
    } catch (e) {
      console.error("Failed to restore credentials", e);
    }
  };

  const refreshScanStatus = async (session: ScanLoginSession) => {
    const res = await getScanLoginSession(session.sessionId, session.secret);
    setScanStatus(res.data);
    return res.data;
  };

  const createTargetSession = async () => {
    try {
      const res = await createScanLoginSession({
        role: "target",
        deviceKind: "mobile",
      });
      setScanSession(res.data);
      setScanStatus({
        sessionId: res.data.sessionId,
        role: res.data.role,
        deviceKind: res.data.deviceKind,
        expiresAt: res.data.expiresAt,
        status: "waiting_scan",
        sourceBundles: [],
        hasNativeAuth: false,
        hasPlusAuth: false,
      });
    } catch (error) {
      console.error(error);
      Alert.alert("错误", "创建扫码会话失败");
    }
  };

  const handleSubmit = async () => {
    if (!externalAddress && !internalAddress) {
      Alert.alert("错误", "请至少输入一个数据源地址（内网或外网）");
      return;
    }
    if (!username || !password) {
      Alert.alert("错误", "请填写用户名和密码");
      return;
    }
    if (!isLogin && password !== confirmPassword) {
      Alert.alert("错误", "两次输入的密码不一致");
      return;
    }

    try {
      setLoading(true);
      const bestAddress = await selectBestServer(internalAddress, externalAddress, sourceType);

      if (!bestAddress) {
        Alert.alert("连接失败", "无法连接到任一服务器地址，请检查网络或地址输入");
        setLoading(false);
        return;
      }

      const configKey = `sourceConfig_${sourceType}`;
      const existingStr = await AsyncStorage.getItem(configKey);
      let existingConfigs: Array<{ id: string; internal: string; external: string; name: string }> = [];

      try {
        if (existingStr) {
          const parsed = JSON.parse(existingStr);
          if (Array.isArray(parsed)) existingConfigs = parsed;
          else {
            existingConfigs = [{
              id: Date.now().toString(),
              internal: parsed.internal || "",
              external: parsed.external || "",
              name: "默认服务器",
            }];
          }
        }
      } catch {
        existingConfigs = [];
      }

      const existingIndex = existingConfigs.findIndex(
        (c) => c.internal === internalAddress && c.external === externalAddress,
      );

      if (existingIndex === -1) {
        existingConfigs.push({
          id: Date.now().toString(),
          internal: internalAddress,
          external: externalAddress,
          name: `服务器 ${existingConfigs.length + 1}`,
        });
      }

      await AsyncStorage.setItem(configKey, JSON.stringify(existingConfigs));
      await AsyncStorage.setItem(
        `creds_${sourceType}_${bestAddress}`,
        JSON.stringify({ username, password }),
      );

      await switchServer(bestAddress, sourceType, true);

      const mappedType = SOURCEMAP[sourceType as keyof typeof SOURCEMAP] || "audiodock";
      if (isLogin) {
        await login({ username, password });
      } else {
        if (mappedType === "subsonic") {
          throw new Error("Subsonic 数据源不支持注册");
        }
        await register({ username, password });
      }

      router.replace("/(tabs)");
    } catch (error: any) {
      console.error(error);
      Alert.alert("错误", error.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
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
      Alert.alert("扫码成功", "请在被扫码设备上确认导入的数据源");
    } catch (error: any) {
      console.error(error);
      Alert.alert("扫码失败", error.message || "请重试");
      setHasScanned(false);
    } finally {
      setScanBusy(false);
    }
  };

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
    if (!scanSession) return;
    try {
      setScanBusy(true);
      const selections = Object.entries(selectedConfigIds).map(([type, configIds]) => ({
        type,
        configIds,
      }));
      const res = await consumeScanLoginSession(scanSession.sessionId, {
        secret: scanSession.secret,
        selections,
      });
      await applyMobileScanLoginResult(res.data, {
        switchServer,
        setPlusToken,
      });
      router.replace("/(tabs)" as any);
    } catch (error: any) {
      console.error(error);
      Alert.alert("错误", error.message || "确认扫码登录失败");
    } finally {
      setScanBusy(false);
    }
  };

  const LogoIcon = () => {
    if (sourceType === "AudioDock") return <Image source={logo} style={styles.logo} />;
    if (sourceType === "Subsonic") return <Image source={subsonicLogo} style={styles.logo} />;
    if (sourceType === "Emby") return <Image source={embyLogo} style={styles.logo} />;
    return <Image source={logo} style={styles.logo} />;
  };

  const renderScanPanel = () => {
    if (isLandscape) {
      if (scanStatus?.status === "waiting_confirm") {
        return (
          <View style={[styles.scanCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.scanTitle, { color: colors.text }]}>确认同步内容</Text>
            <Text style={[styles.scanDesc, { color: colors.secondary }]}>
              {scanStatus.deviceName ? `${scanStatus.deviceName} 已扫码。` : "已有设备扫码。"}
              确认后当前设备会自动登录，并保存所选数据源。
            </Text>
            <ScrollView style={styles.confirmList} contentContainerStyle={{ gap: 12 }}>
              {scanStatus.sourceBundles.map((bundle) => (
                <View key={bundle.type} style={[styles.bundleCard, { borderColor: colors.border }]}>
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
                          name={checked ? "check-box" : "check-box-outline-blank"}
                          size={20}
                          color={checked ? colors.primary : colors.secondary}
                        />
                        <View style={{ flex: 1 }}>
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
            </ScrollView>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={handleConfirmScan}
              disabled={scanBusy}
            >
              {scanBusy ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Text style={[styles.buttonText, { color: colors.background }]}>确认并登录</Text>
              )}
            </TouchableOpacity>
          </View>
        );
      }

      return (
        <View style={[styles.scanCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {qrValue ? (
            <View style={styles.qrBox}>
              <QRCode value={qrValue} size={180} />
            </View>
          ) : null}
          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: colors.border, backgroundColor: colors.background }]}
            onPress={createTargetSession}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>刷新二维码</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!permission) {
      return <ActivityIndicator color={colors.primary} />;
    }

    if (!permission.granted) {
      return (
        <View style={[styles.scanCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.scanTitle, { color: colors.text }]}>主动扫码登录</Text>
          <Text style={[styles.scanDesc, { color: colors.secondary }]}>
            当前为竖屏模式，属于主动扫码设备。需要开启相机权限后才能扫描另一台设备的二维码。
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={requestPermission}
          >
            <Text style={[styles.buttonText, { color: colors.background }]}>开启相机权限</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={[styles.scanCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.scanTitle, { color: colors.text }]}>主动扫码登录</Text>
        <Text style={[styles.scanDesc, { color: colors.secondary }]}>
          请扫描 desktop 或 mobile 横屏登录页上的二维码，扫码后对方会展示待导入的数据源。
        </Text>
        <View style={styles.cameraFrame}>
          <CameraView
            style={styles.camera}
            facing="back"
            onBarcodeScanned={handleBarcodeScanned}
          />
        </View>
        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: colors.border, backgroundColor: colors.background }]}
          onPress={() => setHasScanned(false)}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>重新扫码</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderManualForm = () => (
    <View style={styles.form}>
      <Text style={[styles.label, { color: colors.text }]}>外网地址 (External)</Text>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
        placeholder="http://music.example.com"
        placeholderTextColor={colors.secondary}
        value={externalAddress}
        onChangeText={setExternalAddress}
        autoCapitalize="none"
      />

      <Text style={[styles.label, { color: colors.text }]}>内网地址 (Internal)</Text>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
        placeholder="http://192.168.x.x:3000"
        placeholderTextColor={colors.secondary}
        value={internalAddress}
        onChangeText={setInternalAddress}
        autoCapitalize="none"
      />

      <Text style={[styles.label, { color: colors.text }]}>用户名</Text>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
        placeholder="请输入用户名"
        placeholderTextColor={colors.secondary}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />

      <Text style={[styles.label, { color: colors.text }]}>密码</Text>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
        placeholder="请输入密码"
        placeholderTextColor={colors.secondary}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      {!isLogin ? (
        <>
          <Text style={[styles.label, { color: colors.text }]}>确认密码</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            placeholder="请再次输入密码"
            placeholderTextColor={colors.secondary}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />
        </>
      ) : null}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.background} />
        ) : (
          <Text style={[styles.buttonText, { color: colors.background }]}>
            {isLogin ? "登录" : "注册"}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setIsLogin((prev) => !prev)}>
        <Text style={[styles.switchText, { color: colors.primary }]}>
          {isLogin ? "没有账号？去注册" : "已有账号？去登录"}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => {
                router.replace("/login" as any);
              }}
              style={styles.backButton}
            >
              <Text style={{ color: colors.text, fontSize: 12, marginLeft: 5 }}>切换类型</Text>
              <MaterialIcons name="grid-view" size={12} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View
            style={[
              styles.content,
              isLandscape && styles.contentLandscape,
            ]}
          >
            {isLandscape ? renderScanPanel() : null}

            <View style={[styles.formCard, { backgroundColor: colors.background }]}>
              <View style={styles.logoContainer}>
                <LogoIcon />
                <Text style={[styles.title, { color: colors.text }]}>
                  {sourceType} {isLogin ? "登录" : "注册"}
                </Text>
              </View>

              <Text style={[styles.tips, { color: colors.secondary }]}>
                {SOURCETIPSMAP[sourceType as keyof typeof SOURCETIPSMAP]}
              </Text>

              {!isLandscape ? (
                <View style={[styles.modeTabs, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  <TouchableOpacity
                    style={[
                      styles.modeTab,
                      panelMode === "scan" && { backgroundColor: colors.primary },
                    ]}
                    onPress={() => setPanelMode("scan")}
                  >
                    <Text
                      style={[
                        styles.modeTabText,
                        { color: panelMode === "scan" ? colors.background : colors.text },
                      ]}
                    >
                      扫码登录
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modeTab,
                      panelMode === "manual" && { backgroundColor: colors.primary },
                    ]}
                    onPress={() => setPanelMode("manual")}
                  >
                    <Text
                      style={[
                        styles.modeTabText,
                        { color: panelMode === "manual" ? colors.background : colors.text },
                      ]}
                    >
                      账号登录
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {!isLandscape && panelMode === "scan" ? renderScanPanel() : renderManualForm()}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    paddingHorizontal: 20,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    padding: 5,
  },
  content: {
    flex: 1,
    padding: 24,
    gap: 18,
    justifyContent: "center",
  },
  contentLandscape: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  formCard: {
    flex: 1,
    minWidth: 0,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 24,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 20,
    borderRadius: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },
  tips: {
    fontSize: 13,
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 20,
  },
  modeTabs: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 14,
    padding: 4,
    marginBottom: 18,
  },
  modeTab: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  modeTabText: {
    fontSize: 14,
    fontWeight: "600",
  },
  scanCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    gap: 14,
    width: "100%",
    maxWidth: 380,
  },
  scanTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  scanDesc: {
    fontSize: 13,
    lineHeight: 20,
  },
  qrBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
  },
  cameraFrame: {
    height: 280,
    borderRadius: 16,
    overflow: "hidden",
  },
  camera: {
    flex: 1,
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  confirmList: {
    maxHeight: 280,
  },
  bundleCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 12,
  },
  bundleTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  bundleItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  bundleItemTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  bundleItemMeta: {
    fontSize: 12,
    marginTop: 3,
    lineHeight: 18,
  },
  form: {
    width: "100%",
    gap: 15,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 5,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 15,
    fontSize: 16,
  },
  button: {
    height: 50,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  switchText: {
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 10,
  },
});
