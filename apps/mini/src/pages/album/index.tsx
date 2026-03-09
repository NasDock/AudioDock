import { Album, Track, getAlbumById, getAlbumTracks } from '@soundx/services';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import MiniPlayer from '../../components/MiniPlayer';
import QuickLocate from '../../components/QuickLocate';
import { usePlayer } from '../../context/PlayerContext';
import { getBaseURL } from '../../utils/request';
import './index.scss';

export default function AlbumDetail() {
  const router = useRouter();
  const { id } = router.params;
  const { playTrackList, currentTrack, isPlaying } = usePlayer();

  const [album, setAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrollIntoView, setScrollIntoView] = useState('');

  useEffect(() => {
    if (id) {
      loadData(Number(id));
    }
  }, [id]);

  const loadData = async (albumId: number) => {
    setLoading(true);
    try {
      const [albumRes, tracksRes] = await Promise.all([
          getAlbumById(albumId),
          getAlbumTracks(albumId, 200, 0, 'asc', '')
      ]);

      if (albumRes.code === 200) setAlbum(albumRes.data);
      if (tracksRes.code === 200) setTracks(tracksRes.data.list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getImageUrl = (url: string | null) => {
    if (!url) return `https://picsum.photos/300/300`;
    if (url.startsWith('http')) return url;
    return `${getBaseURL()}${url}`;
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString()}`;
  };

  const handlePlayAll = () => {
      if (tracks.length > 0) {
          playTrackList(tracks, 0);
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

  if (loading) return <View className='loading'><Text>Loading...</Text></View>;
  if (!album) return <View className='error'><Text>Album not found</Text></View>;

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
                 <Image src={getImageUrl(album.cover)} className='cover' mode='aspectFill' />
                 <Text className='title'>{album.name}</Text>
                 <Text className='artist'>{album.artist}</Text>
                 
                 <View className='actions'>
                     <View className='play-all-btn' onClick={handlePlayAll}>
                         <Text className='play-icon icon icon-play' />
                         <Text className='play-text'>播放全部</Text>
                     </View>
                     <View className='like-btn'>
                         <Text className='like-icon icon icon-heart' />
                     </View>
                 </View>
             </View>

             <View className='track-list'>
                 {tracks.map((track, index) => (
                     <View 
                        key={track.id} 
                        id={`track-${index}`}
                        className='track-item'
                        onClick={() => playTrackList(tracks, index)}
                     >
                        <View className='track-idx-container'>
                            {currentTrack?.id === track.id && isPlaying ? (
                                <Text className='active-icon icon icon-music' />
                            ) : (
                                <Text className={`track-index ${currentTrack?.id === track.id ? 'active' : ''}`}>{index + 1}</Text>
                            )}
                        </View>
                         <Image src={getImageUrl(track.cover)} className='track-cover' mode='aspectFill' />
                         <View className='track-info'>
                             <Text className={`track-name ${currentTrack?.id === track.id ? 'active' : ''}`} numberOfLines={1}>{track.name}</Text>
                         </View>
                         <Text className='track-duration'>{formatDuration(track.duration || 0)}</Text>
                     </View>
                 ))}
             </View>

             <View id='bottom-anchor' />
             <View style={{ height: '160rpx' }}></View>
         </ScrollView>
         <QuickLocate
            onTop={() => scrollToAnchor('top-anchor')}
            onBottom={() => scrollToAnchor('bottom-anchor')}
            onLocate={handleLocateCurrent}
            locateDisabled={!currentTrack || !tracks.some((item) => item.id === currentTrack.id)}
         />
         <MiniPlayer />
    </View>
  );
}
