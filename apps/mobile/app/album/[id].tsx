import { AddToPlaylistModal } from "@/src/components/AddToPlaylistModal";
import { AlbumMoreModal } from "@/src/components/AlbumMoreModal";
import PlayingIndicator from "@/src/components/PlayingIndicator";
import { TrackMoreModal } from "@/src/components/TrackMoreModal";
import { useAuth } from "@/src/context/AuthContext";
import { usePlayer } from "@/src/context/PlayerContext";
import { useTheme } from "@/src/context/ThemeContext";
import { Album, Track } from "@/src/models";
import { downloadTracks } from "@/src/services/downloadManager";
import { getImageUrl } from "@/src/utils/image";
import { Ionicons } from "@expo/vector-icons";
import {
    getAlbumById,
    getAlbumTracks,
    toggleAlbumLike,
    toggleAlbumUnLike,
} from "@soundx/services";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

export default function AlbumDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const { playTrack, playTrackList, currentTrack, isPlaying, seekTo, position } =
    usePlayer();
  const { user } = useAuth();
  const [album, setAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [sortBy, setSortBy] = useState<"id" | "index" | "episodeNumber">("episodeNumber");
  const [total, setTotal] = useState(0);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [moreModalVisible, setMoreModalVisible] = useState(false);
  const [albumMoreVisible, setAlbumMoreVisible] = useState(false);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<(number | string)[]>([]);

  const PAGE_SIZE = 20000;

  useEffect(() => {
    if (id) {
      loadData(id as string, sort, sortBy);
    }
  }, [id, sort, sortBy]);

  const loadData = async (albumId: number | string, currentSort: "asc" | "desc", currentSortBy: "id" | "index" | "episodeNumber") => {
    try {
      setLoading(true);
      const [albumRes, tracksRes] = await Promise.all([
        getAlbumById(albumId),
        getAlbumTracks(albumId, PAGE_SIZE, 0, currentSort, undefined, user?.id, currentSortBy),
      ]);

      if (albumRes.code === 200) {
        setAlbum(albumRes.data);
        const likedByUsers = albumRes.data.likedByUsers || [];
        const isLikedByCurrentUser = likedByUsers.some(
          (like: any) => like.userId === user?.id
        );
        setIsLiked(isLikedByCurrentUser);
      }
      if (tracksRes.code === 200) {
        setTracks(tracksRes.data.list);
        setTotal(tracksRes.data.total);
        setHasMore(tracksRes.data.list.length < tracksRes.data.total);
      }
    } catch (error) {
      console.error("Failed to load album details:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore || !album) return;

    try {
      setLoadingMore(true);
      const res = await getAlbumTracks(album.id, PAGE_SIZE, tracks.length, sort, undefined, user?.id, sortBy);
      if (res.code === 200) {
        const newList = [...tracks, ...res.data.list];
        setTracks(newList);
        setHasMore(newList.length < res.data.total);
      }
    } catch (error) {
      console.error("Failed to load more tracks:", error);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleToggleLike = async () => {
    if (!user || !album) return;
    try {
      const res = isLiked
        ? await toggleAlbumUnLike(album.id, user.id)
        : await toggleAlbumLike(album.id, user.id);

      if (res.code === 200) {
        setIsLiked(!isLiked);
      }
    } catch (error) {
      console.error("Failed to toggle album like:", error);
    }
  };

  const toggleTrackSelection = (trackId: number | string) => {
    setSelectedTrackIds((prev) =>
      prev.includes(trackId)
        ? prev.filter((id) => id !== trackId)
        : [...prev, trackId]
    );
  };

  const handleDownloadSelected = () => {
    const selectedTracks = tracks.filter((t) =>
      selectedTrackIds.includes(t.id)
    );
    if (selectedTracks.length === 0) {
      Alert.alert("提示", "请先选择要下载的曲目");
      return;
    }
    Alert.alert(
      "批量下载",
      `确定要下载专辑《${album?.name}》中的所有选择的${selectedTrackIds?.length}首曲目吗？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "确定",
          onPress: () => {
            downloadTracks(
              selectedTracks,
              (completed: number, total: number) => {
                if (completed === total) {
                  Alert.alert("下载完成", `已成功下载 ${total} 首曲目`);
                  setIsSelectionMode(false);
                  setSelectedTrackIds([]);
                }
              }
            );
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, justifyContent: "center" },
        ]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (loading) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, justifyContent: "center" },
        ]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!album) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, justifyContent: "center" },
        ]}
      >
        <Text style={{ color: colors.text }}>Album not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[styles.customHeader, { backgroundColor: colors.background }]}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() =>
            isSelectionMode ? setIsSelectionMode(false) : router.back()
          }
        >
          <Ionicons
            name={isSelectionMode ? "close" : "chevron-back"}
            size={28}
            color={colors.text}
          />
        </TouchableOpacity>
        <Text
          style={[styles.headerTitle, { color: colors.text }]}
          numberOfLines={1}
        >
          {isSelectionMode
            ? `已选择 ${selectedTrackIds.length} 项`
            : album?.name || "Album"}
        </Text>
        <View style={styles.headerRight}>
          {isSelectionMode ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                disabled={!selectedTrackIds.length}
                onPress={() => {
                  setAddToPlaylistVisible(true);
                }}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={24}
                  color={selectedTrackIds.length ? colors.text : colors.secondary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                disabled={!selectedTrackIds.length}
                onPress={handleDownloadSelected}
              >
                <Ionicons
                  name="cloud-download-outline"
                  size={24}
                  color={selectedTrackIds.length ? colors.text : colors.secondary}
                />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setAlbumMoreVisible(true)}>
              <Ionicons
                name="ellipsis-horizontal"
                size={24}
                color={colors.text}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id.toString()}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.coverContainer}>
              <Image
                source={{
                  uri: getImageUrl(album.cover, `https://picsum.photos/seed/${album.id}/300/300`),
                }}
                style={styles.cover}
              />
              {album.type === "AUDIOBOOK" && (album as any).progress > 0 && (
                <View style={styles.progressOverlay}>
                  <View
                    style={[
                      styles.progressBar,
                      {
                        width: `${album.progress || 0}%`,
                        backgroundColor: colors.primary,
                      },
                    ]}
                  />
                </View>
              )}
            </View>
            <Text style={[styles.title, { color: colors.text }]}>
              {album.name}
            </Text>
            <Text style={[styles.artist, { color: colors.secondary }]}>
              {album.artist}
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity
                style={[
                  styles.playAllButton,
                  { backgroundColor: colors.primary },
                ]}
                onPress={() => {
                  let startTrackIndex = 0;
                  let startTime = 0;

                  // Check if needs resume
                  const resumeTrackId = album.resumeTrackId;
                  const resumeProgress = album.resumeProgress;

                  if (resumeTrackId) {
                    const foundIndex = tracks.findIndex(
                      (t) => t.id === resumeTrackId
                    );
                    if (foundIndex !== -1) {
                      startTrackIndex = foundIndex;
                      startTime = resumeProgress || 0;
                    }
                  }

                  playTrackList(tracks, startTrackIndex).then(() => {
                    if (startTime > 0) {
                      // Small delay to ensure track is loaded
                      setTimeout(() => seekTo(startTime), 500);
                    }
                  });
                }}
              >
                <Ionicons name="play" size={20} color={colors.background} />
                <Text
                  style={[styles.playAllText, { color: colors.background }]}
                >
                  {album.resumeTrackId ? "继续播放" : "播放全部"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.likeButton, { backgroundColor: colors.card }]}
                onPress={handleToggleLike}
              >
                <Ionicons
                  name={isLiked ? "heart" : "heart-outline"}
                  size={24}
                  color={isLiked ? colors.primary : colors.secondary}
                />
              </TouchableOpacity>
              {!isSelectionMode ? (
                <TouchableOpacity
                  style={[styles.likeButton, { backgroundColor: colors.card }]}
                  onPress={() => {
                    setIsSelectionMode(true);
                    setSelectedTrackIds([]);
                  }}
                >
                  <Ionicons
                    name="list-outline"
                    size={24}
                    color={colors.secondary}
                  />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.likeButton, { backgroundColor: colors.card }]}
                  onPress={() => {
                    if (selectedTrackIds?.length === tracks.length) {
                      setSelectedTrackIds([]);
                    } else {
                      setSelectedTrackIds(tracks.map((t) => t.id));
                    }
                  }}
                >
                  <Ionicons
                    name="list-outline"
                    size={24}
                    color={colors.secondary}
                  />
                </TouchableOpacity>
              )}
              <View
                style={[styles.likeButton, { backgroundColor: colors.card, flexDirection: 'row', width: 'auto', paddingHorizontal: 15 }]}
              >
                <TouchableOpacity 
                   style={{ flexDirection: 'row', alignItems: 'center' }}
                   onPress={() => {
                        const sequence: ("id" | "index" | "episodeNumber")[] = ["episodeNumber", "index", "id"];
                        const next = sequence[(sequence.indexOf(sortBy) + 1) % sequence.length];
                        setSortBy(next);
                    }}
                >
                    <Text style={{ color: colors.secondary, fontSize: 12, marginRight: 5 }}>
                    {sortBy === 'id' ? '入库' : sortBy === 'index' ? '专辑' : '优化'}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setSort(sort === 'asc' ? 'desc' : 'asc')}>
                  <Ionicons
                    name={sort === "asc" ? "arrow-up" : "arrow-down"}
                    size={16}
                    color={colors.secondary}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        }
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={[styles.trackItem, { borderBottomColor: colors.border }]}
            onPress={() => {
              if (isSelectionMode) {
                toggleTrackSelection(item.id);
                return;
              }
              playTrackList(tracks, index);
              // If Audiobook and has progress, try to resume
              if (
                album.type === "AUDIOBOOK" &&
                ((item as any).progress > 0 ||
                  item.listenedAsAudiobookByUsers?.[0]?.progress)
              ) {
                const progress =
                  (item as any).progress ||
                  item.listenedAsAudiobookByUsers?.[0]?.progress;
                if (progress > 0) {
                  setTimeout(() => seekTo(progress), 500);
                }
              }
            }}
            onLongPress={() => {
              if (isSelectionMode) return;
              setSelectedTrack(item);
              setMoreModalVisible(true);
            }}
          >
            <View style={styles.trackIndexContainer}>
              {isSelectionMode ? (
                <Ionicons
                  name={
                    selectedTrackIds.includes(item.id)
                      ? "checkbox"
                      : "square-outline"
                  }
                  size={20}
                  color={
                    selectedTrackIds.includes(item.id)
                      ? colors.primary
                      : colors.secondary
                  }
                />
              ) : currentTrack?.id === item.id && isPlaying ? (
                <PlayingIndicator />
              ) : (
                <Text
                  style={[
                    styles.trackIndex,
                    {
                      color:
                        currentTrack?.id === item.id
                          ? colors.primary
                          : colors.secondary,
                    },
                  ]}
                >
                  {index + 1}
                </Text>
              )}
            </View>
            <Image
              source={{
                uri: getImageUrl(item.cover, `https://picsum.photos/seed/${item.id}/20/20`),
              }}
              alt=""
              style={{ width: 20, height: 20, borderRadius: 2 }}
            />
            <View style={styles.trackInfo}>
              <Text
                style={[
                  styles.trackName,
                  {
                    color:
                      album.type === "AUDIOBOOK" &&
                      ((item as any).progress > 0 ||
                        item.listenedAsAudiobookByUsers?.[0]?.progress)
                        ? colors.secondary
                        : colors.text,
                  },
                ]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
            </View>
            {album.type === "AUDIOBOOK" && (() => {
              const displayProgress = currentTrack?.id === item.id ? position : ((item as any).progress || item.listenedAsAudiobookByUsers?.[0]?.progress || 0);
              if (displayProgress <= 0) return null;
              return (
                <View style={{ marginRight: 10 }}>
                  <Text style={{ fontSize: 10, color: colors.primary }}>
                    已听
                    {Math.floor(
                      (displayProgress / (item.duration || 1)) * 100
                    )}
                    %
                  </Text>
                </View>
              );
            })()}
            <Text style={[styles.trackDuration, { color: colors.secondary }]}>
              {item.duration
                ? `${Math.floor(item.duration / 60)}:${(item.duration % 60)
                    .toString()
                    .padStart(2, "0")}`
                : "--:--"}
            </Text>
          </TouchableOpacity>
        )}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ padding: 20 }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
      />

      <TrackMoreModal
        visible={moreModalVisible}
        track={selectedTrack}
        onClose={() => setMoreModalVisible(false)}
        onAddToPlaylist={(track) => {
          setSelectedTrack(track);
          setAddToPlaylistVisible(true);
        }}
        onDeleteSuccess={(id) => {
          setTracks(tracks.filter((t) => t.id !== id));
        }}
      />

      <AddToPlaylistModal
        visible={addToPlaylistVisible}
        trackId={selectedTrack?.id ?? null}
        trackIds={
          selectedTrack 
            ? undefined 
            : isSelectionMode && selectedTrackIds.length > 0
              ? selectedTrackIds
              : tracks.map((t) => t.id)
        }
        tracks={tracks}
        onClose={() => {
          setAddToPlaylistVisible(false);
          setSelectedTrack(null);
        }}
      />

      <AlbumMoreModal
        visible={albumMoreVisible}
        album={album}
        trackIds={tracks.map((t) => t.id)}
        tracks={tracks}
        onClose={() => setAlbumMoreVisible(false)}
        onAddToPlaylist={() => {
          setAlbumMoreVisible(false);
          setSelectedTrack(null);
          setAddToPlaylistVisible(true);
        }}
        onSelectTracks={() => {
          setIsSelectionMode(true);
          setSelectedTrackIds([]);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    padding: 20,
  },
  customHeader: {
    paddingTop: 50, // Adjust for status bar
    paddingHorizontal: 15,
    paddingBottom: 10,
    zIndex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  backButton: {
    padding: 5,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
    marginHorizontal: 10,
  },
  headerRight: {
    minWidth: 28, // Matches backButton size roughly for centering title
    alignItems: "center",
  },
  moreButton: {
    padding: 5,
  },
  coverContainer: {
    width: 200,
    height: 200,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 15,
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  progressOverlay: {
    position: 'absolute',
    bottom: 5,
    left: 3,
    right: 3,
    height: 4,
    width: 200 - 6,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  progressBar: {
    height: '100%',
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 5,
  },
  artist: {
    fontSize: 18,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 20,
  },
  playAllButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 25,
    paddingVertical: 10,
    borderRadius: 25,
    gap: 8,
  },
  playAllText: {
    fontSize: 16,
    fontWeight: "600",
  },
  likeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 15,
  },
  trackList: {
    padding: 20,
  },
  trackItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  trackIndex: {
    fontSize: 14,
    textAlign: "center",
  },
  trackIndexContainer: {
    width: 50,
    justifyContent: "center",
    alignItems: "center",
  },
  trackInfo: {
    flex: 1,
    marginHorizontal: 10,
  },
  trackName: {
    fontSize: 16,
    marginBottom: 2,
  },
  trackArtist: {
    fontSize: 12,
  },
  trackDuration: {
    fontSize: 12,
  },
});
