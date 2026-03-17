import { Ionicons } from "@expo/vector-icons";
import { deleteTrack } from "@soundx/services";
import React from "react";
import {
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayer } from "../context/PlayerContext";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { Track } from "../models";
import { downloadTrack } from "../services/downloadManager";
import { trackEvent } from "../services/tracking";

interface TrackMoreModalProps {
  visible: boolean;
  track: Track | null;
  onClose: () => void;
  onAddToPlaylist: (track: Track) => void;
  onShowProperties?: (track: Track) => void;
  onDeleteSuccess?: (trackId: number) => void;
}

export const TrackMoreModal: React.FC<TrackMoreModalProps> = ({
  visible,
  track,
  onClose,
  onAddToPlaylist,
  onShowProperties,
  onDeleteSuccess,
}) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { insertTracksNext } = usePlayer();
  const { user, device } = useAuth();

  if (!track) return null;

  const handleDelete = () => {
    Alert.alert(
      "删除歌曲",
      `确定要永久删除“${track.name}”吗？这将同时删除源文件。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "确定删除",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await deleteTrack(track.id);
              if (res.code === 200) {
                onDeleteSuccess?.(track.id as number);
                onClose();
              }
            } catch (e) {
              console.error("Failed to delete track", e);
              Alert.alert("错误", "删除失败，请稍后重试");
            }
          },
        },
      ],
    );
  };

  const handleAddToCurrentQueue = async () => {
    if (!track) return;

    let tracksToAdd: Track[] = [track];

    if (tracksToAdd.length > 0) {
      await insertTracksNext(tracksToAdd);
      trackEvent({
        feature: "player",
        eventName: "add_to_current_playlist",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
        metadata: {
          trackId: track?.id,
        },
      });
      onClose();
      Alert.alert("已添加到当前播放列表");
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View
          style={[
            styles.content,
            {
              backgroundColor: colors.card,
              paddingBottom: insets.bottom + 20,
              width: "100%",
              maxWidth: 450,
            },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.header}>
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

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              onAddToPlaylist(track);
              onClose();
            }}
          >
            <Ionicons name="add-circle-outline" size={24} color={colors.text} />
            <Text style={[styles.menuText, { color: colors.text }]}>
              添加到播放列表
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, { borderBottomColor: colors.border }]}
            onPress={handleAddToCurrentQueue}
          >
            <Ionicons
              name="play-forward-circle"
              size={24}
              color={colors.primary}
            />
            <Text
              style={[styles.menuText, { color: colors.text }]}
              numberOfLines={1}
            >
              当前播放列表
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              onShowProperties?.(track);
              onClose();
            }}
          >
            <Ionicons
              name="information-circle-outline"
              size={24}
              color={colors.text}
            />
            <Text style={[styles.menuText, { color: colors.text }]}>属性</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={async () => {
              onClose();
              const success = await downloadTrack(track);
              if (success) {
                Alert.alert("下载成功", `“${track.name}”已下载到本地`);
              } else {
                Alert.alert("下载失败", "请稍后重试");
              }
            }}
          >
            <Ionicons
              name="cloud-download-outline"
              size={24}
              color={colors.text}
            />
            <Text style={[styles.menuText, { color: colors.text }]}>下载</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={24} color="#ff4d4f" />
            <Text style={[styles.menuText, styles.dangerText]}>删除歌曲</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.menuItem,
              { marginTop: 10, justifyContent: "center" },
            ]}
            onPress={onClose}
          >
            <Text style={[styles.menuText, { color: colors.secondary }]}>
              取消
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  content: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  header: {
    marginBottom: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(150,150,150,0.1)",
    paddingBottom: 15,
  },
  trackName: {
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
  },
  trackArtist: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 4,
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
});
