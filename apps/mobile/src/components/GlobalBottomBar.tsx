import { Ionicons } from "@expo/vector-icons";
import { useRouter, useSegments } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useSettings } from "../context/SettingsContext";
import { useTheme } from "../context/ThemeContext";
import { MiniPlayer } from "./MiniPlayer";

const tabs = [
  { label: "navTabs.recommend", icon: "home", href: "/(tabs)" },
  { label: "navTabs.soundcang", icon: "musical-notes", href: "/(tabs)/library" },
  { label: "navTabs.mine", icon: "person", href: "/(tabs)/personal" },
];

export const GlobalBottomBar = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const { carLayoutMode } = useSettings();

  const activeKey =
    segments[0] === "(tabs)" ? ((segments[1] as string) || "index") : "";

  return (
    <View style={styles.container}>
      {!carLayoutMode && <MiniPlayer />}
      <View
        style={[
          styles.tabBar,
          {
            backgroundColor: colors.tabBar,
            borderTopColor: colors.border,
            height: 49 + insets.bottom,
            paddingTop: 6,
            paddingBottom: insets.bottom,
            width: "100%",
          },
        ]}
      >
        {tabs.map((tab) => {
          const tabKey = tab.href === "/(tabs)" ? "index" : tab.href.split("/").pop();
          const isActive = activeKey === tabKey;
          const iconColor = isActive ? colors.tabIconActive : colors.tabIconInactive;
          const textColor = isActive ? colors.tabIconActive : colors.tabIconInactive;
          return (
            <TouchableOpacity
              key={tab.href}
              style={styles.tabItem}
              onPress={() => {
                if (isActive) return;
                const navigate = (router as any).navigate;
                if (typeof navigate === "function") {
                  navigate(tab.href as any);
                  return;
                }
                router.push(tab.href as any);
              }}
            >
              <Ionicons size={28} name={tab.icon as any} color={iconColor} />
              <Text style={[styles.tabLabel, { color: textColor }]}>
                {t(tab.label)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  tabBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabItem: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  tabLabel: {
    fontSize: 10,
    marginTop: 0,
  },
});
