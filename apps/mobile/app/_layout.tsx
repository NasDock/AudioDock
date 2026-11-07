import * as Linking from 'expo-linking';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter, useSegments } from "expo-router";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "react-native-reanimated";
import "../src/i18n";
import { AuthProvider, useAuth } from "../src/context/AuthContext";
import { PlayerProvider, usePlayer } from "../src/context/PlayerContext";
import { getAlbumHistory, getAlbumTracks, getLatestTracks, getPlaylistById, getTrackHistory, plusGetMe, toggleTrackLike, toggleTrackUnLike } from "@soundx/services";
import { ThemeProvider, useTheme } from "../src/context/ThemeContext";
import { PlayModeProvider, usePlayMode } from "../src/utils/playMode";

export const unstable_settings = {
  anchor: "(tabs)",
};

const SWAP_BUTTON_SIZE = 42;

import { PlaylistModal } from "../src/components/PlaylistModal";
import { PrivacyAgreementDialog } from "../src/components/PrivacyAgreementDialog";
import { SquirrelAgent } from "../src/components/SquirrelAgent";
import {
  GlobalBottomBar,
  TAB_BAR_BASE_HEIGHT,
} from "../src/components/GlobalBottomBar";
import { MINI_PLAYER_HEIGHT } from "../src/components/MiniPlayer";
import { SettingsProvider, useSettings } from "../src/context/SettingsContext";
import { SyncProvider } from "../src/context/SyncContext";
import { syncWidgetMembership } from "../src/native/WidgetBridge";
import { PlayerDetailView } from "./player";
import { Ionicons } from "@expo/vector-icons";
import { UpdateModal } from "../src/components/UpdateModal";
import { useCheckUpdate } from "../hooks/useCheckUpdate";
import { PromotionDialog } from "../src/components/PromotionDialog";
import { useCheckPromotion } from "../hooks/useCheckPromotion";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function RootLayoutNav() {
  const { token, isLoading, plusToken, user } = useAuth();
  const {
    voiceAssistantEnabled,
    activityNotifyEnabled,
    carLayoutMode,
    carPanelsSwapped,
    screenBottomInset,
    updateSetting,
  } =
    useSettings();
  const { theme, colors } = useTheme();
  const safeAreaInsets = useSafeAreaInsets();
  const { pause, resume, playNext, playPrevious, togglePlayMode, isPlaying, currentTrack, playTrackList } = usePlayer();
  const { mode: contentMode } = usePlayMode();
  const segments = useSegments();
  const router = useRouter();
  const [isVip, setIsVip] = React.useState(false);
  const [carLayoutSize, setCarLayoutSize] = useState({ width: 0, height: 0 });
  const fuAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (theme === 'festive') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(fuAnim, { toValue: 1, duration: 4000, useNativeDriver: true }),
          Animated.timing(fuAnim, { toValue: 0, duration: 4000, useNativeDriver: true }),
        ])
      ).start();
    } else {
      fuAnim.setValue(0);
    }
  }, [theme]);
  const url = Linking.useURL();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(tabs)";

    // 排除 artist / album / modal / notification.click 页面
    const segmentName = segments[0] as string;
    const isDetailPage =
      segmentName === "artist" ||
      segmentName === "album" ||
      segmentName === "collection" ||
      segmentName === "modal" ||
      segmentName === "player" ||
      segmentName === "search" ||
      segmentName === "settings" ||
      segmentName === "product-updates" ||
      segmentName === "playlist" ||
      segmentName === "folder" ||
      segmentName === "admin" ||
      segmentName === "notification.click" ||
      segmentName === "source-manage" ||
      segmentName === "login-form" ||
      segmentName === "login" ||
      segmentName === "member-login" ||
      segmentName === "member-benefits" ||
      segmentName === "member-payment-success" ||
      segmentName === "forgot-password" ||
      segmentName === "member-detail" ||
      segmentName === "tts" ||
      segmentName === "scan" ||
      segmentName === "scan-confirm" ||
      segmentName === "language" ||
      segmentName === "playback-quality" ||
      segmentName === "mv" ||
      segmentName === "webdav-sources" ||
      segmentName === "llm-config" ||
      segmentName === "tts-config" ||
      segmentName === "plugin-center" ||
      segmentName === "player-theme" ||
      segmentName === "task-center" ||
      segmentName === "mi-speaker";

    if (!token && inAuthGroup) {
      router.replace("/login");
    } else if (token && !inAuthGroup && !isDetailPage) {
      router.replace("/(tabs)");
    }
  }, [token, segments, isLoading]);

  useEffect(() => {
    if (!url) return;

    const { path, queryParams } = Linking.parse(url);
    const action = String(queryParams?.action || "").toLowerCase();
    if (!action) return;
    if (path && path !== "widget") return;

    const openTarget = String(queryParams?.open || "").toLowerCase();

    const handle = async () => {
      switch (action) {
        case "play":
          if (isPlaying) {
            await pause();
          } else {
            await resume();
          }
          break;
        case "pause":
          await pause();
          break;
        case "mode":
          togglePlayMode();
          break;
        case "like":
          if (currentTrack && user) {
            await toggleTrackLike(currentTrack.id, user.id);
          }
          break;
        case "unlike":
          if (currentTrack && user) {
            await toggleTrackUnLike(currentTrack.id, user.id);
          }
          break;
        case "next":
          await playNext();
          break;
        case "prev":
        case "previous":
          await playPrevious();
          break;
        case "play_playlist": {
          const rawId = String(queryParams?.id || "");
          const playlistId = rawId ? Number(rawId) : NaN;
          if (!Number.isNaN(playlistId)) {
            try {
              const res = await getPlaylistById(playlistId);
              if (res.code === 200 && res.data?.tracks?.length) {
                await playTrackList(res.data.tracks, 0);
              }
            } catch (error) {
              console.warn("Failed to play playlist from widget", error);
            }
          }
          break;
        }
        case "play_history": {
          const rawId = String(queryParams?.id || "");
          const trackId = rawId ? Number(rawId) : NaN;
          if (!Number.isNaN(trackId) && user) {
            try {
              if (contentMode === "AUDIOBOOK") {
                const res = await getAlbumHistory(user.id, 0, 50, "AUDIOBOOK");
                if (res.code === 200) {
                  const entry = res.data.list.find((item: any) => Number(item.trackId) === trackId);
                  const albumId = entry?.album?.id;
                  const resumeProgress = entry?.progress || 0;
                  if (albumId) {
                    const tracksRes = await getAlbumTracks(albumId, 1000, 0);
                    if (tracksRes.code === 200 && tracksRes.data.list.length > 0) {
                      const tracks = tracksRes.data.list;
                      let index = tracks.findIndex((t: any) => Number(t.id) === trackId);
                      if (index === -1) index = 0;
                      await playTrackList(tracks, index, resumeProgress);
                    }
                  }
                }
              } else {
                const res = await getTrackHistory(user.id, 0, 50, "MUSIC");
                if (res.code === 200) {
                  const list = res.data.list.map((item: any) => item.track).filter(Boolean);
                  const index = list.findIndex((t: any) => Number(t.id) === trackId);
                  if (index >= 0) {
                    await playTrackList(list, index);
                  }
                }
              }
            } catch (error) {
              console.warn("Failed to play history track from widget", error);
            }
          }
          break;
        }
        case "play_latest": {
          const rawId = String(queryParams?.id || "");
          const trackId = rawId ? Number(rawId) : NaN;
          if (!Number.isNaN(trackId)) {
            try {
              const res = await getLatestTracks("MUSIC", false, 50);
              if (res.code === 200) {
                const list = res.data || [];
                const index = list.findIndex((t: any) => Number(t.id) === trackId);
                if (index >= 0) {
                  await playTrackList(list, index);
                }
              }
            } catch (error) {
              console.warn("Failed to play latest track from widget", error);
            }
          }
          break;
        }
        case "refresh_latest": {
          try {
            await getLatestTracks("MUSIC", false, 5);
          } catch (error) {
            console.warn("Failed to refresh latest tracks", error);
          }
          break;
        }
        default:
          break;
      }

      if (openTarget === "player") {
        router.replace("/player");
      }
    };

    handle();
  }, [url, isPlaying, pause, resume, playNext, playPrevious, togglePlayMode, currentTrack, user, playTrackList, contentMode]);

  useEffect(() => {
    const syncVipState = async () => {
      try {
        // console.log("[WidgetBridge] Syncing VIP state with plusToken:", !!plusToken);
        // if (!plusToken) {
        //   setIsVip(false);
        //   await syncWidgetMembership(false);
        //   return;
        // }

        // const syncLocalVipState = async (): Promise<boolean> => {
        //   const plusVipStatus = await AsyncStorage.getItem("plus_vip_status");
        //   const plusVipData = await AsyncStorage.getItem("plus_vip_data");
        //   console.log("[WidgetBridge] Local VIP status:", plusVipStatus, "VIP data:", plusVipData);
        //   let vip = plusVipStatus === "true";

        //   if (!vip && plusVipData) {
        //     try {
        //       const parsed = JSON.parse(plusVipData);
        //       console.log("[WidgetBridge] Parsed VIP data:", parsed);
        //       vip = !!(parsed?.vipTier && parsed.vipTier !== "NONE");
        //     } catch {
        //       vip = false;
        //     }
        //   }

        //   setIsVip(vip);
        //   await syncWidgetMembership(vip);
        //   return vip;
        // };

        // await syncLocalVipState();

        const plusUserId = await AsyncStorage.getItem("plus_user_id");
        console.log("[WidgetBridge] Retrieved plusUserId from storage:", plusUserId);
        if (!plusUserId) {
          return;
        }

        let userId: any = plusUserId;
        try {
          userId = JSON.parse(plusUserId);
        } catch {}

        const res = await plusGetMe(userId);
        const vipTier = res?.data?.data?.vipTier;
        console.log("[WidgetBridge] Fetched VIP tier from API:", vipTier);
        const vip = !!vipTier && vipTier !== "NONE";

        await AsyncStorage.setItem("plus_vip_status", vip ? "true" : "false");
        await AsyncStorage.setItem(
          "plus_vip_data",
          JSON.stringify(res?.data?.data || {})
        );
        await AsyncStorage.setItem("plus_vip_updated_at", Date.now().toString());
        console.log("[WidgetBridge] Updated local VIP status and data in storage");
        setIsVip(vip);
        await syncWidgetMembership(vip);
      } catch (error) {
        console.warn("[WidgetBridge] sync membership failed", error);
      }
    };

    syncVipState();
    
    // 定期与服务端对齐会员状态，避免本地缓存过期把 Widget 误判为非会员
    const timer = setInterval(syncVipState, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [plusToken]);

  // ─── 版本更新检查（启动 1.5s 后静默触发，仅一次） ────────────────────
  const {
    updateInfo,
    opening: openingStore,
    progress,
    checkUpdate,
    startUpdate,
    ignoreUpdate,
    cancelUpdate,
  } = useCheckUpdate();
  const hasAutoCheckedRef = useRef(false);
  useEffect(() => {
    if (hasAutoCheckedRef.current) return;
    hasAutoCheckedRef.current = true;
    const timer = setTimeout(() => {
      void checkUpdate();
    }, 1500);
    return () => clearTimeout(timer);
  }, [checkUpdate]);

  // ─── 优惠活动检查（启动 2s 后静默触发，仅一次） ──────────────────────
  const {
    promotion,
    checkPromotion,
    ignorePromotion,
    dismissPromotion,
  } = useCheckPromotion();
  const hasAutoCheckedPromotionRef = useRef(false);
  useEffect(() => {
    if (hasAutoCheckedPromotionRef.current) return;
    hasAutoCheckedPromotionRef.current = true;
    const timer = setTimeout(() => {
      // 设置页「活动通知」关闭时不弹
      if (!activityNotifyEnabled) return;
      void checkPromotion();
    }, 2000);
    return () => clearTimeout(timer);
  }, [checkPromotion, activityNotifyEnabled]);

  // ─── 底部栏显示/隐藏 ────────────────────────────────────────────────
  const rootSegment = segments[0] as string;
  // 这些路由以全屏方式展示，需要隐藏底部栏（mini 播放器 + Tab）
  const hideBottomBar =
    rootSegment === "login" ||
    rootSegment === "login-form" ||
    rootSegment === "member-login" ||
    rootSegment === "forgot-password" ||
    rootSegment === "settings" ||
    rootSegment === "source-manage" ||
    rootSegment === "webdav-sources" ||
    rootSegment === "llm-config" ||
    rootSegment === "tts-config" ||
    rootSegment === "plugin-center" ||
    rootSegment === "player-theme" ||
    rootSegment === "task-center" ||
    rootSegment === "mi-speaker" ||
    rootSegment === "player" ||
    rootSegment === "product-updates" ||
    rootSegment === "member-detail" ||
    rootSegment === "member-benefits" ||
    rootSegment === "member-payment-success" ||
    rootSegment === "scan" ||
    rootSegment === "scan-confirm" ||
    rootSegment === "language" ||
    rootSegment === "mv" ||
    rootSegment === "modal";

  // 底部栏覆盖在根 Stack 上；这里只给屏幕内容预留底部空间，不改变根 Stack 高度。
  // 这样进入播放页时，native 转场始终按屏幕真实底部计算起始位置。
  const bottomBarHeight =
    (!carLayoutMode && currentTrack ? MINI_PLAYER_HEIGHT : 0) +
    TAB_BAR_BASE_HEIGHT +
    safeAreaInsets.bottom;
  // player 显示期间也保留底层 tab 的 padding（player 自身单独覆盖为 0），
  // 避免进入动画期间底层页面同时发生布局位移。
  const reserveBottomBarSpace = !hideBottomBar || rootSegment === "player";

  // 底部栏恢复延迟。
  // useSegments() 在返回时**立刻**更新到目标路由，但播放页退场动画还在跑。
  // 这时不能提前渲染底部栏：
  //  - 若直接回到文档流，Stack 会被压矮，正在下滑的页面下半截被裁掉；
  //  - 若改成 absolute 浮层，bottomBar 又会盖住 native Stack 里的退场页面，
  //    视觉上页面刚到 mini 播放器顶部就“消失”（React Native Screens 的转场层级
  //    不受普通 JS zIndex 完全控制，Android 上尤其明显）。
  // 因此退场期间保持底部栏卸载，让播放页完整滑到屏幕底部；transitionEnd 后
  // 底部栏再执行高度展开动画，从底部平滑恢复（见 GlobalBottomBar.animateIn）。
  // 用 useLayoutEffect 而非 useEffect：避免恢复首帧先按文档流渲染一次造成跳动。
  // 1.5s 只是 replace/异常路径的兜底，正常以 transitionEnd 精确恢复，避免慢速手势时提前出现。
  const [barRestorePending, setBarRestorePending] = useState(false);
  // 播放页退场结束后恢复底部栏时执行一次「从底部滑入」动画
  const [bottomBarAnimateIn, setBottomBarAnimateIn] = useState(false);
  const handleBottomBarEnterComplete = useCallback(() => {
    setBottomBarAnimateIn(false);
  }, []);
  const wasBarHiddenRef = useRef(hideBottomBar);
  const previousRootSegmentRef = useRef(rootSegment);
  useLayoutEffect(() => {
    const wasHidden = wasBarHiddenRef.current;
    const previousRootSegment = previousRootSegmentRef.current;
    wasBarHiddenRef.current = hideBottomBar;
    previousRootSegmentRef.current = rootSegment;
    if (hideBottomBar) {
      // 又进入了全屏路由：立即取消待恢复/未完成的进入动画，交给 hideBottomBar 兜住
      setBarRestorePending(false);
      setBottomBarAnimateIn(false);
      return;
    }
    if (!wasHidden) return;
    // 只对播放页退场延迟恢复；其他全屏页保持原有行为，避免侧滑退场时底部栏短暂消失。
    if (previousRootSegment !== "player") return;
    setBarRestorePending(true);
    setBottomBarAnimateIn(true);
    const timer = setTimeout(() => setBarRestorePending(false), 1500);
    return () => clearTimeout(timer);
  }, [hideBottomBar, rootSegment]);

  const stack = (
    <Stack
      screenOptions={{
        // 根 Stack 恒全屏；普通页面内容底部预留覆盖式底部栏高度
        contentStyle: {
          paddingBottom: reserveBottomBarSpace ? bottomBarHeight : 0,
        },
      }}
      screenListeners={{
        // 退场动画结束：解除底部栏恢复延迟（见上方 barRestorePending）
        transitionEnd: () => setBarRestorePending(false),
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen
        name="modal"
        options={{
          headerShown: false,
          animation: "slide_from_right",
        }}
      />
      <Stack.Screen
        name="player"
        options={{
          presentation: "fullScreenModal",
          headerShown: false,
          animation: "slide_from_bottom",
          // 播放页自身是全屏页，不能预留底部栏空间，否则退场时页面会被压缩
          contentStyle: { paddingBottom: 0 },
        }}
      />
      <Stack.Screen
        name="search"
        options={{
          headerShown: false,
          animation: "fade",
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          headerShown: false,
          animation: "slide_from_right",
        }}
      />
      <Stack.Screen
        name="admin"
        options={{
          headerShown: false,
          animation: "slide_from_right",
        }}
      />
      <Stack.Screen name="playlist/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="album/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="collection/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="artist/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="folder/index" options={{ headerShown: false }} />
      <Stack.Screen name="folder/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="notification.click" options={{ headerShown: false }} />
      <Stack.Screen name="widget" options={{ headerShown: false }} />
      <Stack.Screen name="source-manage" options={{ headerShown: false }} />
      <Stack.Screen name="member-detail" options={{ headerShown: false }} />
      <Stack.Screen name="member-payment-success" options={{ headerShown: false }} />
      <Stack.Screen 
        name="login-form" 
        options={{ 
          headerShown: false, 
          animation: 'slide_from_left' 
        }} 
      />
      <Stack.Screen 
        name="member-login" 
        options={{ 
          headerShown: false,
          animation: 'slide_from_left' 
        }} 
      />
      <Stack.Screen 
        name="member-benefits" 
        options={{ 
          headerShown: false,
          animation: 'slide_from_right' 
        }} 
      />
      <Stack.Screen 
        name="forgot-password" 
        options={{ 
          headerShown: false,
          animation: 'slide_from_right'
        }} 
      />
      <Stack.Screen 
        name="product-updates" 
        options={{ 
          headerShown: false,
          animation: 'slide_from_right'
        }} 
      />
      <Stack.Screen 
        name="tts/create" 
        options={{ 
          headerShown: false,
          animation: 'slide_from_right'
        }} 
      />
      <Stack.Screen 
        name="tts/tasks" 
        options={{ 
          headerShown: false,
          animation: 'slide_from_right'
        }} 
      />
      <Stack.Screen name="scan" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <Stack.Screen name="scan-confirm" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <Stack.Screen name="language" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="playback-quality" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="mv/[id]" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="webdav-sources" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="llm-config" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="tts-config" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="plugin-center" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="player-theme" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="task-center" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="mi-speaker" options={{ headerShown: false, animation: 'slide_from_right' }} />
    </Stack>
  );

  const showCarLayout = isVip && carLayoutMode && rootSegment !== "player";
  // 退场动画期间（barRestorePending）先卸载底部栏：让 native Stack 保持全屏，
  // 播放页可以完整滑到屏幕底部；动画结束后底部栏再直接按文档流恢复。
  const showBottomBar = !hideBottomBar && !barRestorePending;
  const playerPanelWidth = carLayoutSize.height > 0 ? (carLayoutSize.height * 9) / 16 : 0;
  const swapButtonLeft =
    playerPanelWidth > 0
      ? carPanelsSwapped
        ? carLayoutSize.width - playerPanelWidth - SWAP_BUTTON_SIZE / 2
        : playerPanelWidth - SWAP_BUTTON_SIZE / 2
      : undefined;
  const playerPanel = (
    <View
      style={[
        styles.playerPanel,
        carPanelsSwapped
          ? {
              borderLeftWidth: StyleSheet.hairlineWidth,
              borderLeftColor: colors.border,
              borderRightWidth: 0,
            }
          : {
              borderRightWidth: StyleSheet.hairlineWidth,
              borderRightColor: colors.border,
              borderLeftWidth: 0,
            },
      ]}
    >
      <PlayerDetailView embedded renderPlaylistModal={false} />
    </View>
  );

  const contentPanel = (
    <View style={styles.rightContent}>
      {stack}
      {showBottomBar && (
        <GlobalBottomBar
          animateIn={bottomBarAnimateIn}
          onEnterAnimationComplete={handleBottomBarEnterComplete}
        />
      )}
    </View>
  );

  return (
    <>
      <View style={[styles.pageRoot, { paddingBottom: screenBottomInset }]}>
        {showCarLayout ? (
          <View
            style={[styles.carModeContainer, { backgroundColor: colors.background }]}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              setCarLayoutSize({ width, height });
            }}
          >
            {carPanelsSwapped ? contentPanel : playerPanel}
            <TouchableOpacity
              style={[
                styles.swapButton,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  left: swapButtonLeft,
                },
              ]}
              onPress={() => void updateSetting("carPanelsSwapped", !carPanelsSwapped)}
            >
              <Ionicons name="swap-horizontal" size={18} color={colors.border} />
            </TouchableOpacity>
            {carPanelsSwapped ? playerPanel : contentPanel}
          </View>
        ) : (
          <View style={styles.stackRoot}>
            {stack}
            {showBottomBar && (
              <GlobalBottomBar
                animateIn={bottomBarAnimateIn}
                onEnterAnimationComplete={handleBottomBarEnterComplete}
              />
            )}
          </View>
        )}
      </View>
      {(segments[0] as string) !== "player" && <PlaylistModal />}
      {(segments[0] as string) !== "player" && voiceAssistantEnabled && isVip && <SquirrelAgent />}
      {theme === 'festive' && segments[0] !== 'player' && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.festiveOverlay,
            {
              opacity: fuAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.04, 0.10]
              })
            }
          ]}
        >
          <ExpoImage
            source={require('../assets/dexopt/fu.svg')}
            style={styles.festiveFu}
            tintColor="#D4AF37"
            contentFit="contain"
          />
        </Animated.View>
      )}
      <PrivacyAgreementDialog />
      <UpdateModal
        visible={!!updateInfo}
        updateInfo={updateInfo}
        opening={openingStore}
        progress={progress}
        onUpdate={startUpdate}
        onIgnore={ignoreUpdate}
        onClose={cancelUpdate}
      />
      <PromotionDialog
        visible={!!promotion}
        promotion={promotion}
        onClose={dismissPromotion}
        onIgnore={ignorePromotion}
      />
    </>
  );
}

import * as ScreenOrientation from 'expo-screen-orientation';
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { Image as ExpoImage } from "expo-image";
import { Animated, StyleSheet, TouchableOpacity, View } from "react-native";
import PlaybackNotification from "../src/components/PlaybackNotification";
import { NotificationProvider } from "../src/context/NotificationContext";

function OrientationHandler() {
  const { autoOrientation, carLayoutMode } = useSettings();

  useEffect(() => {
    const handleOrientation = async () => {
      try {
        if (carLayoutMode) {
          await ScreenOrientation.lockAsync(
            ScreenOrientation.OrientationLock.LANDSCAPE
          );
        } else if (autoOrientation) {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT);
        } else {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        }
      } catch (error) {
        console.warn("Failed to set orientation lock:", error);
      }
    };
    handleOrientation();
  }, [autoOrientation, carLayoutMode]);

  return <View />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SettingsProvider>
        <ThemeProvider>
          <AuthProvider>
            <OrientationHandler />
            <NotificationProvider>
              <SyncProvider>
                <PlayModeProvider>
                  <PlayerProvider>
                    <RootLayoutNav />
                    <PlaybackNotification />
                  </PlayerProvider>
                </PlayModeProvider>
              </SyncProvider>
            </NotificationProvider>
          </AuthProvider>
        </ThemeProvider>
      </SettingsProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
  },
  stackRoot: {
    flex: 1,
    position: "relative",
  },
  carModeContainer: {
    flex: 1,
    flexDirection: "row",
    position: "relative",
  },
  playerPanel: {
    height: "100%",
    aspectRatio: 9 / 16,
  },
  rightContent: {
    flex: 1,
    position: "relative",
  },
  swapButton: {
    position: "absolute",
    top: "50%",
    width: SWAP_BUTTON_SIZE,
    height: SWAP_BUTTON_SIZE,
    borderRadius: SWAP_BUTTON_SIZE / 2,
    marginTop: -(SWAP_BUTTON_SIZE / 2),
    justifyContent: "center",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 20,
  },
  festiveOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  festiveFu: {
    width: 350,
    height: 350,
  }
});
