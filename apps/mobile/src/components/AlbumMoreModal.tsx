import { Ionicons } from "@expo/vector-icons";
import { addTracksToPlaylist, createPlaylist } from "@soundx/services";
import React from "react";
import {
    Alert,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Album, Track, TrackType } from "../models";
import { downloadTracks } from "../services/downloadManager";

interface AlbumMoreModalProps {
  visible: boolean;
  album: Album | null;
  trackIds: (number | string)[];
  tracks: Track[];
  onClose: () => void;
  onAddToPlaylist: () => void;
  onSelectTracks?: () => void;
  onUpdateCover: () => void;
}

export const AlbumMoreModal: React.FC<AlbumMoreModalProps> = ({
  visible,
  album,
  trackIds,
  tracks,
  onClose,
  onAddToPlaylist,
  onSelectTracks,
  onUpdateCover,
}) => {
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  if (!album) return null;

  const handleCreatePlaylistWithAlbum = async () => {
    if (!user || !album) return;
    try {
      // 1. Create playlist
      const res = await createPlaylist(
        album.name,
        album.type || TrackType.MUSIC,
        user.id
      );

      if (res.code === 200) {
        // 2. Add tracks
        await addTracksToPlaylist(res.data.id, trackIds);
        onClose();
      }
    } catch (e) {
      console.error("Failed to create playlist with album", e);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable 
          style={{ width: "100%", maxWidth: 450, alignSelf: 'center' }} 
          onPress={(e) => e.stopPropagation()}
        >
          <View
            style={[
              styles.modalContent,
              { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 },
            ]}
          >
            <View style={styles.handle} />
            <Text style={[styles.title, { color: colors.text }]}>专辑选项</Text>
            <Text style={[styles.albumName, { color: colors.secondary }]}>{album.name}</Text>

            <TouchableOpacity
              style={styles.option}
              onPress={() => {
                onClose();
                onUpdateCover();
              }}
            >
              <Ionicons name="image-outline" size={24} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>修改封面</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.option} onPress={onAddToPlaylist}>
              <Ionicons name="add-circle-outline" size={24} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>添加到播放列表</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.option} onPress={handleCreatePlaylistWithAlbum}>
              <Ionicons name="duplicate-outline" size={24} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>新建与专辑同名播放列表</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.option} 
              onPress={() => {
                onClose();
                onSelectTracks?.();
              }}
            >
              <Ionicons name="list-outline" size={24} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>选择歌曲</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.option} 
              onPress={() => {
                onClose();
                if (tracks.length === 0) return;
                Alert.alert("批量下载", `确定要下载专辑《${album.name}》中的所有曲目吗？`, [
                  { text: "取消", style: "cancel" },
                  { text: "确定", onPress: () => {
                    downloadTracks(tracks, (completed: number, total: number) => {
                      if (completed === total) {
                        Alert.alert("下载完成", `专辑《${album.name}》下载完成`);
                      }
                    });
                  }}
                ]);
              }}
            >
              <Ionicons name="cloud-download-outline" size={24} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>批量下载</Text>
            </TouchableOpacity>
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
    alignItems: 'center',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(150,150,150,0.3)",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    paddingHorizontal: 20,
  },
  albumName: {
    fontSize: 14,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(150,150,150,0.1)",
  },
  optionText: {
    fontSize: 16,
    marginLeft: 16,
  },
});
