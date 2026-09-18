import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  addAlbumToHistory,
  addToHistory,
  getAlbumHistory,
  getAlbumTracks,
  getLatestHistory,
  getLatestTracks,
  getPlaylistById,
  getPlaylists,
  getRecommendedAlbums,
  getTrackHistory,
  getRecommendedTracks,
  reportAudiobookProgress
} from "@soundx/services";
import * as Device from "expo-device";
import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Alert, NativeEventEmitter, NativeModules, Platform } from "react-native";
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  IOSCategory,
  IOSCategoryMode,
  IOSCategoryOptions,
  State,
  useProgress,
  useTrackPlayerEvents,
} from "react-native-track-player";
import { Track, TrackType } from "../models";
import {
  updateMediaControlBridgeMetadata,
  updateMediaControlBridgePlaybackState,
  updateMediaControlBridgeLyrics,
} from "../services/mediaControlBridge";
import { getActiveLyricLine } from "../utils/lyrics";
import { socketService } from "../services/socket";
import {
  resolveArtworkUriForPlayer,
  resolveTrackUri,
} from "../services/trackResolver";
import { usePlayMode } from "../utils/playMode";
import { useTranslation } from "react-i18next";
import { updateWidget, updateWidgetCollections } from "../native/WidgetBridge";
import { cacheCover, getCachedTrackPathSync } from "../services/cache";
import { resolveArtworkUri } from "../services/trackResolver";
import { getBaseURL } from "../https";
import { toggleTrackLike, toggleTrackUnLike } from "@soundx/services";
import {
  AudioQuality,
  AudioQualityOption,
  buildTrackPlaybackUrl,
  getTrackAudioQualityProfile,
  resolveTrackAudioQuality,
} from "../services/trackQuality";
import { useAuth } from "./AuthContext";
import { useNotification } from "./NotificationContext";
import { useSettings } from "./SettingsContext";
import { useSync } from "./SyncContext";
import { trackEvent } from "../services/tracking";
import { getCurrentPlaybackQualityPreference } from "../utils/playbackQuality";

export enum PlayMode {
  SEQUENCE = "SEQUENCE",
  LOOP_LIST = "LOOP_LIST",
  SHUFFLE = "SHUFFLE",
  LOOP_SINGLE = "LOOP_SINGLE",
}
const PLAYBACK_MODE_KEY = "playerPlaybackMode";
const RADIO_PLAYBACK_MODE_KEY = "playerRadioPlaybackMode";
const LEGACY_PLAY_MODE_KEY = "playMode";

interface PlayerContextType {
  isPlaying: boolean;
  currentTrack: Track | null;
  position: number;
  duration: number;
  isLoading: boolean;
  playTrack: (
    track: Track,
    initialPosition?: number,
    fromRadio?: boolean,
    forceReload?: boolean,
    preferredQuality?: AudioQuality,
  ) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  trackList: Track[];
  playTrackList: (tracks: Track[], index: number, initialPosition?: number) => Promise<void>;
  playMode: PlayMode;
  togglePlayMode: () => void;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  insertTracksNext: (tracks: Track[]) => Promise<void>;
  isSynced: boolean;
  sessionId: string | null;
  handleDisconnect: () => void;
  showPlaylist: boolean;
  setShowPlaylist: (show: boolean) => void;
  sleepTimer: number | null;
  setSleepTimer: (minutes: number) => void;
  clearSleepTimer: () => void;
  playbackRate: number;
  setPlaybackRate: (rate: number) => Promise<void>;
  currentAudioQuality: AudioQuality;
  availableAudioQualities: AudioQualityOption[];
  cycleAudioQuality: () => Promise<void>;

  // ✨ 新增：跳过片头/片尾全局配置
  skipIntroDuration: number;
  setSkipIntroDuration: (seconds: number) => void;
  skipOutroDuration: number;
  setSkipOutroDuration: (seconds: number) => void;

  reset: () => Promise<void>;

  // 📻 电台模式
  isRadioMode: boolean;
  startRadioMode: () => Promise<void>;

  /** 流转接收端专用：根据传入曲目的内容类型切换 MUSIC/AUDIOBOOK 模式（不恢复目标模式的历史状态） */
  switchContentModeForIncomingTrack: (track?: Track | null) => Promise<void>;
}

const PlayerContext = createContext<PlayerContextType>({
  isPlaying: false,
  currentTrack: null,
  position: 0,
  duration: 0,
  isLoading: false,
  playTrack: async () => {},
  pause: async () => {},
  resume: async () => {},
  seekTo: async () => {},
  trackList: [],
  playTrackList: async () => {},
  playMode: PlayMode.SEQUENCE,
  togglePlayMode: () => {},
  playNext: async () => {},
  playPrevious: async () => {},
  insertTracksNext: async () => {},
  isSynced: false,
  sessionId: null,
  handleDisconnect: () => {},
  showPlaylist: false,
  setShowPlaylist: () => {},
  sleepTimer: null,
  setSleepTimer: () => {},
  clearSleepTimer: () => {},
  playbackRate: 1,
  setPlaybackRate: async () => {},
  currentAudioQuality: "lossless",
  availableAudioQualities: [],
  cycleAudioQuality: async () => {},
  // ✨ 默认值
  skipIntroDuration: 0,
  setSkipIntroDuration: () => {},
  skipOutroDuration: 0,
  setSkipOutroDuration: () => {},
  isRadioMode: false,
  startRadioMode: async () => {},
  reset: async () => {},
  switchContentModeForIncomingTrack: async () => {},
});

export const usePlayer = () => useContext(PlayerContext);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, device, isLoading: isAuthLoading } = useAuth();
  const { t } = useTranslation();
  const { mode, setMode } = usePlayMode();
  const { showNotification } = useNotification();
  const {
    acceptRelay,
    cacheEnabled,
    recommendationLikeRatio,
    internalPlaybackQuality,
    externalPlaybackQuality,
  } = useSettings();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [trackList, setTrackList] = useState<Track[]>([]);
  const [playMode, setPlayMode] = useState<PlayMode>(PlayMode.SEQUENCE);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [isSetup, setIsSetup] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sleepTimer, setSleepTimerState] = useState<number | null>(null);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [currentAudioQuality, setCurrentAudioQuality] = useState<AudioQuality>("lossless");
  const [preferredAudioQuality, setPreferredAudioQuality] = useState<AudioQuality>("lossless");
  const [availableAudioQualities, setAvailableAudioQualities] = useState<AudioQualityOption[]>([]);
  const [isRadioMode, setIsRadioMode] = useState(false);

  // ✨ 新增 State
  const [skipIntroDuration, setSkipIntroDurationState] = useState(0);
  const [skipOutroDuration, setSkipOutroDurationState] = useState(0);
  const isSkippingOutroRef = useRef(false); // 防止重复触发切歌
  const lastAutoNextAtRef = useRef(0);
  const playbackRequestIdRef = useRef(0);
  const isPlaybackRequestPendingRef = useRef(false);
  const pendingPlaybackTrackIdRef = useRef<string | null>(null);

  const prevModeRef = useRef(mode);
  const isInitialLoadRef = useRef(true);
  const skipNextModeRestoreRef = useRef(false);

  // Hook for progress
  const { position, duration } = useProgress();

  // Refs for accessing latest state in callbacks
  const playModeRef = React.useRef(playMode);
  const normalPlayModeRef = React.useRef(playMode);
  const radioPlayModeRef = React.useRef<PlayMode>(PlayMode.SEQUENCE);
  const trackListRef = React.useRef(trackList);
  const currentTrackRef = React.useRef(currentTrack);
  const lastWidgetStateRef = React.useRef({
    trackId: null as number | string | null,
    isPlaying: false,
    coverPath: "",
    playMode: "",
    isLiked: false,
    position: 0,
    duration: 0,
  });
  const widgetModeLockRef = React.useRef<{
    until: number;
    playMode: PlayMode | null;
  }>({ until: 0, playMode: null });
  const positionRef = React.useRef(position);
  const playbackRateRef = React.useRef(playbackRate);
  const currentAudioQualityRef = React.useRef<AudioQuality>("lossless");
  const preferredAudioQualityRef = React.useRef<AudioQuality>("lossless");
  const isRadioModeRef = React.useRef(isRadioMode);
  const skipIntroDurationRef = React.useRef(skipIntroDuration);
  const skipOutroDurationRef = React.useRef(skipOutroDuration);
  const radioNextTrackRef = React.useRef<Track | null>(null);
  const knownTrackByIdRef = React.useRef<Map<string, Track>>(new Map());

  const setCurrentTrackState = useCallback((track: Track | null) => {
    if (track) {
      knownTrackByIdRef.current.set(String(track.id), track);
    }
    currentTrackRef.current = track;
    setCurrentTrack(track);
  }, []);

  // 预下载去重标记：记录已触发过预下载的 trackId，避免同一首歌重复下载。
  // setTrackListState 时清空（播放列表变化 → 重新计算预下载范围）。
  const preDownloadedIdsRef = useRef<Set<string>>(new Set());

  const setTrackListState = useCallback((tracks: Track[]) => {
    tracks.forEach((track) => {
      knownTrackByIdRef.current.set(String(track.id), track);
    });
    trackListRef.current = tracks;
    // 播放列表变化，清空预下载标记，下次切歌时重新计算前后 5 首
    preDownloadedIdsRef.current.clear();
    setTrackList(tracks);
  }, []);

  const getActiveTrackFromQueue = async (
    index: number,
    eventTrack?: unknown,
  ): Promise<Track | null> => {
    const queueTrack = eventTrack || await TrackPlayer.getTrack(index);
    const queueTrackId = (queueTrack as any)?.id;

    if (queueTrackId !== undefined && queueTrackId !== null) {
      const id = String(queueTrackId);
      return (
        trackListRef.current.find((track) => String(track.id) === id) ||
        knownTrackByIdRef.current.get(id) ||
        null
      );
    }

    return trackListRef.current[index] || null;
  };


  const normalizeStoredPlayMode = (storedPlayMode: string | null): PlayMode | null => {
    if (!storedPlayMode) return null;
    if (storedPlayMode === "SINGLE_ONCE") return PlayMode.SEQUENCE;
    if (Object.values(PlayMode).includes(storedPlayMode as PlayMode)) {
      return storedPlayMode as PlayMode;
    }
    return null;
  };

  const setActivePlayMode = (nextMode: PlayMode) => {
    playModeRef.current = nextMode;
    setPlayMode(nextMode);
  };

  const enterRadioPlaybackContext = () => {
    if (!isRadioModeRef.current) {
      normalPlayModeRef.current = playModeRef.current;
    }
    isRadioModeRef.current = true;
    setIsRadioMode(true);
    setActivePlayMode(radioPlayModeRef.current);
  };

  const exitRadioPlaybackContext = () => {
    if (!isRadioModeRef.current) return;
    radioPlayModeRef.current = playModeRef.current;
    isRadioModeRef.current = false;
    setIsRadioMode(false);
    setActivePlayMode(normalPlayModeRef.current);
  };

  useEffect(() => {
    skipIntroDurationRef.current = skipIntroDuration;
  }, [skipIntroDuration]);

  useEffect(() => {
    skipOutroDurationRef.current = skipOutroDuration;
  }, [skipOutroDuration]);

  useEffect(() => {
    isRadioModeRef.current = isRadioMode;
  }, [isRadioMode]);

  useEffect(() => {
    currentAudioQualityRef.current = currentAudioQuality;
  }, [currentAudioQuality]);

  useEffect(() => {
    preferredAudioQualityRef.current = preferredAudioQuality;
  }, [preferredAudioQuality]);

  useEffect(() => {
    let cancelled = false;
    const syncPreferredQuality = async () => {
      const nextQuality = await getCurrentPlaybackQualityPreference({
        internalPlaybackQuality,
        externalPlaybackQuality,
      });
      if (cancelled) return;
      setPreferredAudioQuality(nextQuality);
      preferredAudioQualityRef.current = nextQuality;
    };
    void syncPreferredQuality();
    return () => {
      cancelled = true;
    };
  }, [internalPlaybackQuality, externalPlaybackQuality]);

  useEffect(() => {
    playModeRef.current = playMode;
  }, [playMode]);

  useEffect(() => {
    trackListRef.current = trackList;
  }, [trackList]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    let cancelled = false;

    const syncCurrentTrackQuality = async () => {
      if (!currentTrack || currentTrack.type === TrackType.AUDIOBOOK) {
        if (!cancelled) {
          setAvailableAudioQualities([]);
          setCurrentAudioQuality("lossless");
        }
        return;
      }

      const profile = await getTrackAudioQualityProfile(currentTrack);
      if (cancelled) return;
      setAvailableAudioQualities(profile.options);
      setCurrentAudioQuality(
        resolveTrackAudioQuality(
          profile,
          await getCurrentPlaybackQualityPreference({
            internalPlaybackQuality,
            externalPlaybackQuality,
          }),
        ),
      );
    };

    syncCurrentTrackQuality();

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id, currentTrack?.type, internalPlaybackQuality, externalPlaybackQuality]);

  useEffect(() => {
    let cancelled = false;

    const syncWidget = async () => {
      if (!currentTrack) {
        try {
          const playbackState = await TrackPlayer.getPlaybackState();
          const activeTrack: any = await TrackPlayer.getActiveTrack();
          if (activeTrack) {
            const title = activeTrack.title || activeTrack.name || t('player.notPlaying');
            const artist = activeTrack.artist || "";
            const artwork = typeof activeTrack.artwork === "string" ? activeTrack.artwork : "";
            let coverPath: string | null = null;
            if (artwork) {
              const cached = await cacheCover(artwork);
              if (!cached.startsWith("http://") && !cached.startsWith("https://")) {
                coverPath = cached;
              }
            }
            const isPlayingNow = playbackState.state === State.Playing;
        await updateWidget({
          title,
          artist,
          coverPath,
          isPlaying: isPlayingNow,
          playMode: playMode,
          isLiked: false,
          position: Math.floor(positionRef.current),
          duration: Math.floor((activeTrack.duration as number | undefined) || 0),
        });
        lastWidgetStateRef.current = {
          trackId: activeTrack.id ?? null,
          isPlaying: isPlayingNow,
          coverPath: coverPath || "",
          playMode: playMode,
          isLiked: false,
          position: Math.floor(positionRef.current),
          duration: Math.floor((activeTrack.duration as number | undefined) || 0),
        };
            return;
          }
        } catch {
          // fall through
        }

        await updateWidget({
          title: t('player.notPlaying'),
          artist: "",
          coverPath: null,
          isPlaying: false,
          playMode: "",
          isLiked: false,
          position: 0,
          duration: 0,
        });
        lastWidgetStateRef.current = {
          trackId: null,
          isPlaying: false,
          coverPath: "",
          playMode: "",
          isLiked: false,
          position: 0,
          duration: 0,
        };
        return;
      }

      let coverPath: string | null = null;
      const artworkUrl = resolveArtworkUri(currentTrack);
      if (artworkUrl) {
        const cached = await cacheCover(artworkUrl);
        if (!cached.startsWith("http://") && !cached.startsWith("https://")) {
          coverPath = cached;
        }
      }

      if (cancelled) return;

      const isLiked = !!currentTrack.likedByUsers?.some((like: any) => like.userId === user?.id);
      const lock = widgetModeLockRef.current;
      const playModeValue =
        lock.until > Date.now() && lock.playMode ? lock.playMode : playModeRef.current;

      const lastState = lastWidgetStateRef.current;
      const nextCoverPath = coverPath || "";
      if (
        lastState.trackId === currentTrack.id &&
        lastState.isPlaying === isPlaying &&
        lastState.coverPath === nextCoverPath &&
        lastState.playMode === playModeValue &&
        lastState.isLiked === isLiked &&
        lastState.position === Math.floor(positionRef.current) &&
        lastState.duration === Math.floor(duration || currentTrack.duration || 0)
      ) {
        return;
      }

      lastWidgetStateRef.current = {
        trackId: currentTrack.id,
        isPlaying,
        coverPath: nextCoverPath,
        playMode: playModeValue,
        isLiked,
        position: Math.floor(positionRef.current),
        duration: Math.floor(duration || currentTrack.duration || 0),
      };

      await updateWidget({
        title: currentTrack.name,
        artist: currentTrack.artist,
        coverPath,
        isPlaying,
        playMode: playModeValue,
        isLiked,
        position: Math.floor(positionRef.current),
        duration: Math.floor(duration || currentTrack.duration || 0),
      });
    };

    syncWidget();
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id, isPlaying, playMode, user?.id, duration]);

  useEffect(() => {
    const syncWidgetProgress = async () => {
      const track = currentTrackRef.current;
      if (!track) return;

      const nextPosition = Math.floor(position);
      const nextDuration = Math.floor(duration || track.duration || 0);
      const lastState = lastWidgetStateRef.current;

      if (
        lastState.trackId === track.id &&
        lastState.position === nextPosition &&
        lastState.duration === nextDuration
      ) {
        return;
      }

      const isLiked =
        lastState.isLiked ??
        !!track.likedByUsers?.some((like: any) => like.userId === user?.id);

      await updateWidget({
        title: track.name,
        artist: track.artist,
        coverPath: lastState.coverPath || null,
        isPlaying,
        playMode: lastState.playMode || playModeRef.current,
        isLiked,
        position: nextPosition,
        duration: nextDuration,
      });

      lastWidgetStateRef.current = {
        ...lastState,
        trackId: track.id,
        isPlaying,
        position: nextPosition,
        duration: nextDuration,
      };
    };

    syncWidgetProgress();
  }, [currentTrack?.id, position, duration, isPlaying, user?.id]);

  const refreshWidgetCollections = useCallback(async () => {
    if (!user) return;
    try {
      const playlistsRes = await getPlaylists(mode as any, user.id);
      const historyRes =
        mode === "AUDIOBOOK"
          ? await getAlbumHistory(user.id, 0, 4, "AUDIOBOOK")
          : await getTrackHistory(user.id, 0, 4, "MUSIC");
      const latestRes = await getLatestTracks("MUSIC", false, 7);
      const recommendationsRes = await getRecommendedAlbums(
        mode,
        true,
        4,
        recommendationLikeRatio
      );
      const playlists = playlistsRes.code === 200 ? playlistsRes.data : [];
      const history = historyRes.code === 200
        ? mode === "AUDIOBOOK"
          ? historyRes.data.list.map((item: any) => ({
              id: item.trackId ?? item.track?.id ?? item.album?.id,
              name: item.album?.name || item.album?.title || t('player.untitled'),
              artist: item.album?.artist || "",
              cover: item.album?.cover || "",
              type: item.album?.type || "AUDIOBOOK",
              album: item.album?.name || "",
              resumeTrackId: item.trackId,
              resumeProgress: item.progress,
              albumId: item.album?.id,
            }))
          : historyRes.data.list.map((item: any) => item.track).filter(Boolean)
        : [];
      const latest = latestRes.code === 200 ? latestRes.data : [];
      const recommendations =
        recommendationsRes.code === 200 ? recommendationsRes.data : [];
      await updateWidgetCollections({
        playlists,
        history,
        latest,
        recommendations,
      });
    } catch (error) {
      if (__DEV__) {
        console.warn("[Widget] Failed to sync collections", error);
      }
    }
  }, [user?.id, mode, recommendationLikeRatio]);

  const refreshLatestWidgetItems = useCallback(async () => {
    try {
      const latestRes = await getLatestTracks("MUSIC", false, 7);
      const latest = latestRes.code === 200 ? latestRes.data : [];
      await updateWidgetCollections({ latest });
    } catch (error) {
      if (__DEV__) {
        console.warn("[Widget] Failed to refresh latest", error);
      }
    }
  }, []);

  const refreshRecommendationWidgetItems = useCallback(async () => {
    try {
      const recommendationsRes = await getRecommendedAlbums(
        mode,
        true,
        4,
        recommendationLikeRatio
      );
      const recommendations =
        recommendationsRes.code === 200 ? recommendationsRes.data : [];
      await updateWidgetCollections({ recommendations });
    } catch (error) {
      if (__DEV__) {
        console.warn("[Widget] Failed to refresh recommendations", error);
      }
    }
  }, [mode, recommendationLikeRatio]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await refreshWidgetCollections();
    };
    if (!cancelled) {
      run();
    }
    return () => {
      cancelled = true;
    };
  }, [refreshWidgetCollections]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  // ✨ 车机歌词推送：当播放进度变化时，推送当前歌词行到 CarWith / Android Auto / CarPlay
  const lastLyricRef = React.useRef<string>("");
  useEffect(() => {
    const track = currentTrackRef.current;
    if (!track?.lyrics) {
      if (lastLyricRef.current !== "") {
        lastLyricRef.current = "";
        updateMediaControlBridgeLyrics("");
      }
      return;
    }
    const line = getActiveLyricLine(track.lyrics, position);
    if (line !== lastLyricRef.current) {
      lastLyricRef.current = line;
      updateMediaControlBridgeLyrics(line);
    }
  }, [position, currentTrack]);

  const syncMediaControlCenterState = async () => {
    if (Platform.OS !== "android") return;
    try {
      const playback = await TrackPlayer.getPlaybackState();
      const queue = await TrackPlayer.getQueue();
      const hasTrack = !!currentTrackRef.current || queue.length > 0;

      let state: "playing" | "paused" | "buffering" | "loading" | "stopped" | "none" = "paused";
      if (playback.state === State.Playing) state = "playing";
      else if (playback.state === State.Buffering) state = "buffering";
      else if (playback.state === State.Loading) state = "loading";
      else if (playback.state === State.Stopped) state = "stopped";

      await updateMediaControlBridgePlaybackState({
        state,
        position: positionRef.current,
        speed: state === "playing" ? 1 : 0,
        // HyperOS 控制中心对 skip 能力比较敏感，这里稳定开启，具体是否可跳由业务逻辑决定
        canSkipNext: hasTrack,
        canSkipPrevious: hasTrack,
      });

      if (currentTrackRef.current) {
        await updateMediaControlBridgeMetadata({
          title: currentTrackRef.current.name,
          artist: currentTrackRef.current.artist,
          album: currentTrackRef.current.album || "Unknown Album",
          duration: currentTrackRef.current.duration || 0,
        });
      }
    } catch (e) {
      console.warn("[MediaControlBridge] sync state failed", e);
    }
  };

  // ✨ 加载本地存储的跳过设置
  useEffect(() => {
    const loadSkipSettings = async () => {
      try {
        const intro = await AsyncStorage.getItem("skipIntroDuration");
        const outro = await AsyncStorage.getItem("skipOutroDuration");
        if (intro) setSkipIntroDurationState(parseInt(intro, 10));
        if (outro) setSkipOutroDurationState(parseInt(outro, 10));
        const storedPlayMode = normalizeStoredPlayMode(
          (await AsyncStorage.getItem(PLAYBACK_MODE_KEY)) ??
          (await AsyncStorage.getItem(LEGACY_PLAY_MODE_KEY))
        );
        const storedRadioPlayMode = normalizeStoredPlayMode(
          await AsyncStorage.getItem(RADIO_PLAYBACK_MODE_KEY)
        );

        if (storedPlayMode) {
          normalPlayModeRef.current = storedPlayMode;
          if (!isRadioModeRef.current) {
            setActivePlayMode(storedPlayMode);
          }
        }
        if (storedRadioPlayMode) {
          radioPlayModeRef.current = storedRadioPlayMode;
        }
      } catch (e) {
        console.error("Failed to load skip settings", e);
      }
    };
    loadSkipSettings();
  }, []);

  // ✨ 封装 Setter 并持久化
  const setSkipIntroDuration = async (seconds: number) => {
    setSkipIntroDurationState(seconds);
    await AsyncStorage.setItem("skipIntroDuration", String(seconds));
  };

  const setSkipOutroDuration = async (seconds: number) => {
    setSkipOutroDurationState(seconds);
    await AsyncStorage.setItem("skipOutroDuration", String(seconds));
  };

  // Setup Player
  useEffect(() => {
    const setupPlayer = async () => {
      try {
        await TrackPlayer.setupPlayer({
          iosCategory: IOSCategory.Playback,
          iosCategoryMode: IOSCategoryMode.Default,
          iosCategoryOptions: [
            IOSCategoryOptions.AllowBluetooth,
            IOSCategoryOptions.AllowBluetoothA2DP,
            IOSCategoryOptions.AllowAirPlay,
            IOSCategoryOptions.DuckOthers,
          ],
          // 秒播优化（缓冲参数单位均为秒）：
          // minBuffer 默认 50s 过大——播放器会一直等到缓冲了 50s 才稳定播放，起播慢。
          // 降到 15s 保证流畅度的同时显著缩短起播等待。
          minBuffer: 15,
          // maxBuffer 限制总缓冲量，避免无限拉流占内存；与 minBuffer 保持合理比例。
          maxBuffer: 50,
          // playBuffer 是「起播/seek 后需要多少缓冲才开始出声」的阈值，默认 2.5s 合理，
          // 显式写出避免被 minBuffer 间接拉高。
          playBuffer: 2.5,
          // backBuffer 保留已播内容，避免 seek 回退时重新拉流；30s 够覆盖常见回退场景。
          backBuffer: 30,
        });
        await updatePlayerCapabilities();
        setIsSetup(true);
      } catch (error: any) {
        if (error?.message?.includes("already been initialized")) {
          setIsSetup(true);
        } else {
          console.error("[TrackPlayer] setup failed", error);
        }
      }
    };
    setupPlayer();
  }, []);

  useTrackPlayerEvents(
    [
      Event.PlaybackState,
      Event.PlaybackError,
      Event.PlaybackQueueEnded,
      Event.PlaybackActiveTrackChanged,
    ],
    async (event) => {
      if (event.type === Event.PlaybackError) {
        console.error(
          "An error occurred while playing the current track.",
          event
        );
        if (isRadioModeRef.current) {
          // 播放出错时清空预加载缓存，避免可能的问题
          radioNextTrackRef.current = null;
          playNext();
        }
      }
      if (event.type === Event.PlaybackState) {
        setIsPlaying(event.state === State.Playing);
        setIsLoading(
          event.state === State.Buffering || event.state === State.Loading
        );
        await syncMediaControlCenterState();

        // ✨ 手动切歌兜底：加载结束后若原生状态停在 Stopped/Ready（而非 Playing/Paused），
        // 说明 play() 意图被 setQueue/skip/remove 的队列重建吞掉了，这里自动补播。
        // 只针对「有明确切歌请求」的场景（pendingPlaybackTrackIdRef 非空），
        // 不影响用户手动暂停（Paused 不触发）和自动连播（pending 已清空）。
        if (
          event.state !== State.Buffering &&
          event.state !== State.Loading &&
          event.state !== State.Playing &&
          event.state !== State.Paused &&
          isPlaybackRequestPendingRef.current &&
          pendingPlaybackTrackIdRef.current &&
          String(currentTrackRef.current?.id) === pendingPlaybackTrackIdRef.current
        ) {
          console.log("[Player] Auto-resume after manual track switch, state:", event.state);
          TrackPlayer.play().catch(() => {});
        }
      }
      if (event.type === Event.PlaybackActiveTrackChanged) {
        // ✨ 当切歌发生（无论是手动还是自动播放下一首）
        if (event.index !== undefined) {
          const nextTrack = await getActiveTrackFromQueue(
            event.index,
            (event as any).track,
          );
          if (!nextTrack) return;
          if (
            isPlaybackRequestPendingRef.current &&
            pendingPlaybackTrackIdRef.current &&
            String(nextTrack.id) !== pendingPlaybackTrackIdRef.current
          ) {
            return;
          }

          console.log(`[Player] Active track changed to index ${event.index}: ${nextTrack.name}`);
          
          setCurrentTrackState(nextTrack);
          isSkippingOutroRef.current = false;

          // ✨ 智能预缓存：当前曲目开始播放时，预下载播放列表前后各 5 首（共 10 首）。
          // 已缓存/已触发过的曲目跳过（preDownloadedIdsRef 去重），
          // 播放列表变化时 setTrackListState 会清空该标记重新计算。
          // 所有网络类型都下载——复播秒播的前提是「播过的歌一定已缓存」；
          // 流量敏感用户可关闭「边播边缓存」开关（cacheEnabled=false 时 resolveTrackUri 直接走远端）。
          const currentListIndex = trackListRef.current.findIndex((t) => t.id === nextTrack.id);
          if (currentListIndex >= 0) {
            const PRELOAD_RANGE = 5;
            const list = trackListRef.current;
            for (
              let i = Math.max(0, currentListIndex - PRELOAD_RANGE);
              i <= Math.min(list.length - 1, currentListIndex + PRELOAD_RANGE);
              i++
            ) {
              if (i === currentListIndex) continue; // 当前曲目已在播放，无需预下载
              const t = list[i];
              const key = String(t.id);
              if (preDownloadedIdsRef.current.has(key)) continue;
              preDownloadedIdsRef.current.add(key);
              resolveTrackUri(t, { cacheEnabled, shouldDownload: true }).catch(() => {});
            }
            console.log(
              `[Player] Pre-loading ±${PRELOAD_RANGE} around index ${currentListIndex}`
            );
          }

          // ✨ 处理有声书自动跳过片头
          if (
            nextTrack.type === TrackType.AUDIOBOOK &&
            skipIntroDurationRef.current > 0 &&
            event.lastIndex !== undefined // 确保是自动切换或手动切，不是第一次加载
          ) {
            console.log(`[AutoSkip] Native transition detected, skipping intro: ${skipIntroDurationRef.current}s`);
            await TrackPlayer.seekTo(skipIntroDurationRef.current);
          }

          await updateMediaControlBridgeMetadata({
            title: nextTrack.name,
            artist: nextTrack.artist,
            album: nextTrack.album || "Unknown Album",
            duration: nextTrack.duration || 0,
          });
          await syncMediaControlCenterState();
        }
      }
      if (event.type === Event.PlaybackQueueEnded) {
        if (isPlaybackRequestPendingRef.current) return;

        const now = Date.now();
        if (now - lastAutoNextAtRef.current < 800) {
          return;
        }
        lastAutoNextAtRef.current = now;

        // 如果是电台模式，需要手动加载下一首
        if (isRadioModeRef.current) {
            await playNext();
            return;
        }

        // 兜底：队列结束后按业务播放列表续播，避免依赖控制中心远程事件
        await playNext();
      }
    }
  );

  // ✨ 监控片尾自动跳过逻辑
  useEffect(() => {
    // 只有有声书且正在播放且设置了跳过片尾才生效
    if (
      !isPlaying ||
      skipOutroDuration <= 0 ||
      duration <= 0 ||
      currentTrack?.type !== TrackType.AUDIOBOOK
    )
      return;

    const remaining = duration - position;

    // remaining > 1 是为了防止刚加载时 position 为 0 导致误判 (虽然 playTrack 会 Seek)
    // 或者是防止 duration 还没完全加载出来
    if (
      remaining <= skipOutroDuration &&
      remaining > 0.5 &&
      !isSkippingOutroRef.current
    ) {
      console.log(
        `[AutoSkip] Outro detected (${remaining.toFixed(1)}s left), skipping to next.`
      );
      isSkippingOutroRef.current = true;
      playNext();
    }
  }, [position, duration, isPlaying, skipOutroDuration, currentTrack]);

  const getNextIndex = (
    currentIndex: number,
    mode: PlayMode,
    list: Track[]
  ) => {
    if (list.length === 0) return -1;
    switch (mode) {
      case PlayMode.SEQUENCE:
        return currentIndex + 1 < list.length ? currentIndex + 1 : -1;
      case PlayMode.LOOP_LIST:
        return (currentIndex + 1) % list.length;
      case PlayMode.SHUFFLE:
        return getRandomIndex(list.length, currentIndex);
      case PlayMode.LOOP_SINGLE:
        return currentIndex;
      default:
        return currentIndex + 1 < list.length ? currentIndex + 1 : -1;
    }
  };

  const getRandomIndex = (listLength: number, excludeIndex: number) => {
    if (listLength <= 1) return listLength === 1 ? 0 : -1;
    let randomIndex = Math.floor(Math.random() * listLength);
    if (randomIndex === excludeIndex) {
      randomIndex = (randomIndex + 1) % listLength;
    }
    return randomIndex;
  };

  const prepareAudioQuality = async (
    track: Track,
    preferredQuality?: AudioQuality,
  ): Promise<{ selectedQuality: AudioQuality; options: AudioQualityOption[] }> => {
    if (track.type === TrackType.AUDIOBOOK) {
      return { selectedQuality: "lossless", options: [] };
    }

    const profile = await getTrackAudioQualityProfile(track);
    const selectedQuality = resolveTrackAudioQuality(
      profile,
      preferredQuality ??
        (await getCurrentPlaybackQualityPreference({
          internalPlaybackQuality,
          externalPlaybackQuality,
        })),
    );

    return { selectedQuality, options: profile.options };
  };

  const getPreviousIndex = (
    currentIndex: number,
    mode: PlayMode,
    list: Track[]
  ) => {
    if (list.length === 0) return -1;
    if (mode === PlayMode.SHUFFLE) {
      return getRandomIndex(list.length, currentIndex);
    }
    if (currentIndex > 0) return currentIndex - 1;
    return list.length - 1;
  };

  const updatePlayerCapabilities = async (track?: Track) => {
    const isAudiobookAndroid =
      Platform.OS === "android" && track?.type === TrackType.AUDIOBOOK;

    const capabilities = [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.Stop,
      Capability.SeekTo,
    ];

    const compactCapabilities = [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
    ];

    if (isAudiobookAndroid) {
      capabilities.push(Capability.JumpBackward);
      capabilities.push(Capability.JumpForward);
      compactCapabilities.push(Capability.JumpBackward);
      compactCapabilities.push(Capability.JumpForward);
    }

    const jumpOptions = isAudiobookAndroid
      ? {
          // @ts-ignore
          jumpForwardInterval: 15,
          // @ts-ignore
          jumpBackwardInterval: 15,
        }
      : {};

    await TrackPlayer.updateOptions({
      capabilities,
      compactCapabilities,
      ...jumpOptions,
      // ✨ 优化：缩短进度更新间隔以提高片尾跳过精度
      progressUpdateEventInterval: 1,
      android: {
        appKilledPlaybackBehavior:
          AppKilledPlaybackBehavior.ContinuePlayback,
      },
    } as any);
  };

  const fetchRadioTrackWithRetry = async (retries = 3): Promise<Track | null> => {
    for (let i = 0; i < retries; i++) {
      try {
        let res = await getRecommendedTracks(TrackType.MUSIC, 1, recommendationLikeRatio);
        if (res.code === 200 && res.data && res.data.length > 0) {
          if (res.data[0].id !== currentTrackRef.current?.id) {
            return res.data[0];
          }
          // 如果和当前相同，再请求一次
          res = await getRecommendedTracks(TrackType.MUSIC, 1, recommendationLikeRatio);
          if (res.code === 200 && res.data && res.data.length > 0) {
            return res.data[0];
          }
        }
      } catch (e) {
        console.error(`Radio track fetch attempt ${i + 1} failed`, e);
      }
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    return null;
  };

  const preloadNextRadioTrack = async () => {
    if (!isRadioModeRef.current) return;
    const track = await fetchRadioTrackWithRetry();
    if (track) {
      radioNextTrackRef.current = track;
    }
  };

  const playNext = async () => {
    if (isRadioModeRef.current) {
      try {
        let nextTrack = radioNextTrackRef.current;
        if (!nextTrack || nextTrack.id === currentTrackRef.current?.id) {
          nextTrack = await fetchRadioTrackWithRetry();
        }
        radioNextTrackRef.current = null;

        if (nextTrack) {
          await playTrack(nextTrack, undefined, true);
          preloadNextRadioTrack();
        } else {
          console.error("Radio playNext failed: no track available after retries");
          await TrackPlayer.pause();
        }
      } catch (e) {
        console.error("Radio playNext failed", e);
        await TrackPlayer.pause();
      }
      return;
    }

    const list = trackListRef.current;
    if (playModeRef.current === PlayMode.LOOP_SINGLE) {
      await seekTo(0);
      return;
    }
    
    // 非随机模式下，优先使用原生队列切歌，减少重建队列开销。
    // 队列结束事件触发时，原生队列仍可能保留多首歌但 active index 已经在最后一首，
    // 这时直接 skipToNext 会失败并中断业务列表兜底续播。
    const queue = await TrackPlayer.getQueue();
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    if (
      playModeRef.current !== PlayMode.SHUFFLE &&
      activeIndex !== undefined &&
      activeIndex < queue.length - 1
    ) {
      await TrackPlayer.skipToNext();
      return;
    }

    const current = currentTrackRef.current;
    if (!current || list.length === 0) return;
    const currentIndex = list.findIndex((t) => t.id === current.id);
    if (currentIndex === -1) return;
    const nextIndex = getNextIndex(currentIndex, playModeRef.current, list);
    if (nextIndex !== -1) {
      await playTrack(list[nextIndex]);
    } else {
      await TrackPlayer.pause();
    }
  };

  const playPrevious = async () => {
    if (isRadioModeRef.current) {
      await playNext(); // Previous also plays random in radio mode
      return;
    }

    const list = trackListRef.current;
    const current = currentTrackRef.current;
    if (!current || list.length === 0) return;
    const currentIndex = list.findIndex((t) => t.id === current.id);
    if (currentIndex === -1) return;
    const prevIndex = getPreviousIndex(currentIndex, playModeRef.current, list);
    if (prevIndex !== -1) {
      await playTrack(list[prevIndex]);
    }
  };

  const getNextPlayMode = (current: PlayMode) => {
    const modes = [
      PlayMode.SEQUENCE,
      PlayMode.SHUFFLE,
      PlayMode.LOOP_LIST,
      PlayMode.LOOP_SINGLE,
    ];
    const currentIndex = modes.indexOf(current);
    return modes[(currentIndex + 1) % modes.length];
  };

  const updateWidgetWithOverrides = async (overrides: {
    playMode?: PlayMode;
    isLiked?: boolean;
    isPlaying?: boolean;
  }) => {
    const track = currentTrackRef.current;
    if (!track) return;

    const liked =
      overrides.isLiked ??
      !!track.likedByUsers?.some((like: any) => like.userId === user?.id);
    const lock = widgetModeLockRef.current;
    const nextPlayMode =
      overrides.playMode ??
      (lock.until > Date.now() && lock.playMode ? lock.playMode : playModeRef.current);
    const nextIsPlaying = overrides.isPlaying ?? lastWidgetStateRef.current.isPlaying;
    const coverPath = lastWidgetStateRef.current.coverPath || null;

    await updateWidget({
      title: track.name,
      artist: track.artist,
      coverPath,
      isPlaying: nextIsPlaying,
      playMode: nextPlayMode,
      isLiked: liked,
      position: Math.floor(positionRef.current),
      duration: Math.floor(duration || track.duration || 0),
    });

    lastWidgetStateRef.current = {
      trackId: track.id,
      isPlaying: nextIsPlaying,
      coverPath: coverPath || "",
      playMode: nextPlayMode,
      isLiked: liked,
      position: Math.floor(positionRef.current),
      duration: Math.floor(duration || track.duration || 0),
    };
  };

  const applyPlayMode = async (nextMode: PlayMode) => {
    // Update ref immediately to avoid widget refresh reverting during state lag.
    setActivePlayMode(nextMode);
    if (isRadioModeRef.current) {
      radioPlayModeRef.current = nextMode;
      await AsyncStorage.setItem(RADIO_PLAYBACK_MODE_KEY, nextMode);
    } else {
      normalPlayModeRef.current = nextMode;
      await AsyncStorage.setItem(PLAYBACK_MODE_KEY, nextMode);
    }
    savePlaybackState(mode);
  };

  const togglePlayMode = async () => {
    const nextMode = getNextPlayMode(playModeRef.current);
    await applyPlayMode(nextMode);
  };

  const getContentModeForTrack = (track?: Track | null) =>
    track?.type === TrackType.AUDIOBOOK ? "AUDIOBOOK" : "MUSIC";

  const switchContentModeForIncomingTrack = async (track?: Track | null) => {
    exitRadioPlaybackContext();
    const nextMode = getContentModeForTrack(track);
    if (mode === nextMode) return;

    await savePlaybackState(prevModeRef.current);
    skipNextModeRestoreRef.current = true;
    await setMode(nextMode);
    prevModeRef.current = nextMode;
  };

  const savePlaybackState = async (targetMode: string) => {
    if (!currentTrackRef.current || !isSetup) return;
    const state = {
      currentTrack: currentTrackRef.current,
      trackList: trackListRef.current,
      position: positionRef.current,
      playMode: isRadioModeRef.current ? normalPlayModeRef.current : playModeRef.current,
      playbackRate: playbackRateRef.current,
    };
    try {
      await AsyncStorage.setItem(
        `playbackState_${targetMode}`,
        JSON.stringify(state)
      );
    } catch (e) {
      console.error("Failed to save playback state", e);
    }
  };

  const loadPlaybackState = async (targetMode: string, restorePlayMode = false) => {
    if (!isSetup) return;
    try {
      const saved = await AsyncStorage.getItem(`playbackState_${targetMode}`);
      if (saved) {
        const state = JSON.parse(saved);
        const savedList = Array.isArray(state.trackList) ? state.trackList : [];
        setTrackListState(savedList);
        if (restorePlayMode && state.playMode) {
          const restoredPlayMode = normalizeStoredPlayMode(state.playMode);
          if (restoredPlayMode) {
            normalPlayModeRef.current = restoredPlayMode;
            if (!isRadioModeRef.current) {
              setActivePlayMode(restoredPlayMode);
            }
          }
        }
        if (state.playbackRate) {
          setPlaybackRateState(state.playbackRate);
        }
        if (state.currentTrack) {
          const list = savedList.length > 0 ? savedList : [state.currentTrack];
          const activeIndex = Math.max(
            0,
            list.findIndex((t: Track) => t.id === state.currentTrack.id)
          );

          const activeTrack = list[activeIndex];
          setTrackListState(list);
          setCurrentTrackState(activeTrack);

          const shouldUseSingleTrackQueue = state.playMode === PlayMode.SHUFFLE;
          if (shouldUseSingleTrackQueue) {
            const uri =
              await resolveTrackUri(activeTrack, {
                cacheEnabled,
                shouldDownload: true,
              });
            const artwork = await resolveArtworkUriForPlayer(activeTrack, {
              shouldDownload: true,
            });
            await TrackPlayer.setQueue([
              {
                id: String(activeTrack.id),
                url: uri,
                title: activeTrack.name,
                artist: activeTrack.artist,
                album: activeTrack.album || "Unknown Album",
                artwork,
                duration: activeTrack.duration || 0,
                type: activeTrack.type,
              } as any,
            ]);
            await TrackPlayer.skip(0);
          } else {
            const queue = await Promise.all(
              list.map(async (track: Track, i: number) => {
                const isNearCurrent = i === activeIndex || i === activeIndex + 1;
                // 秒播优化：音乐也走 resolveTrackUri，本地缓存命中直接 file:// 秒播；
                // 未命中时后台下载（仅当前/下一首，fast 跳过其余曲目的磁盘检查）。
                const uri = await resolveTrackUri(track, {
                  cacheEnabled,
                  shouldDownload: isNearCurrent,
                  fast: !isNearCurrent,
                });
                const artwork = await resolveArtworkUriForPlayer(track, {
                  shouldDownload: isNearCurrent,
                  fast: !isNearCurrent,
                });
                return {
                  id: String(track.id),
                  url: uri,
                  title: track.name,
                  artist: track.artist,
                  album: track.album || "Unknown Album",
                  artwork,
                  duration: track.duration || 0,
                  type: track.type,
                } as any;
              })
            );

            await TrackPlayer.setQueue(queue);
            await TrackPlayer.skip(activeIndex);
          }

          if (state.position) {
            await TrackPlayer.seekTo(state.position);
          }

          await updatePlayerCapabilities(activeTrack);
        } else {
          setCurrentTrackState(null);
          setTrackListState([]);
          await TrackPlayer.reset();
        }
      } else {
        setCurrentTrackState(null);
        setTrackListState([]);
        await TrackPlayer.reset();
      }
    } catch (e) {
      console.error("Failed to load playback state", e);
      setCurrentTrackState(null);
      setTrackListState([]);
      try {
        await TrackPlayer.reset();
      } catch {
        // Ignore reset errors after a failed restore; the UI state has already been cleared.
      }
    }
  };

  useEffect(() => {
    if (!isSetup || isAuthLoading) return;
    const handleModeChange = async () => {
      if (isInitialLoadRef.current) {
        await loadPlaybackState(mode, true); // 初始加载时恢复播放模式
        isInitialLoadRef.current = false;
        prevModeRef.current = mode;
      } else if (prevModeRef.current !== mode) {
        exitRadioPlaybackContext();
        if (skipNextModeRestoreRef.current) {
          skipNextModeRestoreRef.current = false;
          prevModeRef.current = mode;
          return;
        }
        await savePlaybackState(prevModeRef.current);
        await loadPlaybackState(mode); // 内容模式切换时不恢复播放模式，保留用户选择
        prevModeRef.current = mode;
      }
    };
    handleModeChange();
  }, [mode, isSetup, isAuthLoading]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isPlaying && isSetup) {
        savePlaybackState(mode);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [isPlaying, isSetup, mode]);

  const playTrack = async (
    track: Track,
    initialPosition?: number,
    fromRadio = false,
    forceReload = false,
    preferredQuality?: AudioQuality,
  ) => {
    if (!isSetup) return;

    const requestId = playbackRequestIdRef.current + 1;
    playbackRequestIdRef.current = requestId;
    isPlaybackRequestPendingRef.current = true;
    pendingPlaybackTrackIdRef.current = String(track.id);

    const isLatestRequest = () => requestId === playbackRequestIdRef.current;

    if (!fromRadio) {
      exitRadioPlaybackContext();
    }
    if (preferredQuality) {
      setPreferredAudioQuality(preferredQuality);
    }
    try {
      // ✨ 幂等性检查：如果已经是当前歌曲，且没有大幅度进度偏差，则不重置播放器
      if (!forceReload && currentTrackRef.current?.id === track.id) {
        console.log("[Player] Already playing this track, skipping reset.");
        if (initialPosition !== undefined) {
          await TrackPlayer.seekTo(initialPosition);
        }
        return;
      }

      // ✨ 重置片尾跳过锁
      isSkippingOutroRef.current = false;

      // Pick the quality synchronously so we can hand TrackPlayer a URL on
      // the very next tick. The async profile fetch + cache check + artwork
      // download run in the background and only upgrade state when they
      // resolve — they never gate the play call.
      //
      // Note: getCurrentPlaybackQualityPreference is async (reads
      // AsyncStorage) so we can't await it on the play path. Falling back to
      // "lossless" gives a sensible default that works for every track; if
      // the user picked a different preferred quality the background
      // prepareAudioQuality() call will reconcile the UI state. We
      // deliberately do NOT swap the audio URL mid-playback — that would
      // re-buffer and defeat the purpose of this fix.
      const initialQuality: AudioQuality = preferredQuality ?? "lossless";

      // 秒播优化：起播前同步查音频缓存内存索引（cache.ts 启动时已预热）。
      // 命中 → 直接用本地 file:// 路径，复播零网络；未命中 → 走远端，后台下载供下次。
      const cachedPath = cacheEnabled
        ? getCachedTrackPathSync(track.id, track.path)
        : null;
      const remoteUri = cachedPath ?? buildTrackPlaybackUrl(track, initialQuality);

      // Artwork: use the remote URL immediately. A cached / downloaded
      // copy is wired up in the background and just swaps the metadata.
      const remoteArtwork = resolveArtworkUri(track);

      console.log("Playing track:", track.id, "URI:", remoteUri);

      const trackData: any = {
        id: String(track.id),
        url: remoteUri,
        title: track.name,
        artist: track.artist,
        album: track.album || "Unknown Album",
        artwork: remoteArtwork,
        duration: track.duration || 0,
        type: track.type, // ✨ 传递类型
      };
      knownTrackByIdRef.current.set(String(track.id), track);

      // ✨ 优化：使用“先加后跳再删”逻辑，防止 reset 导致音频焦点丢失和通知栏闪烁
      const queue = await TrackPlayer.getQueue();
      if (!isLatestRequest()) return;

      if (queue.length > 0) {
        await TrackPlayer.add(trackData);
        if (!isLatestRequest()) return;
        await TrackPlayer.skip(queue.length);
        // 旧歌曲延迟到 play() 之后移除（见下方），避免 fire-and-forget remove
        // 与 play 竞争导致原生队列索引位移、把刚发出的 play 意图吞掉。
      } else {
        await TrackPlayer.add(trackData);
      }
      if (!isLatestRequest()) return;

      await updatePlayerCapabilities(track);
      if (!isLatestRequest()) return;

      // ✨ 处理初始位置 & 自动跳过片头
      let startPos = 0;

      // 优先级：显式指定的 initialPosition (恢复进度) > 自动跳过设置
      if (initialPosition !== undefined) {
        startPos = initialPosition;
      } else if (
        skipIntroDurationRef.current > 0 &&
        track.type === TrackType.AUDIOBOOK // 仅有声书生效
      ) {
        console.log(`[AutoSkip] Skipping intro: ${skipIntroDurationRef.current}s`);
        startPos = skipIntroDurationRef.current;
      }

      if (startPos > 0) {
        await TrackPlayer.seekTo(startPos);
        if (!isLatestRequest()) return;
      }

      await TrackPlayer.play();
      if (!isLatestRequest()) return;

      // play() 已发出后再清理旧队列：此时 remove 即使触发索引位移，
      // 也只会影响后续队列顺序，不会吞掉本次起播意图。
      if (queue.length > 0) {
        TrackPlayer.remove(Array.from({ length: queue.length }, (_, i) => i)).catch(() => {});
      }

      setCurrentTrackState(track);
      setCurrentAudioQuality(initialQuality);

      // ✨ 异步升级：拉取 quality profile + 缓存 + 封面，全部不阻塞播放
      if (track.type !== TrackType.AUDIOBOOK) {
        prepareAudioQuality(track, initialQuality)
          .then(({ selectedQuality, options }) => {
            if (!isLatestRequest()) return;
            setAvailableAudioQualities(options);
            setCurrentAudioQuality((prev) =>
              prev === selectedQuality ? prev : selectedQuality
            );
          })
          .catch(() => {
            /* keep initial quality */
          });
      }
      // 秒播优化：音乐+有声书都走缓存升级分支。
      // - 已命中缓存（cachedPath 非空）：起播已是本地文件，跳过下载，什么也不做
      // - 未命中：后台下载供下次复播命中。**所有网络类型都下载**（不只 Wi-Fi）——
      //   复播秒播的前提是「播过的歌一定已缓存」；流量敏感用户可关闭「边播边缓存」开关。
      if (!cachedPath) {
        resolveTrackUri(track, { cacheEnabled, shouldDownload: true })
          .then((cachedUri) => {
            if (!isLatestRequest()) return;
            if (cachedUri && cachedUri !== remoteUri) {
              console.log(
                `[Player] Cached copy available for ${track.id}, will use on next play.`
              );
            }
          })
          .catch(() => {
            /* keep remote URI */
          });
      }

      // Background: download cover art for future metadata use.
      resolveArtworkUriForPlayer(track, { shouldDownload: true }).catch(() => {
        /* keep remote artwork */
      });

      savePlaybackState(mode);
    } catch (error) {
      if (isLatestRequest()) {
        console.error("Failed to play track:", error);
      }
    } finally {
      if (isLatestRequest()) {
        isPlaybackRequestPendingRef.current = false;
        pendingPlaybackTrackIdRef.current = null;
      }
    }
  };

  const playTrackList = async (tracks: Track[], index: number, initialPosition?: number) => {
    if (!isSetup) return;

    const requestId = playbackRequestIdRef.current + 1;
    playbackRequestIdRef.current = requestId;
    isPlaybackRequestPendingRef.current = true;
    pendingPlaybackTrackIdRef.current = tracks[index] ? String(tracks[index].id) : null;

    const isLatestRequest = () => requestId === playbackRequestIdRef.current;

    try {
      exitRadioPlaybackContext();
      setTrackListState(tracks);
      isSkippingOutroRef.current = false;

      // Pick the preferred quality synchronously for the same reason as
      // playTrack: never block queue setup on an HTTP profile fetch.
      // AsyncStorage-backed preferences are read in the background; "lossless"
      // is the safe default that every backend supports.
      const listQuality: AudioQuality = "lossless";

      // 秒播优化：同步查缓存内存索引，命中的曲目直接给 file:// 本地路径，
      // 整列 setQueue 依然零 IO 阻塞；未命中的走远端 URL。
      const buildSyncUri = (t: Track): string => {
        const cached = cacheEnabled ? getCachedTrackPathSync(t.id, t.path) : null;
        if (cached) return cached;
        return t.type === TrackType.AUDIOBOOK
          ? (t.path.startsWith("http")
              ? t.path
              : `${getBaseURL()}${t.path
                  .split("/")
                  .map(encodeURIComponent)
                  .join("/")}`)
          : buildTrackPlaybackUrl(t, listQuality);
      };

      const shouldUseSingleTrackQueue = playModeRef.current === PlayMode.SHUFFLE;
      if (shouldUseSingleTrackQueue) {
        const track = tracks[index];
        const uri = buildSyncUri(track);
        const artwork = resolveArtworkUri(track);
        if (!isLatestRequest()) return;

        await TrackPlayer.setQueue([
          {
            id: String(track.id),
            url: uri,
            title: track.name,
            artist: track.artist,
            album: track.album || "Unknown Album",
            artwork,
            duration: track.duration || 0,
            type: track.type,
          } as any,
        ]);
        if (!isLatestRequest()) return;

        await TrackPlayer.skip(0);

        // Background upgrades for the playing track (non-blocking).
        if (track.type === TrackType.AUDIOBOOK) {
          resolveTrackUri(track, { cacheEnabled, shouldDownload: true }).catch(
            () => {}
          );
        }
        resolveArtworkUriForPlayer(track, { shouldDownload: true }).catch(
          () => {}
        );
      } else {
        // ✨ 核心改进：预加载整个列表进入原生队列。全部使用同步 URL
        // 计算 + 远程封面，确保 setQueue 不被任何 IO 操作阻塞。
        const playerTracks = tracks.map((t) => ({
          id: String(t.id),
          url: buildSyncUri(t),
          title: t.name,
          artist: t.artist,
          album: t.album || "Unknown Album",
          artwork: resolveArtworkUri(t),
          duration: t.duration || 0,
          // ✨ 附加自定义字段，方便背景服务识别
          type: t.type,
        } as any));
        if (!isLatestRequest()) return;

        await TrackPlayer.setQueue(playerTracks);
        if (!isLatestRequest()) return;

        await TrackPlayer.skip(index);

        // ✨ 后台异步触发当前和下一首的缓存/封面升级（不阻塞播放）
        // 秒播优化：所有网络类型都后台下载（不只 Wi-Fi），确保「播过的歌下次必命中本地缓存」。
        // 流量敏感用户可在设置里关闭「边播边缓存」开关（cacheEnabled=false 时 resolveTrackUri 直接走远端）。
        const nearTracks = [tracks[index], tracks[index + 1]].filter(Boolean);
        nearTracks.forEach((t) => {
          resolveTrackUri(t, { cacheEnabled, shouldDownload: true }).catch(
            () => {}
          );
          resolveArtworkUriForPlayer(t, { shouldDownload: true }).catch(() => {});
        });
      }
      if (!isLatestRequest()) return;

      if (initialPosition !== undefined) {
        await TrackPlayer.seekTo(initialPosition);
      } else if (tracks[index].type === TrackType.AUDIOBOOK && skipIntroDurationRef.current > 0) {
        await TrackPlayer.seekTo(skipIntroDurationRef.current);
      }
      if (!isLatestRequest()) return;

      await TrackPlayer.play();
      if (!isLatestRequest()) return;

      setCurrentTrackState(tracks[index]);
      savePlaybackState(mode);
    } catch (error) {
      if (isLatestRequest()) {
        console.error("Failed to play track list:", error);
      }
    } finally {
      if (isLatestRequest()) {
        isPlaybackRequestPendingRef.current = false;
        pendingPlaybackTrackIdRef.current = null;
      }
    }
  };

  const startRadioMode = async () => {
    enterRadioPlaybackContext();
    // Fetch a random track and start playing
    try {
      const track = await fetchRadioTrackWithRetry();
      if (track) {
        await playTrack(track, undefined, true);
        preloadNextRadioTrack();
      }
    } catch (e) {
      console.error("Failed to start radio mode", e);
    }
  };

  const broadcastSync = (type: string, data?: any) => {
    if (isSynced && sessionId && !isProcessingSync.current) {
      socketService.emit("sync_command", {
        sessionId,
        type,
        data,
      });
    }
  };

  const pause = async () => {
    if (isSetup) {
      try {
        await TrackPlayer.pause();
        savePlaybackState(mode);
      } catch (error) {
        console.error("Failed to pause:", error);
      }
    }
  };

  const resume = async () => {
    if (isSetup) {
      try {
        await TrackPlayer.play();
        savePlaybackState(mode);
      } catch (error) {
        console.error("Failed to resume:", error);
      }
    }
  };

  const seekTo = async (pos: number) => {
    if (isSetup) {
      try {
        await TrackPlayer.seekTo(pos);
        broadcastSync("seek", pos);
      } catch (error) {
        console.error("Failed to seek:", error);
      }
    }
  };

  const setPlaybackRate = async (rate: number) => {
    if (isSetup) {
      try {
        await TrackPlayer.setRate(rate);
        setPlaybackRateState(rate);
        savePlaybackState(mode);
      } catch (error) {
        console.error("Failed to set playback rate:", error);
      }
    }
  };

  const handleDisconnect = () => {
    Alert.alert(t('sync.syncStatus'), t('sync.disconnectConfirm'), [
      {
        text: t('common.cancel'),
        style: "cancel",
      },
      {
        text: t('common.confirm'),
        onPress: () => {
          console.log("User confirmed disconnect", sessionId);
          if (sessionId) {
            socketService.emit("player_left", { sessionId });
            setSynced(false, null);
            setParticipants([]);
          }
        },
      },
    ]);
  };

  // Progress reporting interval (5 seconds)
  const REPORT_INTERVAL = 5000;
  const lastReportTimeRef = useRef(0);

  const recordHistory = async (force = false) => {
    if (currentTrackRef.current && user) {
      const currentTime = Math.floor(positionRef.current);
      const now = Date.now();
      
      // Only report if forced or interval has passed
      if (!force && (now - lastReportTimeRef.current < REPORT_INTERVAL)) {
        return;
      }
      
      const deviceName = Device.modelName || "Mobile Device";
      const deviceId = device?.id;
      try {
        await addToHistory(
          currentTrackRef.current.id,
          user.id,
          currentTime,
          deviceName,
          deviceId,
          isSynced
        );
        if (currentTrackRef.current.albumId) {
          await addAlbumToHistory(currentTrackRef.current.albumId, user.id);
        }
        if (currentTrackRef.current.type === TrackType.AUDIOBOOK) {
          await reportAudiobookProgress({
            userId: user.id,
            trackId: currentTrackRef.current.id,
            progress: currentTime,
          });
        }
        
        lastReportTimeRef.current = now;
        // fix: sync local progress after report
        const reportedProgress = currentTime;
        if (currentTrackRef.current) {
          currentTrackRef.current = { ...currentTrackRef.current, progress: reportedProgress };
          setCurrentTrack(currentTrackRef.current);
        }
        const updatedTrackList = trackListRef.current.map(t =>
          t.id === currentTrackRef.current?.id ? { ...t, progress: reportedProgress } : t
        );
        setTrackList(updatedTrackList);
      } catch (e) {
        console.log(
          "Background history sync skipped due to network/transient error"
        );
      }
    }
  };

  const isProcessingSync = useRef(false);
  const {
    isSynced,
    sessionId,
    setSynced,
    setParticipants,
    lastAcceptedInvite,
  } = useSync();

  useEffect(() => {
    if (isSynced && sessionId) {
      const handleSyncEvent = async (payload: {
        type: string;
        data: any;
        fromUserId: number;
      }) => {
        if (String(payload.fromUserId) === String(user?.id)) return;
        isProcessingSync.current = true;
        try {
          switch (payload.type) {
            case "play":
              await resume();
              break;
            case "pause":
              await pause();
              break;
            case "seek":
              await seekTo(payload.data);
              break;
            case "track_change":
              if (currentTrackRef.current?.id !== payload.data.id) {
                await switchContentModeForIncomingTrack(payload.data);
                await playTrack(payload.data);
              }
              break;
            case "playlist":
              setTrackListState(payload.data);
              break;
            case "leave":
              console.log("Participant left the session");
              Alert.alert("同步状态", "对方已断开同步连接");
              break;
          }
        } finally {
          setTimeout(() => {
            isProcessingSync.current = false;
          }, 100);
        }
      };

      const handleRequestInitialState = (payload: {
        sessionId: string;
        fromSocketId: string;
      }) => {
        if (currentTrack) {
          socketService.emit("sync_command", {
            sessionId: payload.sessionId,
            type: "track_change",
            data: currentTrack,
            targetSocketId: payload.fromSocketId,
          });
          setTimeout(() => {
            socketService.emit("sync_command", {
              sessionId: payload.sessionId,
              type: isPlaying ? "play" : "pause",
              data: position,
              targetSocketId: payload.fromSocketId,
            });
          }, 200);
        }
      };

      socketService.on("sync_event", handleSyncEvent);
      socketService.on("request_initial_state", handleRequestInitialState);

      return () => {
        socketService.off("sync_event", handleSyncEvent);
        socketService.off("request_initial_state", handleRequestInitialState);
      };
    }
  }, [isSynced, sessionId, currentTrack, isPlaying, position]);

  useEffect(() => {
    if (isSynced && lastAcceptedInvite) {
      console.log("Applying invite context: playlist and track");
      const applyInviteContext = async () => {
        isProcessingSync.current = true;
        if (lastAcceptedInvite.currentTrack) {
          await switchContentModeForIncomingTrack(lastAcceptedInvite.currentTrack);
        }
        if (lastAcceptedInvite.playlist) {
          setTrackListState(lastAcceptedInvite.playlist);
        }
        if (lastAcceptedInvite.currentTrack && isSetup) {
          await playTrack(
            lastAcceptedInvite.currentTrack,
            lastAcceptedInvite.progress
          );
        }
        setTimeout(() => {
          isProcessingSync.current = false;
        }, 1000);
      };

      applyInviteContext();
    }
  }, [isSynced, lastAcceptedInvite?.sessionId, isSetup]);

  // ✨ 优化：当同步 Session 正式启动时（有人加入），发起者自动恢复播放
  const prevIsSyncedRef = useRef(false);
  useEffect(() => {
    if (isSynced && !prevIsSyncedRef.current && !lastAcceptedInvite) {
      console.log("[Sync] Session active, initiator resuming playback.");
      resume();
    }
    prevIsSyncedRef.current = isSynced;
  }, [isSynced, lastAcceptedInvite]);

  useEffect(() => {
    const handleSessionEnded = () => {
      Alert.alert(t('sync.syncStatus'), t('sync.syncEndedNotification'));
      setSynced(false, null);
      setParticipants([]);
      console.log("Sync session ended");
    };
    const handlePlayerLeft = (payload: {
      username: string;
      deviceName: string;
    }) => {
      Alert.alert(
        t('sync.syncStatus'),
        t('player.userDisconnected', { username: payload.username, deviceName: payload.deviceName })
      );
    };
    socketService.on("session_ended", handleSessionEnded);
    socketService.on("player_left", handlePlayerLeft);
    return () => {
      socketService.off("session_ended", handleSessionEnded);
      socketService.off("player_left", handlePlayerLeft);
    };
  }, [setSynced, setParticipants]);

  useEffect(() => {
    if (isSynced && sessionId && !isProcessingSync.current) {
      socketService.emit("sync_command", {
        sessionId,
        type: isPlaying ? "play" : "pause",
        data: null,
      });
    }
  }, [isPlaying, isSynced, sessionId]);

  useEffect(() => {
    if (isSynced && sessionId && !isProcessingSync.current && currentTrack) {
      socketService.emit("sync_command", {
        sessionId,
        type: "track_change",
        data: currentTrack,
      });
    }
  }, [currentTrack?.id, isSynced, sessionId]);

  useEffect(() => {
    if (
      isSynced &&
      sessionId &&
      !isProcessingSync.current &&
      trackList.length > 0
    ) {
      socketService.emit("sync_command", {
        sessionId,
        type: "playlist",
        data: trackList,
      });
    }
  }, [trackList, isSynced, sessionId]);

  useEffect(() => {
    const module = NativeModules.WidgetCommandEmitter;
    if (!module) return;

    const emitter = new NativeEventEmitter(module);
    const subscription = emitter.addListener("widgetCommand", async (payload) => {
      const action = String(payload?.action || "").toLowerCase();
      switch (action) {
        case "play":
          if (isPlaying) {
            await pause();
          } else {
            await resume();
          }
          break;
        case "pause":
          await pause();
          break;
        case "next":
          await playNext();
          break;
        case "mode":
          {
            const explicitNext = String(payload?.payload?.nextPlayMode || "");
            const explicitMode = Object.values(PlayMode).includes(explicitNext as PlayMode)
              ? (explicitNext as PlayMode)
              : null;
            const incoming = String(payload?.payload?.playMode || "");
            const nextMode =
              explicitMode ??
              (Object.values(PlayMode).includes(incoming as PlayMode)
                ? getNextPlayMode(incoming as PlayMode)
                : getNextPlayMode(playModeRef.current));
            widgetModeLockRef.current = {
              until: Date.now() + 2000,
              playMode: nextMode,
            };
            await applyPlayMode(nextMode);
            await updateWidgetWithOverrides({ playMode: nextMode });
          }
          break;
        case "like":
          if (currentTrack && user) {
            await toggleTrackLike(currentTrack.id, user.id);
          }
          break;
        case "unlike":
          if (currentTrack && user) {
            await toggleTrackUnLike(currentTrack.id, user.id);
          }
          break;
        case "prev":
        case "previous":
          await playPrevious();
          break;
        case "play_playlist": {
          const rawId = String(payload?.payload?.id || payload?.id || "");
          const playlistId = rawId ? Number(rawId) : NaN;
          if (!Number.isNaN(playlistId)) {
            try {
              const res = await getPlaylistById(playlistId);
              if (res.code === 200 && res.data?.tracks?.length) {
                await playTrackList(res.data.tracks, 0);
              }
            } catch (error) {
              console.warn("Failed to play playlist from widget", error);
            }
          }
          break;
        }
        case "play_history": {
          const rawId = String(payload?.payload?.id || payload?.id || "");
          const trackId = rawId ? Number(rawId) : NaN;
          if (!Number.isNaN(trackId) && user) {
            try {
              if (mode === "AUDIOBOOK") {
                const res = await getAlbumHistory(user.id, 0, 50, "AUDIOBOOK");
                if (res.code === 200) {
                  const entry = res.data.list.find((item: any) => Number(item.trackId) === trackId);
                  const albumId = entry?.album?.id;
                  const resumeProgress = entry?.progress || 0;
                  if (albumId) {
                    const tracksRes = await getAlbumTracks(albumId, 1000, 0);
                    if (tracksRes.code === 200 && tracksRes.data.list.length > 0) {
                      const tracks = tracksRes.data.list;
                      let index = tracks.findIndex((t: any) => Number(t.id) === trackId);
                      if (index === -1) index = 0;
                      await playTrackList(tracks, index, resumeProgress);
                    }
                  }
                }
              } else {
                const res = await getTrackHistory(user.id, 0, 50, "MUSIC");
                if (res.code === 200) {
                  const list = res.data.list.map((item: any) => item.track).filter(Boolean);
                  const index = list.findIndex((t: any) => Number(t.id) === trackId);
                  if (index >= 0) {
                    await playTrackList(list, index);
                  }
                }
              }
            } catch (error) {
              console.warn("Failed to play history track from widget", error);
            }
          }
          break;
        }
        case "play_latest": {
          const rawId = String(payload?.payload?.id || payload?.id || "");
          const trackId = rawId ? Number(rawId) : NaN;
          if (!Number.isNaN(trackId)) {
            try {
              const res = await getLatestTracks("MUSIC", false, 50);
              if (res.code === 200) {
                const list = res.data || [];
                const index = list.findIndex((t: any) => Number(t.id) === trackId);
                if (index >= 0) {
                  await playTrackList(list, index);
                }
              }
            } catch (error) {
              console.warn("Failed to play latest track from widget", error);
            }
          }
          break;
        }
        case "play_recommendation": {
          const rawId = String(payload?.payload?.id || payload?.id || "");
          const albumId = rawId ? Number(rawId) : NaN;
          if (!Number.isNaN(albumId)) {
            try {
              const tracksRes = await getAlbumTracks(albumId, 1000, 0);
              if (tracksRes.code === 200 && tracksRes.data.list.length > 0) {
                await playTrackList(tracksRes.data.list, 0);
              }
            } catch (error) {
              console.warn("Failed to play recommendation album from widget", error);
            }
          }
          break;
        }
        case "refresh_latest": {
          await refreshLatestWidgetItems();
          break;
        }
        case "refresh_recommendation": {
          await refreshRecommendationWidgetItems();
          break;
        }
        default:
          break;
      }
    });

    return () => subscription.remove();
  }, [
    isPlaying,
    pause,
    resume,
    playNext,
    playPrevious,
    togglePlayMode,
    currentTrack,
    user,
    refreshLatestWidgetItems,
    refreshRecommendationWidgetItems,
  ]);

  // Force report on track change
  useEffect(() => {
    if (currentTrack) {
      recordHistory(true);
    }
  }, [currentTrack?.id]);

  // Force report on pause
  useEffect(() => {
    if (!isPlaying && currentTrack) {
      recordHistory(true);
    }
  }, [isPlaying]);

  // Regular interval reporting (5 seconds)
  useEffect(() => {
    let interval: any;
    if (isPlaying) {
      interval = setInterval(() => {
        recordHistory();
      }, REPORT_INTERVAL);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying]);

  useEffect(() => {
    if (user && isSetup && acceptRelay) {
      const checkResume = async () => {
        try {
          const res = await getLatestHistory(user.id);
          if (res.code === 200 && res.data) {
            const history = res.data;
            const deviceName = Device.modelName || "Mobile Device";
            const diff =
              new Date().getTime() - new Date(history.listenedAt).getTime();
            const isRecent = diff < 24 * 60 * 60 * 1000;
            const isOtherDevice = history.deviceName !== deviceName;
            if (isRecent && isOtherDevice && history.track) {
              const m = Math.floor(history.progress / 60);
              const s = Math.floor(history.progress % 60)
                .toString()
                .padStart(2, "0");
              showNotification({
                type: "resume",
                track: history.track,
                title: t('player.continuePlaying'),
                description: t('player.foundPlaybackHistory', { deviceName: history.deviceName, time: `${m}:${s}` }),
                onAccept: async () => {
                  const trackData = history.track;
                  trackEvent({
                    feature: "relay",
                    eventName: "relay_play_accept",
                    userId: user?.id ? String(user.id) : undefined,
                    deviceId: device?.id ? String(device.id) : undefined,
                    metadata: {
                      fromDeviceName: history.deviceName,
                      trackId: trackData?.id,
                      trackType: trackData?.type,
                    },
                  });
                  // ✨ 有声书恢复时同时恢复整个专辑的播放列表
                  await switchContentModeForIncomingTrack(trackData);
                  if (trackData.type === TrackType.AUDIOBOOK && trackData.albumId) {
                    try {
                      const tracksRes = await getAlbumTracks(
                        trackData.albumId,
                        20000,
                        0,
                        "asc",
                        undefined,
                        user.id,
                        "episodeNumber"
                      );
                      if (tracksRes.code === 200 && tracksRes.data.list.length > 0) {
                        const albumTracks = tracksRes.data.list;
                        const trackIndex = albumTracks.findIndex((t: Track) => t.id === trackData.id);
                        if (trackIndex !== -1) {
                          await playTrackList(albumTracks, trackIndex, history.progress);
                          return;
                        }
                      }
                    } catch (e) {
                      console.error("Failed to restore audiobook album tracks during resume", e);
                    }
                  }
                  playTrack(trackData, history.progress);
                },
                onReject: () => {},
              });
            }
          }
        } catch (e) {
          console.error("Check resume error", e);
        }
      };
      checkResume();
    }
  }, [user?.id, isSetup]);

  const setSleepTimer = (minutes: number) => {
    const expiryTime = Date.now() + minutes * 60 * 1000;
    setSleepTimerState(expiryTime);
  };

  const insertTracksNext = async (tracksToInsert: Track[]) => {
    try {
      if (!currentTrack || trackList.length === 0) {
        // If nothing playing, just play these tracks
        await playTrackList(tracksToInsert, 0);
        return;
      }

      // Find current track index
      const currentIndex = trackList.findIndex(t => t.id === currentTrack.id);
      if (currentIndex === -1) {
        // Fallback: append to end
        const newList = [...trackList, ...tracksToInsert];
        setTrackList(newList);
        return;
      }

      // Insert after current track
      const newList = [
        ...trackList.slice(0, currentIndex + 1),
        ...tracksToInsert,
        ...trackList.slice(currentIndex + 1)
      ];
      
      setTrackList(newList);
    } catch (e) {
      console.error("Failed to insert tracks next", e);
    }
  };

  const clearSleepTimer = () => {
    setSleepTimerState(null);
  };

  const cycleAudioQuality = async () => {
    if (
      !currentTrackRef.current ||
      currentTrackRef.current.type === TrackType.AUDIOBOOK ||
      availableAudioQualities.length <= 1
    ) {
      return;
    }

    const currentIndex = availableAudioQualities.findIndex(
      (option) => option.quality === currentAudioQualityRef.current,
    );
    const nextOption =
      availableAudioQualities[(currentIndex + 1) % availableAudioQualities.length] ||
      availableAudioQualities[0];

    setPreferredAudioQuality(nextOption.quality);
    await playTrack(
      currentTrackRef.current,
      positionRef.current,
      false,
      true,
      nextOption.quality,
    );
  };

  useEffect(() => {
    if (!sleepTimer || !isPlaying) return;
    const checkTimer = setInterval(() => {
      if (Date.now() >= sleepTimer) {
        pause();
        setSleepTimerState(null);
      }
    }, 1000);
    return () => clearInterval(checkTimer);
  }, [sleepTimer, isPlaying]);

  return (
    <PlayerContext.Provider
      value={{
        isPlaying,
        currentTrack,
        position,
        duration,
        isLoading,
        playTrack,
        pause,
        resume,
        seekTo,
        trackList,
        playTrackList,
        playMode,
        togglePlayMode,
        playNext,
        playPrevious,
        insertTracksNext,
        isSynced,
        sessionId,
        handleDisconnect,
        showPlaylist,
        setShowPlaylist,
        sleepTimer,
        setSleepTimer,
        clearSleepTimer,
        playbackRate,
        setPlaybackRate,
        currentAudioQuality,
        availableAudioQualities,
        cycleAudioQuality,
        // ✨ Exports
        skipIntroDuration,
        setSkipIntroDuration,
        skipOutroDuration,
        setSkipOutroDuration,
        isRadioMode,
        startRadioMode,
        switchContentModeForIncomingTrack,
        reset: () => TrackPlayer.reset()
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};
