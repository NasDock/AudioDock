import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { usePlayer } from "../context/PlayerContext";
import { useTheme } from "../context/ThemeContext";
import { TrackType } from "../models";
import { getImageUrl } from "../utils/image";

export const MINI_PLAYER_HEIGHT = 60;

export const MiniPlayer = () => {
  const { colors } = useTheme();
  const router = useRouter();
  const {
    currentTrack,
    isPlaying,
    pause,
    resume,
    playNext,
    playPrevious,
    setShowPlaylist,
    isRadioMode,
    currentAudioQuality,
    availableAudioQualities,
  } =
    usePlayer();

  if (!currentTrack) return null;

  const togglePlayback = () => {
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => router.push("/player")}
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.background,
        },
      ]}
    >
      <View style={styles.infoContaer}>
        <Image
          source={{
            // 迷你播放条封面，走 96 档（恒压缩）——见 utils/image.ts 分级规则
            uri: getImageUrl(currentTrack.cover, "https://picsum.photos/100", 96),
          }}
          style={styles.artwork}
        />
        <View style={styles.info}>
          <Text
            style={[styles.title, { color: colors.text }]}
            numberOfLines={1}
          >
            {currentTrack.name}
          </Text>
          <View style={styles.artistRow}>
            <Text
              style={[styles.artist, { color: colors.secondary }]}
              numberOfLines={1}
            >
              {currentTrack.artist}
            </Text>
            {currentTrack.type !== TrackType.AUDIOBOOK && (
              <View
                style={[
                  styles.qualityBadge,
                  { borderColor: colors.border, backgroundColor: colors.card },
                ]}
              >
                <Text
                  style={[styles.qualityBadgeText, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {availableAudioQualities.find((item) => item.quality === currentAudioQuality)?.label || "无损"}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity onPress={playPrevious}>
          <Ionicons name="play-skip-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={togglePlayback}>
          <Ionicons
            name={isPlaying ? "pause" : "play"}
            size={20}
            color={colors.primary}
          />
        </TouchableOpacity>
        <TouchableOpacity onPress={playNext}>
          <Ionicons name="play-skip-forward" size={20} color={colors.text} />
        </TouchableOpacity>
        {!isRadioMode && (
          <TouchableOpacity onPress={() => setShowPlaylist(true)}>
            <Ionicons name="list" size={24} color={colors.secondary} />
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 10,
    width: "100%",
    height: MINI_PLAYER_HEIGHT,
  },
  infoContaer: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  artwork: {
    width: 40,
    height: 40,
    borderRadius: 4,
  },
  info: {
    flex: 1,
    marginLeft: 10,
    justifyContent: "center",
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 5,
  },
  artist: {
    fontSize: 12,
    flexShrink: 1,
  },
  artistRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  qualityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
  },
  qualityBadgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 16,
  },
});
