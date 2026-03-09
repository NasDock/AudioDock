import { Album, Artist, Track, getArtistList, loadMoreAlbum, loadMoreTrack } from '@soundx/services';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useEffect, useMemo, useState } from 'react';
import MiniPlayer from '../../components/MiniPlayer';
import QuickLocate from '../../components/QuickLocate';
import { usePlayer } from '../../context/PlayerContext';
import { groupAndSort, SectionData } from '../../utils/pinyin';
import { usePlayMode } from '../../utils/playMode';
import { getBaseURL } from '../../utils/request';
import './index.scss';

type LibraryTab = 'songs' | 'artists' | 'albums';
type ListItem = Artist | Album | Track;

export default function Library() {
  const { mode, setMode } = usePlayMode();
  const { playTrackList, currentTrack, isPlaying } = usePlayer();
  const [activeTab, setActiveTab] = useState<LibraryTab>('songs');
  const [sections, setSections] = useState<SectionData<ListItem>[]>([]);
  const [sortedItems, setSortedItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrollIntoView, setScrollIntoView] = useState('');
  const [showTrackMoreMenu, setShowTrackMoreMenu] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);

  const loadData = async () => {
    setLoading(true);
    setSections([]);
    setSortedItems([]);
    try {
      if (activeTab === 'songs') {
        const res = await loadMoreTrack({
          pageSize: 2000,
          loadCount: 0,
          type: mode,
        });
        if (res.code === 200 && res.data) {
          const list = res.data.list.map((item: any) => (item.track ? item.track : item)) as Track[];
          const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
          setSortedItems(sorted);
          setSections(groupAndSort(sorted, (item) => item.name));
        }
      } else if (activeTab === 'artists') {
         const res = await getArtistList(1000, 0, mode);
         if (res.code === 200 && res.data) {
             const sorted = [...(res.data.list as Artist[])].sort((a, b) => a.name.localeCompare(b.name));
             setSortedItems(sorted);
             setSections(groupAndSort(sorted, (item) => item.name));
         }
      } else {
          const res = await loadMoreAlbum({ pageSize: 1000, loadCount: 0, type: mode });
          if (res.code === 200 && res.data) {
             const sorted = [...(res.data.list as Album[])].sort((a, b) => a.name.localeCompare(b.name));
             setSortedItems(sorted);
             setSections(groupAndSort(sorted, (item) => item.name));
          }
      }
    } catch (error) {
      console.error('Failed to load library data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [mode, activeTab]);

  useEffect(() => {
    setShowTrackMoreMenu(false);
    setSelectedTrack(null);
  }, [activeTab, mode]);

  useDidShow(() => {
      // noop
  });

  const getImageUrl = (url: string | null) => {
      if (!url) return `https://picsum.photos/200/200`;
      if (url.startsWith('http')) return url;
      return `${getBaseURL()}${url}`;
  };

  const scrollToAnchor = (anchorId: string) => {
    setScrollIntoView('');
    setTimeout(() => setScrollIntoView(anchorId), 0);
  };

  const handleLocateCurrent = () => {
    if (!currentTrack || sortedItems.length === 0) return;
    let itemId: number | string | null = null;

    if (activeTab === 'songs') {
      itemId = currentTrack.id;
    } else if (activeTab === 'artists') {
      const artist = sortedItems.find((item) => (item as Artist).name === currentTrack.artist) as Artist | undefined;
      itemId = artist?.id ?? null;
    } else {
      const album = sortedItems.find((item) => (item as Album).name === currentTrack.album) as Album | undefined;
      itemId = album?.id ?? null;
    }

    if (itemId !== null) {
      scrollToAnchor(`item-${itemId}`);
    }
  };

  const locateDisabled = useMemo(() => {
    if (!currentTrack || sortedItems.length === 0) return true;
    if (activeTab === 'songs') {
      return !sortedItems.some((item) => (item as Track).id === currentTrack.id);
    }
    if (activeTab === 'artists') {
      return !sortedItems.some((item) => (item as Artist).name === currentTrack.artist);
    }
    return !sortedItems.some((item) => (item as Album).name === currentTrack.album);
  }, [activeTab, currentTrack, sortedItems]);

  const openTrackMoreMenu = (track: Track) => {
    setSelectedTrack(track);
    setShowTrackMoreMenu(true);
  };

  const showTrackPathModal = async (track: Track) => {
    setShowTrackMoreMenu(false);
    await Taro.showModal({
      title: `曲目属性 · ${track.name}`,
      content: track.path?.trim() || '暂无文件路径',
      showCancel: false,
      confirmText: '关闭',
    });
  };

  return (
    <View className='library-container'>
      <View className='header'>
        <Text className='header-title'>声仓</Text>
        <View className='header-icons'>
             <View className='icon-btn' onClick={() => Taro.navigateTo({ url: '/pages/folder/index' })}>
                <Text className='icon-text'>📂</Text>
             </View>
             <View className='icon-btn' onClick={() => Taro.navigateTo({ url: '/pages/search/index' })}>
                <Text className='icon-text'>🔍</Text>
             </View>
             <View className='icon-btn' onClick={() => setMode(mode === 'MUSIC' ? 'AUDIOBOOK' : 'MUSIC')}>
                <Text className='icon-text'>{mode === 'MUSIC' ? '🎵' : '🎧'}</Text>
             </View>
        </View>
      </View>

      <View className='tabs-container'>
         <View className='tabs-bg'>
            <View
                className={`tab-item ${activeTab === 'songs' ? 'active' : ''}`}
                onClick={() => setActiveTab('songs')}
            >
                <Text className={`tab-text ${activeTab === 'songs' ? 'active-text' : ''}`}>单曲</Text>
            </View>
            <View 
                className={`tab-item ${activeTab === 'artists' ? 'active' : ''}`} 
                onClick={() => setActiveTab('artists')}
            >
                <Text className={`tab-text ${activeTab === 'artists' ? 'active-text' : ''}`}>艺术家</Text>
            </View>
            <View 
                className={`tab-item ${activeTab === 'albums' ? 'active' : ''}`} 
                onClick={() => setActiveTab('albums')}
            >
                <Text className={`tab-text ${activeTab === 'albums' ? 'active-text' : ''}`}>专辑</Text>
            </View>
         </View>
      </View>

      <ScrollView
        scrollY
        scrollWithAnimation
        scrollIntoView={scrollIntoView}
        className='content-scroll'
        refresherEnabled
        onRefresherRefresh={loadData}
        refresherTriggered={loading}
      >
         <View id='top-anchor' />
         {sections.map((section, index) => (
             <View key={section.title + index} className='section'>
                 <View className='section-header'>
                     <Text className='section-header-text'>{section.title}</Text>
                 </View>
                 {activeTab === 'songs' ? (
                   <View className='track-list'>
                     {section.data.map((item: any) => (
                       <View
                         key={item.id}
                         id={`item-${item.id}`}
                         className='track-item'
                         onLongPress={() => openTrackMoreMenu(item as Track)}
                         onClick={() => {
                           const index = (sortedItems as Track[]).findIndex((track) => track.id === item.id);
                           if (index > -1) {
                             playTrackList(sortedItems as Track[], index);
                           }
                         }}
                       >
                         <Image src={getImageUrl(item.cover || null)} className='track-cover' mode='aspectFill' />
                         <View className='track-info'>
                           <Text className={`track-name ${currentTrack?.id === item.id ? 'active' : ''}`} numberOfLines={1}>
                             {item.name}
                           </Text>
                           <Text className='track-sub' numberOfLines={1}>
                             {item.artist || '未知艺术家'} · {item.album || '未知专辑'}
                           </Text>
                         </View>
                         {currentTrack?.id === item.id && isPlaying ? <Text className='track-playing'>播放中</Text> : null}
                       </View>
                     ))}
                   </View>
                 ) : (
                   <View className='grid-container'>
                     {section.data.map((item: any) => (
                         <View 
                            key={item.id} 
                            id={`item-${item.id}`}
                            className='grid-item'
                            onClick={() => {
                                const url = activeTab === 'artists' 
                                    ? `/pages/artist/index?id=${item.id}` 
                                    : `/pages/album/index?id=${item.id}`;
                                Taro.navigateTo({ url });
                            }}
                         >
                            <Image 
                                src={getImageUrl(activeTab === 'artists' ? item.avatar : item.cover)} 
                                className={`item-image ${activeTab === 'artists' ? 'circle' : 'rounded'}`} 
                                mode='aspectFill'
                            />
                            <Text className='item-name' numberOfLines={1}>{item.name}</Text>
                         </View>
                     ))}
                   </View>
                 )}
             </View>
         ))}
         {sections.length === 0 && !loading && (
             <View className='empty-state'>
                 <Text className='empty-text'>暂无数据</Text>
             </View>
         )}
         <View id='bottom-anchor' />
      </ScrollView>

      {showTrackMoreMenu && selectedTrack && (
        <View className='track-more-mask' onClick={() => setShowTrackMoreMenu(false)}>
          <View className='track-more-content' onClick={(e) => e.stopPropagation()}>
            <View
              className='track-more-item'
              onClick={() => {
                setShowTrackMoreMenu(false);
                if (selectedTrack.artistId) {
                  Taro.navigateTo({ url: `/pages/artist/index?id=${selectedTrack.artistId}` });
                }
              }}
            >
              <Text className='track-more-item-text'>歌手详情</Text>
            </View>
            <View
              className='track-more-item'
              onClick={() => {
                setShowTrackMoreMenu(false);
                if (selectedTrack.albumId) {
                  Taro.navigateTo({ url: `/pages/album/index?id=${selectedTrack.albumId}` });
                }
              }}
            >
              <Text className='track-more-item-text'>专辑详情</Text>
            </View>
            <View className='track-more-item' onClick={() => showTrackPathModal(selectedTrack)}>
              <Text className='track-more-item-text'>属性</Text>
            </View>
            <View className='track-more-item' onClick={() => setShowTrackMoreMenu(false)}>
              <Text className='track-more-item-text cancel'>取消</Text>
            </View>
          </View>
        </View>
      )}

      <QuickLocate
        onTop={() => scrollToAnchor('top-anchor')}
        onBottom={() => scrollToAnchor('bottom-anchor')}
        onLocate={handleLocateCurrent}
        locateDisabled={locateDisabled}
      />
      <MiniPlayer />
    </View>
  );
}
