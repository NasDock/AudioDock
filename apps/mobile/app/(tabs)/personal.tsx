import { isFnosSource } from "@/src/utils/mvSupport";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createCompactTask,
  createImportTask,
  createPlaylist,
  getAlbumHistory,
  getFavoriteAlbums,
  getFavoriteTracks,
  getImportTask,
  getPlaylists,
  getRunningImportTask,
  getTrackHistory,
  hasActiveTasks,
  setPlusToken,
  TaskStatus,
  uploadUserAvatar,
  type ImportTask,
} from "@soundx/services";
import { Image as ExpoImage } from "expo-image";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Modal from "react-native-modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SkeletonBlock from "../../src/components/SkeletonBlock";
import { useAuth } from "../../src/context/AuthContext";
import { usePlayer } from "../../src/context/PlayerContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getBaseURL } from "../../src/https";
import { Playlist, Track } from "../../src/models";
import {
  getDownloadedTracks,
  removeDownloadedTrack,
} from "../../src/services/cache";
import { openStoreDebug } from "../../src/services/openStore";
import { trackEvent } from "../../src/services/tracking";
import { getImageSource } from "../../src/utils/image";
import { usePlayMode } from "../../src/utils/playMode";
import {
  getCachedVipStatus,
  refreshVipStatus,
} from "../../src/utils/vipStatus";

import { CachedImage } from "@/src/components/CachedImage";
import {
  AntDesign,
  Ionicons,
  MaterialCommunityIcons,
} from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
const logo = require("../../assets/images/logo.webp");
const subsonicLogo = require("../../assets/images/subsonic.webp");
const embyLogo = require("../../assets/images/emby.webp");
const ctjjLogo = require("../../assets/images/ctjj.webp");
const xiaoaiIcon = require("../../assets/images/xiaoai_light.png");

type TabType = "playlists" | "favorites" | "history" | "downloads";
type SubTabType = "track" | "album";
type PendingMenuAction = "createPlaylist" | null;

const StackedCover = ({ tracks }: { tracks: any[] }) => {
  const covers = (tracks || []).slice(0, 4);
  const { colors } = useTheme();
  return (
    <View style={styles.stackedCoverContainer}>
      {covers.map((track, index) => {
        const coverSource = getImageSource(track.cover, "https://picsum.photos/100", 96);

        return (
          <CachedImage
            key={track.id}
            source={coverSource}
            style={[
              styles.itemCover,
              styles.stackedCover,
              {
                zIndex: 4 - index,
                left: index * 6,
                top: index * 3,
                position: index === 0 ? "relative" : "absolute",
                opacity: 1 - index * 0.1,
                borderColor: colors.card,
                borderWidth: index === 0 ? 0 : 1,
                transform: [{ scale: 1 - index * 0.04 }],
              },
            ]}
          />
        );
      })}
      {covers.length === 0 && (
        <Image
          source={{ uri: "https://picsum.photos/100" }}
          style={styles.itemCover}
        />
      )}
    </View>
  );
};

function PersonalListSkeleton({
  activeTab,
  mode,
  selectedDownloadAlbumName,
}: {
  activeTab: TabType;
  mode: string;
  selectedDownloadAlbumName: string | null;
}) {
  const { colors } = useTheme();
  const isPlaylist = activeTab === "playlists";
  const isDownloadAlbum =
    activeTab === "downloads" &&
    mode === "AUDIOBOOK" &&
    !selectedDownloadAlbumName;

  return (
    <View style={{ paddingBottom: 20 }}>
      {Array.from({ length: 8 }).map((_, index) => (
        <View
          key={`personal-list-skeleton-${index}`}
          style={[styles.item, { borderBottomColor: colors.card }]}
        >
          {isPlaylist ? (
            <View style={styles.stackedCoverContainer}>
              <SkeletonBlock
                width={50}
                height={50}
                borderRadius={8}
                style={{ position: "absolute", left: 12, top: 6, opacity: 0.7 }}
              />
              <SkeletonBlock
                width={50}
                height={50}
                borderRadius={8}
                style={{ position: "absolute", left: 6, top: 3, opacity: 0.82 }}
              />
              <SkeletonBlock width={50} height={50} borderRadius={8} />
            </View>
          ) : (
            <SkeletonBlock
              width={50}
              height={50}
              borderRadius={8}
              style={{ marginRight: 15 }}
            />
          )}
          <View style={styles.itemInfo}>
            <SkeletonBlock
              width={150}
              height={16}
              borderRadius={8}
              style={{ marginBottom: 8 }}
            />
            <SkeletonBlock width={92} height={13} borderRadius={6} />
          </View>
          {activeTab === "downloads" && !isDownloadAlbum ? (
            <SkeletonBlock
              width={20}
              height={20}
              borderRadius={10}
              style={{ marginLeft: 10 }}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

export default function PersonalScreen() {
  const { theme, toggleTheme, colors } = useTheme();
  const { t } = useTranslation();
  const { mode, setMode } = usePlayMode();
  const { logout, user, switchServer, sourceType, setSourceType, device } =
    useAuth();
  // 飞牛音乐只支持单曲维度的收藏/播放历史（专辑接口返回空），因此只保留单曲视图
  const fnosSource = isFnosSource(sourceType);
  const { playTrackList } = usePlayer();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [permission, setPermission] = useState<any>(null);

  const [avatarOverride, setAvatarOverride] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    setAvatarOverride((user as any)?.avatar || null);
  }, [user]);

  const handleOpenScanEntry = async () => {
    trackEvent({
      feature: "scan_login",
      eventName: "scan_login_entry_click",
      userId: user?.id ? String(user.id) : undefined,
      deviceId: device?.id ? String(device.id) : undefined,
    });
    const plusToken = await AsyncStorage.getItem("plus_token");

    if (!plusToken) {
      Alert.alert(
        t("personalPage.memberOnlyTitle"),
        t("personalPage.scanLoginMemberOnly"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("personalPage.memberLogin"),
            onPress: () => {
              trackEvent({
                feature: "scan_login",
                eventName: "scan_login_member_login_redirect",
                userId: user?.id ? String(user.id) : undefined,
                deviceId: device?.id ? String(device.id) : undefined,
              });
              router.push("/member-login" as any);
            },
          },
        ],
      );
      return;
    }

    if (isPlusVip) {
      trackEvent({
        feature: "scan_login",
        eventName: "scan_login_page_open",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
      });
      router.push("/scan" as any);
      return;
    }

    Alert.alert(
      t("personalPage.memberOnlyTitle"),
      t("personalPage.scanLoginVipRequired"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("personalPage.goActivate"),
          onPress: () => {
            trackEvent({
              feature: "scan_login",
              eventName: "scan_login_member_benefits_redirect",
              userId: user?.id ? String(user.id) : undefined,
              deviceId: device?.id ? String(device.id) : undefined,
            });
            router.push("/member-benefits" as any);
          },
        },
      ],
    );
  };

  const handleChangeAvatar = async () => {
    if (!user?.id || uploadingAvatar) return;
    if (sourceType !== "AudioDock") {
      Alert.alert(t("common.ok"), t("personalPage.avatarUnsupported"));
      return;
    }
    try {
      setUploadingAvatar(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      const fileName = asset.fileName || `user-${user.id}-${Date.now()}.jpg`;
      const file = {
        uri: asset.uri,
        name: fileName,
        type: asset.mimeType || "image/jpeg",
      } as any;
      const res = await uploadUserAvatar(user.id, file);
      console.log("Upload avatar response:", res);
      if (res.code === 200) {
        const nextAvatar =
          res.data?.avatar || (res.data?.user as any)?.avatar || fileName;
        setAvatarOverride(nextAvatar);
        const baseUrl = getBaseURL();
        if (baseUrl) {
          const stored = await AsyncStorage.getItem(`user_${baseUrl}`);
          const parsed = stored ? JSON.parse(stored) : {};
          const updated = { ...parsed, avatar: nextAvatar };
          await AsyncStorage.setItem(
            `user_${baseUrl}`,
            JSON.stringify(updated),
          );
        }
      } else {
        Alert.alert(
          t("personalPage.updateFailed"),
          res.message || t("personalPage.uploadAvatarFailed"),
        );
      }
    } catch (error) {
      console.error("Failed to upload user avatar:", error);
      Alert.alert(
        t("personalPage.updateFailed"),
        t("personalPage.uploadAvatarFailed"),
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const [activeTab, setActiveTab] = useState<TabType>("playlists");
  const [activeSubTab, setActiveSubTab] = useState<SubTabType>("track");
  // 与 desktop 的 effectiveViewMode 同构：飞牛下强制单曲，避免残留 album 拉到空列表
  const effectiveSubTab: SubTabType = fnosSource ? "track" : activeSubTab;
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [downloads, setDownloads] = useState<Track[]>([]);
  const [downloadedAlbums, setDownloadedAlbums] = useState<any[]>([]);
  const [selectedDownloadAlbumName, setSelectedDownloadAlbumName] = useState<
    string | null
  >(null);
  const swingAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(swingAnim, {
          toValue: 1,
          duration: 3500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(swingAnim, {
          toValue: 0,
          duration: 3500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, []);

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (sourceType === "Emby" && activeTab === "history") {
      setActiveTab("playlists");
    }
  }, [sourceType, activeTab]);

  // Import task state
  const [menuVisible, setMenuVisible] = useState(false);
  const [pendingMenuAction, setPendingMenuAction] =
    useState<PendingMenuAction>(null);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importTask, setImportTask] = useState<ImportTask | null>(null);
  const pollTimerRef = React.useRef<any>(null);
  // 任务中心入口显隐：仅当存在进行中任务时显示
  const [showTaskCenterEntry, setShowTaskCenterEntry] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const active = await hasActiveTasks();
        if (!cancelled) setShowTaskCenterEntry(active);
      } catch {
        /* 忽略网络异常 */
      }
    };
    check();
    const timer = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  const [isPlusVip, setIsPlusVip] = useState(false);
  const [plusVipData, setPlusVipData] = useState<any>(null);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, activeTab, activeSubTab, mode, fnosSource]);

  // Reset selected album when tab changes or mode changes
  useEffect(() => {
    setSelectedDownloadAlbumName(null);
  }, [activeTab, mode]);

  // AUDIOBOOK 模式下强制使用专辑子标签
  useEffect(() => {
    if (!fnosSource && mode === "AUDIOBOOK" && activeSubTab !== "album") {
      setActiveSubTab("album");
    }
  }, [mode, fnosSource]);

  React.useEffect(() => {
    if (user) {
      getRunningImportTask().then((res) => {
        if (res.code === 200 && res.data) {
          const taskId = res.data.id;
          setImportTask(res.data);
          setImportModalVisible(true);

          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = setInterval(() => {
            pollTaskStatus(taskId);
          }, 1000);
        }
      });
    }
  }, [user]);

  // Fetch Plus VIP status
  React.useEffect(() => {
    const fetchVipStatus = async () => {
      try {
        const cached = await getCachedVipStatus();
        setIsPlusVip(cached.isVip);
        setPlusVipData(cached.vipData);

        const latest = await refreshVipStatus({ setPlusToken });
        setIsPlusVip(latest.isVip);
        setPlusVipData(latest.vipData);
      } catch (err) {
        console.error("Failed to fetch plus profile mobile", err);
      }
    };

    fetchVipStatus();
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (activeTab === "playlists") {
        const res = await getPlaylists(mode as any, user.id);
        if (res.code === 200) setPlaylists(res.data);
      } else if (activeTab === "favorites") {
        if (effectiveSubTab === "track") {
          const res = await getFavoriteTracks(user.id, 0, 10000, mode as any);
          if (res.code === 200)
            setFavorites(res.data.list.map((item: any) => item.track));
        } else {
          const res = await getFavoriteAlbums(user.id, 0, 10000, mode as any);
          console.log("Favorite albums response:", res);
          if (res.code === 200)
            setFavorites(res.data.list.map((item: any) => item.album));
        }
      } else if (activeTab === "history") {
        if (effectiveSubTab === "track") {
          const res = await getTrackHistory(user.id, 0, 10000, mode as any);
          if (res.code === 200)
            setHistory(res.data.list.map((item: any) => item.track));
        } else {
          const res = await getAlbumHistory(user.id, 0, 10000, mode as any);
          if (res.code === 200)
            setHistory(res.data.list.map((item: any) => item.album));
        }
      } else if (activeTab === "downloads") {
        const tracks = await getDownloadedTracks();
        // Filter by current mode? The user might want to see all or filtered.
        // Usually apps filter by mode.
        const filtered = tracks.filter((t) => t.type === mode);
        setDownloads(filtered);

        if (mode === "AUDIOBOOK") {
          const albumMap = new Map();
          filtered.forEach((track) => {
            if (!albumMap.has(track.album)) {
              albumMap.set(track.album, {
                id: track.album || "unknown", // Use name as ID
                name: track.album,
                artist: track.artist,
                cover: track.cover,
                type: "album",
                tracks: [],
              });
            }
            albumMap.get(track.album).tracks.push(track);
          });
          setDownloadedAlbums(Array.from(albumMap.values()));
        }
      }
    } catch (error) {
      console.error("Failed to load personal data:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [user, activeTab, activeSubTab, mode, fnosSource]);

  const handleOpenTtsTasks = async () => {
    setMenuVisible(false);
    trackEvent({
      feature: "tts",
      eventName: "tts_entry_click",
      userId: user?.id ? String(user.id) : undefined,
      deviceId: device?.id ? String(device.id) : undefined,
    });

    const plusToken = await AsyncStorage.getItem("plus_token");
    if (!plusToken) {
      Alert.alert(t("common.memberFeature"), t("common.loginFirst"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("personalPage.memberLogin"),
          onPress: () => router.push("/member-login" as any),
        },
      ]);
      return;
    }

    if (isPlusVip) {
      trackEvent({
        feature: "tts",
        eventName: "tts_task_list_open",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
      });
      router.push("/tts/tasks" as any);
      return;
    }

    Alert.alert(t("common.memberFeature"), t("personalPage.ttsVipRequired"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.goActivate"),
        onPress: () => {
          trackEvent({
            feature: "tts",
            eventName: "tts_member_benefits_redirect",
            userId: user?.id ? String(user.id) : undefined,
            deviceId: device?.id ? String(device.id) : undefined,
          });
          router.push("/member-benefits" as any);
        },
      },
    ]);
  };

  const handleDeleteDownload = (item: Track) => {
    Alert.alert(
      t("personalPage.deleteDownloadTitle"),
      t("personalPage.deleteDownloadMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            await removeDownloadedTrack(item.id, item.path); // Use path as URL
            await loadData();

            // If the last track in the expanded downloaded album is removed, return to the album list.
            if (selectedDownloadAlbumName) {
              const tracks = await getDownloadedTracks();
              const stillHasAlbum = tracks.some(
                (t) => t.album === selectedDownloadAlbumName && t.type === mode,
              );
              if (!stillHasAlbum) {
                setSelectedDownloadAlbumName(null);
              }
            }
          },
        },
      ],
    );
  };

  const handleCreatePlaylist = async () => {
    if (!user || !newPlaylistName.trim()) return;

    setCreating(true);
    try {
      const res = await createPlaylist(
        newPlaylistName.trim(),
        mode as any,
        user.id,
      );

      if (res.code === 200) {
        setCreateModalVisible(false);
        setNewPlaylistName("");
        await loadData();
        router.push(`/playlist/${res.data.id}`);
      }
    } catch (error) {
      console.error("Failed to create playlist:", error);
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateLibrary = async (
    updateMode: "incremental" | "full" | "compact",
  ) => {
    setMenuVisible(false);

    const startTask = async () => {
      try {
        const res =
          updateMode === "compact"
            ? await createCompactTask()
            : await createImportTask({ mode: updateMode });
        if (res.code === 200 && res.data) {
          const taskId = res.data.id;
          setImportModalVisible(true);
          setImportTask({
            id: taskId,
            status: TaskStatus.INITIALIZING,
            mode: updateMode,
            message:
              updateMode === "compact"
                ? t("personalPage.taskStartCompact")
                : t("personalPage.taskInit"),
          });

          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = setInterval(() => {
            pollTaskStatus(taskId);
          }, 1000);
        } else {
          Alert.alert(
            t("common.error"),
            res.message || t("personalPage.taskCreateFailed"),
          );
        }
      } catch (error) {
        console.error("Task creation error:", error);
        Alert.alert(t("common.error"), t("personalPage.taskCreateFailedHint"));
      }
    };

    if (updateMode === "compact") {
      Alert.alert(
        t("personalPage.confirmCompactTitle"),
        t("personalPage.confirmCompactContent"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("personalPage.confirmCompactAction"),
            style: "destructive",
            onPress: startTask,
          },
        ],
      );
    } else if (updateMode === "full") {
      Alert.alert(
        t("personalPage.confirmFullTitle"),
        t("personalPage.confirmFullContent"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("personalPage.confirmUpdateAction"),
            style: "destructive",
            onPress: startTask,
          },
        ],
      );
    } else {
      Alert.alert(
        t("personalPage.confirmIncrementalTitle"),
        t("personalPage.confirmIncrementalContent"),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("personalPage.confirmUpdateAction"), onPress: startTask },
        ],
      );
    }
  };

  const handleMenuHide = () => {
    if (pendingMenuAction === "createPlaylist") {
      setCreateModalVisible(true);
    }
    setPendingMenuAction(null);
  };

  /**
   * 测试按钮：跳转到"对应的"应用商店
   * - Android: market:// scheme，系统自动路由到已装商店
   * - iOS: App Store 公网页面
   * 仅供调试，正式版可移除。
   */
  const handleOpenStoreDebug = async () => {
    setMenuVisible(false);
    await openStoreDebug();
  };

  const pollTaskStatus = async (taskId: string) => {
    try {
      const res = await getImportTask(taskId);
      if (res.code === 200 && res.data) {
        setImportTask(res.data);
        const { status, total } = res.data;
        if (status === TaskStatus.SUCCESS) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setTimeout(() => setImportModalVisible(false), 2000);
          loadData(); // Refresh data after successful import
        } else if (status === TaskStatus.FAILED) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        }
      }
    } catch (error) {
      console.error("Poll error:", error);
    }
  };

  React.useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const renderItem = React.useCallback(
    ({ item }: { item: any }) => {
      const isPlaylist = activeTab === "playlists";
      const isAlbum =
        activeTab !== "playlists" &&
        activeTab !== "downloads" &&
        effectiveSubTab === "album";
      const isDownloadAlbum =
        activeTab === "downloads" &&
        mode === "AUDIOBOOK" &&
        !selectedDownloadAlbumName &&
        item.type === "album";

      // For downloads, if we are in audiobook mode and selected an album, we render tracks.
      // Wait, FlatList data source is controlled.

      const data = item;
      const coverSource = getImageSource(item.cover, "https://picsum.photos/100", 96);

      return (
        <TouchableOpacity
          style={[styles.item, { borderBottomColor: colors.border }]}
          onPress={async () => {
            if (isPlaylist) {
              router.push(`/playlist/${(data as Playlist).id}`);
            } else if (isAlbum) {
              router.push(`/album/${data.id}`);
            } else if (activeTab === "downloads") {
              if (isDownloadAlbum) {
                // Enter album
                setSelectedDownloadAlbumName(data.name);
              } else {
                // Play downloaded track
                const list = getListData();
                const index = list.findIndex(
                  (t: Track) => t.id === (data as Track).id,
                );
                playTrackList(list, index);
              }
            } else {
              const list = activeTab === "favorites" ? favorites : history;
              const index = list.findIndex((t) => t.id === (data as Track).id);
              playTrackList(list, index);
            }
          }}
          onLongPress={() => {
            if (activeTab === "downloads" && !isDownloadAlbum) {
              handleDeleteDownload(data as Track);
            }
          }}
        >
          {isPlaylist ? (
            <StackedCover tracks={(item as Playlist).tracks || []} />
          ) : (
            <View style={{ position: "relative" }}>
              {isDownloadAlbum ? (
                // Use a folder icon or similar if cover missing?
                // Or just use first track cover if we aggregated?
                // We passed cover in albumMap.
                <CachedImage
                  source={coverSource}
                  style={styles.itemCover}
                />
              ) : (
                <CachedImage
                  source={coverSource}
                  style={styles.itemCover}
                />
              )}

              {/* Progress Bar for Audiobook Albums */}
              {(isAlbum || isDownloadAlbum) &&
                activeTab === "history" &&
                mode === "AUDIOBOOK" &&
                (data as any).progress > 0 && (
                  <View
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 15, // marginRight of cover
                      height: 3,
                      backgroundColor: "rgba(0,0,0,0.3)",
                    }}
                  >
                    <View
                      style={{
                        width: `${(data as any).progress}%`,
                        height: "100%",
                        backgroundColor: colors.primary,
                      }}
                    />
                  </View>
                )}
            </View>
          )}
          <View style={styles.itemInfo}>
            <Text
              style={[styles.itemTitle, { color: colors.text }]}
              numberOfLines={1}
            >
              {data.name}
            </Text>
            <Text style={[styles.itemSubtitle, { color: colors.secondary }]}>
              {isPlaylist
                ? t("common.trackCount", {
                    count:
                      (data as Playlist)._count?.tracks ||
                      (data as Playlist).tracks?.length ||
                      0,
                  })
                : isAlbum || isDownloadAlbum
                  ? data.artist || ""
                  : (data as Track).artist}
            </Text>
          </View>

          {activeTab === "downloads" && !isDownloadAlbum && (
            <TouchableOpacity
              style={{ padding: 10 }}
              onPress={() => handleDeleteDownload(data)}
            >
              <Ionicons
                name="trash-outline"
                size={20}
                color={colors.secondary}
              />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      );
    },
    [
      activeTab,
      effectiveSubTab,
      colors,
      favorites,
      history,
      downloads,
      selectedDownloadAlbumName,
      downloadModeList(),
      playTrackList,
      mode,
    ],
  ); // Need helper for download list dependency?

  function downloadModeList() {
    if (activeTab !== "downloads") return [];
    if (mode === "AUDIOBOOK") {
      return selectedDownloadAlbumName
        ? downloads.filter((t) => t.album === selectedDownloadAlbumName)
        : downloadedAlbums;
    }
    return downloads;
  }

  // Helper to determine data to show
  const getListData = () => {
    if (activeTab === "playlists") return playlists;
    if (activeTab === "favorites") return favorites;
    if (activeTab === "history") return history;
    if (activeTab === "downloads") {
      if (mode === "AUDIOBOOK") {
        if (selectedDownloadAlbumName) {
          return downloads.filter((t) => t.album === selectedDownloadAlbumName);
        }
        return downloadedAlbums;
      }
      return downloads;
    }
    return [];
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        {theme === "festive" && (
          <>
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 20,
                top: 20,
                opacity: 0.15,
              }}
            >
              <ExpoImage
                source={require("../../assets/dexopt/fu.svg")}
                style={{ width: 120, height: 120 }}
                tintColor="#D4AF37"
                contentFit="contain"
              />
            </View>
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                right: 80,
                top: 10,
                opacity: 0.4,
                transform: [
                  {
                    rotate: swingAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["-5deg", "5deg"],
                    }),
                  },
                ],
              }}
            >
              <ExpoImage
                source={require("../../assets/dexopt/denglong.svg")}
                style={{ width: 45, height: 45 }}
                tintColor="#D4AF37"
                contentFit="contain"
              />
            </Animated.View>
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                right: 20,
                top: 50,
                opacity: 0.4,
              }}
            >
              <ExpoImage
                source={require("../../assets/dexopt/baozhu.svg")}
                style={{ width: 40, height: 40 }}
                tintColor="#D4AF37"
                contentFit="contain"
              />
            </View>
          </>
        )}
        <TouchableOpacity
          onPress={() => setMenuVisible(true)}
          style={styles.iconBtn}
        >
          <Ionicons name="add" size={28} color={colors.text} />
        </TouchableOpacity>
       <View style={{ flexDirection: "row", alignItems: "center" }}>
          <TouchableOpacity
           onPress={handleOpenScanEntry}
           style={[styles.iconBtn, { marginRight: 10 }]}
         >
            <AntDesign name="scan" size={22} color={colors.text} />
          </TouchableOpacity>
          {showTaskCenterEntry && (
            <TouchableOpacity
              onPress={() => router.push("/task-center" as any)}
              style={[styles.iconBtn, { marginRight: 10 }]}
            >
              <Ionicons name="list-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => router.push("/source-manage" as any)}
            style={[styles.iconBtn, { marginRight: 10 }]}
          >
            <Ionicons name="server-outline" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/mi-speaker")}
            style={[styles.iconBtn, { marginRight: 10 }]}
          >
            <Image
              source={xiaoaiIcon}
              tintColor={colors.text}
              style={{ width: 22, height: 22 }}
              resizeMode="contain"
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/settings")}
            style={styles.iconBtn}
          >
            <Ionicons name="settings-outline" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* User Info */}
      <View style={styles.userInfo}>
        <TouchableOpacity onPress={handleChangeAvatar} activeOpacity={0.8}>
          <CachedImage
            source={getImageSource(avatarOverride, "https://picsum.photos/200", 128)} // Placeholder for avatar
            style={styles.avatar}
          />
          {user && (
            <View
              style={[styles.avatarEditBadge, { backgroundColor: colors.card }]}
            >
              <Ionicons name="camera" size={14} color={colors.text} />
            </View>
          )}
        </TouchableOpacity>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[styles.nickname, { color: colors.text }]}>
            {user?.username || t("common.notLoggedIn")}
          </Text>
          {user && (
            <TouchableOpacity
              onPress={async () => {
                if (Platform.OS === "ios") {
                  return;
                }
                const plusToken = await AsyncStorage.getItem("plus_token");
                if (plusToken) {
                  const plusToken = await AsyncStorage.getItem("plus_token");
                  if (!plusToken) {
                    Alert.alert(
                      t("common.memberFeature"),
                      t("common.loginFirst"),
                      [
                        { text: t("common.cancel"), style: "cancel" },
                        {
                          text: t("personalPage.memberLogin"),
                          onPress: () => router.push("/member-login" as any),
                        },
                      ],
                    );
                    return;
                  }

                  if (isPlusVip) {
                    router.push("/member-detail");
                  } else {
                    router.push("/member-benefits" as any);
                  }
                } else {
                  router.push("/member-login" as any);
                }
              }}
            >
              <MaterialCommunityIcons
                name="crown"
                size={24}
                color={isPlusVip ? "#FFD700" : colors.secondary}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tabs */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {[
          { key: "playlists", label: t("personal.playlists") },
          { key: "favorites", label: t("personal.favorites") },
          { key: "history", label: t("personal.history") },
          { key: "downloads", label: t("personalPage.downloads") },
        ]
          .filter((tab) => !(sourceType === "Emby" && tab.key === "history"))
          .map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tabItem,
                activeTab === tab.key && {
                  borderBottomColor: colors.primary,
                  borderBottomWidth: 2,
                },
              ]}
              onPress={() => setActiveTab(tab.key as TabType)}
            >
              <Text
                style={[
                  styles.tabText,
                  {
                    color:
                      activeTab === tab.key ? colors.primary : colors.secondary,
                  },
                  activeTab === tab.key && { fontWeight: "bold" },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
      </View>

      {/* Sub-tabs for favorites and history */}
      {(activeTab === "favorites" || activeTab === "history") && (
        <View style={styles.subTabContainer}>
          {[
            ...(fnosSource
              ? []
              : [{ id: "album", label: t("personal.album") }]),
            ...(fnosSource || mode !== "AUDIOBOOK"
              ? [{ id: "track", label: t("personal.track") }]
              : []),
          ].map((sub) => (
            <TouchableOpacity
              key={sub.id}
              style={[
                styles.subTabItem,
                effectiveSubTab === sub.id && {
                  backgroundColor: "rgba(150,150,150,0.1)",
                },
              ]}
              onPress={() => setActiveSubTab(sub.id as SubTabType)}
            >
              <Text
                style={[
                  styles.subTabText,
                  {
                    color:
                      effectiveSubTab === sub.id
                        ? colors.primary
                        : colors.secondary,
                  },
                  effectiveSubTab === sub.id && { fontWeight: "bold" },
                ]}
              >
                {sub.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Back Button for Audiobook Downloads */}
      {activeTab === "downloads" &&
        mode === "AUDIOBOOK" &&
        selectedDownloadAlbumName && (
          <View style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center" }}
              onPress={() => setSelectedDownloadAlbumName(null)}
            >
              <Ionicons name="arrow-back" size={20} color={colors.primary} />
              <Text
                style={{ marginLeft: 5, color: colors.primary, fontSize: 16 }}
              >
                {t("personalPage.backToAlbum", {
                  name: selectedDownloadAlbumName,
                })}
              </Text>
            </TouchableOpacity>
          </View>
        )}

      {/* List Content */}
      {loading ? (
        <PersonalListSkeleton
          activeTab={activeTab}
          mode={mode}
          selectedDownloadAlbumName={selectedDownloadAlbumName}
        />
      ) : (
        <FlatList
          data={getListData()}
          renderItem={renderItem}
          onRefresh={onRefresh}
          refreshing={refreshing}
          keyExtractor={(item) =>
            (item.id || item.name).toString() + (item.type || "")
          } // item.id might be duplicated if same album in multiple contexts? Or safe.
          contentContainerStyle={{ paddingBottom: 20 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: colors.secondary, marginTop: 40 }}>
                {t("common.noData")}
              </Text>
            </View>
          }
        />
      )}

      <Modal
        isVisible={createModalVisible}
        onBackdropPress={() => setCreateModalVisible(false)}
        onBackButtonPress={() => setCreateModalVisible(false)}
        useNativeDriver
        hideModalContentWhileAnimating
        animationIn="fadeIn"
        animationOut="fadeOut"
        backdropTransitionOutTiming={0}
        style={styles.centeredModal}
      >
        <View style={styles.createModalOverlay}>
          <View
            style={[
              styles.createModalContent,
              { backgroundColor: colors.card },
            ]}
          >
            <Text style={[styles.createModalTitle, { color: colors.text }]}>
              {t("playlist.newPlaylist")}
            </Text>
            <TextInput
              style={[
                styles.createInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
              placeholder={t("playlist.namePlaceholder")}
              placeholderTextColor={colors.secondary}
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              autoFocus
            />
            <View style={styles.createModalButtons}>
              <TouchableOpacity
                style={styles.createCancelBtn}
                onPress={() => {
                  setCreateModalVisible(false);
                  setNewPlaylistName("");
                }}
              >
                <Text style={{ color: colors.secondary }}>
                  {t("common.cancel")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.createConfirmBtn,
                  { backgroundColor: colors.primary },
                ]}
                onPress={handleCreatePlaylist}
                disabled={creating || !newPlaylistName.trim()}
              >
                {creating ? (
                  <ActivityIndicator
                    size="small"
                    color={theme === "dark" ? "#000" : "#fff"}
                  />
                ) : (
                  <Text
                    style={[
                      styles.createConfirmText,
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

      {/* Action Selection Modal (Dropdown replacement) */}
      <Modal
        isVisible={menuVisible}
        onBackdropPress={() => setMenuVisible(false)}
        onBackButtonPress={() => setMenuVisible(false)}
        onModalHide={handleMenuHide}
        useNativeDriver
        hideModalContentWhileAnimating
        animationIn="fadeIn"
        animationOut="fadeOut"
        backdropTransitionOutTiming={0}
        style={styles.fullscreenModal}
      >
        <View style={styles.menuOverlay}>
          <View
            style={[
              styles.menuContent,
              {
                backgroundColor: colors.card,
              },
            ]}
          >
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setPendingMenuAction("createPlaylist");
                setMenuVisible(false);
              }}
            >
              <Ionicons name="list-outline" size={22} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                {t("personal.createPlaylist")}
              </Text>
            </TouchableOpacity>
            <View
              style={[styles.menuDivider, { backgroundColor: colors.border }]}
            />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => handleUpdateLibrary("incremental")}
            >
              <Ionicons name="refresh-outline" size={22} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                {t("personal.incrementalUpdate")}
              </Text>
            </TouchableOpacity>
            <View
              style={[styles.menuDivider, { backgroundColor: colors.border }]}
            />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => handleUpdateLibrary("full")}
            >
              <Ionicons name="sync-outline" size={22} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                {t("personal.fullUpdate")}
              </Text>
            </TouchableOpacity>
            <View
              style={[styles.menuDivider, { backgroundColor: colors.border }]}
            />
            {sourceType !== "Emby" && mode !== "MUSIC" && (
              <>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={handleOpenTtsTasks}
                >
                  <Ionicons name="mic-outline" size={22} color={colors.text} />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>
                    {t("personal.ttsConversion")}
                  </Text>
                </TouchableOpacity>
                <View
                  style={[
                    styles.menuDivider,
                    { backgroundColor: colors.border },
                  ]}
                />
              </>
            )}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => handleUpdateLibrary("compact")}
            >
              <Ionicons name="trash-outline" size={22} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                {t("personal.compactData")}
              </Text>
            </TouchableOpacity>
            <View
              style={[styles.menuDivider, { backgroundColor: colors.border }]}
            />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleOpenStoreDebug}
            >
              <Ionicons name="storefront-outline" size={22} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                测试：打开应用商店
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Import Progress Modal */}
      <Modal
        isVisible={importModalVisible}
        onBackdropPress={() => setImportModalVisible(false)}
        onBackButtonPress={() => setImportModalVisible(false)}
        useNativeDriver
        hideModalContentWhileAnimating
        animationIn="fadeIn"
        animationOut="fadeOut"
        backdropTransitionOutTiming={0}
        style={styles.centeredModal}
      >
        <View style={styles.importModalOverlay}>
          <View
            style={[
              styles.importModalContent,
              { backgroundColor: colors.card },
            ]}
          >
            <Text style={[styles.importModalTitle, { color: colors.text }]}>
              {importTask?.mode === "compact"
                ? t("personal.compactProgress")
                : t("personal.importProgress")}
            </Text>

            <View style={styles.importStatusRow}>
              <Text style={{ color: colors.secondary }}>
                {t("personalPage.statusLabel")}
              </Text>
              <Text style={{ color: colors.text, fontWeight: "500" }}>
                {importTask?.message &&
                importTask.status !== TaskStatus.FAILED &&
                importTask.status !== TaskStatus.SUCCESS
                  ? importTask.message
                  : importTask?.status === TaskStatus.INITIALIZING
                    ? importTask?.mode === "compact"
                      ? t("personal.initializingCompact")
                      : t("personal.initializing")
                    : importTask?.status === TaskStatus.PREPARING
                      ? importTask?.mode === "compact"
                        ? t("personal.compactData")
                        : t("personal.preparingEnv")
                      : importTask?.status === TaskStatus.PARSING
                        ? t("personal.parsingMedia")
                        : importTask?.status === TaskStatus.SUCCESS
                          ? importTask?.mode === "compact"
                            ? t("personal.compactComplete")
                            : t("personal.importComplete")
                          : importTask?.status === TaskStatus.FAILED
                            ? importTask?.mode === "compact"
                              ? t("personal.compactFailed")
                              : t("personal.importFailed")
                            : t("common.loading")}
              </Text>
            </View>

            {importTask?.status === TaskStatus.FAILED && (
              <Text style={[styles.importErrorText, { color: colors.primary }]}>
                {t("personalPage.errorLabel")}
                {importTask.message}
              </Text>
            )}

            <View
              style={[
                styles.progressBarContainer,
                { backgroundColor: colors.background },
              ]}
            >
              <View
                style={[
                  styles.progressBarFill,
                  {
                    backgroundColor: colors.primary,
                    width: `${importTask?.total ? Math.round(((importTask.current || 0) / importTask.total) * 100) : 0}%`,
                  },
                ]}
              />
            </View>

            {importTask?.mode !== "compact" && (
              <View style={{ marginBottom: 20 }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <Text style={{ color: colors.secondary, fontSize: 12 }}>
                    {t("personalPage.localFiles")}
                  </Text>
                  <Text style={{ color: colors.text, fontSize: 12 }}>
                    {importTask?.localCurrent || 0} /{" "}
                    {importTask?.localTotal || 0}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <Text style={{ color: colors.secondary, fontSize: 12 }}>
                    {t("personalPage.webdavFiles")}
                  </Text>
                  <Text style={{ color: colors.text, fontSize: 12 }}>
                    {importTask?.webdavCurrent || 0} /{" "}
                    {importTask?.webdavTotal || 0}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <Text style={{ color: colors.secondary, fontSize: 12 }}>
                    {t("personalPage.mvFiles")}
                  </Text>
                  <Text style={{ color: colors.text, fontSize: 12 }}>
                    {importTask?.mvCurrent || 0} / {importTask?.mvTotal || 0}
                  </Text>
                </View>
                <View
                  style={{
                    height: 1,
                    backgroundColor: colors.border,
                    marginVertical: 4,
                  }}
                />
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 13,
                      fontWeight: "bold",
                    }}
                  >
                    {t("personalPage.totalProgress")}
                  </Text>
                  <Text
                    style={{
                      color: colors.primary,
                      fontSize: 13,
                      fontWeight: "bold",
                    }}
                  >
                    {importTask?.current || 0} / {importTask?.total || 0}
                  </Text>
                </View>
              </View>
            )}

            {importTask?.mode !== "compact" && importTask?.currentFileName && (
              <View
                style={{
                  backgroundColor: colors.background,
                  padding: 8,
                  borderRadius: 6,
                  marginBottom: 15,
                }}
              >
                <Text
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={{
                    color: colors.secondary,
                    fontSize: 11,
                    fontStyle: "italic",
                  }}
                >
                  {t("personalPage.processing", {
                    name: importTask.currentFileName,
                  })}
                </Text>
              </View>
            )}

            {importTask?.status === TaskStatus.SUCCESS ||
            importTask?.status === TaskStatus.FAILED ? (
              <TouchableOpacity
                style={[
                  styles.importCloseBtn,
                  { backgroundColor: colors.primary },
                ]}
                onPress={() => setImportModalVisible(false)}
              >
                <Text
                  style={[
                    styles.importCloseBtnText,
                    { color: theme === "dark" ? "#000" : "#fff" },
                  ]}
                >
                  {t("common.close")}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.importHideBtn}
                onPress={() => setImportModalVisible(false)}
              >
                <Text style={{ color: colors.secondary }}>
                  {t("personalPage.backgroundRun")}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    height: 50,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  iconBtn: {
    padding: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  userInfo: {
    alignItems: "center",
    paddingVertical: 0,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 15,
  },
  avatarEditBadge: {
    position: "absolute",
    right: 0,
    bottom: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
  },
  nickname: {
    fontSize: 20,
    fontWeight: "bold",
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingHorizontal: 20,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 15,
  },
  tabText: {
    fontSize: 16,
  },
  subTabContainer: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
  },
  subTabItem: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  subTabText: {
    fontSize: 14,
  },
  item: {
    flexDirection: "row",
    padding: 15,
    alignItems: "center",
    borderBottomWidth: 0.5,
  },
  itemCover: {
    width: 50,
    height: 50,
    borderRadius: 8,
    marginRight: 15,
  },
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 4,
  },
  itemSubtitle: {
    fontSize: 13,
  },
  stackedCoverContainer: {
    width: 70,
    height: 60,
    marginRight: 15,
  },
  stackedCover: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalContent: {
    height: "60%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 30,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(150,150,150,0.2)",
  },
  settingText: {
    fontSize: 16,
  },
  logoutBtn: {
    marginTop: 40,
    backgroundColor: "#ff4d4f",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  logoutText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  createModalOverlay: {
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  createModalContent: {
    width: "80%",
    maxWidth: 450,
    borderRadius: 20,
    padding: 24,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  createModalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  createInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    marginBottom: 24,
  },
  createModalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  createCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  createConfirmBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 10,
    justifyContent: "center",
    minWidth: 80,
    alignItems: "center",
  },
  createConfirmText: {
    color: "#fff",
    fontWeight: "bold",
  },
  menuOverlay: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  menuContent: {
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 0,
    minWidth: 200,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  menuItemText: {
    fontSize: 16,
  },
  menuDivider: {
    height: 1,
    width: "100%",
  },
  importModalOverlay: {
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  centeredModal: {
    margin: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenModal: {
    margin: 0,
    justifyContent: "flex-start",
    alignItems: "stretch",
  },
  importModalContent: {
    width: "90%",
    maxWidth: 450,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 20,
  },
  importModalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
  },
  importStatusRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  importErrorText: {
    marginBottom: 15,
  },
  progressBarContainer: {
    height: 6,
    borderRadius: 3,
    width: "100%",
    overflow: "hidden",
    marginBottom: 15,
  },
  progressBarFill: {
    height: "100%",
  },
  importCounts: {
    fontSize: 12,
    marginBottom: 20,
  },
  importCloseBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  importCloseBtnText: {
    fontWeight: "bold",
  },
  importHideBtn: {
    paddingVertical: 12,
    alignItems: "center",
  },
  scanModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  scanModalContent: {
    width: "100%",
    maxWidth: 440,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderWidth: 1,
  },
  scanModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  scanModalTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  scanPermissionState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    gap: 16,
  },
  scanHintText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 14,
  },
  scanCameraFrame: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 16,
    backgroundColor: "#000",
  },
  scanCamera: {
    flex: 1,
  },
  scanPrimaryButton: {
    minWidth: 160,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  scanPrimaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  scanSecondaryButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  scanSecondaryButtonText: {
    fontSize: 15,
    fontWeight: "500",
  },
  scanConfirmList: {
    maxHeight: 320,
    marginBottom: 16,
  },
  scanBundleCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  scanBundleTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  scanBundleItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  scanBundleItemTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  scanBundleItemMeta: {
    fontSize: 12,
    lineHeight: 18,
  },
  serverItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 5,
    borderBottomWidth: 0.5,
    borderRadius: 8,
  },
  serverItemText: {
    fontSize: 16,
  },
});
