import { Ionicons } from "@expo/vector-icons";
import {
    batchDeleteItems,
    Folder,
    getFolderContents,
    getFolderStats
} from "@soundx/services";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AddToPlaylistModal } from "../../src/components/AddToPlaylistModal";
import { FolderMoreModal } from "../../src/components/FolderMoreModal";
import { TrackMoreModal } from "../../src/components/TrackMoreModal";
import { usePlayer } from "../../src/context/PlayerContext";
import { useTheme } from "../../src/context/ThemeContext";
import { Track } from "../../src/models";
import { getImageSource } from "../../src/utils/image";

export default function FolderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const { playTrack, playTrackList } = usePlayer();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    children: Folder[];
    tracks: Track[];
    breadcrumbs: Folder[];
    name?: string;
  } | null>(null);

  // Selection state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState<(number | string)[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<(number | string)[]>([]);

  // Modal state
  const [activeFolder, setActiveFolder] = useState<Folder | null>(null);
  const [activeTrack, setActiveTrack] = useState<Track | null>(null);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);

  // Layout mode
  const [layoutMode, setLayoutMode] = useState<"list" | "grid">("list");
  
  // Adaptive Grid Calculation
  const GRID_ITEM_WIDTH = 100;
  const GRID_GAP = 12;
  const PADDING_H = 32; // 16 * 2
  
  const numColumns = Math.max(3, Math.floor((width - PADDING_H + GRID_GAP) / (GRID_ITEM_WIDTH + GRID_GAP)));
  const itemWidth = (width - PADDING_H - (numColumns - 1) * GRID_GAP) / numColumns;

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getFolderContents(Number(id));
      if (res.code === 200) {
        setData(res.data);
      }
    } catch (error) {
      console.error("Failed to fetch folder contents:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const handleFolderClick = (folder: Folder) => {
    if (isSelectionMode) {
      toggleFolderSelection(folder.id);
      return;
    }
    router.push(`/folder/${folder.id}` as any);
  };

  const handleTrackClick = (track: Track) => {
    if (isSelectionMode) {
      toggleTrackSelection(track.id);
      return;
    }
    if (data?.tracks) {
      playTrackList(data.tracks, data.tracks.findIndex(t => t.id === track.id) || 0);
    }
  };

  const toggleFolderSelection = (id: number | string) => {
    setSelectedFolders((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleTrackSelection = (id: number | string) => {
    setSelectedTracks((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (data) {
      const allFolderIds = data.children.map((f) => f.id);
      const allTrackIds = data.tracks.map((t) => t.id);

      const isAllSelected =
        selectedFolders.length === allFolderIds.length &&
        selectedTracks.length === allTrackIds.length;

      if (isAllSelected) {
        setSelectedFolders([]);
        setSelectedTracks([]);
      } else {
        setSelectedFolders(allFolderIds);
        setSelectedTracks(allTrackIds);
      }
    }
  };

  const handleBatchDelete = () => {
    Alert.alert(
      t("folderPage.batchDeleteTitle"),
      t("folderPage.batchDeleteMessage", {
        folderCount: selectedFolders.length,
        trackCount: selectedTracks.length,
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("folderPage.confirmDelete"),
          style: "destructive",
          onPress: async () => {
            try {
              const res = await batchDeleteItems({
                folderIds: selectedFolders,
                trackIds: selectedTracks,
              });
              if (res.code === 200) {
                setIsSelectionMode(false);
                setSelectedFolders([]);
                setSelectedTracks([]);
                fetchData();
              }
            } catch (error) {
              console.error("Batch delete failed", error);
              Alert.alert(t("common.error"), t("folderPage.deleteFailed"));
            }
          },
        },
      ]
    );
  };

  const handleShowFolderProperties = async (folder: Folder) => {
    try {
      const res = await getFolderStats(folder.id);
      if (res.code === 200) {
        Alert.alert(
          t("folderPage.folderProperties"),
          t("folderPage.folderPropertiesMessage", {
            name: folder.name,
            path: res.data.path,
            trackCount: res.data.trackCount,
            folderCount: res.data.folderCount,
          })
        );
      }
    } catch (error) {
      Alert.alert(t("common.error"), t("folderPage.loadPropertiesFailed"));
    }
  };

  const handleShowTrackProperties = (track: Track) => {
    Alert.alert(
      t("folderPage.trackProperties"),
      t("folderPage.trackPropertiesMessage", {
        title: track.name,
        artist: track.artist || t("common.unknownArtist"),
        album: track.album || t("common.unknownAlbum"),
        path: track.path,
      })
    );
  };

  const getAllTracks = async (folderId: number | string): Promise<any[]> => {
    try {
      const res = await getFolderContents(folderId);
      if (res.code !== 200 || !res.data) return [];
      
      let allTracks = res.data.tracks || [];
      
      if (res.data.children && res.data.children.length > 0) {
        // Fetch children in parallel
        const childrenTracks = await Promise.all(
          res.data.children.map((child: Folder) => getAllTracks(child.id))
        );
        childrenTracks.forEach(tracks => {
          allTracks = [...allTracks, ...tracks];
        });
      }
      return allTracks;
    } catch (e) {
      console.error(e);
      return [];
    }
  };

  const handlePlayCurrent = async () => {
    if (!data) return;
    try {
      const tracks = await getAllTracks(Number(id)); // Use id from params
      if (tracks.length > 0) {
        playTrackList(tracks, 0);
      } else {
        Alert.alert(t("folderPage.notice"), t("folderPage.noPlayableTracks"));
      }
    } catch (error) {
      Alert.alert(t("folderPage.notice"), t("folderPage.playFailed"));
    }
  };

  const handlePlayAll = async (folder: Folder) => {
    try {
      const tracks = await getAllTracks(folder.id);
      if (tracks.length > 0) {
        playTrackList(tracks, 0);
      } else {
        Alert.alert(t("folderPage.notice"), t("folderPage.noPlayableTracks"));
      }
    } catch (error) {
      Alert.alert(t("folderPage.notice"), t("folderPage.playFailed"));
    }
  };

  const renderItem = ({ item }: { item: Folder | Track }) => {
    const isFolder = "tracks" in item || "children" in item || !("artist" in item);
    const id = item.id;
    const isSelected = isFolder
      ? selectedFolders.includes(id)
      : selectedTracks.includes(id);

    if (layoutMode === "grid") {
      return (
        <TouchableOpacity
          style={[
            styles.gridItem,
            { width: itemWidth },
            { backgroundColor: colors.card },
            isSelected && { backgroundColor: colors.primary + "20", borderColor: colors.primary, borderWidth: 1 }
          ]}
          onPress={() => (isFolder ? handleFolderClick(item as Folder) : handleTrackClick(item as Track))}
          onLongPress={() => {
            if (isSelectionMode) return;
            if (isFolder) setActiveFolder(item as Folder);
            else setActiveTrack(item as Track);
          }}
        >
          {isSelectionMode && (
            <View style={styles.gridCheckbox}>
              <Ionicons
                name={isSelected ? "checkbox" : "square-outline"}
                size={20}
                color={isSelected ? colors.primary : colors.secondary}
              />
            </View>
          )}
          <View style={styles.gridIconContainer}>
            {isFolder ? (
              <View style={[styles.gridFolderIcon, { backgroundColor: colors.primary + "10" }]}>
                <Ionicons name="folder" size={48} color="#faad14" />
              </View>
            ) : (
              <Image
                source={getImageSource((item as Track).cover, `https://picsum.photos/seed/${item.id}/300/300`)}
                style={styles.gridTrackCover}
              />
            )}
          </View>
          <Text style={[styles.gridItemName, { color: colors.text }]} numberOfLines={2}>
            {item.name}
          </Text>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        style={[
          styles.item,
          { backgroundColor: colors.card },
          isSelected && { backgroundColor: colors.primary + "20", borderColor: colors.primary, borderWidth: 1 }
        ]}
        onPress={() => (isFolder ? handleFolderClick(item as Folder) : handleTrackClick(item as Track))}
        onLongPress={() => {
            if (isSelectionMode) return;
            if (isFolder) setActiveFolder(item as Folder);
            else setActiveTrack(item as Track);
        }}
      >
        {isSelectionMode && (
          <View style={styles.checkbox}>
            <Ionicons
              name={isSelected ? "checkbox" : "square-outline"}
              size={24}
              color={isSelected ? colors.primary : colors.secondary}
            />
          </View>
        )}
        <View style={styles.iconContainer}>
          {isFolder ? (
            <View style={[styles.folderIcon, { backgroundColor: colors.primary + "10" }]}>
              <Ionicons name="folder" size={28} color="#faad14" />
            </View>
          ) : (
            <Image
              source={getImageSource((item as Track).cover, `https://picsum.photos/seed/${item.id}/200/200`)}
              style={styles.trackCover}
            />
          )}
        </View>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          {!isFolder && (
            <Text style={[styles.itemSub, { color: colors.secondary }]} numberOfLines={1}>
              {(item as Track).artist || t("folderPage.unknownArtist")}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const breadcrumbs = [
    { id: 0, name: t("folderPage.root") },
    ...(data?.breadcrumbs || []),
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {data?.name || t("folderPage.titleFallback")}
        </Text>
        <View style={styles.headerRight}>
          {!isSelectionMode && (
            <TouchableOpacity
              onPress={handlePlayCurrent}
              style={styles.headerButton}
            >
              <Ionicons name="play-circle-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          )}
          {!isSelectionMode && (
            <TouchableOpacity 
              onPress={() => setLayoutMode(layoutMode === "list" ? "grid" : "list")} 
              style={styles.headerButton}
            >
              <Ionicons 
                name={layoutMode === "list" ? "grid-outline" : "list-outline"} 
                size={22} 
                color={colors.text} 
              />
            </TouchableOpacity>
          )}
          {isSelectionMode ? (
            <TouchableOpacity onPress={() => setIsSelectionMode(false)} style={styles.headerButton}>
              <Text style={{ color: colors.primary, fontWeight: "600" }}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => setIsSelectionMode(true)} style={styles.headerButton}>
              <Ionicons name="checkmark-circle-outline" size={24} color={colors.text} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.breadcrumbContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.breadcrumbScroll}>
          {breadcrumbs.map((b, index) => (
            <React.Fragment key={b.id || index}>
              <TouchableOpacity
                onPress={() => (b.id === 0 ? router.push("/folder" as any) : router.push(`/folder/${b.id}` as any))}
              >
                <Text
                  style={[
                    styles.breadcrumbText,
                    { color: index === breadcrumbs.length - 1 ? colors.primary : colors.secondary },
                  ]}
                >
                  {b.name}
                </Text>
              </TouchableOpacity>
              {index < breadcrumbs.length - 1 && (
                <Ionicons name="chevron-forward" size={12} color={colors.secondary} style={styles.separator} />
              )}
            </React.Fragment>
          ))}
        </ScrollView>
      </View>

      {isSelectionMode && (
        <View style={[styles.selectionBar, { backgroundColor: colors.card }]}>
          <TouchableOpacity onPress={handleSelectAll} style={styles.barButton}>
            <Text style={{ color: colors.text }}>{t("folderPage.selectAll")}</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.text, fontWeight: "600" }}>
            {t("folderPage.selectedCount", {
              count: selectedFolders.length + selectedTracks.length,
            })}
          </Text>
          <TouchableOpacity onPress={handleBatchDelete} style={styles.barButton} disabled={selectedFolders.length + selectedTracks.length === 0}>
            <Text style={{ color: "#ff4d4f", fontWeight: "600" }}>{t("common.delete")}</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          key={layoutMode + numColumns}
          numColumns={layoutMode === "grid" ? numColumns : 1}
          data={[...(data?.children || []), ...(data?.tracks || [])]}
          renderItem={renderItem}
          keyExtractor={(item, index) => `${"tracks" in item ? "folder" : "track"}-${item.id}`}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={layoutMode === "grid" ? styles.gridRow : undefined}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: colors.secondary }}>{t("folderPage.empty")}</Text>
            </View>
          }
        />
      )}

      <FolderMoreModal
        visible={!!activeFolder}
        folder={activeFolder}
        onClose={() => setActiveFolder(null)}
        onPlayAll={handlePlayAll}
        onShowProperties={handleShowFolderProperties}
        onDeleteSuccess={() => {
          fetchData();
        }}
      />

      <TrackMoreModal
        visible={!!activeTrack}
        track={activeTrack}
        onClose={() => setActiveTrack(null)}
        onAddToPlaylist={() => {
            setAddToPlaylistVisible(true);
        }}
        onShowProperties={handleShowTrackProperties}
        onDeleteSuccess={() => {
          fetchData();
        }}
      />

      <AddToPlaylistModal
        visible={addToPlaylistVisible}
        trackId={activeTrack?.id ?? null}
        onClose={() => {
          setAddToPlaylistVisible(false);
          setActiveTrack(null);
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    height: 56,
  },
  headerButton: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  breadcrumbContainer: {
    height: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(150,150,150,0.1)",
  },
  breadcrumbScroll: {
    paddingHorizontal: 16,
    alignItems: "center",
  },
  breadcrumbText: {
    fontSize: 14,
  },
  separator: {
    marginHorizontal: 4,
  },
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    height: 48,
  },
  barButton: {
    padding: 8,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 100,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  checkbox: {
    marginRight: 12,
  },
  iconContainer: {
    marginRight: 12,
  },
  folderIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  trackCover: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  itemInfo: {
    flex: 1,
    marginRight: 8,
  },
  itemName: {
    fontSize: 16,
    fontWeight: "500",
  },
  itemSub: {
    fontSize: 12,
    marginTop: 2,
  },
  moreButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  gridRow: {
    justifyContent: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  gridItem: {
    // width is now set dynamically via style prop
    aspectRatio: 0.8,
    padding: 8,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  gridCheckbox: {
    position: "absolute",
    top: 4,
    left: 4,
    zIndex: 1,
  },
  gridIconContainer: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 8,
    marginBottom: 8,
    overflow: "hidden",
  },
  gridFolderIcon: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  gridTrackCover: {
    width: "100%",
    height: "100%",
    borderRadius: 8,
  },
  gridItemName: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 16,
  },
  gridMoreButton: {
    position: "absolute",
    top: 4,
    right: -4,
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
});
