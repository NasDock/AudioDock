import { Image, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import React, { useEffect, useState } from 'react';
import { usePlayer } from '../../context/PlayerContext';
import { getImageUrl as buildImageUrl } from '../../utils/image';
import {
  buildPlayerCoverUrl,
  IDLE_DELAY_MS,
  prefetchPlayerCover,
  shouldPrefetchPlayerCover,
} from '../../utils/coverPrefetch';
import PlaylistModal from '../PlaylistModal';
import './index.scss';

const MiniPlayer: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    pause,
    resume,
    playNext,
    playPrevious,
    setShowPlaylist,
    currentAudioQuality,
    availableAudioQualities,
  } = usePlayer();
  const router = useRouter();
  const cover = currentTrack?.cover;

  /**
   * mini 态闲时预热播放页 600 档大封面。
   *
   * mini 条是 128 档，播放页是 600 档，URL 不同 → 微信按 URL 的图片缓存不命中，
   * navigateTo 进 player 页才从头下载大图，封面先露 #eee 灰底。这里延迟到闲时
   * 挂一个 2rpx 隐藏 image 把大图拉进客户端缓存，并顺带试一次 getImageInfo 拿本地路径。
   *
   * 放在 mini 条（mini 态载体）而不是 PlayerProvider：隐藏 image 需要真实节点，
   * 而 player 页本身不挂 mini 条 —— 大图在那一页直接可见、无需预热。
   */
  const [prefetchCoverUrl, setPrefetchCoverUrl] = useState('');
  useEffect(() => {
    setPrefetchCoverUrl('');
    if (!shouldPrefetchPlayerCover(cover)) return;
    const url = buildPlayerCoverUrl(cover);
    const timer = setTimeout(() => {
      setPrefetchCoverUrl(url);
      void prefetchPlayerCover(url);
    }, IDLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [cover]);

  const isTabPage = router.path === '/pages/index/index' ||
                    router.path === '/pages/library/index' ||
                    router.path === '/pages/personal/index';

  const hasCustomBottomTab = [
    '/pages/album/index',
    '/pages/artist/index',
    '/pages/playlist/index',
    '/pages/folder/index',
    '/pages/collection/index',
    '/pages/tts/tasks/index',
    '/pages/tts/create/index'
  ].includes(router.path);

  if (!currentTrack) return null;

  const handlePlayPause = (e) => {
    e.stopPropagation();
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  };

  // 占位图各文件不同，这里绑死；调用点传显示尺寸（rpx 值 ≈ 目标设备像素，见 utils/image.ts）
  const getImageUrl = (url: string | null, width = 300) =>
    buildImageUrl(url, "https://picsum.photos/100", width);
  return (
    <>
      <View
        className={`mini-player-container ${isTabPage ? 'is-native-tab-page' : ''} ${hasCustomBottomTab ? 'has-custom-bottom-tab' : ''}`}
        onClick={() => Taro.navigateTo({ url: '/pages/player/index' })}
      >
        <View className='mini-content'>
          <View className='mini-info-container'>
            <Image
              src={getImageUrl(currentTrack.cover, 128)}
              className='mini-cover'
              mode='aspectFill' webp
            />
            <View className='mini-info'>
              <Text className='mini-title' numberOfLines={1}>{currentTrack.name}</Text>
              <View className='mini-artist-row'>
                <Text className='mini-artist' numberOfLines={1}>{currentTrack.artist}</Text>
                {currentTrack.type !== 'AUDIOBOOK' && (
                  <View className='mini-quality-badge'>
                    <Text className='mini-quality-text' numberOfLines={1}>
                      {availableAudioQualities.find((item) => item.quality === currentAudioQuality)?.label || '无损'}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
          <View className='mini-controls'>
            <View className='mini-btn' onClick={(e) => { e.stopPropagation(); playPrevious(); }}>
              <Text className='mini-icon icon icon-prev' />
            </View>
            <View className='mini-btn mini-play-btn' onClick={handlePlayPause}>
              <Text className={`mini-icon icon ${isPlaying ? 'icon-pause' : 'icon-play'}`} />
            </View>
            <View className='mini-btn' onClick={(e) => { e.stopPropagation(); playNext(); }}>
              <Text className='mini-icon icon icon-next' />
            </View>
            <View className='mini-btn' onClick={(e) => { e.stopPropagation(); setShowPlaylist(true); }}>
              <Text className='mini-icon icon icon-list' />
            </View>
          </View>
        </View>
        <PlaylistModal />
      </View>
      {/* 闲时把播放页 600 档大图拉进微信图片缓存；2rpx 且几乎全透明，不影响布局与点击 */}
      {prefetchCoverUrl ? (
        <Image
          src={prefetchCoverUrl}
          className='mini-cover-prefetch'
          mode='aspectFill' webp
        />
      ) : null}
    </>
  );
};

export default MiniPlayer;
