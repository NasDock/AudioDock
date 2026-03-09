import { useAuth } from "@/src/context/AuthContext";
import { useSettings } from "@/src/context/SettingsContext";
import { initBaseURL } from "@/src/https";
import { Ionicons } from "@expo/vector-icons";
import { BottomTabBar } from "@react-navigation/bottom-tabs";
import { check } from "@soundx/services";
import { Tabs } from "expo-router";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { PlayerDetailView } from "../player";
import { MiniPlayer } from "../../src/components/MiniPlayer";
import { useTheme } from "../../src/context/ThemeContext";

export default function TabLayout() {
  const { colors } = useTheme();
  const { logout } = useAuth();
  const { carModeEnabled } = useSettings();

  useEffect(() => {
    initBaseURL().then(() => {
      check().then((res) => {
        if (res.code === 401) {
          logout();
        }
      });
    });
  }, []);

  const renderTabs = (showMiniPlayer: boolean) => (
    <Tabs
      tabBar={(props) => (
        <View>
          {showMiniPlayer && <MiniPlayer />}
          <BottomTabBar {...props} />
        </View>
      )}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.border,
          ...Platform.select({
            ios: {
              // position: "absolute", // Removed absolute to ensure stacking with MiniPlayer
            },
            default: {},
          }),
        },
        tabBarActiveTintColor: colors.tabIconActive,
        tabBarInactiveTintColor: colors.tabIconInactive,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "推荐",
          tabBarIcon: ({ color }) => (
            <Ionicons size={28} name="home" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "声仓",
          tabBarIcon: ({ color }) => (
            <Ionicons size={28} name="musical-notes" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="personal"
        options={{
          title: "我的",
          tabBarIcon: ({ color }) => (
            <Ionicons size={28} name="person" color={color} />
          ),
        }}
      />
    </Tabs>
  );

  if (carModeEnabled) {
    return (
      <View style={[styles.carModeContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.leftPlayerPanel, { borderRightColor: colors.border }]}>
          <PlayerDetailView embedded renderPlaylistModal={false} />
        </View>
        <View style={styles.rightContent}>{renderTabs(false)}</View>
      </View>
    );
  }

  return renderTabs(true);
}

const styles = StyleSheet.create({
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
});
