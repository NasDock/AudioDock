import { getAlbumHistory, getFavoriteAlbums, getFavoriteTracks, getTrackHistory } from '@soundx/services';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { usePlayer } from '../../context/PlayerContext';
import { usePlayMode } from '../../utils/playMode';
import { getImageUrl as buildImageUrl } from '../../utils/image';
import { isFnosSource } from '../../utils/mvSupport';
import PlayingIndicator from '../PlayingIndicator';
import './index.scss';

type TabType = 'current' | 'history' | 'favorites';
type SubTabType = 'track' | 'album';

const PlaylistModal = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { mode } = usePlayMode();
  const {
    trackList,
    currentTrack,
    playTrackList,
    showPlaylist,
    setShowPlaylist,
    isPlaying,
  } = usePlayer();

  const [activeTab, setActiveTab] = useState<TabType>('current');
  const [activeSubTab, setActiveSubTab] = useState<SubTabType>('track');
  // 飞牛音乐没有专辑收藏/专辑历史，弹窗内同样只保留单曲视图
  const fnosSource = isFnosSource();
  const effectiveSubTab: SubTabType = fnosSource ? 'track' : activeSubTab;
  const [listData, setListData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (showPlaylist && user) {
      if (activeTab === 'current') {
        setListData(trackList);
      } else {
        loadTabData();
      }
    }
  }, [showPlaylist, activeTab, activeSubTab, user, mode, trackList, fnosSource]);

  const loadTabData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      let res: any;
      const isAudiobook = mode === 'AUDIOBOOK';
      const currentSubTab = fnosSource ? 'track' : (isAudiobook ? 'album' : effectiveSubTab);

      if (activeTab === 'history') {
        if (currentSubTab === 'track') {
          res = await getTrackHistory(user.id, 0, 50, 'MUSIC');
          if (res.code === 200) {
            setListData(res.data.list.map((item: any) => item.track));
          }
        } else {
          res = await getAlbumHistory(user.id, 0, 50, mode);
          if (res.code === 200) {
            setListData(res.data.list.map((item: any) => item.album));
          }
        }
      } else if (activeTab === 'favorites') {
        if (currentSubTab === 'track') {
          res = await getFavoriteTracks(user.id, 0, 50, 'MUSIC');
          if (res.code === 200) {
            setListData(res.data.list.map((item: any) => item.track));
          }
        } else {
          res = await getFavoriteAlbums(user.id, 0, 50, mode);
          if (res.code === 200) {
            setListData(res.data.list.map((item: any) => item.album));
          }
        }
      }
    } catch (error) {
      console.error('Failed to load data in modal:', error);
    } finally {
      setLoading(false);
    }
  };

  // 占位图各文件不同，这里绑死；调用点传显示尺寸（rpx 值 ≈ 目标设备像素，见 utils/image.ts）
  const getImageUrl = (url: string | null, width = 300) =>
    buildImageUrl(url, "https://picsum.photos/100", width);
  const handleItemClick = (item: any, index: number) => {
    const isCurrent = activeTab === 'current';
    const isAlbum = !isCurrent && !fnosSource && (effectiveSubTab === 'album' || mode === 'AUDIOBOOK');

    if (isAlbum) {
      setShowPlaylist(false);
      Taro.navigateTo({ url: `/pages/album/index?id=${item.id}` });
    } else {
      // For all track playback, use playTrackList to set the entire list
      playTrackList(listData, index);
    }
  };

  const renderItem = (item: any, index: number) => {
    const isCurrent = activeTab === 'current';
    const isAlbum = !isCurrent && !fnosSource && (effectiveSubTab === 'album' || mode === 'AUDIOBOOK');
    const isActive = !isAlbum && currentTrack?.id === item.id;

    return (
      <View
        key={`${item.id}-${index}`}
        className={`modal-item ${isActive ? 'active' : ''}`}
        onClick={() => handleItemClick(item, index)}
      >
        <View className='item-row'>
          <Image
            src={getImageUrl(item.cover, 96)}
            className={isAlbum ? 'item-cover-large' : 'item-cover-small'}
            mode='aspectFill' webp
          />
          <Text className={`item-text ${isActive ? 'active' : ''}`} numberOfLines={1}>
            {item.name}
          </Text>
          {isActive && isPlaying && <PlayingIndicator />}
          {isAlbum && <Text className='chevron icon icon-back' style={{ transform: 'rotate(180deg)' }} />}
          {mode === 'AUDIOBOOK' && (item as any).progress && !isAlbum && (
            <Text className='progress-text'>
              {t('common.listened')}{Math.floor(((item as any).progress / (item.duration || 1)) * 100)}%
            </Text>
          )}
        </View>
      </View>
    );
  };

  if (!showPlaylist) return null;

  return (
    <View className='playlist-modal-mask' onClick={() => setShowPlaylist(false)}>
      <View className='playlist-modal-content' onClick={(e) => e.stopPropagation()}>
        <View className='modal-header'>
          {[
            { id: 'current', label: `${t('player.playOrderSequence')} (${trackList.length})` },
            { id: 'history', label: t('common.listened') },
            { id: 'favorites', label: t('common.favorites') },
          ].map((tab) => (
            <View
              key={tab.id}
              className={`tab-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id as TabType)}
            >
              <Text className={`tab-text ${activeTab === tab.id ? 'active' : ''}`}>
                {tab.label}
              </Text>
            </View>
          ))}
        </View>

        {(mode === 'MUSIC' || fnosSource) && activeTab !== 'current' && (
          <View className='sub-tab-container'>
            {[
              ...(fnosSource ? [] : [{ id: 'album', label: t('nav.albums') }]),
              { id: 'track', label: t('nav.tracks') },
            ].map((sub) => (
              <View
                key={sub.id}
                className={`sub-tab-item ${effectiveSubTab === sub.id ? 'active' : ''}`}
                onClick={() => setActiveSubTab(sub.id as SubTabType)}
              >
                <Text className={`sub-tab-text ${effectiveSubTab === sub.id ? 'active' : ''}`}>
                  {sub.label}
                </Text>
              </View>
            ))}
          </View>
        )}

        {loading ? (
          <View className='loading-container'>
            <Text>{t('common.loading')}</Text>
          </View>
        ) : (
          <ScrollView scrollY className='list-scroll'>
            {listData.length > 0 ? (
              listData.map((item, index) => renderItem(item, index))
            ) : (
              <View className='empty-container'>
                <Text className='empty-text'>{t('common.noData')}</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
};

export default PlaylistModal;
