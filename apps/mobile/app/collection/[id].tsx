import { CachedImage } from "@/src/components/CachedImage";
import SkeletonBlock from "@/src/components/SkeletonBlock";
import { useTheme } from "@/src/context/ThemeContext";
import { Album, AudiobookCollection } from "@/src/models";
import { getCollectionById, removeAlbumFromCollection, reorderCollection, updateCollection, uploadCollectionCover } from "@soundx/services";
import { mockAlbum } from "@soundx/services/src/mockUtils";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getImageUrl } from "@/src/utils/image";

const COLLECTION_ITEM_COVER_SIZE = 56;

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [collection, setCollection] = useState<AudiobookCollection | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [moreVisible, setMoreVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [coverVisible, setCoverVisible] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [reorderMode, setReorderMode] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  useEffect(() => {
    if (id) {
      loadData(String(id));
    }
  }, [id]);


  const loadData = async (collectionId: string) => {
    try {
      setLoading(true);
      const res = await getCollectionById(collectionId);
      if (res.code === 200 && res.data) {
        setCollection(res.data);
        const items = res.data.items || [];
        setAlbums(items.map((item) => item.album).filter(Boolean).map((album) => mockAlbum(album)));
      }
    } catch (error) {
      console.error("Failed to load collection", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async () => {
    if (!collection) return;
    const nextName = nameInput.trim();
    if (!nextName) {
      setRenameVisible(false);
      return;
    }
    const res = await updateCollection(collection.id, { name: nextName });
    if (res.code === 200) {
      setCollection(res.data);
      setRenameVisible(false);
    }
  };

  const handleSelectCover = async (album: Album) => {
    if (!collection) return;
    const res = await updateCollection(collection.id, { cover: album.cover });
    if (res.code === 200) {
      setCollection(res.data);
      setCoverVisible(false);
    }
  };

  const handleUploadCover = async () => {
    if (!collection || uploadingCover) return;
    try {
      setUploadingCover(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      const fileName = asset.fileName || `collection-${collection.id}-${Date.now()}.jpg`;
      const file = {
        uri: asset.uri,
        name: fileName,
        type: asset.mimeType || "image/jpeg",
      } as any;
      const res = await uploadCollectionCover(collection.id, file);
      if (res.code === 200) {
        setCollection(res.data);
        setCoverVisible(false);
      }
    } catch (error) {
      console.error("Upload cover failed", error);
    } finally {
      setUploadingCover(false);
    }
  };

  const handleReorder = async (nextAlbums: Album[]) => {
    setAlbums(nextAlbums);
    if (!collection) return;
    await reorderCollection(collection.id, nextAlbums.map((a) => a.id));
  };

  const moveAlbum = async (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= albums.length || fromIndex === toIndex) return;
    const nextAlbums = [...albums];
    const [moved] = nextAlbums.splice(fromIndex, 1);
    nextAlbums.splice(toIndex, 0, moved);
    await handleReorder(nextAlbums);
  };

  const handleRemoveAlbum = (album: Album) => {
    if (!collection) return;
    Alert.alert(
      "移出合集",
      `确定将《${album.name}》从当前合集移除吗？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await removeAlbumFromCollection(collection.id, album.id);
              if (res.code === 200) {
                setAlbums((prev) => prev.filter((item) => item.id !== album.id));
              } else {
                Alert.alert("提示", res.message || "移除失败");
              }
            } catch (error) {
              console.error("Remove album failed", error);
              Alert.alert("提示", "移除失败");
            }
          },
        },
      ]
    );
  };

  const cover = useMemo(
    () => collection?.cover || albums[0]?.cover || null,
    [collection, albums]
  );

  if (loading) {
    return <CollectionDetailSkeleton />;
  }

  if (!collection) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>合集不存在</Text>
      </View>
    );
  }

  const renderAlbumItem = ({ item, index }: { item: Album; index: number }) => (
    <TouchableOpacity
      disabled={reorderMode}
      style={[
        styles.albumItem,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
      onPress={() => {
        if (!reorderMode) {
          router.push(`/album/${item.id}`);
        }
      }}
    >
      <CachedImage
        source={{
          uri: getImageUrl(
            item.cover,
            `https://picsum.photos/seed/album-${item.id}/200/200`,
          ),
        }}
        style={styles.albumCover}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.albumTitle, { color: colors.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.albumSub, { color: colors.secondary }]} numberOfLines={1}>
          {item.artist}
        </Text>
      </View>
      {reorderMode && (
        <View style={styles.reorderActions}>
          <TouchableOpacity
            style={styles.reorderBtn}
            onPress={() => void moveAlbum(index, index - 1)}
            disabled={index === 0}
          >
            <Ionicons
              name="chevron-up"
              size={18}
              color={index === 0 ? colors.border : colors.secondary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.reorderBtn}
            onPress={() => void moveAlbum(index, index + 1)}
            disabled={index === albums.length - 1}
          >
            <Ionicons
              name="chevron-down"
              size={18}
              color={index === albums.length - 1 ? colors.border : colors.secondary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.reorderBtn}
            onPress={() => handleRemoveAlbum(item)}
          >
            <Ionicons
              name="trash-outline"
              size={18}
              color="#ff4d4f"
            />
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          {reorderMode ? (
            <TouchableOpacity onPress={() => setReorderMode(false)} style={styles.iconBtn}>
              <Ionicons name="checkmark" size={22} color={colors.text} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => setMoreVisible(true)} style={styles.iconBtn}>
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.coverSection}>
        <CachedImage
          source={{
            uri: getImageUrl(
              cover,
              `https://picsum.photos/seed/collection-${collection.id}/400/400`,
            ),
          }}
          style={styles.coverImage}
        />
        <Text style={[styles.title, { color: colors.text }]}>{collection.name}</Text>
        <Text style={[styles.subtitle, { color: colors.secondary }]}>
          {albums.length} 张专辑
        </Text>
      </View>

      <FlatList
        data={albums}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => renderAlbumItem({ item, index })}
        contentContainerStyle={styles.listContent}
      />

      <Modal visible={moreVisible} transparent animationType="slide" onRequestClose={() => setMoreVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMoreVisible(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => {
                setMoreVisible(false);
                setReorderMode((prev) => !prev);
              }}
            >
              <Ionicons name="swap-vertical" size={22} color={colors.text} />
              <Text style={[styles.sheetText, { color: colors.text }]}>
                {reorderMode ? "完成排序" : "调整排序"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => {
                setMoreVisible(false);
                setNameInput(collection.name);
                setRenameVisible(true);
              }}
            >
              <Ionicons name="create-outline" size={22} color={colors.text} />
              <Text style={[styles.sheetText, { color: colors.text }]}>修改名称</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => {
                setMoreVisible(false);
                setCoverVisible(true);
              }}
            >
              <Ionicons name="image-outline" size={22} color={colors.text} />
              <Text style={[styles.sheetText, { color: colors.text }]}>选定封面</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={renameVisible} transparent animationType="fade" onRequestClose={() => setRenameVisible(false)}>
        <Pressable style={styles.backdropCenter} onPress={() => setRenameVisible(false)}>
          <Pressable style={[styles.renameBox, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.title, { color: colors.text }]}>修改名称</Text>
            <TextInput
              value={nameInput}
              onChangeText={setNameInput}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              placeholder="合集名称"
              placeholderTextColor={colors.secondary}
            />
            <View style={styles.renameActions}>
              <TouchableOpacity onPress={() => setRenameVisible(false)}>
                <Text style={[styles.actionText, { color: colors.secondary }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleRename}>
                <Text style={[styles.actionText, { color: colors.primary }]}>保存</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={coverVisible} transparent animationType="slide" onRequestClose={() => setCoverVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCoverVisible(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={[styles.sheetTitle, { color: colors.text }]}>选择封面</Text>
            <FlatList
              data={albums}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.coverOption} onPress={() => handleSelectCover(item)}>
                  <CachedImage
                    source={{
                      uri: getImageUrl(
                        item.cover,
                        `https://picsum.photos/seed/album-${item.id}/200/200`,
                      ),
                    }}
                    style={styles.coverThumb}
                  />
                  <Text style={[styles.sheetText, { color: colors.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
              ListFooterComponent={
                <TouchableOpacity
                  style={[styles.uploadBtn, { backgroundColor: colors.primary }]}
                  onPress={handleUploadCover}
                  disabled={uploadingCover}
                >
                  <Text style={[styles.uploadBtnText, { color: colors.background }]}>
                    {uploadingCover ? "上传中..." : "上传图片设置封面"}
                  </Text>
                </TouchableOpacity>
              }
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function CollectionDetailSkeleton() {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <View style={styles.backButton}>
          <SkeletonBlock width={24} height={24} borderRadius={12} />
        </View>
        <View style={styles.headerActions}>
          <SkeletonBlock width={20} height={20} borderRadius={10} />
        </View>
      </View>

      <View style={styles.coverSection}>
        <SkeletonBlock width={140} height={140} borderRadius={20} style={{ marginBottom: 12 }} />
        <SkeletonBlock width={180} height={26} borderRadius={10} style={{ marginBottom: 8 }} />
        <SkeletonBlock width={90} height={16} borderRadius={8} />
      </View>

      <View style={styles.listContent}>
        {Array.from({ length: 8 }).map((_, index) => (
          <View
            key={index}
            style={[styles.albumItem, { borderBottomColor: colors.border }]}
          >
            <SkeletonBlock
              width={COLLECTION_ITEM_COVER_SIZE}
              height={COLLECTION_ITEM_COVER_SIZE}
              borderRadius={2}
            />
            <View style={styles.albumInfo}>
              <SkeletonBlock
                width={index % 3 === 0 ? "72%" : index % 3 === 1 ? "58%" : "66%"}
                height={16}
                borderRadius={8}
                style={{ marginBottom: 6 }}
              />
              <SkeletonBlock width="36%" height={12} borderRadius={6} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  backButton: {
    padding: 6,
  },
  headerActions: {
    flexDirection: "row",
    gap: 12,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  iconBtn: {
    padding: 6,
  },
  coverSection: {
    alignItems: "center",
    paddingVertical: 16,
  },
  coverImage: {
    width: 140,
    height: 140,
    borderRadius: 20,
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
  },
  subtitle: {
    marginTop: 4,
    fontSize: 12,
  },
  albumItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  albumCover: {
    width: COLLECTION_ITEM_COVER_SIZE,
    height: COLLECTION_ITEM_COVER_SIZE,
    borderRadius: 10,
    marginRight: 12,
  },
  albumInfo: {
    flex: 1,
    marginHorizontal: 10,
  },
  albumTitle: {
    fontSize: 16,
    marginBottom: 2,
  },
  albumSub: {
    fontSize: 12,
  },
  reorderActions: {
    justifyContent: "center",
    alignItems: "center",
    gap: 2,
    marginLeft: 8,
  },
  reorderBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  backdropCenter: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  sheet: {
    width: "100%",
    maxHeight: "70%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(150,150,150,0.3)",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 12,
  },
  sheetText: {
    fontSize: 16,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  renameBox: {
    width: "90%",
    maxWidth: 360,
    borderRadius: 16,
    padding: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
  },
  renameActions: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 16,
  },
  actionText: {
    fontSize: 16,
  },
  coverOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
  },
  coverThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  uploadBtn: {
    marginTop: 12,
    paddingVertical: 12,
    marginBottom: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
