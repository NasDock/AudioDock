import { Album, Artist, Track, getAlbumsByArtist, getArtistById, getCollaborativeAlbumsByArtist, getTracksByArtist } from '@soundx/services';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import MiniPlayer from '../../components/MiniPlayer';
import QuickLocate from '../../components/QuickLocate';
import { usePlayer } from '../../context/PlayerContext';
import { getBaseURL } from '../../utils/request';
import './index.scss';

export default function ArtistDetail() {
  const router = useRouter();
  const { id } = router.params;
  const { playTrackList, currentTrack, isPlaying } = usePlayer();
  
  const [artist, setArtist] = useState<Artist | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [collabAlbums, setCollabAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrollIntoView, setScrollIntoView] = useState('');

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
        }
      }
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
  if (!artist) return <View className='error'><Text>Artist not found</Text></View>;

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
                 <Image src={getImageUrl(artist.avatar)} className='avatar' mode='aspectFill' />
                 <Text className='name'>{artist.name}</Text>
             </View>

             {albums.length > 0 && (
                 <View className='section'>
                     <Text className='section-title'>所有专辑 ({albums.length})</Text>
                     <ScrollView scrollX className='horizontal-list'>
                         {albums.map(album => (
                             <View 
                                key={album.id} 
                                className='album-card'
                                onClick={() => Taro.navigateTo({ url: `/pages/album/index?id=${album.id}` })}
                             >
                                 <Image src={getImageUrl(album.cover)} className='album-cover' mode='aspectFill' />
                                 <Text className='album-name' numberOfLines={1}>{album.name}</Text>
                             </View>
                         ))}
                     </ScrollView>
                 </View>
             )}

             {collabAlbums.length > 0 && (
                 <View className='section'>
                     <Text className='section-title'>合作专辑 ({collabAlbums.length})</Text>
                     <ScrollView scrollX className='horizontal-list'>
                         {collabAlbums.map(album => (
                             <View 
                                key={album.id} 
                                className='album-card'
                                onClick={() => Taro.navigateTo({ url: `/pages/album/index?id=${album.id}` })}
                             >
                                 <Image src={getImageUrl(album.cover)} className='album-cover' mode='aspectFill' />
                                 <Text className='album-name' numberOfLines={1}>{album.name}</Text>
                             </View>
                         ))}
                     </ScrollView>
                 </View>
             )}

             <View className='section'>
                 <View className='section-header-row'>
                     <Text className='section-title'>所有单曲 ({tracks.length})</Text>
                     <View className='play-btn' onClick={() => tracks.length > 0 && playTrackList(tracks, 0)}>
                         <Text className='play-icon icon icon-play' />
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
             </View>
             
             {/* Padding for MiniPlayer */}
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
