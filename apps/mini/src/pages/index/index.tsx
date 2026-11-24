import { getAlbumHistory, getAlbumTracks, getLatestArtists, getLatestTracks, getRecentAlbums, getRecommendedAlbums, TrackingEvent as TE, TrackingFeature as TF } from '@soundx/services'
import { Image, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MiniPlayer from '../../components/MiniPlayer'
import { useAuth } from '../../context/AuthContext'
import { usePlayer } from '../../context/PlayerContext'
import { usePlayMode } from '../../utils/playMode'
import { getImageUrl as buildImageUrl } from '../../utils/image';
import { trackEvent } from '../../utils/tracking'
import './index.scss'

export default function Index() {
  const { t } = useTranslation();
  const { playTrackList } = usePlayer()
  const { mode, setMode } = usePlayMode()
  const { user } = useAuth()
  const [sections, setSections] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const homeOpenedRef = useRef(false)

  useEffect(() => {
    if (homeOpenedRef.current) return
    homeOpenedRef.current = true
    void trackEvent({ feature: TF.CONTENT, eventName: TE.HOME_OPEN })
  }, [])

  const getLatestResumePoint = async (
    albumId: number | string,
    fallbackTrackId?: number | string,
    fallbackProgress?: number,
  ) => {
    let resumeTrackId = fallbackTrackId
    let resumeProgress = fallbackProgress || 0
    if (user?.id) {
      try {
        const historyRes = await getAlbumHistory(user.id, 0, 8, 'AUDIOBOOK')
        const matched = historyRes?.data?.list?.find(
          (entry: any) => String(entry?.album?.id) === String(albumId)
        )
        if (matched) {
          resumeTrackId = matched.trackId ?? resumeTrackId
          resumeProgress = matched.progress ?? resumeProgress
        }
      } catch (e) {
        console.warn('Failed to refresh latest audiobook resume point:', e)
      }
    }
    return { resumeTrackId, resumeProgress }
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const promises: Promise<any>[] = [
        getLatestArtists(mode, true, 8),
        getRecentAlbums(mode, true, 8),
        getRecommendedAlbums(mode, true, 8),
      ];
      
      if (mode === 'MUSIC') {
        promises.push(getLatestTracks('MUSIC', true, 8));
      }

      if (mode === 'AUDIOBOOK' && user) {
        promises.push(getAlbumHistory(user.id, 0, 8, 'AUDIOBOOK'));
      }

      const results = await Promise.all(promises);
      const [artistsRes, recentRes, recommendedRes] = results;
      const tracksRes = mode === 'MUSIC' ? results[3] : null;
      const historyRes = mode === 'AUDIOBOOK' ? results[3] : null;

      const newSections = [
        {
          id: 'artists',
          title: t('home.artists'),
          data: artistsRes.code === 200 ? artistsRes.data : [],
          type: 'artist',
        },
        {
          id: 'recent',
          title: t('home.recentAlbums'),
          data: recentRes.code === 200 ? recentRes.data : [],
          type: 'album',
        },
        {
          id: 'recommended',
          title: t('home.recommended'),
          data: recommendedRes.code === 200 ? recommendedRes.data : [],
          type: 'album',
        },
      ];

      if (mode === 'MUSIC' && tracksRes?.code === 200) {
        newSections.push({
          id: 'tracks',
          title: t('home.newTracks'),
          data: tracksRes.data,
          type: 'track',
        });
      }

      if (mode === 'AUDIOBOOK' && historyRes?.code === 200) {
        newSections.push({
          id: 'history',
          title: t('home.continueListening'),
          data: historyRes.data.list.map((item: any) => item.album),
          type: 'album',
        });
      }

      setSections(newSections)
    } catch (error) {
      console.error('Failed to load home data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [mode, user])

  // Need to handle page show refresh if needed, for now standard load is fine
  useDidShow(() => {
      // Potentially refresh or check auth
  })

  const handleTrackPlay = (trackList, index) => {
      playTrackList(trackList, index)
  }

  const handleRefreshSection = async (sectionId: string) => {
    try {
      const sectionIndex = sections.findIndex((s) => s.id === sectionId);
      if (sectionIndex === -1) return;

      let newData: any[] = [];

      if (sectionId === 'artists') {
        const res = await getLatestArtists(mode, true, 8);
        if (res.code === 200) newData = res.data;
      } else if (sectionId === 'recommended') {
        const res = await getRecommendedAlbums(mode, true, 8);
        if (res.code === 200) newData = res.data;
      } else if (sectionId === 'recent') {
        const res = await getRecentAlbums(mode, true, 8);
        if (res.code === 200) newData = res.data;
      } else if (sectionId === 'tracks') {
        const res = await getLatestTracks('MUSIC', true, 8);
        if (res.code === 200) newData = res.data;
      } else if (sectionId === 'history' && user) {
        const res = await getAlbumHistory(user.id, 0, 8, 'AUDIOBOOK');
        if (res.code === 200) {
          newData = res.data.list.map((item: any) => item.album);
        }
      }

      if (newData.length > 0) {
        setSections((prev) => {
          const newSections = [...prev];
          newSections[sectionIndex] = {
            ...newSections[sectionIndex],
            data: newData,
          };
          return newSections;
        });
      }
    } catch (error) {
      console.error(`Failed to refresh section ${sectionId}:`, error);
    }
  };

  // 占位图各文件不同，这里绑死；调用点传显示尺寸（rpx 值 ≈ 目标设备像素，见 utils/image.ts）
  const getImageUrl = (url: string | null, width = 300) =>
    buildImageUrl(url, "https://picsum.photos/200/200", width);
  const chunkTracks = (tracks = [], size = 2) => {
    const chunks: any[][] = [];
    for (let i = 0; i < tracks.length; i += size) {
      chunks.push(tracks.slice(i, i + size));
    }
    return chunks;
  };

  return (
    <View className='index-container'>
      <ScrollView
        scrollY
        className='scroll-content'
        refresherEnabled
        refresherTriggered={loading}
        onRefresherRefresh={loadData}
      >
        <View className='header'>
          <Text className='header-title'>{t('home.recommend')}</Text>
          <View className='mode-toggle' onClick={() => setMode(mode === 'MUSIC' ? 'AUDIOBOOK' : 'MUSIC')}>
            <Text className={`icon ${mode === 'MUSIC' ? 'icon-musical-notes' : 'icon-headset'}`} />
          </View>
        </View>

        <View className='search-bar' onClick={() => Taro.navigateTo({ url: '/pages/search/index' })}>
           <Text className='search-text'>{t('home.searchPlaceholder')}</Text>
        </View>

        {sections.map((section) => (
          <View key={section.id} className='section'>
            <View className='section-header'>
              <Text className='section-title'>{section.title}</Text>
              <View className='section-actions'>
                {section.id === 'tracks' && section.data.length > 0 && (
                  <View 
                    className='action-btn play-all-btn'
                    onClick={() => playTrackList(section.data, 0)}
                  >
                    <Text className='icon icon-play-white' />
                  </View>
                )}
                <View 
                  className='action-btn refresh-btn'
                  onClick={() => handleRefreshSection(section.id)}
                >
                  <Text className='icon icon-refresh' />
                </View>
              </View>
            </View>

            <ScrollView scrollX className='horizontal-list' showScrollbar={false}>
               <View className='flex-row'>
                {section.type === 'track' ? (
                   chunkTracks(section.data, 2).map((group, groupIndex) => (
                       <View key={`track-group-${groupIndex}`} className='track-column'>
                         {group.map((track, trackIndex) => {
                           const actualIndex = groupIndex * 2 + trackIndex;
                           return (
                             <View key={track.id} className='track-card' onClick={() => handleTrackPlay(section.data, actualIndex)}>
                                <Image src={getImageUrl(track.cover, 96)} className='track-image' mode='aspectFill' webp/>
                                <View className='track-info'>
                                   <Text className='track-title' numberOfLines={1}>{track.name}</Text>
                                   <Text className='track-artist' numberOfLines={1}>{track.artist}</Text>
                                </View>
                             </View>
                           );
                         })}
                       </View>
                   ))
                ) : (
                    section.data.map((item) => (
                        <View 
                            key={item.id} 
                            className={section.type === 'artist' ? 'artist-card' : 'album-card'}
                            onClick={async () => {
                                if (section.type === 'artist') {
                                  Taro.navigateTo({ url: `/pages/artist/index?id=${item.id}` });
                                  return;
                                }

                                if (section.id === 'history') {
                                  const latest = await getLatestResumePoint(
                                    item.id,
                                    item.resumeTrackId,
                                    item.resumeProgress
                                  );
                                  const resumeTrackId = latest.resumeTrackId;
                                  const resumeProgress = latest.resumeProgress;

                                  if (resumeTrackId) {
                                    try {
                                      const res = await getAlbumTracks(item.id, 1000, 0);
                                      if (res.code === 200 && res.data.list.length > 0) {
                                        const tracks = res.data.list;
                                        let targetIndex = tracks.findIndex((track: any) => track.id === resumeTrackId);
                                        if (targetIndex === -1) targetIndex = 0;
                                        await playTrackList(tracks, targetIndex, resumeProgress);
                                        return;
                                      }
                                    } catch (error) {
                                      console.error('Resume audiobook failed:', error);
                                    }
                                  }
                                }

                                Taro.navigateTo({ url: `/pages/album/index?id=${item.id}` });
                            }}
                        >
                            {section.type === 'artist' ? (
                              <>
                                <Image 
                                    src={getImageUrl(item.avatar, 128)} 
                                    className='artist-image' 
                                    mode='aspectFill' webp
                                />
                                <Text className='item-name' numberOfLines={1}>{item.name}</Text>
                              </>
                            ) : (
                              <>
                                <View className='album-image-wrap'>
                                  <Image 
                                      src={getImageUrl(item.cover)} 
                                      className='album-image' 
                                      mode='aspectFill' webp
                                  />
                                  {mode === 'AUDIOBOOK' && item.progress > 0 && (
                                    <View className='album-progress'>
                                      <View
                                        className='album-progress-fill'
                                        style={{ width: `${Math.min(100, Math.max(0, item.progress || 0))}%` }}
                                      />
                                    </View>
                                  )}
                                </View>
                                <Text className='item-name album-name-text' numberOfLines={1}>{item.name}</Text>
                                <Text className='item-sub' numberOfLines={1}>{item.artist || t('home.unknownArtist')}</Text>
                              </>
                            )}
                        </View>
                    ))
                )}
               </View>
            </ScrollView>
          </View>
        ))}
        <View className='page-bottom-spacer' />
      </ScrollView>
      <MiniPlayer />
    </View>
  )
}
