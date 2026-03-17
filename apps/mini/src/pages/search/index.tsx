import {
  addSearchRecord, Album, Artist, clearSearchHistory,
  getHotSearches,
  getSearchHistory,
  searchAlbums,
  searchArtists,
  searchTracks, Track
} from '@soundx/services';
import { Image, Input, ScrollView, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { speechToText } from '../../services/asr';
import { usePlayer } from '../../context/PlayerContext';
import { usePlayMode } from '../../utils/playMode';
import { getBaseURL } from '../../utils/request';
import './index.scss';

export default function Search() {
  const { mode } = usePlayMode();
  const { playTrack } = usePlayer();
  const recorderRef = useRef<Taro.RecorderManager | null>(null);

  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [results, setResults] = useState<{
    tracks: Track[];
    artists: Artist[];
    albums: Album[];
  }>({
    tracks: [],
    artists: [],
    albums: []
  });

  const [history, setHistory] = useState<string[]>([]);
  const [hotSearches, setHotSearches] = useState<{ keyword: string; count: number }[]>([]);

  useEffect(() => {
    fetchSearchMeta();
  }, []);

  useEffect(() => {
    const manager = Taro.getRecorderManager();
    recorderRef.current = manager;

    const handleStop = async (res: Taro.RecorderManager.OnStopCallbackResult) => {
      setIsRecording(false);
      if (!res.tempFilePath) {
        Taro.showToast({ title: '录音失败', icon: 'none' });
        return;
      }

      setLoading(true);
      try {
        const text = await speechToText(res.tempFilePath);
        setKeyword(text);
      } catch (error) {
        console.error('Speech to text failed:', error);
        Taro.showToast({ title: '语音识别失败', icon: 'none' });
      } finally {
        setLoading(false);
      }
    };

    const handleError = (error: TaroGeneral.CallbackResult) => {
      setIsRecording(false);
      console.error('Recorder error:', error);
      Taro.showToast({ title: '录音异常', icon: 'none' });
    };

    manager.onStop(handleStop);
    manager.onError(handleError);

    return () => {
      manager.stop();
    };
  }, []);

  useEffect(() => {
    if (keyword.trim().length === 0) {
      setResults({ tracks: [], artists: [], albums: [] });
      return;
    }

    const timer = setTimeout(() => {
      handleSearch(keyword);
    }, 500);

    return () => clearTimeout(timer);
  }, [keyword, mode]);

  const fetchSearchMeta = async () => {
    try {
      const [hRes, hotRes] = await Promise.all([
        getSearchHistory(),
        getHotSearches()
      ]);
      if (hRes.code === 200) setHistory(hRes.data || []);
      if (hotRes.code === 200) setHotSearches(hotRes.data || []);
    } catch (e) {
      console.error('Failed to fetch search meta:', e);
    }
  };

  const clearHistory = async () => {
    try {
      await clearSearchHistory();
      setHistory([]);
    } catch (e) {
      console.error('Failed to clear history:', e);
    }
  };

  const handleSearch = async (kw?: string) => {
    const query = (kw !== undefined ? kw : keyword).trim();
    if (!query) {
      setResults({ tracks: [], artists: [], albums: [] });
      return;
    }

    setLoading(true);
    try {
      const [tracksRes, artistsRes, albumsRes] = await Promise.all([
        searchTracks(query, mode),
        searchArtists(query, mode),
        searchAlbums(query, mode),
      ]);

      setResults({
        tracks: tracksRes.code === 200 ? tracksRes.data : [],
        artists: artistsRes.code === 200 ? artistsRes.data : [],
        albums: albumsRes.code === 200 ? albumsRes.data : [],
      });

      addSearchRecord(query);
      const historyRes = await getSearchHistory();
      if (historyRes.code === 200) {
        setHistory(historyRes.data || []);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const requestRecordPermission = async (): Promise<boolean> => {
    try {
      await Taro.authorize({ scope: 'scope.record' });
      return true;
    } catch (error) {
      const settings = await Taro.getSetting();
      if (settings.authSetting['scope.record'] === false) {
        const modalRes = await Taro.showModal({
          title: '麦克风权限',
          content: '语音搜索需要麦克风权限，请在设置中开启。',
          confirmText: '去设置'
        });
        if (modalRes.confirm) {
          await Taro.openSetting();
          const updatedSettings = await Taro.getSetting();
          return !!updatedSettings.authSetting['scope.record'];
        }
      }
      return false;
    }
  };

  const handleVoiceToggle = async () => {
    const manager = recorderRef.current;
    if (!manager || loading) {
      return;
    }

    if (isRecording) {
      manager.stop();
      return;
    }

    const granted = await requestRecordPermission();
    if (!granted) {
      Taro.showToast({ title: '未授予录音权限', icon: 'none' });
      return;
    }

    try {
      manager.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 96000,
        format: 'mp3'
      });
      setIsRecording(true);
      Taro.showToast({ title: '正在录音，点击停止', icon: 'none' });
    } catch (error) {
      setIsRecording(false);
      console.error('Start recording failed:', error);
      Taro.showToast({ title: '无法开始录音', icon: 'none' });
    }
  };

  const getImageUrl = (url: string | null) => {
    if (!url) return 'https://picsum.photos/100';
    if (url.startsWith('http')) return url;
    return `${getBaseURL()}${url}`;
  };

  const renderItem = (item: Track | Artist | Album, type: string) => {
    const coverUrl = getImageUrl(type === 'artist' ? (item as Artist).avatar : (item as Track | Album).cover);

    return (
      <View
        className='result-item'
        onClick={() => {
          if (type === 'track') {
            playTrack(item as any);
          } else if (type === 'artist') {
            Taro.navigateTo({ url: `/pages/artist/index?id=${item.id}` });
          } else if (type === 'album') {
            Taro.navigateTo({ url: `/pages/album/index?id=${item.id}` });
          }
        }}
      >
        <Image
          src={coverUrl}
          className={`item-image ${type === 'artist' ? 'circle' : 'rounded'}`}
          mode='aspectFill'
        />
        <View className='item-info'>
          <Text className='item-title' numberOfLines={1}>{item.name}</Text>
          <Text className='item-subtitle' numberOfLines={1}>
            {type === 'track' ? (item as Track).artist : type === 'album' ? (item as Album).artist : '艺术家'}
          </Text>
        </View>
        <Text className='item-arrow'>›</Text>
      </View>
    );
  };

  const sections = [
    { title: '艺术家', data: results.artists, type: 'artist' },
    { title: '专辑', data: results.albums, type: 'album' },
    { title: '单曲', data: results.tracks, type: 'track' },
  ].filter((s) => s.data && s.data.length > 0);

  const showSuggestions = keyword.trim().length === 0 && sections.length === 0;

  return (
    <View className='search-container'>
      <View className='header'>
        <View className='search-input-box'>
          <Text className='search-icon icon icon-search' />
          <Input
            className='search-input'
            placeholder='搜索单曲，艺术家，专辑'
            value={keyword}
            onInput={(e) => setKeyword(e.detail.value)}
            confirmType='search'
          />
          {keyword.length > 0 && (
            <View
              className='clear-btn'
              onClick={() => {
                setKeyword('');
                setResults({ tracks: [], artists: [], albums: [] });
              }}
            >
              <Text className='clear-icon icon icon-close' />
            </View>
          )}
        </View>
        <Text className='cancel-btn' onClick={() => Taro.navigateBack()}>取消</Text>
      </View>

      <ScrollView scrollY className='content-scroll'>
        {loading ? (
          <View className='loading-state'><Text>加载中...</Text></View>
        ) : showSuggestions ? (
          <View>
            {history.length > 0 && (
              <View className='suggest-section'>
                <View className='suggest-header'>
                  <Text className='suggest-title'>搜索历史</Text>
                  <Text className='clear-history' onClick={clearHistory}>清空</Text>
                </View>
                <View className='tag-group'>
                  {history.map((kw, i) => (
                    <View key={i} className='tag' onClick={() => setKeyword(kw)}>
                      <Text className='tag-text'>{kw}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {hotSearches.length > 0 && (
              <View className='suggest-section'>
                <View className='suggest-header'>
                  <Text className='suggest-title'>热搜榜</Text>
                </View>
                <View className='hot-list'>
                  {hotSearches.map((hot, i) => (
                    <View key={i} className='hot-item' onClick={() => setKeyword(hot.keyword)}>
                      <Text className={`rank ${i < 3 ? 'top-rank' : ''}`}>{i + 1}</Text>
                      <Text className='hot-keyword'>{hot.keyword}</Text>
                      {i < 3 && <View className='hot-badge'><Text className='hot-badge-text'>HOT</Text></View>}
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        ) : (
          <View>
            {sections.length === 0 && keyword.trim().length > 0 && !loading && (
              <View className='empty-state'><Text>未找到相关结果</Text></View>
            )}
            {sections.map((section, idx) => (
              <View key={idx} className='result-section'>
                <View className='section-header'>
                  <Text className='section-title'>{section.title}</Text>
                </View>
                {section.data.map((item) => (
                  <View key={item.id}>
                    {renderItem(item, section.type)}
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View
        className={`voice-button ${isRecording ? 'recording' : ''}`}
        onClick={handleVoiceToggle}
      >
        <Text className={`voice-icon icon ${isRecording ? 'icon-mic' : 'icon-mic-outline'}`} />
      </View>
    </View>
  );
}
