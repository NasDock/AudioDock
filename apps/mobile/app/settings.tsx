import { Ionicons } from "@expo/vector-icons";
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
  const { logout, user, sourceType } = useAuth();
  const {
    acceptRelay,
    acceptSync,
    cacheEnabled,
    autoOrientation,
    autoTheme,
    updateSetting,
  } = useSettings();
  const [detailedSizes, setDetailedSizes] = React.useState<{
    covers: string;
    music: string;
    audiobooks: string;
    apks: string;
  }>({
    covers: "0 B",
    music: "0 B",
    audiobooks: "0 B",
    apks: "0 B",
  });

  const formatSize = (size: number) => {
    if (size === 0) return "0 B";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const fetchCacheSize = async () => {
    const sizes = await getDetailedCacheSize();
    setDetailedSizes({
      covers: formatSize(sizes.covers),
      music: formatSize(sizes.music),
      audiobooks: formatSize(sizes.audiobooks),
      apks: formatSize(sizes.apks),
    });
  };

  React.useEffect(() => {
    fetchCacheSize();
  }, []);

  const handleClearCache = async (category: 'covers' | 'music' | 'audiobooks' | 'apks', label: string) => {
    Alert.alert("清除缓存", `确定要清除${label}缓存吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "确定",
        onPress: async () => {
          await clearSpecificCache(category);
          await fetchCacheSize();
          Alert.alert("已清除", `${label}缓存已清空`);
        },
      },
    ]);
  };

  const renderCacheRow = (label: string, size: string, category: 'covers' | 'music' | 'audiobooks' | 'apks') => (
    <TouchableOpacity
      style={[styles.settingRow, { borderBottomColor: colors.border }]}
      onPress={() => handleClearCache(category, label)}
    >
      <View style={styles.settingInfo}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>
          {label} ({size})
        </Text>
        <Text style={[styles.settingDescription, { color: colors.secondary }]}>
          点击清除
        </Text>
      </View>
      <Ionicons name="trash-outline" size={20} color={colors.secondary} />
    </TouchableOpacity>
  );

  const renderSettingRow = (
    label: string,
    description: string,
    value: boolean,
    onValueChange: (val: boolean) => void
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
        trackColor={{ false: "#767577", true: colors.primary }}
        thumbColor={"#f4f3f4"}
      />
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>设置</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>
              账户
            </Text>

            {user?.is_admin && (
              <TouchableOpacity
                style={[
                  styles.settingRow,
                  { borderBottomColor: colors.border },
                ]}
                onPress={() => router.push("/admin")}
              >
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingLabel, { color: colors.text }]}>
                    管理后台
                  </Text>
                  <Text
                    style={[
                      styles.settingDescription,
                      { color: colors.secondary },
                    ]}
                  >
                    用户与系统设置
                  </Text>
                </View>
                <Ionicons
                  name="settings-outline"
                  size={20}
                  color={colors.secondary}
                />
              </TouchableOpacity>
            )}

          <Text style={[styles.sectionTitle, { color: colors.primary, marginTop: 20 }]}>
            关于
          </Text>
          <TouchableOpacity
            style={[styles.settingRow, { borderBottomColor: colors.border }]}
            onPress={() => router.push("/product-updates")}
          >
            <View style={styles.settingInfo}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>
                产品动态
              </Text>
              <Text style={[styles.settingDescription, { color: colors.secondary }]}>
                查看最新功能与版本更新
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
          </TouchableOpacity>

          <Text style={[styles.sectionTitle, { color: colors.primary, marginTop: 20 }]}>
            通用
          </Text>

          {renderSettingRow(
            "跟随系统主题",
            "开启后将根据系统设置自动切换浅色/深色模式",
            autoTheme,
            (val) => updateSetting("autoTheme", val)
          )}

          <View style={{ opacity: autoTheme ? 0.5 : 1 }}>
            {renderSettingRow(
              "深色模式",
              "开启或关闭应用的深色外观",
              theme === "dark",
              autoTheme ? () => {} : toggleTheme
            )}

            {renderSettingRow(
              "春日主题",
              "开启具有新春氛围的红金配色主题",
              theme === "festive",
              autoTheme ? () => {} : (val) => setTheme(val ? "festive" : "light")
            )}
          </View>

          {renderSettingRow(
            "自动横竖屏",
            "开启后应用将跟随手机重力感应自动旋转",
            autoOrientation,
            (val) => updateSetting("autoOrientation", val)
          )}

{sourceType !== "Subsonic" && renderSettingRow(
  "有声书模式",
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
            "边听边存",
            "播放时自动缓存到本地，下次播放优先使用本地文件",
            cacheEnabled,
            (val) => updateSetting("cacheEnabled", val)
          )}

          <Text style={[styles.sectionTitle, { color: colors.primary, marginTop: 20 }]}>
            存储管理
          </Text>
          {renderCacheRow("封面缓存", detailedSizes.covers, "covers")}
          {renderCacheRow("音乐缓存", detailedSizes.music, "music")}
          {renderCacheRow("有声书缓存", detailedSizes.audiobooks, "audiobooks")}
          {renderCacheRow("安装包文件", detailedSizes.apks, "apks")}
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={() => {
              logout();
              router.replace({
                pathname: "/login-form",
                params: { type: sourceType },
              } as any);
            }}
          >
            <Text style={styles.logoutText}>退出登录</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.versionText, { color: colors.secondary }]}>
            AudioDock Mobile v{getLocalVersion()}
          </Text>
        </View>
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
  backButton: {
    padding: 5,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  section: {
    marginTop: 30,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 10,
    opacity: 0.6,
    textTransform: "uppercase",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingInfo: {
    flex: 1,
    marginRight: 20,
  },
  settingLabel: {
    fontSize: 17,
    fontWeight: "500",
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  logoutButton: {
    marginTop: 20,
    backgroundColor: "#FF3B30",
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
  },
  logoutText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  footer: {
    marginTop: 50,
    alignItems: "center",
  },
  versionText: {
    fontSize: 12,
  },
});
