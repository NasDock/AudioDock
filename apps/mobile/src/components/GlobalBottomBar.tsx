import { Ionicons } from "@expo/vector-icons";
import { useRouter, useSegments } from "expo-router";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { usePlayer } from "../context/PlayerContext";
import { useSettings } from "../context/SettingsContext";
import { useTheme } from "../context/ThemeContext";
import { MINI_PLAYER_HEIGHT, MiniPlayer } from "./MiniPlayer";
export const TAB_BAR_BASE_HEIGHT = 49;
const ENTER_DURATION_MS = 240;

const tabs = [
  { label: "navTabs.recommend", icon: "home", href: "/(tabs)" },
  { label: "navTabs.soundcang", icon: "musical-notes", href: "/(tabs)/library" },
  { label: "navTabs.mine", icon: "person", href: "/(tabs)/personal" },
];

interface GlobalBottomBarProps {
  /** 播放页退场结束后恢复时，从底部滑入 */
  animateIn?: boolean;
  /** 播放页进出场过渡期间置于 native screen 下层，避免遮挡转场 */
  layerBelow?: boolean;
  onEnterAnimationComplete?: () => void;
}

export const GlobalBottomBar = ({
  animateIn = false,
  layerBelow = false,
  onEnterAnimationComplete,
}: GlobalBottomBarProps) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const { carLayoutMode } = useSettings();
  const { currentTrack } = usePlayer();

  const showMiniPlayer = !carLayoutMode && !!currentTrack;
  const barHeight =
    (showMiniPlayer ? MINI_PLAYER_HEIGHT : 0) + TAB_BAR_BASE_HEIGHT + insets.bottom;
  const enterAnim = useRef(new Animated.Value(animateIn ? 0 : 1)).current;
  const onCompleteRef = useRef(onEnterAnimationComplete);
  useEffect(() => {
    onCompleteRef.current = onEnterAnimationComplete;
  });

  useEffect(() => {
    if (!animateIn) {
      enterAnim.setValue(1);
      return;
    }
    enterAnim.setValue(0);
    const animation = Animated.timing(enterAnim, {
      toValue: 1,
      duration: ENTER_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      // height 是布局属性，不能用 native driver；底部栏只有 ~109px，开销可控
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished) onCompleteRef.current?.();
    });
    return () => animation.stop();
  }, [animateIn, enterAnim]);

  const activeKey =
    segments[0] === "(tabs)" ? ((segments[1] as string) || "index") : "";

  const animatedHeight = enterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, barHeight],
    extrapolate: "clamp",
  });

  return (
    <Animated.View
      style={[
        styles.animationContainer,
        layerBelow && styles.layerBelow,
        { height: animateIn ? animatedHeight : barHeight },
      ]}
    >
      <Animated.View
        style={[
          styles.container,
          { height: barHeight },
          animateIn ? { opacity: enterAnim } : undefined,
        ]}
      >
        {showMiniPlayer && <MiniPlayer />}
        <View
          style={[
            styles.tabBar,
            {
              backgroundColor: colors.tabBar,
              borderTopColor: colors.border,
              height: TAB_BAR_BASE_HEIGHT + insets.bottom,
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
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  animationContainer: {
    // 覆盖式底部栏：根 Stack 恒为全屏，转场起止位置不受底部栏显示/隐藏影响
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    overflow: "hidden",
    // 普通页面保持在 Stack 上层；底部空间由 contentStyle 预留，不会遮挡内容
    zIndex: 10,
    elevation: 10,
  },
  layerBelow: {
    // player 进出场时若还存在一帧旧底部栏，必须压在 native 转场页面下面
    zIndex: -1,
    elevation: 0,
  },
  // 内容锚定容器底部：外层高度从 0 展开时，底部栏从屏幕底部平滑露出；
  // 底层内容已由根 Stack 的 contentStyle 预留空间，不会再被上顶。
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
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
