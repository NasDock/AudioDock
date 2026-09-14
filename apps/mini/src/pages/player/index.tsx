import { getFavoriteTracks, getMvByTrackId, toggleTrackLike, toggleTrackUnLike, transferSession, type Device as OnlineDevice, type MiDevice, playMiDeviceByUrl } from '@soundx/services';
import { Image, ScrollView, Slider, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AddToPlaylistModal from '../../components/AddToPlaylistModal';
import MiDeviceSelector from '../../components/MiDeviceSelector';
import PlaylistModal from '../../components/PlaylistModal';
import XiaoAiIcon from '../../components/XiaoAiIcon';
import { useAuth } from '../../context/AuthContext';
import { PlayMode, usePlayer } from '../../context/PlayerContext';
import { usePlayMode } from '../../utils/playMode';
import { getImageUrl as buildImageUrl } from '../../utils/image';
import { getBaseURL } from '../../utils/request';
import { trackEvent } from '../../utils/tracking';
import './index.scss';

// Match mobile lyric line interface
interface LyricLine {
  time: number;
  text: string;
}

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
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [liked, setLiked] = useState(false);
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
      if (!currentTrack || currentTrack.type === 'AUDIOBOOK') {
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
  }, [currentTrack?.id, currentTrack?.type]);

  useEffect(() => {
    if (lyrics.length > 0) {
      const activeIndex = lyrics.findIndex((line, index) => {
        return (
          line.time <= currentTime &&
          (index === lyrics.length - 1 || lyrics[index + 1].time > currentTime)
        );
      });

      if (activeIndex !== -1 && activeIndex !== currentLyricIndex) {
        setCurrentLyricIndex(activeIndex);
      }
    }
  }, [currentTime, lyrics, currentLyricIndex]);

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
            <View className='player-artwork-lyric-area' onClick={() => setShowLyrics(!showLyrics)}>
                {!showLyrics ? (
                    <View className='player-artwork-container'>
                        <Image 
                            src={getImageUrl(currentTrack.cover, 600)} 
                            className='player-artwork' 
                            mode='aspectFill' webp
                        />
                    </View>
                ) : (
                    <View className='player-lyrics-container'>
                        {lyrics.length > 0 ? (
                            <ScrollView 
                                scrollY 
                                className='player-lyrics-scroll' 
                                scrollIntoView={`line-${currentLyricIndex > 3 ? currentLyricIndex - 3 : 0}`}
                                scrollWithAnimation
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
                            {hasMv && (
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
                        <Slider 
                            className='player-slider' 
                            min={0} 
                            max={duration} 
                            value={currentTime} 
                            onChange={handleSliderChange}
                            activeColor='#333'
                            backgroundColor='#eee'
                            blockSize={12}
                        />
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
