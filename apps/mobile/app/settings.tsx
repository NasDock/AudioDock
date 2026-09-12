import { Ionicons } from "@expo/vector-icons";
import { Slider } from "@miblanchard/react-native-slider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { plusDeleteMe, plusParticipateInternalTest } from "@soundx/services";
import { useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  BackHandler,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Modal from "react-native-modal";
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
import { goBackOrReplace } from "../src/utils/navigation";
import { usePlayMode } from "../src/utils/playMode";
import { getLocalVersion } from "../src/utils/updateUtils";
import { getCachedVipStatus } from "../src/utils/vipStatus";
import { useCheckUpdate } from "../hooks/useCheckUpdate";
import { UpdateModal } from "../src/components/UpdateModal";

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    const backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
      goBackOrReplace(router, "/(tabs)/personal");
      return true;
    });

    return () => backHandler.remove();
  }, [router]);
  const { colors, theme, toggleTheme, setTheme } = useTheme();
  const { mode, setMode } = usePlayMode();
  const { logout, user, sourceType, device, plusToken, setPlusToken } =
    useAuth();
  const {
    checking: checkingUpdate,
    updateInfo: manualUpdateInfo,
    opening: manualOpening,
    progress: manualProgress,
    checkUpdate,
    startUpdate,
    ignoreUpdate,
    cancelUpdate,
  } = useCheckUpdate();
  const {
    acceptRelay,
    acceptSync,
    cacheEnabled,
    autoOrientation,
    autoTheme,
    carLayoutMode,
    voiceAssistantEnabled,
    activityNotifyEnabled,
    recommendationLikeRatio,
    carModeEnabled,
    screenBottomInset,
    experienceProgramEnabled,
    internalPlaybackQuality,
    externalPlaybackQuality,
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
  }>({
    covers: "0 B",
    music: "0 B",
    audiobooks: "0 B",
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
    category: "covers" | "music" | "audiobooks",
    label: string,
  ) => {
    Alert.alert(
      t("settings.clearCache"),
      t("settings.confirmClearCache", { label }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.confirm"),
          onPress: async () => {
            await clearSpecificCache(category);
            await fetchCacheSize();
            Alert.alert(
              t("settings.cacheCleared"),
              `${label}${t("settings.cacheCleared")}`,
            );
          },
        },
      ],
    );
  };

  const renderCacheRow = (
    label: string,
    size: string,
    category: "covers" | "music" | "audiobooks",
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
          {t("settings.tapToClear")}
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
        <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
      </View>
    </TouchableOpacity>
  );

  const handleToggleCarMode = async (val: boolean) => {
    if (val) {
      const currentPlusToken = await AsyncStorage.getItem("plus_token");
      if (!currentPlusToken) {
        Alert.alert(t("common.memberFeature"), t("common.loginFirst"), [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("settings.goToMemberPage"), onPress: () => router.push("/member-login" as any) },
        ]);
        return;
      }
      if (!isVip) {
        Alert.alert(t("settings.vipOnly"), t("settings.carModeVipOnly"), [
          { text: t("common.ok") },
          {
            text: t("settings.goToMemberPage"),
            onPress: () => router.push("/member-benefits" as any),
          },
        ]);
        return;
      }
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
    if (val) {
      const currentPlusToken = await AsyncStorage.getItem("plus_token");
      if (!currentPlusToken) {
        Alert.alert(t("common.memberFeature"), t("common.loginFirst"), [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("settings.goToMemberPage"), onPress: () => router.push("/member-login" as any) },
        ]);
        return;
      }
      if (!isVip) {
        Alert.alert(t("settings.vipOnly"), t("settings.voiceAssistantVipOnly"), [
          { text: t("common.ok") },
          {
            text: t("settings.goToMemberPage"),
            onPress: () => router.push("/member-benefits" as any),
          },
        ]);
        return;
      }
    }
    await updateSetting("voiceAssistantEnabled", val);
    trackEvent({
      feature: "voice",
      eventName: val ? "voice_assistant_enable" : "voice_assistant_disable",
      userId: user?.id ? String(user.id) : undefined,
      deviceId: device?.id ? String(device.id) : undefined,
    });
  };


  const getPlaybackQualityLabel = (quality: string) => {
    switch (quality) {
      case "lossless":
        return t("settings.playbackQualityLossless");
      case "high":
        return t("settings.playbackQualityHigh");
      default:
        return t("settings.playbackQualityLow");
    }
  };

  const carModeActive = carLayoutMode || carModeEnabled;

  const handleRedeemInternalTestCode = async () => {
    if (isVip) {
      Alert.alert(
        t("settings.betaTestAlreadyHas"),
        t("settings.betaTestAlreadyHas"),
      );
      return;
    }

    const plusUserId = await AsyncStorage.getItem("plus_user_id");
    if (!plusUserId) {
      Alert.alert(t("settings.loginFirst"), t("settings.loginMemberFirst"));
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
        throw new Error(res.data?.message || t("settings.betaTestFailed"));
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
      Alert.alert(t("settings.betaTestSuccess"), t("settings.betaTestSuccess"));
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
        t("settings.betaTestFailed"),
        error instanceof Error ? error.message : t("settings.betaTestFailed"),
      );
    } finally {
      setRedeemingInternalTestCode(false);
    }
  };

  const handleDeleteMemberAccount = () => {
    if (!plusToken) {
      Alert.alert(t("settings.loginFirst"), t("settings.loginFirst"));
      router.replace("/member-login");
      return;
    }

    Alert.alert(
      t("settings.deleteMemberAccount"),
      t("settings.deleteMemberConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.confirm"),
          style: "destructive",
          onPress: async () => {
            try {
              const res = await plusDeleteMe();
              if (res.data?.code !== 200 || !res.data?.data?.ok) {
                throw new Error(
                  res.data?.message || t("settings.deleteMemberFailed"),
                );
              }

              await setPlusToken(null);
              await syncWidgetMembership(false);
              setIsVip(false);
              Alert.alert(
                t("settings.deleteMemberSuccess"),
                t("settings.deleteMemberSuccess"),
              );
              router.replace("/member-login");
            } catch (error) {
              console.error("Failed to delete plus member account:", error);
              Alert.alert(
                t("settings.deleteMemberFailed"),
                error instanceof Error
                  ? error.message
                  : t("settings.deleteMemberFailed"),
              );
            }
          },
        },
      ],
    );
  };

  const handleCheckUpdate = async () => {
    if (checkingUpdate) return;
    const info = await checkUpdate();
    if (!info) {
      Alert.alert(t("update.upToDate"));
    }
    // 有新版本 → 由本页底部挂载的 UpdateModal 弹出（本页 useCheckUpdate 实例）
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => goBackOrReplace(router, "/(tabs)/personal")}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t("settings.title")}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.primary }]}>
            {t("settings.server")}
          </Text>

          {user?.is_admin && (
            <TouchableOpacity
              style={[styles.settingRow, { borderBottomColor: colors.border }]}
              onPress={() => router.push("/admin")}
            >
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>
                  {t("settings.admin")}
                </Text>
                <Text
                  style={[
                    styles.settingDescription,
                    { color: colors.secondary },
                  ]}
                >
                  {t("settings.adminDescription")}
                </Text>
              </View>
              <Ionicons
                name="settings-outline"
                size={20}
                color={colors.secondary}
              />
            </TouchableOpacity>
          )}

          {user?.is_admin && (
            <TouchableOpacity
              style={[styles.settingRow, { borderBottomColor: colors.border }]}
              onPress={() => router.push("/webdav-sources" as any)}
            >
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>
                  {t("settings.webdavSources")}
                </Text>
                <Text
                  style={[
                    styles.settingDescription,
                    { color: colors.secondary },
                  ]}
                >
                  {t("settings.sourceManagementDescription")}
                </Text>
              </View>
              <Ionicons
                name="cloud-outline"
                size={20}
                color={colors.secondary}
              />
            </TouchableOpacity>
          )}

          {user?.is_admin && (
            <TouchableOpacity
              style={[styles.settingRow, { borderBottomColor: colors.border }]}
              onPress={() => router.push("/llm-config" as any)}
            >
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>
                  {t("settings.llmConfig")}
                </Text>
                <Text
                  style={[
                    styles.settingDescription,
                    { color: colors.secondary },
                  ]}
                >
                  {t("settings.llmConfigDescription")}
                </Text>
              </View>
              <Ionicons
                name="hardware-chip-outline"
                size={20}
                color={colors.secondary}
              />
            </TouchableOpacity>
          )}

          {user?.is_admin && (
            <TouchableOpacity
              style={[styles.settingRow, { borderBottomColor: colors.border }]}
              onPress={() => router.push("/tts-config" as any)}
            >
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>
                  {t("settings.ttsConfig")}
                </Text>
                <Text
                  style={[
                    styles.settingDescription,
                    { color: colors.secondary },
                  ]}
                >
                  {t("settings.ttsConfigDescription")}
                </Text>
              </View>
              <Ionicons
                name="mic-outline"
                size={20}
                color={colors.secondary}
              />
            </TouchableOpacity>
          )}

          {user?.is_admin && (
            <TouchableOpacity
              style={[styles.settingRow, { borderBottomColor: colors.border }]}
              onPress={() => router.push("/plugin-center" as any)}
            >
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>
                  {t("settings.pluginCenter")}
                </Text>
                <Text
                  style={[
                    styles.settingDescription,
                    { color: colors.secondary },
                  ]}
                >
                  {t("settings.pluginCenterDescription")}
                </Text>
              </View>
              <Ionicons
                name="extension-puzzle-outline"
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
            {t("settings.general")}
          </Text>

          <TouchableOpacity
            style={[styles.settingRow, { borderBottomColor: colors.border }]}
            onPress={() => router.push("/language" as any)}
          >
            <View style={styles.settingInfo}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>
                {t("settings.language", "语言")}
              </Text>
              <Text
                style={[styles.settingDescription, { color: colors.secondary }]}
              >
                {t("settings.languageDescription", "选择应用显示语言")}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={colors.secondary}
            />
          </TouchableOpacity>

          {renderActionRow(
            t("settings.internalPlaybackQuality"),
            t("settings.internalPlaybackQualityDescription"),
            () => router.push({ pathname: "/playback-quality", params: { network: "internal" } } as any),
            getPlaybackQualityLabel(internalPlaybackQuality),
          )}

          {renderActionRow(
            t("settings.externalPlaybackQuality"),
            t("settings.externalPlaybackQualityDescription"),
            () => router.push({ pathname: "/playback-quality", params: { network: "external" } } as any),
            getPlaybackQualityLabel(externalPlaybackQuality),
          )}

          {renderSettingRow(
            t("settings.carMode"),
            t("settings.carModeDescription"),
            carModeActive,
            handleToggleCarMode,
          )}

          {carModeActive &&
            renderActionRow(
              t("settings.screenInset"),
              t("settings.screenInsetDescription"),
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
            t("settings.autoTheme"),
            t("settings.autoThemeDescription"),
            autoTheme,
            (val) => updateSetting("autoTheme", val),
          )}

          <View style={{ opacity: autoTheme ? 0.5 : 1 }}>
            {renderSettingRow(
              t("settings.darkMode"),
              t("settings.darkModeDescription"),
              theme === "dark",
              autoTheme ? () => {} : toggleTheme,
            )}

            {renderSettingRow(
              t("settings.festiveTheme"),
              t("settings.festiveThemeDescription"),
              theme === "festive",
              autoTheme
                ? () => {}
                : (val) => setTheme(val ? "festive" : "light"),
            )}
          </View>

          {renderSettingRow(
            t("settings.autoOrientation"),
            t("settings.autoOrientationDescription"),
            autoOrientation,
            (val) => updateSetting("autoOrientation", val),
          )}

          {renderSettingRow(
            t("settings.voiceAssistant"),
            t("settings.voiceAssistantDescription"),
            voiceAssistantEnabled,
            (val) => handleToggleVoiceAssistant(val),
          )}

          {renderSettingRow(
            t("settings.activityNotify"),
            t("settings.activityNotifyDescription"),
            activityNotifyEnabled,
            (val) => updateSetting("activityNotifyEnabled", val),
          )}

          <View
            style={[styles.settingRow, { borderBottomColor: colors.border }]}
          >
            <View style={styles.settingInfo}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>
                {t("settings.recommendationPreference")}
              </Text>
              <Text
                style={[styles.settingDescription, { color: colors.secondary }]}
              >
                {t("settings.like")} {recommendationLikeRatio}% ·{" "}
                {t("settings.fresh")} {100 - recommendationLikeRatio}%
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
              t("settings.audiobookMode"),
              t("settings.audiobookModeDescription"),
              mode === "AUDIOBOOK",
              (val) => setMode(val ? "AUDIOBOOK" : "MUSIC"),
            )}

          {renderSettingRow(
            t("settings.relayPlay"),
            t("settings.relayPlayDescription"),
            acceptRelay,
            (val) => updateSetting("acceptRelay", val),
          )}

          {renderSettingRow(
            t("settings.syncControl"),
            t("settings.syncControlDescription"),
            acceptSync,
            (val) => updateSetting("acceptSync", val),
          )}

          {renderSettingRow(
            t("settings.cacheWhilePlaying"),
            t("settings.cacheWhilePlayingDescription"),
            cacheEnabled,
            (val) => updateSetting("cacheEnabled", val),
          )}

          <Text
            style={[
              styles.sectionTitle,
              { color: colors.primary, marginTop: 20 },
            ]}
          >
            {t("settings.storage")}
          </Text>
          {renderCacheRow(
            t("settings.coverCache"),
            detailedSizes.covers,
            "covers",
          )}
          {renderCacheRow(
            t("settings.musicCache"),
            detailedSizes.music,
            "music",
          )}
          {renderCacheRow(
            t("settings.audiobookCache"),
            detailedSizes.audiobooks,
            "audiobooks",
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.primary }]}>
            {t("settings.about")}
          </Text>
          <TouchableOpacity
            style={[styles.settingRow, { borderBottomColor: colors.border }]}
            onPress={() => router.push("/product-updates")}
          >
            <View style={styles.settingInfo}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>
                {t("settings.productUpdates")}
              </Text>
              <Text
                style={[styles.settingDescription, { color: colors.secondary }]}
              >
                {t("settings.productUpdatesDescription")}
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
            disabled={checkingUpdate}
            onPress={() => void handleCheckUpdate()}
          >
            <View style={styles.settingInfo}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>
                {checkingUpdate ? t("update.checking") : t("update.checkUpdate")}
              </Text>
              <Text
                style={[styles.settingDescription, { color: colors.secondary }]}
              >
                {t("update.checkUpdateDescription")}
              </Text>
            </View>
            <Ionicons
              name={checkingUpdate ? "sync" : "chevron-forward"}
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
                {t("settings.joinBetaTest")}
              </Text>
              <Text
                style={[styles.settingDescription, { color: colors.secondary }]}
              >
                {isVip
                  ? t("settings.betaTestAlreadyHas")
                  : redeemingInternalTestCode
                    ? t("settings.betaTestApplying")
                    : t("settings.betaTestDescription")}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={colors.secondary}
            />
          </TouchableOpacity>

          {renderSettingRow(
            t("settings.experienceProgram"),
            t("settings.experienceProgramDescription"),
            experienceProgramEnabled,
            (val) => updateSetting("experienceProgramEnabled", val),
          )}

          {renderActionRow(
            t("settings.userAgreement"),
            t("settings.userAgreementDescription"),
            () => {
              trackEvent({
                feature: "settings",
                eventName: "user_agreement_open",
                userId: user?.id ? String(user.id) : undefined,
                deviceId: device?.id ? String(device.id) : undefined,
              });
              Linking.openURL("https://www.audiodock.cn/docs/user-agreement/").catch((err) =>
                console.warn("Failed to open user agreement", err),
              );
            },
          )}

          {renderActionRow(
            t("settings.privacyPolicy"),
            t("settings.privacyPolicyDescription"),
            () => {
              trackEvent({
                feature: "settings",
                eventName: "privacy_policy_open",
                userId: user?.id ? String(user.id) : undefined,
                deviceId: device?.id ? String(device.id) : undefined,
              });
              Linking.openURL("https://www.audiodock.cn/docs/privacy-policy/").catch((err) =>
                console.warn("Failed to open privacy policy", err),
              );
            },
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
            <Text style={styles.logoutText}>{t("settings.logout")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteMemberButton}
            onPress={handleDeleteMemberAccount}
          >
            <Text style={styles.deleteMemberText}>
              {t("settings.deleteMemberAccount")}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.versionText, { color: colors.secondary }]}>
            {`AudioDock Mobile v${getLocalVersion()}`}
          </Text>
        </View>
      </ScrollView>

      <Modal
        isVisible={screenInsetModalVisible}
        onBackdropPress={() => setScreenInsetModalVisible(false)}
        onBackButtonPress={() => setScreenInsetModalVisible(false)}
        useNativeDriver
        hideModalContentWhileAnimating
        animationIn="fadeIn"
        animationOut="fadeOut"
        backdropTransitionOutTiming={0}
        style={styles.centeredModal}
        statusBarTranslucent
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t("settings.screenInset")}
            </Text>
            <Text
              style={[styles.modalDescription, { color: colors.secondary }]}
            >
              {t("settings.screenInsetDescription")}
            </Text>

            <View
              style={[
                styles.sliderPanel,
                { backgroundColor: "rgba(150, 150, 150, 0.08)" },
              ]}
            >
              <View style={styles.sliderHeader}>
                <Text style={[styles.sliderLabel, { color: colors.text }]}>
                  {t("settings.bottomInset")}
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
                  {t("settings.closerToBottom")}
                </Text>
                <Text style={[styles.sliderHint, { color: colors.secondary }]}>
                  {t("settings.pageUp")}
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
                  {t("common.reset")}
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
                <Text style={styles.modalConfirmText}>{t("common.done")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <UpdateModal
        visible={!!manualUpdateInfo}
        updateInfo={manualUpdateInfo}
        opening={manualOpening}
        progress={manualProgress}
        onUpdate={startUpdate}
        onIgnore={ignoreUpdate}
        onClose={cancelUpdate}
      />
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
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    width: "100%",
  },
  centeredModal: {
    margin: 0,
    justifyContent: "center",
    alignItems: "center",
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
