import * as Linking from 'expo-linking';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter, useSegments } from "expo-router";
import React, { useEffect, useRef } from "react";
import "react-native-reanimated";
import { AuthProvider, useAuth } from "../src/context/AuthContext";
import { PlayerProvider, usePlayer } from "../src/context/PlayerContext";
import { getAlbumHistory, getAlbumTracks, getLatestTracks, getPlaylistById, getTrackHistory, toggleTrackLike, toggleTrackUnLike } from "@soundx/services";
import { ThemeProvider, useTheme } from "../src/context/ThemeContext";
import { PlayModeProvider, usePlayMode } from "../src/utils/playMode";

export const unstable_settings = {
  anchor: "(tabs)",
};

import { PlaylistModal } from "../src/components/PlaylistModal";
import { SquirrelAgent } from "../src/components/SquirrelAgent";
import { GlobalBottomBar } from "../src/components/GlobalBottomBar";
import { SettingsProvider, useSettings } from "../src/context/SettingsContext";
import { SyncProvider } from "../src/context/SyncContext";
import { syncWidgetMembership } from "../src/native/WidgetBridge";
import { PlayerDetailView } from "./player";

function RootLayoutNav() {
  const { token, isLoading, plusToken, user } = useAuth();
  const { voiceAssistantEnabled, carLayoutMode } = useSettings();
  const { theme, colors } = useTheme();
  const { pause, resume, playNext, playPrevious, togglePlayMode, isPlaying, currentTrack, playTrackList } = usePlayer();
  const { mode: contentMode } = usePlayMode();
  const segments = useSegments();
  const router = useRouter();
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
      segmentName === "tts";

    if (!plusToken && inAuthGroup) {
      router.replace("/member-login");
    } else if (plusToken && !token && inAuthGroup) {
      router.replace("/login");
    } else if (token && plusToken && !inAuthGroup && !isDetailPage) {
      router.replace("/(tabs)");
    }
  }, [token, plusToken, segments, isLoading]);

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
        if (!plusToken) {
          await syncWidgetMembership(false);
          return;
        }

        const plusVipStatus = await AsyncStorage.getItem("plus_vip_status");
        const plusVipData = await AsyncStorage.getItem("plus_vip_data");
        let isVip = plusVipStatus === "true";

        if (!isVip && plusVipData) {
          try {
            const parsed = JSON.parse(plusVipData);
            isVip = !!(parsed?.vipTier && parsed.vipTier !== "NONE");
          } catch {
            isVip = false;
          }
        }

        await syncWidgetMembership(isVip);
      } catch (error) {
        console.warn("[WidgetBridge] sync membership failed", error);
      }
    };

    syncVipState();
  }, [plusToken]);

  const stack = (
    <Stack>
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
    </Stack>
  );

  const showCarLayout = carLayoutMode && (segments[0] as string) !== "player";
  const rootSegment = segments[0] as string;
  const hideBottomBar =
    rootSegment === "login" ||
    rootSegment === "login-form" ||
    rootSegment === "member-login" ||
    rootSegment === "forgot-password" ||
    rootSegment === "settings" ||
    rootSegment === "source-manage" ||
    rootSegment === "player" ||
    rootSegment === "product-updates" ||
    rootSegment === "member-detail" ||
    rootSegment === "member-benefits" ||
    rootSegment === "member-payment-success" ||
    rootSegment === "modal";
  const showBottomBar = !hideBottomBar;

  return (
    <>
      <View style={styles.pageRoot}>
        {showCarLayout ? (
          <View
            style={[styles.carModeContainer, { backgroundColor: colors.background }]}
          >
            <View
              style={[styles.leftPlayerPanel, { borderRightColor: colors.border }]}
            >
              <PlayerDetailView embedded renderPlaylistModal={false} />
            </View>
            <View style={styles.rightContent}>
              {stack}
              {showBottomBar && <GlobalBottomBar />}
            </View>
          </View>
        ) : (
          <View style={styles.stackRoot}>
            {stack}
            {showBottomBar && <GlobalBottomBar />}
          </View>
        )}
      </View>
      {(segments[0] as string) !== "player" && <PlaylistModal />}
      {(segments[0] as string) !== "player" && voiceAssistantEnabled && <SquirrelAgent />}
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
    </>
  );
}

import * as ScreenOrientation from 'expo-screen-orientation';
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { Image as ExpoImage } from "expo-image";
import { Animated, StyleSheet, View } from "react-native";
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
  },
  carModeContainer: {
    flex: 1,
    flexDirection: "row",
  },
  leftPlayerPanel: {
    height: "100%",
    aspectRatio: 9 / 16,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  rightContent: {
    flex: 1,
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
