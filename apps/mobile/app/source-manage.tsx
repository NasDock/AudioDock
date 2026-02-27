import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SOURCEMAP, SOURCETIPSMAP } from "@soundx/services";
import * as Network from 'expo-network';
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
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
import { useAuth } from "../src/context/AuthContext";
import { useTheme } from "../src/context/ThemeContext";
import { selectBestServer } from "../src/utils/networkUtils";

const logo = require("../assets/images/logo.png");
const subsonicLogo = require("../assets/images/subsonic.png");
const embyLogo = require("../assets/images/emby.png");

export default function SourceManageScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { switchServer } = useAuth();

  const [configs, setConfigs] = useState<
    Record<
      string,
      Array<{ id: string; internal: string; external: string; name?: string }>
    >
  >({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [networkType, setNetworkType] = useState<Network.NetworkStateType>(Network.NetworkStateType.UNKNOWN);

  useEffect(() => {
    loadAllConfigs();
    checkNetwork();
  }, []);

  const checkNetwork = async () => {
      const state = await Network.getNetworkStateAsync();
      if (state.type) {
        setNetworkType(state.type);
      }
  };

  const loadAllConfigs = async () => {
    const newConfigs: Record<
      string,
      Array<{ id: string; internal: string; external: string; name?: string }>
    > = {};
    for (const key of Object.keys(SOURCEMAP)) {
      try {
        const configKey = `sourceConfig_${key}`;
        const saved = await AsyncStorage.getItem(configKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            newConfigs[key] = parsed;
          } else {
            // Migration: Convert old object format to array
            newConfigs[key] = [
              {
                id: Date.now().toString(),
                internal: parsed.internal || "",
                external: parsed.external || "",
                name: "默认服务器",
              },
            ];
          }
        } else {
          // No saved config, empty array
          newConfigs[key] = [];
        }
      } catch (e) {
        newConfigs[key] = [];
      }
    }
    setConfigs(newConfigs);
  };

  const updateConfig = (
    key: string,
    id: string,
    field: "internal" | "external" | "name",
    value: string,
  ) => {
    setConfigs((prev) => ({
      ...prev,
      [key]: prev[key].map((item) =>
        item.id === id ? { ...item, [field]: value } : item,
      ),
    }));
  };

  const deleteConfig = async (key: string, id: string) => {
    Alert.alert("删除数据源", "确定要删除这个数据源配置吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          const newKeyConfigs = configs[key].filter((item) => item.id !== id);
          setConfigs((prev) => ({
            ...prev,
            [key]: newKeyConfigs,
          }));
          await AsyncStorage.setItem(
            `sourceConfig_${key}`,
            JSON.stringify(newKeyConfigs),
          );
        },
      },
    ]);
  };

  const saveConfig = async (key: string) => {
    const config = configs[key];
    await AsyncStorage.setItem(`sourceConfig_${key}`, JSON.stringify(config));
  };

  const handleConnect = async (key: string, id: string) => {
    const configList = configs[key];
    const config = configList.find((c) => c.id === id);

    if (!config || (!config.internal && !config.external)) {
      Alert.alert("提示", "请至少输入一个地址");
      return;
    }

    try {
      setLoadingId(id);
      await saveConfig(key); // Save all configs for this key

      const bestAddress = await selectBestServer(
        config.internal,
        config.external,
        key,
      );

      if (!bestAddress) {
        setExpanded((prev) => ({ ...prev, [id]: true }));
        Alert.alert(
          "连接失败",
          "无法连接到该数据源的任一地址，请检查网络或配置",
        );
        return;
      }

      // Switch server
      // If the token is valid for this new address, switchServer will load it.
      // If not, app might redirect to login if wrapped in auth guard.
      await switchServer(bestAddress, key);

      router.back();
    } catch (error: any) {
      console.error(error);
      setExpanded((prev) => ({ ...prev, [id]: true }));
      Alert.alert("错误", error.message || "切换失败");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          切换数据源
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.cardSubtitle, { color: colors.secondary }]}>
            Wi-Fi 环境下优先选择内网，移动网络环境下只选择外网
          </Text>
          {Object.keys(SOURCEMAP).map((key) => {
            // Only show those that have at least one config saved
            const configList = configs[key] || [];
            if (configList.length === 0) return null;

            return configList.map((config) => {
              const uniqueId = config.id;
              const isLoading = loadingId === uniqueId;
              const isDisabled = false;

              const getLogo = (k: string) => {
                switch (k) {
                  case "Emby":
                    return embyLogo;
                  case "Subsonic":
                    return subsonicLogo;
                  default:
                    return logo;
                }
              };

              const hasValue = !!(config.internal || config.external);
              const isExpanded = expanded[uniqueId] ?? !hasValue;

              const isWifi = networkType === Network.NetworkStateType.WIFI;
              let connectButtonText = "自动连接";
              let networkConnectDisabled = false;

              if (config.internal && config.external) {
                  connectButtonText = "自动连接";
              } else if (config.internal) {
                  connectButtonText = "内网连接";
              } else if (config.external) {
                  connectButtonText = "外网连接";
              }

              if (!isWifi) {
                  // Cellular or other
                  if (!config.external) {
                      connectButtonText = "无法连接 (缺外网)";
                      networkConnectDisabled = true;
                  } else {
                      connectButtonText = "外网连接";
                  }
              }

              const toggleExpand = () => {
                setExpanded((prev) => ({
                  ...prev,
                  [uniqueId]: !isExpanded,
                }));
              };

              return (
                <View
                  key={uniqueId}
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                    isDisabled && { opacity: 0.5 },
                  ]}
                >
                  <View style={styles.cardHeaderRow}>
                    <TouchableOpacity
                      style={styles.cardHeaderClickable}
                      onPress={hasValue ? toggleExpand : undefined}
                      activeOpacity={hasValue ? 0.7 : 1}
                    >
                      <Image source={getLogo(key)} style={styles.cardLogo} />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.cardTitle, { color: colors.text }]}
                        >
                          {key}
                        </Text>
                        <Text
                          style={[
                            styles.cardSubtitle,
                            { color: colors.secondary },
                          ]}
                        >
                          {SOURCETIPSMAP[key as keyof typeof SOURCETIPSMAP]}
                        </Text>
                      </View>
                      {hasValue && (
                        <Ionicons
                          name={isExpanded ? "chevron-up" : "chevron-down"}
                          size={24}
                          color={colors.secondary}
                        />
                      )}
                    </TouchableOpacity>
                  </View>

                  {isExpanded && (
                    <>
                      {/* Can add name editing here if needed */}
                      <View style={styles.inputGroup}>
                        <Text
                          style={[styles.label, { color: colors.secondary }]}
                        >
                          内网地址
                        </Text>
                        <TextInput
                          style={[
                            styles.input,
                            {
                              color: colors.text,
                              borderColor: colors.border,
                              backgroundColor: colors.background,
                            },
                          ]}
                          value={config.internal}
                          onChangeText={(val) =>
                            updateConfig(key, uniqueId, "internal", val)
                          }
                          autoCapitalize="none"
                          placeholder="http://192.168.x.x:port"
                          placeholderTextColor={colors.secondary}
                          editable={!isDisabled}
                        />
                      </View>

                      <View style={styles.inputGroup}>
                        <Text
                          style={[styles.label, { color: colors.secondary }]}
                        >
                          外网地址
                        </Text>
                        <TextInput
                          style={[
                            styles.input,
                            {
                              color: colors.text,
                              borderColor: colors.border,
                              backgroundColor: colors.background,
                            },
                          ]}
                          value={config.external}
                          onChangeText={(val) =>
                            updateConfig(key, uniqueId, "external", val)
                          }
                          autoCapitalize="none"
                          placeholder="https://example.com"
                          placeholderTextColor={colors.secondary}
                          editable={!isDisabled}
                        />
                      </View>
                    </>
                  )}

                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      marginTop: 0,
                      gap: 0,
                    }}
                  >
                    <TouchableOpacity
                      style={[
                        styles.connectButton,
                        { padding: 5, width: 40, backgroundColor: "red" },
                      ]}
                      onPress={() => deleteConfig(key, uniqueId)}
                    >
                      <Ionicons name="trash-outline" size={18} color="#fff" />
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.connectButton,
                        {
                          backgroundColor: networkConnectDisabled ? colors.border : colors.primary,
                          flex: 1,
                          marginHorizontal: 10,
                          marginTop: 0,
                        },
                      ]}
                      onPress={() => handleConnect(key, uniqueId)}
                      disabled={isDisabled || isLoading || networkConnectDisabled}
                    >
                      {isLoading ? (
                        <ActivityIndicator color={colors.background} />
                      ) : (
                        <Text
                          style={[
                            styles.buttonText,
                            { color: networkConnectDisabled ? colors.text : colors.background },
                          ]}
                        >
                          {connectButtonText}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            });
          })}

          <TouchableOpacity
            style={[
              styles.addButton,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
            onPress={() =>
              router.push({
                pathname: "/login",
                params: { adding: "true" },
              } as any)
            }
          >
            <Ionicons
              name="add-circle-outline"
              size={18}
              color={colors.primary}
            />
            <Text style={[styles.addButtonText, { color: colors.primary }]}>
              添加数据源
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
    paddingBottom: 5,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  backButton: {
    padding: 5,
  },
  scrollContent: {
    padding: 15,
    gap: 15,
  },
  card: {
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardHeader: {
    marginBottom: 15,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  cardHeaderClickable: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  cardLogo: {
    width: 40,
    height: 40,
    marginRight: 10,
    borderRadius: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 5,
  },
  cardSubtitle: {
    fontSize: 12,
  },
  inputGroup: {
    marginBottom: 10,
  },
  label: {
    fontSize: 12,
    marginBottom: 5,
  },
  input: {
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  connectButton: {
    height: 35,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: {
    fontWeight: "bold",
    fontSize: 12,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    gap: 8,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: "bold",
  },
});
