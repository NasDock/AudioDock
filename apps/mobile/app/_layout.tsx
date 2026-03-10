import * as Linking from 'expo-linking';
import { Stack, useRouter, useSegments } from "expo-router";
import React, { useEffect, useRef } from "react";
import "react-native-reanimated";
import { AuthProvider, useAuth } from "../src/context/AuthContext";
import { PlayerProvider } from "../src/context/PlayerContext";
import { ThemeProvider, useTheme } from "../src/context/ThemeContext";
import { PlayModeProvider } from "../src/utils/playMode";

export const unstable_settings = {
  anchor: "(tabs)",
};

import { PlaylistModal } from "../src/components/PlaylistModal";
import { SquirrelAgent } from "../src/components/SquirrelAgent";
import { GlobalBottomBar } from "../src/components/GlobalBottomBar";
import { SettingsProvider, useSettings } from "../src/context/SettingsContext";
import { SyncProvider } from "../src/context/SyncContext";
import { PlayerDetailView } from "./player";

function RootLayoutNav() {
  const { token, isLoading, sourceType, plusToken } = useAuth();
  const { voiceAssistantEnabled, carLayoutMode } = useSettings();
  const { theme, colors } = useTheme();
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
  const handledUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(tabs)";

    // 排除 artist / album / modal / notification.click 页面
    const segmentName = segments[0] as string;
    const isDetailPage =
      segmentName === "artist" ||
      segmentName === "album" ||
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
      segmentName === "forgot-password" ||
      segmentName === "member-detail" ||
      segmentName === "tts";

    if (!token && inAuthGroup) {
      router.replace({
        pathname: "/login-form",
        params: { type: sourceType || "AudioDock" },
      } as any);
    } else if (token && inAuthGroup && !plusToken) {
       router.replace("/member-login");
    } else if (token && plusToken && !inAuthGroup && !isDetailPage) {
      router.replace("/(tabs)");
    }
  }, [token, plusToken, segments, isLoading, sourceType]);

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
      <Stack.Screen name="artist/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="folder/index" options={{ headerShown: false }} />
      <Stack.Screen name="folder/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="notification.click" options={{ headerShown: false }} />
      <Stack.Screen name="source-manage" options={{ headerShown: false }} />
      <Stack.Screen name="member-detail" options={{ headerShown: false }} />
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
