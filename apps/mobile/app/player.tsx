import MarqueeText from "@/src/components/MarqueeText";
import PlayingIndicator from "@/src/components/PlayingIndicator";
import { XiaoAiIcon } from "@/src/components/XiaoAiIcon";
import { useAuth } from "@/src/context/AuthContext";
import { PlayMode, usePlayer } from "@/src/context/PlayerContext";
import { useTheme } from "@/src/context/ThemeContext";
import { Track, TrackType, UserTrackLike } from "@/src/models";
import { getImageUrl } from "@/src/utils/image";
import { getOrCreateDeviceId } from "@/src/utils/platform";
import { trackEvent } from "@/src/services/tracking";
import {
  getMiAuthStatus,
  getMiDevices,
  getMiQRCode,
  getMiQRCodeStatus,
  type Device as OnlineDevice,
  type MiDevice,
  getUserDevices,
  playMiDeviceByUrl,
} from "@soundx/services";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Slider } from "@miblanchard/react-native-slider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getMvByTrackId, plusGetMe, toggleTrackLike, toggleTrackUnLike } from "@soundx/services";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Animated,
  Alert,
  BackHandler,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlayerMoreModal } from "../src/components/PlayerMoreModal";
import { PlaylistModal } from "../src/components/PlaylistModal";
import { FloatingActionButtons } from "../src/components/FloatingActionButtons";
import SyncModal from "../src/components/SyncModal";
import { isCached } from "../src/services/cache";
import { useSettings } from "@/src/context/SettingsContext";

const { width } = Dimensions.get("window");

// Parse LRC format lyrics
interface LyricLine {
  time: number;
  text: string;
}

interface PlayerDetailViewProps {
  embedded?: boolean;
  renderPlaylistModal?: boolean;
}

export const parseLyrics = (lyrics: string): LyricLine[] => {
  if (!lyrics) return [];

  const lines = lyrics.split("\n");
  const parsed: LyricLine[] = [];

  for (const line of lines) {
    const match = line.match(/\[(\d+):(\d+)(?:([\.:])(\d+))?\](.*)/);
    if (match) {
      const part1 = parseInt(match[1]);
      const part2 = parseInt(match[2]);
      const separator = match[3];
      const part3Str = match[4];
      const text = match[5].trim();

      let time = 0;
      if (separator === ":" && part3Str) {
        const hours = part1;
        const minutes = part2;
        const seconds = parseInt(part3Str);
        time = hours * 3600 + minutes * 60 + seconds;
      } else {
        const minutes = part1;
        const seconds = part2;
        const milliseconds = part3Str ? parseInt(part3Str.padEnd(3, "0")) : 0;
        time = minutes * 60 + seconds + milliseconds / 1000;
      }

      if (text) {
        parsed.push({ time, text });
      }
    } else if (line.trim() && !line.startsWith("[")) {
      parsed.push({ time: 0, text: line.trim() });
    }
  }
  return parsed.sort((a, b) => a.time - b.time);
};

const AnimatedLyricLine = ({
  text,
  isActive,
  colors,
  lyricFontSize,
  onLayout,
}: {
  text: string;
  isActive: boolean;
  colors: any;
  lyricFontSize: number;
  onLayout?: (e: any) => void;
}) => {
  const animatedValue = useRef(new Animated.Value(isActive ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(animatedValue, {
      toValue: isActive ? 1 : 0,
      useNativeDriver: false,
      friction: 8,
      tension: 40,
    }).start();
  }, [isActive]);

  const color = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.text, colors.primary],
  });

  const scale = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.1],
  });

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });

  return (
    <Animated.View
      onLayout={onLayout}
      style={{
        transform: [{ scale }],
        opacity,
        marginVertical: 4,
        paddingHorizontal: 20,
        width: "100%",
        alignItems: "center",
      }}
    >
      <Animated.Text
        style={[
          styles.lyricsLine,
          {
            color,
            fontSize: lyricFontSize,
            lineHeight: lyricFontSize * 2,
            fontWeight: isActive ? "800" : "500",
            marginVertical: 0, // Remove margin to avoid extra spacing
          },
        ]}
      >
        {text}
      </Animated.Text>
    </Animated.View>
  );
};

export function PlayerDetailView({
  embedded = false,
  renderPlaylistModal = true,
}: PlayerDetailViewProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { carModeEnabled } = useSettings();
  const top = insets.top;
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const {
    currentTrack,
    isPlaying,
    pause,
    resume,
    duration,
    position,
    seekTo,
    trackList,
    playTrackList,
    playMode,
    playNext,
    playPrevious,
    togglePlayMode,
    isSynced,
    handleDisconnect,
    setShowPlaylist,
    isLoading,
    playbackRate,
    setPlaybackRate,
    currentAudioQuality,
    availableAudioQualities,
    cycleAudioQuality,
    isRadioMode,
    switchContentModeForIncomingTrack,
  } = usePlayer();
  // 流转接收端闭包用：保证 useEffect 里始终拿到最新引用（函数每次渲染重建，但内部依赖 ref 不旧）
  const switchContentModeRef = useRef(switchContentModeForIncomingTrack);
  switchContentModeRef.current = switchContentModeForIncomingTrack;
  const [syncModalVisible, setSyncModalVisible] = useState(false);
  const [moreModalVisible, setMoreModalVisible] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [miModalVisible, setMiModalVisible] = useState(false);
  const [miDevices, setMiDevices] = useState<MiDevice[]>([]);
  const [onlineDevices, setOnlineDevices] = useState<OnlineDevice[]>([]);
  const [transferring, setTransferring] = useState<string | null>(null);
  // 本机稳定设备标识（用于从在线列表里排除自己，不依赖后端返回的 device.deviceId）
  const [selfDeviceId, setSelfDeviceId] = useState<string>("");
  useEffect(() => {
    getOrCreateDeviceId().then(setSelfDeviceId);
  }, []);
  const [miLoggedIn, setMiLoggedIn] = useState(false);
  const [miQRCodeUrl, setMiQRCodeUrl] = useState<string | null>(null);
  const [miLoading, setMiLoading] = useState(false);
  const [miCasting, setMiCasting] = useState(false);
  const miPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const playlistRef = useRef<FlatList>(null);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [lyricContainerHeight, setLyricContainerHeight] = useState(0);
  const [liked, setLiked] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [hasMv, setHasMv] = useState(false);
  const [syncCheckLoading, setSyncCheckLoading] = useState(false);
  const { user, device, setPlusToken } = useAuth();
  const { t } = useTranslation();
  const [isVip, setIsVip] = useState(false);
  const [lyricFontSize, setLyricFontSize] = useState(16);
  const [controlsBottomOffset, setControlsBottomOffset] = useState(0);
  const lineLayouts = useRef<{ [key: number]: any }>({});

  const closePlayer = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  useEffect(() => {
    if (embedded) return;

    const backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
      closePlayer();
      return true;
    });

    return () => backHandler.remove();
  }, [embedded, closePlayer]);

  useEffect(() => {
    const loadVipStatus = async () => {
      const status = await AsyncStorage.getItem("plus_vip_status");
      const data = await AsyncStorage.getItem("plus_vip_data");
      let vip = status === "true";
      if (!vip && data) {
        try {
          const parsed = JSON.parse(data);
          vip = !!(parsed?.vipTier && parsed.vipTier !== "NONE");
        } catch {}
      }
      setIsVip(vip);
    };

    loadVipStatus();
  }, []);

  const handleSyncPress = async () => {
    if (syncCheckLoading) return;
    if (isSynced) {
      handleDisconnect();
      resetHideTimer();
      return;
    }

    setSyncCheckLoading(true);
    try {
      const plusToken = await AsyncStorage.getItem("plus_token");
      const plusUserId = await AsyncStorage.getItem("plus_user_id");
      if (!plusToken || !plusUserId) {
        Alert.alert(t("playerPage.notice"), t("playerPage.vipFeatureOnly"), [
          { text: t("common.cancel"), style: "cancel" },
          ...(Platform.OS !== "ios"
            ? [{
                text: t("playerPage.activateNow"),
                onPress: () => router.push("/member-benefits" as any),
                style: "default" as const,
              }]
            : []),
        ]);
        return;
      }

      await setPlusToken(plusToken);
      let id: any = plusUserId;
      try {
        id = JSON.parse(plusUserId);
      } catch {}
      const res = await plusGetMe(id);
      const vipTier = res?.data?.data?.vipTier;
      const isVip = vipTier && vipTier !== "NONE";
      if (isVip) {
        setSyncModalVisible(true);
      } else {
        Alert.alert(t("playerPage.notice"), t("playerPage.vipFeatureOnly"), [
          { text: t("common.cancel"), style: "cancel" },
          ...(Platform.OS !== "ios"
            ? [{
                text: t("playerPage.activateNow"),
                onPress: () => router.push("/member-benefits" as any),
                style: "default" as const,
              }]
            : []),
        ]);
      }
    } catch (error) {
      console.warn("Failed to check VIP status", error);
      Alert.alert(t("playerPage.notice"), t("playerPage.vipStatusFailed"));
    } finally {
      setSyncCheckLoading(false);
    }
  };

  useEffect(() => {
    AsyncStorage.getItem("lyric_font_size").then((val) => {
      if (val) setLyricFontSize(parseFloat(val));
    });
    AsyncStorage.getItem("player_controls_bottom_offset").then((val) => {
      if (val != null) {
        const parsed = parseFloat(val);
        if (!Number.isNaN(parsed)) {
          setControlsBottomOffset(parsed);
        }
      }
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(
      "player_controls_bottom_offset",
      String(controlsBottomOffset),
    ).catch((error) => {
      console.warn("Failed to save controls bottom offset", error);
    });
  }, [controlsBottomOffset]);

  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<any>(null);
  const [artworkHeight, setArtworkHeight] = useState(0);
  const [controlsHeight, setControlsHeight] = useState(0);
  const controlsOpacity = useRef(new Animated.Value(1)).current;

  const resetHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }

    if (!needsAutoHide) {
      setControlsVisible(true);
      return;
    }

    setControlsVisible(true);
    hideTimerRef.current = setTimeout(() => {
      if (isLandscape && needsAutoHide) {
        setControlsVisible(false);
      }
    }, 3000); // 3 seconds of inactivity as per previous requirements
  };

  const needsAutoHide =
    isLandscape &&
    artworkHeight > 0 &&
    controlsHeight > 0 &&
    artworkHeight + controlsHeight + 80 > height; // 80 is estimated padding/gaps for landscape safe area and spacing

  useEffect(() => {
    if (isLandscape && needsAutoHide && controlsVisible) {
      resetHideTimer();
    } else if (!isLandscape || !needsAutoHide) {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isLandscape, needsAutoHide, controlsVisible]);

  useEffect(() => {
    Animated.timing(controlsOpacity, {
      toValue: controlsVisible ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [controlsVisible]);

  useEffect(() => {
    if (currentTrack && user) {
      const trackData = currentTrack as unknown as Track;
      const isLiked = trackData.likedByUsers?.some(
        (like: UserTrackLike) => like.userId === user.id,
      );
      setLiked(!!isLiked);
    }
  }, [currentTrack, user]);

  useEffect(() => {
    const checkCacheStatus = async () => {
      if (currentTrack) {
        const cachedPath = await isCached(currentTrack.id, currentTrack.path);
        setIsDownloaded(!!cachedPath);
      }
    };
    checkCacheStatus();
  }, [currentTrack]);

  useEffect(() => {
    let cancelled = false;

    const checkMvStatus = async () => {
      if (!currentTrack || currentTrack.type === TrackType.AUDIOBOOK) {
        if (!cancelled) setHasMv(false);
        return;
      }

      try {
        const mv = await getMvByTrackId(Number(currentTrack.id));
        if (!cancelled) {
          setHasMv(!!mv);
        }
      } catch (error) {
        if (!cancelled) {
          setHasMv(false);
        }
      }
    };

    checkMvStatus();

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id, currentTrack?.type]);

  const breatheAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isLoading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(breatheAnim, {
            toValue: 1.3,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(breatheAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      breatheAnim.stopAnimation();
      breatheAnim.setValue(1);
    }
  }, [isLoading]);
  const handleToggleLike = async () => {
    if (!currentTrack || !user) return;
    const previousLiked = liked;
    setLiked(!liked);

    try {
      if (previousLiked) {
        await toggleTrackUnLike(currentTrack.id, user.id);
      } else {
        await toggleTrackLike(currentTrack.id, user.id);
      }
    } catch (error) {
      console.error("Failed to toggle like", error);
      setLiked(previousLiked);
    }
  };

  useEffect(() => {
    const shouldShowLyrics = isLandscape
      ? currentTrack?.type !== TrackType.AUDIOBOOK
      : showLyrics;

    if (
      !shouldShowLyrics ||
      !currentTrack?.lyrics ||
      lyricContainerHeight === 0
    )
      return;

    const lyrics = parseLyrics(currentTrack.lyrics);
    const activeIndex = lyrics.findIndex((line, index) => {
      return (
        line.time <= position &&
        (index === lyrics.length - 1 || lyrics[index + 1].time > position)
      );
    });

    if (activeIndex !== -1) {
      const layout = lineLayouts.current[activeIndex];
      if (layout) {
        const scrollToY =
          layout.y + layout.height / 2 - lyricContainerHeight / 2;

        if (activeIndex !== currentLyricIndex || lyricFontSize) {
          setCurrentLyricIndex(activeIndex);
          scrollViewRef.current?.scrollTo({
            y: Math.max(0, scrollToY),
            animated: true,
          });
        }
      }
    }
  }, [
    position,
    showLyrics,
    isLandscape,
    currentTrack?.lyrics,
    currentTrack?.type,
    currentLyricIndex,
    lyricContainerHeight,
    lyricFontSize,
  ]);

  const scrollToCurrentInPlaylist = (animated: boolean = true) => {
    if (!currentTrack || trackList.length === 0) return;
    const index = trackList.findIndex((t) => t.id === currentTrack.id);
    if (index !== -1) {
      playlistRef.current?.scrollToIndex({
        index,
        animated,
        viewPosition: 0.5,
      });
    }
  };

  useEffect(() => {
    if (currentTrack && trackList.length > 0) {
      setTimeout(() => {
        scrollToCurrentInPlaylist(true);
      }, 500);
    }
  }, [currentTrack?.id, trackList.length]);

  const formatTime = (seconds: number) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  const togglePlayback = () => {
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  };

  const renderPlayModeIcon = (mode: PlayMode) => {
    switch (mode) {
      case PlayMode.SEQUENCE:
        return <MaterialCommunityIcons name="playlist-music-outline" size={24} color={colors.secondary} />;
      case PlayMode.SHUFFLE:
        return <Ionicons name="shuffle-outline" size={24} color={colors.secondary} />;
      case PlayMode.LOOP_LIST:
        return <Ionicons name="repeat-outline" size={24} color={colors.secondary} />;
      case PlayMode.LOOP_SINGLE:
        return <MaterialCommunityIcons name="repeat-once" size={24} color={colors.secondary} />;
      default:
        return <Ionicons name="repeat-outline" size={24} color={colors.secondary} />;
    }
  };

  const togglePlaybackRate = () => {
    const rates = [0.5, 1, 1.5, 2];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setPlaybackRate(nextRate);
  };

  const skipForward = () => {
    trackEvent({
      feature: "player",
      eventName: "seek_forward_15",
      userId: user?.id ? String(user.id) : undefined,
      deviceId: device?.id ? String(device.id) : undefined,
      value: 15,
    });
    seekTo(position + 15);
  };
  const skipBackward = () => {
    trackEvent({
      feature: "player",
      eventName: "seek_backward_15",
      userId: user?.id ? String(user.id) : undefined,
      deviceId: device?.id ? String(device.id) : undefined,
      value: -15,
    });
    seekTo(Math.max(0, position - 15));
  };

  const handleOpenMore = () => {
    setMoreModalVisible(true);
    trackEvent({
      feature: "player",
      eventName: "player_more_open",
      userId: user?.id ? String(user.id) : undefined,
      deviceId: device?.id ? String(device.id) : undefined,
      metadata: {
        trackId: currentTrack?.id,
        trackType: currentTrack?.type,
      },
    });
  };

  const stopMiPolling = () => {
    if (miPollingRef.current) {
      clearInterval(miPollingRef.current);
      miPollingRef.current = null;
    }
  };

  const startMiQRPolling = (lpUrl: string) => {
    stopMiPolling();
    miPollingRef.current = setInterval(async () => {
      try {
        const status = await getMiQRCodeStatus(lpUrl);
        if (status.status === "success") {
          stopMiPolling();
          setMiLoggedIn(true);
          setMiQRCodeUrl(null);
          Alert.alert(t("playerPage.miLoginRequired"), "扫码登录成功");
          const res = await getMiDevices();
          setMiDevices(res.devices || []);
        } else if (status.status === "expired" || status.status === "error") {
          stopMiPolling();
          setMiQRCodeUrl(null);
        }
      } catch (e) {
        // 静默失败，等待下次轮询
      }
    }, 2000);
  };

  const loadOnlineDevices = async () => {
    try {
      const res = await getUserDevices();
      if (res.code === 200 && res.data) {
        setOnlineDevices(res.data);
      }
    } catch (e) {
      console.error("Failed to load online devices:", e);
    }
  };

  // 订阅 WS 设备上下线事件，实时刷新在线设备列表
  useEffect(() => {
    if (!miModalVisible) return;
    loadOnlineDevices();
    const { socketService } = require("../src/services/socket");
    const onOnline = () => loadOnlineDevices();
    const onOffline = () => loadOnlineDevices();
    socketService.on("device_online", onOnline);
    socketService.on("device_offline", onOffline);
    return () => {
      socketService.off("device_online", onOnline);
      socketService.off("device_offline", onOffline);
    };
  }, [miModalVisible]);

  const handleOpenMiCast = async () => {
    setMiModalVisible(true);
    resetHideTimer();
    setMiLoading(true);
    try {
      const auth = await getMiAuthStatus();
      setMiLoggedIn(auth.logged_in);
      if (auth.logged_in) {
        const res = await getMiDevices();
        setMiDevices(res.devices || []);
      } else {
        const qr = await getMiQRCode();
        if (qr.already_logged_in) {
          setMiLoggedIn(true);
          const res = await getMiDevices();
          setMiDevices(res.devices || []);
        } else if (qr.qrcode_url) {
          setMiQRCodeUrl(qr.qrcode_url);
          if (qr.status_url) startMiQRPolling(qr.status_url);
        }
      }
    } catch (e) {
      console.error("Failed to load Mi devices:", e);
      Alert.alert(t("playerPage.loadMiDevicesFailed"));
    } finally {
      setMiLoading(false);
    }
  };

  const handleCloseMiCast = () => {
    setMiModalVisible(false);
    stopMiPolling();
  };

  const handleCastToMi = async (deviceId: string, deviceName: string) => {
    if (!currentTrack) {
      Alert.alert(t("playerPage.miCastNoTrack"));
      return;
    }
    setMiCasting(true);
    try {
      const baseURL = (await import("@/src/https")).getBaseURL().replace(/\/$/, "");
      const quality = currentAudioQuality;
      const qualityQuery = quality ? `?quality=${quality}` : "";
      const url = `${baseURL}/track/stream/${currentTrack.id}${qualityQuery}`;
      const title = `${currentTrack.name} - ${currentTrack.artist ?? ""}`;
      await playMiDeviceByUrl({ device_id: deviceId, url, title });
      if (isPlaying) {
        await pause();
      }
      Alert.alert(t("playerPage.miCastSuccess", { device: deviceName }));
      setMiModalVisible(false);
      stopMiPolling();
    } catch (e) {
      console.error("Failed to cast to Mi device:", e);
      Alert.alert(t("playerPage.miCastFailed"));
    } finally {
      setMiCasting(false);
    }
  };

  // 播放流转：把当前播放推给同账号下的目标在线设备
  const handleTransferToDevice = async (targetDevice: OnlineDevice) => {
    if (!currentTrack) {
      Alert.alert(t("playerPage.miCastNoTrack"));
      return;
    }
    const targetDeviceId = targetDevice.deviceId;
    if (!targetDeviceId) {
      Alert.alert(t("playerPage.transferFailed"));
      return;
    }
    const { socketService } = require("../src/services/socket");
    if (!socketService.connected) {
      console.warn("[Transfer] socket not connected, cannot emit transfer_session");
      Alert.alert(t("playerPage.transferFailed"));
      return;
    }
    setTransferring(targetDeviceId);
    try {
      const positionSec = Math.floor(position || 0);
      console.log(`[Transfer] emit transfer_session: target=${targetDeviceId} (${targetDevice.name}) track=${currentTrack.name} progress=${positionSec}s`);

      // 等服务端 ack（transfer_sent / transfer_failed），5s 超时兜底
      const delivered = await new Promise<boolean>((resolve) => {
        let settled = false;
        const cleanup = () => {
          settled = true;
          socketService.off("transfer_sent", onSent);
          socketService.off("transfer_failed", onFailed);
          clearTimeout(timer);
        };
        const onSent = (p: any) => {
          if (settled || p?.targetDeviceId !== targetDeviceId) return;
          console.log(`[Transfer] ✅ transfer_sent ack for ${targetDeviceId}`);
          cleanup();
          resolve(true);
        };
        const onFailed = (p: any) => {
          if (settled || p?.targetDeviceId !== targetDeviceId) return;
          console.warn(`[Transfer] ❌ transfer_failed: reason=${p?.reason} target=${p?.targetDeviceId} 服务端在线 deviceIds=[${(p?.onlineDeviceIds ?? []).join(", ") || "空"}]`);
          cleanup();
          resolve(false);
        };
        const timer = setTimeout(() => {
          if (settled) return;
          console.warn(`[Transfer] ⏱ ack timeout for ${targetDeviceId}（服务端 5s 未回，按未送达处理）`);
          cleanup();
          resolve(false);
        }, 5000);
        socketService.on("transfer_sent", onSent);
        socketService.on("transfer_failed", onFailed);
        socketService.emit("transfer_session", {
          targetDeviceId,
          currentTrack,
          playlist: { list: trackList, index: trackList.findIndex((t) => t.id === currentTrack.id) },
          progress: positionSec,
        });
      });

      if (!delivered) {
        Alert.alert(t("playerPage.transferFailed"));
        return;
      }
      // 目标设备接管后暂停本端
      if (isPlaying) await pause();
      Alert.alert(t("playerPage.transferSuccess", { device: targetDevice.name }));
      setMiModalVisible(false);
    } catch (e) {
      console.error("[Transfer] Failed to transfer session:", e);
      Alert.alert(t("playerPage.transferFailed"));
    } finally {
      setTransferring(null);
    }
  };

  // 接收端：监听其他设备发来的流转请求，接管播放
  useEffect(() => {
    const { socketService } = require("../src/services/socket");
    const onTransferReceived = async (payload: any) => {
      try {
        // 各端 Track 模型字段命名不同（web/mobile 用 name/path/cover，hm 用 title/url/coverUrl），
        // 统一规范化后再交给播放器，否则只有同名字段（artist 等）能存活，歌名/播放地址全丢。
        const normalizeTrack = (t: any): any => ({
          ...t,
          id: String(t?.id ?? ""),
          name: t?.name ?? t?.title ?? "",
          path: t?.path ?? t?.url ?? "",
          cover: t?.cover ?? t?.coverUrl ?? null,
          type: t?.type ?? t?.contentType,
        });
        const rawList = payload?.playlist?.list;
        const index = payload?.playlist?.index ?? 0;
        const rawTrack = payload?.currentTrack;
        const progressSec = payload?.progress ?? 0;
        const list =
          rawList && Array.isArray(rawList) && rawList.length > 0
            ? rawList.map(normalizeTrack)
            : undefined;
        const track = rawTrack ? normalizeTrack(rawTrack) : undefined;
        console.log(`[Transfer] handle transfer_received: from=${payload?.fromDeviceName} track=${track?.name} listLen=${list?.length ?? 0} index=${index} progress=${progressSec}s`);
        // 根据流转曲目的内容类型切换到对应模式（音乐/有声书），否则目标端会在错误模式下播放
        const targetTrack = list?.[Math.max(0, index)] ?? track;
        if (targetTrack?.type) {
          await switchContentModeRef.current(targetTrack);
        }
        if (list && list.length > 0) {
          await playTrackList(list, Math.max(0, index), progressSec);
        } else if (track) {
          await playTrackList([track], 0, progressSec);
        } else {
          console.warn("[Transfer] transfer_received payload 为空（无 playlist 且无 currentTrack），忽略");
        }
      } catch (e) {
        console.error("[Transfer] Failed to handle transfer_received:", e);
      }
    };
    socketService.on("transfer_received", onTransferReceived);
    return () => socketService.off("transfer_received", onTransferReceived);
  }, []);

  useEffect(() => {
    return () => stopMiPolling();
  }, []);

  if (!currentTrack) {
    if (embedded && carModeEnabled) {
      return (
        <View
          style={[
            styles.container,
            styles.carEmptyState,
            { backgroundColor: colors.background },
          ]}
        >
          <Text
            style={[
              styles.carEmptyStateText,
              { color: colors.secondary },
            ]}
          >
            {"AudioDock\n听见你的声音"}
          </Text>
        </View>
      );
    }

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>No track playing</Text>
        {!embedded && (
          <TouchableOpacity
            onPress={closePlayer}
          >
            <Text style={{ color: colors.primary, marginTop: 20 }}>Go Back</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const renderPlaylist = () => (
    <View style={styles.playlistContainer}>
      <FlatList
        ref={playlistRef}
        data={trackList}
        keyExtractor={(item) => item.id.toString()}
        onScrollToIndexFailed={(info) => {
          playlistRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: true,
          });
        }}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={[
              styles.playlistItem,
              currentTrack?.id === item.id && styles.activePlaylistItem,
            ]}
            onPress={() => playTrackList(trackList, index)}
          >
            <View style={styles.trackIndexContainer}>
              {currentTrack?.id === item.id && isPlaying ? (
                <PlayingIndicator />
              ) : (
                <Text
                  style={[
                    styles.trackIndex,
                    {
                      color:
                        currentTrack?.id === item.id
                          ? colors.primary
                          : colors.secondary,
                    },
                  ]}
                >
                  {index + 1}
                </Text>
              )}
            </View>
            <Image
              source={{
                uri: getImageUrl(item.cover, `https://picsum.photos/seed/${item.id}/20/20`, 96),
              }}
              style={styles.playlistItemCover}
            />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text
                style={[
                  styles.playlistItemText,
                  {
                    color:
                      currentTrack?.id === item.id
                        ? colors.primary
                        : currentTrack?.type === TrackType.AUDIOBOOK &&
                            ((item as any).progress > 0 ||
                              (item.listenedAsAudiobookByUsers &&
                                item.listenedAsAudiobookByUsers[0] &&
                                item.listenedAsAudiobookByUsers[0].progress > 0))
                          ? colors.secondary
                          : colors.text,
                  },
                ]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              {currentTrack?.type === TrackType.AUDIOBOOK &&
                (() => {
                  const displayProgress =
                    currentTrack?.id === item.id
                      ? position
                      : (item as any).progress ||
                        item.listenedAsAudiobookByUsers?.[0]?.progress ||
                        0;
                  if (displayProgress <= 0) return null;
                  return (
                    <Text
                      style={{
                        fontSize: 10,
                        color: colors.secondary,
                        marginTop: 2,
                      }}
                    >
                      {t("playerPage.listened")}{" "}
                      {Math.floor((displayProgress / (item.duration || 1)) * 100)}
                      %
                    </Text>
                  );
                })()}
            </View>
          </TouchableOpacity>
        )}
        style={styles.playlist}
      />
      {trackList.length > 20 && (
        <FloatingActionButtons
          flatListRef={playlistRef}
          onLocateCurrent={() => scrollToCurrentInPlaylist(true)}
          locateDisabled={!currentTrack || trackList.findIndex((t) => t.id === currentTrack.id) === -1}
        />
      )}
    </View>
  );

  const renderControls = () => (
    <View>
      <View style={styles.infoContainer}>
        <View style={styles.textContainer}>
          <MarqueeText
            text={currentTrack.name}
            style={[styles.trackTitle, { color: colors.text }]}
          />
          <View style={styles.trackMetaRow}>
            <Text style={[styles.trackArtist, { color: colors.secondary }]}>
              {currentTrack.artist}
            </Text>
            {currentTrack.type !== TrackType.AUDIOBOOK && (
              <TouchableOpacity
                onPress={() => {
                  cycleAudioQuality();
                  resetHideTimer();
                }}
                style={[
                  styles.qualityButton,
                  { borderColor: colors.border, backgroundColor: colors.card },
                  availableAudioQualities.length <= 1 && styles.qualityButtonDisabled,
                ]}
                disabled={availableAudioQualities.length <= 1}
              >
                <Text style={[styles.qualityButtonText, { color: colors.text }]}>
                  {availableAudioQualities.find((item) => item.quality === currentAudioQuality)?.label || "无损"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <TouchableOpacity
          onPress={handleSyncPress}
          style={[styles.syncButton, isSynced && styles.syncButtonActive]}
        >
          <Ionicons
            name={isSynced ? "people" : "people-outline"}
            size={24}
            color={isSynced ? colors.primary : colors.text}
          />
        </TouchableOpacity>

        <SyncModal
          visible={syncModalVisible}
          onClose={() => setSyncModalVisible(false)}
        />
        <PlayerMoreModal
          visible={moreModalVisible}
          setVisible={setMoreModalVisible}
          onClose={() => setMoreModalVisible(false)}
          currentTrack={currentTrack}
          router={router}
          lyricFontSize={lyricFontSize}
          setLyricFontSize={setLyricFontSize}
          controlsBottomOffset={controlsBottomOffset}
          setControlsBottomOffset={setControlsBottomOffset}
        />
        <Modal
          visible={miModalVisible}
          transparent
          animationType="fade"
          onRequestClose={handleCloseMiCast}
        >
          <Pressable
            style={miStyles.backdrop}
            onPress={handleCloseMiCast}
          >
            <Pressable
              style={[miStyles.sheet, { backgroundColor: colors.card }]}
              onPress={() => {}}
            >
              <Text style={[miStyles.title, { color: colors.text }]}>
                {t("playerPage.miSpeakerTitle")}
              </Text>

              {/* 我的在线设备（播放流转） */}
              {onlineDevices.filter((d) => d.isOnline && d.deviceId && d.deviceId !== selfDeviceId).length > 0 && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: colors.secondary, fontSize: 12, marginBottom: 6 }}>
                    {t("playerPage.onlineDevices")}
                  </Text>
                  {onlineDevices
                    .filter((d) => d.isOnline && d.deviceId && d.deviceId !== selfDeviceId)
                    .map((d) => (
                      <TouchableOpacity
                        key={String(d.deviceId ?? d.id)}
                        activeOpacity={0.6}
                        disabled={transferring !== null}
                        onPress={() => handleTransferToDevice(d)}
                        style={[miStyles.deviceRow, { borderBottomColor: colors.border }]}
                      >
                        <View style={[miStyles.deviceIcon, { backgroundColor: "#34C759" }]}>
                          <MaterialCommunityIcons
                            name={
                              d.platform === "desktop" ? "monitor"
                              : d.platform === "tablet" ? "tablet"
                              : d.platform === "tv" ? "television"
                              : d.platform === "mini" ? "cellphone-text"
                              : "cellphone"
                            }
                            size={20}
                            color="#fff"
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>
                            {d.name || t(`playerPage.platform_${d.platform || "phone"}`)}
                          </Text>
                          <Text style={{ color: colors.secondary, fontSize: 12 }}>
                            {d.platform
                              ? t(`playerPage.platform_${d.platform}`, { defaultValue: d.platform })
                              : t("playerPage.platform_web")}
                          </Text>
                        </View>
                        {transferring === d.deviceId ? (
                          <Text style={{ color: colors.secondary, fontSize: 12 }}>{t("common.loading")}</Text>
                        ) : (
                          <MaterialCommunityIcons name="cast" size={18} color={colors.secondary} />
                        )}
                      </TouchableOpacity>
                    ))}
                  <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />
                  <Text style={{ color: colors.secondary, fontSize: 12, marginBottom: 6 }}>
                    {t("playerPage.miSpeakerSection")}
                  </Text>
                </View>
              )}

              {miLoading ? (
                <Text style={{ color: colors.secondary, padding: 12 }}>
                  {t("common.loading")}
                </Text>
              ) : miLoggedIn ? (
                miDevices.length === 0 ? (
                  <Text style={{ color: colors.secondary, padding: 12 }}>
                    {t("playerPage.noMiDevices")}
                  </Text>
                ) : (
                  <ScrollView style={{ maxHeight: 360 }}>
                    {miDevices.map((device) => (
                      <TouchableOpacity
                        key={device.device_id}
                        activeOpacity={0.6}
                        disabled={miCasting}
                        onPress={() => handleCastToMi(device.device_id, device.name)}
                        style={[miStyles.deviceRow, { borderBottomColor: colors.border }]}
                      >
                        <View
                          style={[
                            miStyles.deviceIcon,
                            { backgroundColor: colors.primary },
                          ]}
                        >
                          <XiaoAiIcon size={20} color="#fff" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>
                            {device.name}
                          </Text>
                          {!!device.model && (
                            <Text style={{ color: colors.secondary, fontSize: 12 }}>
                              {device.model}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )
              ) : miQRCodeUrl ? (
                <View style={{ alignItems: "center", paddingVertical: 12 }}>
                  <Text style={{ color: colors.secondary, marginBottom: 8 }}>
                    {t("playerPage.miLoginRequired")}
                  </Text>
                  <Image
                    source={{ uri: miQRCodeUrl }}
                    style={{
                      width: 180,
                      height: 180,
                      borderRadius: 8,
                      backgroundColor: "#fff",
                    }}
                  />
                  <Text style={{ color: colors.secondary, fontSize: 12, marginTop: 8 }}>
                    {t("playerPage.miScanQRCode")}
                  </Text>
                </View>
              ) : (
                <Text style={{ color: colors.secondary, padding: 12 }}>
                  {t("playerPage.miLoginRequired")}
                </Text>
              )}
              <TouchableOpacity
                onPress={handleCloseMiCast}
                style={[miStyles.closeBtn, { backgroundColor: colors.border }]}
              >
                <Text style={{ color: colors.text, fontWeight: "600" }}>
                  {t("common.close")}
                </Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
        {renderPlaylistModal && <PlaylistModal />}
        {currentTrack.type !== TrackType.AUDIOBOOK && (
          <>
            {hasMv && (
              <TouchableOpacity
                onPress={() => {
                  router.push({
                    pathname: "/mv/[id]",
                    params: {
                      id: String(currentTrack.id),
                      trackId: String(currentTrack.id),
                    },
                  } as any);
                  resetHideTimer();
                }}
                style={styles.likeButton}
              >
                <Ionicons
                  name="videocam-outline"
                  size={24}
                  color={colors.text}
                />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => {
                handleToggleLike();
                resetHideTimer();
              }}
              style={styles.likeButton}
            >
              <Ionicons
                name={liked ? "heart" : "heart-outline"}
                size={24}
                color={liked ? colors.primary : colors.text}
              />
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          onPress={() => {
            handleOpenMiCast();
          }}
          style={styles.likeButton}
        >
          <XiaoAiIcon size={24} color={miLoggedIn ? colors.primary : colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.timeContainer}>
        <Text style={[styles.timeText, { color: colors.secondary }]}>
          {formatTime(position)}
        </Text>
        <Slider
          containerStyle={{ flex: 1, height: 40, marginHorizontal: 10 }}
          minimumValue={0}
          maximumValue={duration}
          value={position}
          onSlidingComplete={(value) => {
            seekTo(Array.isArray(value) ? value[0] : value);
            resetHideTimer();
          }}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.primary}
          renderThumbComponent={() => (
            <Animated.View
              style={{
                width: 15,
                height: 15,
                borderRadius: 8,
                backgroundColor: colors.primary,
                borderWidth: 2,
                borderColor: "#fff",
                transform: [{ scale: breatheAnim }],
              }}
            />
          )}
        />
        <Text style={[styles.timeText, { color: colors.secondary }]}>
          {formatTime(duration)}
        </Text>
      </View>

      <View style={[styles.controls, isRadioMode && { justifyContent: "center" }]}>
        {!isRadioMode && (
          <TouchableOpacity
            onPress={() => {
              togglePlayMode();
              resetHideTimer();
            }}
          >
            {renderPlayModeIcon(playMode)}
          </TouchableOpacity>
        )}

        <View style={styles.mainControls}>
            <TouchableOpacity
              onPress={() => {
                playPrevious();
                resetHideTimer();
              }}
            >
              <Ionicons name="play-skip-back" size={35} color={colors.text} />
            </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              togglePlayback();
              resetHideTimer();
            }}
            style={[styles.playButton, { backgroundColor: colors.text }]}
          >
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={30}
              color={colors.background}
              style={{ marginLeft: isPlaying ? 0 : 4 }}
            />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              playNext();
              resetHideTimer();
            }}
          >
            <Ionicons name="play-skip-forward" size={35} color={colors.text} />
          </TouchableOpacity>
        </View>

        {!isRadioMode && (
          <TouchableOpacity
            onPress={() => {
              setShowPlaylist(true);
              resetHideTimer();
            }}
          >
            <Ionicons name="list" size={24} color={colors.secondary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  if (isLandscape && !(carModeEnabled && isVip)) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        <View style={styles.landscapeContainer}>
          <View style={[styles.landscapeLeft]}>
            <View style={styles.landscapeBackBtn}>
              {!embedded && (
                <TouchableOpacity
                  onPress={closePlayer}
                  style={styles.landscapeBackBtn}
                >
                  <Ionicons name="chevron-down" size={30} color={colors.text} />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.landscapeMoreBtn}>
              {!embedded && (
                <TouchableOpacity
                  onPress={handleOpenMore}
                  style={styles.landscapeMoreBtn}
                >
                  <Ionicons name="ellipsis-vertical" size={26} color={colors.text} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              onPress={() => {
                if (needsAutoHide) {
                  setControlsVisible(!controlsVisible);
                }
              }}
              activeOpacity={1}
              style={[
                styles.landscapeArtworkContainer,
                !needsAutoHide && {
                  justifyContent: "center",
                  paddingBottom:
                    isLandscape && controlsHeight > 0 ? controlsHeight + 20 : 0,
                },
              ]}
            >
              <Image
                source={{
                  uri: getImageUrl(currentTrack.cover, "https://picsum.photos/400", 900),
                }}
                onLayout={(e) => setArtworkHeight(e.nativeEvent.layout.height)}
                style={[styles.artwork, { marginBottom: 0 }]}
              />
            </TouchableOpacity>
            <Animated.View
              style={[
                styles.landscapeControls,
                {
                  opacity: controlsOpacity,
                  backgroundColor: colors.background,
                  borderRadius: 16,
                  padding: 10,
                  position: "absolute",
                  bottom: 40,
                  left: "10%",
                  zIndex: 20,
                },
              ]}
              onLayout={(e) => setControlsHeight(e.nativeEvent.layout.height)}
              pointerEvents={controlsVisible ? "auto" : "none"}
            >
              {renderControls()}
            </Animated.View>
          </View>

          <View style={styles.landscapeRight}>
            <View style={styles.landscapeContent}>
              {currentTrack.type === TrackType.AUDIOBOOK ? (
                renderPlaylist()
              ) : (
                <ScrollView
                  ref={scrollViewRef}
                  style={styles.lyricsScroll}
                  showsVerticalScrollIndicator={false}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={[
                    styles.lyricsScrollContent,
                    {
                      paddingTop: lyricContainerHeight / 2,
                      paddingBottom: lyricContainerHeight / 2,
                    },
                  ]}
                  onLayout={(e) =>
                    setLyricContainerHeight(e.nativeEvent.layout.height)
                  }
                >
                  {(() => {
                    const lyrics = parseLyrics(currentTrack.lyrics || "");
                    return lyrics.map((line, index) => {
                      const isActive =
                        line.time <= position &&
                        (index === lyrics.length - 1 ||
                          lyrics[index + 1].time > position);

                      return (
                        <AnimatedLyricLine
                          key={index}
                          text={line.text}
                          isActive={isActive}
                          colors={colors}
                          lyricFontSize={lyricFontSize}
                          onLayout={(e) => {
                            lineLayouts.current[index] = e.nativeEvent.layout;
                          }}
                        />
                      );
                    });
                  })()}
                  {!currentTrack.lyrics && (
                    <Text
                      style={[styles.lyricsText, { color: colors.secondary }]}
                    >
                      {t("player.noLyrics")}
                    </Text>
                  )}
                </ScrollView>
              )}
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      {!embedded && (
        <View style={[styles.header, { top }]}>
          <TouchableOpacity
            onPress={closePlayer}
            style={styles.headerButton}
          >
            <Ionicons name="chevron-down" size={30} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleOpenMore}
          >
            <Ionicons name="ellipsis-vertical" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.content}>
        <View style={{ flex: 1, width: "100%", justifyContent: "center" }}>
          <View
            style={[
              styles.artworkContainer,
              showLyrics && { flex: 1, width: "100%" },
            ]}
          >
            {showLyrics ? (
              <View style={styles.lyricsContainer}>
                {currentTrack.lyrics ? (
                  <ScrollView
                    ref={scrollViewRef}
                    style={styles.lyricsScroll}
                    showsVerticalScrollIndicator={false}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={[
                      styles.lyricsScrollContent,
                      {
                        minHeight: "100%",
                      },
                    ]}
                    onLayout={(e) =>
                      setLyricContainerHeight(e.nativeEvent.layout.height)
                    }
                  >
                    <TouchableOpacity
                      activeOpacity={1}
                      onPress={() => setShowLyrics(false)}
                      style={{ 
                        width: "100%", 
                        alignItems: "center",
                        paddingTop: lyricContainerHeight / 2,
                        paddingBottom: lyricContainerHeight / 2,
                      }}
                    >
                      {(() => {
                        const lyrics = parseLyrics(currentTrack.lyrics || "");
                        return lyrics.map((line, index) => {
                          const isActive =
                            line.time <= position &&
                            (index === lyrics.length - 1 ||
                              lyrics[index + 1].time > position);

                          return (
                            <AnimatedLyricLine
                              key={index}
                              text={line.text}
                              isActive={isActive}
                              colors={colors}
                              lyricFontSize={lyricFontSize}
                              onLayout={(e) => {
                                lineLayouts.current[index] =
                                  e.nativeEvent.layout;
                              }}
                            />
                          );
                        });
                      })()}
                    </TouchableOpacity>
                  </ScrollView>
                ) : (
                  <TouchableOpacity
                    style={styles.noLyricsContainer}
                    onPress={() => setShowLyrics(false)}
                  >
                    <Text
                      style={[styles.lyricsText, { color: colors.secondary }]}
                    >
                      {t("player.noLyrics")}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <TouchableOpacity
                style={styles.artworkContainer}
                activeOpacity={0.9}
                onPress={() => setShowLyrics(true)}
              >
                <Image
                  source={{
                    uri: getImageUrl(currentTrack.cover, "https://picsum.photos/400", 900),
                  }}
                  style={styles.artwork}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={{ marginBottom: controlsBottomOffset }}>{renderControls()}</View>
      </View>
    </View>
  );
}

export default function PlayerScreen() {
  return <PlayerDetailView />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  carEmptyState: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  carEmptyStateText: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    opacity: 0.55,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "none",
    paddingHorizontal: 20,
    paddingVertical: 0,
    position: "absolute",
    width: "100%",
    zIndex: 1,
  },
  headerButton: {
    padding: 10,
    borderRadius: "50%",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  content: {
    flex: 2,
    paddingHorizontal: 30,
    justifyContent: "space-between",
  },
  artworkContainer: {
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 10,
    },
    gap: 40,
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  artwork: {
    width: 200,
    height: 200,
    borderRadius: 20,
    boxShadow: "0px 10px 20px rgba(0, 0, 0, 0.3)",
  },
  lyricsContainer: {
    flex: 1,
    width: "100%",
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    padding: 0,
    paddingBottom: 20,
  },
  lyricsToggleButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: "center",
    marginBottom: 10,
  },
  lyricsToggleText: {
    fontSize: 12,
    opacity: 0.6,
  },
  noLyricsContainer: {
    flex: 1,
    justifyContent: "center",
    width: "100%",
    alignItems: "center",
  },
  lyricsScroll: {
    flex: 2,
    width: "100%",
  },
  lyricsScrollContent: {
    alignItems: "center",
    width: "100%",
  },
  lyricsLine: {
    textAlign: "center",
    marginVertical: 8,
    opacity: 0.6,
  },
  activeLyricsLine: {
    fontWeight: "600",
    opacity: 1,
  },
  lyricsText: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
  trackInfo: {
    alignItems: "center",
    marginTop: 0,
  },
  trackTitle: {
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "left",
    marginBottom: 5,
    height: 28, // Fix height for marquee layout stability
  },
  trackArtist: {
    fontSize: 14,
    textAlign: "left",
  },
  trackMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  qualityButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  qualityButtonDisabled: {
    opacity: 0.65,
  },
  qualityButtonText: {
    fontSize: 11,
    fontWeight: "600",
  },
  timeContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  timeText: {
    fontSize: 12,
  },
  controls: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 30,
  },
  mainControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 30,
  },
  infoContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 20,
    gap: 16,
  },
  syncContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  syncButton: {
    padding: 0,
  },
  syncButtonActive: {
    // Optional active style
  },
  syncText: {
    fontSize: 12,
    fontWeight: "500",
  },
  textContainer: {
    flex: 1,
    alignItems: "flex-start",
    marginRight: 10,
  },
  rateButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.05)",
    minWidth: 45,
    alignItems: "center",
  },
  rateText: {
    fontSize: 14,
    fontWeight: "bold",
  },
  likeButton: {
    padding: 0,
  },
  playButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
  },
  bottomActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 30,
    paddingHorizontal: 20,
  },
  landscapeContainer: {
    flex: 1,
    flexDirection: "row",
  },
  landscapeLeft: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  landscapeRight: {
    flex: 1,
    padding: 24,
    paddingTop: 34,
    paddingBottom: 14,
    justifyContent: "center",
  },
  landscapeArtwork: {
    width: 250,
    height: 250,
    borderRadius: 15,
    marginBottom: 20,
  },
  landscapeContent: {
    flex: 1,
    marginBottom: 20,
    justifyContent: "center",
  },
  landscapeBackBtn: {
    position: "absolute",
    top: 20,
    left: 20,
    zIndex: 10,
  },
  landscapeMoreBtn: {
    position: "absolute",
    top: 20,
    right: 20,
    zIndex: 10,
  },
  playlistContainer: {
    flex: 1,
  },
  playlistHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  playlistTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  playlist: {
    flex: 1,
  },
  playlistItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  activePlaylistItem: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  playlistItemText: {
    fontSize: 16,
  },
  trackIndexContainer: {
    width: 30,
    justifyContent: "center",
    alignItems: "center",
  },
  trackIndex: {
    fontSize: 14,
    textAlign: "center",
  },
  playlistItemCover: {
    width: 20,
    height: 20,
    borderRadius: 2,
  },
  modal: {
    margin: 0,
    justifyContent: "flex-end",
  },
  modalContent: {
    height: "60%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  modalHeader: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(150,150,150,0.1)",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  modalItem: {
    padding: 15,
    borderBottomWidth: 0.5,
  },
  modalItemText: {
    fontSize: 16,
  },
  landscapeArtworkContainer: {
    flex: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  landscapeControls: {
    width: "100%",
    justifyContent: "center",
  },
});

const miStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  deviceIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  closeBtn: {
    marginTop: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
});
