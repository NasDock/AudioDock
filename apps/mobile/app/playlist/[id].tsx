import { XiaoAiIcon } from "@/src/components/XiaoAiIcon";import PlayingIndicator from "@/src/components/PlayingIndicator";
import { TrackMoreModal } from "@/src/components/TrackMoreModal";
import { MiDeviceSelector } from "@/src/components/MiDeviceSelector";
import { usePlayer } from "@/src/context/PlayerContext";
import { useTheme } from "@/src/context/ThemeContext";
import { Playlist } from "@/src/models";
import { downloadTracks } from "@/src/services/downloadManager";
import { trackEvent } from "@/src/services/tracking";
import { getImageSource } from "@/src/utils/image";
import { Ionicons } from "@expo/vector-icons";
import {
    deletePlaylist,
    getPlaylistById,
    playMiDevicePlaylist,
    updatePlaylist,
} from "@soundx/services";
import { Image as ExpoImage } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    ViewStyle,
} from "react-native";
import Modal from "react-native-modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/context/AuthContext";

export default function PlaylistDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors, theme } = useTheme();
  const { t } = useTranslation();
  const { playTrack, playTrackList, currentTrack, isPlaying } = usePlayer();
  const { user, device } = useAuth();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreModalVisible, setMoreModalVisible] = useState(false);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [updating, setUpdating] = useState(false);
  const [trackMoreVisible, setTrackMoreVisible] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<any>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<(number | string)[]>([]);
  const insets = useSafeAreaInsets();

  // Mi Speaker cast state
  const [isMiDeviceSelectorVisible, setIsMiDeviceSelectorVisible] = useState(false);
  const [isCastingToMi, setIsCastingToMi] = useState(false);

  useEffect(() => {
    if (id) {
      loadData(Number(id));
    }
  }, [id]);

  const loadData = async (playlistId: number) => {
    try {
      setLoading(true);
      const res = await getPlaylistById(Number(id));
      if (res.code === 200) setPlaylist(res.data);
    } catch (error) {
      console.error("Failed to load playlist details:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async () => {
    if (!playlist || !newName.trim()) return;
    setUpdating(true);
    try {
      const res = await updatePlaylist(playlist.id, newName.trim());
      if (res.code === 200) {
        setPlaylist({ ...playlist, name: newName.trim() });
        setRenameModalVisible(false);
      }
    } catch (e) {
      console.error("Rename failed", e);
    } finally {
      setUpdating(false);
    }
  };

  const handlePlayAll = (tracks: any[]) => {
    if (!playlist || tracks.length === 0) return;
    trackEvent({
      feature: "personal",
      eventName: "personal_playlist_play",
      userId: user?.id ? String(user.id) : undefined,
      deviceId: device?.id ? String(device.id) : undefined,
      metadata: {
        playlistId: playlist.id,
        trackCount: tracks.length,
      },
    });
    playTrackList(tracks, 0);
  };

  const handleDelete = () => {
    if (!playlist) return;
    setMoreModalVisible(false);
    Alert.alert(t("playlistPage.deleteTitle"), t("playlistPage.deleteMessage", { name: playlist.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        style: "destructive",
        onPress: async () => {
          try {
            const res = await deletePlaylist(playlist.id);
            if (res.code === 200) {
              router.back();
            }
          } catch (e) {
            console.error("Delete failed", e);
          }
        },
      },
    ]);
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
      Alert.alert(t("common.ok"), t("playlistPage.selectTracksFirst"));
      return;
    }
    Alert.alert(
      t("playlistPage.batchDownloadTitle"),
      t("playlistPage.batchDownloadMessage", {
        name: playlist?.name,
        count: selectedTrackIds?.length || 0,
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.confirm"),
          style: "destructive",
          onPress: async () => {
            downloadTracks(
              selectedTracks,
              (completed: number, total: number) => {
                if (completed === total) {
                  Alert.alert(
                    t("playlistPage.downloadComplete"),
                    t("playlistPage.downloadedTrackCount", { count: total }),
                  );
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

  const handleCastPlaylistToMi = async (deviceId: string, deviceName: string) => {
    const tracks = playlist?.tracks || [];
    if (tracks.length === 0) {
      Alert.alert(t("playerPage.miCastNoTrack"));
      return;
    }
    setIsCastingToMi(true);
    try {
      const baseURL = (await import("@/src/https")).getBaseURL().replace(/\/$/, "");
      const quality = "high";
      const qualityQuery = `?quality=${quality}`;

      const trackPayloads = tracks.map((track) => ({
        url: `${baseURL}/track/stream/${track.id}${qualityQuery}`,
        title: `${track.name} - ${track.artist ?? ""}`,
        duration: track.duration || 0,
      }));

      await playMiDevicePlaylist({
        device_id: deviceId,
        tracks: trackPayloads,
        start_index: 0,
      });

      Alert.alert(t("playerPage.miCastPlaylistSuccess", { device: deviceName, count: trackPayloads.length }));
      setIsMiDeviceSelectorVisible(false);
    } catch (e) {
      console.error("Failed to cast playlist to Mi device:", e);
      Alert.alert(t("playerPage.miCastPlaylistFailed"));
    } finally {
      setIsCastingToMi(false);
    }
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

  if (!playlist) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, justifyContent: "center" },
        ]}
      >
        <Text style={{ color: colors.text }}>Playlist not found</Text>
      </View>
    );
  }

  const tracks = playlist.tracks || [];

  // Extract unique albums for photo wall - use album name for uniqueness
  const uniqueAlbums = tracks
    .reduce((acc: any[], track) => {
      const albumKey = track.album || track.name;
      if (!acc.find((a) => (a.album || a.name) === albumKey)) {
        acc.push({
          cover: track.cover,
          id: track.id,
          album: track.album,
          name: track.name,
        });
      }
      return acc;
    }, [])
    .slice(0, 11); // Show max 11 album covers

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.customHeader,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
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
            ? t("playlistPage.selectedCount", { count: selectedTrackIds.length })
            : playlist?.name || "Playlist"}
        </Text>
        <View style={styles.headerRight}>
          {isSelectionMode ? (
            <TouchableOpacity onPress={handleDownloadSelected}>
              <Ionicons
                name="cloud-download-outline"
                size={24}
                color={colors.primary}
              />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => setMoreModalVisible(true)}>
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
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: 40 }}
        // 仅渲染可视区附近 ~5 屏，减少长列表 DOM 节点
        windowSize={5}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        // iOS 新架构(Fabric)下 removeClippedSubviews 会触发 EXC_BAD_ACCESS：
        // updateClippedSubviewsWithClipRect -> convertRect:toView: 野指针崩溃。
        // RN 0.81 在 iOS 默认即为 false，这里显式关闭以免崩溃。
        removeClippedSubviews={false}
        ListHeaderComponent={
          <View style={styles.photoWall}>
            {uniqueAlbums.map((album, index) => {
              const isSmall = [0, 3, 7, 10].includes(index);
              const itemStyle = {
                width: isSmall ? "16.66%" : "33.33%",
                aspectRatio: isSmall ? 0.5 : 1,
              };

              return (
                <View
                  key={index}
                  style={[styles.photoWallItem, itemStyle as ViewStyle]}
                >
                  <ExpoImage
                    source={getImageSource(album.cover, `https://picsum.photos/seed/${album.id}/400/400`)}
                    style={styles.photoWallImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                </View>
              );
            })}
          </View>
        }
        renderItem={({ item: track, index }) => (
          <TouchableOpacity
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
              setTrackMoreVisible(true);
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
            <ExpoImage
              source={getImageSource(track.cover, `https://picsum.photos/seed/${track.id}/40/40`, 96)}
              style={{ width: 40, height: 40, borderRadius: 4 }}
              contentFit="cover"
              cachePolicy="memory-disk"
              // expo-image 会按 size hint 自动缓存合适分辨率，原图 1500x1500 在 40x40 不浪费
            />
            <View style={styles.trackInfo}>
              <Text
                style={[styles.trackName, { color: colors.text }]}
                numberOfLines={1}
              >
                {track.name}
              </Text>
              <Text
                style={[styles.trackArtist, { color: colors.secondary }]}
                numberOfLines={1}
              >
                {track.artist}
              </Text>
            </View>
            <Text style={[styles.trackDuration, { color: colors.secondary }]}>
              {track.duration
                ? `${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, "0")}`
                : "--:--"}
            </Text>
          </TouchableOpacity>
        )}
      />

      <TrackMoreModal
        visible={trackMoreVisible}
        track={selectedTrack}
        onClose={() => setTrackMoreVisible(false)}
        onAddToPlaylist={(track) => {
          // Playlist detail already in a playlist, but user might want to add to another
          // Just ignore for now or implement AddToPlaylistModal here too
        }}
      />

      {/* More Actions Menu */}
      <Modal
        isVisible={moreModalVisible}
        onBackdropPress={() => setMoreModalVisible(false)}
        onBackButtonPress={() => setMoreModalVisible(false)}
        useNativeDriver
        hideModalContentWhileAnimating
        animationIn="slideInUp"
        animationOut="slideOutDown"
        backdropTransitionOutTiming={0}
        style={styles.bottomSheetModal}
      >
        <View style={styles.menuOverlay}>
          <View style={[styles.menuContent, { backgroundColor: colors.card }]}>
            <TouchableOpacity
              style={[
                styles.menuItem,
                {
                  backgroundColor: colors.primary,
                  borderRadius: 10,
                  paddingHorizontal: 15,
                  marginBottom: 10,
                },
              ]}
              onPress={() => {
                setMoreModalVisible(false);
                if (tracks.length === 0) return;
                handlePlayAll(tracks);
              }}
            >
              <Ionicons name="play" size={20} color={colors.background} />
              <Text style={[styles.playAllText, { color: colors.background }]}>
                {t("playlistPage.playAll")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItem]}
              onPress={() => {
                setMoreModalVisible(false);
                setIsSelectionMode(true);
                setSelectedTrackIds([]);
              }}
            >
              <Ionicons
                name="cloud-download-outline"
                size={24}
                color={colors.secondary}
              />
              <Text style={[styles.menuText, { color: colors.text }]}>
                {t("playlistPage.batchDownload")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItem]}
              onPress={() => {
                setMoreModalVisible(false);
                setIsMiDeviceSelectorVisible(true);
              }}
            >
              <XiaoAiIcon size={24} color={colors.secondary} />
              <Text style={[styles.menuText, { color: colors.text }]}>
                {t("playerPage.castToMiSpeaker")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMoreModalVisible(false);
                setNewName(playlist.name);
                setRenameModalVisible(true);
              }}
            >
              <Ionicons name="create-outline" size={20} color={colors.text} />
              <Text style={[styles.menuText, { color: colors.text }]}>
                {t("playlistPage.rename")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={handleDelete}>
              <Ionicons name="trash-outline" size={20} color="#ff4d4f" />
              <Text style={[styles.menuText, styles.dangerText]}>
                {t("playlistPage.dissolve")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.menuItem,
                { marginTop: 10, justifyContent: "center" },
              ]}
              onPress={() => setMoreModalVisible(false)}
            >
              <Text style={[styles.menuText, { color: colors.secondary }]}>
                {t("common.cancel")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Rename Modal */}
      <Modal
        isVisible={renameModalVisible}
        onBackdropPress={() => setRenameModalVisible(false)}
        onBackButtonPress={() => setRenameModalVisible(false)}
        useNativeDriver
        hideModalContentWhileAnimating
        animationIn="fadeIn"
        animationOut="fadeOut"
        backdropTransitionOutTiming={0}
        style={styles.centeredModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t("playlistPage.renameTitle")}
            </Text>
            <TextInput
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.border },
              ]}
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setRenameModalVisible(false)}
              >
                <Text style={{ color: colors.secondary }}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: colors.primary }]}
                onPress={handleRename}
                disabled={updating || !newName.trim()}
              >
                {updating ? (
                  <ActivityIndicator
                    size="small"
                    color={theme === "dark" ? "#000" : "#fff"}
                  />
                ) : (
                  <Text
                    style={[
                      styles.confirmText,
                      { color: theme === "dark" ? "#000" : "#fff" },
                    ]}
                  >
                    {t("common.confirm")}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <MiDeviceSelector
        visible={isMiDeviceSelectorVisible}
        onClose={() => setIsMiDeviceSelectorVisible(false)}
        onSelectDevice={(device) => handleCastPlaylistToMi(device.device_id, device.name)}
        loading={isCastingToMi}
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
    paddingHorizontal: 15,
    paddingBottom: 10,
    zIndex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTextContainer: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: 10,
  },
  headerTitleText: {
    fontSize: 18,
    fontWeight: "bold",
  },
  headerSubtitleText: {
    fontSize: 12,
  },
  backButton: {
    padding: 5,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 5,
    marginTop: 20,
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 10,
  },
  photoWall: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: "100%",
    // gap: 4, // Commented out gap to rule out compatibility issues
  },
  photoWallItem: {
    width: "33.33%", // 3 items per row
    aspectRatio: 1,
    padding: 2, // Use padding to create spacing
  },
  photoWallImage: {
    width: "100%",
    height: "100%",
    borderRadius: 0,
    backgroundColor: "#ddd", // Placeholder color
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
    width: 30,
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
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
    marginHorizontal: 10,
  },
  headerRight: {
    width: 28,
    alignItems: "center",
  },
  playAllText: {
    fontSize: 14,
    fontWeight: "bold",
    marginLeft: 8,
  },
  actionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 15,
  },
  moreButton: {
    padding: 5,
    width: 40,
    alignItems: "flex-end",
  },
  menuOverlay: {
    justifyContent: "flex-end",
    alignItems: "center",
    width: "100%",
  },
  bottomSheetModal: {
    margin: 0,
    justifyContent: "flex-end",
  },
  menuContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    width: "100%",
    maxWidth: 450,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 15,
    gap: 12,
  },
  menuText: {
    fontSize: 16,
    fontWeight: "500",
  },
  dangerText: {
    color: "#ff4d4f",
  },
  modalOverlay: {
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  centeredModal: {
    margin: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "80%",
    maxWidth: 450,
    borderRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  confirmBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 10,
    minWidth: 80,
    alignItems: "center",
  },
  confirmText: {
    color: "#fff",
    fontWeight: "bold",
  },
});
