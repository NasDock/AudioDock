import { Album, AlbumTrackSortBy, Track, TrackSource, getAlbumById, getAlbumTracks, Mv, getMvsByAlbum, type MiDevice, playMiDevicePlaylist } from '@soundx/services';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MiDeviceSelector from '../../components/MiDeviceSelector';
import MiniPlayer from '../../components/MiniPlayer';
import QuickLocate from '../../components/QuickLocate';
import XiaoAiIcon from '../../components/XiaoAiIcon';
import { useAuth } from '../../context/AuthContext';
import { usePlayer } from '../../context/PlayerContext';
import { getImageUrl as buildImageUrl } from '../../utils/image';
import { isMvSupported } from '../../utils/mvSupport';
import { getBaseURL } from '../../utils/request';
import './index.scss';
import BottomTabBar from '../../components/BottomTabBar';

export default function AlbumDetail() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = router.params;
  const { playTrackList, currentTrack, isPlaying } = usePlayer();
  const { user } = useAuth();
  const mvSupported = isMvSupported();

  const [album, setAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [mvs, setMvs] = useState<Mv[]>([]);
  const [activeTab, setActiveTab] = useState<'tracks' | 'mvs'>('tracks');
  const [loading, setLoading] = useState(true);
  const [scrollIntoView, setScrollIntoView] = useState('');
  const [sortBy, setSortBy] = useState<AlbumTrackSortBy>('fileName');
  const [sort, setSort] = useState<'asc' | 'desc'>('asc');
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [isMiDeviceSelectorVisible, setIsMiDeviceSelectorVisible] = useState(false);
  const [isCastingToMi, setIsCastingToMi] = useState(false);

  // 飞牛音乐没有 MV 能力：切源时若停在 MV tab 就退回曲目 tab
  useEffect(() => {
    if (!mvSupported && activeTab === 'mvs') {
      setActiveTab('tracks');
    }
  }, [mvSupported, activeTab]);

  useEffect(() => {
    if (id) {
      loadData(Number(id), sortBy, sort);
    }
  }, [id, sortBy, sort, mvSupported]);

  const loadData = async (albumId: number, currentSortBy: AlbumTrackSortBy, currentSort: 'asc' | 'desc') => {
    setLoading(true);
    try {
      const [albumRes, tracksRes] = await Promise.all([
          getAlbumById(albumId),
          getAlbumTracks(albumId, 200, 0, currentSort, undefined, user?.id, currentSortBy)
      ]);

      if (albumRes.code === 200) {
        setAlbum(albumRes.data);
        // 飞牛音乐没有 MV 能力，跳过无效请求
        if (mvSupported && albumRes.data?.name) {
          getMvsByAlbum(albumRes.data.name, albumRes.data.artist).then((res: any) => {
            if (res?.length) setMvs(res);
          }).catch((e: any) => console.error(e));
        }
      }
      if (tracksRes.code === 200) setTracks(tracksRes.data.list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // 占位图各页不同，这里绑死；调用点只需关心显示尺寸（目标设备像素宽，默认 300）
  const getImageUrl = (url: string | null, width = 300) =>
    buildImageUrl(url, 'https://picsum.photos/300/300', width);

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString()}`;
  };

  const handlePlayAll = () => {
      if (tracks.length > 0) {
          playTrackList(tracks as any, 0);
      }
  };

  const scrollToAnchor = (anchorId: string) => {
    setScrollIntoView('');
    setTimeout(() => setScrollIntoView(anchorId), 0);
  };

  const handleLocateCurrent = () => {
    if (!currentTrack || tracks.length === 0) return;
    const index = tracks.findIndex((item) => item.id === currentTrack.id);
    if (index > -1) {
      scrollToAnchor(`track-${index}`);
    }
  };

  const handleCastAlbumToMi = async (device: MiDevice) => {
    if (tracks.length === 0) {
      Taro.showToast({ title: t('playerPage.miCastNoTrack'), icon: 'none' });
      return;
    }
    setIsCastingToMi(true);
    try {
      const baseURL = getBaseURL().replace(/\/$/, '');
      const trackPayloads = tracks.map((track) => ({
        url: `${baseURL}/track/stream/${track.id}`,
        title: `${track.name} - ${track.artist ?? ''}`,
        duration: track.duration || 0,
      }));
      await playMiDevicePlaylist({
        device_id: device.device_id,
        tracks: trackPayloads,
        start_index: 0,
      });
      Taro.showToast({
        title: t('playerPage.miCastPlaylistSuccess', { count: trackPayloads.length, device: device.name }),
        icon: 'success',
      });
      setIsMiDeviceSelectorVisible(false);
    } catch (e) {
      console.error('Failed to cast album to Mi device:', e);
      Taro.showToast({ title: t('playerPage.miCastPlaylistFailed'), icon: 'none' });
    } finally {
      setIsCastingToMi(false);
    }
  };

  if (loading) return <View className='loading'><Text>{t('common.loading')}</Text></View>;
  if (!album) return <View className='error'><Text>{t('common.noData')}</Text></View>;

  return (
    <View className='album-container'>
         <View className='nav-bar'>
             <View className='back-btn' onClick={() => Taro.navigateBack()}>
                 <Text className='back-icon icon icon-back' />
             </View>
         </View>
         <ScrollView scrollY className='content-scroll' scrollWithAnimation scrollIntoView={scrollIntoView}>
             <View id='top-anchor' />
             <View className='header'>
                 {/* 400rpx ≈ 200px CSS → 目标设备像素 400 → 600 档 */}
                 <Image src={getImageUrl(album.cover, 600)} className='cover' mode='aspectFill' webp />
                 <Text className='title'>{album.name}</Text>
                 <Text className='artist'>{album.artist}</Text>
                 
                 <View className='actions'>
                     {activeTab === 'tracks' && (
                       <View className='album-play-all-btn' onClick={handlePlayAll}>
                           <Text className='album-play-icon icon icon-play' />
                           <Text className='album-play-text'>{t('album.playAll')}</Text>
                       </View>
                     )}
                     {activeTab === 'tracks' && album.type !== 'AUDIOBOOK' && tracks.length > 0 && (
                       <View className='sort-icon-btn' onClick={() => setIsMiDeviceSelectorVisible(true)}>
                         <XiaoAiIcon size={18} />
                       </View>
                     )}
                     {activeTab === 'tracks' && album.type === 'AUDIOBOOK' && (
                       <View className='sort-icon-btn' onClick={() => setSortModalVisible(true)}>
                         <Text className='sort-icon-text'>⇅</Text>
                       </View>
                     )}
                 </View>
             </View>

             {mvSupported && mvs.length > 0 && (
               <View className='tabs'>
                 <View 
                   className={`tab-item ${activeTab === 'tracks' ? 'active' : ''}`}
                   onClick={() => setActiveTab('tracks')}
                 >
                   <Text className='tab-text'>{t('nav.tracks')} ({tracks.length})</Text>
                 </View>
                 <View 
                   className={`tab-item ${activeTab === 'mvs' ? 'active' : ''}`}
                   onClick={() => setActiveTab('mvs')}
                 >
                   <Text className='tab-text'>MV ({mvs.length})</Text>
                 </View>
               </View>
             )}

             <View className='track-list'>
                 {mvSupported && activeTab === 'mvs' ? (
                   mvs.map((mv, index) => (
                     <View 
                        key={mv.id} 
                        className='track-item'
                        onClick={() => Taro.navigateTo({ url: `/pages/mv/index?id=${mv.id}` })}
                     >
                        <View className='track-idx-container'>
                            <Text className='track-index'>{index + 1}</Text>
                        </View>
                        <Image src={getImageUrl(mv.cover, 96)} className='track-cover mv-cover' mode='aspectFill' webp style={{ width: '80rpx', height: '60rpx', borderRadius: '8rpx' }} />
                        <View className='track-info' style={{ marginLeft: '20rpx' }}>
                            <Text className='track-name' numberOfLines={1}>{mv.name}</Text>
                        </View>
                        <Text className='track-duration'>{formatDuration(mv.duration || 0)}</Text>
                     </View>
                   ))
                 ) : (
                   tracks.map((track, index) => (
                       <View 
                          key={track.id} 
                          id={`track-${index}`}
                          className='track-item'
                          onClick={() => playTrackList(tracks as any, index)}
                       >
                          <View className='track-idx-container'>
                              {currentTrack?.id === track.id && isPlaying ? (
                                  <Text className='active-icon icon icon-music' />
                              ) : (
                                  <Text className={`track-index ${currentTrack?.id === track.id ? 'active' : ''}`}>{index + 1}</Text>
                              )}
                          </View>
                           <Image src={getImageUrl(track.cover, 96)} className='track-cover' mode='aspectFill' webp />
                           <View className='track-info'>
                               <View className='track-name-row'>
                                 <Text className={`track-name ${currentTrack?.id === track.id ? 'active' : ''}`} numberOfLines={1}>{track.name}</Text>
                                 <Text className='track-source'>
                                   {track.source === TrackSource.WEBDAV
                                     ? t('trackList.sourceWebdav')
                                     : t('trackList.sourceFile')}
                                 </Text>
                               </View>
                           </View>
                           <Text className='track-duration'>{formatDuration(track.duration || 0)}</Text>
                       </View>
                   ))
                 )}
             </View>

             <View id='bottom-anchor' />
             <View style={{ height: '260rpx' }}></View>
         </ScrollView>
         {sortModalVisible && album.type === 'AUDIOBOOK' && (
           <View className='sort-modal-overlay' onClick={() => setSortModalVisible(false)}>
             <View className='sort-modal-sheet' onClick={(e) => e.stopPropagation()}>
               <Text className='sort-modal-title'>{t('albumPage.sortTitle')}</Text>
               {([
                 ['fileName', t('albumPage.sortFileName')],
                 ['episodeNumber', t('albumPage.sortOptimized')],
                 ['fileCreatedAt', t('albumPage.sortFileCreatedAt')],
                 ['fileModifiedAt', t('albumPage.sortFileModifiedAt')],
               ] as [AlbumTrackSortBy, string][]).map(([value, label]) => (
                 <View
                   key={value}
                   className={`sort-modal-item ${sortBy === value ? 'active' : ''}`}
                   onClick={() => setSortBy(value)}
                 >
                   <Text className='sort-modal-item-text'>{label}</Text>
                   {sortBy === value && <Text className='sort-modal-check'>✓</Text>}
                 </View>
               ))}
               <Text className='sort-modal-title order-title'>{t('albumPage.sortOrderTitle')}</Text>
               <View className='sort-order-row'>
                 {([
                   ['asc', t('albumPage.sortAscending')],
                   ['desc', t('albumPage.sortDescending')],
                 ] as ['asc' | 'desc', string][]).map(([value, label]) => (
                   <View
                     key={value}
                     className={`sort-order-button ${sort === value ? 'active' : ''}`}
                     onClick={() => setSort(value)}
                   >
                     <Text className='sort-order-button-text'>{label}</Text>
                   </View>
                 ))}
               </View>
             </View>
           </View>
         )}
         <QuickLocate
            onTop={() => scrollToAnchor('top-anchor')}
            onBottom={() => scrollToAnchor('bottom-anchor')}
            onLocate={handleLocateCurrent}
            locateDisabled={!currentTrack || !tracks.some((item) => item.id === currentTrack.id)}
         />
      <MiDeviceSelector
        visible={isMiDeviceSelectorVisible}
        onClose={() => setIsMiDeviceSelectorVisible(false)}
        onSelectDevice={handleCastAlbumToMi}
        loading={isCastingToMi}
      />
      <BottomTabBar />
      <MiniPlayer />
    </View>
  );
}
