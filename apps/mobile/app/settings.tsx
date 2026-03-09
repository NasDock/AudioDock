import { Ionicons } from "@expo/vector-icons";
import { Slider } from "@miblanchard/react-native-slider";
import { useRouter } from "expo-router";
import React from "react";
import {
    Alert,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../src/context/AuthContext";
import { useSettings } from "../src/context/SettingsContext";
import { useTheme } from "../src/context/ThemeContext";
import { clearSpecificCache, getDetailedCacheSize } from "../src/services/cache";
import { usePlayMode } from "../src/utils/playMode";
import { getLocalVersion } from "../src/utils/updateUtils";

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, theme, toggleTheme, setTheme } = useTheme();
  const { mode, setMode } = usePlayMode();
  const { logout, user, sourceType, plusToken } = useAuth();
  const {
    acceptRelay,
    acceptSync,
    cacheEnabled,
    autoOrientation,
    autoTheme,
    carModeEnabled,
    carLayoutMode,
    voiceAssistantEnabled,
    recommendationLikeRatio,
    updateSetting,
  } = useSettings();

  const [cacheSize, setCacheSize] = React.useState<string>("0 B");
  const [localVersion, setLocalVersion] = React.useState<string>("");

  React.useEffect(() => {
    const loadCacheSize = async () => {
      const size = await getDetailedCacheSize();
      setCacheSize(size);
    };
    loadCacheSize();
    getLocalVersion().then(setLocalVersion);
  }, []);

  const handleClearCache = async () => {
    Alert.alert("确认", "确定要清空缓存吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "清空",
        style: "destructive",
        onPress: async () => {
          await clearSpecificCache("all");
          const size = await getDetailedCacheSize();
          setCacheSize(size);
        },
      },
    ]);
  };

  const renderSettingRow = (
    label: string,
    description: string,
    value: boolean,
    onValueChange: (val: boolean) => void,
    disabled?: boolean
  ) => (
    <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
      <View style={styles.settingInfo}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>
          {label}
        </Text>
        <Text style={[styles.settingDescription, { color: colors.secondary }]}>
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.card}
      />
    </View>
  );

  const handleToggleCarMode = (val: boolean) => {
    if (val && !plusToken) {
      Alert.alert("会员功能", "车机模式为会员权益，请先登录/开通会员。", [
        { text: "取消", style: "cancel" },
        { text: "去开通", onPress: () => router.push("/member-benefits" as any) },
      ]);
      return;
    }
    void updateSetting("carModeEnabled", val);
  };

  const handleToggleCarLayoutMode = (val: boolean) => {
    if (val && !plusToken) {
      Alert.alert("会员功能", "车机布局模式为会员权益，请先登录/开通会员。", [
        { text: "取消", style: "cancel" },
        { text: "去开通", onPress: () => router.push("/member-benefits" as any) },
      ]);
      return;
    }
    void updateSetting("carLayoutMode", val);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          播放设置
        </Text>

        {renderSettingRow(
          "切换音乐与有声书的显示内容",
          mode === "AUDIOBOOK",
          (val) => setMode(val ? "AUDIOBOOK" : "MUSIC")
        )}

        {renderSettingRow(
          "接力播放",
          "是否接受多设备之间播放接力",
          acceptRelay,
          (val) => updateSetting("acceptRelay", val)
        )}

        {renderSettingRow(
          "同步控制",
          "是否接受同数据源下其他用户的同步控制请求",
          acceptSync,
          (val) => updateSetting("acceptSync", val)
        )}

        {renderSettingRow(
          "自动横竖屏",
          "开启后应用将跟随手机重力感应自动旋转",
          autoOrientation,
          (val) => updateSetting("autoOrientation", val)
        )}

        {renderSettingRow(
          "车机模式",
          "播放器使用大按钮和简化交互，更适合驾驶场景",
          carModeEnabled,
          handleToggleCarMode
        )}

        {renderSettingRow(
          "车机布局模式",
          "左侧固定播放器(9:16)，右侧显示其他页面和导航",
          carLayoutMode,
          handleToggleCarLayoutMode
        )}

        {renderSettingRow(
          "语音助手",
          "开启后显示全局语音助手小松鼠",
          voiceAssistantEnabled,
          (val) => updateSetting("voiceAssistantEnabled", val)
        )}

        <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
          <View style={styles.settingInfo}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              推荐偏好（喜欢/新鲜）
            </Text>
            <Text style={[styles.settingDescription, { color: colors.secondary }]}>
              调整推荐算法中喜欢与新鲜内容的比例
            </Text>
          </View>
          <Slider
            value={recommendationLikeRatio}
            onValueChange={(value) =>
              updateSetting("recommendationLikeRatio", Array.isArray(value) ? value[0] : value)
            }
            minimumValue={0}
            maximumValue={100}
            step={10}
            containerStyle={{ width: 120 }}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.primary}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          缓存管理
        </Text>

        <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
          <View style={styles.settingInfo}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              缓存大小
            </Text>
            <Text style={[styles.settingDescription, { color: colors.secondary }]}>
              当前已缓存 {cacheSize}
            </Text>
          </View>
          <TouchableOpacity onPress={handleClearCache}>
            <Text style={{ color: colors.primary, fontWeight: "600" }}>
              清空
            </Text>
          </TouchableOpacity>
        </View>

        {renderSettingRow(
          "启用缓存",
          "开启后会将部分数据缓存到本地，提升加载速度",
          cacheEnabled,
          (val) => updateSetting("cacheEnabled", val)
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          主题设置
        </Text>

        <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
          <View style={styles.settingInfo}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              当前主题
            </Text>
            <Text style={[styles.settingDescription, { color: colors.secondary }]}>
              {theme === "dark" ? "深色" : "浅色"}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              onPress={() => setTheme("light")}
              style={[
                styles.themeButton,
                {
                  backgroundColor:
                    theme === "light" ? colors.primary : colors.card,
                },
              ]}
            >
              <Ionicons
                name="sunny"
                size={20}
                color={theme === "light" ? colors.card : colors.text}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setTheme("dark")}
              style={[
                styles.themeButton,
                {
                  backgroundColor:
                    theme === "dark" ? colors.primary : colors.card,
                },
              ]}
            >
              <Ionicons
                name="moon"
                size={20}
                color={theme === "dark" ? colors.card : colors.text}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={toggleTheme}
              style={[styles.themeButton, { backgroundColor: colors.card }]}
            >
              <Ionicons name="sync" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        {renderSettingRow(
          "自动主题",
          "根据系统设置自动切换深色/浅色主题",
          autoTheme,
          (val) => updateSetting("autoTheme", val)
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          关于
        </Text>

        <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
          <View style={styles.settingInfo}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              版本
            </Text>
            <Text style={[styles.settingDescription, { color: colors.secondary }]}>
              {localVersion}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.settingRow, { borderBottomColor: colors.border }]}
          onPress={() => router.push("/admin" as any)}
        >
          <View style={styles.settingInfo}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              管理后台
            </Text>
            <Text style={[styles.settingDescription, { color: colors.secondary }]}>
              查看系统状态和管理用户
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
        </TouchableOpacity>

        {user && (
          <TouchableOpacity
            style={[styles.settingRow, { borderBottomColor: colors.border }]}
            onPress={() => {
              Alert.alert("确认退出", "确定要退出登录吗？", [
                { text: "取消", style: "cancel" },
                {
                  text: "退出",
                  style: "destructive",
                  onPress: logout,
                },
              ]);
            }}
          >
            <View style={styles.settingInfo}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>
                退出登录
              </Text>
              <Text style={[styles.settingDescription, { color: colors.secondary }]}>
                {user.name} ({sourceType})
              </Text>
            </View>
            <Ionicons name="log-out-outline" size={20} color={colors.secondary} />
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 10,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  settingInfo: {
    flex: 1,
    marginRight: 10,
  },
  settingLabel: {
    fontSize: 16,
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 12,
  },
  themeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
});
