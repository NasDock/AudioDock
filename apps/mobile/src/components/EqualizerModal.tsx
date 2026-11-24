import { useTheme } from "@/src/context/ThemeContext";
import { Slider } from "@miblanchard/react-native-slider";
import { TrackingEvent as TE, TrackingFeature as TF } from "@soundx/services";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import * as AudioEq from "../../modules/audio-eq";
import { useSettings } from "../context/SettingsContext";
import { trackEvent } from "../services/tracking";

const BAND_KEYS = [
  { index: 0, label: "60Hz", key: "equalizer.subBass" },
  { index: 1, label: "230Hz", key: "equalizer.bass" },
  { index: 2, label: "910Hz", key: "equalizer.mid" },
  { index: 3, label: "4kHz", key: "equalizer.treble" },
  { index: 4, label: "14kHz", key: "equalizer.subTreble" },
];

const BandSlider = React.memo(({ 
  index, label, nameKey, value: initialValue, onGainChange, onSlidingComplete, colors, t 
}: any) => {
  const [localValue, setLocalValue] = useState(initialValue);

  // 当外部值变化（如点击重置）时同步本地状态
  useEffect(() => {
    setLocalValue(initialValue);
  }, [initialValue]);

  const handleValueChange = (val: number | number[]) => {
    const v = Array.isArray(val) ? val[0] : val;
    setLocalValue(v); // UI 立即响应
    onGainChange(index, v); // 声音立即响应
  };

  const handleSlidingComplete = (val: number | number[]) => {
    const v = Array.isArray(val) ? val[0] : val;
    onSlidingComplete(index, v); // 持久化保存
  };

  return (
    <View style={styles.bandColumn}>
      <Text style={[styles.dbText, { color: colors.text }]}>
        {localValue}dB
      </Text>

      <View style={styles.sliderWrapper}>
        <Slider
          containerStyle={styles.slider}
          minimumValue={-10}
          maximumValue={10}
          step={1}
          value={localValue}
          onValueChange={handleValueChange}
          onSlidingComplete={handleSlidingComplete}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.primary}
          trackStyle={{ height: 6, borderRadius: 3 }} // 横向时它是 height
          thumbStyle={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: colors.background,
            borderWidth: 1,
            borderColor: colors.border,
            elevation: 5,
            shadowColor: colors.text,
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.3,
            shadowRadius: 4,
          }}
        />
      </View>

      <Text style={[styles.freqLabel, { color: colors.secondary }]}>
        {label}
      </Text>
      <Text style={[styles.bandName, { color: colors.secondary }]}>
        {t(nameKey)}
      </Text>
    </View>
  );
});

BandSlider.displayName = "BandSlider";

interface EqualizerModalProps {
  visible: boolean;
  onClose: () => void;
}

export const EqualizerModal: React.FC<EqualizerModalProps> = ({
  visible,
  onClose,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { eqGains, updateSetting } = useSettings();

  const [gains, setGains] = useState<number[]>(eqGains || [0, 0, 0, 0, 0]);

  useEffect(() => {
    if (eqGains) {
      setGains(eqGains);
      // 如果 EQ 已经初始化，这里也要同步最新的增益（以防异步加载延迟）
      eqGains.forEach((gain, index) => {
        AudioEq.setGain(index, gain);
      });
    }
  }, [eqGains]);

  useEffect(() => {
    if (visible) {
      const success = AudioEq.discoverAndInit();
      if (success) {
        applyCurrentGains();
      }
    }
  }, [visible]);

  const applyCurrentGains = () => {
    const currentGains = eqGains || gains;
    currentGains.forEach((gain, index) => {
      AudioEq.setGain(index, gain);
    });
  };

  const handleGainChange = (bandIndex: number, value: number) => {
    // 这里不再频繁调用 setGains (交给子组件 localState)，只处理音效。
    // 这能彻底消除主线程阻塞，解决 A 动 B 的漂移问题。
    AudioEq.setGain(bandIndex, value);
  };

  const handleSlidingComplete = (bandIndex: number, value: number) => {
    trackEvent({
      feature: TF.PLAYER,
      eventName: TE.PLAYER_EQUALIZER_CHANGE,
      metadata: { band: bandIndex, value },
    });
    setGains((prev) => {
      const newGains = [...prev];
      newGains[bandIndex] = value;
      updateSetting("eqGains", newGains);
      return newGains;
    });
  };

  const resetEq = () => {
    const defaultGains = [0, 0, 0, 0, 0];
    setGains(defaultGains);
    updateSetting("eqGains", defaultGains);
    
    // 恢复默认音效
    defaultGains.forEach((gain, index) => {
      AudioEq.setGain(index, gain);
    });

    // 彻底释放原生 EQ 实例，这通常能恢复受影响的系统声音
    if (AudioEq.release) {
        console.log("正在释放 EQ 实例以恢复系统声音...");
        AudioEq.release();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={{ width: "100%", maxWidth: 450, alignSelf: "center" }}>
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: colors.card,
                paddingBottom: insets.bottom + 20,
              },
            ]}
          >
            <View style={styles.handle} />

            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.text }]}>
                {t('equalizer.title')}
              </Text>
              <TouchableOpacity onPress={resetEq}>
                <Text style={{ color: colors.primary, fontWeight: "600" }}>
                  {t('equalizer.reset')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.bandsContainer}>
              {BAND_KEYS.map((band) => (
                <BandSlider
                  key={`band-${band.index}`}
                  index={band.index}
                  label={band.label}
                  nameKey={band.key}
                  value={gains[band.index]}
                  onGainChange={handleGainChange}
                  onSlidingComplete={handleSlidingComplete}
                  colors={colors}
                  t={t}
                />
              ))}
            </View>

            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: colors.primary }]}
              onPress={onClose}
            >
              <Text style={[styles.closeButtonText, { color: colors.background }]}>{t('equalizer.done')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    width: "100%",
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(150,150,150,0.3)",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
    marginTop: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 30,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  bandsContainer: {
    flexDirection: "row",
    justifyContent: "space-evenly", // 均匀分布，自动计算间距
    height: 300,
    width: "100%",
    paddingHorizontal: 10,
    marginTop: 10,
  },
  bandColumn: {
    alignItems: "center",
    width: 60,
  },
  sliderWrapper: {
    height: 220, // 视觉高度
    width: 40,   // 视觉宽度
    justifyContent: "center",
    alignItems: "center",
  },
  slider: {
    width: 220, // 物理长度（被旋转成为视觉高度）
    height: 40, // 物理触控宽度
    transform: [{ rotate: "-90deg" }], // 暴力旋转修正
  },
  dbText: {
    fontSize: 12,
    marginBottom: 10,
    fontWeight: "600",
  },
  freqLabel: {
    fontSize: 12,
    marginTop: 10,
    fontWeight: "500",
  },
  bandName: {
    fontSize: 10,
    marginTop: 2,
  },
  closeButton: {
    marginHorizontal: 24,
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  closeButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
});
