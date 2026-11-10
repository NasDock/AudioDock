import { Album, Artist, Track, TrackSource, getAlbumsByArtist, getArtistById, getCollaborativeAlbumsByArtist, getTracksByArtist, Mv, getMvsByArtist, type MiDevice, playMiDevicePlaylist } from '@soundx/services';
import { mvPlaylistStore } from '../../store/mvPlaylist';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MiDeviceSelector from '../../components/MiDeviceSelector';
import MiniPlayer from '../../components/MiniPlayer';
import QuickLocate from '../../components/QuickLocate';
import XiaoAiIcon from '../../components/XiaoAiIcon';
import { usePlayer } from '../../context/PlayerContext';
import { getImageUrl as buildImageUrl } from '../../utils/image';
import { isMvSupported } from '../../utils/mvSupport';
import { getBaseURL } from '../../utils/request';
import './index.scss';
import BottomTabBar from '../../components/BottomTabBar';

export default function ArtistDetail() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = router.params;
  const { playTrackList, currentTrack, isPlaying } = usePlayer();
  const mvSupported = isMvSupported();

  const [artist, setArtist] = useState<Artist | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [collabAlbums, setCollabAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [mvs, setMvs] = useState<Mv[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrollIntoView, setScrollIntoView] = useState('');
  const [isMiDeviceSelectorVisible, setIsMiDeviceSelectorVisible] = useState(false);
  const [isCastingToMi, setIsCastingToMi] = useState(false);

  useEffect(() => {
    if (id) {
      loadData(Number(id));
    }
  }, [id]);

  const loadData = async (artistId: number) => {
    setLoading(true);
    try {
      const artistRes = await getArtistById(artistId);
      if (artistRes.code === 200) {
        setArtist(artistRes.data);
        if (artistRes.data.name) {
             const [albumsRes, collabRes, tracksRes] = await Promise.all([
                 getAlbumsByArtist(artistRes.data.name),
                 getCollaborativeAlbumsByArtist(artistRes.data.name),
                 getTracksByArtist(artistRes.data.name)
             ]);
             if (albumsRes.code === 200) setAlbums(albumsRes.data);
             if (collabRes.code === 200) setCollabAlbums(collabRes.data);
             if (tracksRes.code === 200) setTracks(tracksRes.data);
             
             // 飞牛音乐没有 MV 能力，跳过无效请求
             if (mvSupported) getMvsByArtist(artistRes.data.name).then((res: any[]) => {
                 if (res?.length) setMvs(res);
             }).catch((e: any) => console.error(e));
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // 占位图各页不同，这里绑死；调用点传显示尺寸（rpx 值 ≈ 目标设备像素，见 utils/image.ts）
  const getImageUrl = (url: string | null, width = 300) =>
    buildImageUrl(url, 'https://picsum.photos/300/300', width);

  const formatDuration = (seconds?: number) => {
      if (!seconds) return '--:--';
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${m}:${s.toString()}`;
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

  const handleCastTracksToMi = async (device: MiDevice) => {
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
    } catch (error) {
      console.error('Failed to cast tracks to Mi device:', error);
      Taro.showToast({ title: t('playerPage.miCastPlaylistFailed'), icon: 'none' });
    } finally {
      setIsCastingToMi(false);
    }
  };

  if (loading) return <View className='loading'><Text>{t('common.loading')}</Text></View>;
  if (!artist) return <View className='error'><Text>{t('common.noData')}</Text></View>;

  return (
    <View className='artist-container'>
         <View className='nav-bar'>
             <View className='back-btn' onClick={() => Taro.navigateBack()}>
                 <Text className='back-icon icon icon-back' />
             </View>
         </View>
         <ScrollView scrollY className='content-scroll' scrollWithAnimation scrollIntoView={scrollIntoView}>
             <View id='top-anchor' />
             <View className='header'>
                 {/* 详情页大头像：单张 Hero，走内外网分支（内网原图 / 外网 600） */}
                 <Image src={getImageUrl(artist.avatar, 600)} className='avatar' mode='aspectFill' webp />
                 <Text className='name'>{artist.name}</Text>
             </View>

             {albums.length > 0 && (
                 <View className='section'>
                     <Text className='section-title'>{t('artist.allAlbums')} ({albums.length})</Text>
                     <ScrollView scrollX className='horizontal-list'>
                         {albums.map(album => (
                             <View 
                                key={album.id} 
                                className='album-card'
                                onClick={() => Taro.navigateTo({ url: `/pages/album/index?id=${album.id}` })}
                             >
                                 <Image src={getImageUrl(album.cover, 240)} className='album-cover' mode='aspectFill' webp />
                                 <Text className='album-name' numberOfLines={1}>{album.name}</Text>
                             </View>
                         ))}
                     </ScrollView>
                 </View>
             )}

             {collabAlbums.length > 0 && (
                 <View className='section'>
                     <Text className='section-title'>{t('artist.collabAlbums')} ({collabAlbums.length})</Text>
                     <ScrollView scrollX className='horizontal-list'>
                         {collabAlbums.map(album => (
                             <View 
                                key={album.id} 
                                className='album-card'
                                onClick={() => Taro.navigateTo({ url: `/pages/album/index?id=${album.id}` })}
                             >
                                 <Image src={getImageUrl(album.cover, 240)} className='album-cover' mode='aspectFill' webp />
                                 <Text className='album-name' numberOfLines={1}>{album.name}</Text>
                             </View>
                         ))}
                     </ScrollView>
                 </View>
             )}

             {mvSupported && mvs.length > 0 && (
                 <View className='section'>
                     <Text className='section-title'>MV ({mvs.length})</Text>
                     <ScrollView scrollX className='horizontal-list'>
                         {mvs.map((mv, mvIndex) => (
                             <View 
                                key={mv.id} 
                                className='album-card'
                                onClick={() => {
                                  mvPlaylistStore.setPlaylist(mvs, mvIndex);
                                  Taro.navigateTo({ url: `/pages/mv/index?id=${mv.id}` });
                                }}
                             >
                                 <Image src={getImageUrl(mv.cover, 240)} className='album-cover mv-cover' mode='aspectFill' webp />
                                 <Text className='album-name' numberOfLines={1}>{mv.name}</Text>
                             </View>
                         ))}
                     </ScrollView>
                 </View>
             )}

              <View className='section'>
                  <View className='section-header-row'>
                      <Text className='section-title'>{t('artist.allTracks')} ({tracks.length})</Text>
                      <View className='section-header-actions'>
                          {tracks.length > 0 && (
                            <View
                              className='artist-cast-btn'
                              onClick={() => setIsMiDeviceSelectorVisible(true)}
                            >
                              <XiaoAiIcon size={16} />
                            </View>
                          )}
                          <View className='artist-play-btn' onClick={() => tracks.length > 0 && playTrackList(tracks as any, 0)}>
                              <Text className='artist-play-icon icon icon-play' />
                          </View>
                      </View>
                  </View>
                 <View className='track-list'>
                     {tracks.map((track, index) => (
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
                             <Image src={getImageUrl(track.cover, 40)} className='track-cover' mode='aspectFill' webp />
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
                     ))}
                 </View>
             </View>
             
             {/* Padding for MiniPlayer */}
             <View id='bottom-anchor' />
             <View style={{ height: '260rpx' }}></View>
         </ScrollView>
         <QuickLocate
            onTop={() => scrollToAnchor('top-anchor')}
            onBottom={() => scrollToAnchor('bottom-anchor')}
            onLocate={handleLocateCurrent}
            locateDisabled={!currentTrack || !tracks.some((item) => item.id === currentTrack.id)}
         />
      <MiDeviceSelector
        visible={isMiDeviceSelectorVisible}
        onClose={() => setIsMiDeviceSelectorVisible(false)}
        onSelectDevice={handleCastTracksToMi}
        loading={isCastingToMi}
      />
      <BottomTabBar />
      <MiniPlayer />
    </View>
  );
}
