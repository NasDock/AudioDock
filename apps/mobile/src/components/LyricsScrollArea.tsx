/**
 * 歌词滚动区（手机竖屏 / 手机横屏 / Pad / 车机横屏共用同一份实现）。
 *
 * 交互约定：
 * 1. 播放中自动把「当前播放行」滚到容器垂直中心；
 * 2. 用户手指开始拖动的那一刻起接管滚动 —— 自动跟随立刻让位，
 *    期间 position 再怎么变也不会把用户正在看的位置抢回去；
 * 3. 拖动时容器中心那一行成为候选行，左侧显示该行时间戳、右侧显示播放按钮，
 *    点击则 seek 到该行并恢复播放；
 * 4. 停止滚动后 2s 内没有点击播放按钮，回弹到「当前正在播放的歌词行」；
 *    回弹由定时器显式 scrollTo 驱动，不依赖 position 变化 ——
 *    所以暂停 / 停止播放时拖动，一样会回到拖动前的位置。
 *
 * 尺寸不写死：容器高度由 ScrollView onLayout 实测，中心操作条用
 * absoluteFill + 居中，宽度上限 560（Pad / 横屏不至于拉得太开），
 * 高度随歌词字号变化，因此手机 / Pad / 横屏 / 车机分栏都自动适配。
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  LayoutRectangle,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

/** 手动滚动停止后，多久没点播放就回到当前播放行 */
const IDLE_TIMEOUT_MS = 2000;
/** 中心操作条最小高度（大字号时按行高撑开） */
const MIN_SEEK_ROW_HEIGHT = 52;
/** Pad / 横屏宽栏下中心操作条的最大宽度 */
const SEEK_ROW_MAX_WIDTH = 560;

export interface LyricLineData {
  time: number;
  text: string;
}

interface LyricsScrollAreaProps {
  /** 已解析并按时序排好的歌词行 */
  lyrics: LyricLineData[];
  /** 当前播放进度（秒） */
  position: number;
  isPlaying: boolean;
  /** 播放页强制的暗色板（colors.text / colors.primary / colors.secondary） */
  colors: any;
  lyricFontSize: number;
  lyricsColor?: string;
  lyricsActiveColor?: string;
  lyricsAlign?: "left" | "center" | "right";
  seekTo: (position: number) => Promise<void>;
  resume: () => Promise<void>;
  /** 竖屏：点击歌词空白区切回封面。手动滚动接管期间会被屏蔽，避免误触退出 */
  onBackgroundPress?: () => void;
  noLyricsText?: string;
  /** 切歌时用于复位滚动状态 */
  trackId?: string | number;
}

/** position 落在 [line[i].time, line[i+1].time) 即为当前行；早于首行兜底第 0 行 */
const resolveActiveIndex = (list: LyricLineData[], pos: number): number => {
  if (list.length === 0) return -1;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].time <= pos && (i === list.length - 1 || list[i + 1].time > pos)) {
      return i;
    }
  }
  return 0;
};

const formatLyricTime = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
};

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
  lyricsColor?: string;
  lyricsActiveColor?: string;
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
  }, [isActive, animatedValue]);

  const color = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [lyricsColor ?? colors.text, lyricsActiveColor ?? colors.primary],
  });
  const scale = animatedValue.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const opacity = animatedValue.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
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
            marginVertical: 0,
            textAlign: lyricsAlign ?? "center",
          },
        ]}
      >
        {text}
      </Animated.Text>
    </Animated.View>
  );
};

export function LyricsScrollArea({
  lyrics,
  position,
  isPlaying,
  colors,
  lyricFontSize,
  lyricsColor,
  lyricsActiveColor,
  lyricsAlign,
  seekTo,
  resume,
  onBackgroundPress,
  noLyricsText,
  trackId,
}: LyricsScrollAreaProps) {
  const scrollRef = useRef<ScrollView>(null);
  const lineLayouts = useRef<{ [key: number]: LayoutRectangle }>({});
  const [containerHeight, setContainerHeight] = useState(0);

  /** 手动滚动接管标记（ref 供手势回调/自动滚动闸门同步读取，state 只驱动操作条显隐） */
  const interactingRef = useRef(false);
  const [interacting, setInteracting] = useState(false);
  /** 当前停在容器中心的那一行 */
  const [centeredIndex, setCenteredIndex] = useState(-1);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relayoutRafRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const autoScrollKeyRef = useRef("");
  const prevTrackIdRef = useRef(trackId);

  // 定时器 / 原生手势回调里必须拿到最新值，不能用创建时的闭包快照
  const positionRef = useRef(position);
  positionRef.current = position;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const lyricsRef = useRef(lyrics);
  lyricsRef.current = lyrics;
  const heightRef = useRef(containerHeight);
  heightRef.current = containerHeight;
  const fontSizeRef = useRef(lyricFontSize);
  fontSizeRef.current = lyricFontSize;
  const trackIdRef = useRef(trackId);
  trackIdRef.current = trackId;

  const activeIndex = useMemo(() => resolveActiveIndex(lyrics, position), [lyrics, position]);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const makeAutoScrollKey = useCallback((index: number) => {
    return `${String(trackIdRef.current ?? "")}|${index}|${fontSizeRef.current}|${Math.round(
      heightRef.current,
    )}`;
  }, []);

  /**
   * 把某一行滚到容器垂直中心；layout 尚未就绪时返回 false 由调用方重试。
   *
   * 行 layout 的 y 是相对「行容器」的坐标，行容器本身从内容顶部 0 开始、
   * 靠自身 paddingTop 撑出半屏留白，所以 layout.y 天然就是内容坐标系的 y，
   * 可直接和 contentOffset.y + 容器高度/2 比较（横屏 / 竖屏 / 分栏统一）。
   */
  const scrollToIndex = useCallback((index: number, animated = true): boolean => {
    const layout = lineLayouts.current[index];
    const h = heightRef.current;
    if (!layout || h <= 0) return false;
    const y = Math.max(0, layout.y + layout.height / 2 - h / 2);
    scrollRef.current?.scrollTo({ y, animated });
    return true;
  }, []);

  /**
   * 容器高度 / 字号变化会让所有行的 y 重排（onLayout 重新上报）。
   * 用 rAF 合并同批回调，再用最新 layout 纠一次位置，避免节流键把错误位置锁死。
   */
  const scheduleRelayout = useCallback(() => {
    if (relayoutRafRef.current !== null) cancelAnimationFrame(relayoutRafRef.current);
    relayoutRafRef.current = requestAnimationFrame(() => {
      relayoutRafRef.current = null;
      if (interactingRef.current) return;
      const index = resolveActiveIndex(lyricsRef.current, positionRef.current);
      if (index >= 0 && scrollToIndex(index, false)) {
        autoScrollKeyRef.current = makeAutoScrollKey(index);
      }
    });
  }, [makeAutoScrollKey, scrollToIndex]);

  /** 视口中心落在哪一行（内容坐标系：contentOffset.y + 容器高度/2） */
  const findCenteredIndex = useCallback((offsetY: number): number => {
    const h = heightRef.current;
    if (h <= 0) return -1;
    const targetY = offsetY + h / 2;
    const list = lyricsRef.current;
    let nearest = -1;
    let nearestDistance = Infinity;
    for (let i = 0; i < list.length; i += 1) {
      const layout = lineLayouts.current[i];
      if (!layout) continue;
      if (targetY >= layout.y && targetY < layout.y + layout.height) return i;
      const distance = Math.abs(layout.y + layout.height / 2 - targetY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    }
    return nearest;
  }, []);

  const updateCenteredIndex = useCallback(
    (offsetY: number) => {
      const index = findCenteredIndex(offsetY);
      if (index >= 0) setCenteredIndex((prev) => (prev === index ? prev : index));
    },
    [findCenteredIndex],
  );

  /** 自动跟随：只在「行/字号/容器/曲目」变化时滚一次，接管期间完全让位 */
  useEffect(() => {
    if (containerHeight <= 0 || lyrics.length === 0) return;
    if (interactingRef.current) return;
    const key = makeAutoScrollKey(activeIndex);
    if (autoScrollKeyRef.current === key || activeIndex < 0) return;

    clearRetryTimer();
    let attempts = 0;
    const tryScroll = () => {
      if (interactingRef.current) return;
      if (scrollToIndex(activeIndex)) {
        autoScrollKeyRef.current = key;
        return;
      }
      // 首帧行 layout 可能还没上报（大字号/切歌/首次进入歌词页），重试几帧
      attempts += 1;
      if (attempts < 5) retryTimerRef.current = setTimeout(tryScroll, 80);
    };
    tryScroll();
  }, [
    activeIndex,
    containerHeight,
    lyricFontSize,
    trackId,
    lyrics.length,
    makeAutoScrollKey,
    scrollToIndex,
    clearRetryTimer,
  ]);

  /** 手指按下：立刻接管，清掉回弹计时，并把中心行时间显示出来 */
  const onScrollBeginDrag = useCallback(() => {
    clearIdleTimer();
    clearRetryTimer();
    interactingRef.current = true;
    setInteracting(true);
    updateCenteredIndex(offsetRef.current);
  }, [clearIdleTimer, clearRetryTimer, updateCenteredIndex]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetRef.current = e.nativeEvent.contentOffset.y;
      // 程序化自动滚动不更新时间，只有手动接管期间才跟随中心行
      if (interactingRef.current) updateCenteredIndex(offsetRef.current);
    },
    [updateCenteredIndex],
  );

  /** 松手 / 惯性结束：开 2s 倒计时，超时显式回弹（暂停时也生效） */
  const scheduleIdleReset = useCallback(() => {
    if (!interactingRef.current) return;
    updateCenteredIndex(offsetRef.current);
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      interactingRef.current = false;
      setInteracting(false);
      setCenteredIndex(-1);

      const target = resolveActiveIndex(lyricsRef.current, positionRef.current);
      if (target >= 0 && scrollToIndex(target)) {
        // 标记已定位，避免恢复自动跟随后对同一行再滚一次
        autoScrollKeyRef.current = makeAutoScrollKey(target);
      }
    }, IDLE_TIMEOUT_MS);
  }, [clearIdleTimer, makeAutoScrollKey, scrollToIndex, updateCenteredIndex]);

  /** 点中心行右侧播放按钮：从该行时间开始播放 */
  const handleSeekPlay = useCallback(async () => {
    const index =
      centeredIndex >= 0 ? centeredIndex : findCenteredIndex(offsetRef.current);
    if (index < 0) return;
    const targetTime = lyricsRef.current[index]?.time ?? 0;

    clearIdleTimer();
    interactingRef.current = false;
    setInteracting(false);
    setCenteredIndex(-1);
    scrollToIndex(index);
    autoScrollKeyRef.current = makeAutoScrollKey(index);

    try {
      await seekTo(targetTime);
      if (!isPlayingRef.current) await resume();
    } catch (error) {
      console.warn("[Lyrics] seek from line failed:", error);
    }
  }, [
    centeredIndex,
    findCenteredIndex,
    clearIdleTimer,
    scrollToIndex,
    makeAutoScrollKey,
    seekTo,
    resume,
  ]);

  /** 切歌：复位接管状态与自动滚动节流键（不清 lineLayouts，新行 onLayout 会覆盖） */
  useEffect(() => {
    if (prevTrackIdRef.current === trackId) return;
    prevTrackIdRef.current = trackId;
    clearIdleTimer();
    clearRetryTimer();
    interactingRef.current = false;
    setInteracting(false);
    setCenteredIndex(-1);
    offsetRef.current = 0;
    autoScrollKeyRef.current = "";
  }, [trackId, clearIdleTimer, clearRetryTimer]);

  useEffect(
    () => () => {
      clearIdleTimer();
      clearRetryTimer();
      if (relayoutRafRef.current !== null) cancelAnimationFrame(relayoutRafRef.current);
    },
    [clearIdleTimer, clearRetryTimer],
  );

  const handleBackgroundPress = useCallback(() => {
    // 拖动中 / 2s 倒计时内点歌词区不退出，避免误触打断选行
    if (interactingRef.current) return;
    onBackgroundPress?.();
  }, [onBackgroundPress]);

  const onContainerLayout = useCallback((e: any) => {
    const h = e.nativeEvent.layout.height;
    heightRef.current = h;
    setContainerHeight(h);
  }, []);

  const lines = lyrics.map((line, index) => (
    <AnimatedLyricLine
      key={index}
      text={line.text}
      isActive={index === activeIndex}
      colors={colors}
      lyricFontSize={lyricFontSize}
      lyricsColor={lyricsColor}
      lyricsActiveColor={lyricsActiveColor}
      lyricsAlign={lyricsAlign}
      onLayout={(e) => {
        const next = e.nativeEvent.layout as LayoutRectangle;
        const prev = lineLayouts.current[index];
        lineLayouts.current[index] = next;
        if (prev && Math.abs(prev.y - next.y) > 1) scheduleRelayout();
      }}
    />
  ));

  // 上下各留半个容器高度，首末行也能滚到视觉中心。
  // 必须放在「行容器」而不是 contentContainerStyle 上：否则行 onLayout.y 会
  // 少掉这段偏移，中心行判定与回弹位置会整体错半屏。
  const linesWrapperStyle = useMemo(
    () => [
      styles.linesWrapper,
      {
        paddingTop: containerHeight / 2,
        paddingBottom: containerHeight / 2,
      },
    ],
    [containerHeight],
  );

  // 无歌词：保留竖屏「点一下切回封面」的原有行为
  if (lyrics.length === 0) {
    return (
      <View style={styles.area}>
        <TouchableOpacity
          style={styles.noLyricsContainer}
          activeOpacity={onBackgroundPress ? 0.9 : 1}
          onPress={handleBackgroundPress}
        >
          <Text style={[styles.lyricsText, { color: colors.secondary }]}>
            {noLyricsText ?? ""}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const centeredLine = centeredIndex >= 0 ? lyrics[centeredIndex] : null;
  const seekRowHeight = Math.max(MIN_SEEK_ROW_HEIGHT, lyricFontSize * 2 + 12);

  return (
    <View style={styles.area}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scrollContent}
        onLayout={onContainerLayout}
        onScroll={onScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={scheduleIdleReset}
        onMomentumScrollEnd={scheduleIdleReset}
      >
        {onBackgroundPress ? (
          <TouchableOpacity
            activeOpacity={1}
            onPress={handleBackgroundPress}
            style={linesWrapperStyle}
          >
            {lines}
          </TouchableOpacity>
        ) : (
          <View style={linesWrapperStyle}>{lines}</View>
        )}
      </ScrollView>

      {interacting && centeredLine && (
        <View style={styles.seekOverlay} pointerEvents="box-none">
          <View
            style={[styles.seekRow, { height: seekRowHeight }]}
            pointerEvents="box-none"
          >
            <View style={[styles.seekEdge, styles.seekEdgeTop]} />
            <View style={[styles.seekEdge, styles.seekEdgeBottom]} />
            <View style={styles.seekTimeBadge}>
              <Text style={[styles.seekTime, { color: colors.text }]}>
                {formatLyricTime(centeredLine.time)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleSeekPlay}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.seekPlayButton}
              accessibilityLabel="从这行歌词开始播放"
            >
              <Ionicons name="play" size={18} color="#ffffff" style={styles.seekPlayIcon} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  area: {
    flex: 1,
    width: "100%",
  },
  scroll: {
    flex: 1,
    width: "100%",
  },
  scrollContent: {
    alignItems: "center",
    width: "100%",
    // 不设 minHeight:'100%'：上下 padding 已经各占半个容器高度，
    // 首末行自然可以滚到视觉中心，百分比高度在分栏/横屏下反而容易解析异常。
  },
  linesWrapper: {
    width: "100%",
    alignItems: "center",
  },
  lyricsLine: {
    textAlign: "center",
    marginVertical: 8,
    opacity: 0.6,
  },
  lyricsText: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
  noLyricsContainer: {
    flex: 1,
    justifyContent: "center",
    width: "100%",
    alignItems: "center",
  },
  // 中心操作条：absoluteFill + 居中，不依赖容器具体高度，横屏/Pad/分栏都成立
  seekOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  seekRow: {
    width: "100%",
    maxWidth: SEEK_ROW_MAX_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  seekEdge: {
    position: "absolute",
    left: 16,
    right: 16,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  seekEdgeTop: { top: 0 },
  seekEdgeBottom: { bottom: 0 },
  seekTimeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  seekTime: {
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.5,
  },
  seekPlayButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  seekPlayIcon: { marginLeft: 2 },
});
