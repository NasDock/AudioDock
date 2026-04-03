import { useRouter } from "expo-router";
import React, { useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../src/context/AuthContext";
import { useTheme } from "../src/context/ThemeContext";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Camera } from "expo-camera";
import {
  createScanLoginSession,
  getScanLoginSession,
  plusLogin,
  plusSendCode,
  setPlusToken,
  subscribeScanLoginSession,
  consumeScanLoginSession,
  reportScanLoginResultViaSocket,
  type ScanLoginSession,
  type ScanLoginSessionStatus,
} from "@soundx/services";
import QRCode from "react-native-qrcode-svg";

const logo = require("../assets/images/logo.png");
type PanelMode = "sms" | "scan";

export default function MemberLoginScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setPlusToken: setContextPlusToken, token, switchServer } = useAuth();
  const [permission, setPermission] = useState<any>(null);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [scanBusy, setScanBusy] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanLoginSessionStatus | null>(null);

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [scanSession, setScanSession] = useState<ScanLoginSession | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>("sms");

  React.useEffect(() => {
    Camera.getCameraPermissionsAsync()
      .then(setPermission)
      .catch((error) => console.error("Failed to load camera permission:", error));
  }, []);

  const handleSendCode = async () => {
    if (!phone) {
        Alert.alert("提示", "请输入手机号");
        return;
    }
    setSendingCode(true);
    try {
        const res = await plusSendCode({ phone });
        if (res.data.code === 201 || res.data.code === 200) {
            setCountdown(60);
            const timer = setInterval(() => {
                setCountdown((prev) => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else {
            Alert.alert("错误", res.data.message || "获取验证码失败");
        }
    } catch (e: any) {
        Alert.alert("错误", e.response?.data?.message || "网络请求失败");
    } finally {
        setSendingCode(false);
    }
  };

  const handleLogin = async () => {
    if (!phone || !code) {
        Alert.alert("提示", "请输入手机号和验证码");
        return;
    }
    setLoading(true);
    try {
        const res = await plusLogin({ phone, code });
        if (res.data.code === 201 || res.data.code === 200) {
            const { token: plusToken, userId } = res.data.data;
            
            // 保存 Plus Token
            await AsyncStorage.setItem("plus_token", plusToken);
            await AsyncStorage.setItem("plus_user_id", JSON.stringify(userId));
            setPlusToken(plusToken);
            await setContextPlusToken(plusToken);
            router.replace(token ? "/(tabs)" : "/login");
        } else {
            Alert.alert("登录失败", res.data.message || "手机号或验证码错误");
        }
    } catch (e: any) {
        Alert.alert("错误", e.response?.data?.message || "登录失败，请重试");
    } finally {
        setLoading(false);
    }
  };

  const refreshScanStatus = async (session: ScanLoginSession) => {
    return getScanLoginSession(session.sessionId, session.secret);
  };

  const createTargetSession = async () => {
    try {
      const res = await createScanLoginSession({
        role: "target",
        deviceKind: "mobile",
      });
      setScanSession(res.data);
    } catch (error) {
      console.error(error);
      Alert.alert("错误", "创建扫码会话失败");
    }
  };

  React.useEffect(() => {
    createTargetSession();
  }, []);

  React.useEffect(() => {
    if (!scanSession) return;

    refreshScanStatus(scanSession).catch((error) => console.error(error));
    const unsubscribe = subscribeScanLoginSession(
      scanSession.sessionId,
      scanSession.secret,
      (status) => setScanStatus(status),
    );

    return () => unsubscribe();
  }, [scanSession]);

  React.useEffect(() => {
    if (!scanSession || scanStatus?.status !== "confirmed") return;

    const consumeConfirmedScan = async () => {
      try {
        setScanBusy(true);
        const res = await consumeScanLoginSession(scanSession.sessionId, {
          secret: scanSession.secret,
        });

        try {
          const { applyMobileScanLoginResult } = await import("../src/utils/scanLogin");
          await applyMobileScanLoginResult(res.data, {
            switchServer,
            setPlusToken: setContextPlusToken,
          });
        } catch (applyErr: any) {
          reportScanLoginResultViaSocket(scanSession.sessionId, scanSession.secret, false, applyErr.message);
          throw applyErr;
        }

        reportScanLoginResultViaSocket(scanSession.sessionId, scanSession.secret, true);
        router.replace("/(tabs)" as any);
      } catch (error: any) {
        console.error(error);
        Alert.alert("错误", error.message || "扫码登录失败");
        createTargetSession();
      } finally {
        setScanBusy(false);
      }
    };

    consumeConfirmedScan();
  }, [scanSession?.sessionId, scanStatus?.status]);



  const qrValue = scanSession
    ? JSON.stringify({
        kind: "soundx-scan-login",
        version: 1,
        sessionId: scanSession.sessionId,
        secret: scanSession.secret,
        role: "target",
        deviceKind: "mobile",
      })
    : "";

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <View style={styles.logoContainer}>
               <Image source={logo} style={styles.logo} />
               <Text style={[styles.title, { color: colors.text }]}>
                 用户登录
               </Text>
               <Text style={[styles.subtitle, { color: colors.secondary }]}>
                 AudioDock 听见你的声音
               </Text>
            </View>

            <View style={[styles.modeTabs, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <TouchableOpacity
                style={[styles.modeTab, panelMode === "sms" && { backgroundColor: colors.primary }]}
                onPress={() => setPanelMode("sms")}
              >
                <Text style={[styles.modeTabText, { color: panelMode === "sms" ? colors.background : colors.text }]}>
                  验证码登录
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeTab, panelMode === "scan" && { backgroundColor: colors.primary }]}
                onPress={() => setPanelMode("scan")}
              >
                <Text style={[styles.modeTabText, { color: panelMode === "scan" ? colors.background : colors.text }]}>
                  扫码登录
                </Text>
              </TouchableOpacity>
            </View>

            {panelMode === "sms" ? (
              <View style={styles.form}>
                <Text style={[styles.label, { color: colors.text }]}>手机号</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder="请输入手机号"
                  placeholderTextColor={colors.secondary}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                />

                <Text style={[styles.label, { color: colors.text }]}>验证码</Text>
                <View style={styles.codeRow}>
                  <TextInput
                      style={[styles.input, { flex: 1, marginBottom: 0, color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                      placeholder="请输入验证码"
                      placeholderTextColor={colors.secondary}
                      value={code}
                      onChangeText={setCode}
                      keyboardType="number-pad"
                      autoCapitalize="none"
                  />
                  <TouchableOpacity 
                      style={[
                          styles.codeButton, 
                          { backgroundColor: colors.primary, opacity: (countdown > 0 || sendingCode) ? 0.6 : 1 }
                      ]}
                      onPress={handleSendCode}
                      disabled={countdown > 0 || sendingCode}
                  >
                      {sendingCode ? (
                          <ActivityIndicator size="small" color="#fff" />
                      ) : (
                          <Text style={[styles.codeButtonText, { color: colors.background }]}>
                              {countdown > 0 ? `${countdown}s` : "获取验证码"}
                          </Text>
                      )}
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.button, { backgroundColor: colors.primary  }]}
                  onPress={handleLogin}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color={colors.background} />
                  ) : (
                    <Text style={[styles.buttonText, { color: colors.background }]}>
                      登录
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.form}>
                {!isLandscape ? (
                  <>
                    <Text style={[styles.label, { color: colors.text, textAlign: "center", marginTop: 24, marginBottom: 16 }]}>
                      通过扫一扫，可以将本设备的登录状态及配置数据同步到其他设备。
                    </Text>
                    <TouchableOpacity
                      style={[styles.button, { backgroundColor: colors.primary }]}
                      onPress={() => router.push("/scan" as any)}
                    >
                      <Text style={[styles.buttonText, { color: colors.background }]}>去扫面二维码</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    {scanStatus?.status === "waiting_confirm" ? (
                      <View style={[styles.qrBox, { borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 24, marginVertical: 20 }]}>
                        <Text style={[styles.title, { color: colors.text, fontSize: 18 }]}>等待手机端确认</Text>
                        <Text style={[styles.subtitle, { color: colors.secondary, marginTop: 8 }]}>
                           手机已扫码。请在手机屏幕上勾选要导入的数据源，并在手机上点击确认发送...
                        </Text>
                        <ActivityIndicator style={{ marginTop: 24 }} size="large" color={colors.primary} />
                      </View>
                    ) : (
                      <>
                        {qrValue ? (
                          <View style={styles.qrBox}>
                            <QRCode value={qrValue} size={180} />
                            <Text style={{ color: colors.secondary, marginTop: 16, textAlign: "center" }}>
                              请使用移动端扫码
                            </Text>
                          </View>
                        ) : null}
                        <TouchableOpacity
                          style={[styles.ghostButton, { borderColor: colors.border, backgroundColor: colors.card, marginTop: 12 }]}
                          onPress={createTargetSession}
                          disabled={scanBusy}
                        >
                          <Text style={{ color: colors.text }}>刷新二维码</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </>
                )}
              </View>
            )}

            <View style={styles.footerLinks}>
              <Text style={{color: colors.secondary, fontSize: 12}}>登录即代表同意 </Text>
              <TouchableOpacity onPress={() => Alert.alert("用户协议", "这里展示用户协议内容")}>
                  <Text style={{color: '#1677ff', fontSize: 12}}>《用户协议》</Text>
              </TouchableOpacity>
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
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    padding: 5,
  },
  content: {
    flex: 1,
    padding: 30,
    paddingTop: 0,
    justifyContent: "center",
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
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
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  form: {
    width: "100%",
    gap: 15,
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
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 5,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderRadius: 12,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 15,
    fontSize: 16,
    marginBottom: 5,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    marginBottom: 5,
  },
  codeButton: {
    height: 50,
    borderRadius: 12,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 110,
  },
  codeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  button: {
    height: 50,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
    marginBottom: 20,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "bold",
  },
  footerLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  cameraFrame: {
    height: 280,
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: 12,
  },
  camera: {
    flex: 1,
  },
  qrBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
  },
  ghostButton: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
});
