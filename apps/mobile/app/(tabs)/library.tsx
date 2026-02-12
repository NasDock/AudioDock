import { AddToPlaylistModal } from "@/src/components/AddToPlaylistModal";
import { CachedImage } from "@/src/components/CachedImage";
import { FloatingActionButtons } from "@/src/components/FloatingActionButtons";
import { Ionicons } from "@expo/vector-icons";
import { getArtistList, loadMoreAlbum, loadMoreTrack } from "@soundx/services";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

const GAP = 15;
const SCREEN_PADDING = 40; // 20 horizontal padding * 2
const TARGET_WIDTH = 100; // Slightly smaller target for dense list

interface SongListProps {
  isSelectionMode: boolean;
  setIsSelectionMode: (value: boolean) => void;
  selectedTrackIds: (number | string)[];
  setSelectedTrackIds: (value: (number | string)[]) => void;
}

const SongList = ({
  isSelectionMode,
  setIsSelectionMode,
  selectedTrackIds,
  setSelectedTrackIds,
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
    if (index !== -1) {
      flatListRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5,
      });
    }
  };

  useEffect(() => {
    loadTracks();
  }, [mode]);

  const loadTracks = async () => {
    try {
      setLoading(true);
      const res = await loadMoreTrack({
        pageSize: 2000,
        loadCount: 0,
        type: mode,
      });

      if (res.code === 200 && res.data) {
        const { list } = res.data;
        const mappedTracks = list.map((item: any) =>
          item.track ? item.track : item,
        );
        setTracks(mappedTracks.sort((a, b) => a.name.localeCompare(b.name)));
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
      <ActivityIndicator
        size="large"
        color={colors.primary}
        style={{ marginTop: 20 }}
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
            flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
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
        locateDisabled={!currentTrack || !tracks.some(t => t.id === currentTrack.id)}
      />
    </>
  );
};

const ArtistList = () => {
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
    if (index !== -1) {
      flatListRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5,
      });
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
  }, [mode]);

  const loadArtists = async () => {
    try {
      setLoading(true);
      const res = await getArtistList(1000, 0, mode);

      if (res.code === 200 && res.data) {
        const { list } = res.data;
        setArtists(list.sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch (error) {
      console.error("Failed to load artists:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <ActivityIndicator
        size="large"
        color={colors.primary}
        style={{ marginTop: 20 }}
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
          flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
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
        locateDisabled={!currentTrack || !artists.some(a => a.name === currentTrack.artist)}
        onLocateCurrent={handleLocateCurrent}
      />
    </View>
  );
};

const AlbumList = () => {
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
    if (index !== -1) {
      flatListRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5,
      });
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
  }, [mode]);

  const loadAlbums = async () => {
    try {
      setLoading(true);
      const res = await loadMoreAlbum({
        pageSize: 1000,
        loadCount: 0,
        type: mode,
      });

      if (res.code === 200 && res.data) {
        const { list } = res.data;
        setAlbums(list.sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch (error) {
      console.error("Failed to load albums:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <ActivityIndicator
        size="large"
        color={colors.primary}
        style={{ marginTop: 20 }}
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
          flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
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
        locateDisabled={!currentTrack || !albums.some(a => a.name === currentTrack.album)}
        flatListRef={flatListRef}
        onLocateCurrent={handleLocateCurrent}
      />
    </View>
  );
};

export default function LibraryScreen() {
  const { colors, theme } = useTheme();
  const router = useRouter();
  const { mode, setMode } = usePlayMode();
  const { sourceType } = useAuth();
  const { playTrackList } = usePlayer();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<"songs" | "artists" | "albums">(
    "songs",
  );
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<(number | string)[]>(
    [],
  );

  useEffect(() => {
    // If we are in MUSIC mode, default to songs? Or keep artists?
    // User said "Songs tab (only visible in music mode), select to show all songs, position before artist"
    // So if mode is MUSIC, we might want to default to songs or let user switch.
    // Keeping "artists" as default might be fine, or switch if current tab is invalid.
    if (mode === "AUDIOBOOK" && activeTab === "songs") {
      setActiveTab("artists");
    }
    // Exit selection mode when switching tabs
    if (activeTab !== "songs") {
      setIsSelectionMode(false);
      setSelectedTrackIds([]);
    }
  }, [mode, activeTab]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={styles.header}>
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
                      });
                      if (res.code === 200 && res.data) {
                        const list = res.data.list;
                        const tracks = list.map((item: any) =>
                          item.track ? item.track : item,
                        );
                        playTrackList(tracks, 0);
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
            onPress={() => router.push("/folder" as any)}
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
        </View>
      </View>

      {activeTab === "songs" ? (
        <SongList
          isSelectionMode={isSelectionMode}
          setIsSelectionMode={setIsSelectionMode}
          selectedTrackIds={selectedTrackIds}
          setSelectedTrackIds={setSelectedTrackIds}
        />
      ) : activeTab === "artists" ? (
        <ArtistList />
      ) : (
        <AlbumList />
      )}
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
});
