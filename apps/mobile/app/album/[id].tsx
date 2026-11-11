import { AddToPlaylistModal } from "@/src/components/AddToPlaylistModal";
import { AlbumMoreModal } from "@/src/components/AlbumMoreModal";
import { CollectionSelectModal } from "@/src/components/CollectionSelectModal";
import { FilePathModal } from "@/src/components/FilePathModal";
import { FloatingActionButtons } from "@/src/components/FloatingActionButtons";
import { MiDeviceSelector } from "@/src/components/MiDeviceSelector";
import PlayingIndicator from "@/src/components/PlayingIndicator";
import SkeletonBlock from "@/src/components/SkeletonBlock";
import { TrackMoreModal } from "@/src/components/TrackMoreModal";
import { XiaoAiIcon } from "@/src/components/XiaoAiIcon";
import { useAuth } from "@/src/context/AuthContext";
import { usePlayer } from "@/src/context/PlayerContext";
import { useTheme } from "@/src/context/ThemeContext";
import { Album, Track, TrackSource } from "@/src/models";
import { downloadTracks } from "@/src/services/downloadManager";
import { getImageSource } from "@/src/utils/image";
import { isMvSupported } from "@/src/utils/mvSupport";
import { mvPlaylistStore } from "@/src/store/mvPlaylist";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import {
  type AlbumTrackSortBy,
  getAlbumById,
  getAlbumTracks,
  playMiDevicePlaylist,
  toggleAlbumLike,
  toggleAlbumUnLike,
  uploadAlbumCover,
  getMvsByAlbum,
} from "@soundx/services";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const ALBUM_COVER_SIZE = 200;
const ALBUM_ACTION_SIZE = 44;
const ALBUM_HEADER_ICON_SIZE = 24;
const ALBUM_TRACK_COVER_SIZE = 20;

export default function AlbumDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { playTrack, playTrackList, currentTrack, isPlaying, seekTo, position } =
    usePlayer();
  const { user, sourceType } = useAuth();
  const mvSupported = isMvSupported(sourceType);
  const [album, setAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [mvs, setMvs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"tracks" | "mvs">("tracks");
  const [loading, setLoading] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [sortBy, setSortBy] = useState<AlbumTrackSortBy>("fileName");
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [total, setTotal] = useState(0);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [moreModalVisible, setMoreModalVisible] = useState(false);
  const [albumMoreVisible, setAlbumMoreVisible] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);
  const [collectionModalVisible, setCollectionModalVisible] = useState(false);
  const [filePathVisible, setFilePathVisible] = useState(false);
  const [propertyTrack, setPropertyTrack] = useState<Track | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<(number | string)[]>([]);
  const flatListRef = useRef<FlatList<Track>>(null);

  // Mi Speaker cast state
  const [isMiDeviceSelectorVisible, setIsMiDeviceSelectorVisible] = useState(false);
  const [isCastingToMi, setIsCastingToMi] = useState(false);

  const PAGE_SIZE = 20000;

  // 飞牛音乐没有 MV 能力：切源时若停在 MV tab 就退回曲目 tab
  useEffect(() => {
    if (!mvSupported && activeTab === "mvs") {
      setActiveTab("tracks");
    }
  }, [mvSupported, activeTab]);

  useEffect(() => {
    if (id) {
      loadData(id as string, sort, sortBy);
    }
  }, [id, sort, sortBy, mvSupported]);

  const loadData = async (albumId: number | string, currentSort: "asc" | "desc", currentSortBy: AlbumTrackSortBy) => {
    try {
      setLoading(true);
      const [albumRes, tracksRes] = await Promise.all([
        getAlbumById(albumId),
        getAlbumTracks(albumId, PAGE_SIZE, 0, currentSort, undefined, user?.id, currentSortBy),
      ]);

      if (albumRes.code === 200 && albumRes.data) {
        setAlbum(albumRes.data);
        const likedByUsers = albumRes.data.likedByUsers || [];
        const isLikedByCurrentUser = likedByUsers.some(
          (like: any) => like.userId === user?.id
        );
        setIsLiked(isLikedByCurrentUser);
        
        // load MVs（飞牛音乐没有 MV 能力，跳过无效请求）
        if (mvSupported && albumRes.data?.name) {
            getMvsByAlbum(albumRes.data.name, albumRes.data.artist).then((res: any[]) => {
                if (res?.length) {
                    setMvs(res);
                }
            }).catch((e: any) => console.error(e));
        }
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

  const handleUpdateCover = async () => {
    if (!album || uploadingCover) return;
    if (sourceType !== "AudioDock") {
      Alert.alert(t("albumPage.notice"), t("albumPage.audioDockOnlyCover"));
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
      const fileName = asset.fileName || `album-${album.id}-${Date.now()}.jpg`;
      const file = {
        uri: asset.uri,
        name: fileName,
        type: asset.mimeType || "image/jpeg",
      } as any;
      const res = await uploadAlbumCover(album.id, file);
      if (res.code === 200) {
        setAlbum(res.data);
      } else {
        Alert.alert(t("albumPage.uploadFailed"), res.message || t("albumPage.uploadCoverFailed"));
      }
    } catch (error) {
      console.error("Failed to upload album cover:", error);
      Alert.alert(t("albumPage.uploadFailed"), t("albumPage.uploadCoverFailed"));
    } finally {
      setUploadingCover(false);
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
      Alert.alert(t("albumPage.notice"), t("albumPage.selectTracksFirst"));
      return;
    }
    Alert.alert(
      t("albumPage.batchDownloadTitle"),
      t("albumPage.batchDownloadMessage", {
        name: album?.name,
        count: selectedTrackIds?.length || 0,
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.confirm"),
          onPress: () => {
            downloadTracks(
              selectedTracks,
              (completed: number, total: number) => {
                if (completed === total) {
                  Alert.alert(
                    t("albumPage.downloadComplete"),
                    t("albumPage.downloadedTrackCount", { count: total }),
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

  const handleCastAlbumToMi = async (deviceId: string, deviceName: string) => {
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
      console.error("Failed to cast album to Mi device:", e);
      Alert.alert(t("playerPage.miCastPlaylistFailed"));
    } finally {
      setIsCastingToMi(false);
    }
  };

  if (loading) {
    return <AlbumDetailSkeleton />;
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
            ? t("albumPage.selectedCount", { count: selectedTrackIds.length })
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
        ref={flatListRef}
        data={mvSupported && activeTab === 'mvs' ? mvs : tracks}
        keyExtractor={(item) => item.id.toString()}
        onScrollToIndexFailed={(info) => {
          flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.coverContainer}>
              <Image
                source={getImageSource(album.cover, `https://picsum.photos/seed/${album.id}/300/300`, 600)}
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
              {activeTab === "tracks" ? (
                <>
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
                      {album.resumeTrackId ? t("albumPage.continuePlaying") : t("albumPage.playAll")}
                    </Text>
                  </TouchableOpacity>
                  {album.type === "AUDIOBOOK" && (
                    <TouchableOpacity
                      style={[styles.likeButton, { backgroundColor: colors.card }]}
                      onPress={() => setSortModalVisible(true)}
                    >
                      <Ionicons
                        name="options-outline"
                        size={24}
                        color={colors.secondary}
                      />
                    </TouchableOpacity>
                  )}
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
                  {!isSelectionMode && album.type !== "AUDIOBOOK" && (
                    <TouchableOpacity
                      style={[styles.likeButton, { backgroundColor: colors.card }]}
                      onPress={() => setIsMiDeviceSelectorVisible(true)}
                    >
                      <XiaoAiIcon size={22} color={colors.secondary} />
                    </TouchableOpacity>
                  )}
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
                </>
              ) : null}
            </View>
            
            {mvSupported && mvs.length > 0 && (
              <View style={{ flexDirection: 'row', marginTop: 20, width: '100%', borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <TouchableOpacity 
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: activeTab === 'tracks' ? 2 : 0, borderBottomColor: colors.primary }}
                  onPress={() => setActiveTab('tracks')}
                >
                  <Text style={{ color: activeTab === 'tracks' ? colors.primary : colors.secondary, fontWeight: activeTab === 'tracks' ? 'bold' : 'normal' }}>
                    {t('nav.tracks')} ({total})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: activeTab === 'mvs' ? 2 : 0, borderBottomColor: colors.primary }}
                  onPress={() => setActiveTab('mvs')}
                >
                  <Text style={{ color: activeTab === 'mvs' ? colors.primary : colors.secondary, fontWeight: activeTab === 'mvs' ? 'bold' : 'normal' }}>
                    MV ({mvs.length})
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        }
        renderItem={({ item, index }) => {
          if (mvSupported && activeTab === 'mvs') {
            return (
              <TouchableOpacity
                style={[styles.trackItem, { borderBottomColor: colors.border }]}
                onPress={() => {
                  mvPlaylistStore.setPlaylist(mvs, index);
                  router.push({ pathname: "/mv/[id]", params: { id: String(item.id) } } as any);
                }}
              >
                <View style={styles.trackIndexContainer}>
                  <Text style={[styles.trackIndex, { color: colors.secondary }]}>{index + 1}</Text>
                </View>
                <Image
                  source={getImageSource(item.cover, `https://picsum.photos/seed/mv-${item.id}/40/30`, 96)}
                  style={{ width: 40, height: 30, borderRadius: 2 }}
                />
                <View style={styles.trackInfo}>
                  <View style={styles.trackNameRow}>
                    <Text style={[styles.trackName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[styles.trackSource, { color: colors.secondary }]}>
                      {item.source === TrackSource.WEBDAV
                        ? t("trackList.sourceWebdav")
                        : t("trackList.sourceFile")}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.trackDuration, { color: colors.secondary }]}>
                  {item.duration ? `${Math.floor(item.duration / 60)}:${(item.duration % 60).toString().padStart(2, "0")}` : "--:--"}
                </Text>
              </TouchableOpacity>
            );
          }
          return (
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
                setSelectedTrack(item as Track);
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
                source={getImageSource(item.cover, `https://picsum.photos/seed/${item.id}/20/20`, 96)}
                alt=""
                style={{ width: 20, height: 20, borderRadius: 2 }}
              />
              <View style={styles.trackInfo}>
                <View style={styles.trackNameRow}>
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
                  <Text style={[styles.trackSource, { color: colors.secondary }]}>
                    {item.source === TrackSource.WEBDAV
                      ? t("trackList.sourceWebdav")
                      : t("trackList.sourceFile")}
                  </Text>
                </View>
              </View>
              {album.type === "AUDIOBOOK" && (() => {
                const displayProgress = currentTrack?.id === item.id ? position : ((item as any).progress || item.listenedAsAudiobookByUsers?.[0]?.progress || 0);
                if (displayProgress <= 0) return null;
                return (
                  <View style={{ marginRight: 10 }}>
                    <Text style={{ fontSize: 10, color: colors.primary }}>
                      {t("playerPage.listened")}
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
          );
        }}
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
        onShowProperties={(track) => {
          setPropertyTrack(track);
          setFilePathVisible(true);
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
        onUpdateCover={handleUpdateCover}
        onManageCollections={() => setCollectionModalVisible(true)}
      />

      <FilePathModal
        visible={filePathVisible}
        title={propertyTrack ? t("albumPage.trackPropertiesWithName", { name: propertyTrack.name }) : t("albumPage.trackProperties")}
        path={propertyTrack?.path}
        onClose={() => setFilePathVisible(false)}
      />
      <CollectionSelectModal
        visible={collectionModalVisible}
        album={album}
        onClose={() => setCollectionModalVisible(false)}
      />
      <Modal
        visible={sortModalVisible}
        transparent
        animationType="slide"
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
        onRequestClose={() => setSortModalVisible(false)}
      >
        <Pressable
          style={styles.sortModalOverlay}
          onPress={() => setSortModalVisible(false)}
        >
          <Pressable
            style={[styles.sortModalSheet, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.sortModalTitle, { color: colors.text }]}>
              {t("albumPage.sortTitle")}
            </Text>
            {([
              ["fileName", t("albumPage.sortFileName")],
              ["episodeNumber", t("albumPage.sortOptimized")],
              ["fileCreatedAt", t("albumPage.sortFileCreatedAt")],
              ["fileModifiedAt", t("albumPage.sortFileModifiedAt")],
            ] as [AlbumTrackSortBy, string][]).map(([value, label]) => {
              const active = sortBy === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[
                    styles.sortOption,
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => setSortBy(value)}
                >
                  <Text
                    style={[
                      styles.sortOptionText,
                      { color: active ? colors.primary : colors.text },
                    ]}
                  >
                    {label}
                  </Text>
                  {active && (
                    <Ionicons name="checkmark" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
            <Text
              style={[
                styles.sortModalTitle,
                { color: colors.text, marginTop: 18 },
              ]}
            >
              {t("albumPage.sortOrderTitle")}
            </Text>
            <View style={styles.sortOrderRow}>
              {([
                ["asc", t("albumPage.sortAscending")],
                ["desc", t("albumPage.sortDescending")],
              ] as ["asc" | "desc", string][]).map(([value, label]) => {
                const active = sort === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[
                      styles.sortOrderButton,
                      {
                        backgroundColor: active ? colors.primary : colors.background,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setSort(value)}
                  >
                    <Text
                      style={{
                        color: active ? colors.background : colors.text,
                        fontWeight: "600",
                      }}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      {tracks.length >= 20 && (
        <FloatingActionButtons
          flatListRef={flatListRef}
          onLocateCurrent={handleLocateCurrent}
          locateDisabled={!currentTrack || !tracks.some(t => t.id === currentTrack.id)}
        />
      )}
      <MiDeviceSelector
        visible={isMiDeviceSelectorVisible}
        onClose={() => setIsMiDeviceSelectorVisible(false)}
        onSelectDevice={(device) => handleCastAlbumToMi(device.device_id, device.name)}
        loading={isCastingToMi}
      />
    </View>
  );
}

function AlbumDetailSkeleton() {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.customHeader, { backgroundColor: colors.background }]}>
        <View style={styles.backButton}>
          <SkeletonBlock width={28} height={28} borderRadius={14} />
        </View>
        <SkeletonBlock width="45%" height={22} borderRadius={11} />
        <View style={styles.headerRight}>
          <SkeletonBlock
            width={ALBUM_HEADER_ICON_SIZE}
            height={ALBUM_HEADER_ICON_SIZE}
            borderRadius={ALBUM_HEADER_ICON_SIZE / 2}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <SkeletonBlock
            width={ALBUM_COVER_SIZE}
            height={ALBUM_COVER_SIZE}
            borderRadius={10}
            style={{ marginBottom: 15 }}
          />
          <SkeletonBlock width={180} height={28} borderRadius={10} style={{ marginBottom: 10 }} />
          <SkeletonBlock width={120} height={20} borderRadius={10} />

          <View style={styles.actions}>
            <SkeletonBlock width={150} height={44} borderRadius={25} />
            <SkeletonBlock
              width={ALBUM_ACTION_SIZE}
              height={ALBUM_ACTION_SIZE}
              borderRadius={ALBUM_ACTION_SIZE / 2}
            />
            <SkeletonBlock
              width={ALBUM_ACTION_SIZE}
              height={ALBUM_ACTION_SIZE}
              borderRadius={ALBUM_ACTION_SIZE / 2}
            />
          </View>
        </View>

        {Array.from({ length: 8 }).map((_, index) => (
          <View
            key={index}
            style={[styles.trackItem, { borderBottomColor: colors.border }]}
          >
            <View style={styles.trackIndexContainer}>
              <SkeletonBlock width={18} height={18} borderRadius={9} />
            </View>
            <SkeletonBlock
              width={ALBUM_TRACK_COVER_SIZE}
              height={ALBUM_TRACK_COVER_SIZE}
              borderRadius={2}
            />
            <View style={styles.trackInfo}>
              <SkeletonBlock
                width={index % 3 === 0 ? "72%" : index % 3 === 1 ? "58%" : "66%"}
                height={16}
                borderRadius={8}
              />
            </View>
            <SkeletonBlock width={36} height={12} borderRadius={6} />
          </View>
        ))}
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
    width: ALBUM_COVER_SIZE,
    height: ALBUM_COVER_SIZE,
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
    width: ALBUM_COVER_SIZE - 6,
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
    gap: 10,
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
    width: ALBUM_ACTION_SIZE,
    height: ALBUM_ACTION_SIZE,
    borderRadius: ALBUM_ACTION_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
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
  trackNameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  trackName: {
    fontSize: 16,
    marginBottom: 2,
    flexShrink: 1,
  },
  trackSource: {
    fontSize: 10,
    marginLeft: 6,
  },
  trackArtist: {
    fontSize: 12,
  },
  trackDuration: {
    fontSize: 12,
  },
  sortModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sortModalSheet: {
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 32,
  },
  sortModalTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 10,
  },
  sortOption: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sortOptionText: {
    fontSize: 15,
  },
  sortOrderRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6,
  },
  sortOrderButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
