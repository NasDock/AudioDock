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
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getBaseURL } from "../https";

type TabType = "current" | "history" | "favorites";
type SubTabType = "track" | "album";

export const PlaylistModal = () => {
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
  const [listData, setListData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const flatListRef = React.useRef<FlatList>(null);

  useEffect(() => {
    if (sourceType === "Emby" && activeTab === "history") {
      setActiveTab("current");
    }
  }, [sourceType, activeTab]);

  useEffect(() => {
    if (showPlaylist && user) {
      if (activeTab === "current") {
        setListData(trackList);
        // Scroll to current track
        if (currentTrack) {
           const index = trackList.findIndex((t) => t.id === currentTrack.id);
           if (index !== -1) {
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
      const isAudiobook = mode === "AUDIOBOOK";
      const currentSubTab = isAudiobook ? "album" : activeSubTab;

      if (activeTab === "history") {
        if (currentSubTab === "track") {
          res = await getTrackHistory(user.id, 0, 50, "MUSIC");
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
          res = await getFavoriteTracks(user.id, 0, 50, "MUSIC");
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
    const isAlbum = !isCurrent && (activeSubTab === "album" || mode === "AUDIOBOOK");
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
                uri: item.cover
                  ? typeof item.cover === "string" &&
                    item.cover.startsWith("http")
                    ? item.cover
                    : `${getBaseURL()}${item.cover}`
                  : "https://picsum.photos/100",
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
    <Modal
      visible={showPlaylist}
      transparent
      animationType="slide"
      onRequestClose={() => setShowPlaylist(false)}
    >
      <Pressable style={styles.backdrop} onPress={() => setShowPlaylist(false)}>
        <Pressable
          style={styles.modalWrapper}
          onPress={(e) => e.stopPropagation()}
        >
          <View
            style={[
              styles.modalContent,
              { backgroundColor: colors.card, paddingBottom: insets.bottom },
            ]}
          >
            <View style={styles.modalHeader}>
              {[
                { id: "current", label: `当前 (${trackList.length})` },
                { id: "history", label: "听过" },
                { id: "favorites", label: "收藏" },
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
                </TouchableOpacity>
              ))}
            </View>

            {mode === "MUSIC" && activeTab !== "current" && (
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
                data={listData}
                keyExtractor={(item, index) => `${item.id}-${index}`}
                renderItem={renderItem}
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
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  modalWrapper: {
    width: "100%",
    height: "60%",
    maxWidth: 450,
  },
  modalContent: {
    height: "100%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(150,150,150,0.1)",
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
