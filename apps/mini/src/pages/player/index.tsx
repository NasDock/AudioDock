import { getFavoriteTracks, toggleLike, toggleUnLike } from '@soundx/services';
import { Image, ScrollView, Slider, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import AddToPlaylistModal from '../../components/AddToPlaylistModal';
import PlaylistModal from '../../components/PlaylistModal';
import { useAuth } from '../../context/AuthContext';
import { usePlayer } from '../../context/PlayerContext';
import { usePlayMode } from '../../utils/playMode';
import { getBaseURL } from '../../utils/request';
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
  const { currentTrack, isPlaying, pause, resume, playNext, playPrevious, duration, currentTime, seek, setShowPlaylist } = usePlayer();
  const { mode, setMode } = usePlayMode();
  const { user } = useAuth();
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [liked, setLiked] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [showTimerMenu, setShowTimerMenu] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [controlsBottomOffset, setControlsBottomOffset] = useState(0);
  const [showControlsOffsetModal, setShowControlsOffsetModal] = useState(false);

  useEffect(() => {
    if (currentTrack && currentTrack.lyrics) {
        setLyrics(parseLyrics(currentTrack.lyrics));
    } else {
        setLyrics([]);
    }
  }, [currentTrack]);

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
    Taro.getStorage({ key: 'player_controls_bottom_offset' }).then((res) => {
      const val = parseFloat(res.data);
      if (!Number.isNaN(val)) {
        setControlsBottomOffset(val);
      }
    }).catch(() => {});
  }, []);

  // Save controlsBottomOffset to storage when changed
  useEffect(() => {
    Taro.setStorage({ key: 'player_controls_bottom_offset', data: String(controlsBottomOffset) }).catch(() => {});
  }, [controlsBottomOffset]);

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
        await toggleUnLike(Number(currentTrack.id), user.id);
      } else {
        await toggleLike(Number(currentTrack.id), user.id);
      }
    } catch (error) {
      console.error('Failed to toggle like', error);
      setLiked(previousLiked);
      Taro.showToast({ title: '操作失败', icon: 'none' });
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
      content: currentTrack.path?.trim() || '暂无文件路径',
      showCancel: false,
      confirmText: '关闭',
    });
  };

  const handleSkip = (seconds: number) => {
    const newTime = Math.max(0, Math.min(duration, currentTime + seconds));
    seek(newTime);
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    // TODO: Implement actual playback speed change via audio context
    Taro.showToast({ title: `倍速: ${speed}x`, icon: 'none' });
  };

  const getImageUrl = (url: string | null) => {
    if (!url) return `https://picsum.photos/400/400`;
    if (url.startsWith('http')) return url;
    return `${getBaseURL()}${url}`;
  };

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

  if (!currentTrack) return (
    <View className='player-container empty'>
      <Text>No track playing</Text>
      <View onClick={() => Taro.navigateBack()} className='back-link'>Go Back</View>
    </View>
  );

  return (
    <View className='player-container'>
        <View className='header'>
            <View className='header-btn' onClick={() => Taro.navigateBack()}>
                <Text className='icon-btn icon icon-down' />
            </View>
            <View className='header-btn' onClick={() => {/* more modal */}}>
                <Text className='icon-btn icon icon-more-v' />
            </View>
        </View>

        <View className='content'>
            <View className='artwork-lyric-area' onClick={() => setShowLyrics(!showLyrics)}>
                {!showLyrics ? (
                    <View className='artwork-container'>
                        <Image 
                            src={getImageUrl(currentTrack.cover)} 
                            className='artwork' 
                            mode='aspectFill'
                        />
                    </View>
                ) : (
                    <View className='lyrics-container'>
                        {lyrics.length > 0 ? (
                            <ScrollView 
                                scrollY 
                                className='lyrics-scroll' 
                                scrollIntoView={`line-${currentLyricIndex > 3 ? currentLyricIndex - 3 : 0}`}
                                scrollWithAnimation
                            >
                                {lyrics.map((line, index) => (
                                    <View key={index} id={`line-${index}`} className={`lyric-line ${index === currentLyricIndex ? 'active' : ''}`}>
                                        <Text className='lyric-text'>{line.text}</Text>
                                    </View>
                                ))}
                            </ScrollView>
                        ) : (
                            <View className='no-lyrics'>
                                <Text>暂无歌词</Text>
                            </View>
                        )}
                    </View>
                )}
            </View>

            <View className='bottom-controls' style={{ marginBottom: controlsBottomOffset }}>
                <View className='info-row'>
                    <View className='track-info'>
                        <Text className='track-title' numberOfLines={1}>{currentTrack.name}</Text>
                        <Text className='track-artist' numberOfLines={1}>{currentTrack.artist}</Text>
                    </View>
                    <View className='action-btns'>
                        <View className='action-btn' onClick={handleToggleLike}>
                            <Text className={`action-icon icon ${liked ? 'icon-heart-filled' : 'icon-heart'}`} />
                        </View>
                        <View className='action-btn' onClick={() => setShowMoreMenu(!showMoreMenu)}>
                            <Text className='action-icon icon icon-more-h' />
                        </View>
                    </View>
                </View>

                <View className='progress-area'>
                    <View className='time-container'>
                        <Text className='time-text'>{formatTime(currentTime)}</Text>
                        <Slider 
                            className='slider' 
                            min={0} 
                            max={duration} 
                            value={currentTime} 
                            onChange={handleSliderChange}
                            activeColor='#333'
                            backgroundColor='#eee'
                            blockSize={12}
                        />
                        <Text className='time-text'>{formatTime(duration)}</Text>
                    </View>
                </View>

                <View className='player-controls'>
                    {mode === 'AUDIOBOOK' ? (
                        <View className='audiobook-controls'>
                            <View className='ctrl-btn' onClick={() => handleSkip(-15)}>
                                <Text className='ctrl-icon-small'>-15s</Text>
                            </View>
                            <View className='main-ctrls'>
                                <View className='ctrl-btn' onClick={playPrevious}>
                                    <Text className='ctrl-icon icon icon-prev' />
                                </View>
                                <View className='play-pause-btn ctrl-btn' onClick={isPlaying ? pause : resume}>
                                    <Text className={`ctrl-icon-large icon ${isPlaying ? 'icon-pause' : 'icon-play'}`} />
                                </View>
                                <View className='ctrl-btn' onClick={playNext}>
                                    <Text className='ctrl-icon icon icon-next' />
                                </View>
                            </View>
                            <View className='ctrl-btn' onClick={() => handleSkip(15)}>
                                <Text className='ctrl-icon-small'>+15s</Text>
                            </View>
                        </View>
                    ) : (
                        <>
                            <View className='ctrl-btn' onClick={() => setMode(mode === 'MUSIC' ? 'AUDIOBOOK' : 'MUSIC')}>
                                <Text className={`ctrl-icon-small icon ${mode === 'MUSIC' ? 'icon-repeat' : 'icon-headset'}`} />
                            </View>
                            <View className='main-ctrls'>
                                <View className='ctrl-btn' onClick={playPrevious}>
                                    <Text className='ctrl-icon icon icon-prev' />
                                </View>
                                <View className='play-pause-btn ctrl-btn' onClick={isPlaying ? pause : resume}>
                                    <Text className={`ctrl-icon-large icon ${isPlaying ? 'icon-pause' : 'icon-play'}`} />
                                </View>
                                <View className='ctrl-btn' onClick={playNext}>
                                    <Text className='ctrl-icon icon icon-next' />
                                </View>
                            </View>
                            <View className='ctrl-btn' onClick={() => setShowPlaylist(true)}>
                                <Text className='ctrl-icon-small icon icon-list' />
                            </View>
                        </>
                    )}
                </View>
            </View>
        </View>

        {/* More Actions Menu */}
        {showMoreMenu && (
          <View className='more-menu-mask' onClick={() => setShowMoreMenu(false)}>
            <View className='more-menu-content' onClick={(e) => e.stopPropagation()}>
              <View className='menu-item' onClick={() => { setShowMoreMenu(false); setShowAddToPlaylist(true); }}>
                <Text className='menu-item-text'>添加到播放列表</Text>
              </View>
              <View className='menu-item' onClick={() => { setShowMoreMenu(false); setShowTimerMenu(true); }}>
                <Text className='menu-item-text'>定时播放</Text>
              </View>
              {currentTrack?.artistId && (
                <View className='menu-item' onClick={handleNavigateToArtist}>
                  <Text className='menu-item-text'>歌手详情</Text>
                </View>
              )}
              {currentTrack?.albumId && (
                <View className='menu-item' onClick={handleNavigateToAlbum}>
                  <Text className='menu-item-text'>专辑详情</Text>
                </View>
              )}
              <View className='menu-item' onClick={handleShowTrackProperty}>
                <Text className='menu-item-text'>属性</Text>
              </View>
              <View className='menu-item' onClick={() => { setShowMoreMenu(false); setShowControlsOffsetModal(true); }}>
                <Text className='menu-item-text'>控制组位置调整</Text>
              </View>
              {mode === 'AUDIOBOOK' && (
                <View className='menu-section'>
                  <View className='menu-section-title'>
                    <Text className='section-title-text'>播放速度</Text>
                  </View>
                  <View className='speed-options'>
                    {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((speed) => (
                      <View
                        key={speed}
                        className={`speed-btn ${playbackSpeed === speed ? 'active' : ''}`}
                        onClick={() => { handleSpeedChange(speed); setShowMoreMenu(false); }}
                      >
                        <Text className={`speed-text ${playbackSpeed === speed ? 'active' : ''}`}>{speed}x</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              <View className='menu-item' onClick={() => setShowMoreMenu(false)}>
                <Text className='menu-item-text cancel'>取消</Text>
              </View>
            </View>
          </View>
        )}

        <AddToPlaylistModal visible={showAddToPlaylist} onClose={() => setShowAddToPlaylist(false)} />
        <PlaylistModal />

        {/* Controls Offset Modal */}
        {showControlsOffsetModal && (
          <View className='more-menu-mask' onClick={() => setShowControlsOffsetModal(false)}>
            <View className='more-menu-content' onClick={(e) => e.stopPropagation()}>
              <View className='controls-offset-modal'>
                <View className='modal-title-row'>
                  <Text className='modal-title'>控制组位置调整</Text>
                </View>
                <View className='modal-description-row'>
                  <Text className='modal-description'>调整播放控制按钮距离屏幕底部的位置</Text>
                </View>
                <View className='slider-panel'>
                  <View className='slider-header'>
                    <Text className='slider-label'>底部偏移</Text>
                    <Text className='slider-number'>{Math.round(controlsBottomOffset)}</Text>
                  </View>
                  <Slider
                    className='offset-slider'
                    min={0}
                    max={120}
                    step={1}
                    value={controlsBottomOffset}
                    onChange={(e) => setControlsBottomOffset(e.detail.value)}
                    activeColor='#007aff'
                    backgroundColor='#eee'
                    blockSize={16}
                  />
                  <View className='slider-hint-row'>
                    <Text className='slider-hint'>贴近底部</Text>
                    <Text className='slider-hint'>上移</Text>
                  </View>
                </View>
                <View className='modal-actions'>
                  <View className='modal-btn modal-cancel-btn' onClick={() => { setControlsBottomOffset(0); setShowControlsOffsetModal(false); }}>
                    <Text className='modal-cancel-text'>重置</Text>
                  </View>
                  <View className='modal-btn modal-confirm-btn' onClick={() => setShowControlsOffsetModal(false)}>
                    <Text className='modal-confirm-text'>完成</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}
    </View>
  );
}
