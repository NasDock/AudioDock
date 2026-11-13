import { getFavoriteTracks, getMvByTrackId, toggleTrackLike, toggleTrackUnLike, transferSession, type Device as OnlineDevice, type MiDevice, playMiDeviceByUrl } from '@soundx/services';
import { Image, ScrollView, Slider, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AddToPlaylistModal from '../../components/AddToPlaylistModal';
import MiDeviceSelector from '../../components/MiDeviceSelector';
import PlaylistModal from '../../components/PlaylistModal';
import XiaoAiIcon from '../../components/XiaoAiIcon';
import { useAuth } from '../../context/AuthContext';
import { PlayMode, usePlayer } from '../../context/PlayerContext';
import { usePlayMode } from '../../utils/playMode';
import { getImageUrl as buildImageUrl } from '../../utils/image';
import { isMvSupported } from '../../utils/mvSupport';
import { getBaseURL } from '../../utils/request';
import { trackEvent } from '../../utils/tracking';
import './index.scss';

// Match mobile lyric line interface
interface LyricLine {
  time: number;
  text: string;
}

/** 歌词行在滚动内容坐标系里的位置（px） */
interface LyricLayout {
  y: number;
  height: number;
}

/** 手动滚动停止后，多久没点播放就回到当前播放行 */
const LYRIC_IDLE_TIMEOUT_MS = 2000;
/** scroll-into-view 平滑动画期间屏蔽「用户滚动」误判 */
const LYRIC_SCROLL_GUARD_MS = 1000;

const resolveActiveLyricIndex = (lines: LyricLine[], time: number): number => {
  if (lines.length === 0) return -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time <= time && (i === lines.length - 1 || lines[i + 1].time > time)) {
      return i;
    }
  }
  return 0;
};

const formatLyricTime = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

// Match mobile parseLyrics logic
const parseLyrics = (lyrics: string): LyricLine[] => {
  if (!lyrics) return [];

  const lines = lyrics.split('\n');
  const parsed: LyricLine[] = [];

  for (const line of lines) {
    const match = line.match(/\[(\d+):(\d+)(?:\.(\d+))?\](.*)/);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const milliseconds = match[3] ? parseInt(match[3]) : 0;
      const time = minutes * 60 + seconds + milliseconds / 1000;
      const text = match[4].trim();

      if (text) {
        parsed.push({ time, text });
      }
    } else if (line.trim() && !line.startsWith('[')) {
      parsed.push({ time: 0, text: line.trim() });
    }
  }

  return parsed.sort((a, b) => a.time - b.time);
};

export default function Player() {
  const { t } = useTranslation();
  const {
    currentTrack,
    isPlaying,
    pause,
    resume,
    playNext,
    playPrevious,
    duration,
    currentTime,
    buffered,
    seek,
    trackList,
    setShowPlaylist,
    playMode,
    togglePlayMode,
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
  } = usePlayer();
  const { mode } = usePlayMode();
  const { user } = useAuth();
  const mvSupported = isMvSupported();
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [liked, setLiked] = useState(false);

  // 歌词手动滚动接管：ref 供原生滚动回调/定时器同步读取，state 只驱动操作条显隐
  const [lyricInteracting, setLyricInteracting] = useState(false);
  const [lyricCenteredIndex, setLyricCenteredIndex] = useState(-1);
  const [lyricAnchor, setLyricAnchor] = useState('');
  const lyricInteractingRef = useRef(false);
  const lyricAutoScrollingRef = useRef(false);
  const lyricIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lyricAnchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lyricGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lyricLayoutsRef = useRef<LyricLayout[]>([]);
  const lyricContainerHRef = useRef(0);
  const lyricScrollTopRef = useRef(0);
  const lyricAutoKeyRef = useRef('');
  const lyricSeekPlayAtRef = useRef(0);
  const [hasMv, setHasMv] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [showSleepTimerModal, setShowSleepTimerModal] = useState(false);
  const [lyricFontSize, setLyricFontSize] = useState(32);
  const [showLyricsFontModal, setShowLyricsFontModal] = useState(false);
  const [showSkipConfigModal, setShowSkipConfigModal] = useState(false);
  const [skipConfigType, setSkipConfigType] = useState<'intro' | 'outro'>('intro');
  const [tempSkipTime, setTempSkipTime] = useState(30);
  const [isMiDeviceSelectorVisible, setIsMiDeviceSelectorVisible] = useState(false);
  const [isCastingToMi, setIsCastingToMi] = useState(false);

  useEffect(() => {
    if (currentTrack && currentTrack.lyrics) {
        setLyrics(parseLyrics(currentTrack.lyrics));
    } else {
        setLyrics([]);
    }
  }, [currentTrack]);

  useEffect(() => {
    let cancelled = false;

    const checkMvStatus = async () => {
      // 飞牛音乐没有 MV 能力，直接跳过探测请求
      if (!mvSupported || !currentTrack || currentTrack.type === 'AUDIOBOOK') {
        if (!cancelled) setHasMv(false);
        return;
      }

      try {
        const mv = await getMvByTrackId(Number(currentTrack.id));
        if (!cancelled) {
          setHasMv(!!mv);
        }
      } catch (error) {
        if (!cancelled) {
          setHasMv(false);
        }
      }
    };

    checkMvStatus();

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id, currentTrack?.type, mvSupported]);

  // 当前播放行：position 落在 [line[i].time, line[i+1].time) 区间
  const currentLyricIndex = useMemo(
    () => resolveActiveLyricIndex(lyrics, currentTime),
    [lyrics, currentTime],
  );

  // 定时器 / 原生 scroll 回调里必须拿最新值，不能依赖创建时的闭包快照
  const lyricsRef = useRef(lyrics);
  lyricsRef.current = lyrics;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const trackIdRef = useRef(currentTrack?.id);
  trackIdRef.current = currentTrack?.id;

  const clearLyricIdleTimer = useCallback(() => {
    if (lyricIdleTimerRef.current) {
      clearTimeout(lyricIdleTimerRef.current);
      lyricIdleTimerRef.current = null;
    }
  }, []);

  /**
   * 把目标行滚到视口中心。小程序 scroll-into-view 是「值变化才触发」的受控属性，
   * 同值不会重新滚动，因此必须先清空、下一 tick 再设回（仓库既有模式）。
   */
  const scrollToLyricLine = useCallback((index: number) => {
    const target = `line-${Math.max(0, index)}`;
    lyricAutoScrollingRef.current = true;
    if (lyricGuardTimerRef.current) clearTimeout(lyricGuardTimerRef.current);
    lyricGuardTimerRef.current = setTimeout(() => {
      lyricAutoScrollingRef.current = false;
      lyricGuardTimerRef.current = null;
    }, LYRIC_SCROLL_GUARD_MS);

    setLyricAnchor('');
    if (lyricAnchorTimerRef.current) clearTimeout(lyricAnchorTimerRef.current);
    lyricAnchorTimerRef.current = setTimeout(() => {
      lyricAnchorTimerRef.current = null;
      setLyricAnchor(target);
    }, 30);
  }, []);

  /**
   * 小程序没有 RN 的 onLayout：启动时用 createSelectorQuery 实测每行在内容坐标系
   * 里的 y/height（boundingClientRect.top + 当时的 scrollTop），实测未就绪时
   * 按 rpx 估算行高兜底，避免为固定行高而截断长歌词。
   */
  const measureLyricLayout = useCallback(() => {
    if (!showLyrics || lyrics.length === 0) return;
    Taro.nextTick(() => {
      const query = Taro.createSelectorQuery();
      query.select('.player-lyrics-scroll').boundingClientRect();
      query.select('.player-lyrics-scroll').scrollOffset();
      query.selectAll('.player-lyric-line').boundingClientRect();
      query.exec((res: any) => {
        const container = Array.isArray(res) ? res[0] : undefined;
        const offset = Array.isArray(res) ? res[1] : undefined;
        const rects = Array.isArray(res) ? res[2] : undefined;
        if (container && typeof container.height === 'number') {
          lyricContainerHRef.current = container.height;
        }
        if (Array.isArray(rects) && rects.length === lyricsRef.current.length) {
          const base = offset && typeof offset.scrollTop === 'number' ? offset.scrollTop : 0;
          lyricLayoutsRef.current = rects.map((r: any) => ({
            y: (r.top || 0) + base,
            height: r.height || 0,
          }));
        }
      });
    });
  }, [showLyrics, lyrics.length]);

  useEffect(() => {
    if (!showLyrics || lyrics.length === 0) return;
    measureLyricLayout();
    // 字号 / 排版稳定后再测一次，避免首帧拿到旧布局
    const timer = setTimeout(measureLyricLayout, 200);
    return () => clearTimeout(timer);
  }, [showLyrics, lyrics.length, lyricFontSize, measureLyricLayout]);

  /** 视口垂直中心落在哪一行 */
  const findLyricCenteredIndex = useCallback((scrollTop: number): number => {
    const list = lyricsRef.current;
    if (list.length === 0) return -1;
    const layouts = lyricLayoutsRef.current;
    const measured = lyricContainerHRef.current > 0 && layouts.length === list.length;
    let containerH = lyricContainerHRef.current;
    let rowH = 0;
    if (!measured) {
      const sys = Taro.getSystemInfoSync();
      const pxPerRpx = sys.windowWidth / 750;
      rowH = (lyricFontSize * 1.4 + 40) * pxPerRpx;
      containerH = Math.max(1, sys.windowHeight - 600 * pxPerRpx);
    }
    const targetY = scrollTop + containerH / 2;
    let nearest = -1;
    let nearestDistance = Infinity;
    for (let i = 0; i < list.length; i += 1) {
      const layout = layouts[i];
      const y = layout ? layout.y : i * rowH;
      const h = layout ? layout.height : rowH;
      if (h <= 0) continue;
      if (targetY >= y && targetY < y + h) return i;
      const distance = Math.abs(y + h / 2 - targetY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    }
    return nearest;
  }, [lyricFontSize]);

  // 自动跟随：只在「换行的那一刻」滚一次；手动接管期间完全让位
  useEffect(() => {
    if (!showLyrics || lyrics.length === 0 || currentLyricIndex < 0) return;
    if (lyricInteractingRef.current) return;
    const key = `${trackIdRef.current ?? ''}|${currentLyricIndex}|${lyricFontSize}`;
    if (lyricAutoKeyRef.current === key) return;
    lyricAutoKeyRef.current = key;
    scrollToLyricLine(currentLyricIndex);
  }, [showLyrics, lyrics.length, currentLyricIndex, lyricFontSize, scrollToLyricLine]);

  /**
   * 所有滚动来源（手指 / 惯性 / 滚动条）最终都落到 scroll 事件：
   * 在这里接管、实时更新中心行，并以最后一次滚动为起点做 2s 防抖回弹。
   */
  const onLyricScroll = useCallback((e: any) => {
    const scrollTop = Number(e?.detail?.scrollTop ?? 0);
    lyricScrollTopRef.current = scrollTop;
    if (lyricAutoScrollingRef.current) return;

    if (!lyricInteractingRef.current) {
      lyricInteractingRef.current = true;
      setLyricInteracting(true);
    }
    const index = findLyricCenteredIndex(scrollTop);
    if (index >= 0) {
      setLyricCenteredIndex((prev) => (prev === index ? prev : index));
    }

    clearLyricIdleTimer();
    lyricIdleTimerRef.current = setTimeout(() => {
      lyricIdleTimerRef.current = null;
      lyricInteractingRef.current = false;
      setLyricInteracting(false);
      setLyricCenteredIndex(-1);
      // 显式回弹，不依赖 currentTime 变化 —— 暂停 / 停止播放时拖动同样生效
      const target = resolveActiveLyricIndex(lyricsRef.current, currentTimeRef.current);
      if (target >= 0) {
        scrollToLyricLine(target);
        lyricAutoKeyRef.current = `${trackIdRef.current ?? ''}|${target}|${lyricFontSize}`;
      }
    }, LYRIC_IDLE_TIMEOUT_MS);
  }, [findLyricCenteredIndex, clearLyricIdleTimer, scrollToLyricLine, lyricFontSize]);

  /** 点中心行右侧播放按钮：从该行时间开始播放 */
  const handleLyricSeekPlay = useCallback(() => {
    const index = lyricCenteredIndex >= 0
      ? lyricCenteredIndex
      : findLyricCenteredIndex(lyricScrollTopRef.current);
    const line = lyricsRef.current[index];
    if (!line) return;
    clearLyricIdleTimer();
    lyricInteractingRef.current = false;
    setLyricInteracting(false);
    setLyricCenteredIndex(-1);
    scrollToLyricLine(index);
    lyricAutoKeyRef.current = `${trackIdRef.current ?? ''}|${index}|${lyricFontSize}`;
    // 阻止紧随其后的父层点击把歌词页关掉（小程序 stopPropagation 并非所有基础库都可靠）
    lyricSeekPlayAtRef.current = Date.now();
    seek(line.time);
    if (!isPlayingRef.current) resume();
  }, [lyricCenteredIndex, findLyricCenteredIndex, clearLyricIdleTimer, scrollToLyricLine, lyricFontSize, seek, resume]);

  /** 拖动中 / 2s 倒计时内 / 刚点过播放按钮时，点歌词区不切回封面 */
  const handleLyricsBackgroundClick = useCallback(() => {
    if (lyricInteractingRef.current) return;
    if (Date.now() - lyricSeekPlayAtRef.current < 400) return;
    setShowLyrics(false);
  }, []);

  // 切歌复位：清掉接管状态、测量缓存与倒计时
  useEffect(() => {
    clearLyricIdleTimer();
    lyricInteractingRef.current = false;
    setLyricInteracting(false);
    setLyricCenteredIndex(-1);
    lyricLayoutsRef.current = [];
    lyricAutoKeyRef.current = '';
  }, [currentTrack?.id, clearLyricIdleTimer]);

  useEffect(() => () => {
    clearLyricIdleTimer();
    if (lyricAnchorTimerRef.current) clearTimeout(lyricAnchorTimerRef.current);
    if (lyricGuardTimerRef.current) clearTimeout(lyricGuardTimerRef.current);
  }, [clearLyricIdleTimer]);

  // Load controlsBottomOffset from storage
  useEffect(() => {
    Taro.getStorage({ key: 'lyric_font_size' }).then((res) => {
      const val = parseFloat(res.data);
      if (!Number.isNaN(val) && val > 0) {
        setLyricFontSize(val);
      }
    }).catch(() => {});
  }, []);

  // Save controlsBottomOffset to storage when changed
  useEffect(() => {
    Taro.setStorage({ key: 'lyric_font_size', data: String(lyricFontSize) }).catch(() => {});
  }, [lyricFontSize]);

  // Check if current track is liked
  useEffect(() => {
    const checkLikedStatus = async () => {
      if (!currentTrack || !user) {
        setLiked(false);
        return;
      }
      try {
        const res = await getFavoriteTracks(user.id, 0, 100, mode);
        if (res.code === 200) {
          const isLiked = res.data.list.some((item: any) => item.track?.id === currentTrack.id);
          setLiked(isLiked);
        }
      } catch (error) {
        console.error('Failed to check liked status:', error);
      }
    };
    checkLikedStatus();
  }, [currentTrack, user, mode]);

  const handleToggleLike = async () => {
    if (!currentTrack || !user) return;
    const previousLiked = liked;
    setLiked(!liked);

    try {
      if (previousLiked) {
        trackEvent({
          feature: 'player',
          eventName: 'track_unlike',
          metadata: { trackId: currentTrack.id }
        });
        await toggleTrackUnLike(Number(currentTrack.id), user.id);
      } else {
        trackEvent({
          feature: 'player',
          eventName: 'track_like',
          metadata: { trackId: currentTrack.id }
        });
        await toggleTrackLike(Number(currentTrack.id), user.id);
      }
    } catch (error) {
      console.error('Failed to toggle like', error);
      setLiked(previousLiked);
      Taro.showToast({ title: t('common.operationFailed'), icon: 'none' });
    }
  };

  const handleNavigateToArtist = () => {
    if (!currentTrack?.artistId) return;
    setShowMoreMenu(false);
    Taro.navigateTo({ url: `/pages/artist/index?id=${currentTrack.artistId}` });
  };

  const handleNavigateToAlbum = () => {
    if (!currentTrack?.albumId) return;
    setShowMoreMenu(false);
    Taro.navigateTo({ url: `/pages/album/index?id=${currentTrack.albumId}` });
  };

  const handleShowTrackProperty = async () => {
    if (!currentTrack) return;
    setShowMoreMenu(false);
    await Taro.showModal({
      title: `曲目属性 · ${currentTrack.name}`,
      content: currentTrack.path?.trim() || t('common.noData'),
      showCancel: false,
      confirmText: t('player.close'),
    });
  };

  const handleSkip = (seconds: number) => {
    const newTime = Math.max(0, Math.min(duration, currentTime + seconds));
    seek(newTime);
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackRate(speed);
    Taro.showToast({ title: `倍速: ${speed}x`, icon: 'none' });
  };

  const togglePlaybackRate = () => {
    const rates = [0.5, 1, 1.25, 1.5, 2];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    handleSpeedChange(nextRate);
  };

  // 占位图各页不同，这里绑死；调用点传显示尺寸（rpx 值 ≈ 目标设备像素，见 utils/image.ts）
  const getImageUrl = (url: string | null, width = 300) =>
    buildImageUrl(url, "https://picsum.photos/400/400", width);

  const formatTime = (seconds: number) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleSliderChange = (e) => {
    const val = e.detail.value;
    seek(val);
  };

  const formatRemainingTime = () => {
    if (!sleepTimer) return '';
    const remaining = Math.max(0, sleepTimer - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const getPlayModeIconClass = () => {
    switch (playMode) {
      case PlayMode.SEQUENCE:
        return 'icon-sequence';
      case PlayMode.SHUFFLE:
        return 'icon-shuffle';
      case PlayMode.LOOP_LIST:
        return 'icon-repeat';
      case PlayMode.LOOP_SINGLE:
        return 'icon-repeat-once';
      default:
        return 'icon-repeat';
    }
  };

  const openSkipConfig = (type: 'intro' | 'outro') => {
    setSkipConfigType(type);
    const currentValue = type === 'intro' ? skipIntroDuration : skipOutroDuration;
    setTempSkipTime(currentValue === 0 ? 30 : currentValue);
    setShowMoreMenu(false);
    setShowSkipConfigModal(true);
  };

  const confirmSkipConfig = () => {
    if (skipConfigType === 'intro') {
      setSkipIntroDuration(tempSkipTime);
    } else {
      setSkipOutroDuration(tempSkipTime);
    }
    setShowSkipConfigModal(false);
  };

  const clearSkipConfig = () => {
    if (skipConfigType === 'intro') {
      setSkipIntroDuration(0);
    } else {
      setSkipOutroDuration(0);
    }
    setShowSkipConfigModal(false);
  };

const handleOpenMore = () => {
    trackEvent({
      feature: 'player',
      eventName: 'player_more_open',
      metadata: { trackId: currentTrack?.id }
    });
    setShowMoreMenu(true);
  };

  const handleOpenMiCast = () => {
    trackEvent({
      feature: 'player',
      eventName: 'cast_to_mi_open',
      metadata: { trackId: currentTrack?.id }
    });
    setIsMiDeviceSelectorVisible(true);
  };

  const handleCastToMi = async (device: MiDevice) => {
    if (!currentTrack) {
      Taro.showToast({ title: t('playerPage.miCastNoTrack'), icon: 'none' });
      return;
    }
    setIsCastingToMi(true);
    try {
      const baseURL = getBaseURL().replace(/\/$/, '');
      const url = `${baseURL}/track/stream/${currentTrack.id}`;
      const title = `${currentTrack.name} - ${currentTrack.artist ?? ''}`;
      await playMiDeviceByUrl({ device_id: device.device_id, url, title });
      Taro.showToast({
        title: t('playerPage.miCastSuccess', { device: device.name }),
        icon: 'success',
      });
      setIsMiDeviceSelectorVisible(false);
      if (isPlaying) {
        pause();
      }
    } catch (e) {
      console.error('Failed to cast to Mi device:', e);
      Taro.showToast({ title: t('playerPage.miCastFailed'), icon: 'none' });
    } finally {
      setIsCastingToMi(false);
    }
  };

  // 播放流转：mini 端无常驻 WS，走 HTTP 由后端代为转发到目标设备
  const handleTransferToDevice = async (targetDevice: OnlineDevice) => {
    if (!currentTrack) {
      Taro.showToast({ title: t('playerPage.miCastNoTrack'), icon: 'none' });
      return;
    }
    if (!targetDevice.deviceId) {
      Taro.showToast({ title: t('playerPage.transferFailed'), icon: 'none' });
      return;
    }
    try {
      const currentIndex = trackList.findIndex((tk) => tk.id === currentTrack.id);
      await transferSession({
        targetDeviceId: targetDevice.deviceId,
        currentTrack,
        playlist: { list: trackList, index: Math.max(0, currentIndex) },
        progress: Math.floor(currentTime || 0),
      });
      if (isPlaying) pause();
      Taro.showToast({
        title: t('playerPage.transferSuccess', { device: targetDevice.name }),
        icon: 'success',
      });
      setIsMiDeviceSelectorVisible(false);
    } catch (e) {
      console.error('Failed to transfer session:', e);
      Taro.showToast({ title: t('playerPage.transferFailed'), icon: 'none' });
    }
  };

  if (!currentTrack) return (
    <View className='player-page'>
      <View className='player-container empty'>
        <Text>No track playing</Text>
        <View onClick={() => Taro.navigateBack()} className='back-link'>Go Back</View>
      </View>
    </View>
  );

  return (
    <View className='player-page'>
      <View className='player-container'>
        <View className='player-header'>
            <View className='player-header-btn' onClick={() => Taro.navigateBack()}>
                <Text className='player-icon-btn icon icon-down' />
            </View>
            <View className='player-header-btn' onClick={handleOpenMore}>
                <Text className='player-icon-btn icon icon-more-v' />
            </View>
        </View>

        <View className='player-content'>
            <View className='player-artwork-lyric-area'>
                {!showLyrics ? (
                    <View className='player-artwork-column'>
                        <View onClick={() => setShowLyrics(true)}>
                            <View className='player-artwork-container'>
                                <Image
                                    src={getImageUrl(currentTrack.cover, 600)}
                                    className='player-artwork'
                                    mode='aspectFill' webp
                                />
                            </View>
                        </View>
                        {/* 有声书模式：操作按钮组贴在封面正下方（与封面同在一个弹性区域内，
                            随封面一起居中）。简约样式：图标 + 右下角小角标展示状态，
                            前进/后退纯图标无文字。 */}
                        {currentTrack.type === 'AUDIOBOOK' && (
                            <View className='player-audiobook-quick-actions'>
                              {/* 片头：图标 + 右下角秒数/关 角标，激活时角标高亮 */}
                              <View className='player-audiobook-quick-btn' onClick={() => openSkipConfig('intro')}>
                                <View className='player-audiobook-quick-iconbox'>
                                  <Text className={`player-audiobook-quick-icon icon icon-prev ${skipIntroDuration > 0 ? 'active' : ''}`} />
                                  <Text className={`player-audiobook-quick-badge ${skipIntroDuration > 0 ? 'active' : ''}`}>{skipIntroDuration > 0 ? `${skipIntroDuration}s` : '关'}</Text>
                                </View>
                              </View>
                              {/* 后退 15s：纯图标 */}
                              <View className='player-audiobook-quick-btn' onClick={() => handleSkip(-15)}>
                                <Text className='player-audiobook-quick-plain-icon'>-15</Text>
                              </View>
                              {/* 倍速：图标 + 右下角倍率角标 */}
                              <View className='player-audiobook-quick-btn' onClick={togglePlaybackRate}>
                                <View className='player-audiobook-quick-iconbox'>
                                  <Text className='player-audiobook-quick-icon icon icon-headset' />
                                  <Text className='player-audiobook-quick-badge'>{playbackRate}x</Text>
                                </View>
                              </View>
                              {/* 前进 15s：纯图标 */}
                              <View className='player-audiobook-quick-btn' onClick={() => handleSkip(15)}>
                                <Text className='player-audiobook-quick-plain-icon'>+15</Text>
                              </View>
                              {/* 片尾：图标 + 右下角秒数/关 角标，激活时角标高亮 */}
                              <View className='player-audiobook-quick-btn' onClick={() => openSkipConfig('outro')}>
                                <View className='player-audiobook-quick-iconbox'>
                                  <Text className={`player-audiobook-quick-icon icon icon-next ${skipOutroDuration > 0 ? 'active' : ''}`} />
                                  <Text className={`player-audiobook-quick-badge ${skipOutroDuration > 0 ? 'active' : ''}`}>{skipOutroDuration > 0 ? `${skipOutroDuration}s` : '关'}</Text>
                                </View>
                              </View>
                            </View>
                        )}
                    </View>
                ) : (
                    <View className='player-lyrics-container' onClick={handleLyricsBackgroundClick}>
                        {lyrics.length > 0 ? (
                            <>
                                <ScrollView
                                    scrollY
                                    className='player-lyrics-scroll'
                                    scrollIntoView={lyricAnchor}
                                    scrollIntoViewAlignment='center'
                                    scrollWithAnimation
                                    onScroll={onLyricScroll}
                                >
                                    {lyrics.map((line, index) => (
                                        <View key={index} id={`line-${index}`} className={`player-lyric-line ${index === currentLyricIndex ? 'active' : ''}`}>
                                            <Text
                                              className='player-lyric-text'
                                              style={{ fontSize: `${index === currentLyricIndex ? lyricFontSize + 4 : lyricFontSize}rpx` }}
                                            >
                                              {line.text}
                                            </Text>
                                        </View>
                                    ))}
                                </ScrollView>
                                {/* 中心操作条：拆成几个绝对定位的小块，不加全宽覆盖层，
                                    避免小程序里 pointer-events 行为不一致挡住滚动手势 */}
                                {lyricInteracting && lyricCenteredIndex >= 0 && (
                                    <>
                                        <View className='player-lyrics-seek-edge player-lyrics-seek-edge-top' />
                                        <View className='player-lyrics-seek-edge player-lyrics-seek-edge-bottom' />
                                        <Text className='player-lyrics-seek-time'>
                                          {formatLyricTime(lyrics[lyricCenteredIndex].time)}
                                        </Text>
                                        <View
                                          className='player-lyrics-seek-play'
                                          onClick={(e) => { e.stopPropagation(); handleLyricSeekPlay(); }}
                                        >
                                          <Text className='icon icon-play-white' />
                                        </View>
                                    </>
                                )}
                            </>
                        ) : (
                            <View className='player-no-lyrics'>
                                <Text>{t('player.noLyrics')}</Text>
                            </View>
                        )}
                    </View>
                )}
            </View>

            <View className='player-bottom-controls'>
                <View className='player-info-row'>
                    <View className='player-track-info'>
                        <Text className='player-track-title' numberOfLines={1}>{currentTrack.name}</Text>
                        <View className='player-track-meta'>
                            <Text className='player-track-artist' numberOfLines={1}>{currentTrack.artist}</Text>
                            {currentTrack.type !== 'AUDIOBOOK' && (
                              <View
                                className={`player-quality-btn ${availableAudioQualities.length <= 1 ? 'disabled' : ''}`}
                                onClick={() => cycleAudioQuality()}
                              >
                                <Text className='player-quality-text'>
                                  {availableAudioQualities.find((item) => item.quality === currentAudioQuality)?.label || '无损'}
                                </Text>
                              </View>
                            )}
                        </View>
                    </View>
                    <View className='player-action-btns'>
                        {currentTrack.type !== 'AUDIOBOOK' && (
                          <>
                            {mvSupported && hasMv && (
                              <View className='player-action-btn' onClick={() => Taro.navigateTo({ url: `/pages/mv/index?trackId=${currentTrack.id}` })}>
                                  <Text className='player-action-icon icon icon-video' />
                              </View>
                            )}
                            <View className='player-action-btn' onClick={handleToggleLike}>
                                <Text className={`player-action-icon icon ${liked ? 'icon-heart-filled' : 'icon-heart'}`} />
                            </View>
                          </>
                        )}
                        <View className='player-action-btn' onClick={handleOpenMiCast}>
                            <XiaoAiIcon size={16} />
                        </View>
                        <View className='player-action-btn' onClick={() => setShowMoreMenu(!showMoreMenu)}>
                            <Text className='player-action-icon icon icon-more-h' />
                        </View>
                    </View>
                </View>

                <View className='player-progress-area'>
                    <View className='player-time-container'>
                        <Text className='player-time-text'>{formatTime(currentTime)}</Text>
                        {/* 进度条三段式：底轨 + 缓存层自绘垫底，Slider 背景轨设透明。
                            微信 Slider 轨道两端内缩半个滑块宽（blockSize 12px → 6px），
                            自定义层用 trackbox 内缩 12rpx 对齐 */}
                        <View className='player-slider-wrap'>
                            <View className='player-slider-trackbox'>
                                <View className='player-slider-rail' />
                                <View
                                    className='player-slider-buffered'
                                    style={{ width: `${duration > 0 ? Math.min((buffered / duration) * 100, 100) : 0}%` }}
                                />
                            </View>
                            <Slider
                                className='player-slider'
                                min={0}
                                max={duration}
                                value={currentTime}
                                onChange={handleSliderChange}
                                activeColor='#333'
                                backgroundColor='transparent'
                                blockSize={12}
                            />
                        </View>
                        <Text className='player-time-text'>{formatTime(duration)}</Text>
                    </View>
                </View>

                <View className='player-controls'>
                    <View className='player-ctrl-btn' onClick={togglePlayMode}>
                        <Text className={`player-ctrl-icon-small icon ${getPlayModeIconClass()}`} />
                    </View>
                    <View className='player-main-ctrls'>
                        <View className='player-ctrl-btn' onClick={playPrevious}>
                            <Text className='player-ctrl-icon icon icon-prev' />
                        </View>
                        <View className='player-play-pause-btn player-ctrl-btn' onClick={isPlaying ? pause : resume}>
                            <Text className={`player-ctrl-icon-large icon ${isPlaying ? 'icon-pause' : 'icon-play'}`} />
                        </View>
                        <View className='player-ctrl-btn' onClick={playNext}>
                            <Text className='player-ctrl-icon icon icon-next' />
                        </View>
                    </View>
                    <View className='player-ctrl-btn' onClick={() => setShowPlaylist(true)}>
                        <Text className='player-ctrl-icon-small icon icon-list' />
                    </View>
                </View>
            </View>
        </View>

        {showMoreMenu && (
          <View className='player-more-menu-mask' onClick={() => setShowMoreMenu(false)}>
            <View className='player-more-menu-content' onClick={(e) => e.stopPropagation()}>
              {currentTrack.type === 'AUDIOBOOK' && (
                <View className='player-audiobook-menu-controls'>
                  <View className='player-audiobook-menu-btn' onClick={() => openSkipConfig('intro')}>
                    <Text className='player-audiobook-menu-icon icon icon-prev' />
                    <Text className='player-audiobook-menu-label'>{t('player.intro')}</Text>
                    <Text className='player-audiobook-menu-value'>{skipIntroDuration > 0 ? `${skipIntroDuration}s` : '关'}</Text>
                  </View>
                  <View className='player-audiobook-menu-btn' onClick={() => handleSkip(-15)}>
                    <Text className='player-audiobook-menu-plain'>-15s</Text>
                    <Text className='player-audiobook-menu-label'>{t('player.backward')}</Text>
                  </View>
                  <View className='player-audiobook-menu-btn' onClick={togglePlaybackRate}>
                    <Text className='player-audiobook-menu-icon icon icon-headset' />
                    <Text className='player-audiobook-menu-label'>{t('player.speed')}</Text>
                    <Text className='player-audiobook-menu-value'>{playbackRate}x</Text>
                  </View>
                  <View className='player-audiobook-menu-btn' onClick={() => handleSkip(15)}>
                    <Text className='player-audiobook-menu-plain'>+15s</Text>
                    <Text className='player-audiobook-menu-label'>{t('player.skipForward')}</Text>
                  </View>
                  <View className='player-audiobook-menu-btn' onClick={() => openSkipConfig('outro')}>
                    <Text className='player-audiobook-menu-icon icon icon-next' />
                    <Text className='player-audiobook-menu-label'>{t('player.skipOutro')}</Text>
                    <Text className='player-audiobook-menu-value'>{skipOutroDuration > 0 ? `${skipOutroDuration}s` : '关'}</Text>
                  </View>
                </View>
              )}
              <View className='player-menu-item' onClick={() => { setShowMoreMenu(false); setShowAddToPlaylist(true); }}>
                <Text className='player-menu-item-text'>{t('player.addToPlaylist')}</Text>
              </View>
              <View className='player-menu-item' onClick={() => { setShowMoreMenu(false); setShowSleepTimerModal(true); }}>
                <Text className='player-menu-item-text'>{sleepTimer ? `${t('player.sleepTimer')} (${formatRemainingTime()})` : t('player.sleepTimer')}</Text>
              </View>
              {currentTrack?.artistId && (
                <View className='player-menu-item' onClick={handleNavigateToArtist}>
                  <Text className='player-menu-item-text'>{t('player.artistDetail')}</Text>
                </View>
              )}
              {currentTrack?.albumId && (
                <View className='player-menu-item' onClick={handleNavigateToAlbum}>
                  <Text className='player-menu-item-text'>{t('player.albumDetail')}</Text>
                </View>
              )}
              <View className='player-menu-item' onClick={handleShowTrackProperty}>
                <Text className='player-menu-item-text'>{t('common.property')}</Text>
              </View>
              <View className='player-menu-item' onClick={() => { setShowMoreMenu(false); setShowLyricsFontModal(true); }}>
                <Text className='player-menu-item-text'>{t("player.adjustLyricSize")}</Text>
              </View>
              <View className='player-menu-item' onClick={() => setShowMoreMenu(false)}>
                <Text className='player-menu-item-text cancel'>{t('common.cancel')}</Text>
              </View>
            </View>
          </View>
        )}

        <AddToPlaylistModal visible={showAddToPlaylist} onClose={() => setShowAddToPlaylist(false)} />
        <MiDeviceSelector
          visible={isMiDeviceSelectorVisible}
          onClose={() => setIsMiDeviceSelectorVisible(false)}
          onSelectDevice={handleCastToMi}
          onTransferToDevice={handleTransferToDevice}
          loading={isCastingToMi}
        />
        <PlaylistModal />

        {showLyricsFontModal && (
          <View className='player-more-menu-mask' onClick={() => setShowLyricsFontModal(false)}>
            <View className='player-more-menu-content' onClick={(e) => e.stopPropagation()}>
              <View className='player-controls-offset-modal'>
                <View className='player-modal-title-row'>
                  <Text className='player-modal-title'>{t("player.adjustLyricSize")}</Text>
                </View>
                <View className='player-modal-description-row'>
                  <Text className='player-modal-description'>{t('player.adjustLyricFontSize')}</Text>
                </View>
                <View className='player-slider-panel'>
                  <View className='player-slider-header'>
                    <Text className='player-slider-label'>{t('common.fontSize')}</Text>
                    <Text className='player-slider-number'>{Math.round(lyricFontSize)}</Text>
                  </View>
                  <Slider
                    className='player-offset-slider'
                    min={24}
                    max={44}
                    step={1}
                    value={lyricFontSize}
                    onChange={(e) => setLyricFontSize(e.detail.value)}
                    activeColor='#000'
                    backgroundColor='#eee'
                    blockSize={16}
                  />
                </View>
                <View className='player-modal-actions'>
                  <View className='player-modal-btn player-modal-cancel-btn' onClick={() => { setLyricFontSize(32); setShowLyricsFontModal(false); }}>
                    <Text className='player-modal-cancel-text'>{t("player.reset")}</Text>
                  </View>
                  <View className='player-modal-btn player-modal-confirm-btn' onClick={() => setShowLyricsFontModal(false)}>
                    <Text className='player-modal-confirm-text'>{t('common.done')}</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}

        {showSleepTimerModal && (
          <View className='player-more-menu-mask' onClick={() => setShowSleepTimerModal(false)}>
            <View className='player-more-menu-content' onClick={(e) => e.stopPropagation()}>
              <View className='player-controls-offset-modal'>
                <View className='player-modal-title-row'>
                  <Text className='player-modal-title'>{t('player.sleepTimer')}</Text>
                </View>
                <View className='player-sleep-grid'>
                  {[15, 30, 60, 90].map((minutes) => (
                    <View
                      key={minutes}
                      className='player-sleep-chip'
                      onClick={() => { setSleepTimer(minutes); setShowSleepTimerModal(false); }}
                    >
                      <Text className='player-sleep-chip-text'>{minutes} 分钟</Text>
                    </View>
                  ))}
                </View>
                {sleepTimer && (
                  <View className='player-menu-item' onClick={() => { clearSleepTimer(); setShowSleepTimerModal(false); }}>
                    <Text className='player-menu-item-text'>{t('player.cancelTimer')}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {showSkipConfigModal && (
          <View className='player-more-menu-mask' onClick={() => setShowSkipConfigModal(false)}>
            <View className='player-more-menu-content' onClick={(e) => e.stopPropagation()}>
              <View className='player-controls-offset-modal'>
                <View className='player-modal-title-row'>
                  <Text className='player-modal-title'>{skipConfigType === 'intro' ? '设置自动跳过片头' : '设置自动跳过片尾'}</Text>
                </View>
                <View className='player-skip-time-display'>
                  <Text className='player-skip-time-text'>{Math.floor(tempSkipTime / 60)}:{String(tempSkipTime % 60).padStart(2, '0')}</Text>
                </View>
                <View className='player-skip-adjust-row'>
                  {[-10, -1, 1, 10].map((amount) => (
                    <View
                      key={amount}
                      className='player-skip-adjust-btn'
                      onClick={() => setTempSkipTime((prev) => Math.max(0, prev + amount))}
                    >
                      <Text className='player-skip-adjust-text'>{amount > 0 ? `+${amount}` : amount}</Text>
                    </View>
                  ))}
                </View>
                <View className='player-sleep-grid'>
                  {[30, 60, 90, 120].map((seconds) => (
                    <View
                      key={seconds}
                      className='player-sleep-chip'
                      onClick={() => setTempSkipTime(seconds)}
                    >
                      <Text className='player-sleep-chip-text'>{seconds}s</Text>
                    </View>
                  ))}
                </View>
                <View className='player-modal-actions'>
                  <View className='player-modal-btn player-modal-cancel-btn' onClick={clearSkipConfig}>
                    <Text className='player-modal-cancel-text'>{t('player.close')} {t('common.cancel')}</Text>
                  </View>
                  <View className='player-modal-btn player-modal-confirm-btn' onClick={confirmSkipConfig}>
                    <Text className='player-modal-confirm-text'>{t("common.saveSettings")}</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
