import { AddToPlaylistModal } from "@/src/components/AddToPlaylistModal";
import PlayingIndicator from "@/src/components/PlayingIndicator";
import { TrackMoreModal } from "@/src/components/TrackMoreModal";
import { usePlayer } from "@/src/context/PlayerContext";
import { useTheme } from "@/src/context/ThemeContext";
import { Album, Artist, Track, TrackType } from "@/src/models";
import { downloadTracks } from "@/src/services/downloadManager";
import { getImageUrl } from "@/src/utils/image";
import { usePlayMode } from "@/src/utils/playMode";
import { Ionicons } from "@expo/vector-icons";
import {
    getAlbumsByArtist,
    getArtistById,
    getCollaborativeAlbumsByArtist,
    getTracksByArtist,
} from "@soundx/services";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

export default function ArtistDetailScreen() {
  const { id } = useLocalSearchParams();
  const { colors } = useTheme();
  const { playTrackList, currentTrack, isPlaying } = usePlayer();
  const { mode } = usePlayMode();
  const router = useRouter();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [collaborativeAlbums, setCollaborativeAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [moreModalVisible, setMoreModalVisible] = useState(false);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<(number | string)[]>(
    [],
  );

  useEffect(() => {
    if (id) {
      loadData(id as string);
    }
  }, [id]);

  const loadData = async (artistId: string) => {
    try {
      setLoading(true);
      const [artistRes] = await Promise.all([getArtistById(artistId)]);

      if (artistRes.code === 200) {
        setArtist(artistRes.data);
        // Fetch albums and tracks using the artist name
        if (artistRes.data.name) {
          const [albumsRes, collaborativeRes, tracksRes] = await Promise.all([
            getAlbumsByArtist(artistRes.data.name),
            getCollaborativeAlbumsByArtist(artistRes.data.name),
            getTracksByArtist(artistRes.data.name),
          ]);
          if (albumsRes.code === 200) setAlbums(albumsRes.data);
          if (collaborativeRes.code === 200)
            setCollaborativeAlbums(collaborativeRes.data);
          if (tracksRes.code === 200) setTracks(tracksRes.data);
        }
      }
    } catch (error) {
      console.error("Failed to load artist details:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleTrackSelection = (trackId: number | string) => {
    setSelectedTrackIds((prev) =>
      prev.includes(trackId)
        ? prev.filter((id) => id !== trackId)
        : [...prev, trackId],
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

  if (!artist) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, justifyContent: "center" },
        ]}
      >
        <Text style={{ color: colors.text }}>Artist not found</Text>
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
        {isSelectionMode && (
          <View style={styles.headerRight}>
            <Text
              style={[styles.headerTitle, { color: colors.text }]}
              numberOfLines={1}
            >
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
                color={selectedTrackIds.length ? colors.text : colors.secondary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!selectedTrackIds.length}
              onPress={handleDownloadSelected}
              style={{ marginLeft: 12 }}
            >
              <Ionicons
                name="cloud-download-outline"
                size={24}
                color={selectedTrackIds.length ? colors.text : colors.secondary}
              />
            </TouchableOpacity>
          </View>
        )}
      </View>
      <ScrollView>
        <View style={styles.header}>
          <Image
            source={{
              uri: getImageUrl(
                artist.avatar,
                `https://picsum.photos/seed/${artist.id}/300/300`,
              ),
            }}
            style={styles.avatar}
          />
          <Text style={[styles.name, { color: colors.text }]}>
            {artist.name}
          </Text>
        </View>

        {albums.length > 0 && (
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.text, paddingHorizontal: 20 },
              ]}
            >
              所有专辑 ({albums.length})
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ paddingHorizontal: 20, paddingBottom: 20 }}
            >
              {albums.map((album) => (
                <TouchableOpacity
                  key={album.id}
                  style={styles.albumCard}
                  onPress={() => router.push(`/album/${album.id}`)}
                >
                  <View style={styles.albumCoverContainer}>
                    <Image
                      source={{
                        uri: getImageUrl(
                          album.cover,
                          `https://picsum.photos/seed/${album.id}/200/200`,
                        ),
                      }}
                      style={styles.albumCover}
                    />
                    {album.type === "AUDIOBOOK" &&
                      (album as any).progress > 0 && (
                        <View
                          style={[styles.progressOverlay, { width: 120 - 6 }]}
                        >
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
                  <Text
                    style={[styles.albumName, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {album.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {collaborativeAlbums.length > 0 && (
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.text, paddingHorizontal: 20 },
              ]}
            >
              合作专辑 ({collaborativeAlbums.length})
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ paddingHorizontal: 20, paddingBottom: 20 }}
            >
              {collaborativeAlbums.map((album) => (
                <TouchableOpacity
                  key={album.id}
                  style={styles.albumCard}
                  onPress={() => router.push(`/album/${album.id}`)}
                >
                  <View style={styles.albumCoverContainer}>
                    <Image
                      source={{
                        uri: getImageUrl(
                          album.cover,
                          `https://picsum.photos/seed/${album.id}/200/200`,
                        ),
                      }}
                      style={styles.albumCover}
                    />
                    {(album.type === "AUDIOBOOK" ||
                      artist.type === "AUDIOBOOK") &&
                      (album as any).progress > 0 && (
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
                  <Text
                    style={[styles.albumName, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {album.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {mode !== TrackType.AUDIOBOOK && (
          <View style={[styles.section, styles.trackList]}>
            <View style={styles.sectionHeaderRow}>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.text, marginBottom: 0 },
                ]}
              >
                所有单曲 ({tracks.length})
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {!isSelectionMode ? (
                  <>
                    <TouchableOpacity
                      onPress={() => {
                        setIsSelectionMode(true);
                        setSelectedTrackIds([]);
                      }}
                      style={[
                        styles.actionButton,
                        { backgroundColor: colors.card },
                      ]}
                    >
                      <Ionicons
                        name="list-outline"
                        size={20}
                        color={colors.secondary}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() =>
                        tracks.length > 0 && playTrackList(tracks, 0)
                      }
                      style={[
                        styles.playButton,
                        { backgroundColor: colors.primary },
                      ]}
                    >
                      <Ionicons
                        name="play"
                        size={20}
                        color={colors.background}
                      />
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    onPress={() => {
                      if (selectedTrackIds?.length === tracks.length) {
                        setSelectedTrackIds([]);
                      } else {
                        setSelectedTrackIds(tracks.map((t) => t.id));
                      }
                    }}
                    style={[
                      styles.actionButton,
                      { backgroundColor: colors.card },
                    ]}
                  >
                    <Ionicons
                      name="list-outline"
                      size={20}
                      color={colors.secondary}
                    />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            {tracks.map((track, index) => (
              <TouchableOpacity
                key={track.id}
                style={[styles.trackItem, { borderBottomColor: colors.border }]}
                onPress={() => {
                  if (isSelectionMode) {
                    toggleTrackSelection(track.id);
                    return;
                  }
                  playTrackList(tracks, index);
                }}
                onLongPress={() => {
                  if (isSelectionMode) return;
                  setSelectedTrack(track);
                  setMoreModalVisible(true);
                }}
              >
                <View style={styles.trackIndexContainer}>
                  {isSelectionMode ? (
                    <Ionicons
                      name={
                        selectedTrackIds.includes(track.id)
                          ? "checkbox"
                          : "square-outline"
                      }
                      size={20}
                      color={
                        selectedTrackIds.includes(track.id)
                          ? colors.primary
                          : colors.secondary
                      }
                    />
                  ) : currentTrack?.id === track.id && isPlaying ? (
                    <PlayingIndicator />
                  ) : (
                    <Text
                      style={[
                        styles.trackIndex,
                        {
                          color:
                            currentTrack?.id === track.id
                              ? colors.primary
                              : colors.secondary,
                        },
                      ]}
                    >
                      {index + 1}
                    </Text>
                  )}
                </View>
                <View style={styles.trackInfo}>
                  <Image
                    source={{
                      uri: getImageUrl(
                        track.cover,
                        `https://picsum.photos/seed/${track.id}/20/20`,
                      ),
                    }}
                    alt=""
                    style={{ width: 20, height: 20 }}
                  />
                  <Text
                    style={[styles.trackName, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {track.name}
                  </Text>
                </View>
                <Text
                  style={[styles.trackDuration, { color: colors.secondary }]}
                >
                  {track.duration
                    ? `${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, "0")}`
                    : "--:--"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

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
        trackId={isSelectionMode ? null : (selectedTrack?.id ?? null)}
        trackIds={isSelectionMode ? selectedTrackIds : undefined}
        tracks={tracks}
        onClose={() => setAddToPlaylistVisible(false)}
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
  },
  backButton: {
    padding: 5,
  },
  avatar: {
    width: 150,
    height: 150,
    borderRadius: 75,
    marginBottom: 15,
  },
  name: {
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
  },
  section: {
    padding: 0,
  },
  trackList: {
    marginBottom: 60,
    paddingBottom: 70,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 15,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    marginHorizontal: 10,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  albumCard: {
    marginRight: 15,
    width: 120,
  },
  albumCoverContainer: {
    width: 120,
    height: 120,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
    marginBottom: 5,
  },
  albumCover: {
    width: 120,
    height: 120,
  },
  progressOverlay: {
    position: "absolute",
    bottom: 5,
    left: 0,
    right: 0,
    height: 6,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
  progressBar: {
    height: "100%",
  },
  albumName: {
    fontSize: 14,
    textAlign: "center",
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
    display: "flex",
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 10,
  },
  trackName: {
    fontSize: 16,
  },
  trackDuration: {
    fontSize: 12,
  },
});
