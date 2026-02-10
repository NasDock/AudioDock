import { MaterialIcons } from "@expo/vector-icons";
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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../src/context/ThemeContext";

const logo = require("../assets/images/logo.png");

export default function MemberLoginScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const handleSendCode = () => {
    if (!phone) {
        Alert.alert("提示", "请输入手机号");
        return;
    }
    setSendingCode(true);
    // Simulate API call
    setTimeout(() => {
        setSendingCode(false);
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
        Alert.alert("提示", "验证码已发送（模拟）");
    }, 1500);
  };

  const handleLogin = () => {
    if (!phone || !code) {
        Alert.alert("提示", "请输入手机号和验证码");
        return;
    }
    setLoading(true);
    // Simulate Login API
    setTimeout(() => {
        setLoading(false);
        Alert.alert("成功", "会员登录成功（模拟）");
        router.back(); 
        // In real implementation, you would save member token/status here
    }, 1500);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
             <TouchableOpacity 
               onPress={() => router.back()} 
               style={styles.backButton}
             >
                <MaterialIcons name="arrow-back" size={24} color={colors.text} />
             </TouchableOpacity>
          </View>

          <View style={styles.content}>
            <View style={styles.logoContainer}>
               <Image source={logo} style={styles.logo} />
               <Text style={[styles.title, { color: colors.text }]}>
                 成为会员
               </Text>
               <Text style={[styles.subtitle, { color: colors.secondary }]}>
                 享受更多会员权益
               </Text>
            </View>
            
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
                            {countdown > 0 ? `${countdown}s` : "验证码"}
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

              <View style={styles.footerLinks}>
                <Text style={{color: colors.secondary, fontSize: 12}}>登录即代表同意 </Text>
                <TouchableOpacity onPress={() => Alert.alert("用户协议", "这里展示用户协议内容")}>
                    <Text style={{color: colors.primary, fontSize: 12}}>《用户协议》</Text>
                </TouchableOpacity>
                <Text style={{color: colors.secondary, fontSize: 12}}> 和 </Text>
                <TouchableOpacity onPress={() => router.push("/member-benefits" as any)}>
                     <Text style={{color: colors.primary, fontSize: 12}}>《会员服务协议》</Text>
                </TouchableOpacity>
              </View>

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
    paddingTop: 10,
    justifyContent: "flex-start",
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: 20,
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
  }
});
