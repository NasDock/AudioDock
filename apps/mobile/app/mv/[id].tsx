import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  Alert,
  Image,
  FlatList,
} from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Slider } from "@miblanchard/react-native-slider";
import SkeletonBlock from "@/src/components/SkeletonBlock";
import { useTheme } from "../../src/context/ThemeContext";
import { useAuth } from "../../src/context/AuthContext";
import { isMvSupported } from "../../src/utils/mvSupport";
import { getMvById, getMvByTrackId, type Mv } from "@soundx/services";
import { getImageUrl } from "../../src/utils/image";
import { getBaseURL } from "../../src/https";
import { usePlayer } from "../../src/context/PlayerContext";
import { mvPlaylistStore } from "../../src/store/mvPlaylist";

const formatTime = (seconds: number) => {
  if (!seconds || isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
};

export default function MvScreen() {
  const { id, trackId } = useLocalSearchParams<{ id?: string; trackId?: string }>();
  const isTrackMode = trackId !== undefined;
  const targetId = trackId ?? id;

  const { colors } = useTheme();
  const { sourceType } = useAuth();
  const mvSupported = isMvSupported(sourceType);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { pause } = usePlayer();

  const [mv, setMv] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentMvId, setCurrentMvId] = useState<string | null>(targetId ?? null);

  const [controlsVisible, setControlsVisible] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const videoViewRef = useRef<VideoView>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playlistState = useSyncExternalStore(
    mvPlaylistStore.subscribe,
    mvPlaylistStore.getState,
  );
  const inPlaylist = playlistState.list.length > 1;
  const displayPlaylist = playlistState.list.length > 0
    ? playlistState.list
    : mv
      ? [mv]
      : [];
  const displayCurrentIndex = playlistState.list.length > 0 ? playlistState.currentIndex : 0;

  const handlePlayMv = (targetMv: Mv) => {
    const targetIndex = playlistState.list.findIndex((item) => item.id === targetMv.id);
    if (targetIndex >= 0) {
      mvPlaylistStore.setPlaylist(playlistState.list, targetIndex);
    }
    setCurrentMvId(String(targetMv.id));
  };

  const handlePrevMv = () => {
    const prevMv = mvPlaylistStore.prev();
    if (prevMv) {
      setCurrentMvId(String(prevMv.id));
    }
  };

  const handleNextMv = () => {
    const nextMv = mvPlaylistStore.next();
    if (nextMv) {
      setCurrentMvId(String(nextMv.id));
    }
  };

  const togglePlayback = () => {
    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  const showControlsTemporarily = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setControlsVisible(false);
      }
    }, 3000);
  };

  const toggleFullscreen = () => {
    if (isFullscreen) {
      videoViewRef.current?.exitFullscreen();
    } else {
      videoViewRef.current?.enterFullscreen();
    }
  };

  // 注意：这是视频地址不是图片，不能用 getImageUrl —— 那个是封面/头像专用的分级加载工具
  const videoSource = mv?.path
    ? mv.path.startsWith("http")
      ? mv.path
      : `${getBaseURL()}${mv.path.split("/").map(encodeURIComponent).join("/")}`
    : null;
  const player = useVideoPlayer(videoSource, (player) => {
    player.loop = !inPlaylist;
    player.timeUpdateEventInterval = 1;
    player.play();
  });

  useEffect(() => {
    // 飞牛音乐没有 MV 能力：入口已隐藏，深链/历史栈进来直接退回，也不要暂停正在播放的音频
    if (!mvSupported) {
      router.back();
      return;
    }
    pause();
    if (!currentMvId) {
      return;
    }

    const fetchMv = async () => {
      try {
        setLoading(true);
        const playlistItem = playlistState.list.find(
          (item) => String(item.id) === currentMvId,
        );
        if (playlistItem) {
          setMv(playlistItem);
        } else {
          const res = isTrackMode
            ? await getMvByTrackId(Number(currentMvId))
            : await getMvById(Number(currentMvId));
          if (res && res.path) {
            setMv(res);
          } else {
            Alert.alert("Error", "MV not found or invalid.");
          }
        }
      } catch (error) {
        console.error("Failed to load MV:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchMv();
  }, [pause, currentMvId, isTrackMode, playlistState.list, mvSupported, router]);

  // Listen for playback end in playlist mode
  useEffect(() => {
    if (!inPlaylist || !player) return;
    const subscription = player.addListener(
      "statusChange" as any,
      ({ status }: { status: string }) => {
        if (status === "idle" && player.currentTime > 0) {
          const nextMv = mvPlaylistStore.next();
          if (nextMv) {
            setCurrentMvId(String(nextMv.id));
          }
        }
      },
    );
    return () => subscription?.remove();
  }, [inPlaylist, player]);

  useEffect(() => {
    if (!player) return;
    setIsPlaying(player.playing);
    const sub1 = player.addListener(
      "playingChange" as any,
      ({ isPlaying: nextIsPlaying }: { isPlaying: boolean }) => {
        setIsPlaying(nextIsPlaying);
      },
    );
    const sub2 = player.addListener(
      "timeUpdate" as any,
      ({ currentTime }: { currentTime: number }) => {
        setCurrentTime(currentTime);
      },
    );
    const sub3 = player.addListener(
      "sourceLoad" as any,
      ({ duration }: { duration: number }) => {
        setDuration(duration);
      },
    );
    return () => {
      sub1?.remove();
      sub2?.remove();
      sub3?.remove();
    };
  }, [player, mv?.id]);

  useEffect(() => {
    showControlsTemporarily();
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mv?.id]);

  const hasPrev = mvPlaylistStore.hasPrev();
  const hasNext = mvPlaylistStore.hasNext();

  if (loading) {
    return <MvDetailSkeleton />;
  }

  if (!mv) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, justifyContent: "center", alignItems: "center" },
        ]}
      >
        <Text style={{ color: colors.text }}>MV not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
          <Text style={{ color: colors.primary }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {mv.name}
          </Text>
          <Text style={[styles.artist, { color: colors.secondary }]} numberOfLines={1}>
            {mv.artist}
          </Text>
        </View>
      </View>

      <View style={styles.content}>
        {videoSource && (
          <View style={[styles.videoFrame, { width, height: width * (9 / 16) }]}>
            <VideoView
              ref={videoViewRef}
              style={styles.video}
              player={player}
              allowsPictureInPicture
              nativeControls={false}
              showsTimecodes={false}
              fullscreenOptions={{
                enable: true,
                orientation: "landscape",
                autoExitOnRotate: true,
              }}
              onFullscreenEnter={() => setIsFullscreen(true)}
              onFullscreenExit={() => setIsFullscreen(false)}
            />

            {!controlsVisible && (
              <TouchableOpacity
                activeOpacity={1}
                onPress={showControlsTemporarily}
                style={styles.videoTouchArea}
              />
            )}

            {controlsVisible && (
              <View style={styles.controlsOverlay} pointerEvents="box-none">
                <TouchableOpacity
                  style={styles.centerPlayBtn}
                  onPress={() => {
                    togglePlayback();
                    showControlsTemporarily();
                  }}
                >
                  <Ionicons
                    name={isPlaying ? "pause" : "play"}
                    size={48}
                    color="#fff"
                  />
                </TouchableOpacity>

                <View style={styles.bottomControls} pointerEvents="box-none">
                  <View style={styles.progressRow}>
                    <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
                    <Slider
                      containerStyle={{ flex: 1, height: 30, marginHorizontal: 8 }}
                      minimumValue={0}
                      maximumValue={duration || 1}
                      value={Math.min(currentTime, duration || 1)}
                      onValueChange={(value) => {
                        const val = Array.isArray(value) ? value[0] : value;
                        setCurrentTime(val);
                      }}
                      onSlidingComplete={(value) => {
                        const val = Array.isArray(value) ? value[0] : value;
                        player.currentTime = val;
                        showControlsTemporarily();
                      }}
                      minimumTrackTintColor={colors.primary}
                      maximumTrackTintColor="rgba(255,255,255,0.3)"
                      thumbTintColor={colors.primary}
                    />
                    <Text style={styles.timeText}>{formatTime(duration)}</Text>
                  </View>

                  <View style={styles.controlButtonsRow} pointerEvents="box-none">
                    <View style={styles.leftControls} pointerEvents="box-none">
                      <TouchableOpacity
                        style={[styles.controlBtn, !hasPrev && styles.controlBtnDisabled]}
                        onPress={() => {
                          handlePrevMv();
                          showControlsTemporarily();
                        }}
                        disabled={!hasPrev}
                      >
                        <Ionicons
                          name="play-skip-back"
                          size={22}
                          color={hasPrev ? "#fff" : "rgba(255,255,255,0.35)"}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.playBtn}
                        onPress={() => {
                          togglePlayback();
                          showControlsTemporarily();
                        }}
                      >
                        <Ionicons
                          name={isPlaying ? "pause" : "play"}
                          size={30}
                          color="#fff"
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.controlBtn, !hasNext && styles.controlBtnDisabled]}
                        onPress={() => {
                          handleNextMv();
                          showControlsTemporarily();
                        }}
                        disabled={!hasNext}
                      >
                        <Ionicons
                          name="play-skip-forward"
                          size={22}
                          color={hasNext ? "#fff" : "rgba(255,255,255,0.35)"}
                        />
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      style={styles.controlBtn}
                      onPress={() => {
                        toggleFullscreen();
                        showControlsTemporarily();
                      }}
                    >
                      <Ionicons
                        name={isFullscreen ? "contract" : "expand"}
                        size={22}
                        color="#fff"
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}
        {displayPlaylist.length > 0 && (
          <View style={styles.playlistSection}>
            <View style={styles.playlistHeader}>
              <Text style={[styles.playlistCount, { color: colors.secondary }]}>
                <Text style={[styles.playlistTitle, { color: colors.text }]}>待播放 MV</Text> (
                {displayCurrentIndex + 1} / {displayPlaylist.length})
              </Text>
            </View>
            <FlatList
              data={displayPlaylist}
              keyExtractor={(item) => String(item.id)}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
              renderItem={({ item, index }) => {
                const isActive = item.id === mv?.id;
                return (
                  <TouchableOpacity
                    style={[
                      styles.playlistItem,
                      { borderBottomColor: colors.border },
                      isActive && { backgroundColor: colors.primary + "18" },
                    ]}
                    onPress={() => {
                      if (!isActive) handlePlayMv(item);
                    }}
                  >
                    <Text
                      style={[
                        styles.playlistItemIndex,
                        { color: isActive ? colors.primary : colors.secondary },
                      ]}
                    >
                      {index + 1}
                    </Text>
                    <Image
                      source={{
                        uri: getImageUrl(
                          item.cover,
                          `https://picsum.photos/seed/mv-${item.id}/80/45`,
                          96,
                        ),
                      }}
                      style={styles.playlistItemCover}
                    />
                    <View style={styles.playlistItemInfo}>
                      <Text
                        style={[
                          styles.playlistItemName,
                          { color: isActive ? colors.primary : colors.text },
                        ]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      {item.artist && (
                        <Text
                          style={[styles.playlistItemArtist, { color: colors.secondary }]}
                          numberOfLines={1}
                        >
                          {item.artist}
                        </Text>
                      )}
                    </View>
                    {isActive && <Ionicons name="play" size={16} color={colors.primary} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    paddingBottom: 10,
  },
  backBtn: {
    padding: 5,
  },
  headerInfo: {
    flex: 1,
    marginLeft: 10,
  },
  title: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  artist: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
  },
  content: {
    flex: 1,
    alignItems: "center",
    paddingTop: 6,
  },
  videoFrame: {
    backgroundColor: "#000",
  },
  videoTouchArea: {
    ...StyleSheet.absoluteFillObject,
  },
  video: {
    width: "100%",
    height: "100%",
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  centerPlayBtn: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -36,
    marginLeft: -36,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  bottomControls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  timeText: {
    color: "#fff",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    minWidth: 36,
    textAlign: "center",
  },
  controlButtonsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  leftControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  controlsSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    marginTop: 18,
    marginBottom: 22,
  },
  controlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  controlBtnDisabled: {
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  playlistSection: {
    width: "100%",
    paddingHorizontal: 16,
    flex: 1,
    minHeight: 0,
  },
  playlistHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  playlistTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  playlistCount: {
    fontSize: 12,
  },
  skeletonHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    paddingBottom: 10,
  },
  skeletonInfo: {
    flex: 1,
    marginLeft: 10,
  },
  skeletonVideoFrame: {
    overflow: "hidden",
  },
  playlistItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    gap: 10,
  },
  playlistItemIndex: {
    width: 24,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "500",
  },
  playlistItemCover: {
    width: 64,
    height: 36,
    borderRadius: 4,
  },
  playlistItemInfo: {
    flex: 1,
  },
  playlistItemName: {
    fontSize: 14,
    fontWeight: "500",
  },
  playlistItemArtist: {
    fontSize: 11,
    marginTop: 2,
  },
});

function MvDetailSkeleton() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.skeletonHeader}>
        <View style={styles.backBtn}>
          <SkeletonBlock width={28} height={28} borderRadius={14} />
        </View>
        <View style={styles.skeletonInfo}>
          <SkeletonBlock width="52%" height={18} borderRadius={9} style={{ marginBottom: 8 }} />
          <SkeletonBlock width="30%" height={12} borderRadius={6} />
        </View>
      </View>

      <View style={styles.content}>
        <SkeletonBlock
          width={width}
          height={width * (9 / 16)}
          borderRadius={0}
          style={styles.skeletonVideoFrame}
        />
      </View>
    </View>
  );
}
