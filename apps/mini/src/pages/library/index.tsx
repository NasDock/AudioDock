import { Album, Artist, Track, loadMoreAlbum, loadMoreArtist, loadMoreTrack } from '@soundx/services';
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
  const [tabCounts, setTabCounts] = useState<Record<LibraryTab, number | null>>({
    songs: null,
    artists: null,
    albums: null,
  });
  const [sections, setSections] = useState<SectionData<ListItem>[]>([]);
  const [sortedItems, setSortedItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [loadCount, setLoadCount] = useState(0);
  const [scrollIntoView, setScrollIntoView] = useState('');
  const [showTrackMoreMenu, setShowTrackMoreMenu] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [heartbeatModeActive, setHeartbeatModeActive] = useState(false);

  const loadData = async (isLoadMore = false) => {
    if (!isLoadMore) {
      setLoading(true);
      setSections([]);
      setSortedItems([]);
      setLoadCount(0);
      setHasMore(true);
      setTotal(0);
    } else {
      if (!hasMore || loadingMore) return;
      setLoadingMore(true);
    }
    try {
      if (activeTab === 'songs') {
        const res = await loadMoreTrack({
          pageSize: 50,
          loadCount: isLoadMore ? loadCount : 0,
          type: mode,
          sortBy:
            mode === 'MUSIC' && heartbeatModeActive ? 'heartbeat' : undefined,
        });
        if (res.code === 200 && res.data) {
          const list = res.data.list.map((item: any) => (item.track ? item.track : item)) as Track[];
          const sorted =
            mode === 'MUSIC' && heartbeatModeActive
              ? [...list]
              : [...list].sort((a, b) => a.name.localeCompare(b.name));
          const newItems = isLoadMore ? [...sortedItems, ...sorted] : sorted;
          setSortedItems(newItems);
          setSections(groupAndSort(newItems, (item) => item.name));
          setTotal(res.data.total || newItems.length);
          setHasMore(res.data.hasMore ?? newItems.length < (res.data.total || 0));
          setLoadCount((isLoadMore ? loadCount : 0) + 1);
        }
      } else if (activeTab === 'artists') {
        const res = await loadMoreArtist({
          pageSize: 50,
          loadCount: isLoadMore ? loadCount : 0,
          type: mode,
          sortBy: mode === 'MUSIC' && heartbeatModeActive ? 'heartbeat' : undefined,
        });
        if (res.code === 200 && res.data) {
          const list = res.data.list as Artist[];
          const sorted =
            mode === 'MUSIC' && heartbeatModeActive
              ? [...list]
              : [...list].sort((a, b) => a.name.localeCompare(b.name));
          const newItems = isLoadMore ? [...sortedItems, ...sorted] : sorted;
          setSortedItems(newItems);
          setSections(groupAndSort(newItems, (item) => item.name));
          setTotal(res.data.total || newItems.length);
          setHasMore(res.data.hasMore ?? newItems.length < (res.data.total || 0));
          setLoadCount((isLoadMore ? loadCount : 0) + 1);
        }
      } else {
        const res = await loadMoreAlbum({
          pageSize: 50,
          loadCount: isLoadMore ? loadCount : 0,
          type: mode,
          sortBy:
            mode === 'MUSIC' && heartbeatModeActive ? 'heartbeat' : undefined,
        });
        if (res.code === 200 && res.data) {
          const list = res.data.list as Album[];
          const sorted =
            mode === 'MUSIC' && heartbeatModeActive
              ? [...list]
              : [...list].sort((a, b) => a.name.localeCompare(b.name));
          const newItems = isLoadMore ? [...sortedItems, ...sorted] : sorted;
          setSortedItems(newItems);
          setSections(groupAndSort(newItems, (item) => item.name));
          setTotal(res.data.total || newItems.length);
          setHasMore(res.data.hasMore ?? newItems.length < (res.data.total || 0));
          setLoadCount((isLoadMore ? loadCount : 0) + 1);
        }
      }
    } catch (error) {
      console.error('Failed to load library data:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const onScrollToLower = () => {
    if (hasMore && !loadingMore && !loading) {
      loadData(true);
    }
  };

  useEffect(() => {
    loadData();
  }, [mode, activeTab, heartbeatModeActive]);

  useEffect(() => {
    setShowTrackMoreMenu(false);
    setSelectedTrack(null);
  }, [activeTab, mode]);

  useEffect(() => {
    if (mode !== 'MUSIC' && heartbeatModeActive) {
      setHeartbeatModeActive(false);
    }
  }, [mode, heartbeatModeActive]);

  useEffect(() => {
    let cancelled = false;

    const loadTabCounts = async () => {
      try {
        const [trackRes, artistRes, albumRes] = await Promise.all([
          loadMoreTrack({
            pageSize: 1,
            loadCount: 0,
            type: mode,
          }),
          loadMoreArtist({
            pageSize: 1,
            loadCount: 0,
            type: mode,
          }),
          loadMoreAlbum({
            pageSize: 1,
            loadCount: 0,
            type: mode,
          }),
        ]);

        if (cancelled) return;

        setTabCounts({
          songs:
            trackRes.code === 200
              ? trackRes.data?.total || trackRes.data?.list?.length || 0
              : 0,
          artists:
            artistRes.code === 200
              ? artistRes.data?.total || artistRes.data?.list?.length || 0
              : 0,
          albums:
            albumRes.code === 200
              ? albumRes.data?.total || albumRes.data?.list?.length || 0
              : 0,
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load library tab counts:', error);
        }
      }
    };

    loadTabCounts();

    return () => {
      cancelled = true;
    };
  }, [mode]);

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

  const renderTabLabel = (label: string, count: number | null, active: boolean) => (
    <Text className={`tab-text ${active ? 'active-text' : ''}`}>
      {label}
      {typeof count === 'number' ? (
        <Text className={`tab-count ${active ? 'active' : ''}`}> {count}</Text>
      ) : null}
    </Text>
  );

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
                {renderTabLabel('单曲', tabCounts.songs, activeTab === 'songs')}
            </View>
            <View 
                className={`tab-item ${activeTab === 'artists' ? 'active' : ''}`} 
                onClick={() => setActiveTab('artists')}
            >
                {renderTabLabel('艺术家', tabCounts.artists, activeTab === 'artists')}
            </View>
            <View 
                className={`tab-item ${activeTab === 'albums' ? 'active' : ''}`} 
                onClick={() => setActiveTab('albums')}
            >
                {renderTabLabel('专辑', tabCounts.albums, activeTab === 'albums')}
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
        onScrollToLower={(e: any) => { onScrollToLower(); }}
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
         {sections.length > 0 && (
           <View className='library-footer'>
             <Text className='library-footer-text'>
               {`共加载 ${sortedItems.length} ${activeTab === 'songs' ? '首' : activeTab === 'artists' ? '位艺术家' : '张专辑'}`}
             </Text>
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
        showHeartbeat={mode === 'MUSIC'}
        heartbeatActive={heartbeatModeActive}
        onHeartbeatToggle={() => setHeartbeatModeActive((prev) => !prev)}
      />
      <MiniPlayer />
    </View>
  );
}
