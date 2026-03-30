import { AddToPlaylistModal } from "@/src/components/AddToPlaylistModal";
import { CachedImage } from "@/src/components/CachedImage";
import { FloatingActionButtons } from "@/src/components/FloatingActionButtons";
import SkeletonBlock from "@/src/components/SkeletonBlock";
import { Ionicons } from "@expo/vector-icons";
import { getArtistList, getCollections, loadMoreAlbum, loadMoreTrack } from "@soundx/services";
import { Image as ExpoImage } from "expo-image";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../src/context/AuthContext";
import { usePlayer } from "../../src/context/PlayerContext";
import { useTheme } from "../../src/context/ThemeContext";
import { Album, Artist, Track } from "../../src/models";
import { downloadTracks } from "../../src/services/downloadManager";
import { getImageUrl } from "../../src/utils/image";
import { usePlayMode } from "../../src/utils/playMode";
import { trackEvent } from "../../src/services/tracking";

const GAP = 15;
const SCREEN_PADDING = 40; // 20 horizontal padding * 2
const TARGET_WIDTH = 100; // Slightly smaller target for dense list
const SONG_SKELETON_COUNT = 9;
const GRID_SKELETON_COUNT = 12;

interface SongListProps {
  isSelectionMode: boolean;
  setIsSelectionMode: (value: boolean) => void;
  selectedTrackIds: (number | string)[];
  setSelectedTrackIds: (value: (number | string)[]) => void;
  heartbeatModeActive: boolean;
  onToggleHeartbeatMode: () => void;
}

const SongList = ({
  isSelectionMode,
  setIsSelectionMode,
  selectedTrackIds,
  setSelectedTrackIds,
  heartbeatModeActive,
  onToggleHeartbeatMode,
}: SongListProps) => {
  const { colors } = useTheme();
  const { mode } = usePlayMode();
  const { playTrackList } = usePlayer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);
  const flatListRef = useRef<FlatList<Track>>(null);
  const { currentTrack } = usePlayer();

  const handleLocateCurrent = () => {
    if (!currentTrack || !tracks.length) return;
    const index = tracks.findIndex((t) => t.id === currentTrack.id);
    if (index !== -1 && index < tracks.length) {
      try {
        flatListRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });
      } catch {
        const estimatedItemHeight = 68;
        flatListRef.current?.scrollToOffset({
          offset: Math.max(0, index * estimatedItemHeight),
          animated: true,
        });
      }
    }
  };

  useEffect(() => {
    loadTracks();
  }, [mode, heartbeatModeActive]);

  const loadTracks = async () => {
    try {
      setLoading(true);
      const res = await loadMoreTrack({
        pageSize: 2000,
        loadCount: 0,
        type: mode,
        sortBy: heartbeatModeActive ? "heartbeat" : undefined,
      });

      if (res.code === 200 && res.data) {
        const { list } = res.data;
        const mappedTracks = list.map((item: any) =>
          item.track ? item.track : item,
        );
        setTracks(
          heartbeatModeActive
            ? mappedTracks
            : mappedTracks.sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
    } catch (error) {
      console.error("Failed to load tracks:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleTrackSelection = (trackId: number | string) => {
    setSelectedTrackIds(
      selectedTrackIds.includes(trackId)
        ? selectedTrackIds.filter((id) => id !== trackId)
        : [...selectedTrackIds, trackId],
    );
  };

  const handleDownloadSelected = () => {
    const selectedTracks = tracks.filter((t) =>
      selectedTrackIds.includes(t.id),
    );
    if (selectedTracks.length === 0) {
      Alert.alert("提示", "请先选择要下载的曲目");
      return;
    }
    Alert.alert("批量下载", `确定要下载${selectedTrackIds?.length}首曲目吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "确定",
        onPress: () => {
          downloadTracks(selectedTracks, (completed: number, total: number) => {
            if (completed === total) {
              Alert.alert("下载完成", `已成功下载 ${total} 首曲目`);
              setIsSelectionMode(false);
              setSelectedTrackIds([]);
            }
          });
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SongListSkeleton
        isSelectionMode={isSelectionMode}
        showHeartbeatMode={mode === "MUSIC"}
        heartbeatModeActive={heartbeatModeActive}
      />
    );
  }

  return (
    <>
      <View style={styles.listContainer}>
        {isSelectionMode && (
          <View style={styles.selectionHeader}>
            <TouchableOpacity
              onPress={() => {
                if (selectedTrackIds.length === tracks.length) {
                  setSelectedTrackIds([]);
                } else {
                  setSelectedTrackIds(tracks.map((t) => t.id));
                }
              }}
            >
              <Ionicons name="list-outline" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Text style={[styles.selectionText, { color: colors.text }]}>
                已选择 {selectedTrackIds.length} 项
              </Text>
              <TouchableOpacity
                disabled={!selectedTrackIds.length}
                onPress={() => {
                  setAddToPlaylistVisible(true);
                }}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={24}
                  color={
                    selectedTrackIds.length ? colors.text : colors.secondary
                  }
                />
              </TouchableOpacity>
              <TouchableOpacity
                disabled={!selectedTrackIds.length}
                onPress={handleDownloadSelected}
              >
                <Ionicons
                  name="cloud-download-outline"
                  size={24}
                  color={
                    selectedTrackIds.length ? colors.text : colors.secondary
                  }
                />
              </TouchableOpacity>
            </View>
          </View>
        )}
        <FlatList
          ref={flatListRef}
          data={tracks}
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          keyExtractor={(item) => item.id.toString()}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatListRef.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: true,
              });
              setTimeout(() => {
                try {
                  flatListRef.current?.scrollToIndex({
                    index: info.index,
                    animated: true,
                    viewPosition: 0.5,
                  });
                } catch (e) {
                  /* ignore */
                }
              }, 100);
            }, 0);
          }}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              style={styles.songItem}
              onPress={() => {
                if (isSelectionMode) {
                  toggleTrackSelection(item.id);
                  return;
                }
                playTrackList(tracks, index);
              }}
            >
              {isSelectionMode ? (
                <View style={styles.checkboxContainer}>
                  <Ionicons
                    name={
                      selectedTrackIds.includes(item.id)
                        ? "checkbox"
                        : "square-outline"
                    }
                    size={24}
                    color={
                      selectedTrackIds.includes(item.id)
                        ? colors.primary
                        : colors.secondary
                    }
                  />
                </View>
              ) : (
                <CachedImage
                  source={{
                    uri: getImageUrl(
                      item.cover,
                      `https://picsum.photos/seed/${item.id}/100/100`,
                    ),
                  }}
                  style={styles.songImage}
                />
              )}
              <View style={styles.songInfo}>
                <Text
                  style={[styles.songTitle, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <Text
                  style={[styles.songArtist, { color: colors.secondary }]}
                  numberOfLines={1}
                >
                  {item.artist} · {item.album}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={10}
        />
      </View>
      <AddToPlaylistModal
        visible={addToPlaylistVisible}
        trackId={null}
        trackIds={selectedTrackIds}
        tracks={tracks}
        onClose={() => setAddToPlaylistVisible(false)}
      />
      <FloatingActionButtons
        flatListRef={flatListRef}
        onLocateCurrent={handleLocateCurrent}
        locateDisabled={
          !currentTrack || !tracks.some((t) => t.id === currentTrack.id)
        }
        showHeartbeatMode={mode === "MUSIC"}
        heartbeatModeActive={heartbeatModeActive}
        onToggleHeartbeatMode={onToggleHeartbeatMode}
      />
    </>
  );
};

const ArtistList = ({
  heartbeatModeActive,
  onToggleHeartbeatMode,
}: {
  heartbeatModeActive: boolean;
  onToggleHeartbeatMode: () => void;
}) => {
  const { colors } = useTheme();
  const router = useRouter();
  const { mode } = usePlayMode();
  const { width } = useWindowDimensions();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList<Artist>>(null);
  const { currentTrack } = usePlayer();

  const handleLocateCurrent = () => {
    if (!currentTrack || !artists.length) return;
    const index = artists.findIndex((a) => a.name === currentTrack.artist);
    if (index !== -1 && index < artists.length) {
      try {
        flatListRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });
      } catch {
        const rowIndex = Math.floor(index / numColumns);
        const rowHeight = itemWidth + 15;
        flatListRef.current?.scrollToOffset({
          offset: Math.max(0, rowIndex * rowHeight),
          animated: true,
        });
      }
    }
  };

  // Calculate columns dynamically
  const availableWidth = width - SCREEN_PADDING;
  const numColumns = Math.max(
    3,
    Math.floor((availableWidth + GAP) / (TARGET_WIDTH + GAP)),
  );
  const itemWidth = (availableWidth - (numColumns - 1) * GAP) / numColumns;

  useEffect(() => {
    loadArtists();
  }, [mode, heartbeatModeActive]);

  const loadArtists = async () => {
    try {
      setLoading(true);
      const res = await getArtistList(
        1000,
        0,
        mode,
        heartbeatModeActive ? "heartbeat" : undefined,
      );

      if (res.code === 200 && res.data) {
        const { list } = res.data;
        setArtists(
          heartbeatModeActive
            ? list
            : list.sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
    } catch (error) {
      console.error("Failed to load artists:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <GridListSkeleton
        itemWidth={itemWidth}
        numColumns={numColumns}
        circle
        showHeartbeatMode={mode === "MUSIC"}
        heartbeatModeActive={heartbeatModeActive}
      />
    );
  }

  return (
    <View style={styles.listContainer}>
      <FlatList
        ref={flatListRef}
        data={artists}
        numColumns={numColumns}
        columnWrapperStyle={{ gap: GAP, marginBottom: 15 }}
        style={{ flex: 1 }}
        key={`artist-list-${numColumns}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        keyExtractor={(item) => item.id.toString()}
        onScrollToIndexFailed={(info) => {
          const rowIndex = Math.floor(info.index / numColumns);
          const rowHeight = itemWidth + 15;
          const offset = rowIndex * rowHeight;
          setTimeout(() => {
            flatListRef.current?.scrollToOffset({ offset, animated: true });
            setTimeout(() => {
              try {
                flatListRef.current?.scrollToIndex({
                  index: info.index,
                  animated: true,
                  viewPosition: 0.5,
                });
              } catch (e) {
                /* ignore */
              }
            }, 100);
          }, 0);
        }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={{ width: itemWidth }}
            onPress={() => router.push(`/artist/${item.id}`)}
          >
            <CachedImage
              source={{
                uri: getImageUrl(
                  item.avatar,
                  `https://picsum.photos/seed/${item.id}/200/200`,
                ),
              }}
              style={[
                styles.image,
                {
                  width: itemWidth,
                  height: itemWidth,
                  backgroundColor: colors.card,
                },
              ]}
            />
            <Text
              style={[styles.name, { color: colors.text }]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
          </TouchableOpacity>
        )}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={10}
      />
      <FloatingActionButtons
        flatListRef={flatListRef}
        locateDisabled={
          !currentTrack || !artists.some((a) => a.name === currentTrack.artist)
        }
        onLocateCurrent={handleLocateCurrent}
        showHeartbeatMode={mode === "MUSIC"}
        heartbeatModeActive={heartbeatModeActive}
        onToggleHeartbeatMode={onToggleHeartbeatMode}
      />
    </View>
  );
};

const AlbumList = ({
  heartbeatModeActive,
  onToggleHeartbeatMode,
}: {
  heartbeatModeActive: boolean;
  onToggleHeartbeatMode: () => void;
}) => {
  const { colors } = useTheme();
  const router = useRouter();
  const { mode } = usePlayMode();
  const { width } = useWindowDimensions();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList<Album>>(null);
  const { currentTrack } = usePlayer();

  const handleLocateCurrent = () => {
    if (!currentTrack || !albums.length) return;
    const index = albums.findIndex((a) => a.name === currentTrack.album);
    if (index !== -1 && index < albums.length) {
      try {
        flatListRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });
      } catch (error) {
        // Calculate offset manually for grid layout
        const rowIndex = Math.floor(index / numColumns);
        // itemHeight + marginBottom (gap)
        const rowHeight = itemWidth + 15;
        const offset = rowIndex * rowHeight;

        flatListRef.current?.scrollToOffset({
          offset,
          animated: true,
        });
      }
    }
  };

  // Calculate columns dynamically
  const availableWidth = width - SCREEN_PADDING;
  const numColumns = Math.max(
    3,
    Math.floor((availableWidth + GAP) / (TARGET_WIDTH + GAP)),
  );
  const itemWidth = (availableWidth - (numColumns - 1) * GAP) / numColumns;

  useEffect(() => {
    loadAlbums();
  }, [mode, heartbeatModeActive]);

  const loadAlbums = async () => {
    try {
      setLoading(true);
      const res = await loadMoreAlbum({
        pageSize: 1000,
        loadCount: 0,
        type: mode,
        sortBy: heartbeatModeActive ? "heartbeat" : undefined,
      });

      if (res.code === 200 && res.data) {
        const { list } = res.data;
        setAlbums(
          heartbeatModeActive
            ? list
            : list.sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
    } catch (error) {
      console.error("Failed to load albums:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <GridListSkeleton
        itemWidth={itemWidth}
        numColumns={numColumns}
        showHeartbeatMode={mode === "MUSIC"}
        heartbeatModeActive={heartbeatModeActive}
      />
    );
  }

  return (
    <View style={styles.listContainer}>
      <FlatList
        ref={flatListRef}
        data={albums}
        numColumns={numColumns}
        key={`album-list-${numColumns}`}
        columnWrapperStyle={{ gap: GAP, marginBottom: 15 }}
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        keyExtractor={(item) => item.id.toString()}
        onScrollToIndexFailed={(info) => {
          const rowIndex = Math.floor(info.index / numColumns);
          const rowHeight = itemWidth + 15;
          const offset = rowIndex * rowHeight;
          setTimeout(() => {
            flatListRef.current?.scrollToOffset({ offset, animated: true });
            setTimeout(() => {
              try {
                flatListRef.current?.scrollToIndex({
                  index: info.index,
                  animated: true,
                  viewPosition: 0.5,
                });
              } catch (e) {
                /* ignore */
              }
            }, 100);
          }, 0);
        }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={{ width: itemWidth }}
            onPress={() => router.push(`/album/${item.id}`)}
          >
            <View
              style={[
                styles.albumImageContainer,
                { width: itemWidth, height: itemWidth },
              ]}
            >
              <CachedImage
                source={{
                  uri: getImageUrl(
                    item.cover,
                    `https://picsum.photos/seed/${item.id}/200/200`,
                  ),
                }}
                style={[
                  styles.albumImage,
                  {
                    width: itemWidth,
                    height: itemWidth,
                    backgroundColor: colors.card,
                  },
                ]}
              />
              {(item.type === "AUDIOBOOK" || mode === "AUDIOBOOK") &&
                (item as any).progress > 0 && (
                  <View style={styles.progressOverlay}>
                    <View
                      style={[
                        styles.progressBar,
                        {
                          width: `${item.progress || 0}%`,
                          backgroundColor: colors.primary,
                        },
                      ]}
                    />
                  </View>
                )}
            </View>
            <Text
              style={[styles.albumTitle, { color: colors.text }]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            <Text
              style={[styles.albumArtist, { color: colors.secondary }]}
              numberOfLines={1}
            >
              {item.artist}
            </Text>
          </TouchableOpacity>
        )}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={10}
      />
      <FloatingActionButtons
        locateDisabled={
          !currentTrack || !albums.some((a) => a.name === currentTrack.album)
        }
        flatListRef={flatListRef}
        onLocateCurrent={handleLocateCurrent}
        showHeartbeatMode={mode === "MUSIC"}
        heartbeatModeActive={heartbeatModeActive}
        onToggleHeartbeatMode={onToggleHeartbeatMode}
      />
    </View>
  );
};

const CollectionList = () => {
  const { colors } = useTheme();
  const router = useRouter();
  const { mode } = usePlayMode();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const [collections, setCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Calculate columns dynamically
  const availableWidth = width - SCREEN_PADDING;
  const numColumns = Math.max(
    2,
    Math.floor((availableWidth + GAP) / (TARGET_WIDTH + GAP)),
  );
  const itemWidth = (availableWidth - (numColumns - 1) * GAP) / numColumns;

  useEffect(() => {
    if (mode !== "AUDIOBOOK" || !user) return;
    loadCollections();
  }, [mode, user]);

  const loadCollections = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const res = await getCollections(user.id);
      if (res.code === 200 && res.data) {
        setCollections(res.data);
      }
    } catch (error) {
      console.error("Failed to load collections:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <GridListSkeleton itemWidth={itemWidth} numColumns={numColumns} />;
  }

  return (
    <View style={styles.listContainer}>
      <FlatList
        data={collections}
        numColumns={numColumns}
        key={`collection-list-${numColumns}`}
        columnWrapperStyle={{ gap: GAP, marginBottom: 15 }}
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => {
          const previewCover =
            item.cover || item.items?.[0]?.album?.cover || null;
          const count = item._count?.items ?? item.items?.length ?? 0;
          return (
            <TouchableOpacity
              style={{ width: itemWidth }}
              onPress={() =>
                router.push({
                  pathname: "/collection/[id]",
                  params: { id: String(item.id) },
                })
              }
            >
              <View
                style={[
                  styles.albumImageContainer,
                  { width: itemWidth, height: itemWidth },
                ]}
              >
                <CachedImage
                  source={{
                    uri: getImageUrl(
                      previewCover,
                      `https://picsum.photos/seed/collection-${item.id}/200/200`,
                    ),
                  }}
                  style={[
                    styles.albumImage,
                    {
                      width: itemWidth,
                      height: itemWidth,
                      backgroundColor: colors.card,
                    },
                  ]}
                />
              </View>
              <Text
                style={[styles.collectionTitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              <Text
                style={[styles.collectionMeta, { color: colors.secondary }]}
                numberOfLines={1}
              >
                {count} 张专辑
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
};

export default function LibraryScreen() {
  const { colors, theme } = useTheme();
  const router = useRouter();
  const { mode, setMode } = usePlayMode();
  const { sourceType, user, device } = useAuth();
  const { playTrackList } = usePlayer();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<"songs" | "artists" | "albums" | "collections">(
    "songs",
  );
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<(number | string)[]>(
    [],
  );
  const [heartbeatModeActive, setHeartbeatModeActive] = useState(false);
  const swingAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(swingAnim, {
          toValue: 1,
          duration: 3000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(swingAnim, {
          toValue: 0,
          duration: 3000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, []);

  useEffect(() => {
    // If we are in MUSIC mode, default to songs? Or keep artists?
    // User said "Songs tab (only visible in music mode), select to show all songs, position before artist"
    // So if mode is MUSIC, we might want to default to songs or let user switch.
    // Keeping "artists" as default might be fine, or switch if current tab is invalid.
    if (mode === "AUDIOBOOK" && activeTab === "songs") {
      setActiveTab("artists");
    }
    if (mode !== "AUDIOBOOK" && activeTab === "collections") {
      setActiveTab("artists");
    }
    // Exit selection mode when switching tabs
    if (activeTab !== "songs") {
      setIsSelectionMode(false);
      setSelectedTrackIds([]);
    }
  }, [mode, activeTab]);

  useEffect(() => {
    if (mode !== "MUSIC" && heartbeatModeActive) {
      setHeartbeatModeActive(false);
    }
  }, [mode, heartbeatModeActive]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={styles.header}>
        {theme === 'festive' && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 60,
              top: -5,
              opacity: 0.6,
            }}
          >
            <ExpoImage
              source={require("../../assets/dexopt/baozhu.svg")}
              style={{ width: 45, height: 45 }}
              contentFit="contain"
            />
          </View>
        )}
        <Text style={[styles.headerTitle, { color: colors.text }]}>声仓</Text>
        <View style={styles.headerRight}>
          {mode === "MUSIC" && activeTab === "songs" && (
            <>
              {isSelectionMode ? (
                <TouchableOpacity
                  onPress={() => {
                    setIsSelectionMode(false);
                    setSelectedTrackIds([]);
                  }}
                  style={[
                    styles.iconButton,
                    { backgroundColor: colors.card, marginRight: 12 },
                  ]}
                >
                  <Ionicons name="close" size={20} color={colors.primary} />
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    onPress={() => {
                      setIsSelectionMode(true);
                      setSelectedTrackIds([]);
                    }}
                    style={[
                      styles.iconButton,
                      { backgroundColor: colors.card, marginRight: 12 },
                    ]}
                  >
                    <Ionicons
                      name="list-outline"
                      size={20}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={async () => {
                      const res = await loadMoreTrack({
                        pageSize: 2000,
                        loadCount: 0,
                        type: "MUSIC",
                        sortBy: heartbeatModeActive ? "heartbeat" : undefined,
                      });
                      if (res.code === 200 && res.data) {
                        const list = res.data.list;
                        const tracks = list.map((item: any) =>
                          item.track ? item.track : item,
                        );
                        const finalTracks = heartbeatModeActive
                          ? tracks
                          : tracks.sort((a, b) => a.name.localeCompare(b.name));
                        playTrackList(finalTracks, 0);
                      }
                    }}
                    style={[
                      styles.iconButton,
                      { backgroundColor: colors.card, marginRight: 12 },
                    ]}
                  >
                    <Ionicons name="play" size={20} color={colors.primary} />
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
          <TouchableOpacity
            onPress={() => {
              trackEvent({
                feature: "library",
                eventName: "folder_mode_entry",
                userId: user?.id ? String(user.id) : undefined,
                deviceId: device?.id ? String(device.id) : undefined,
              });
              router.push("/folder" as any);
            }}
            style={[
              styles.iconButton,
              { backgroundColor: colors.card, marginRight: 12 },
            ]}
          >
            <Ionicons name="folder-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/search")}
            style={[styles.iconButton, { backgroundColor: colors.card }]}
          >
            <Ionicons name="search" size={20} color={colors.primary} />
          </TouchableOpacity>
          {sourceType !== "Subsonic" && (
            <TouchableOpacity
              onPress={() => setMode(mode === "MUSIC" ? "AUDIOBOOK" : "MUSIC")}
              style={[
                styles.iconButton,
                { backgroundColor: colors.card, marginLeft: 12 },
              ]}
            >
              <Ionicons
                name={mode === "MUSIC" ? "musical-notes" : "headset"}
                size={20}
                color={colors.primary}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.tabContent}>
        <View
          style={[
            styles.segmentedControl,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {mode === "MUSIC" && (
            <TouchableOpacity
              style={[
                styles.segmentItem,
                activeTab === "songs" && { backgroundColor: colors.primary },
              ]}
              onPress={() => setActiveTab("songs")}
            >
              <Text
                style={[
                  styles.segmentText,
                  {
                    color:
                      activeTab === "songs"
                        ? colors.background
                        : colors.secondary,
                  },
                ]}
              >
                单曲
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.segmentItem,
              activeTab === "artists" && { backgroundColor: colors.primary },
            ]}
            onPress={() => setActiveTab("artists")}
          >
            <Text
              style={[
                styles.segmentText,
                {
                  color:
                    activeTab === "artists"
                      ? colors.background
                      : colors.secondary,
                },
              ]}
            >
              艺术家
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.segmentItem,
              activeTab === "albums" && { backgroundColor: colors.primary },
            ]}
            onPress={() => setActiveTab("albums")}
          >
            <Text
              style={[
                styles.segmentText,
                {
                  color:
                    activeTab === "albums"
                      ? colors.background
                      : colors.secondary,
                },
              ]}
            >
              专辑
            </Text>
          </TouchableOpacity>
          {mode === "AUDIOBOOK" && (
            <TouchableOpacity
              style={[
                styles.segmentItem,
                activeTab === "collections" && { backgroundColor: colors.primary },
              ]}
              onPress={() => setActiveTab("collections")}
            >
              <Text
                style={[
                  styles.segmentText,
                  {
                    color:
                      activeTab === "collections"
                        ? colors.background
                        : colors.secondary,
                  },
                ]}
              >
                合集
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {activeTab === "songs" ? (
        <SongList
          isSelectionMode={isSelectionMode}
          setIsSelectionMode={setIsSelectionMode}
          selectedTrackIds={selectedTrackIds}
          setSelectedTrackIds={setSelectedTrackIds}
          heartbeatModeActive={heartbeatModeActive}
          onToggleHeartbeatMode={() =>
            setHeartbeatModeActive((prev) => !prev)
          }
        />
      ) : activeTab === "artists" ? (
        <ArtistList
          heartbeatModeActive={heartbeatModeActive}
          onToggleHeartbeatMode={() =>
            setHeartbeatModeActive((prev) => !prev)
          }
        />
      ) : activeTab === "albums" ? (
        <AlbumList
          heartbeatModeActive={heartbeatModeActive}
          onToggleHeartbeatMode={() =>
            setHeartbeatModeActive((prev) => !prev)
          }
        />
      ) : (
        <CollectionList />
      )}
    </View>
  );
}

function SongListSkeleton({
  isSelectionMode,
  showHeartbeatMode,
  heartbeatModeActive,
}: {
  isSelectionMode: boolean;
  showHeartbeatMode: boolean;
  heartbeatModeActive: boolean;
}) {
  return (
    <View style={styles.listContainer}>
      {isSelectionMode && (
        <View style={styles.selectionHeader}>
          <SkeletonBlock width={24} height={24} borderRadius={12} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <SkeletonBlock width={96} height={18} borderRadius={9} />
            <SkeletonBlock width={24} height={24} borderRadius={12} />
            <SkeletonBlock width={24} height={24} borderRadius={12} />
          </View>
        </View>
      )}
      <View style={styles.listContent}>
        {Array.from({ length: SONG_SKELETON_COUNT }).map((_, index) => (
          <View key={index} style={styles.songItem}>
            {isSelectionMode ? (
              <View style={styles.checkboxContainer}>
                <SkeletonBlock width={24} height={24} borderRadius={12} />
              </View>
            ) : (
              <SkeletonBlock
                width={styles.songImage.width}
                height={styles.songImage.height}
                borderRadius={styles.songImage.borderRadius}
                style={{ marginRight: styles.songImage.marginRight }}
              />
            )}
            <View style={styles.songInfo}>
              <SkeletonBlock
                width={index % 3 === 0 ? "58%" : index % 3 === 1 ? "72%" : "66%"}
                height={16}
                borderRadius={8}
                style={{ marginBottom: 8 }}
              />
              <SkeletonBlock
                width={index % 2 === 0 ? "42%" : "55%"}
                height={12}
                borderRadius={6}
              />
            </View>
          </View>
        ))}
      </View>
      {showHeartbeatMode && (
        <LibraryFloatingSkeleton
          showLocate={false}
          showHeartbeatMode
          heartbeatModeActive={heartbeatModeActive}
        />
      )}
    </View>
  );
}

function GridListSkeleton({
  itemWidth,
  numColumns,
  circle = false,
  showHeartbeatMode = false,
  heartbeatModeActive = false,
}: {
  itemWidth: number;
  numColumns: number;
  circle?: boolean;
  showHeartbeatMode?: boolean;
  heartbeatModeActive?: boolean;
}) {
  const rows = Math.ceil(GRID_SKELETON_COUNT / numColumns);

  return (
    <View style={styles.listContainer}>
      <View style={styles.listContent}>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <View
            key={rowIndex}
            style={{ flexDirection: "row", gap: GAP, marginBottom: 15 }}
          >
            {Array.from({ length: numColumns }).map((__, colIndex) => {
              const index = rowIndex * numColumns + colIndex;
              if (index >= GRID_SKELETON_COUNT) {
                return <View key={colIndex} style={{ width: itemWidth }} />;
              }

              return (
                <View key={colIndex} style={{ width: itemWidth }}>
                  <SkeletonBlock
                    width={itemWidth}
                    height={itemWidth}
                    borderRadius={circle ? itemWidth / 2 : styles.albumImageContainer.borderRadius}
                    style={{ marginBottom: 8, alignSelf: "center" }}
                  />
                  <SkeletonBlock
                    width={circle ? itemWidth * 0.72 : itemWidth * 0.8}
                    height={14}
                    borderRadius={7}
                    style={{
                      marginBottom: 6,
                      alignSelf: circle ? "center" : "flex-start",
                    }}
                  />
                  <SkeletonBlock
                    width={circle ? itemWidth * 0.52 : itemWidth * 0.58}
                    height={12}
                    borderRadius={6}
                    style={{
                      alignSelf: circle ? "center" : "flex-start",
                    }}
                  />
                </View>
              );
            })}
          </View>
        ))}
      </View>
      {showHeartbeatMode && (
        <LibraryFloatingSkeleton
          showLocate
          showHeartbeatMode
          heartbeatModeActive={heartbeatModeActive}
        />
      )}
    </View>
  );
}

function LibraryFloatingSkeleton({
  showLocate,
  showHeartbeatMode,
  heartbeatModeActive,
}: {
  showLocate: boolean;
  showHeartbeatMode: boolean;
  heartbeatModeActive: boolean;
}) {
  return (
    <View style={styles.skeletonFloatingContainer}>
      <SkeletonBlock width={38} height={38} borderRadius={19} />
      {showLocate && <SkeletonBlock width={38} height={38} borderRadius={19} />}
      {showHeartbeatMode && (
        <SkeletonBlock
          width={38}
          height={38}
          borderRadius={19}
          style={{ opacity: heartbeatModeActive ? 0.95 : undefined }}
        />
      )}
      <SkeletonBlock width={38} height={38} borderRadius={19} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContainer: {
    flex: 1,
  },
  tabContent: {
    paddingHorizontal: 20,
    paddingBottom: 15,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginTop: 20,
    paddingBottom: 15,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconButton: {
    padding: 8,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  segmentedControl: {
    flexDirection: "row",
    height: 40,
    borderRadius: 20,
    padding: 2,
    borderWidth: 1,
  },
  segmentItem: {
    flex: 1,
    height: "100%",
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "bold",
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  sectionHeader: {
    paddingVertical: 10,
    marginBottom: 10,
  },
  sectionHeaderText: {
    fontSize: 18,
    fontWeight: "bold",
  },
  row: {
    flexDirection: "row",
    marginBottom: 15,
  },
  // Removed fixed Width styles
  image: {
    borderRadius: 999, // circle
    marginBottom: 8,
    backgroundColor: "#f0f0f0",
    alignSelf: "center",
  },
  name: {
    fontSize: 14,
    textAlign: "center",
    color: "#333",
  },
  collectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "left",
    marginBottom: 4,
  },
  collectionMeta: {
    fontSize: 12,
    textAlign: "left",
  },
  albumImageContainer: {
    borderRadius: 15,
    overflow: "hidden",
    position: "relative",
    marginBottom: 8,
  },
  albumImage: {
    backgroundColor: "#f0f0f0",
  },
  progressOverlay: {
    position: "absolute",
    bottom: 5,
    left: 3,
    right: 3,
    height: 4,
    width: 120 - 6,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
  progressBar: {
    height: "100%",
  },
  albumTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  albumArtist: {
    fontSize: 12,
  },
  songItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 0,
  },
  songImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
    marginRight: 12,
  },
  songInfo: {
    flex: 1,
    justifyContent: "center",
  },
  songTitle: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 2,
  },
  songArtist: {
    fontSize: 13,
  },
  selectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(150,150,150,0.1)",
  },
  selectionText: {
    fontSize: 16,
    fontWeight: "600",
  },
  checkboxContainer: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  skeletonFloatingContainer: {
    position: "absolute",
    right: 20,
    bottom: 150,
    gap: 12,
    zIndex: 100,
  },
});
