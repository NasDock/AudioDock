import MarqueeText from "@/src/components/MarqueeText";
import PlayingIndicator from "@/src/components/PlayingIndicator";
import VinylCover from "@/src/components/VinylCover";
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
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Animated,
  Alert,
  BackHandler,
  Dimensions,
  FlatList,
  Image,
  Modal,
  PanResponder,
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
import { usePlayerTheme } from "../src/hooks/usePlayerTheme";

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

/**
 * 手机横屏堆叠式封面轮播的单个封面（React.memo 隔离重渲染）。
 *
 * 位置由**单个** Animated.Value（posAnim，队列坐标系的视觉中心）驱动：
 *   effPos = idx - posAnim
 * 之所以合并成单值：旧方案 indexAnim + panX 两个值在切歌收尾时要连续 setValue，
 * 两次原生指令不保证同帧生效——中间帧会闪回（旧封面回中心 / 下一首封面跳中心）。
 * 单值方案切歌只是一次 Animated.timing 到目标值，收尾无需任何 setValue，零原子性风险。
 *
 * 动画节点 useMemo 只依赖 [idx, posAnim]，挂载后永不重建（切歌不重渲染本组件）。
 * 若把基准位置写进依赖，切歌时新旧节点交接间隙原生端会回落基准位置（闪烁）；
 * 若在父组件内联创建，播放中 position 高频刷新会让封面每帧都在闪。
 *
 * interpolate 扩到 ±3 并在 ±3 处透明度归零：±3 项是「渲染窗口缓冲」，
 * 即使父级窗口 state 落后视觉中心 1 位（React state 异步），±2 槽位也有人占位。
 *
 * ⚠️ 堆叠层级不在此处表达（无 zIndex/elevation）：由父级渲染顺序决定（见 renderCoverFlow）。
 */
const CoverFlowItem = React.memo(
  function CoverFlowItem({
    track,
    idx,
    posAnim,
    coverRadius,
  }: {
    track: Track;
    idx: number;
    posAnim: Animated.Value;
    /** 播放器主题插件的封面圆角覆盖；undefined = 默认 15 */
    coverRadius?: number;
  }) {
    const anim = useMemo(() => {
      // effPos = idx - posAnim（posAnim = 视觉中心的队列坐标，可为小数）
      const effPos = Animated.subtract(idx, posAnim);
      return {
        tx: effPos.interpolate({
          inputRange: [-3, -2, -1, 0, 1, 2, 3],
          outputRange: [-166.7, -133.3, -77.8, 0, 77.8, 133.3, 166.7],
          extrapolate: "clamp" as const,
        }),
        sc: effPos.interpolate({
          inputRange: [-3, -2, -1, 0, 1, 2, 3],
          outputRange: [0.2, 1 / 3, 2 / 3, 1, 2 / 3, 1 / 3, 0.2],
          extrapolate: "clamp" as const,
        }),
        op: effPos.interpolate({
          inputRange: [-3, -2, -1, 0, 1, 2, 3],
          outputRange: [0, 0.7, 0.85, 1, 0.85, 0.7, 0],
          extrapolate: "clamp" as const,
        }),
      };
    }, [idx, posAnim]);

    // 层级：1-2-3-2-1（中心最高）——不在这里设 zIndex/elevation。
    // 实测：Android 上带 transform 的兄弟节点 z 排序不可靠（setZ/elevation 常被
    // 忽略，仍是「数组靠后 = 图层靠上」的 1-2-3-4-5）。
    // 改用原生保证的绘制顺序：后渲染的兄弟节点盖住先渲染的——由父级
    // renderCoverFlow 按 |idx-cur| 降序排 entries（中心项最后渲染 = 最顶层），
    // 两端（iOS/Android）行为一致，与 z 机制完全解耦。

    return (
      <Animated.View
        style={[
          styles.coverFlowItem,
          {
            opacity: anim.op,
            transform: [{ translateX: anim.tx }, { scale: anim.sc }],
          },
        ]}
      >
        <Image
          source={{
            // 300 恒压缩档（webp 缩略图）：>300 的档位在内网会直连原图（几 MB），轮播加载慢
            uri: getImageUrl(track.cover, "https://picsum.photos/seed/placeholder/300/300", 300),
          }}
          // Android 默认 fadeDuration=300ms：新滑入的封面会"慢慢显形"，
          // 快速切换时这就是"卡顿感"的来源之一；已有 prefetch 兜底，关掉淡入
          fadeDuration={0}
          style={[
            styles.coverFlowImage,
            coverRadius !== undefined && { borderRadius: coverRadius },
          ]}
        />
      </Animated.View>
    );
  },
  // 自定义比较：进度上报会 map 重建 track 对象（同 id 新引用），默认浅比较会误判
  // 变化导致整排封面重渲染 + Image source 对象重建。只认 id/cover/idx/posAnim/coverRadius。
  (prev, next) =>
    prev.idx === next.idx &&
    prev.posAnim === next.posAnim &&
    prev.coverRadius === next.coverRadius &&
    prev.track.id === next.track.id &&
    prev.track.cover === next.track.cover,
);

const AnimatedLyricLine = ({
  text,
  isActive,
  colors,
  lyricFontSize,
  lyricsColor,
  lyricsActiveColor,
  lyricsAlign,
  onLayout,
}: {
  text: string;
  isActive: boolean;
  colors: any;
  lyricFontSize: number;
  /** 播放器主题插件覆盖：普通行颜色（默认 colors.text） */
  lyricsColor?: string;
  /** 播放器主题插件覆盖：当前行颜色（默认 colors.primary） */
  lyricsActiveColor?: string;
  /** 播放器主题插件覆盖：对齐（默认 center） */
  lyricsAlign?: "left" | "center" | "right";
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
    outputRange: [lyricsColor ?? colors.text, lyricsActiveColor ?? colors.primary],
  });

  const scale = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.1],
  });

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });

  const alignItems =
    lyricsAlign === "left" ? "flex-start" : lyricsAlign === "right" ? "flex-end" : "center";

  return (
    <Animated.View
      onLayout={onLayout}
      style={{
        transform: [{ scale }],
        opacity,
        marginVertical: 4,
        paddingHorizontal: 20,
        width: "100%",
        alignItems,
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
            textAlign: lyricsAlign ?? "center",
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
  // 播放器主题插件（VIP 专属）：null = 无主题/非会员，全部回退默认样式
  const playerTheme = usePlayerTheme();
  const themeBackground = playerTheme?.background ?? colors.background;
  const headerIconColor = playerTheme?.headerIconColor ?? colors.text;
  const titleColor = playerTheme?.titleColor ?? colors.text;
  const artistColor = playerTheme?.artistColor ?? colors.secondary;
  const coverRadius =
    typeof playerTheme?.coverRadius === "number" ? playerTheme.coverRadius : undefined;
  // 黑胶样式（对齐 desktop detail.coverStyle/tonearm）：vinyl 时忽略 coverRadius
  const coverStyle = playerTheme?.coverStyle === "vinyl" ? "vinyl" : "square";
  const tonearm = playerTheme?.tonearm === "basic";
  const progressColor = playerTheme?.progressColor ?? colors.primary;
  const controlColor = playerTheme?.controlColor ?? colors.text;
  const lyricsColor = playerTheme?.lyricsColor;
  const lyricsActiveColor = playerTheme?.lyricsActiveColor;
  const lyricsAlign = playerTheme?.lyricsAlign;
  const themeLyricFontSize =
    typeof playerTheme?.lyricsFontSize === "number" ? playerTheme.lyricsFontSize : undefined;
  // 缓冲层底色：仅十六进制色可拼 alpha 后缀，否则回退主题色
  const bufferedColor = /^#[0-9a-f]{6}$/i.test(progressColor)
    ? `${progressColor}4D`
    : `${colors.primary}4D`;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { carModeEnabled } = useSettings();
  const top = insets.top;
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  // 黑胶盘直径：对齐 desktop 方形220→圆盘320 的 1.45 倍关系（200 → 290），窄屏兜底
  const vinylSize = Math.min(width - 60, 290);
  const {
    currentTrack,
    isPlaying,
    pause,
    resume,
    duration,
    position,
    buffered,
    seekTo,
    trackList,
    playTrackList,
    playMode,
    playNext,
    playPrevious,
    playAt,
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
    skipIntroDuration,
    setSkipIntroDuration,
    skipOutroDuration,
    setSkipOutroDuration,
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
  // 有声书快捷操作（封面下方置顶按钮组）：跳过片头/片尾弹窗状态
  const [skipModalVisible, setSkipModalVisible] = useState(false);
  const [skipModalType, setSkipModalType] = useState<"intro" | "outro" | null>(null);
  const [tempSkipTime, setTempSkipTime] = useState<number>(0);
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

  // 主题插件的歌词字号：主题激活/切换时应用主题值；
  // 用户随后在「更多」里手动调整会覆盖（跟随最后一次操作）
  useEffect(() => {
    if (themeLyricFontSize !== undefined) {
      setLyricFontSize(themeLyricFontSize);
    }
  }, [themeLyricFontSize]);

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

  const needsAutoHide =
    isLandscape &&
    artworkHeight > 0 &&
    controlsHeight > 0 &&
    artworkHeight + controlsHeight + 80 > height; // 80 is estimated padding/gaps for landscape safe area and spacing

  // 手机横屏判定：横屏且高度 < 500dp（手机横屏约 360~430，平板 600+）。
  // 手机横屏无控制组：堆叠式封面轮播 + 中心播放键；chrome（顶部按钮 + 播放键）3s 自动隐藏
  const isPhoneLandscape = isLandscape && height < 500;
  const coverFlowMode = isPhoneLandscape && trackList.length > 1;
  const autoHideChrome = isPhoneLandscape || needsAutoHide;

  const resetHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }

    if (!autoHideChrome) {
      setControlsVisible(true);
      return;
    }

    setControlsVisible(true);
    hideTimerRef.current = setTimeout(() => {
      if (isLandscape && autoHideChrome) {
        setControlsVisible(false);
      }
    }, 3000); // 3 seconds of inactivity as per previous requirements
  };

  useEffect(() => {
    if (isLandscape && autoHideChrome && controlsVisible) {
      resetHideTimer();
    } else if (!isLandscape || !autoHideChrome) {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isLandscape, autoHideChrome, controlsVisible]);

  useEffect(() => {
    Animated.timing(controlsOpacity, {
      toValue: controlsVisible ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [controlsVisible]);

  // ─── 手机横屏堆叠式封面轮播（1-2-3-2-1，对齐 hm PlayerPage） ───
  // 锚点：尺寸 1:2:3（66.7/133.3/200），非当前封面只露 1/3；
  // x 锚点 0/77.8/133.3 分段线性插值；effPos = idx - posAnim
  //
  // ★ 时序设计（防闪烁的核心）：
  //   posAnim 是「视觉中心的队列坐标」这**一个**动画值，切歌/拖拽/回弹全部只动它。
  //   渲染窗口（coverFlowVisualIndex）在**过渡开始时**就切到目标（树先更新），
  //   动画经 rAF 延后到 React 提交后启动（位置后动）——两者之间不再有
  //   「位置已跳、窗口没跟上」的裸帧（那是闪回和 ±1 空位的共同根因）。
  const COVER_FLOW_STEP = 77.8;
  const coverFlowDerivedIndex = trackList.findIndex(
    (t) => t.id === currentTrack?.id,
  );
  // 视觉中心索引与 currentTrack 派生索引解耦：playTrack 是重异步，
  // 若等它更新 currentTrack，中间几十~几百 ms 旧封面会跳回中心（闪回）。
  const [coverFlowVisualIndex, setCoverFlowVisualIndex] = useState(() =>
    coverFlowDerivedIndex >= 0 ? coverFlowDerivedIndex : 0,
  );
  // 轮播发起的切歌目标（在途）：到达前外部派生索引不回写视觉索引，
  // 防止连续快切时先到站的中间曲目把视觉索引拽回去
  const coverFlowPendingRef = useRef<number | null>(null);

  // 唯一动画值：视觉中心的队列坐标（整数=停稳，小数=拖拽/滑动中）
  const coverFlowPosAnim = useRef(
    new Animated.Value(
      coverFlowDerivedIndex >= 0 ? coverFlowDerivedIndex : 0,
    ),
  ).current;
  // 停稳时的中心索引镜像（同步 ref，手势/排序用，不等 React state）
  const coverFlowPosRef = useRef(
    coverFlowDerivedIndex >= 0 ? coverFlowDerivedIndex : 0,
  );
  const coverFlowAnimatingRef = useRef(false);
  // 树先于位置：外部切歌时先 setState（窗口/层级），再在 useLayoutEffect 里 setValue
  const coverFlowPendingJumpRef = useRef<number | null>(null);
  const [coverFlowWidth, setCoverFlowWidth] = useState(0);

  // 外部切歌（控制键/自动连播/流转等）同步视觉索引——树先更新，位置后跳
  useEffect(() => {
    const pending = coverFlowPendingRef.current;
    if (pending !== null) {
      if (coverFlowDerivedIndex === pending) {
        coverFlowPendingRef.current = null;
      }
      return;
    }
    if (
      coverFlowDerivedIndex >= 0 &&
      coverFlowDerivedIndex !== coverFlowVisualIndex
    ) {
      coverFlowPosRef.current = coverFlowDerivedIndex;
      coverFlowPendingJumpRef.current = coverFlowDerivedIndex;
      setCoverFlowVisualIndex(coverFlowDerivedIndex);
    }
  }, [coverFlowDerivedIndex, coverFlowVisualIndex]);

  // React 提交后、绘制前把位置跳到目标：保证「窗口/层级」与「位置」同帧可见，
  // 不再出现位置已跳而窗口没跟上的裸帧（闪回/空位的根因）
  useLayoutEffect(() => {
    const jump = coverFlowPendingJumpRef.current;
    if (jump !== null) {
      coverFlowPendingJumpRef.current = null;
      coverFlowPosAnim.setValue(jump);
    }
  });

  // 预取轮播窗口前后各 3 首封面（300 档缩略图），快速连滑时边缘新项秒出
  useEffect(() => {
    if (trackList.length === 0) return;
    for (let p = -3; p <= 3; p++) {
      const idx = coverFlowVisualIndex + p;
      if (idx < 0 || idx >= trackList.length) continue;
      const cover = trackList[idx]?.cover;
      if (cover) {
        Image.prefetch(getImageUrl(cover, "https://picsum.photos/seed/placeholder/300/300", 300)).catch(
          () => {},
        );
      }
    }
  }, [coverFlowVisualIndex, trackList]);

  // PanResponder 只创建一次，动态值经 ref 透传避免闭包过期
  const coverFlowStateRef = useRef({
    currentIndex: 0,
    queueLength: 0,
    width: 0,
  });
  coverFlowStateRef.current = {
    currentIndex: coverFlowVisualIndex,
    queueLength: trackList.length,
    width: coverFlowWidth,
  };

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      pause().catch(() => {});
    } else {
      resume().catch(() => {});
    }
  }, [isPlaying, pause, resume]);
  // 已有同语义函数 togglePlayback（L732+），轮播相关回调统一用 togglePlayPause

  const reboundCoverFlow = useCallback(() => {
    if (coverFlowAnimatingRef.current) return;
    coverFlowAnimatingRef.current = true;
    Animated.timing(coverFlowPosAnim, {
      toValue: coverFlowPosRef.current,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      coverFlowAnimatingRef.current = false;
    });
  }, [coverFlowPosAnim]);

  const snapCoverFlow = useCallback(
    (target: number) => {
      const ci = coverFlowPosRef.current;
      const step = target - ci;
      if (coverFlowAnimatingRef.current) return;
      if (
        step === 0 ||
        target < 0 ||
        target >= coverFlowStateRef.current.queueLength
      ) {
        reboundCoverFlow();
        return;
      }
      coverFlowAnimatingRef.current = true;
      // 树先更新：窗口/层级立刻切到目标（此时旧中心还在视觉中心，只是不再是最顶层；
      // 滑动中新封面压在旧封面上方是合理的过场），动画等 React 提交后再启动
      coverFlowPendingRef.current = target;
      coverFlowPosRef.current = target;
      setCoverFlowVisualIndex(target);
      requestAnimationFrame(() => {
        Animated.timing(coverFlowPosAnim, {
          toValue: target,
          duration: 180,
          useNativeDriver: true,
        }).start(({ finished }) => {
          coverFlowAnimatingRef.current = false;
          if (finished) {
            playAt(target).catch(() => {
              if (coverFlowPendingRef.current === target) {
                coverFlowPendingRef.current = null;
              }
            });
          }
        });
      });
    },
    [coverFlowPosAnim, playAt, reboundCoverFlow],
  );

  const handleCoverFlowTap = useCallback(
    (x: number) => {
      resetHideTimer();
      const { currentIndex: ci, width: w, queueLength } = coverFlowStateRef.current;
      const dx = x - w / 2;
      // 封面视觉布局：中心封面 width=200（±100），±1 封面中心在 ±77.8、宽 133.3，
      // ±2 封面中心在 ±133.3、宽 66.7。取每张封面的可见区域判定命中。
      // 中心：|dx| <= 100 → 播放/暂停
      // 左侧相邻（-1）：可见 [100, 144.45] → snap ci-1
      // 右侧相邻（+1）：可见 [100, 144.45] → snap ci+1
      // 左侧最外（-2）：可见 [144.45, 166.65] → snap ci-2
      // 右侧最外（+2）：可见 [144.45, 166.65] → snap ci+2
      const adx = Math.abs(dx);
      if (adx <= 100) {
        // 中心封面：播放/暂停
        togglePlayPause();
        return;
      }
      const dir = dx > 0 ? 1 : -1;
      if (adx <= 144.45) {
        // 相邻封面（±1）
        const target = ci + dir;
        if (target >= 0 && target < queueLength) snapCoverFlow(target);
        return;
      }
      if (adx <= 166.65) {
        // 最外侧封面（±2）
        const target = ci + dir * 2;
        if (target >= 0 && target < queueLength) snapCoverFlow(target);
      }
      // 166.65 之外是空白，只唤回 chrome，不切歌
    },
    [togglePlayPause, snapCoverFlow],
  );

  const snapCoverFlowRef = useRef(snapCoverFlow);
  snapCoverFlowRef.current = snapCoverFlow;
  const reboundCoverFlowRef = useRef(reboundCoverFlow);
  reboundCoverFlowRef.current = reboundCoverFlow;
  const handleCoverFlowTapRef = useRef(handleCoverFlowTap);
  handleCoverFlowTapRef.current = handleCoverFlowTap;

  const coverFlowPanResponder = useRef(
    PanResponder.create({
      // tap 也要拿 responder（否则 release 收不到），滑动由 move 阈值判定
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 5 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => {
        if (coverFlowAnimatingRef.current) return;
        const { currentIndex: ci, queueLength } = coverFlowStateRef.current;
        let v = g.dx;
        // 队列两端拖拽阻尼（30%）
        if ((ci <= 0 && v > 0) || (ci >= queueLength - 1 && v < 0)) {
          v = v * 0.3;
        }
        const max = COVER_FLOW_STEP * 1.5;
        v = Math.max(-max, Math.min(max, v));
        // 单值：视觉中心 = ci - dx/step（右拖 dx>0 → 中心左移 → 前一首）
        coverFlowPosAnim.setValue(ci - v / COVER_FLOW_STEP);
      },
      onPanResponderRelease: (e, g) => {
        if (coverFlowAnimatingRef.current) return;
        // 位移极小视为点击：按 x 坐标命中（中心播放/暂停、两侧跳曲、空白唤回）
        if (Math.abs(g.dx) < 10 && Math.abs(g.dy) < 10) {
          handleCoverFlowTapRef.current(e.nativeEvent.locationX);
          return;
        }
        const progress = g.dx / COVER_FLOW_STEP;
        let step = 0;
        if (progress <= -0.3 || g.vx < -0.4) {
          step = 1;
        } else if (progress >= 0.3 || g.vx > 0.4) {
          step = -1;
        }
        if (step === 0) {
          reboundCoverFlowRef.current();
          return;
        }
        snapCoverFlowRef.current(
          coverFlowStateRef.current.currentIndex + step,
        );
      },
      onPanResponderTerminate: () => {
        reboundCoverFlowRef.current();
      },
      onShouldBlockNativeResponder: () => true,
    }),
  ).current;

  // 堆叠式封面轮播渲染：前后各 3 首（±3 是缓冲槽，opacity=0 不可见）；
  // 单项是 React.memo 的 CoverFlowItem（动画节点 useMemo 固定），
  // 播放中 position 刷新导致的父级重渲染不会波及封面 → 不闪烁。
  // ★ 堆叠层级靠渲染顺序表达：原生「后渲染的兄弟节点在上层」是两端保证的行为，
  //   不依赖 zIndex/elevation（Android 上带 transform 的兄弟节点 z 排序实测无效，
  //   会出现层级恒为 1-2-3-4-5 的问题）。entries 按 |idx-cur| 降序排——
  //   最外侧（±3/±2）先渲染垫底，±1 次之，中心项最后渲染 = 最顶层 → 1-2-3-2-1。
  //   ±3 缓冲：即使 React state 窗口落后视觉中心 1 位（切歌收尾的异步间隙），
  //   ±2 槽位也有挂载节点占位，不会空一格。
  //   排序只随 cur（切歌）变化；key 仍是队列绝对索引，React 以 move 复用
  //   节点，不重挂载、不重建动画节点。
  const renderCoverFlow = () => {
    const cur = coverFlowVisualIndex;
    const entries: { idx: number; track: Track }[] = [];
    for (let p = -3; p <= 3; p++) {
      const idx = cur + p;
      if (idx < 0 || idx >= trackList.length) continue;
      entries.push({ idx, track: trackList[idx] });
    }
    entries.sort((a, b) => {
      const d = Math.abs(b.idx - cur) - Math.abs(a.idx - cur);
      return d !== 0 ? d : a.idx - b.idx;
    });
    return (
      <View
        style={styles.coverFlowContainer}
        onLayout={(e) => setCoverFlowWidth(e.nativeEvent.layout.width)}
        {...coverFlowPanResponder.panHandlers}
      >
        {entries.map(({ idx, track }) => (
          <CoverFlowItem
            key={idx}
            track={track}
            idx={idx}
            posAnim={coverFlowPosAnim}
            coverRadius={coverRadius}
          />
        ))}
      </View>
    );
  };

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
        return <MaterialCommunityIcons name="playlist-music-outline" size={24} color={controlColor} />;
      case PlayMode.SHUFFLE:
        return <Ionicons name="shuffle-outline" size={24} color={controlColor} />;
      case PlayMode.LOOP_LIST:
        return <Ionicons name="repeat-outline" size={24} color={controlColor} />;
      case PlayMode.LOOP_SINGLE:
        return <MaterialCommunityIcons name="repeat-once" size={24} color={controlColor} />;
      default:
        return <Ionicons name="repeat-outline" size={24} color={controlColor} />;
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

  // 有声书快捷按钮组：倍速循环档位与 PlayerMoreModal 一致（5 档）
  const togglePlaybackRateAudiobook = () => {
    const rates = [0.5, 1, 1.25, 1.5, 2];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setPlaybackRate(nextRate);
  };

  const openSkipModal = (type: "intro" | "outro") => {
    setSkipModalType(type);
    const currentVal = type === "intro" ? skipIntroDuration : skipOutroDuration;
    setTempSkipTime(currentVal === 0 ? 30 : currentVal);
    setSkipModalVisible(true);
  };

  const cancelSkip = () => {
    setSkipModalVisible(false);
    setSkipModalType(null);
  };

  const confirmSkip = () => {
    if (skipModalType === "intro") {
      setSkipIntroDuration(tempSkipTime);
    } else if (skipModalType === "outro") {
      setSkipOutroDuration(tempSkipTime);
    }
    cancelSkip();
  };

  const clearSkip = () => {
    if (skipModalType === "intro") {
      setSkipIntroDuration(0);
    } else if (skipModalType === "outro") {
      setSkipOutroDuration(0);
    }
    cancelSkip();
  };

  const adjustSkipTime = (delta: number) => {
    setTempSkipTime((prev) => Math.max(0, prev + delta));
  };

  const formatSkipTime = (s: number) => {
    const minutes = Math.floor(s / 60);
    const seconds = s % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  // 有声书模式：封面下方置顶操作按钮组（片头/-15s/倍速/+15s/片尾）。
  // 简约样式：图标 + 右下角小角标展示状态；前进/后退纯图标无文字。
  const renderAudiobookQuickActions = () => (
    <View style={styles.audiobookQuickActions}>
      {/* 片头：图标 + 右下角秒数/关 角标，激活时角标主题色 */}
      <TouchableOpacity
        style={styles.audiobookQuickBtn}
        onPress={() => openSkipModal("intro")}
      >
        <View style={styles.audiobookQuickIconBox}>
          <Ionicons
            name="play-skip-back-outline"
            size={28}
            color={skipIntroDuration > 0 ? colors.primary : colors.secondary}
          />
          <Text
            style={[
              styles.audiobookQuickBadge,
              { color: skipIntroDuration > 0 ? colors.primary : colors.secondary },
            ]}
          >
            {skipIntroDuration > 0 ? `${skipIntroDuration}s` : t("playerMore.turnOff")}
          </Text>
        </View>
      </TouchableOpacity>

      {/* 后退 15s：纯图标 */}
      <TouchableOpacity style={styles.audiobookQuickBtn} onPress={skipBackward}>
        <MaterialCommunityIcons name="rewind-15" size={28} color={colors.secondary} />
      </TouchableOpacity>

      {/* 倍速：图标 + 右下角倍率角标 */}
      <TouchableOpacity
        style={styles.audiobookQuickBtn}
        onPress={togglePlaybackRateAudiobook}
      >
        <View style={styles.audiobookQuickIconBox}>
          <Ionicons name="speedometer-outline" size={28} color={colors.secondary} />
          <Text style={[styles.audiobookQuickBadge, { color: colors.secondary }]}>
            {playbackRate}x
          </Text>
        </View>
      </TouchableOpacity>

      {/* 前进 15s：纯图标 */}
      <TouchableOpacity style={styles.audiobookQuickBtn} onPress={skipForward}>
        <MaterialCommunityIcons name="fast-forward-15" size={28} color={colors.secondary} />
      </TouchableOpacity>

      {/* 片尾：图标 + 右下角秒数/关 角标，激活时角标主题色 */}
      <TouchableOpacity
        style={styles.audiobookQuickBtn}
        onPress={() => openSkipModal("outro")}
      >
        <View style={styles.audiobookQuickIconBox}>
          <Ionicons
            name="play-skip-forward-outline"
            size={28}
            color={skipOutroDuration > 0 ? colors.primary : colors.secondary}
          />
          <Text
            style={[
              styles.audiobookQuickBadge,
              { color: skipOutroDuration > 0 ? colors.primary : colors.secondary },
            ]}
          >
            {skipOutroDuration > 0 ? `${skipOutroDuration}s` : t("playerMore.turnOff")}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );

  // 有声书快捷按钮组：跳过片头/片尾设置弹窗（与 PlayerMoreModal 内的行为一致）
  const renderSkipModal = () => (
    <Modal
      visible={skipModalVisible}
      transparent
      animationType="fade"
      onRequestClose={cancelSkip}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <Pressable style={styles.skipModalBackdrop} onPress={cancelSkip}>
        <Pressable
          style={{ width: "100%", maxWidth: 450, alignSelf: "center" }}
          onPress={() => {}}
        >
          <View
            style={[
              styles.skipModalContent,
              {
                backgroundColor: colors.card,
                paddingBottom: insets.bottom + 20,
              },
            ]}
          >
            <View style={styles.skipModalHandle} />
            <Text
              style={{
                fontSize: 18,
                fontWeight: "600",
                color: colors.text,
                textAlign: "center",
                paddingHorizontal: 20,
                paddingBottom: 4,
              }}
            >
              {skipModalType === "intro"
                ? t("playerMore.setAutoSkipIntro")
                : t("playerMore.setAutoSkipOutro")}
            </Text>
            <Text
              style={{
                textAlign: "center",
                color: colors.secondary,
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {t("playerMore.appliesToAllAudiobooks")}
            </Text>

            <View style={{ alignItems: "center", paddingVertical: 10 }}>
              <Text
                style={{
                  fontSize: 48,
                  fontWeight: "bold",
                  color: colors.primary,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatSkipTime(tempSkipTime)}
              </Text>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 16,
                  marginTop: 20,
                }}
              >
                {[-10, -1, 1, 10].map((delta, i) => (
                  <React.Fragment key={delta}>
                    {i === 2 && (
                      <View
                        style={{
                          width: 1,
                          height: 20,
                          backgroundColor: colors.border,
                        }}
                      />
                    )}
                    <TouchableOpacity
                      onPress={() => adjustSkipTime(delta)}
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
                        {delta > 0 ? `+${delta}` : `${delta}`}
                      </Text>
                    </TouchableOpacity>
                  </React.Fragment>
                ))}
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 24 }}>
                {[30, 60, 90, 120].map((seconds) => (
                  <TouchableOpacity
                    key={seconds}
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
                ))}
              </View>
            </View>

            <View
              style={{
                flexDirection: "row",
                paddingHorizontal: 20,
                paddingTop: 10,
                gap: 12,
              }}
            >
              <TouchableOpacity
                onPress={clearSkip}
                style={{
                  flex: 1,
                  padding: 14,
                  alignItems: "center",
                  backgroundColor: "rgba(255, 59, 48, 0.1)",
                  borderRadius: 12,
                }}
              >
                <Text style={{ color: "#FF3B30", fontWeight: "600" }}>
                  {t("playerMore.turnOff")}
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
                  {t("common.done")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );

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
          // 兜底匹配维度：deviceId 漂移时服务端按 deviceName+platform 回退匹配
          targetDeviceName: targetDevice.name,
          targetPlatform: targetDevice.platform,
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
            style={[styles.trackTitle, { color: titleColor }]}
          />
          <View style={styles.trackMetaRow}>
            <Text style={[styles.trackArtist, { color: artistColor }]}>
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
        {/* 更多选项入口：设备列表按钮右侧（对齐 mini 播放页信息行末尾的更多按钮） */}
        <TouchableOpacity
          onPress={() => {
            setMoreModalVisible(true);
            resetHideTimer();
          }}
          style={styles.likeButton}
        >
          <Ionicons name="ellipsis-vertical" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.timeContainer}>
        <Text style={[styles.timeText, { color: colors.secondary }]}>
          {formatTime(position)}
        </Text>
        <View style={styles.sliderWrapper}>
          {/* 自定义底轨 + 缓存层：Slider 的 maximumTrack 设为透明，由这两层代替绘制 */}
          <View
            style={[styles.sliderRail, { backgroundColor: colors.border }]}
          />
          <View
            style={[
              styles.bufferedTrack,
              {
                width: `${
                  duration > 0 ? Math.min((buffered / duration) * 100, 100) : 0
                }%`,
                backgroundColor: bufferedColor,
              },
            ]}
          />
          <Slider
            containerStyle={{ flex: 1, height: 40 }}
            minimumValue={0}
            maximumValue={duration}
            value={position}
            onSlidingComplete={(value) => {
              seekTo(Array.isArray(value) ? value[0] : value);
              resetHideTimer();
            }}
            trackStyle={{ height: 4, borderRadius: 2 }}
            minimumTrackTintColor={progressColor}
            maximumTrackTintColor="transparent"
            thumbTintColor={progressColor}
            renderThumbComponent={() => (
              <Animated.View
                style={{
                  width: 15,
                  height: 15,
                  borderRadius: 8,
                  backgroundColor: progressColor,
                  borderWidth: 2,
                  borderColor: "#fff",
                  transform: [{ scale: breatheAnim }],
                }}
              />
            )}
          />
        </View>
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
              <Ionicons name="play-skip-back" size={35} color={controlColor} />
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
            <Ionicons name="play-skip-forward" size={35} color={controlColor} />
          </TouchableOpacity>
        </View>

        {!isRadioMode && (
          <TouchableOpacity
            onPress={() => {
              setShowPlaylist(true);
              resetHideTimer();
            }}
          >
            <Ionicons name="list" size={24} color={controlColor} />
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
            backgroundColor: themeBackground,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        <View style={styles.landscapeContainer}>
          <View style={[styles.landscapeLeft]}>
            {/* 顶部折叠/更多按钮随控制条一起显隐（横屏沉浸式） */}
            <Animated.View
              style={[styles.landscapeBackBtn, { opacity: controlsOpacity }]}
              pointerEvents={controlsVisible ? "auto" : "none"}
            >
              {!embedded && (
                <TouchableOpacity
                  onPress={closePlayer}
                  style={styles.landscapeBackBtn}
                >
                  <Ionicons name="chevron-down" size={30} color={headerIconColor} />
                </TouchableOpacity>
              )}
            </Animated.View>
            <Animated.View
              style={[styles.landscapeMoreBtn, { opacity: controlsOpacity }]}
              pointerEvents={controlsVisible ? "auto" : "none"}
            >
              {!embedded && (
                <TouchableOpacity
                  onPress={handleOpenMore}
                  style={styles.landscapeMoreBtn}
                >
                  <Ionicons name="ellipsis-vertical" size={26} color={headerIconColor} />
                </TouchableOpacity>
              )}
            </Animated.View>
            {/* 修复：外层改为普通 View 承担布局，封面单独一个 TouchableOpacity，
                跳过片头片尾按钮组移为兄弟节点（对齐竖屏结构）。
                此前按钮组嵌在封面 TouchableOpacity 内部，父级拦截触摸导致横屏点击无反应。 */}
            {coverFlowMode ? (
              /* 手机横屏 + 队列>1：堆叠式封面轮播（无控制组） */
              renderCoverFlow()
            ) : (
              <>
                <View
                  style={[
                    styles.landscapeArtworkContainer,
                    !needsAutoHide && {
                      justifyContent: "center",
                      paddingBottom:
                        isLandscape && controlsHeight > 0 ? controlsHeight + 20 : 0,
                    },
                  ]}
                >
                  <TouchableOpacity
                    onPress={() => {
                      // 手机横屏无控制组：点封面 = 唤回 chrome + 播放/暂停
                      if (isPhoneLandscape) {
                        resetHideTimer();
                        togglePlayPause();
                        return;
                      }
                      if (needsAutoHide) {
                        setControlsVisible(!controlsVisible);
                      }
                    }}
                    activeOpacity={1}
                  >
                    <Image
                      source={{
                        uri: getImageUrl(currentTrack.cover, "https://picsum.photos/400", 900),
                      }}
                      onLayout={(e) => setArtworkHeight(e.nativeEvent.layout.height)}
                      style={[
                        styles.artwork,
                        { marginBottom: 0 },
                        coverRadius !== undefined && { borderRadius: coverRadius },
                      ]}
                    />
                  </TouchableOpacity>
                  {/* 横屏/平板模式：有声书封面下方置顶操作按钮组（与竖屏同一组） */}
                  {currentTrack.type === TrackType.AUDIOBOOK &&
                    renderAudiobookQuickActions()}
                </View>
                {/* 悬浮控制条：仅平板横屏渲染（手机横屏已完全移除控制组） */}
                {!isPhoneLandscape && (
                  <Animated.View
                    style={[
                      styles.landscapeControls,
                      {
                        opacity: controlsOpacity,
                        backgroundColor: themeBackground,
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
                )}
              </>
            )}
            {/* 手机横屏：封面中心播放/暂停按钮（半透明毛玻璃，纯展示 pointerEvents=none，
                点击由下层轮播手势层/封面 Touchable 处理），随 chrome 显隐 */}
            {isPhoneLandscape && (
              <Animated.View
                pointerEvents="none"
                style={[styles.centerPlayButtonOverlay, { opacity: controlsOpacity }]}
              >
                <View style={styles.centerPlayButton}>
                  <Ionicons
                    name={isPlaying ? "pause" : "play"}
                    size={30}
                    color="#fff"
                    // play 三角图标视觉重心偏左，右补 4px 对齐几何中心（同竖屏播放键 L1886 的补偿）
                    style={{ marginLeft: isPlaying ? 0 : 4 }}
                  />
                </View>
              </Animated.View>
            )}
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
                          lyricsColor={lyricsColor}
                          lyricsActiveColor={lyricsActiveColor}
                          lyricsAlign={lyricsAlign}
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
        {/* 修复：横屏分支也要挂载跳过片头/片尾设置弹窗，
            否则横屏下点片头/片尾按钮只改了 state 却没有 Modal 可显示，表现为"点击没反应" */}
        {renderSkipModal()}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: themeBackground, paddingTop: insets.top },
      ]}
    >
      {!embedded && (
        <View style={[styles.header, { top }]}>
          <TouchableOpacity
            onPress={closePlayer}
            style={styles.headerButton}
          >
            <Ionicons name="chevron-down" size={30} color={headerIconColor} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleOpenMore}
          >
            <Ionicons name="ellipsis-vertical" size={24} color={headerIconColor} />
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
                              lyricsColor={lyricsColor}
                              lyricsActiveColor={lyricsActiveColor}
                              lyricsAlign={lyricsAlign}
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
              <View style={{ alignItems: "center" }}>
                <TouchableOpacity
                  style={styles.artworkContainer}
                  activeOpacity={0.9}
                  onPress={() => setShowLyrics(true)}
                >
                  {coverStyle === "vinyl" ? (
                    <VinylCover
                      uri={getImageUrl(currentTrack.cover, "https://picsum.photos/400", 900)}
                      size={vinylSize}
                      isPlaying={isPlaying}
                      tonearm={tonearm}
                    />
                  ) : (
                    <Image
                      source={{
                        uri: getImageUrl(currentTrack.cover, "https://picsum.photos/400", 900),
                      }}
                      style={[
                        styles.artwork,
                        coverRadius !== undefined && { borderRadius: coverRadius },
                      ]}
                    />
                  )}
                </TouchableOpacity>
                {/* 有声书模式：操作按钮组贴在封面正下方（与封面同在一个居中的容器内，
                    保证按钮组紧贴封面而非悬在中缝） */}
                {currentTrack.type === TrackType.AUDIOBOOK &&
                  renderAudiobookQuickActions()}
              </View>
            )}
          </View>
        </View>

        <View style={{ marginBottom: controlsBottomOffset }}>{renderControls()}</View>
        {renderSkipModal()}
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
  // 有声书模式：封面下方置顶操作按钮组
  audiobookQuickActions: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "flex-start",
    width: "100%",
    marginTop: 24,
    opacity: 0.6,
  },
  audiobookQuickBtn: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 56,
  },
  // 图标盒：相对定位，供右下角角标绝对定位
  audiobookQuickIconBox: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  // 右下角小角标（秒数/倍率/关），贴在图标右下角
  audiobookQuickBadge: {
    position: "absolute",
    right: -14,
    bottom: -4,
    fontSize: 9,
    fontWeight: "bold",
  },
  skipModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  skipModalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    width: "100%",
  },
  skipModalHandle: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(150,150,150,0.3)",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
    marginTop: 8,
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
  sliderWrapper: {
    flex: 1,
    height: 40,
    marginHorizontal: 10,
    justifyContent: "center",
  },
  // 自定义进度条底轨与缓存层（与 Slider trackStyle 的 4px 对齐）
  sliderRail: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
  },
  bufferedTrack: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: 2,
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
  // 手机横屏堆叠式封面轮播（1-2-3-2-1）
  coverFlowContainer: {
    flex: 1,
    width: "100%",
  },
  coverFlowItem: {
    position: "absolute",
    width: 200,
    height: 200,
    left: "50%",
    marginLeft: -100,
    top: "50%",
    marginTop: -100,
    borderRadius: 15,
    // 堆叠层级走渲染顺序（renderCoverFlow 按 |idx-cur| 降序排 children）。
  },
  coverFlowImage: {
    width: 200,
    height: 200,
    borderRadius: 15,
    // 与竖屏 artwork 同款阴影（boxShadow 为 RN 0.76+ CSS 阴影，两端通用；
    // Android 叠一层 elevation 兜底投影）
    boxShadow: "0px 10px 20px rgba(0, 0, 0, 0.3)",
    elevation: 10,
  },
  // 手机横屏封面中心播放/暂停按钮（半透明毛玻璃，pointerEvents=none 纯展示）
  // 外层 absoluteFill + flex 居中，保证按钮中心点 = 封面中心点
  //（不用 left/top 50% + 负 margin：Yoga 对绝对定位节点的 margin 处理有偏差）
  centerPlayButtonOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 110,
  },
  centerPlayButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.25)",
    justifyContent: "center",
    alignItems: "center",
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
