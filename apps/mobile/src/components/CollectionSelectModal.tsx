import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { addAlbumToCollection, createCollection, getCollectionMembership, getCollections } from "@soundx/services";
import { Album, AudiobookCollection } from "../models";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { getImageUrl } from "../utils/image";
import { CachedImage } from "./CachedImage";

interface CollectionSelectModalProps {
  visible: boolean;
  album: Album | null;
  onClose: () => void;
}

export const CollectionSelectModal: React.FC<CollectionSelectModalProps> = ({
  visible,
  album,
  onClose,
}) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [collections, setCollections] = useState<AudiobookCollection[]>([]);
  const [membership, setMembership] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const albumId = album?.id ? Number(album.id) : null;

  const reload = async () => {
    if (!user || !albumId) return;
    setLoading(true);
    try {
      const [listRes, membershipRes] = await Promise.all([
        getCollections(user.id),
        getCollectionMembership(albumId, user.id),
      ]);
      if (listRes.code === 200) {
        setCollections(listRes.data || []);
      }
      if (membershipRes.code === 200) {
        setMembership(membershipRes.data || []);
      }
    } catch (error) {
      console.error("Failed to load collections", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      reload();
    }
  }, [visible, user, albumId]);

  const membershipSet = useMemo(() => new Set(membership), [membership]);

  const addToCollection = async (collectionId: number) => {
    if (!albumId) return;
    try {
      if (membershipSet.has(collectionId)) return;
      await addAlbumToCollection(collectionId, albumId);
      setMembership((prev) => [...prev, collectionId]);
    } catch (error) {
      console.error("Failed to update collection membership", error);
    }
  };

  const handleCreate = async () => {
    if (!user || !albumId) return;
    try {
      const name = nameInput.trim();
      if (!name) {
        Alert.alert("提示", "请输入合集名称");
        return;
      }
      const res = await createCollection(user.id, {
        name,
        albumId,
      });
      if (res.code === 200) {
        setNameInput("");
        setCreateVisible(false);
      }
    } catch (error) {
      console.error("Failed to create collection", error);
    }
  };

  if (!album) return null;

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={{ width: "100%", maxWidth: 450, alignSelf: "center" }}
            onPress={(e) => e.stopPropagation()}
          >
            <View
              style={[
                styles.modalContent,
                { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 },
              ]}
            >
              <View style={styles.handle} />
              <View style={styles.headerRow}>
                <Text style={[styles.title, { color: colors.text }]}>选择合集</Text>
                <TouchableOpacity
                  onPress={() => {
                    setCreateVisible(true);
                    setNameInput("");
                    onClose();
                  }}
                >
                  <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.subtitle, { color: colors.secondary }]}>
                {album.name}
              </Text>

              {loading ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 12 }} />
              ) : (
                <FlatList
                  data={collections}
                  keyExtractor={(item) => String(item.id)}
                  renderItem={({ item }) => {
                    const previewCover =
                      item.cover || item.items?.[0]?.album?.cover || null;
                    const count = item._count?.items ?? item.items?.length ?? 0;
                    const selected = membershipSet.has(Number(item.id));
                    return (
                      <TouchableOpacity
                        style={styles.option}
                        onPress={() => addToCollection(Number(item.id))}
                        disabled={selected}
                      >
                        <CachedImage
                          source={{
                            uri: getImageUrl(
                              previewCover,
                              `https://picsum.photos/seed/collection-${item.id}/200/200`,
                            ),
                          }}
                          style={styles.cover}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.optionText, { color: colors.text }]} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={[styles.countText, { color: colors.secondary }]}>
                            {count} 张专辑
                          </Text>
                        </View>
                        <Ionicons
                          name={selected ? "checkmark-circle" : "ellipse-outline"}
                          size={20}
                          color={selected ? colors.primary : colors.border}
                        />
                      </TouchableOpacity>
                    );
                  }}
                  ItemSeparatorComponent={() => (
                    <View style={{ height: 1, backgroundColor: colors.border, opacity: 0.3 }} />
                  )}
                  contentContainerStyle={{ paddingBottom: 8 }}
                  ListEmptyComponent={
                    <Text style={[styles.emptyText, { color: colors.secondary }]}>
                      暂无合集，点击右上角创建
                    </Text>
                  }
                />
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={createVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateVisible(false)}
      >
        <Pressable style={styles.backdropCenter} onPress={() => setCreateVisible(false)}>
          <Pressable
            style={[styles.createBox, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.title, { color: colors.text }]}>新建合集</Text>
            <TextInput
              placeholder="合集名称（必填）"
              placeholderTextColor={colors.secondary}
              value={nameInput}
              onChangeText={setNameInput}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            />
            <View style={styles.createActions}>
              <TouchableOpacity onPress={() => setCreateVisible(false)}>
                <Text style={[styles.actionText, { color: colors.secondary }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreate}>
                <Text style={[styles.actionText, { color: colors.primary }]}>创建并加入</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  backdropCenter: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 20,
    maxHeight: "80%",
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(150,150,150,0.3)",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 12,
    fontSize: 12,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  optionText: {
    fontSize: 16,
    marginBottom: 4,
  },
  countText: {
    fontSize: 12,
  },
  emptyText: {
    textAlign: "center",
    paddingVertical: 30,
  },
  createBox: {
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
  createActions: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 16,
  },
  actionText: {
    fontSize: 16,
  },
});
