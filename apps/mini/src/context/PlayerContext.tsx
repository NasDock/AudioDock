import { Album, Artist, Playlist, TrackType, UserAudiobookHistory, UserAudiobookLike, UserTrackHistory, UserTrackLike } from '@soundx/services';
import Taro from '@tarojs/taro';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getBaseURL } from '../utils/request';
import { getImageUrl } from '../utils/image';
import { useSettings } from './SettingsContext';
import { getCurrentPlaybackQualityPreference } from '../utils/playbackQuality';
import {
  AudioQuality,
  AudioQualityOption,
  buildTrackPlaybackUrl,
  getTrackAudioQualityProfile,
  resolveTrackAudioQuality,
} from '../services/trackQuality';

export enum PlayMode {
  SEQUENCE = 'SEQUENCE',
  LOOP_LIST = 'LOOP_LIST',
  SHUFFLE = 'SHUFFLE',
  LOOP_SINGLE = 'LOOP_SINGLE',
}

const PLAYBACK_MODE_KEY = 'playerPlaybackMode';
const PLAYBACK_RATE_KEY = 'playerPlaybackRate';
const SKIP_INTRO_KEY = 'skipIntroDuration';
const SKIP_OUTRO_KEY = 'skipOutroDuration';

// Simplified Track interface for MP
export interface Track {
  id: number;
  name: string;
  path: string;
  artist: string;
  artistEntity: Artist;
  album: string;
  albumEntity: Album;
  cover: string | null;
  duration: number | null;
  lyrics: string | null;
  index: number | null;
  type: TrackType;
  createdAt: string | Date; // DateTime in Prisma maps to Date object or ISO string in JSON
  artistId?: number;
  albumId?: number;
  folderId?: number;
  likedByUsers?: UserTrackLike[];
  listenedByUsers?: UserTrackHistory[];
  likedAsAudiobookByUsers?: UserAudiobookLike[];
  listenedAsAudiobookByUsers?: UserAudiobookHistory[];
  playlists?: Playlist[];
  progress?: number;
}

interface PlayerContextType {
  isPlaying: boolean;
  currentTrack: Track | null;
  trackList: Track[];
  isLoading: boolean;
  playTrack: (track: Track, initialPosition?: number, preferredQuality?: AudioQuality) => Promise<void>;
  pause: () => void;
  resume: () => void;
  playNext: () => void;
  playPrevious: () => void;
  duration: number;
  currentTime: number;
  seek: (position: number) => void;
  setTrackList: (list: Track[]) => void;
  playTrackList: (list: Track[], index: number, initialPosition?: number) => Promise<void>;
  playMode: PlayMode;
  togglePlayMode: () => void;
  showPlaylist: boolean;
  setShowPlaylist: (show: boolean) => void;
  sleepTimer: number | null;
  setSleepTimer: (minutes: number) => void;
  clearSleepTimer: () => void;
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  currentAudioQuality: AudioQuality;
  availableAudioQualities: AudioQualityOption[];
  cycleAudioQuality: () => Promise<void>;
  skipIntroDuration: number;
  setSkipIntroDuration: (seconds: number) => void;
  skipOutroDuration: number;
  setSkipOutroDuration: (seconds: number) => void;
}

const PlayerContext = createContext<PlayerContextType>({
  isPlaying: false,
  currentTrack: null,
  trackList: [],
  isLoading: false,
  duration: 0,
  currentTime: 0,
  playTrack: async () => {},
  pause: () => {},
  resume: () => {},
  playNext: () => {},
  playPrevious: () => {},
  seek: () => {},
  setTrackList: () => {},
  playTrackList: async () => {},
  playMode: PlayMode.SEQUENCE,
  togglePlayMode: () => {},
  showPlaylist: false,
  setShowPlaylist: () => {},
  sleepTimer: null,
  setSleepTimer: () => {},
  clearSleepTimer: () => {},
  playbackRate: 1,
  setPlaybackRate: () => {},
  currentAudioQuality: 'lossless',
  availableAudioQualities: [],
  cycleAudioQuality: async () => {},
  skipIntroDuration: 0,
  setSkipIntroDuration: () => {},
  skipOutroDuration: 0,
  setSkipOutroDuration: () => {},
});

export const usePlayer = () => useContext(PlayerContext);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { externalPlaybackQuality } = useSettings();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [trackList, setTrackListState] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [playMode, setPlayMode] = useState<PlayMode>(PlayMode.SEQUENCE);
  const [sleepTimer, setSleepTimerState] = useState<number | null>(null);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [currentAudioQuality, setCurrentAudioQuality] = useState<AudioQuality>('lossless');
  const [preferredAudioQuality, setPreferredAudioQuality] = useState<AudioQuality>('lossless');
  const [availableAudioQualities, setAvailableAudioQualities] = useState<AudioQualityOption[]>([]);
  const [skipIntroDuration, setSkipIntroDurationState] = useState(0);
  const [skipOutroDuration, setSkipOutroDurationState] = useState(0);
  const isSkippingOutroRef = useRef(false);
  const playRequestIdRef = useRef(0);
  const isPlayRequestPendingRef = useRef(false);

  const setTrackList = (list: Track[]) => {
      setTrackListState(list);
  };

  
  // Use BackgroundAudioManager
  const bgAudioManager = useRef<Taro.BackgroundAudioManager | null>(null);

  useEffect(() => {
    bgAudioManager.current = Taro.getBackgroundAudioManager();
    const manager = bgAudioManager.current;

    manager.onPlay(() => {
      setIsPlaying(true);
      setIsLoading(false);
    });

    manager.onPause(() => {
      setIsPlaying(false);
    });

    manager.onStop(() => {
      setIsPlaying(false);
    });

    manager.onEnded(() => {
      if (isPlayRequestPendingRef.current) return;
      playNext();
    });

    manager.onError(() => {
      console.error('Background Audio Error');
      setIsPlaying(false);
      setIsLoading(false);
    });
    
    manager.onTimeUpdate(() => {
        if (manager.duration) setDuration(manager.duration);
        setCurrentTime(manager.currentTime);
    });

    // Remote control events
    manager.onNext(() => {
        playNext();
    });
    manager.onPrev(() => {
        playPrevious();
    });
    // Sync external seek if any
    manager.onSeeked(() => {
        setCurrentTime(manager.currentTime);
    });

    return () => {
      // Cleanup if needed? Usually background audio should persist
    };
  }, []); // Empty dependency array? Need to access current state in callbacks? 
  // Callbacks in Taro Audio Manager might be tricky with closures. 
  // Using refs for state in callbacks is safer.

  const trackListRef = useRef(trackList);
  const currentTrackRef = useRef(currentTrack);
  const playModeRef = useRef(playMode);
  const skipIntroDurationRef = useRef(skipIntroDuration);
  const skipOutroDurationRef = useRef(skipOutroDuration);
  const playbackRateRef = useRef(playbackRate);
  const currentAudioQualityRef = useRef<AudioQuality>('lossless');
  const preferredAudioQualityRef = useRef<AudioQuality>('lossless');

  useEffect(() => {
    trackListRef.current = trackList;
  }, [trackList]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    playModeRef.current = playMode;
  }, [playMode]);

  useEffect(() => {
    skipIntroDurationRef.current = skipIntroDuration;
  }, [skipIntroDuration]);

  useEffect(() => {
    skipOutroDurationRef.current = skipOutroDuration;
  }, [skipOutroDuration]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    currentAudioQualityRef.current = currentAudioQuality;
  }, [currentAudioQuality]);

  useEffect(() => {
    preferredAudioQualityRef.current = preferredAudioQuality;
  }, [preferredAudioQuality]);

  useEffect(() => {
    const nextQuality = getCurrentPlaybackQualityPreference({ externalPlaybackQuality });
    setPreferredAudioQuality(nextQuality);
    preferredAudioQualityRef.current = nextQuality;
  }, [externalPlaybackQuality]);

  useEffect(() => {
    let cancelled = false;

    const syncCurrentTrackQuality = async () => {
      if (!currentTrack || currentTrack.type === 'AUDIOBOOK') {
        if (!cancelled) {
          setAvailableAudioQualities([]);
          setCurrentAudioQuality('lossless');
        }
        return;
      }

      const profile = await getTrackAudioQualityProfile(currentTrack);
      if (cancelled) return;
      setAvailableAudioQualities(profile.options);
      setCurrentAudioQuality(
        resolveTrackAudioQuality(
          profile,
          getCurrentPlaybackQualityPreference({ externalPlaybackQuality }),
        ),
      );
    };

    syncCurrentTrackQuality();

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id, currentTrack?.type, externalPlaybackQuality]);

  useEffect(() => {
    try {
      const storedMode = Taro.getStorageSync(PLAYBACK_MODE_KEY);
      if (Object.values(PlayMode).includes(storedMode as PlayMode)) {
        setPlayMode(storedMode as PlayMode);
      }

      const storedRate = parseFloat(Taro.getStorageSync(PLAYBACK_RATE_KEY));
      if (!Number.isNaN(storedRate) && storedRate > 0) {
        setPlaybackRateState(storedRate);
      }

      const storedIntro = parseInt(Taro.getStorageSync(SKIP_INTRO_KEY), 10);
      if (!Number.isNaN(storedIntro) && storedIntro >= 0) {
        setSkipIntroDurationState(storedIntro);
      }

      const storedOutro = parseInt(Taro.getStorageSync(SKIP_OUTRO_KEY), 10);
      if (!Number.isNaN(storedOutro) && storedOutro >= 0) {
        setSkipOutroDurationState(storedOutro);
      }
    } catch (error) {
      console.error('Failed to load player preferences:', error);
    }
  }, []);

  useEffect(() => {
    if (!sleepTimer || !isPlaying) return;
    const timer = setInterval(() => {
      if (Date.now() >= sleepTimer) {
        pause();
        setSleepTimerState(null);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [sleepTimer, isPlaying]);

  const getRandomIndex = (listLength: number, excludeIndex: number) => {
    if (listLength <= 1) return listLength === 1 ? 0 : -1;
    let randomIndex = Math.floor(Math.random() * listLength);
    if (randomIndex === excludeIndex) {
      randomIndex = (randomIndex + 1) % listLength;
    }
    return randomIndex;
  };

  const getNextIndex = (currentIndex: number, mode: PlayMode, list: Track[]) => {
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

  const getPreviousIndex = (currentIndex: number, mode: PlayMode, list: Track[]) => {
    if (list.length === 0) return -1;
    if (mode === PlayMode.SHUFFLE) {
      return getRandomIndex(list.length, currentIndex);
    }
    if (mode === PlayMode.LOOP_SINGLE) return currentIndex;
    if (currentIndex > 0) return currentIndex - 1;
    return list.length - 1;
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

  const applyStartPosition = (position: number, requestId: number) => {
    if (position <= 0) return;
    setTimeout(() => {
      if (requestId !== playRequestIdRef.current) return;

      try {
        bgAudioManager.current?.seek(position);
      } catch (error) {
        console.error('Failed to seek to start position:', error);
      }
    }, 250);
  };

  const prepareAudioQuality = async (
    track: Track,
    preferredQuality?: AudioQuality,
  ): Promise<{ selectedQuality: AudioQuality; options: AudioQualityOption[] }> => {
    if (track.type === 'AUDIOBOOK') {
      return { selectedQuality: 'lossless', options: [] };
    }

    const profile = await getTrackAudioQualityProfile(track);
    const selectedQuality = resolveTrackAudioQuality(
      profile,
      preferredQuality ??
        getCurrentPlaybackQualityPreference({ externalPlaybackQuality }),
    );

    return { selectedQuality, options: profile.options };
  };


  const playTrack = async (track: Track, initialPosition?: number, preferredQuality?: AudioQuality) => {
    const requestId = playRequestIdRef.current + 1;
    playRequestIdRef.current = requestId;
    isPlayRequestPendingRef.current = true;
    setIsLoading(true);
    isSkippingOutroRef.current = false;
    if (preferredQuality) {
      setPreferredAudioQuality(preferredQuality);
    }

    try {
      const baseUrl = getBaseURL();

      // Pick the quality synchronously so playback can start immediately.
      // The async profile fetch runs in the background via the
      // `syncCurrentTrackQuality` effect and only swaps the URI when the
      // server offers a different bitrate than the user's preference.
      const initialQuality: AudioQuality =
        preferredQuality ??
        getCurrentPlaybackQualityPreference({ externalPlaybackQuality }) ??
        'lossless';

      const uri =
        track.type === 'AUDIOBOOK'
          ? buildTrackPlaybackUrl(track, initialQuality)
          : buildTrackPlaybackUrl(track, initialQuality);
      if (requestId !== playRequestIdRef.current) return;
      // 通知栏/后台播控封面，走小图档（128 恒压缩）——避免加载 5MB 原图
      const cover = track.cover ? getImageUrl(track.cover, undefined, 128) : undefined;

      const manager = bgAudioManager.current;
      if (manager) {
        manager.title = track.name;
        manager.epname = track.album || track.name;
        manager.singer = track.artist;
        manager.coverImgUrl = cover || '';
        try {
          (manager as any).playbackRate = playbackRateRef.current;
        } catch (error) {
          console.error('Failed to apply playback rate:', error);
        }
        // Setting src starts playback automatically. Do not await anything
        // before this line — every millisecond of waiting is audible latency
        // for the user.
        manager.src = uri;
        currentTrackRef.current = track;
        setCurrentTrack(track);
        setCurrentTime(0);
        setDuration(track.duration ?? 0);
        setAvailableAudioQualities([]);
        setCurrentAudioQuality(initialQuality);
        const startPosition = initialPosition !== undefined
          ? initialPosition
          : (track.type === 'AUDIOBOOK' ? skipIntroDurationRef.current : 0);
        applyStartPosition(startPosition, requestId);
      }

      // Fire-and-forget the profile fetch so the quality switcher reflects
      // the server's actual options without delaying the play click.
      if (track.type !== 'AUDIOBOOK' && requestId === playRequestIdRef.current) {
        prepareAudioQuality(track, initialQuality)
          .then(({ selectedQuality, options }) => {
            if (requestId !== playRequestIdRef.current) return;
            setAvailableAudioQualities(options);
            setCurrentAudioQuality((prev) =>
              prev === selectedQuality ? prev : selectedQuality
            );
          })
          .catch(() => {
            /* keep initial quality on error */
          });
      }
    } catch (error) {
      if (requestId === playRequestIdRef.current) {
        console.error('Failed to play track:', error);
        setIsLoading(false);
      }
    } finally {
      if (requestId === playRequestIdRef.current) {
        isPlayRequestPendingRef.current = false;
      }
    }
  };

  const pause = () => {
    bgAudioManager.current?.pause();
  };

  const resume = () => {
    bgAudioManager.current?.play();
  };

  const playNext = () => {
    const list = trackListRef.current;
    const current = currentTrackRef.current;
    if (!current || list.length === 0) return;

    if (playModeRef.current === PlayMode.LOOP_SINGLE) {
      seek(0);
      resume();
      return;
    }

    const currentIndex = list.findIndex(t => t.id === current.id);
    if (currentIndex === -1) return;
    const nextIndex = getNextIndex(currentIndex, playModeRef.current, list);
    if (nextIndex !== -1) {
      playTrack(list[nextIndex]);
    } else {
      pause();
    }
  };

  const playPrevious = () => {
    const list = trackListRef.current;
    const current = currentTrackRef.current;
    if (!current || list.length === 0) return;

    const currentIndex = list.findIndex(t => t.id === current.id);
    if (currentIndex === -1) return;
    const prevIndex = getPreviousIndex(currentIndex, playModeRef.current, list);
    if (prevIndex !== -1) {
      playTrack(list[prevIndex]);
    }
  };

  const seek = (position: number) => {
      bgAudioManager.current?.seek(position);
  };

  const playTrackList = async (list: Track[], index: number, initialPosition?: number) => {
    setTrackList(list);
    if (list[index]) {
      await playTrack(list[index], initialPosition);
    }
  };

  const togglePlayMode = () => {
    const nextMode = getNextPlayMode(playModeRef.current);
    setPlayMode(nextMode);
    try {
      Taro.setStorageSync(PLAYBACK_MODE_KEY, nextMode);
    } catch (error) {
      console.error('Failed to save playback mode:', error);
    }
  };

  const setSleepTimer = (minutes: number) => {
    setSleepTimerState(Date.now() + minutes * 60 * 1000);
  };

  const clearSleepTimer = () => {
    setSleepTimerState(null);
  };

  const cycleAudioQuality = async () => {
    if (
      !currentTrackRef.current ||
      currentTrackRef.current.type === 'AUDIOBOOK' ||
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
    await playTrack(currentTrackRef.current, currentTime, nextOption.quality);
  };

  const setPlaybackRate = (rate: number) => {
    const manager = bgAudioManager.current;
    try {
      if (manager) {
        (manager as any).playbackRate = rate;
      }
    } catch (error) {
      console.error('Failed to set playback rate:', error);
    }
    setPlaybackRateState(rate);
    try {
      Taro.setStorageSync(PLAYBACK_RATE_KEY, String(rate));
    } catch (error) {
      console.error('Failed to save playback rate:', error);
    }
  };

  const setSkipIntroDuration = (seconds: number) => {
    setSkipIntroDurationState(seconds);
    try {
      Taro.setStorageSync(SKIP_INTRO_KEY, String(seconds));
    } catch (error) {
      console.error('Failed to save skip intro duration:', error);
    }
  };

  const setSkipOutroDuration = (seconds: number) => {
    setSkipOutroDurationState(seconds);
    try {
      Taro.setStorageSync(SKIP_OUTRO_KEY, String(seconds));
    } catch (error) {
      console.error('Failed to save skip outro duration:', error);
    }
  };

  useEffect(() => {
    if (
      !currentTrack ||
      currentTrack.type !== 'AUDIOBOOK' ||
      skipOutroDurationRef.current <= 0 ||
      !duration ||
      !isPlaying ||
      isSkippingOutroRef.current
    ) {
      return;
    }

    const remaining = duration - currentTime;
    if (remaining <= skipOutroDurationRef.current && remaining >= 0) {
      isSkippingOutroRef.current = true;
      playNext();
    }
  }, [currentTime, duration, currentTrack, isPlaying]);

  return (
    <PlayerContext.Provider
      value={{
        isPlaying,
        currentTrack,
        trackList,
        isLoading,
        duration,
        currentTime,
        playTrack,
        pause,
        resume,
        playNext,
        playPrevious,
        seek,
        setTrackList,
        playTrackList,
        playMode,
        togglePlayMode,
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
        skipIntroDuration,
        setSkipIntroDuration,
        skipOutroDuration,
        setSkipOutroDuration,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};
