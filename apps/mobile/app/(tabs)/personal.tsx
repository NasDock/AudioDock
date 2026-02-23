import { useFocusEffect } from "@react-navigation/native";
import {
  createImportTask,
  createPlaylist,
  getAlbumHistory,
  getFavoriteAlbums,
  getFavoriteTracks,
  getImportTask,
  getPlaylists,
  getRunningImportTask,
  getTrackHistory,
  TaskStatus,
  type ImportTask,
} from "@soundx/services";
import { Asset } from "expo-asset";
import { Image as ExpoImage } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../src/context/AuthContext";
import { usePlayer } from "../../src/context/PlayerContext";
import { useTheme } from "../../src/context/ThemeContext";
import { Playlist, Track } from "../../src/models";
import {
  getDownloadedTracks,
  removeDownloadedTrack,
} from "../../src/services/cache";
import { getImageUrl } from "../../src/utils/image";
import { usePlayMode } from "../../src/utils/playMode";

import { useCheckUpdate } from "@/hooks/useCheckUpdate";
import { CachedImage } from "@/src/components/CachedImage";
import { UpdateModal } from "@/src/components/UpdateModal";
import { Ionicons } from "@expo/vector-icons";
const logo = require("../../assets/images/logo.png");
const subsonicLogo = require("../../assets/images/subsonic.png");
const embyLogo = require("../../assets/images/emby.png");
const ctjjLogo = require("../../assets/images/ctjj.png");

type TabType = "playlists" | "favorites" | "history" | "downloads";
type SubTabType = "track" | "album";

const StackedCover = ({ tracks }: { tracks: any[] }) => {
  const covers = (tracks || []).slice(0, 4);
  const { colors } = useTheme();
  return (
    <View style={styles.stackedCoverContainer}>
      {covers.map((track, index) => {
        const coverUrl = getImageUrl(track.cover, "https://picsum.photos/100");

        return (
          <CachedImage
            key={track.id}
            source={{ uri: coverUrl }}
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

export default function PersonalScreen() {
  const { theme, toggleTheme, colors } = useTheme();
  const { mode, setMode } = usePlayMode();
  const { logout, user, switchServer, sourceType, setSourceType } = useAuth();
  const { playTrackList } = usePlayer();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    checkUpdate,
    progress,
    updateInfo,
    startUpdate,
    ignoreUpdate,
    cancelUpdate,
    installLocalUpdate,
  } = useCheckUpdate();

  const [isModalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    if (updateInfo) {
      setModalVisible(true);
    }
  }, [updateInfo]);

  const [activeTab, setActiveTab] = useState<TabType>("playlists");
  const [activeSubTab, setActiveSubTab] = useState<SubTabType>("track");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkUpdate();
  }, []);

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

  // Import task state
  const [menuVisible, setMenuVisible] = useState(false);
  const [donationModalVisible, setDonationModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importTask, setImportTask] = useState<ImportTask | null>(null);
  const pollTimerRef = React.useRef<any>(null);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        loadData();
      }
    }, [user, activeTab, activeSubTab, mode]),
  );

  // Reset selected album when tab changes or mode changes
  useFocusEffect(
    useCallback(() => {
      setSelectedDownloadAlbumName(null);
    }, [activeTab, mode]),
  );

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

  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (activeTab === "playlists") {
        const res = await getPlaylists(mode as any, user.id);
        if (res.code === 200) setPlaylists(res.data);
      } else if (activeTab === "favorites") {
        if (mode === "MUSIC" && activeSubTab === "track") {
          const res = await getFavoriteTracks(user.id, 0, 10000, mode as any);
          if (res.code === 200)
            setFavorites(res.data.list.map((item: any) => item.track));
        } else {
          const res = await getFavoriteAlbums(user.id, 0, 10000, mode as any);
          if (res.code === 200)
            setFavorites(res.data.list.map((item: any) => item.album));
        }
      } else if (activeTab === "history") {
        if (mode === "MUSIC" && activeSubTab === "track") {
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
    }
  };

  const handleDeleteDownload = (item: Track) => {
    Alert.alert("删除下载", "确定要删除这首歌曲的下载吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          await removeDownloadedTrack(item.id, item.path); // Use path as URL
          await loadData();

          // 如果删除的是当前展开专辑里的最后一首歌，则返回专辑列表
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
    ]);
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

  const handleUpdateLibrary = async (updateMode: "incremental" | "full") => {
    setMenuVisible(false);

    const startTask = async () => {
      try {
        const res = await createImportTask({ mode: updateMode });
        if (res.code === 200 && res.data) {
          const taskId = res.data.id;
          setImportModalVisible(true);
          setImportTask({ id: taskId, status: TaskStatus.INITIALIZING });

          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = setInterval(() => {
            pollTaskStatus(taskId);
          }, 1000);
        } else {
          Alert.alert("错误", res.message || "任务创建失败");
        }
      } catch (error) {
        console.error("Task creation error:", error);
        Alert.alert("错误", "创建任务失败，请检查网络或后端服务");
      }
    };

    if (updateMode === "full") {
      Alert.alert(
        "确认全量更新？",
        "全量更新将核对所有音频文件。您的播放历史、收藏记录、歌单由于文件识别（指纹）机制将得到保留。仅当文件在磁盘上被物理删除时，对应的记录才会被清除。",
        [
          { text: "取消", style: "cancel" },
          { text: "确认更新", style: "destructive", onPress: startTask },
        ],
      );
    } else {
      // Incremental confirmation
      Alert.alert("确认增量更新？", "增量更新只增加新数据，不删除旧数据", [
        { text: "取消", style: "cancel" },
        { text: "确认更新", onPress: startTask },
      ]);
    }
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
        (mode === "AUDIOBOOK" || activeSubTab === "album");
      const isDownloadAlbum =
        activeTab === "downloads" &&
        mode === "AUDIOBOOK" &&
        !selectedDownloadAlbumName &&
        item.type === "album";

      // For downloads, if we are in audiobook mode and selected an album, we render tracks.
      // Wait, FlatList data source is controlled.

      const data = item;
      const coverUrl = getImageUrl(item.cover, "https://picsum.photos/100");

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
                  source={{ uri: coverUrl }}
                  style={styles.itemCover}
                />
              ) : (
                <CachedImage
                  source={{ uri: coverUrl }}
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
                ? `${(data as Playlist)._count?.tracks || (data as Playlist).tracks?.length || 0} 首`
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
      activeSubTab,
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
        {theme === 'festive' && (
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
          {progress > 0 && (
            <TouchableOpacity
              onPress={() => {
                if (progress === 1) {
                  installLocalUpdate();
                } else {
                  setModalVisible(true);
                }
              }}
              style={[styles.iconBtn, { marginRight: 10 }]}
            >
              <Ionicons name="download-outline" size={22} color={colors.text} />
              <Text style={{ color: colors.text }}>
                {(progress * 100).toFixed(0)}%
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => setDonationModalVisible(true)}
            style={[styles.iconBtn, { marginRight: 10 }]}
          >
            <Ionicons name="heart-outline" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/source-manage" as any)}
            style={[styles.iconBtn, { marginRight: 10 }]}
          >
            <Ionicons name="server-outline" size={22} color={colors.text} />
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
        <CachedImage
          source={{
            uri: getImageUrl(
              (user as any)?.avatar,
              "https://picsum.photos/200",
            ),
          }} // Placeholder for avatar
          style={styles.avatar}
        />
        <Text style={[styles.nickname, { color: colors.text }]}>
          {user?.username || "未登录"}
        </Text>
      </View>

      {/* Tabs */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {[
          { key: "playlists", label: "播放列表" },
          { key: "favorites", label: "收藏" },
          { key: "history", label: "听过" },
          { key: "downloads", label: "下载" },
        ].map((tab) => (
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

      {/* Sub-tabs for MUSIC mode */}
      {mode === "MUSIC" &&
        (activeTab === "favorites" || activeTab === "history") && (
          <View style={styles.subTabContainer}>
            {[
              { id: "album", label: "专辑" },
              { id: "track", label: "单曲" },
            ].map((sub) => (
              <TouchableOpacity
                key={sub.id}
                style={[
                  styles.subTabItem,
                  activeSubTab === sub.id && {
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
                        activeSubTab === sub.id
                          ? colors.primary
                          : colors.secondary,
                    },
                    activeSubTab === sub.id && { fontWeight: "bold" },
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
                返回 {selectedDownloadAlbumName}
              </Text>
            </TouchableOpacity>
          </View>
        )}

      {/* List Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={getListData()}
          renderItem={renderItem}
          keyExtractor={(item) =>
            (item.id || item.name).toString() + (item.type || "")
          } // item.id might be duplicated if same album in multiple contexts? Or safe.
          contentContainerStyle={{ paddingBottom: 20 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: colors.secondary, marginTop: 40 }}>
                暂无数据
              </Text>
            </View>
          }
        />
      )}

      <UpdateModal
        visible={isModalVisible}
        progress={progress}
        updateInfo={updateInfo}
        onBackground={() => setModalVisible(false)}
        onUpdate={startUpdate}
        onIgnore={() => {
          ignoreUpdate();
          setModalVisible(false);
        }}
        onCancel={() => {
          cancelUpdate();
          setModalVisible(false);
        }}
      />

      <Modal
        visible={createModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <View style={styles.createModalOverlay}>
          <View
            style={[
              styles.createModalContent,
              { backgroundColor: colors.card },
            ]}
          >
            <Text style={[styles.createModalTitle, { color: colors.text }]}>
              新建播放列表
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
              placeholder="请输入列表名称"
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
                <Text style={{ color: colors.secondary }}>取消</Text>
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
                    确定
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Action Selection Modal (Dropdown replacement) */}
      <Modal
        visible={menuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View
            style={[
              styles.menuContent,
              { backgroundColor: colors.card, top: insets.top + 50 },
            ]}
          >
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setCreateModalVisible(true);
              }}
            >
              <Ionicons name="list-outline" size={22} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                新建播放列表
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
                增量更新音频文件
              </Text>
            </TouchableOpacity>
            <View
              style={[styles.menuDivider, { backgroundColor: colors.border }]}
            />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => handleUpdateLibrary("full")}
            >
              <Ionicons name="repeat-outline" size={22} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                全量更新音频文件
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Import Progress Modal */}
      <Modal
        visible={importModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.importModalOverlay}>
          <View
            style={[
              styles.importModalContent,
              { backgroundColor: colors.card },
            ]}
          >
            <Text style={[styles.importModalTitle, { color: colors.text }]}>
              数据入库进度
            </Text>

            <View style={styles.importStatusRow}>
              <Text style={{ color: colors.secondary }}>状态：</Text>
              <Text style={{ color: colors.text, fontWeight: "500" }}>
                {importTask?.message &&
                importTask.status !== TaskStatus.FAILED &&
                importTask.status !== TaskStatus.SUCCESS
                  ? importTask.message
                  : importTask?.status === TaskStatus.INITIALIZING
                    ? "正在初始化..."
                    : importTask?.status === TaskStatus.PARSING
                      ? "正在解析媒体文件..."
                      : importTask?.status === TaskStatus.SUCCESS
                        ? "入库完成"
                        : importTask?.status === TaskStatus.FAILED
                          ? "入库失败"
                          : "准备中"}
              </Text>
            </View>

            {importTask?.status === TaskStatus.FAILED && (
              <Text style={[styles.importErrorText, { color: colors.primary }]}>
                错误：{importTask.message}
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

            <View style={{ marginBottom: 20 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <Text style={{ color: colors.secondary, fontSize: 12 }}>
                  本地文件
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
                  WebDAV 文件
                </Text>
                <Text style={{ color: colors.text, fontSize: 12 }}>
                  {importTask?.webdavCurrent || 0} /{" "}
                  {importTask?.webdavTotal || 0}
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
                  总进度
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

            {importTask?.currentFileName && (
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
                  正在处理: {importTask.currentFileName}
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
                  关闭
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.importHideBtn}
                onPress={() => setImportModalVisible(false)}
              >
                <Text style={{ color: colors.secondary }}>后台运行</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Donation Modal */}
      <Modal
        visible={donationModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setDonationModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.importModalOverlay}
          activeOpacity={1}
          onPress={() => setDonationModalVisible(false)}
        >
          <View
            style={[
              styles.importModalContent,
              { backgroundColor: colors.card, alignItems: "center" },
            ]}
          >
            <Text
              style={[
                styles.importModalTitle,
                { color: colors.text, textAlign: "center" },
              ]}
            >
              赞赏开发者
            </Text>

            <Text
              style={{
                color: colors.secondary,
                marginBottom: 20,
                textAlign: "center",
              }}
            >
              如果您觉得 AudioDock 对您有帮助{"\n"}欢迎赞赏支持！
            </Text>

            <TouchableOpacity
              activeOpacity={0.9}
              onLongPress={async () => {
                try {
                  const { status } =
                    await MediaLibrary.requestPermissionsAsync();
                  if (status === "granted") {
                    const asset = Asset.fromModule(ctjjLogo);
                    await asset.downloadAsync();
                    await MediaLibrary.saveToLibraryAsync(
                      asset.localUri || asset.uri,
                    );
                    Alert.alert("保存成功", "赞赏码已保存到相册");
                  } else {
                    Alert.alert("权限不足", "请允许访问相册以保存图片");
                  }
                } catch (error) {
                  Alert.alert("保存失败", "无法保存图片");
                }
              }}
            >
              <Image
                source={ctjjLogo}
                style={{
                  width: 200,
                  height: 200,
                  borderRadius: 10,
                  marginBottom: 10,
                }}
              />
            </TouchableOpacity>

            <Text style={{ color: colors.secondary, fontSize: 12 }}>
              长按图片保存或截图到相册
            </Text>
          </View>
        </TouchableOpacity>
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
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
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
    backgroundColor: "rgba(0,0,0,0.1)",
  },
  menuContent: {
    position: "absolute",
    left: 20,
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
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
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
