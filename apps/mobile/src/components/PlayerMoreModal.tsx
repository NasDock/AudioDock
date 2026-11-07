import { usePlayer } from "@/src/context/PlayerContext";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/context/ThemeContext";
import { Track, TrackType } from "@/src/models";
import { trackEvent } from "@/src/services/tracking";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Slider } from "@miblanchard/react-native-slider";
import { Router } from "expo-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    Alert,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import { Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isCached } from "../services/cache";
import { downloadTrack } from "../services/downloadManager";
import { usePlayerSkin, type CoverStyle } from "../store/playerSkin";
import { AddToPlaylistModal } from "./AddToPlaylistModal";
import { EqualizerModal } from "./EqualizerModal";
import { FilePathModal } from "./FilePathModal";
import { LyricsFontSizeModal } from "./LyricsFontSizeModal";
import SleepTimerModal from "./SleepTimerModal";

interface PlayerMoreModalProps {
  visible: boolean;
  setVisible: (visible: boolean) => void;
  onClose: () => void;
  currentTrack: Track | null;
  router: Router;
  lyricFontSize: number;
  setLyricFontSize: (size: number) => void;
  controlsBottomOffset: number;
  setControlsBottomOffset: (offset: number) => void;
}

export const PlayerMoreModal: React.FC<PlayerMoreModalProps> = ({
  visible,
  setVisible,
  onClose,
  currentTrack,
  router,
  lyricFontSize,
  setLyricFontSize,
  controlsBottomOffset,
  setControlsBottomOffset,
}) => {
  type PendingModal =
    | { type: "sleepTimer" }
    | { type: "addToPlaylist" }
    | { type: "lyricsSize" }
    | { type: "controlsPosition" }
    | { type: "playerStyle" }
    | { type: "equalizer" }
    | { type: "trackPath" }
    | { type: "skip"; skipType: "intro" | "outro" };

  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, device } = useAuth();

  // ✨ 从 Context 获取全局设置
  const {
    sleepTimer,
    position,
    seekTo,
    playbackRate,
    setPlaybackRate,
    skipIntroDuration,
    setSkipIntroDuration,
    skipOutroDuration,
    setSkipOutroDuration,
  } = usePlayer();

  const [sleepTimerVisible, setSleepTimerVisible] = useState(false);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);
  const [playerStyleVisible, setPlayerStyleVisible] = useState(false);
  // 本地皮肤设置（内置插件层）：播放器样式 默认/黑胶
  const { coverStyle, setCoverStyle } = usePlayerSkin();
  const [remainingTime, setRemainingTime] = useState<string>("");
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [lyricsSizeVisible, setLyricsSizeVisible] = useState(false);
  const [controlsPositionVisible, setControlsPositionVisible] = useState(false);
  const [eqVisible, setEqVisible] = useState(false);
  const [trackPathVisible, setTrackPathVisible] = useState(false);
  const [pendingModal, setPendingModal] = useState<PendingModal | null>(null);

  // 跳过片头/片尾 modal 状态
  const [skipModalVisible, setSkipModalVisible] = useState(false);
  const [skipModalType, setSkipModalType] = useState<"intro" | "outro" | null>(
    null
  );
  // ✨ 临时状态，用于在弹窗中修改，确认后才同步到 Context
  const [tempSkipTime, setTempSkipTime] = useState<number>(0);

  // Calculate remaining time
  useEffect(() => {
    if (!sleepTimer) {
      setRemainingTime("");
      return;
    }

    const updateRemainingTime = () => {
      const now = Date.now();
      const remaining = sleepTimer - now;

      if (remaining <= 0) {
        setRemainingTime("");
        return;
      }

      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      setRemainingTime(`${minutes}:${seconds.toString().padStart(2, "0")}`);
    };

    updateRemainingTime();
    const interval = setInterval(updateRemainingTime, 1000);

    return () => clearInterval(interval);
  }, [sleepTimer]);

  useEffect(() => {
    const checkCacheStatus = async () => {
      if (visible && currentTrack) {
        const cachedPath = await isCached(currentTrack.id, currentTrack.path);
        setIsDownloaded(!!cachedPath);
      }
    };
    checkCacheStatus();
  }, [visible, currentTrack]);

  // 监听主 modal 关闭，打开待处理的二级弹窗
  useEffect(() => {
    if (!visible && pendingModal) {
      const timer = setTimeout(() => {
        openPendingModal();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [visible, pendingModal]);

  const handleArtistDetails = () => {
    setVisible(false);
    if (currentTrack?.artistId && currentTrack?.artist && currentTrack.artist !== "未知") {
      onClose();
      router.push(`/artist/${currentTrack.artistId}`);
    }
  };

  const handleAlbumDetails = () => {
    setVisible(false);
    if (currentTrack?.albumId && currentTrack?.album && currentTrack.album !== "未知") {
      onClose();
      router.push(`/album/${currentTrack.albumId}`);
    }
  };

  const handleSleepTimer = () => {
    setPendingModal({ type: "sleepTimer" });
    setVisible(false);
  };

  const handleDownload = async () => {
    if (!currentTrack || isDownloaded || isDownloading) return;

    setIsDownloading(true);
    try {
      const success = await downloadTrack(currentTrack);
      if (success) {
        setIsDownloaded(true);
        Alert.alert(t('playerMore.downloadComplete'), t('playerMore.trackDownloaded', { trackName: currentTrack.name }));
      } else {
        Alert.alert(t('playerMore.downloadFailedAlert'), t('playerMore.downloadFailedMsg'));
      }
    } catch (error) {
      console.error("Failed to download track", error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSkipBackward = () => {
    seekTo(Math.max(0, position - 15));
    setVisible(false);
  };

  const handleSkipForward = () => {
    seekTo(position + 15);
    setVisible(false);
  };

  const handleTogglePlaybackRate = () => {
    const rates = [0.5, 1, 1.25, 1.5, 2];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setPlaybackRate(nextRate);
  };

  // 时间格式化
  const formatTime = (s: number) => {
    const minutes = Math.floor(s / 60);
    const seconds = s % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  // 调整时间（临时状态）
  const adjustSkipTime = (delta: number) => {
    setTempSkipTime((prev) => {
      const newVal = prev + delta;
      return Math.max(0, newVal); // 不设上限，或者设一个合理上限如 600s
    });
  };

  // 打开弹窗：读取当前全局设置到临时状态
  const openSkipModal = (type: "intro" | "outro") => {
    setPendingModal({ type: "skip", skipType: type });
    setVisible(false);
  };

  const openPendingModal = () => {
    if (!pendingModal) return;

    switch (pendingModal.type) {
      case "sleepTimer":
        setSleepTimerVisible(true);
        break;
      case "addToPlaylist":
        setAddToPlaylistVisible(true);
        break;
      case "lyricsSize":
        setLyricsSizeVisible(true);
        break;
      case "controlsPosition":
        setControlsPositionVisible(true);
        break;
      case "playerStyle":
        setPlayerStyleVisible(true);
        break;
      case "equalizer":
        setEqVisible(true);
        break;
      case "trackPath":
        setTrackPathVisible(true);
        break;
      case "skip": {
        setSkipModalType(pendingModal.skipType);
        const currentVal =
          pendingModal.skipType === "intro"
            ? skipIntroDuration
            : skipOutroDuration;
        setTempSkipTime(currentVal === 0 ? 30 : currentVal);
        setSkipModalVisible(true);
        break;
      }
    }

    setPendingModal(null);
  };

  const cancelSkip = () => {
    setSkipModalVisible(false);
    setSkipModalType(null);
  };

  // 确认：将临时状态保存到 Context
  const confirmSkip = () => {
    if (skipModalType === "intro") {
      setSkipIntroDuration(tempSkipTime);
    } else if (skipModalType === "outro") {
      setSkipOutroDuration(tempSkipTime);
    }
    cancelSkip();
  };

  // 清除/关闭跳过
  const clearSkip = () => {
    if (skipModalType === "intro") {
      setSkipIntroDuration(0);
    } else if (skipModalType === "outro") {
      setSkipOutroDuration(0);
    }
    cancelSkip();
  };

  const standardOptions = [
    {
      icon: "person-outline" as const,
      label: t('playerMore.artistDetails'),
      onPress: handleArtistDetails,
      disabled: !currentTrack?.artistId || !currentTrack?.artist || currentTrack.artist === "未知",
    },
    {
      icon: "albums-outline" as const,
      label: t('playerMore.albumDetails'),
      onPress: handleAlbumDetails,
      disabled: !currentTrack?.albumId || !currentTrack?.album || currentTrack.album === "未知",
    },
    {
      icon: "document-text-outline" as const,
      label: t('playerMore.trackDetails'),
      onPress: () => {
        setPendingModal({ type: "trackPath" });
        setVisible(false);
      },
      disabled: !currentTrack,
    },
    {
      icon: "time-outline" as const,
      label: remainingTime ? `${t('playerMore.sleepTimerWithTime', { time: remainingTime })}` : t('playerMore.sleepTimer'),
      onPress: handleSleepTimer,
      disabled: false,
    },
    {
      icon: "add-circle-outline" as const,
      label: t('playerMore.addToPlaylist'),
      onPress: () => {
        setPendingModal({ type: "addToPlaylist" });
        setVisible(false);
      },
      disabled: !currentTrack,
    },
    {
      icon: "document-text-outline" as const,
      label: t('playerMore.trackDetails'),
      onPress: () => {
        setPendingModal({ type: "trackPath" });
        setVisible(false);
      },
      disabled: !currentTrack,
      hidden: true,
    },
    {
      icon: isDownloaded
        ? ("cloud-done" as const)
        : ("cloud-download-outline" as const),
      label: isDownloading ? t('playerMore.downloading') : isDownloaded ? t('playerMore.downloaded') : t('playerMore.download'),
      onPress: handleDownload,
      disabled: isDownloaded || isDownloading,
    },
    {
      icon: "text-outline" as const,
      label: t('playerMore.adjustLyricsSize'),
      onPress: () => {
        setPendingModal({ type: "lyricsSize" });
        setVisible(false);
      },
      disabled: false,
    },
    {
      icon: "swap-vertical-outline" as const,
      label: t('playerMore.controlPosition'),
      onPress: () => {
        setPendingModal({ type: "controlsPosition" });
        setVisible(false);
      },
      disabled: false,
    },
    {
      icon: "color-palette-outline" as const,
      label: t('playerMore.playerStyle'),
      onPress: () => {
        setPendingModal({ type: "playerStyle" });
        setVisible(false);
      },
      disabled: false,
    },
    {
      icon: "options-outline" as const,
      label: t('playerMore.equalizer'),
      onPress: () => {
        setPendingModal({ type: "equalizer" });
        setVisible(false);
        trackEvent({
          feature: "player",
          eventName: "equalizer_open",
          userId: user?.id ? String(user.id) : undefined,
          deviceId: device?.id ? String(device.id) : undefined,
        });
      },
      disabled: false,
      hidden: Platform.OS !== 'android',
    },
  ];

  const TimePresetChip = ({ seconds }: { seconds: number }) => (
    <TouchableOpacity
      onPress={() => setTempSkipTime(seconds)}
      style={{
        backgroundColor:
          tempSkipTime === seconds ? colors.primary : "rgba(150,150,150,0.1)",
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: tempSkipTime === seconds ? colors.primary : colors.border,
      }}
    >
      <Text
        style={{
          color: tempSkipTime === seconds ? "#FFF" : colors.text,
          fontSize: 12,
          fontWeight: "600",
        }}
      >
        {seconds}s
      </Text>
    </TouchableOpacity>
  );

  const AdjustButton = ({
    amount,
    label,
  }: {
    amount: number;
    label: string;
  }) => (
    <TouchableOpacity
      onPress={() => adjustSkipTime(amount)}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: "rgba(150,150,150,0.1)",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <View style={styles.bottomSheetWrapper}>
            <View
              style={{ width: "100%", maxWidth: 450, alignSelf: "center" }}
            >
              <View
                style={[
                  styles.modalContent,
                  { backgroundColor: colors.card, paddingBottom: insets.bottom },
                ]}
              >
                <View style={styles.handle} />
                <Text style={[styles.title, { color: colors.text }]}>
                  {t('playerMore.moreOptions')}
                </Text>

                {/* Audiobook Controls */}
                {currentTrack?.type === TrackType.AUDIOBOOK && (
                  <View style={styles.audiobookControls}>
                    <TouchableOpacity
                      style={styles.skipButton}
                      onPress={() => openSkipModal("intro")}
                    >
                      <Ionicons
                        name="play-skip-back-outline"
                        size={32}
                        color={
                          skipIntroDuration > 0 ? colors.primary : colors.text
                        }
                      />
                      <Text
                        style={[styles.controlLabel, { color: colors.secondary }]}
                      >
                        {t('playerMore.intro')}
                      </Text>
                      {/* ✨ 实时显示当前设置 */}
                      <Text
                        style={{
                          fontSize: 10,
                          color: colors.primary,
                          marginTop: 2,
                          fontWeight: "bold",
                        }}
                      >
                        {skipIntroDuration > 0 ? `${skipIntroDuration}s` : t('playerMore.turnOff')}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.controlButton}
                      onPress={handleSkipBackward}
                    >
                      <MaterialCommunityIcons
                        name="rewind-15"
                        size={32}
                        color={colors.text}
                      />
                      <Text
                        style={[styles.controlLabel, { color: colors.secondary }]}
                      >
                        {t('playerMore.back15s')}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.controlButton}
                      onPress={handleTogglePlaybackRate}
                    >
                      <Ionicons
                        name="speedometer-outline"
                        size={32}
                        color={colors.text}
                      />
                      <Text
                        style={[styles.controlLabel, { color: colors.secondary }]}
                      >
                        {playbackRate}x
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.controlButton}
                      onPress={handleSkipForward}
                    >
                      <MaterialCommunityIcons
                        name="fast-forward-15"
                        size={32}
                        color={colors.text}
                      />
                      <Text
                        style={[styles.controlLabel, { color: colors.secondary }]}
                      >
                        {t('playerMore.forward15s')}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.skipButton}
                      onPress={() => openSkipModal("outro")}
                    >
                      <Ionicons
                        name="play-skip-forward-outline"
                        size={32}
                        color={
                          skipOutroDuration > 0 ? colors.primary : colors.text
                        }
                      />
                      <Text
                        style={[styles.controlLabel, { color: colors.secondary }]}
                      >
                        {t('playerMore.outro')}
                      </Text>
                      {/* ✨ 实时显示当前设置 */}
                      <Text
                        style={{
                          fontSize: 10,
                          color: colors.primary,
                          marginTop: 2,
                          fontWeight: "bold",
                        }}
                      >
                        {skipOutroDuration > 0 ? `${skipOutroDuration}s` : t('playerMore.turnOff')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {standardOptions
                  .filter(opt => !opt.hidden)
                  .map((option, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.option,
                      { borderBottomColor: colors.border },
                      option.disabled && styles.optionDisabled,
                    ]}
                    onPress={option.onPress}
                    disabled={option.disabled}
                  >
                    <Ionicons
                      name={option.icon as any}
                      size={24}
                      color={option.disabled ? colors.secondary : colors.text}
                    />
                    <Text
                      style={[
                        styles.optionText,
                        {
                          color: option.disabled ? colors.secondary : colors.text,
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={colors.secondary}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* --- 全新设计的跳过片头/片尾弹窗 (全局配置版) --- */}
      <Modal
        visible={skipModalVisible}
        transparent
        animationType="fade"
        onRequestClose={cancelSkip}
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      >
        <Pressable style={styles.backdrop} onPress={cancelSkip}>
          <View style={styles.bottomSheetWrapper}>
            <View
              style={{ width: "100%", maxWidth: 450, alignSelf: "center" }}
            >
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

                <Text
                  style={[
                    styles.title,
                    { color: colors.text, textAlign: "center" },
                  ]}
                >
                  {skipModalType === "intro"
                    ? t('playerMore.setAutoSkipIntro')
                    : t('playerMore.setAutoSkipOutro')}
                </Text>
                <Text
                  style={{
                    textAlign: "center",
                    color: colors.secondary,
                    fontSize: 12,
                    marginBottom: 10,
                  }}
                >
                  {t('playerMore.appliesToAllAudiobooks')}
                </Text>

                {/* 核心时间控制区域 */}
                <View style={{ alignItems: "center", paddingVertical: 10 }}>
                  {/* 大字号时间显示 */}
                  <Text
                    style={{
                      fontSize: 48,
                      fontWeight: "bold",
                      color: colors.primary,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatTime(tempSkipTime)}
                  </Text>

                  {/* 加减控制栏 */}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 16,
                      marginTop: 20,
                    }}
                  >
                    <AdjustButton amount={-10} label="-10" />
                    <AdjustButton amount={-1} label="-1" />

                    <View
                      style={{
                        width: 1,
                        height: 20,
                        backgroundColor: colors.border,
                      }}
                    />

                    <AdjustButton amount={1} label="+1" />
                    <AdjustButton amount={10} label="+10" />
                  </View>

                  {/* 常用预设快捷键 */}
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 24 }}>
                    <TimePresetChip seconds={30} />
                    <TimePresetChip seconds={60} />
                    <TimePresetChip seconds={90} />
                    <TimePresetChip seconds={120} />
                  </View>
                </View>

                {/* 底部操作按钮 */}
                <View
                  style={{
                    flexDirection: "row",
                    paddingHorizontal: 20,
                    paddingTop: 10,
                    gap: 12,
                  }}
                >
                  <TouchableOpacity
                    onPress={clearSkip} // 改为关闭/重置
                    style={{
                      flex: 1,
                      padding: 14,
                      alignItems: "center",
                      backgroundColor: "rgba(255, 59, 48, 0.1)", // 红色背景
                      borderRadius: 12,
                    }}
                  >
                    <Text style={{ color: "#FF3B30", fontWeight: "600" }}>
                      {t('playerMore.turnOff')}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={confirmSkip}
                    style={{
                      flex: 2,
                      padding: 14,
                      alignItems: "center",
                      backgroundColor: colors.primary,
                      borderRadius: 12,
                    }}
                  >
                    <Text style={{ color: "#FFF", fontWeight: "bold" }}>
                      {t('common.done')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* 播放器样式选择（内置皮肤层，VIP 主题插件优先级更高） */}
      <Modal
        visible={playerStyleVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPlayerStyleVisible(false)}
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      >
        <Pressable
          style={styles.centeredBackdrop}
          onPress={() => setPlayerStyleVisible(false)}
        >
          <View style={styles.centeredModalWrapper}>
            <View
              style={[
                styles.centeredModalContent,
                {
                  backgroundColor: colors.card,
                  paddingHorizontal: 20,
                  paddingBottom: 20,
                },
              ]}
            >
              <Text
                style={[
                  styles.title,
                  { color: colors.text, textAlign: "center" },
                ]}
              >
                {t('playerMore.playerStyle')}
              </Text>
              {(
                [
                  { value: "square" as CoverStyle, label: t('playerMore.styleDefault'), icon: "square-outline" as const },
                  { value: "vinyl" as CoverStyle, label: t('playerMore.styleVinyl'), icon: "disc-outline" as const },
                ]
              ).map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.option,
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => {
                    setCoverStyle(opt.value);
                    setPlayerStyleVisible(false);
                  }}
                >
                  <Ionicons name={opt.icon} size={24} color={colors.text} />
                  <Text style={[styles.optionText, { color: colors.text }]}>
                    {opt.label}
                  </Text>
                  {coverStyle === opt.value && (
                    <Ionicons name="checkmark" size={22} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>

      <SleepTimerModal
        visible={sleepTimerVisible}
        onClose={() => setSleepTimerVisible(false)}
      />

      <AddToPlaylistModal
        visible={addToPlaylistVisible}
        trackId={currentTrack?.id ?? null}
        onClose={() => setAddToPlaylistVisible(false)}
      />

      <LyricsFontSizeModal
        visible={lyricsSizeVisible}
        onClose={() => setLyricsSizeVisible(false)}
        lyricFontSize={lyricFontSize}
        setLyricFontSize={setLyricFontSize}
        previewLyrics={currentTrack?.lyrics || ""}
      />

      <Modal
        visible={controlsPositionVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setControlsPositionVisible(false)}
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      >
        <Pressable style={styles.centeredBackdrop} onPress={() => setControlsPositionVisible(false)}>
          <View style={styles.centeredModalWrapper}>
            <View
              style={[
                styles.centeredModalContent,
                {
                  backgroundColor: colors.card,
                  paddingHorizontal: 20,
                  paddingBottom: 20,
                },
              ]}
            >
              <Text style={[styles.title, { color: colors.text, textAlign: "center" }]}>
                {t('playerMore.controlPosition')}
              </Text>
              <Text
                style={{
                  textAlign: "center",
                  color: colors.secondary,
                  fontSize: 12,
                  marginTop: 4,
                  marginBottom: 20,
                }}
              >
                {t('playerMore.controlPositionDescription') || '调整歌词或封面下方控制组距离底部的位置'}
              </Text>

              <View
                style={{
                  borderRadius: 18,
                  paddingVertical: 18,
                  paddingHorizontal: 16,
                  backgroundColor: "rgba(150,150,150,0.08)",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>
                    {t('playerMore.bottomInset')}
                  </Text>
                  <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "700" }}>
                    {Math.round(controlsBottomOffset)}
                  </Text>
                </View>
                <Slider
                  value={controlsBottomOffset}
                  minimumValue={0}
                  maximumValue={120}
                  step={1}
                  onValueChange={(value) =>
                    setControlsBottomOffset(Array.isArray(value) ? value[0] : value)
                  }
                  minimumTrackTintColor={colors.primary}
                  maximumTrackTintColor={colors.border}
                  thumbTintColor={colors.primary}
                />
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginTop: 4,
                  }}
                >
                  <Text style={{ color: colors.secondary, fontSize: 12 }}>{t('playerMore.moveDown')}</Text>
                  <Text style={{ color: colors.secondary, fontSize: 12 }}>{t('playerMore.moveUp')}</Text>
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
                <TouchableOpacity
                  onPress={() => setControlsBottomOffset(0)}
                  style={{
                    flex: 1,
                    paddingVertical: 14,
                    borderRadius: 12,
                    alignItems: "center",
                    backgroundColor: "rgba(150,150,150,0.12)",
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: "600" }}>{t('equalizer.reset')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setControlsPositionVisible(false)}
                  style={{
                    flex: 1,
                    paddingVertical: 14,
                    borderRadius: 12,
                    alignItems: "center",
                    backgroundColor: colors.primary,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>{t('equalizer.done')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Pressable>
      </Modal>

      <EqualizerModal
        visible={Platform.OS === 'android' && eqVisible}
        onClose={() => setEqVisible(false)}
      />

      <FilePathModal
        visible={trackPathVisible}
        title={currentTrack ? `${t('playerMore.trackDetails')} · ${currentTrack.name}` : t('playerMore.trackDetails')}
        path={currentTrack?.path}
        onClose={() => setTrackPathVisible(false)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  bottomSheetWrapper: {
    justifyContent: "flex-end",
    alignItems: "center",
  },
  centeredBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    width: "100%",
  },
  centeredModalWrapper: {
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    width: "100%",
  },
  centeredModalContent: {
    borderRadius: 20,
    paddingTop: 20,
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
  title: {
    fontSize: 18,
    fontWeight: "600",
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 0.5,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  optionText: {
    fontSize: 16,
    flex: 1,
    marginLeft: 16,
  },
  audiobookControls: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "flex-start",
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(150,150,150,0.2)",
    marginBottom: 8,
  },
  controlButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  controlLabel: {
    fontSize: 12,
    marginTop: 8,
  },
  skipButton: {
    alignItems: "center",
    justifyContent: "center",
  },
});
