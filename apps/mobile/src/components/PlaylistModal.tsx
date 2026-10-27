import PlayingIndicator from "@/src/components/PlayingIndicator";
import { useAuth } from "@/src/context/AuthContext";
import { usePlayer } from "@/src/context/PlayerContext";
import { useTheme } from "@/src/context/ThemeContext";
import { TrackType } from "@/src/models";
import { usePlayMode } from "@/src/utils/playMode";
import { Ionicons } from "@expo/vector-icons";
import { getAlbumHistory, getFavoriteAlbums, getFavoriteTracks, getTrackHistory } from "@soundx/services";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Image,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { Modal, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { getImageUrl } from "../utils/image";
import { FloatingActionButtons } from "./FloatingActionButtons";

type TabType = "current" | "history" | "favorites";
type SubTabType = "track" | "album";

export const PlaylistModal = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, sourceType } = useAuth();
  const { mode } = usePlayMode();
  const router = useRouter();
  const {
    trackList,
    currentTrack,
    playTrackList,
    showPlaylist,
    setShowPlaylist,
    playTrack,
    isPlaying,
    position,
  } = usePlayer();

  const [activeTab, setActiveTab] = useState<TabType>("current");
  const [activeSubTab, setActiveSubTab] = useState<SubTabType>("track");

  // AUDIOBOOK 模式下强制使用专辑子标签
  useEffect(() => {
    if (mode === "AUDIOBOOK" && activeSubTab !== "album") {
      setActiveSubTab("album");
    }
  }, [mode]);
  const [listData, setListData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const flatListRef = React.useRef<FlatList>(null);
  // 每次打开弹窗/切回「当前播放」tab 时只允许自动滚动一次，
  // 之后用户手动滚动不再被依赖变化（如 trackList 引用更新）打断
  const hasAutoScrolledRef = React.useRef(false);

  const scrollToCurrent = () => {
    if (activeTab !== "current" || !currentTrack) return;
    const index = trackList.findIndex((t) => t.id === currentTrack.id);
    if (index !== -1) {
      flatListRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5,
      });
    }
  };

  useEffect(() => {
    if (sourceType === "Emby" && activeTab === "history") {
      setActiveTab("current");
    }
  }, [sourceType, activeTab]);

  // 弹窗关闭或离开「当前播放」tab 时重置标记，下次进入可再自动定位一次
  useEffect(() => {
    if (!showPlaylist || activeTab !== "current") {
      hasAutoScrolledRef.current = false;
    }
  }, [showPlaylist, activeTab]);

  useEffect(() => {
    if (showPlaylist && user) {
      if (activeTab === "current") {
        setListData(trackList);
        // Scroll to current track（每次打开仅自动滚动一次）
        if (currentTrack && !hasAutoScrolledRef.current) {
           const index = trackList.findIndex((t) => t.id === currentTrack.id);
           if (index !== -1) {
             hasAutoScrolledRef.current = true;
             setTimeout(() => {
               flatListRef.current?.scrollToIndex({
                 index,
                 animated: true,
                 viewPosition: 0.5,
               });
             }, 500);
           }
        }
      } else {
        loadTabData();
      }
    }
  }, [showPlaylist, activeTab, activeSubTab, user, mode, trackList]);

  const loadTabData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      let res: any;
      const currentSubTab = activeSubTab;

      if (activeTab === "history") {
        if (currentSubTab === "track") {
          res = await getTrackHistory(user.id, 0, 50, mode);
          if (res.code === 200) {
            setListData(res.data.list.map((item: any) => item.track));
          }
        } else {
          res = await getAlbumHistory(user.id, 0, 50, mode);
          if (res.code === 200) {
            setListData(res.data.list.map((item: any) => item.album));
          }
        }
      } else if (activeTab === "favorites") {
        if (currentSubTab === "track") {
          res = await getFavoriteTracks(user.id, 0, 50, mode);
          if (res.code === 200) {
            setListData(res.data.list.map((item: any) => item.track));
          }
        } else {
          res = await getFavoriteAlbums(user.id, 0, 50, mode);
          if (res.code === 200) {
            setListData(res.data.list.map((item: any) => item.album));
          }
        }
      }
    } catch (error) {
      console.error("Failed to load data in modal:", error);
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item, index }: { item: any; index: number }) => {
    const isCurrent = activeTab === "current";
    const isAlbum = !isCurrent && activeSubTab === "album";
    const isHistoryOrFav = activeTab !== "current";

    // Item could be Track or Album
    const isActive = !isAlbum && currentTrack?.id === item.id;

    return (
      <TouchableOpacity
        style={[
          styles.modalItem,
          { borderBottomColor: colors.border },
          isActive && styles.activePlaylistItem,
        ]}
        onPress={async () => {
          if (isAlbum && isHistoryOrFav) {
            // Navigate to album detail page
            setShowPlaylist(false);
            router.push(`/album/${item.id}`);
          } else {
            if (activeTab === "current") {
              playTrackList(trackList, index);
            } else {
              playTrack(item);
            }
          }
        }}
      >
        <View style={styles.itemRow}>
          <View style={[!isAlbum && { width: isAlbum ? 50 : 20, alignItems: "center" }]}>
            <Image
              style={{
                width: isAlbum ? 50 : 20,
                height: isAlbum ? 50 : 20,
                borderRadius: isAlbum ? 4 : 2,
              }}
              source={{
                // 播放列表行内封面，走 96 档（恒压缩）——见 utils/image.ts 分级规则
                uri: getImageUrl(item.cover, "https://picsum.photos/100", 96),
              }}
            />
          </View>

          <Text
            style={[
              styles.modalItemText,
              { color: isActive ? colors.primary : ((currentTrack?.type === TrackType.AUDIOBOOK || mode === "AUDIOBOOK") && ((item as any).progress > 0 || (item.listenedAsAudiobookByUsers && item.listenedAsAudiobookByUsers[0] && item.listenedAsAudiobookByUsers[0].progress > 0))) ? colors.secondary : colors.text },
              { flex: 1 },
            ]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          {isActive && isPlaying && (
            <PlayingIndicator />
          )}
          {isAlbum && (
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.secondary}
            />
          )}
          {(currentTrack?.type === TrackType.AUDIOBOOK || mode === "AUDIOBOOK") && !isAlbum && (() => {
            const displayProgress = isActive ? position : ((item as any).progress || item.listenedAsAudiobookByUsers?.[0]?.progress || 0);
            if (displayProgress <= 0) return null;
            return (
              <Text style={[styles.progressText, { color: colors.secondary }]}>
                已听
                {Math.floor((displayProgress / (item.duration || 1)) * 100)}%
              </Text>
            );
          })()}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={showPlaylist} transparent animationType="slide" onRequestClose={() => setShowPlaylist(false)} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
      <Pressable style={styles.backdrop} onPress={() => setShowPlaylist(false)}>
        <View style={styles.modalWrapper}>
          <View
            style={[
              styles.modalContent,
              { backgroundColor: colors.card },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={styles.tabRow}>
                {[
                  { id: "current", label: t('playlist.currentPlaylist', { count: trackList.length }) },
                  { id: "history", label: t('playlist.listened') },
                  { id: "favorites", label: t('playlist.favorited') },
                ].filter((tab) => !(sourceType === "Emby" && tab.id === "history")).map((tab) => (
                  <TouchableOpacity
                    key={tab.id}
                    style={[
                      styles.tabItem,
                      activeTab === tab.id && {
                        borderBottomColor: colors.primary,
                        borderBottomWidth: 2,
                      },
                    ]}
                    onPress={() => setActiveTab(tab.id as TabType)}
                  >
                    <View style={styles.tabLabelRow}>
                      <Text
                        style={[
                          styles.tabText,
                          {
                            color:
                              activeTab === tab.id
                                ? colors.primary
                                : colors.secondary,
                          },
                        ]}
                      >
                        {tab.label}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {activeTab !== "current" && (
              <View style={styles.subTabContainer}>
                {[
                  { id: "album", label: t('playlist.album') },
                  ...(mode !== "AUDIOBOOK" ? [{ id: "track", label: t('playlist.single') }] : []),
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
                      ]}
                    >
                      {sub.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <FlatList
                ref={flatListRef}
                style={styles.list}
                data={listData}
                keyExtractor={(item, index) => `${item.id}-${index}`}
                renderItem={renderItem}
                contentContainerStyle={[
                  styles.listContent,
                  { paddingBottom: insets.bottom },
                ]}
                ListEmptyComponent={
                  <View style={styles.center}>
                    <Text style={{ color: colors.secondary, marginTop: 20 }}>
                      暂无记录
                    </Text>
                  </View>
                }
                onScrollToIndexFailed={(info) => {
                  const wait = new Promise((resolve) => setTimeout(resolve, 500));
                  wait.then(() => {
                    flatListRef.current?.scrollToIndex({
                      index: info.index,
                      animated: true,
                      viewPosition: 0.5,
                    });
                  });
                }}
              />
            )}
            {listData.length > 20 && (
              <FloatingActionButtons
                flatListRef={flatListRef}
                onLocateCurrent={scrollToCurrent}
                showLocate={activeTab === "current"}
                locateDisabled={!currentTrack || trackList.findIndex((t) => t.id === currentTrack.id) === -1}
              />
            )}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalWrapper: {
    width: "100%",
    height: "60%",
    maxWidth: 450,
    alignSelf: "center",
  },
  modalContent: {
    height: "100%",
    width: "100%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  list: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
  },
  modalHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(150,150,150,0.1)",
    alignItems: "center",
  },
  tabRow: {
    flexDirection: "row",
    flex: 1,
  },
  tabLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 15,
    alignItems: "center",
  },
  tabText: {
    fontSize: 16,
    fontWeight: "600",
  },
  subTabContainer: {
    flexDirection: "row",
    padding: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(150,150,150,0.1)",
  },
  locateInlineBtn: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  subTabItem: {
    paddingHorizontal: 15,
    paddingVertical: 6,
    borderRadius: 15,
    marginRight: 10,
  },
  subTabText: {
    fontSize: 14,
    fontWeight: "500",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  modalItem: {
    padding: 15,
    borderBottomWidth: 0.5,
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  modalItemText: {
    fontSize: 16,
  },
  progressText: {
    fontSize: 11,
    marginLeft: 10,
  },
  activePlaylistItem: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
});
