import {
  TASK_CATEGORY_I18N_KEY,
  TASK_STATUS_I18N_KEY,
  TtsTask,
  UnifiedTask,
  UnifiedTaskStatus,
  deleteTtsTask,
  fetchAllTasks,
  isTaskActive,
  pauseTtsTask,
  resumeTtsTask,
} from '@soundx/services';
import { ScrollView, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BottomTabBar from '../../components/BottomTabBar';
import MiniPlayer from '../../components/MiniPlayer';
import './index.scss';

type Filter = 'all' | 'active';

const STATUS_COLOR: Record<UnifiedTaskStatus, string> = {
  pending: '#13c2c2',
  processing: '#faad14',
  paused: '#8c8c8c',
  success: '#52c41a',
  failed: '#ff4d4f',
};

// 轮询策略：有进行中任务时 2s 高频刷新；没有时退到 30s 慢轮询（避免空跑打爆接口）
const ACTIVE_POLL_MS = 2000;
const IDLE_POLL_MS = 30000;

export default function TaskCenter() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<UnifiedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const tasksRef = useRef<UnifiedTask[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTasks = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const list = await fetchAllTasks();
      tasksRef.current = list;
      setTasks(list);
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    } finally {
      if (showLoading) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 根据当前任务列表自适应调度下一次轮询
  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const hasActive = tasksRef.current.some(isTaskActive);
    const delay = hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    timerRef.current = setTimeout(async () => {
      await fetchTasks(false);
      scheduleNext();
    }, delay);
  }, [fetchTasks]);

  useEffect(() => {
    fetchTasks(true).then(() => scheduleNext());
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchTasks, scheduleNext]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTasks(false);
    scheduleNext();
  }, [fetchTasks, scheduleNext]);

  const handleTtsAction = async (
    action: 'pause' | 'resume' | 'delete',
    id: string
  ) => {
    try {
      if (action === 'delete') {
        const confirm = await Taro.showModal({
          title: t('taskCenter.delete'),
          content: t('taskCenter.deleteConfirm'),
        });
        if (confirm.confirm) {
          await deleteTtsTask(id);
          await fetchTasks(false);
          scheduleNext();
        }
      } else if (action === 'pause') {
        await pauseTtsTask(id);
        await fetchTasks(false);
        scheduleNext();
      } else if (action === 'resume') {
        await resumeTtsTask(id);
        await fetchTasks(false);
        scheduleNext();
      }
    } catch (error) {
      console.error(`Failed to ${action} task:`, error);
      Taro.showToast({ title: t('taskCenter.actionFailed'), icon: 'none' });
    }
  };

  const filteredTasks =
    filter === 'all' ? tasks : tasks.filter(isTaskActive);

  const displayTitle = (item: UnifiedTask) =>
    item.source === 'tts' && item.title
      ? item.title
      : t(TASK_CATEGORY_I18N_KEY[item.category]);

  const filterItems = [
    { labelKey: 'taskCenter.all', value: 'all' as Filter },
    { labelKey: 'taskCenter.active', value: 'active' as Filter },
  ];

  return (
    <View className='tts-tasks-container'>
      <View className='header'>
        <View className='back-btn' onClick={() => Taro.navigateBack()}>
          <Text className='back-icon'>←</Text>
        </View>
        <Text className='header-title'>{t('taskCenter.title')}</Text>
        <View style={{ width: '60rpx' }} />
      </View>

      <View className='filter-container'>
        <ScrollView scrollX enableFlex className='filter-scroll'>
          <View className='filter-list'>
            {filterItems.map((item) => (
              <View
                key={item.value}
                className={`filter-item ${filter === item.value ? 'active' : ''}`}
                onClick={() => setFilter(item.value)}
              >
                <Text
                  className={`filter-text ${filter === item.value ? 'active' : ''}`}
                >
                  {t(item.labelKey)}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      <ScrollView
        scrollY
        className='content-scroll'
        refresherEnabled
        onRefresherRefresh={onRefresh}
        refresherTriggered={refreshing}
      >
        {loading ? (
          <View className='loading-container'>
            <Text className='loading-text'>{t('common.loading')}</Text>
          </View>
        ) : filteredTasks.length === 0 ? (
          <View className='empty-container'>
            <Text className='empty-icon'>📄</Text>
            <Text className='empty-text'>{t('taskCenter.empty')}</Text>
          </View>
        ) : (
          filteredTasks.map((item) => {
            const statusColor = STATUS_COLOR[item.status];
            const isTts = item.source === 'tts';
            const raw = item.raw as TtsTask;
            return (
              <View key={`${item.source}:${item.id}`} className='task-card'>
                <View className='task-header'>
                  <View className='task-info'>
                    <Text className='book-name'>{displayTitle(item)}</Text>
                    <Text className='author'>
                      {t(TASK_CATEGORY_I18N_KEY[item.category])}
                      {item.subtitle ? ` · ${item.subtitle}` : ''}
                    </Text>
                  </View>
                  <View
                    className='status-tag'
                    style={{ backgroundColor: statusColor + '20' }}
                  >
                    <Text className='status-text' style={{ color: statusColor }}>
                      {t(TASK_STATUS_I18N_KEY[item.status])}
                    </Text>
                  </View>
                </View>

                <View className='progress-container'>
                  <View className='progress-bar-bg'>
                    <View
                      className='progress-bar-fill'
                      style={{
                        width: `${item.progress}%`,
                        backgroundColor: statusColor,
                      }}
                    />
                  </View>
                  <View className='progress-text-row'>
                    <Text className='progress-count'>
                      {isTts
                        ? `${raw.completed_chapters} / ${raw.total_chapters} ${t('taskCenter.chapters')}`
                        : ''}
                    </Text>
                    <Text className='progress-percent'>{item.progress}%</Text>
                  </View>
                </View>

                {isTts && (
                  <>
                    <View className='divider' />
                    <View className='action-row'>
                      <Text className='time'>
                        {item.createdAt
                          ? new Date(item.createdAt).toLocaleString()
                          : ''}
                      </Text>
                      <View className='button-group'>
                        {item.status === 'processing' && (
                          <View
                            className='action-btn'
                            onClick={() => handleTtsAction('pause', item.id)}
                          >
                            <Text className='action-icon'>⏸</Text>
                          </View>
                        )}
                        {(item.status === 'paused' ||
                          item.status === 'failed' ||
                          item.status === 'pending') && (
                          <View
                            className='action-btn'
                            onClick={() => handleTtsAction('resume', item.id)}
                          >
                            <Text className='action-icon'>
                              {item.status === 'failed' ? '🔄' : '▶'}
                            </Text>
                          </View>
                        )}
                        <View
                          className='action-btn'
                          onClick={() => handleTtsAction('delete', item.id)}
                        >
                          <Text className='action-icon delete'>🗑</Text>
                        </View>
                      </View>
                    </View>
                  </>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <BottomTabBar />
      <MiniPlayer />
    </View>
  );
}
