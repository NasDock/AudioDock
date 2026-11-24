import { Ionicons } from "@expo/vector-icons";
import { TrackingEvent as TE, TrackingFeature as TF } from "@soundx/services";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { BackHandler, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useSettings } from "../src/context/SettingsContext";
import { useTheme } from "../src/context/ThemeContext";
import type { AudioQuality } from "../src/services/trackQuality";
import { goBackOrReplace } from "../src/utils/navigation";
import { trackEvent } from "../src/services/tracking";

const QUALITY_OPTIONS: Array<{
  value: AudioQuality;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    value: "lossless",
    labelKey: "settings.playbackQualityLossless",
    descriptionKey: "settings.playbackQualityLosslessDescription",
  },
  {
    value: "high",
    labelKey: "settings.playbackQualityHigh",
    descriptionKey: "settings.playbackQualityHighDescription",
  },
  {
    value: "standard",
    labelKey: "settings.playbackQualityLow",
    descriptionKey: "settings.playbackQualityLowDescription",
  },
];

export default function PlaybackQualityScreen() {
  const router = useRouter();
  const { network } = useLocalSearchParams<{ network?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { internalPlaybackQuality, externalPlaybackQuality, updateSetting } =
    useSettings();
  const isInternal = network === "internal";
  const selectedQuality = isInternal
    ? internalPlaybackQuality
    : externalPlaybackQuality;

  const openedRef = React.useRef(false);
  React.useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    trackEvent({ feature: TF.QUALITY, eventName: TE.QUALITY_PAGE_OPEN });
  }, []);

  React.useEffect(() => {
    const backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
      goBackOrReplace(router, "/settings");
      return true;
    });

    return () => backHandler.remove();
  }, [router]);

  const handleSelect = async (quality: AudioQuality) => {
    trackEvent({
      feature: TF.QUALITY,
      eventName: TE.QUALITY_CHANGE,
      metadata: { quality, network },
    });
    await updateSetting(
      isInternal ? "internalPlaybackQuality" : "externalPlaybackQuality",
      quality,
    );
    goBackOrReplace(router, "/settings");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => goBackOrReplace(router, "/settings")}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {isInternal
            ? t("settings.internalPlaybackQuality")
            : t("settings.externalPlaybackQuality")}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.list}>
        {QUALITY_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[styles.item, { borderBottomColor: colors.border }]}
            onPress={() => void handleSelect(option.value)}
          >
            <View style={styles.itemInfo}>
              <Text style={[styles.itemText, { color: colors.text }]}>
                {t(option.labelKey)}
              </Text>
              <Text
                style={[styles.itemDescription, { color: colors.secondary }]}
              >
                {t(option.descriptionKey)}
              </Text>
            </View>
            {selectedQuality === option.value && (
              <Ionicons name="checkmark" size={24} color={colors.primary} />
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 15,
  },
  backButton: { width: 40 },
  headerTitle: { fontSize: 18, fontWeight: "600" },
  list: { marginTop: 10, paddingHorizontal: 20 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemInfo: { flex: 1, marginRight: 16 },
  itemText: { fontSize: 16, fontWeight: "500" },
  itemDescription: { fontSize: 13, lineHeight: 18, marginTop: 4 },
});
