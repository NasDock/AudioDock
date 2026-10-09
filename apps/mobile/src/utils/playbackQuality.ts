import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AudioQuality } from "../services/trackQuality";
import { isInternalNetworkSync } from "./networkMode";

const isCurrentInternalAddress = async () => {
  const activeAddress = (await AsyncStorage.getItem("serverAddress")) || "";
  const sourceType = (await AsyncStorage.getItem("selectedSourceType")) || "AudioDock";
  if (!activeAddress) return false;

  try {
    const configStr = await AsyncStorage.getItem(`sourceConfig_${sourceType}`);
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    const configList = Array.isArray(parsed) ? parsed : [parsed];
    return configList.some((config) => config?.internal === activeAddress);
  } catch {
    return false;
  }
};

export const getCurrentPlaybackQualityPreference = async (qualities: {
  internalPlaybackQuality: AudioQuality;
  externalPlaybackQuality: AudioQuality;
}) =>
  (await isCurrentInternalAddress())
    ? qualities.internalPlaybackQuality
    : qualities.externalPlaybackQuality;

/**
 * 同步版本：起播路径（playTrack/playTrackList）不能 await AsyncStorage，
 * 复用 networkMode 里由 AuthContext 维护的内外网判定（服务器切换时刷新）。
 */
export const getPlaybackQualityPreferenceSync = (qualities: {
  internalPlaybackQuality: AudioQuality;
  externalPlaybackQuality: AudioQuality;
}): AudioQuality =>
  isInternalNetworkSync()
    ? qualities.internalPlaybackQuality
    : qualities.externalPlaybackQuality;
