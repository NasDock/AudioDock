import {
  createCompactTask,
  createImportTask,
  createPlaylist,
  getAlbumHistory,
  getFavoriteAlbums,
  getFavoriteTracks,
  getImportTask,
  getPlaylists,
  getRunningImportTask,
  getTrackHistory,
  hasActiveTasks,
  ImportTask,
  plusGetMe,
  TaskStatus,
} from '@soundx/services';
import { Image, Input, ScrollView, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MiniPlayer from '../../components/MiniPlayer';
import SkeletonBlock from '../../components/SkeletonBlock';
import StackedCover from '../../components/StackedCover';
import XiaoAiIcon from '../../components/XiaoAiIcon';
import { useAuth } from '../../context/AuthContext';
import { usePlayer } from '../../context/PlayerContext';
import { usePlayMode } from '../../utils/playMode';
import { getImageUrl as buildImageUrl } from '../../utils/image';
import { isFnosSource } from '../../utils/mvSupport';
import { trackEvent } from '../../utils/tracking';
import './index.scss';

type TabType = 'playlists' | 'favorites' | 'history';
type SubTabType = 'track' | 'album';

export default function Personal() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { mode } = usePlayMode();
  const { playTrackList } = usePlayer();

  const [activeTab, setActiveTab] = useState<TabType>('playlists');
  const [activeSubTab, setActiveSubTab] = useState<SubTabType>('track');
  const [loading, setLoading] = useState(false);
  const [sourceType, setSourceType] = useState('AudioDock');
  // 飞牛音乐只支持单曲维度的收藏/播放历史（专辑接口返回空），因此只保留单曲视图
  const fnosSource = isFnosSource(sourceType);
  // 与 desktop 的 effectiveViewMode 同构：飞牛下强制单曲，避免残留 album 拉到空列表
  const effectiveSubTab: SubTabType = fnosSource ? 'track' : activeSubTab;

  const [playlists, setPlaylists] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  const [showMenu, setShowMenu] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creating, setCreating] = useState(false);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importTask, setImportTask] = useState<ImportTask | null>(null);
  const pollTimerRef = useRef<any>(null);
  // 任务中心入口显隐：仅当存在进行中任务时显示
  const [showTaskCenterEntry, setShowTaskCenterEntry] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const active = await hasActiveTasks();
        if (!cancelled) setShowTaskCenterEntry(active);
      } catch {
        /* 忽略网络异常 */
      }
    };
    check();
    const timer = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const [isVip, setIsVip] = useState(false);

  const refreshVipStatus = async () => {
    const plusToken = Taro.getStorageSync('plus_token');
    const plusUserId = Taro.getStorageSync('plus_user_id');

    if (!plusToken || !plusUserId) {
      setIsVip(false);
      Taro.setStorageSync('plus_vip_status', 'false');
      return;
    }

    let id: any = plusUserId;
    try {
      id = JSON.parse(plusUserId);
    } catch {}

    try {
      const res = await plusGetMe(id);
      const vipTier = res?.data?.data?.vipTier;
      const isVipUser = vipTier && vipTier !== 'NONE';
      setIsVip(!!isVipUser);
      
      Taro.setStorageSync('plus_vip_status', isVipUser ? 'true' : 'false');
      Taro.setStorageSync('plus_vip_data', JSON.stringify(res?.data?.data || {}));
      Taro.setStorageSync('plus_vip_updated_at', Date.now().toString());
    } catch (err) {
      console.warn('Failed to refresh vip status in personal page', err);
      // Fallback to local cache if network fails
      const isVipStr = Taro.getStorageSync('plus_vip_status');
      setIsVip(isVipStr === 'true');
    }
  };

  const refreshSourceType = () => {
    setSourceType(Taro.getStorageSync('currentSourceType') || 'AudioDock');
    refreshVipStatus();
  };

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (activeTab === 'playlists') {
        const res = await getPlaylists(mode as any, user.id);
        if (res.code === 200) setPlaylists(res.data);
      } else if (activeTab === 'favorites') {
        if (effectiveSubTab === 'track' && (mode === 'MUSIC' || fnosSource)) {
          const res = await getFavoriteTracks(user.id, 0, 1000, mode as any);
          if (res.code === 200) setFavorites(res.data.list.map((item: any) => item.track));
        } else {
          const res = await getFavoriteAlbums(user.id, 0, 1000, mode as any);
          if (res.code === 200) setFavorites(res.data.list.map((item: any) => item.album));
        }
      } else if (activeTab === 'history') {
        if (effectiveSubTab === 'track' && (mode === 'MUSIC' || fnosSource)) {
          const res = await getTrackHistory(user.id, 0, 1000, mode as any);
          if (res.code === 200) setHistory(res.data.list.map((item: any) => item.track));
        } else {
          const res = await getAlbumHistory(user.id, 0, 1000, mode as any);
          if (res.code === 200) setHistory(res.data.list.map((item: any) => item.album));
        }
      }
    } catch (error) {
      console.error('Failed to load personal data:', error);
    } finally {
      setLoading(false);
    }
  }, [activeTab, activeSubTab, effectiveSubTab, fnosSource, mode, user]);

  useEffect(() => {
    refreshSourceType();
  }, []);

  useEffect(() => {
    if (sourceType === 'Emby' && activeTab === 'history') {
      setActiveTab('playlists');
    }
  }, [sourceType, activeTab]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [activeTab, activeSubTab, mode, user, fnosSource, loadData]);

  const pollTaskStatus = async (taskId: string) => {
    try {
      const res = await getImportTask(taskId);
      if (res.code === 200 && res.data) {
        setImportTask(res.data);
        if (res.data.status === TaskStatus.SUCCESS) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setTimeout(() => setShowImportModal(false), 2000);
          loadData();
        } else if (res.data.status === TaskStatus.FAILED) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        }
      }
    } catch (error) {
      console.error('Poll error:', error);
    }
  };

  useEffect(() => {
    if (user) {
      getRunningImportTask().then((res) => {
        if (res.code === 200 && res.data) {
          const taskId = res.data.id;
          setImportTask(res.data);
          setShowImportModal(true);
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = setInterval(() => pollTaskStatus(taskId), 1500);
        }
      });
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [user]);

  const handleCreatePlaylist = async () => {
    if (!user || !newPlaylistName.trim()) return;
    setCreating(true);
    try {
      const res = await createPlaylist(newPlaylistName.trim(), mode as any, user.id);
      if (res.code === 200) {
        setShowCreateModal(false);
        setNewPlaylistName('');
        await loadData();
        Taro.navigateTo({ url: `/pages/playlist/index?id=${res.data.id}` });
      } else {
        Taro.showToast({ title: res.message || t('personal.createFailed'), icon: 'none' });
      }
    } catch (error) {
      Taro.showToast({ title: t('personal.createFailed'), icon: 'none' });
    } finally {
      setCreating(false);
    }
  };

  const startImportTask = async (taskFactory: () => Promise<any>, initialMode: 'incremental' | 'full' | 'compact') => {
    try {
      const taskRes = await taskFactory();
      if (taskRes.code === 200 && taskRes.data) {
        const taskId = taskRes.data.id;
        setShowImportModal(true);
        setImportTask({
          id: taskId,
          status: TaskStatus.INITIALIZING,
          mode: initialMode,
          message: initialMode === 'compact' ? t('personal.initializingCompact') : t('personal.initializing'),
        } as ImportTask);
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = setInterval(() => pollTaskStatus(taskId), 1500);
      } else {
        Taro.showToast({ title: taskRes.message || t('common.taskCreateFailed'), icon: 'none' });
      }
    } catch (error) {
      Taro.showToast({ title: t('common.taskCreateFailed'), icon: 'none' });
    }
  };

  const handleOpenTtsTasks = async () => {
    setShowMenu(false);

    if (isVip) {
      Taro.navigateTo({ url: '/pages/tts/tasks/index' });
      return;
    }

    const modalRes = await Taro.showModal({
      title: t('common.memberFeature'),
      content: t('common.ttsVipRequired'),
      confirmText: t('common.goActivate'),
      cancelText: t('common.cancel'),
    });

    if (modalRes.confirm) {
      Taro.navigateTo({ url: '/pages/member/benefits/index' });
    }
  };

  const handleUpdateLibrary = async (updateMode: 'incremental' | 'full' | 'compact') => {
    setShowMenu(false);
    const contentMap = {
      incremental: t('personal.incrementalUpdateDesc'),
      full: t('personal.fullUpdateDesc'),
      compact: t('personal.compactDataDesc'),
    };
    const titleMap = {
      incremental: t('personal.confirmIncremental'),
      full: t('personal.confirmFull'),
      compact: t('personal.confirmCompact'),
    };

    const modalRes = await Taro.showModal({
      title: titleMap[updateMode],
      content: contentMap[updateMode],
    });

    if (!modalRes.confirm) return;

    await startImportTask(
      () => (updateMode === 'compact' ? createCompactTask() : createImportTask({ mode: updateMode })),
      updateMode,
    );
  };

  // 占位图各页不同，这里绑死；调用点传显示尺寸（rpx 值 ≈ 目标设备像素，见 utils/image.ts）
  const getImageUrl = (url: string | null, width = 300) =>
    buildImageUrl(url, "https://picsum.photos/100/100", width);

  const getListData = () => {
    if (activeTab === 'playlists') return playlists;
    if (activeTab === 'favorites') return favorites;
    if (activeTab === 'history') return history;
    return [];
  };

  const getEmptyText = () => {
    return loading ? t('common.loading') : t('common.noData');
  };

  const renderList = () => {
    if (loading) {
      return Array.from({ length: 6 }).map((_, index) => (
        <View key={`skeleton-${index}`} className='item-row'>
          <View className='cover-wrapper'>
            <SkeletonBlock width={100} height={100} borderRadius={12} />
          </View>
          <View className='item-info'>
            <SkeletonBlock
              className='skeleton-mb'
              width={index % 3 === 0 ? '58%' : index % 3 === 1 ? '72%' : '66%'}
              height={30}
              borderRadius={8}
            />
            <SkeletonBlock
              width={index % 2 === 0 ? '42%' : '55%'}
              height={24}
              borderRadius={6}
            />
          </View>
        </View>
      ));
    }

    const data = getListData();

    if (data.length === 0) {
      return <View className='center-msg'><Text>{getEmptyText()}</Text></View>;
    }

    return data.map((item) => {
      const isPlaylist = activeTab === 'playlists';
      const isAlbum = activeTab !== 'playlists' && !fnosSource && (mode === 'AUDIOBOOK' || effectiveSubTab === 'album');

      return (
        <View
          key={`${item.id}-${activeTab}-${effectiveSubTab}`}
          className='item-row'
          onClick={() => {
            if (isPlaylist) {
              Taro.navigateTo({ url: `/pages/playlist/index?id=${item.id}` });
            } else if (isAlbum) {
              Taro.navigateTo({ url: `/pages/album/index?id=${item.id}` });
            } else {
              const list = activeTab === 'favorites' ? favorites : history;
              const index = list.findIndex((track) => track.id === item.id);
              playTrackList(list, index);
            }
          }}
        >
          {isPlaylist ? (
            <StackedCover tracks={item.tracks || []} />
          ) : (
            <View className='cover-wrapper'>
              <Image src={getImageUrl(item.cover, 100)} className='item-cover' mode='aspectFill' webp />
              {isAlbum && activeTab === 'history' && mode === 'AUDIOBOOK' && item.progress > 0 && (
                <View className='progress-bar-mini'>
                  <View className='progress-fill' style={{ width: `${item.progress}%` }} />
                </View>
              )}
            </View>
          )}
          <View className='item-info'>
            <Text className='item-name' numberOfLines={1}>{item.name}</Text>
            <Text className='item-sub' numberOfLines={1}>
              {isPlaylist
                ? `${item._count?.tracks || item.tracks?.length || 0} 首`
                : isAlbum
                  ? (item.artist || '')
                  : item.artist}
            </Text>
          </View>
        </View>
      );
    });
  };

  const importStatusText = () => {
    if (importTask?.message && importTask.status !== TaskStatus.SUCCESS && importTask.status !== TaskStatus.FAILED) {
      return importTask.message;
    }
    if (importTask?.status === TaskStatus.INITIALIZING) {
      return importTask?.mode === 'compact' ? t('personal.initializingCompact') : t('personal.initializing');
    }
    if (importTask?.status === TaskStatus.PREPARING) return t('personal.preparingEnv');
    if (importTask?.status === TaskStatus.PARSING) return t('personal.parsingMedia');
    if (importTask?.status === TaskStatus.SUCCESS) {
      return importTask?.mode === 'compact' ? t('personal.compactComplete') : t('personal.importComplete');
    }
    if (importTask?.status === TaskStatus.FAILED) {
      return importTask?.mode === 'compact' ? t('personal.compactFailed') : t('personal.importFailed');
    }
    return t('common.loading');
  };

  return (
    <View className='personal-container'>
      <View className='header-actions'>
        <View className='left-actions'>
          <View className='action-btn' onClick={() => setShowMenu(!showMenu)}>
            <Text className='icon icon-add' />
          </View>
          <View className='action-btn' onClick={() => {
            trackEvent({ feature: 'scan_login', eventName: 'scan_login_entry_click' });
            Taro.navigateTo({ url: '/pages/scan/index' });
          }}>
            <Text className='header-icon icon icon-scan' />
          </View>
        </View>
        {showMenu && (
          <View className='menu-dropdown'>
            <View className='menu-item' onClick={() => { setShowMenu(false); setShowCreateModal(true); }}>
              <Text>{t('personal.createPlaylist')}</Text>
            </View>
            <View className='menu-item' onClick={() => handleUpdateLibrary('incremental')}>
              <Text>{t('personal.incrementalUpdate')}</Text>
            </View>
            <View className='menu-item' onClick={() => handleUpdateLibrary('full')}>
              <Text>{t('personal.fullUpdate')}</Text>
            </View>
            {sourceType !== 'Emby' && mode !== 'MUSIC' && (
              <View className='menu-item' onClick={handleOpenTtsTasks}>
                <Text>{t('personal.ttsConversion')}</Text>
              </View>
            )}
            <View className='menu-item' onClick={() => handleUpdateLibrary('compact')}>
              <Text>{t('personal.compactData')}</Text>
            </View>
          </View>
        )}
        <View className='right-actions'>
          {showTaskCenterEntry && (
            <View className='action-btn' onClick={() => Taro.navigateTo({ url: '/pages/task-center/index' })}>
              <Text className='header-icon icon icon-task' />
            </View>
          )}
          <View className='action-btn' onClick={() => Taro.navigateTo({ url: '/pages/source-manage/index' })}>
            <Text className='header-icon icon icon-server' />
          </View>
          <View className='action-btn' onClick={() => Taro.navigateTo({ url: '/pages/mi-speaker/index' })}>
            <XiaoAiIcon size={22} />
          </View>
          <View className='action-btn' onClick={() => Taro.navigateTo({ url: '/pages/settings/index' })}>
            <Text className='icon icon-settings' />
          </View>
        </View>
      </View>

      <View className='user-profile'>
        <Image src={getImageUrl((user as any)?.avatar || null, 128)} className='avatar' mode='aspectFill' webp />
        <View className='username-row'>
          <Text className='username'>
            {user?.username || t('common.notLoggedIn')}
          </Text>
          {user && (
            <View
              className={`vip-crown ${isVip ? 'active' : ''}`}
              onClick={() => {
                const plusToken = Taro.getStorageSync('plus_token');
                if (plusToken) {
                  if (isVip) {
                    Taro.navigateTo({ url: '/pages/member/detail/index' });
                  } else {
                    trackEvent({ feature: 'scan_login', eventName: 'scan_login_member_benefits_redirect' });
                    Taro.navigateTo({ url: '/pages/member/benefits/index' });
                  }
                } else {
                  trackEvent({ feature: 'scan_login', eventName: 'scan_login_member_login_redirect' });
                  Taro.navigateTo({ url: '/pages/member/login/index' });
                }
              }}
            >
              <Text className={`icon ${isVip ? 'icon-crown-gold' : 'icon-crown'}`} style={{ fontSize: '32rpx', marginLeft: '8rpx', color: isVip ? '' : '#11181C' }} />
            </View>
          )}
        </View>
        {!user && <View className='login-btn' onClick={() => Taro.navigateTo({ url: '/pages/login/index' })}>{t('common.goLogin')}</View>}
      </View>

      <View className='tabs-row'>
        {[
          { key: 'playlists', label: t('nav.playlists') },
          { key: 'favorites', label: t('common.favorites') },
          { key: 'history', label: t('common.listened'), hidden: sourceType === 'Emby' },
        ]
          .filter((tab) => !tab.hidden)
          .map((tab) => (
            <View key={tab.key} className={`tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key as TabType)}>
              <Text>{tab.label}</Text>
            </View>
          ))}
      </View>

      {(mode === 'MUSIC' || fnosSource) && (activeTab === 'favorites' || activeTab === 'history') && (
        <View className='sub-tabs-row'>
          {!fnosSource && (
            <View className={`sub-tab ${effectiveSubTab === 'album' ? 'active' : ''}`} onClick={() => setActiveSubTab('album')}>
              <Text>{t('nav.albums')}</Text>
            </View>
          )}
          <View className={`sub-tab ${effectiveSubTab === 'track' ? 'active' : ''}`} onClick={() => setActiveSubTab('track')}>
            <Text>{t('nav.tracks')}</Text>
          </View>
        </View>
      )}

      <ScrollView
        scrollY
        className='list-scroll'
        refresherEnabled
        onRefresherRefresh={() => {
          refreshSourceType();
          if (user) {
            loadData();
          }
        }}
        refresherTriggered={loading}
      >
        <View className='list-content'>
          {renderList()}
          <View className='page-bottom-spacer' />
        </View>
      </ScrollView>

      {showCreateModal && (
        <View className='modal-overlay' onClick={() => setShowCreateModal(false)}>
          <View className='modal-content' onClick={(e) => e.stopPropagation()}>
            <Text className='modal-title'>{t('personal.createPlaylist')}</Text>
            <Input
              className='modal-input'
              placeholder={t('playlist.namePlaceholder')}
              value={newPlaylistName}
              onInput={(e) => setNewPlaylistName(e.detail.value)}
              focus
            />
            <View className='modal-btns'>
              <View className='modal-btn cancel' onClick={() => setShowCreateModal(false)}>{t('common.cancel')}</View>
              <View className='modal-btn confirm' onClick={handleCreatePlaylist}>
                {creating ? t('common.creating') : t('common.confirm')}
              </View>
            </View>
          </View>
        </View>
      )}

      {showImportModal && (
        <View className='modal-overlay'>
          <View className='modal-content'>
            <Text className='modal-title'>{importTask?.mode === 'compact' ? t('personal.compactProgress') : t('personal.importProgress')}</Text>
            <View className='status-row'>
              <Text>{t('common.status')}</Text>
              <Text className='status-val'>{importStatusText()}</Text>
            </View>
            <View className='progress-container'>
              <View
                className='progress-fill'
                style={{ width: `${importTask?.total ? Math.round((importTask.current || 0) / importTask.total * 100) : 0}%` }}
              />
            </View>
            <Text className='progress-text'>
              {t('common.progress')}{importTask?.current || 0} / {importTask?.total || 0}
            </Text>
            {importTask?.mode !== 'compact' && (
              <View style={{ marginTop: '10rpx' }}>
                <Text className='progress-text' style={{ fontSize: '24rpx', color: '#666' }}>
                  {t('personal.localFiles')}: {importTask?.localCurrent || 0} / {importTask?.localTotal || 0}
                </Text>
                <Text className='progress-text' style={{ fontSize: '24rpx', color: '#666' }}>
                  {t('personal.webdavFiles')}: {importTask?.webdavCurrent || 0} / {importTask?.webdavTotal || 0}
                </Text>
                <Text className='progress-text' style={{ fontSize: '24rpx', color: '#666' }}>
                  {t('personal.mvFiles')}: {importTask?.mvCurrent || 0} / {importTask?.mvTotal || 0}
                </Text>
              </View>
            )}
            {importTask?.status === TaskStatus.FAILED && importTask?.message ? (
              <Text className='error-text'>{importTask.message}</Text>
            ) : null}
            <View className='modal-btns'>
              <View className='modal-btn single' onClick={() => setShowImportModal(false)}>{t('common.runInBackground')}</View>
            </View>
          </View>
        </View>
      )}
      <MiniPlayer />
    </View>
  );
}
