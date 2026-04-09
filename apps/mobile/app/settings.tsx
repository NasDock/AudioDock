import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Slider } from "@miblanchard/react-native-slider";
import { plusDeleteMe, plusParticipateInternalTest } from "@soundx/services";
import { useRouter } from "expo-router";
import React from "react";
import {
  Alert,
  Modal,
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
import { syncWidgetMembership } from "../src/native/WidgetBridge";
import {
  clearSpecificCache,
  getDetailedCacheSize,
} from "../src/services/cache";
import { trackEvent } from "../src/services/tracking";
import { usePlayMode } from "../src/utils/playMode";
import { getLocalVersion } from "../src/utils/updateUtils";
import { getCachedVipStatus } from "../src/utils/vipStatus";

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, theme, toggleTheme, setTheme } = useTheme();
  const { mode, setMode } = usePlayMode();
  const { logout, user, sourceType, device, plusToken, setPlusToken } = useAuth();
  const {
    acceptRelay,
    acceptSync,
    cacheEnabled,
    autoOrientation,
    autoTheme,
    carLayoutMode,
    voiceAssistantEnabled,
    recommendationLikeRatio,
    carModeEnabled,
    screenBottomInset,
    experienceProgramEnabled,
    updateSetting,
  } = useSettings();
  const [isVip, setIsVip] = React.useState(false);
  const [screenInsetModalVisible, setScreenInsetModalVisible] =
    React.useState(false);
  const [redeemingInternalTestCode, setRedeemingInternalTestCode] =
    React.useState(false);
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
    if (size < 1024 * 1024 * 1024)
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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
    checkVipStatus();
  }, []);

  const checkVipStatus = async () => {
    const cached = await getCachedVipStatus();
    setIsVip(cached.isVip);
  };

  const handleClearCache = async (
    category: "covers" | "music" | "audiobooks" | "apks",
    label: string,
  ) => {
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

  const renderCacheRow = (
    label: string,
    size: string,
    category: "covers" | "music" | "audiobooks" | "apks",
  ) => (
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
    onValueChange: (val: boolean) => void,
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

  const renderActionRow = (
    label: string,
    description: string,
    onPress: () => void,
    valueText?: string,
  ) => (
    <TouchableOpacity
      style={[styles.settingRow, { borderBottomColor: colors.border }]}
      onPress={onPress}
    >
      <View style={styles.settingInfo}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>
          {label}
        </Text>
        <Text style={[styles.settingDescription, { color: colors.secondary }]}>
          {description}
        </Text>
      </View>
      <View style={styles.settingAction}>
        {valueText ? (
          <Text style={[styles.settingValue, { color: colors.secondary }]}>
            {valueText}
          </Text>
        ) : null}
        <Ionicons
          name="chevron-forward"
          size={20}
          color={colors.secondary}
        />
      </View>
    </TouchableOpacity>
  );

  const handleToggleCarMode = async (val: boolean) => {
    if (val && !isVip) {
      Alert.alert("仅限会员使用", "车机模式是会员专属功能，请前往会员页面开启。", [
        { text: "好的" },
        { text: "前往会员页面", onPress: () => router.push("/member-benefits" as any) }
      ]);
      return;
    }
    await updateSetting("carModeEnabled", val);
    await updateSetting("carLayoutMode", val);
    trackEvent({
      feature: "settings",
      eventName: val ? "car_mode_enable" : "car_mode_disable",
      userId: user?.id ? String(user.id) : undefined,
      deviceId: device?.id ? String(device.id) : undefined,
    });
    if (val) {
      router.replace("/(tabs)");
    }
  };

  const handleToggleVoiceAssistant = async (val: boolean) => {
    if (val && !isVip) {
      Alert.alert("仅限会员使用", "语音助手是会员专属功能，请前往会员页面开启。", [
        { text: "好的" },
        { text: "前往会员页面", onPress: () => router.push("/member-benefits" as any) }
      ]);
      return;
    }
    await updateSetting("voiceAssistantEnabled", val);
    trackEvent({
      feature: "voice",
      eventName: val ? "voice_assistant_enable" : "voice_assistant_disable",
      userId: user?.id ? String(user.id) : undefined,
      deviceId: device?.id ? String(device.id) : undefined,
    });
  };

  const carModeActive = carLayoutMode || carModeEnabled;

  const handleRedeemInternalTestCode = async () => {
    if (isVip) {
      Alert.alert("已拥有内测权益", "当前账号已拥有内测权益，无需重复申请。");
      return;
    }

    const plusUserId = await AsyncStorage.getItem("plus_user_id");
    if (!plusUserId) {
      Alert.alert("无法提交", "请先登录会员账号后再参与内测。");
      return;
    }

    try {
      setRedeemingInternalTestCode(true);
      trackEvent({
        feature: "member",
        eventName: "internal_test_participate_submit",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
      });
      const vipStartsAt = new Date();
      const vipEndsAt = new Date(vipStartsAt);
      vipEndsAt.setMonth(vipEndsAt.getMonth() + 1);
      const res = await plusParticipateInternalTest({
        vipStartsAt: vipStartsAt.toISOString(),
        vipEndsAt: vipEndsAt.toISOString(),
      });
      const payload = res.data?.data;

      if (res.data?.code !== 200 || !payload?.ok) {
        throw new Error(res.data?.message || "参与内测失败");
      }

      await AsyncStorage.setItem("plus_vip_status", "true");
      await AsyncStorage.setItem(
        "plus_vip_data",
        JSON.stringify({
          ...payload,
          vipExpiresAt: payload.vipEndsAt,
        }),
      );
      await AsyncStorage.setItem("plus_vip_updated_at", Date.now().toString());
      await syncWidgetMembership(true);
      setIsVip(true);
      trackEvent({
        feature: "member",
        eventName: "internal_test_participate_success",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
      });
      Alert.alert("申请成功", "已为当前账号开通内测权益。");
    } catch (error) {
      console.error("Failed to redeem internal test code:", error);
      trackEvent({
        feature: "member",
        eventName: "internal_test_participate_failed",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
        metadata: {
          message: error instanceof Error ? error.message : "unknown_error",
        },
      });
      Alert.alert(
        "申请失败",
        error instanceof Error ? error.message : "请稍后重试",
      );
    } finally {
      setRedeemingInternalTestCode(false);
    }
  };

  const handleDeleteMemberAccount = () => {
    if (!plusToken) {
      Alert.alert("提示", "请先登录会员账号。");
      router.replace("/member-login");
      return;
    }

    Alert.alert(
      "注销会员账号",
      "确认注销吗？注销之后您的所有数据将会被清空！",
      [
        { text: "取消", style: "cancel" },
        {
          text: "确认",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await plusDeleteMe();
              if (res.data?.code !== 200 || !res.data?.data?.ok) {
                throw new Error(res.data?.message || "注销会员账号失败");
              }

              await setPlusToken(null);
              await syncWidgetMembership(false);
              setIsVip(false);
              Alert.alert("已注销", "会员账号已注销。");
              router.replace("/member-login");
            } catch (error) {
              console.error("Failed to delete plus member account:", error);
              Alert.alert(
                "注销失败",
                error instanceof Error ? error.message : "请稍后重试",
              );
            }
          },
        },
      ],
    );
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
              style={[styles.settingRow, { borderBottomColor: colors.border }]}
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

          <Text
            style={[
              styles.sectionTitle,
              { color: colors.primary, marginTop: 20 },
            ]}
          >
            通用
          </Text>

          {renderSettingRow(
            "车机模式",
            "左侧播放器，右侧内容区",
            carModeActive,
            handleToggleCarMode,
          )}

          {carModeActive &&
            renderActionRow(
              "调整屏幕边距",
              "调整播放详情页整体距离屏幕底部的位置",
              () => {
                trackEvent({
                  feature: "settings",
                  eventName: "car_mode_screen_inset_open",
                  userId: user?.id ? String(user.id) : undefined,
                  deviceId: device?.id ? String(device.id) : undefined,
                });
                setScreenInsetModalVisible(true);
              },
              `${Math.round(screenBottomInset)}`,
            )}

          {renderSettingRow(
            "跟随系统主题",
            "开启后将根据系统设置自动切换浅色/深色模式",
            autoTheme,
            (val) => updateSetting("autoTheme", val),
          )}

          <View style={{ opacity: autoTheme ? 0.5 : 1 }}>
            {renderSettingRow(
              "深色模式",
              "开启或关闭应用的深色外观",
              theme === "dark",
              autoTheme ? () => {} : toggleTheme,
            )}

            {renderSettingRow(
              "春日主题",
              "开启具有新春氛围的红金配色主题",
              theme === "festive",
              autoTheme
                ? () => {}
                : (val) => setTheme(val ? "festive" : "light"),
            )}
          </View>

          {renderSettingRow(
            "自动横竖屏",
            "开启后应用将跟随手机重力感应自动旋转",
            autoOrientation,
            (val) => updateSetting("autoOrientation", val),
          )}

          {renderSettingRow(
            "语音助手",
            "开启后显示全局语音助手小松鼠",
            voiceAssistantEnabled,
            (val) => handleToggleVoiceAssistant(val),
          )}

          <View
            style={[styles.settingRow, { borderBottomColor: colors.border }]}
          >
            <View style={styles.settingInfo}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>
                推荐偏好（喜欢/新鲜）
              </Text>
              <Text
                style={[styles.settingDescription, { color: colors.secondary }]}
              >
                喜欢 {recommendationLikeRatio}% · 新鲜{" "}
                {100 - recommendationLikeRatio}%
              </Text>
              <Slider
                minimumValue={0}
                maximumValue={100}
                step={5}
                value={[recommendationLikeRatio]}
                onValueChange={(val) =>
                  void updateSetting(
                    "recommendationLikeRatio",
                    Math.round(val[0] || 0),
                  )
                }
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.border}
                thumbTintColor={colors.primary}
                containerStyle={styles.ratioSlider}
              />
            </View>
          </View>

          {sourceType !== "Subsonic" &&
            renderSettingRow(
              "有声书模式",
              "切换音乐与有声书的显示内容",
              mode === "AUDIOBOOK",
              (val) => setMode(val ? "AUDIOBOOK" : "MUSIC"),
            )}

          {renderSettingRow(
            "接力播放",
            "是否接受多设备之间播放接力",
            acceptRelay,
            (val) => updateSetting("acceptRelay", val),
          )}

          {renderSettingRow(
            "同步控制",
            "是否接受同数据源下其他用户的同步控制请求",
            acceptSync,
            (val) => updateSetting("acceptSync", val),
          )}

          {renderSettingRow(
            "边听边存",
            "播放时自动缓存到本地，下次播放优先使用本地文件",
            cacheEnabled,
            (val) => updateSetting("cacheEnabled", val),
          )}

          <Text
            style={[
              styles.sectionTitle,
              { color: colors.primary, marginTop: 20 },
            ]}
          >
            存储管理
          </Text>
          {renderCacheRow("封面缓存", detailedSizes.covers, "covers")}
          {renderCacheRow("音乐缓存", detailedSizes.music, "music")}
          {renderCacheRow("有声书缓存", detailedSizes.audiobooks, "audiobooks")}
          {renderCacheRow("安装包文件", detailedSizes.apks, "apks")}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.primary }]}>
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
              <Text
                style={[styles.settingDescription, { color: colors.secondary }]}
              >
                查看最新功能与版本更新
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={colors.secondary}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.settingRow, { borderBottomColor: colors.border }]}
            disabled={redeemingInternalTestCode}
            onPress={() => void handleRedeemInternalTestCode()}
          >
            <View style={styles.settingInfo}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>
                参与内测
              </Text>
              <Text
                style={[styles.settingDescription, { color: colors.secondary }]}
              >
                {isVip
                  ? "已拥有内测权益，无需重复申请"
                  : redeemingInternalTestCode
                    ? "正在为当前账号申请内测权益"
                    : "一键申请并自动开通当前账号内测权益"}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={colors.secondary}
            />
          </TouchableOpacity>

          {renderSettingRow(
            "参与用户体验计划",
            "使用数据以改进产品",
            experienceProgramEnabled,
            (val) => updateSetting("experienceProgramEnabled", val),
          )}
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

          <TouchableOpacity
            style={styles.deleteMemberButton}
            onPress={handleDeleteMemberAccount}
          >
            <Text style={styles.deleteMemberText}>注销会员账号</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.versionText, { color: colors.secondary }]}>
            AudioDock Mobile v{getLocalVersion()}
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={screenInsetModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setScreenInsetModalVisible(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.modalOverlay}
          onPress={() => setScreenInsetModalVisible(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[
              styles.modalContent,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              调整屏幕边距
            </Text>
            <Text style={[styles.modalDescription, { color: colors.secondary }]}>
              调整播放详情页整体距离屏幕底部的位置
            </Text>

            <View
              style={[
                styles.sliderPanel,
                { backgroundColor: "rgba(150, 150, 150, 0.08)" },
              ]}
            >
              <View style={styles.sliderHeader}>
                <Text style={[styles.sliderLabel, { color: colors.text }]}>
                  底部边距
                </Text>
                <Text style={[styles.sliderNumber, { color: colors.primary }]}>
                  {Math.round(screenBottomInset)}
                </Text>
              </View>
              <Slider
                minimumValue={0}
                maximumValue={160}
                step={1}
                value={[screenBottomInset]}
                onValueChange={(val) =>
                  void updateSetting(
                    "screenBottomInset",
                    Math.round(val[0] || 0),
                  )
                }
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.border}
                thumbTintColor={colors.primary}
              />
              <View style={styles.sliderHintRow}>
                <Text style={[styles.sliderHint, { color: colors.secondary }]}>
                  更贴近底部
                </Text>
                <Text style={[styles.sliderHint, { color: colors.secondary }]}>
                  整页上移
                </Text>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.modalCancelButton,
                  { borderColor: colors.border },
                ]}
                onPress={() => void updateSetting("screenBottomInset", 0)}
              >
                <Text style={[styles.modalCancelText, { color: colors.text }]}>
                  重置
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.modalConfirmButton,
                  { backgroundColor: colors.primary },
                ]}
                onPress={() => setScreenInsetModalVisible(false)}
              >
                <Text style={styles.modalConfirmText}>完成</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

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
  settingAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
  settingValue: {
    fontSize: 14,
    fontWeight: "600",
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
  deleteMemberButton: {
    marginTop: 12,
    backgroundColor: "#FFF1F0",
    borderWidth: 1,
    borderColor: "#FFCCC7",
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
  },
  deleteMemberText: {
    color: "#CF1322",
    fontSize: 17,
    fontWeight: "600",
  },
  footer: {
    marginTop: 50,
    alignItems: "center",
  },
  ratioSlider: {
    width: "100%",
    height: 28,
    marginTop: 8,
    marginBottom: -4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  modalContent: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  modalDescription: {
    fontSize: 14,
    marginTop: 8,
    marginBottom: 16,
  },
  sliderPanel: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 18,
  },
  sliderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sliderLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  sliderNumber: {
    fontSize: 15,
    fontWeight: "700",
  },
  sliderHintRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  sliderHint: {
    fontSize: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 18,
    gap: 12,
  },
  modalButton: {
    minWidth: 88,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelButton: {
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  modalConfirmButton: {},
  modalCancelText: {
    fontSize: 15,
    fontWeight: "600",
  },
  modalConfirmText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  versionText: {
    fontSize: 12,
  },
});
