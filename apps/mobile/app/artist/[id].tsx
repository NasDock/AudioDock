import { AddToPlaylistModal } from "@/src/components/AddToPlaylistModal";
import { ArtistMoreModal } from "@/src/components/ArtistMoreModal";
import { FilePathModal } from "@/src/components/FilePathModal";
import PlayingIndicator from "@/src/components/PlayingIndicator";
import SkeletonBlock from "@/src/components/SkeletonBlock";
import { useAuth } from "@/src/context/AuthContext";
import { TrackMoreModal } from "@/src/components/TrackMoreModal";
import { usePlayer } from "@/src/context/PlayerContext";
import { useTheme } from "@/src/context/ThemeContext";
import { Album, Artist, Track, TrackType } from "@/src/models";
import { downloadTracks } from "@/src/services/downloadManager";
import { getImageUrl } from "@/src/utils/image";
import { usePlayMode } from "@/src/utils/playMode";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import {
    getAlbumsByArtist,
    getArtistById,
    getCollaborativeAlbumsByArtist,
    getCollections,
    getTracksByArtist,
    uploadArtistAvatar,
} from "@soundx/services";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    Alert,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

const ARTIST_AVATAR_SIZE = 150;
const ARTIST_ALBUM_COVER_SIZE = 120;
const ARTIST_HEADER_ICON_SIZE = 24;
const ARTIST_LIST_ACTION_SIZE = 36;
const ARTIST_TRACK_COVER_SIZE = 20;

export default function ArtistDetailScreen() {
  const { id } = useLocalSearchParams();
  const { colors } = useTheme();
  const { playTrackList, currentTrack, isPlaying } = usePlayer();
  const { mode } = usePlayMode();
  const { sourceType, user } = useAuth();
  const router = useRouter();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [collaborativeAlbums, setCollaborativeAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [relatedCollections, setRelatedCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [moreModalVisible, setMoreModalVisible] = useState(false);
  const [artistMoreVisible, setArtistMoreVisible] = useState(false);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);
  const [filePathVisible, setFilePathVisible] = useState(false);
  const [propertyTrack, setPropertyTrack] = useState<Track | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<(number | string)[]>(
    [],
  );
  const [uploadingCover, setUploadingCover] = useState(false);

  useEffect(() => {
    if (id) {
      loadData(id as string);
    }
  }, [id]);

  useEffect(() => {
    const loadRelatedCollections = async () => {
      if (mode !== TrackType.AUDIOBOOK || !user?.id || !artist) {
        setRelatedCollections([]);
        return;
      }
      try {
        const res = await getCollections(user.id);
        if (res.code !== 200) {
          setRelatedCollections([]);
          return;
        }
        const artistAlbumIds = new Set(
          [...albums, ...collaborativeAlbums].map((album) => String(album.id)),
        );
        const filtered = (res.data || []).filter((col: any) =>
          (col.items || []).some((item: any) =>
            artistAlbumIds.has(String(item.album?.id)),
          ),
        );
        setRelatedCollections(filtered);
      } catch (error) {
        setRelatedCollections([]);
      }
    };

    loadRelatedCollections();
  }, [mode, user?.id, artist, albums, collaborativeAlbums]);

  const loadData = async (artistId: string) => {
    try {
      setLoading(true);
      const [artistRes] = await Promise.all([getArtistById(artistId)]);

      if (artistRes.code === 200) {
        setArtist(artistRes.data);
        const artistQueryKey =
          sourceType === "Emby" ? String(artistId) : artistRes.data.name;
        if (artistQueryKey) {
          const [albumsRes, collaborativeRes, tracksRes] = await Promise.all([
            getAlbumsByArtist(artistQueryKey),
            getCollaborativeAlbumsByArtist(artistQueryKey),
            getTracksByArtist(artistQueryKey),
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

  const handleUpdateCover = async () => {
    if (!artist || uploadingCover) return;
    if (sourceType !== "AudioDock") {
      Alert.alert("提示", "仅 AudioDock 源支持修改封面");
      return;
    }
    try {
      setUploadingCover(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      const fileName = asset.fileName || `artist-${artist.id}-${Date.now()}.jpg`;
      const file = {
        uri: asset.uri,
        name: fileName,
        type: asset.mimeType || "image/jpeg",
      } as any;
      const res = await uploadArtistAvatar(artist.id, file);
      if (res.code === 200) {
        setArtist(res.data);
      } else {
        Alert.alert("上传失败", res.message || "封面上传失败");
      }
    } catch (error) {
      console.error("Failed to upload artist cover:", error);
      Alert.alert("上传失败", "封面上传失败");
    } finally {
      setUploadingCover(false);
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
    return <ArtistDetailSkeleton />;
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
        {isSelectionMode ? (
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
        ) : (
          <View style={styles.headerRight}>
            <TouchableOpacity onPress={() => setArtistMoreVisible(true)}>
              <Ionicons
                name="ellipsis-horizontal"
                size={24}
                color={colors.text}
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

        {mode === TrackType.AUDIOBOOK && relatedCollections.length > 0 && (
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.text, paddingHorizontal: 20 },
              ]}
            >
              相关合集 ({relatedCollections.length})
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ paddingHorizontal: 20, paddingBottom: 20 }}
            >
              {relatedCollections.map((col) => {
                const cover =
                  col.cover || col.items?.[0]?.album?.cover || undefined;
                return (
                  <TouchableOpacity
                    key={col.id}
                    style={styles.albumCard}
                    onPress={() => router.push(`/collection/${col.id}`)}
                  >
                    <View style={styles.albumCoverContainer}>
                      <Image
                        source={{
                          uri: getImageUrl(
                            cover,
                            `https://picsum.photos/seed/collection-${col.id}/200/200`,
                          ),
                        }}
                        style={styles.albumCover}
                      />
                    </View>
                    <Text
                      style={[styles.albumName, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {col.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
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
        onShowProperties={(track) => {
          setPropertyTrack(track);
          setFilePathVisible(true);
        }}
        onDeleteSuccess={(id) => {
          setTracks(tracks.filter((t) => t.id !== id));
        }}
      />

      <ArtistMoreModal
        visible={artistMoreVisible}
        artist={artist}
        onClose={() => setArtistMoreVisible(false)}
        onUpdateCover={handleUpdateCover}
      />

      <AddToPlaylistModal
        visible={addToPlaylistVisible}
        trackId={isSelectionMode ? null : (selectedTrack?.id ?? null)}
        trackIds={isSelectionMode ? selectedTrackIds : undefined}
        tracks={tracks}
        onClose={() => setAddToPlaylistVisible(false)}
      />

      <FilePathModal
        visible={filePathVisible}
        title={propertyTrack ? `曲目属性 · ${propertyTrack.name}` : "曲目属性"}
        path={propertyTrack?.path}
        onClose={() => setFilePathVisible(false)}
      />
    </View>
  );
}

function ArtistDetailSkeleton() {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.customHeader, { backgroundColor: colors.background }]}>
        <View style={styles.backButton}>
          <SkeletonBlock width={28} height={28} borderRadius={14} />
        </View>
        <View style={styles.headerRight}>
          <SkeletonBlock
            width={ARTIST_HEADER_ICON_SIZE}
            height={ARTIST_HEADER_ICON_SIZE}
            borderRadius={ARTIST_HEADER_ICON_SIZE / 2}
          />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <SkeletonBlock
            width={ARTIST_AVATAR_SIZE}
            height={ARTIST_AVATAR_SIZE}
            borderRadius={ARTIST_AVATAR_SIZE / 2}
            style={{ marginBottom: 15 }}
          />
          <SkeletonBlock width={170} height={28} borderRadius={10} />
        </View>

        <View style={styles.section}>
          <SkeletonBlock
            width={140}
            height={26}
            borderRadius={10}
            style={{ marginLeft: 20, marginBottom: 15 }}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
          >
            {Array.from({ length: 3 }).map((_, index) => (
              <View key={index} style={styles.albumCard}>
                <SkeletonBlock
                  width={ARTIST_ALBUM_COVER_SIZE}
                  height={ARTIST_ALBUM_COVER_SIZE}
                  borderRadius={10}
                  style={{ marginBottom: 5 }}
                />
                <SkeletonBlock width={90} height={14} borderRadius={7} style={{ alignSelf: "center" }} />
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={[styles.section, styles.trackList]}>
          <View style={styles.sectionHeaderRow}>
            <SkeletonBlock width={150} height={26} borderRadius={10} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <SkeletonBlock
                width={ARTIST_LIST_ACTION_SIZE}
                height={ARTIST_LIST_ACTION_SIZE}
                borderRadius={ARTIST_LIST_ACTION_SIZE / 2}
              />
              <SkeletonBlock
                width={ARTIST_LIST_ACTION_SIZE}
                height={ARTIST_LIST_ACTION_SIZE}
                borderRadius={ARTIST_LIST_ACTION_SIZE / 2}
              />
            </View>
          </View>

          {Array.from({ length: 7 }).map((_, index) => (
            <View
              key={index}
              style={[styles.trackItem, { borderBottomColor: colors.border }]}
            >
              <View style={styles.trackIndexContainer}>
                <SkeletonBlock width={18} height={18} borderRadius={9} />
              </View>
              <View style={styles.trackInfo}>
                <SkeletonBlock
                  width={ARTIST_TRACK_COVER_SIZE}
                  height={ARTIST_TRACK_COVER_SIZE}
                  borderRadius={2}
                />
                <SkeletonBlock
                  width={index % 2 === 0 ? "58%" : "70%"}
                  height={16}
                  borderRadius={8}
                />
              </View>
              <SkeletonBlock width={36} height={12} borderRadius={6} />
            </View>
          ))}
        </View>
      </ScrollView>
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
    width: ARTIST_AVATAR_SIZE,
    height: ARTIST_AVATAR_SIZE,
    borderRadius: ARTIST_AVATAR_SIZE / 2,
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
    width: ARTIST_LIST_ACTION_SIZE,
    height: ARTIST_LIST_ACTION_SIZE,
    borderRadius: ARTIST_LIST_ACTION_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
  },
  actionButton: {
    width: ARTIST_LIST_ACTION_SIZE,
    height: ARTIST_LIST_ACTION_SIZE,
    borderRadius: ARTIST_LIST_ACTION_SIZE / 2,
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
    width: ARTIST_ALBUM_COVER_SIZE,
  },
  albumCoverContainer: {
    width: ARTIST_ALBUM_COVER_SIZE,
    height: ARTIST_ALBUM_COVER_SIZE,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
    marginBottom: 5,
  },
  albumCover: {
    width: ARTIST_ALBUM_COVER_SIZE,
    height: ARTIST_ALBUM_COVER_SIZE,
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
