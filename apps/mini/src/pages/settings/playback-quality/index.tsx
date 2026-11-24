import { TrackingEvent as TE, TrackingFeature as TF } from "@soundx/services";
import { Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../context/SettingsContext";
import { useTheme } from "../../../context/ThemeContext";
import type { AudioQuality } from "../../../services/trackQuality";
import { trackEvent } from "../../../utils/tracking";
import "./index.scss";

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

export default function PlaybackQualitySettings() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { externalPlaybackQuality, updateSetting } = useSettings();
  const qualityPageOpenedRef = useRef(false);

  useLoad(() => {
    if (!qualityPageOpenedRef.current) {
      qualityPageOpenedRef.current = true;
      void trackEvent({ feature: TF.QUALITY, eventName: TE.QUALITY_PAGE_OPEN });
    }
    Taro.setNavigationBarTitle({
      title: t("settings.externalPlaybackQuality"),
    });
    Taro.setNavigationBarColor({
      frontColor: colors.text === "#11181C" ? "#000000" : "#ffffff",
      backgroundColor: colors.background,
    });
  });

  const handleSelect = async (quality: AudioQuality) => {
    void trackEvent({
      feature: TF.QUALITY,
      eventName: TE.QUALITY_CHANGE,
      metadata: { quality },
    });
    await updateSetting("externalPlaybackQuality", quality);
    Taro.navigateBack();
  };

  return (
    <View
      className="playback-quality-settings"
      style={{ backgroundColor: colors.background }}
    >
      <View className="header" style={{ backgroundColor: colors.background }}>
        <View className="back-btn" onClick={() => Taro.navigateBack()}>
          <Text
            className="back-icon icon icon-back"
            style={{ color: colors.text }}
          />
        </View>
        <Text className="header-title" style={{ color: colors.text }}>
          {t("settings.externalPlaybackQuality")}
        </Text>
        <View style={{ width: "80rpx" }} />
      </View>

      <View className="list">
        {QUALITY_OPTIONS.map((option) => (
          <View
            key={option.value}
            className="item"
            style={{ borderBottomColor: colors.border }}
            onClick={() => void handleSelect(option.value)}
          >
            <View className="item-info">
              <Text className="item-text" style={{ color: colors.text }}>
                {t(option.labelKey)}
              </Text>
              <Text
                className="item-description"
                style={{ color: colors.secondary }}
              >
                {t(option.descriptionKey)}
              </Text>
            </View>
            {externalPlaybackQuality === option.value && (
              <Text className="checkmark" style={{ color: colors.primary }}>
                ✓
              </Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
