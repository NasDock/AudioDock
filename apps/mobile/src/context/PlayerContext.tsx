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
} from "../services/mediaControlBridge";
import { socketService } from "../services/socket";
import {
  resolveArtworkUriForPlayer,
  resolveTrackUri,
} from "../services/trackResolver";
import { usePlayMode } from "../utils/playMode";
import { updateWidget, updateWidgetCollections } from "../native/WidgetBridge";
import { cacheCover } from "../services/cache";
import { resolveArtworkUri } from "../services/trackResolver";
import { toggleTrackLike, toggleTrackUnLike } from "@soundx/services";
import { useAuth } from "./AuthContext";
import { useNotification } from "./NotificationContext";
import { useSettings } from "./SettingsContext";
import { useSync } from "./SyncContext";
import { trackEvent } from "../services/tracking";

export enum PlayMode {
  SEQUENCE = "SEQUENCE",
  LOOP_LIST = "LOOP_LIST",
  SHUFFLE = "SHUFFLE",
  LOOP_SINGLE = "LOOP_SINGLE",
}
const PLAYBACK_MODE_KEY = "playerPlaybackMode";
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
    forceReload?: boolean
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

  // ✨ 新增：跳过片头/片尾全局配置
  skipIntroDuration: number;
  setSkipIntroDuration: (seconds: number) => void;
  skipOutroDuration: number;
  setSkipOutroDuration: (seconds: number) => void;

  reset: () => Promise<void>;

  // 📻 电台模式
  isRadioMode: boolean;
  startRadioMode: () => Promise<void>;
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
  // ✨ 默认值
  skipIntroDuration: 0,
  setSkipIntroDuration: () => {},
  skipOutroDuration: 0,
  setSkipOutroDuration: () => {},
  isRadioMode: false,
  startRadioMode: async () => {},
  reset: async () => {},
});

export const usePlayer = () => useContext(PlayerContext);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, device, isLoading: isAuthLoading } = useAuth();
  const { mode, setMode } = usePlayMode();
  const { showNotification } = useNotification();
  const { acceptRelay, cacheEnabled, recommendationLikeRatio } = useSettings();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [trackList, setTrackList] = useState<Track[]>([]);
  const [playMode, setPlayMode] = useState<PlayMode>(PlayMode.SEQUENCE);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [isSetup, setIsSetup] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sleepTimer, setSleepTimerState] = useState<number | null>(null);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [isRadioMode, setIsRadioMode] = useState(false);

  // ✨ 新增 State
  const [skipIntroDuration, setSkipIntroDurationState] = useState(0);
  const [skipOutroDuration, setSkipOutroDurationState] = useState(0);
  const isSkippingOutroRef = useRef(false); // 防止重复触发切歌
  const lastAutoNextAtRef = useRef(0);

  const prevModeRef = useRef(mode);
  const isInitialLoadRef = useRef(true);
  const skipNextModeRestoreRef = useRef(false);

  // Hook for progress
  const { position, duration } = useProgress();

  // Refs for accessing latest state in callbacks
  const playModeRef = React.useRef(playMode);
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
  const isRadioModeRef = React.useRef(isRadioMode);
  const skipIntroDurationRef = React.useRef(skipIntroDuration);
  const skipOutroDurationRef = React.useRef(skipOutroDuration);

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

    const syncWidget = async () => {
      if (!currentTrack) {
        try {
          const playbackState = await TrackPlayer.getPlaybackState();
          const activeTrack: any = await TrackPlayer.getActiveTrack();
          if (activeTrack) {
            const title = activeTrack.title || activeTrack.name || "未在播放";
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
          title: "未在播放",
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
              name: item.album?.name || item.album?.title || "未命名",
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
        const storedPlayMode =
          (await AsyncStorage.getItem(PLAYBACK_MODE_KEY)) ??
          (await AsyncStorage.getItem(LEGACY_PLAY_MODE_KEY));
        if (storedPlayMode) {
          if (storedPlayMode === "SINGLE_ONCE") {
            setPlayMode(PlayMode.SEQUENCE);
          } else if (Object.values(PlayMode).includes(storedPlayMode as PlayMode)) {
            setPlayMode(storedPlayMode as PlayMode);
          }
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
          playNext();
        }
      }
      if (event.type === Event.PlaybackState) {
        setIsPlaying(event.state === State.Playing);
        setIsLoading(
          event.state === State.Buffering || event.state === State.Loading
        );
        await syncMediaControlCenterState();
      }
      if (event.type === Event.PlaybackActiveTrackChanged) {
        // ✨ 当切歌发生（无论是手动还是自动播放下一首）
        if (event.index !== undefined) {
          const queueTrack = await TrackPlayer.getTrack(event.index);
          const nextTrack =
            trackListRef.current.find(
              (track) => String(track.id) === String((queueTrack as any)?.id)
            ) || trackListRef.current[event.index];
          if (!nextTrack) return;

          console.log(`[Player] Active track changed to index ${event.index}: ${nextTrack.name}`);
          
          setCurrentTrack(nextTrack);
          isSkippingOutroRef.current = false;

          // ✨ 智能预缓存：当当前歌曲开始播放时，自动触发下一首的后台下载
          const currentListIndex = trackListRef.current.findIndex((t) => t.id === nextTrack.id);
          const nextIndexForCache = currentListIndex + 1;
          if (nextIndexForCache < trackListRef.current.length) {
              const preCacheTrack = trackListRef.current[nextIndexForCache];
              console.log(`[Player] Pre-caching next song: ${preCacheTrack.name}`);
              resolveTrackUri(preCacheTrack, { cacheEnabled, shouldDownload: true }).catch(() => {});
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

    await TrackPlayer.updateOptions({
      capabilities,
      compactCapabilities,
      // @ts-ignore
      jumpForwardInterval: 15,
      // @ts-ignore
      jumpBackwardInterval: 15,
      // ✨ 优化：缩短进度更新间隔以提高片尾跳过精度
      progressUpdateEventInterval: 1,
      android: {
        appKilledPlaybackBehavior:
          AppKilledPlaybackBehavior.ContinuePlayback,
      },
    } as any);
  };

  const playNext = async () => {
    if (isRadioModeRef.current) {
      try {
        let res = await getRecommendedTracks(TrackType.MUSIC, 1, recommendationLikeRatio);
        
        // If random track is the same as current, try one more time
        if (res.code === 200 && res.data && res.data[0]?.id === currentTrackRef.current?.id) {
            res = await getRecommendedTracks(TrackType.MUSIC, 1, recommendationLikeRatio);
        }

        if (res.code === 200 && res.data && res.data.length > 0) {
          await playTrack(res.data[0], undefined, true);
        }
      } catch (e) {
        console.error("Radio playNext failed", e);
      }
      return;
    }

    const list = trackListRef.current;
    if (playModeRef.current === PlayMode.LOOP_SINGLE) {
      await seekTo(0);
      return;
    }
    
    // 非随机模式下，优先使用原生队列切歌，减少重建队列开销
    const queue = await TrackPlayer.getQueue();
    if (playModeRef.current !== PlayMode.SHUFFLE && queue.length > 1) {
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
    playModeRef.current = nextMode;
    setPlayMode(nextMode);
    await AsyncStorage.setItem(PLAYBACK_MODE_KEY, nextMode);
    if (nextMode === PlayMode.SHUFFLE && currentTrackRef.current) {
      await playTrack(currentTrackRef.current, undefined, false, true);
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
      playMode: playModeRef.current,
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

  const loadPlaybackState = async (targetMode: string) => {
    if (!isSetup) return;
    try {
      const saved = await AsyncStorage.getItem(`playbackState_${targetMode}`);
      if (saved) {
        const state = JSON.parse(saved);
        setTrackList(state.trackList);
        setPlayMode(state.playMode);
        if (state.playbackRate) {
          setPlaybackRateState(state.playbackRate);
        }
        if (state.currentTrack) {
          const savedList = Array.isArray(state.trackList) ? state.trackList : [];
          const list = savedList.length > 0 ? savedList : [state.currentTrack];
          const activeIndex = Math.max(
            0,
            list.findIndex((t: Track) => t.id === state.currentTrack.id)
          );

          const shouldUseSingleTrackQueue = state.playMode === PlayMode.SHUFFLE;
          if (shouldUseSingleTrackQueue) {
            const activeTrack = list[activeIndex];
            const uri = await resolveTrackUri(activeTrack, {
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

          await updatePlayerCapabilities(list[activeIndex]);
          setCurrentTrack(list[activeIndex]);
        }
      } else {
        setCurrentTrack(null);
        setTrackList([]);
        await TrackPlayer.reset();
      }
    } catch (e) {
      console.error("Failed to load playback state", e);
    }
  };

  useEffect(() => {
    if (!isSetup || isAuthLoading) return;
    const handleModeChange = async () => {
      if (isInitialLoadRef.current) {
        await loadPlaybackState(mode);
        isInitialLoadRef.current = false;
        prevModeRef.current = mode;
      } else if (prevModeRef.current !== mode) {
        if (skipNextModeRestoreRef.current) {
          skipNextModeRestoreRef.current = false;
          prevModeRef.current = mode;
          return;
        }
        await savePlaybackState(prevModeRef.current);
        await loadPlaybackState(mode);
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
    forceReload = false
  ) => {
    if (!isSetup) return;
    if (!fromRadio) {
      setIsRadioMode(false);
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

      const playUri = await resolveTrackUri(track, { cacheEnabled });
      const artwork = await resolveArtworkUriForPlayer(track, {
        shouldDownload: true,
      });

      console.log("Playing track:", track.id, "URI:", playUri);

      const trackData: any = {
        id: String(track.id),
        url: playUri,
        title: track.name,
        artist: track.artist,
        album: track.album || "Unknown Album",
        artwork: artwork,
        duration: track.duration || 0,
        type: track.type, // ✨ 传递类型
      };

      // ✨ 优化：使用“先加后跳再删”逻辑，防止 reset 导致音频焦点丢失和通知栏闪烁
      const queue = await TrackPlayer.getQueue();
      if (queue.length > 0) {
        await TrackPlayer.add(trackData);
        await TrackPlayer.skip(queue.length);
        // 延迟移除旧歌曲（不使用 await 以免阻塞后续播放逻辑）
        TrackPlayer.remove(Array.from({ length: queue.length }, (_, i) => i)).catch(() => {});
      } else {
        await TrackPlayer.add(trackData);
      }

      await updatePlayerCapabilities(track);

      // ✨ 处理初始位置 & 自动跳过片头
      let startPos = 0;

      // 优先级：显式指定的 initialPosition (恢复进度) > 自动跳过设置
      if (initialPosition !== undefined) {
        startPos = initialPosition;
      } else if (
        skipIntroDuration > 0 &&
        track.type === TrackType.AUDIOBOOK // 仅有声书生效
      ) {
        console.log(`[AutoSkip] Skipping intro: ${skipIntroDuration}s`);
        startPos = skipIntroDuration;
      }

      if (startPos > 0) {
        await TrackPlayer.seekTo(startPos);
      }

      await TrackPlayer.play();
      setCurrentTrack(track);
      savePlaybackState(mode);
    } catch (error) {
      console.error("Failed to play track:", error);
    }
  };

  const playTrackList = async (tracks: Track[], index: number, initialPosition?: number) => {
    setIsRadioMode(false);
    setTrackList(tracks);
    const shouldUseSingleTrackQueue = playModeRef.current === PlayMode.SHUFFLE;
    if (shouldUseSingleTrackQueue) {
      const track = tracks[index];
      const uri = await resolveTrackUri(track, {
        cacheEnabled,
        shouldDownload: true,
      });
      const artwork = await resolveArtworkUriForPlayer(track, {
        shouldDownload: true,
      });
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
      await TrackPlayer.skip(0);
    } else {
      // ✨ 核心改进：预加载整个列表进入原生队列，但仅触发当前和下一首的下载
      const playerTracks = await Promise.all(tracks.map(async (t, i) => {
          // 核心优化：仅当前曲目 (index) 和下一首 (index + 1) 会触发耗时的缓存检查和预下载
          // 其他歌曲使用 fast 模式直接返回远程 URL，稍后真正切到它们时再由 resolveTrackUri 处理缓存
          const isNearCurrent = (i === index || i === index + 1);
          const uri = await resolveTrackUri(t, { 
              cacheEnabled, 
              shouldDownload: isNearCurrent,
              fast: !isNearCurrent 
          });
          const artwork = await resolveArtworkUriForPlayer(t, {
            shouldDownload: isNearCurrent,
            fast: !isNearCurrent,
          });
          return {
            id: String(t.id),
            url: uri,
            title: t.name,
            artist: t.artist,
            album: t.album || "Unknown Album",
            artwork: artwork,
            duration: t.duration || 0,
            // ✨ 附加自定义字段，方便背景服务识别
            type: t.type 
          } as any;
      }));

      await TrackPlayer.setQueue(playerTracks);
      await TrackPlayer.skip(index);
    }
    
    if (initialPosition !== undefined) {
      await TrackPlayer.seekTo(initialPosition);
    } else if (tracks[index].type === TrackType.AUDIOBOOK && skipIntroDuration > 0) {
      await TrackPlayer.seekTo(skipIntroDuration);
    }

    await TrackPlayer.play();
    setCurrentTrack(tracks[index]);
    savePlaybackState(mode);
  };

  const startRadioMode = async () => {
    setIsRadioMode(true);
    // Fetch a random track and start playing
    try {
      const res = await getRecommendedTracks(TrackType.MUSIC, 1, recommendationLikeRatio);
      if (res.code === 200 && res.data && res.data.length > 0) {
        await playTrack(res.data[0], undefined, true);
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
    Alert.alert("结束同步播放", "确定要断开连接吗？", [
      {
        text: "取消",
        style: "cancel",
      },
      {
        text: "确定",
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
              setTrackList(payload.data);
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
          setTrackList(lastAcceptedInvite.playlist);
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
      Alert.alert("同步状态", "同步播放已结束");
      setSynced(false, null);
      setParticipants([]);
      console.log("Sync session ended");
    };
    const handlePlayerLeft = (payload: {
      username: string;
      deviceName: string;
    }) => {
      Alert.alert(
        "同步状态",
        `${payload.username} (${payload.deviceName}) 已断开同步连接`
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
                title: "继续播放",
                description: `发现在设备 ${history.deviceName} 上的播放记录，是否从 ${m}:${s} 继续播放？`,
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
        // ✨ Exports
        skipIntroDuration,
        setSkipIntroDuration,
        skipOutroDuration,
        setSkipOutroDuration,
        isRadioMode,
        startRadioMode,
        reset: () => TrackPlayer.reset()
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};
