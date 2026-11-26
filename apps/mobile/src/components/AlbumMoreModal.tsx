import { Ionicons } from "@expo/vector-icons";
import { addTracksToPlaylist, createPlaylist, TrackingEvent as TE, TrackingFeature as TF } from "@soundx/services";
import React, { useState } from "react";
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
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { isAudiobookshelfSource } from "../constants/sources";
import { Album, Track, TrackType } from "../models";
import { downloadTracks } from "../services/downloadManager";
import { trackEvent } from "../services/tracking";

interface AlbumMoreModalProps {
  visible: boolean;
  album: Album | null;
  trackIds: (number | string)[];
  tracks: Track[];
  onClose: () => void;
  onAddToPlaylist: () => void;
  onSelectTracks?: () => void;
  onUpdateCover: () => void;
  onManageCollections?: () => void;
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
  onManageCollections,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { user, sourceType } = useAuth();
  const insets = useSafeAreaInsets();
  const [pendingCallback, setPendingCallback] = useState<(() => void) | null>(null);

  if (!album) return null;

  const handleOptionPress = (callback: () => void) => {
    if (pendingCallback) return;
    setPendingCallback(() => callback);
    onClose();
    setTimeout(() => {
      callback();
      setPendingCallback(null);
    }, 100);
  };

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
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
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
            <Text style={[styles.title, { color: colors.text }]}>{t('albumMore.title')}</Text>
            <Text style={[styles.albumName, { color: colors.secondary }]}>{album.name}</Text>

            <TouchableOpacity
              style={styles.option}
              onPress={() => handleOptionPress(onUpdateCover)}
            >
              <Ionicons name="image-outline" size={24} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>{t('albumMore.editCover')}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.option} onPress={() => handleOptionPress(onAddToPlaylist)}>
              <Ionicons name="add-circle-outline" size={24} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>{t('albumMore.addToPlaylist')}</Text>
            </TouchableOpacity>

            {(album.type === TrackType.AUDIOBOOK) &&
              // Audiobookshelf 的系列是服务端元数据生成的，只读，不支持新建/添加
              !isAudiobookshelfSource(sourceType) && (
              <TouchableOpacity
                style={styles.option}
                onPress={() => handleOptionPress(() => onManageCollections?.())}
              >
                <Ionicons name="albums-outline" size={24} color={colors.text} />
                <Text style={[styles.optionText, { color: colors.text }]}>{t('albumMore.addToCollection')}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.option} onPress={() => handleOptionPress(handleCreatePlaylistWithAlbum)}>
              <Ionicons name="duplicate-outline" size={24} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>{t('albumMore.createPlaylistWithSameName')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.option}
              onPress={() => handleOptionPress(() => onSelectTracks?.())}
            >
              <Ionicons name="list-outline" size={24} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>{t('albumMore.selectTracks')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.option}
              onPress={() => {
                if (tracks.length === 0) return;
                Alert.alert(t('albumMore.batchDownload'), t('albumMore.confirmBatchDownload', { albumName: album.name }), [
                  { text: t('common.cancel'), style: "cancel" },
                  { text: t('common.confirm'), onPress: () => {
                    trackEvent({
                      feature: TF.DOWNLOAD,
                      eventName: TE.DOWNLOAD_START,
                      metadata: { id: album.id, count: tracks.length },
                    });
                    downloadTracks(tracks, (completed: number, total: number) => {
                      if (completed === total) {
                        trackEvent({
                          feature: TF.DOWNLOAD,
                          eventName: TE.DOWNLOAD_SUCCESS,
                          metadata: { id: album.id, count: total },
                        });
                        Alert.alert(t('albumMore.batchDownloadComplete'), t('albumMore.batchDownloadComplete', { albumName: album.name }));
                      }
                    });
                  }}
                ]);
              }}
            >
              <Ionicons name="cloud-download-outline" size={24} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>{t('albumMore.batchDownload')}</Text>
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
