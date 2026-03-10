import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import { MiniPlayer } from "./MiniPlayer";

const tabs = [
  { label: "推荐", icon: "home", href: "/(tabs)" },
  { label: "声仓", icon: "musical-notes", href: "/(tabs)/library" },
  { label: "我的", icon: "person", href: "/(tabs)/personal" },
];

export const GlobalBottomBar = () => {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <MiniPlayer />
      <View
        style={[
          styles.tabBar,
          {
            backgroundColor: colors.tabBar,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.href}
            style={styles.tabItem}
            onPress={() => router.push(tab.href as any)}
          >
            <Ionicons
              size={28}
              name={tab.icon as any}
              color={colors.tabIconInactive}
            />
            <Text style={[styles.tabLabel, { color: colors.tabIconInactive }]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
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
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabItem: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 2,
    flex: 1,
  },
  tabLabel: {
    fontSize: 10,
    marginTop: 0,
  },
});
