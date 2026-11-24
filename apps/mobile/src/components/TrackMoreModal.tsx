import { Ionicons } from "@expo/vector-icons";
import { deleteTrack, TrackingEvent as TE, TrackingFeature as TF } from "@soundx/services";
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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { insertTracksNext } = usePlayer();
  const { user, device } = useAuth();

  if (!track) return null;

  const handleDelete = () => {
    Alert.alert(
      t('trackMore.deleteTrack'),
      t('trackMore.confirmDelete'),
      [
        { text: t('common.cancel'), style: "cancel" },
        {
          text: t('trackMore.confirmDeleteTrack'),
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
              Alert.alert(t('common.error'), t('trackMore.deleteFailed'));
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
      Alert.alert(t('trackMore.alreadyInPlaylist'));
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
              {t('playerMore.addToPlaylist')}
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
              {t('trackMore.addToCurrentQueue')}
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
            <Text style={[styles.menuText, { color: colors.text }]}>{t('trackMore.properties')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={async () => {
              onClose();
              trackEvent({
                feature: TF.DOWNLOAD,
                eventName: TE.DOWNLOAD_START,
                metadata: { id: track.id, count: 1 },
              });
              const success = await downloadTrack(track);
              trackEvent({
                feature: TF.DOWNLOAD,
                eventName: success ? TE.DOWNLOAD_SUCCESS : TE.DOWNLOAD_FAILED,
                metadata: { id: track.id, count: 1 },
              });
              if (success) {
                Alert.alert(t('trackMore.downloadSuccess'), t('trackMore.downloadSuccess'));
              } else {
                Alert.alert(t('trackMore.downloadFailed'), t('trackMore.downloadFailed'));
              }
            }}
          >
            <Ionicons
              name="cloud-download-outline"
              size={24}
              color={colors.text}
            />
            <Text style={[styles.menuText, { color: colors.text }]}>{t('trackMore.download')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={24} color="#ff4d4f" />
            <Text style={[styles.menuText, styles.dangerText]}>{t('trackMore.deleteTrack')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.menuItem,
              { marginTop: 10, justifyContent: "center" },
            ]}
            onPress={onClose}
          >
            <Text style={[styles.menuText, { color: colors.secondary }]}>
              {t('common.cancel')}
            </Text>
          </TouchableOpacity>
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
