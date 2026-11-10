import { Album, Artist, Track, getCollections, loadMoreAlbum, loadMoreArtist, loadMoreTrack, Mv, getMvList } from '@soundx/services';
import { mvPlaylistStore } from '../../store/mvPlaylist';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MiniPlayer from '../../components/MiniPlayer';
import QuickLocate from '../../components/QuickLocate';
import SkeletonBlock from '../../components/SkeletonBlock';
import { useAuth } from '../../context/AuthContext';
import { usePlayer } from '../../context/PlayerContext';
import { usePlayMode } from '../../utils/playMode';
import { getImageUrl as buildImageUrl } from '../../utils/image';
import { isMvSupported } from '../../utils/mvSupport';
import './index.scss';

const SONG_SKELETON_COUNT = 9;
const GRID_SKELETON_COUNT = 12;

type CollectionItem = {
  id: number | string;
  name: string;
  cover?: string | null;
  items?: Array<{ album?: Album }>;
  _count?: { items?: number };
};

type LibraryTab = 'songs' | 'artists' | 'albums' | 'collections' | 'mvs';

export default function Library() {
  const { t } = useTranslation();
  const { mode, setMode } = usePlayMode();
  const { user } = useAuth();
  const { playTrackList, currentTrack, isPlaying } = usePlayer();
  const [activeTab, setActiveTab] = useState<LibraryTab>('songs');
  const [tabCounts, setTabCounts] = useState<Record<LibraryTab, number | null>>({
    songs: null,
    artists: null,
    albums: null,
    collections: null,
    mvs: null,
  });
  const [sortedItems, setSortedItems] = useState<(Artist | Album | Track | CollectionItem | Mv)[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [loadCount, setLoadCount] = useState(0);
  const [scrollIntoView, setScrollIntoView] = useState('');
  const [showTrackMoreMenu, setShowTrackMoreMenu] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [heartbeatModeActive, setHeartbeatModeActive] = useState(false);
  const currentSourceType = Taro.getStorageSync('currentSourceType') || 'AudioDock';
  const canSwitchMode = currentSourceType !== 'Subsonic';
  const mvSupported = isMvSupported(currentSourceType);

  const loadData = async (isLoadMore = false) => {
    if (!isLoadMore) {
      setLoading(true);
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
          setTotal(res.data.total || newItems.length);
          setHasMore(res.data.hasMore ?? newItems.length < (res.data.total || 0));
          setLoadCount((isLoadMore ? loadCount : 0) + 1);
        }
      } else if (activeTab === 'albums') {
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
          setTotal(res.data.total || newItems.length);
          setHasMore(res.data.hasMore ?? newItems.length < (res.data.total || 0));
          setLoadCount((isLoadMore ? loadCount : 0) + 1);
        }
      } else if (mvSupported && activeTab === 'mvs') {
        const res = await getMvList(50, isLoadMore ? loadCount * 50 : 0);
        if (res && res.list) {
          const list = res.list as Mv[];
          const newItems = isLoadMore ? [...sortedItems, ...list] : list;
          setSortedItems(newItems);
          setTotal(res.total || newItems.length);
          setHasMore(newItems.length < (res.total || 0));
          setLoadCount((isLoadMore ? loadCount : 0) + 1);
        }
      } else if (user) {
        const res = await getCollections(user.id);
        if (res.code === 200 && res.data) {
          const list = res.data as CollectionItem[];
          setSortedItems(list);
          setTotal(list.length);
          setHasMore(false);
          setLoadCount(1);
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
  }, [mode, activeTab, heartbeatModeActive, mvSupported]);

  // 飞牛音乐没有 MV 能力：切源后若停在 MV tab 就退回可用 tab
  useEffect(() => {
    if (!mvSupported && activeTab === 'mvs') {
      setActiveTab(mode === 'MUSIC' ? 'songs' : 'artists');
    }
  }, [mvSupported, activeTab, mode]);

  useEffect(() => {
    setShowTrackMoreMenu(false);
    setSelectedTrack(null);
  }, [activeTab, mode]);

  useEffect(() => {
    if (mode === 'AUDIOBOOK' && activeTab === 'songs') {
      setActiveTab('artists');
    }
    if (mode !== 'AUDIOBOOK' && activeTab === 'collections') {
      setActiveTab('artists');
    }
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
        const [trackRes, artistRes, albumRes, collectionRes, mvRes] = await Promise.all([
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
          mode === 'AUDIOBOOK' && user ? getCollections(user.id) : Promise.resolve(null),
          mode === 'MUSIC' && mvSupported ? getMvList(1, 0) : Promise.resolve(null)
        ]);

        if (cancelled) return;

        setTabCounts({
          songs:
            mode === 'MUSIC'
              ? trackRes.code === 200
                ? trackRes.data?.total || trackRes.data?.list?.length || 0
                : 0
              : null,
          artists:
            artistRes.code === 200
              ? artistRes.data?.total || artistRes.data?.list?.length || 0
              : 0,
          albums:
            albumRes.code === 200
              ? albumRes.data?.total || albumRes.data?.list?.length || 0
              : 0,
          collections:
            mode === 'AUDIOBOOK'
              ? (collectionRes?.code === 200 ? collectionRes.data?.length || 0 : 0)
              : null,
          mvs:
            mode === 'MUSIC' && mvSupported
              ? mvRes?.total || mvRes?.list?.length || 0
              : null,
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
  }, [mode, user, mvSupported]);

  // 占位图各文件不同，这里绑死；调用点传显示尺寸（rpx 值 ≈ 目标设备像素，见 utils/image.ts）
  const getImageUrl = (url: string | null, width = 300) =>
    buildImageUrl(url, "https://picsum.photos/200/200", width);
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
    if (activeTab === 'collections') return true;
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

  const handlePlayAll = () => {
    if (activeTab !== 'songs' || sortedItems.length === 0) return;
    playTrackList(sortedItems as Track[], 0);
  };

  const showTrackPathModal = async (track: Track) => {
    setShowTrackMoreMenu(false);
    await Taro.showModal({
      title: `曲目属性 · ${track.name}`,
      content: track.path?.trim() || t('common.noData'),
      showCancel: false,
      confirmText: t('common.cancel'),
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
        <Text className='header-title'>{t('library.libraryTitle')}</Text>
        <View className='header-icons'>
          {mode === 'MUSIC' && activeTab === 'songs' && sortedItems.length > 0 && (
            <View className='icon-btn' onClick={handlePlayAll}>
              <Text className='icon-text icon icon-play' />
            </View>
          )}
          <View className='icon-btn' onClick={() => Taro.navigateTo({ url: '/pages/folder/index' })}>
            <Text className='icon-text icon icon-folder' />
          </View>
          <View className='icon-btn' onClick={() => Taro.navigateTo({ url: '/pages/search/index' })}>
            <Text className='icon-text icon icon-search' />
          </View>
          {canSwitchMode && (
            <View className='icon-btn' onClick={() => setMode(mode === 'MUSIC' ? 'AUDIOBOOK' : 'MUSIC')}>
              <Text className={`icon-text icon ${mode === 'MUSIC' ? 'icon-musical-notes' : 'icon-headset'}`} />
            </View>
          )}
        </View>
      </View>

      <View className='tabs-container'>
         <View className='tabs-bg'>
            {mode === 'MUSIC' && (
              <View
                  className={`tab-item ${activeTab === 'songs' ? 'active' : ''}`}
                  onClick={() => setActiveTab('songs')}
              >
                  {renderTabLabel(t('nav.tracks'), tabCounts.songs, activeTab === 'songs')}
              </View>
            )}
            <View 
                className={`tab-item ${activeTab === 'artists' ? 'active' : ''}`} 
                onClick={() => setActiveTab('artists')}
            >
                {renderTabLabel(t('nav.artists'), tabCounts.artists, activeTab === 'artists')}
            </View>
            <View 
                className={`tab-item ${activeTab === 'albums' ? 'active' : ''}`} 
                onClick={() => setActiveTab('albums')}
            >
                {renderTabLabel(t('nav.albums'), tabCounts.albums, activeTab === 'albums')}
            </View>
            {/* 飞牛音乐没有 MV 能力，隐藏 MV tab */}
            {mvSupported && mode === 'MUSIC' && (
              <View
                className={`tab-item ${activeTab === 'mvs' ? 'active' : ''}`}
                onClick={() => setActiveTab('mvs')}
              >
                {renderTabLabel('MV', tabCounts.mvs, activeTab === 'mvs')}
              </View>
            )}
            {mode === 'AUDIOBOOK' && (
              <View
                className={`tab-item ${activeTab === 'collections' ? 'active' : ''}`}
                onClick={() => setActiveTab('collections')}
              >
                {renderTabLabel(t('library.collectionTab'), tabCounts.collections, activeTab === 'collections')}
              </View>
            )}
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
         {loading ? (
           <View className='skeleton-content'>
             {activeTab === 'songs' ? (
               <View className='track-list'>
                 {Array.from({ length: SONG_SKELETON_COUNT }).map((_, index) => (
                   <View key={index} className='track-item'>
                     <SkeletonBlock width={78} height={78} borderRadius={10} />
                     <View className='track-info'>
                       <SkeletonBlock
                         width={index % 3 === 0 ? '58%' : index % 3 === 1 ? '72%' : '66%'}
                         height={28}
                         borderRadius={8}
                         className='skeleton-mb'
                       />
                       <SkeletonBlock
                         width={index % 2 === 0 ? '42%' : '55%'}
                         height={24}
                         borderRadius={6}
                       />
                     </View>
                   </View>
                 ))}
               </View>
             ) : (
               <View className='grid-container'>
                 {Array.from({ length: GRID_SKELETON_COUNT }).map((_, index) => (
                   <View key={index} className='grid-item'>
                     <SkeletonBlock
                       width='100%'
                       height={220}
                       borderRadius={activeTab === 'artists' ? 110 : 12}
                     />
                     <SkeletonBlock
                       width='72%'
                       height={14}
                       borderRadius={7}
                       className='skeleton-mt'
                     />
                     <SkeletonBlock
                       width='52%'
                       height={12}
                       borderRadius={6}
                       className='skeleton-mt'
                     />
                   </View>
                 ))}
               </View>
             )}
           </View>
         ) : (
           <>
             {activeTab === 'songs' ? (
               <View className='track-list'>
                 {sortedItems.map((item: any) => (
                   <View
                     key={item.id}
                     id={`item-${item.id}`}
                     className='track-item'
                     onLongPress={() => openTrackMoreMenu(item as Track)}
                     onClick={() => {
                       const idx = (sortedItems as Track[]).findIndex((track) => track.id === item.id);
                       if (idx > -1) {
                         playTrackList(sortedItems as Track[], idx);
                       }
                     }}
                   >
                     <Image src={getImageUrl(item.cover || null, 96)} className='track-cover' mode='aspectFill' webp />
                     <View className='track-info'>
                       <Text className={`track-name ${currentTrack?.id === item.id ? 'active' : ''}`} numberOfLines={1}>
                         {item.name}
                       </Text>
                       <Text className='track-sub' numberOfLines={1}>
                         {item.artist || t('common.unknownArtist')} · {item.album || t('common.unknownAlbum')}
                       </Text>
                     </View>
                     {currentTrack?.id === item.id && isPlaying ? <Text className='track-playing'>{t('library.playing')}</Text> : null}
                   </View>
                 ))}
               </View>
             ) : (
               <View className='grid-container'>
                 {sortedItems.map((item: any) => (
                   <View
                     key={item.id}
                     id={`item-${item.id}`}
                     className='grid-item'
                     onClick={() => {
                       // 飞牛音乐没有 MV 能力，兜底阻止深链跳转
                       if (!mvSupported && activeTab === 'mvs') return;
                       let url = '';
                       if (activeTab === 'artists') url = `/pages/artist/index?id=${item.id}`;
                       else if (activeTab === 'collections') url = `/pages/collection/index?id=${item.id}`;
                       else if (activeTab === 'mvs') {
                         const mvIndex = sortedItems.findIndex((s: any) => s.id === item.id);
                         mvPlaylistStore.setPlaylist(sortedItems as Mv[], mvIndex >= 0 ? mvIndex : 0);
                         url = `/pages/mv/index?id=${item.id}`;
                       } else url = `/pages/album/index?id=${item.id}`;
                       Taro.navigateTo({ url });
                     }}
                   >
                     <Image
                       src={getImageUrl(
                         activeTab === 'artists'
                           ? item.avatar
                           : activeTab === 'collections'
                             ? item.cover || item.items?.[0]?.album?.cover || null
                             : item.cover,
                       )}
                       className={`item-image ${activeTab === 'artists' ? 'circle' : 'rounded'}`}
                       mode='aspectFill' webp
                     />
                     {activeTab === 'albums' && mode === 'AUDIOBOOK' && (item as Album).progress > 0 ? (
                       <View className='item-progress'>
                         <View
                           className='item-progress-bar'
                           style={{ width: `${Math.min(100, Math.max(0, (item as Album).progress || 0))}%` }}
                         />
                       </View>
                     ) : null}
                     <Text className={`item-name ${activeTab === 'albums' || activeTab === 'collections' || activeTab === 'mvs' ? 'album' : ''}`} numberOfLines={1}>
                       {item.name}
                     </Text>
                     {activeTab === 'albums' ? (
                       <Text className='item-sub' numberOfLines={1}>
                         {(item as Album).artist || t('common.unknownArtist')}
                       </Text>
                     ) : activeTab === 'collections' ? (
                       <Text className='item-sub' numberOfLines={1}>
                         {`${item._count?.items ?? item.items?.length ?? 0} ${t('library.albums')}`}
                       </Text>
                     ) : activeTab === 'mvs' ? (
                       <Text className='item-sub' numberOfLines={1}>
                         {item.artist || t('common.unknownArtist')}
                       </Text>
                     ) : null}
                   </View>
                 ))}
               </View>
             )}
             {sortedItems.length === 0 && !loading && (
               <View className='empty-state'>
                 <Text className='empty-text'>{t('common.noData')}</Text>
               </View>
             )}
             {sortedItems.length > 0 && (
               <View className='library-footer'>
                 <Text className='library-footer-text'>
                   {`${t('common.loading')} ${sortedItems.length} ${activeTab === 'songs' ? t('nav.tracks') : activeTab === 'artists' ? t('nav.artists') : activeTab === 'albums' ? t('nav.albums') : t('library.collections')}`}
                 </Text>
               </View>
             )}
           </>
         )}
         <View className='page-bottom-spacer' />
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
              <Text className='track-more-item-text'>{t('library.artistDetail')}</Text>
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
              <Text className='track-more-item-text'>{t('album.title')}</Text>
            </View>
            <View className='track-more-item' onClick={() => showTrackPathModal(selectedTrack)}>
              <Text className='track-more-item-text'>{t('library.properties')}</Text>
            </View>
            <View className='track-more-item' onClick={() => setShowTrackMoreMenu(false)}>
              <Text className='track-more-item-text cancel'>{t('common.cancel')}</Text>
            </View>
          </View>
        </View>
      )}

      <QuickLocate
        onTop={() => scrollToAnchor('top-anchor')}
        onBottom={() => scrollToAnchor('bottom-anchor')}
        onLocate={handleLocateCurrent}
        showLocate={activeTab !== 'collections'}
        locateDisabled={locateDisabled}
        showHeartbeat={mode === 'MUSIC'}
        heartbeatActive={heartbeatModeActive}
        onHeartbeatToggle={() => setHeartbeatModeActive((prev) => !prev)}
      />
      <MiniPlayer />
    </View>
  );
}
