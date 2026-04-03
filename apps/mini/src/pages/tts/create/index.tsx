import {
  createTtsBatchTasks,
  getTtsLocalFiles,
  getTtsPreviewUrl,
  getTtsVoices,
  identifyTtsBatch,
  TtsFileItem,
  TtsReviewItem,
  TtsVoice,
} from '@soundx/services';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import MiniPlayer from '../../../components/MiniPlayer';
import { getBaseURL } from '../../../utils/request';
import './index.scss';

type ViewMode = 'select' | 'review';

export default function TtsCreate() {
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<ViewMode>('select');
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [localFiles, setLocalFiles] = useState<TtsFileItem[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('zh-CN-XiaoxiaoNeural');
  const [reviewData, setReviewData] = useState<TtsReviewItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const audioContextRef = useRef<any>(null);

  useEffect(() => {
    fetchVoices();
    fetchLocalFiles();
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.stop();
        audioContextRef.current = null;
      }
    };
  }, []);

  const fetchVoices = async () => {
    try {
      const data = await getTtsVoices();
      if (Array.isArray(data)) {
        setVoices(data);
      }
    } catch (err) {
      console.error('Failed to fetch voices', err);
    }
  };

  const fetchLocalFiles = async () => {
    setLoading(true);
    try {
      const res = await getTtsLocalFiles();
      if (res.success) {
        setLocalFiles(res.files);
      }
    } catch (err) {
      console.error('Failed to fetch local files', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = (voice: string) => {
    if (previewLoading) return;
    setPreviewLoading(voice);

    try {
      if (audioContextRef.current) {
        audioContextRef.current.stop();
      }

      const audioContext = wx.createInnerAudioContext();
      audioContextRef.current = audioContext;

      const previewUrl = getBaseURL() + getTtsPreviewUrl(voice);
      audioContext.src = previewUrl;

      audioContext.onPlay(() => {
        console.log('Preview playing');
      });

      audioContext.onEnded(() => {
        setPreviewLoading(null);
      });

      audioContext.onError((err: any) => {
        console.error('Preview failed', err);
        Taro.showToast({ title: '试听失败', icon: 'none' });
        setPreviewLoading(null);
      });

      audioContext.play();
      setPreviewLoading(null);
    } catch (err) {
      console.error('Preview failed', err);
      Taro.showToast({ title: '试听失败', icon: 'none' });
      setPreviewLoading(null);
    }
  };

  const toggleFileSelection = (path: string) => {
    setSelectedPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  const handleNextStep = async () => {
    if (selectedPaths.length === 0) {
      Taro.showToast({ title: '请选择至少一个文件', icon: 'none' });
      return;
    }

    setLoading(true);
    try {
      const res = await identifyTtsBatch(selectedPaths);
      if (res.success && res.results) {
        const reviewed: TtsReviewItem[] = res.results.map((item, index) => ({
          key: selectedPaths[index],
          filename: item.filename,
          full_path: item.full_path,
          title: item.title || item.filename.replace(/\.[^/.]+$/, ''),
          author: item.author || '未知作者',
          voice: selectedVoice,
        }));
        setReviewData(reviewed);
        setView('review');
      } else {
        Taro.showToast({ title: '识别失败', icon: 'none' });
      }
    } catch (err) {
      console.error('Identify failed', err);
      Taro.showToast({ title: '识别失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const updateReviewItem = (key: string, field: 'title' | 'author', value: string) => {
    setReviewData((prev) =>
      prev.map((item) =>
        item.key === key ? { ...item, [field]: value } : item
      )
    );
  };

  const handleCreateTasks = async () => {
    if (reviewData.some((item) => !item.title.trim())) {
      Taro.showToast({ title: '请填写所有标题', icon: 'none' });
      return;
    }

    setLoading(true);
    try {
      const files = reviewData.map((item) => ({
        full_path: item.full_path,
        title: item.title,
        author: item.author,
        voice: item.voice,
      }));

      const res = await createTtsBatchTasks(files);
      if (res.success) {
        Taro.showToast({ title: `成功创建 ${res.count} 个任务`, icon: 'success' });
        Taro.redirectTo({ url: '/pages/tts/tasks/index' });
      } else {
        Taro.showToast({ title: '创建失败', icon: 'none' });
      }
    } catch (err) {
      console.error('Create failed', err);
      Taro.showToast({ title: '创建失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const renderSelectView = () => (
    <>
      <View className='section'>
        <View className='section-header'>
          <Text className='section-title'>选择音色</Text>
        </View>
        <ScrollView scrollX className='voice-scroll'>
          <View className='voice-list'>
            {voices.map((voice) => (
              <View
                key={voice.value}
                className={`voice-item ${selectedVoice === voice.value ? 'active' : ''}`}
                onClick={() => setSelectedVoice(voice.value)}
              >
                <Text className='voice-label'>{voice.label}</Text>
                <View
                  className='voice-preview-btn'
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePreview(voice.value);
                  }}
                >
                  <Text className='voice-preview-icon'>
                    {previewLoading === voice.value ? '🔄' : '▶'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      <View className='section'>
        <View className='section-header'>
          <Text className='section-title'>选择文件</Text>
          <Text className='section-count'>{selectedPaths.length} 已选</Text>
        </View>
        <View className='file-list'>
          {loading && localFiles.length === 0 ? (
            <View className='loading-container'>
              <Text className='loading-text'>加载中...</Text>
            </View>
          ) : localFiles.length === 0 ? (
            <View className='empty-container'>
              <Text className='empty-text'>暂无本地文件</Text>
            </View>
          ) : (
            localFiles.map((file) => (
              <View
                key={file.full_path}
                className={`file-item ${selectedPaths.includes(file.full_path) ? 'selected' : ''}`}
                onClick={() => toggleFileSelection(file.full_path)}
              >
                <View className='file-checkbox'>
                  {selectedPaths.includes(file.full_path) && (
                    <Text className='checkbox-check'>✓</Text>
                  )}
                </View>
                <View className='file-info'>
                  <Text className='file-name' numberOfLines={1}>{file.filename}</Text>
                  {file.is_generated && (
                    <View className='generated-tag'>
                      <Text className='generated-text'>已转换</Text>
                    </View>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
      </View>

      <View className='bottom-actions'>
        <View
          className={`next-btn ${selectedPaths.length === 0 ? 'disabled' : ''}`}
          onClick={handleNextStep}
        >
          <Text className='next-btn-text'>下一步</Text>
        </View>
      </View>
    </>
  );

  const renderReviewView = () => (
    <>
      <View className='section'>
        <View className='section-header'>
          <Text className='section-title'>确认任务信息</Text>
        </View>
        <View className='review-list'>
          {reviewData.map((item) => (
            <View key={item.key} className='review-item'>
              <Text className='review-label'>标题</Text>
              <View className='review-input-wrapper'>
                <View className='review-input'>
                  <Text className='review-input-text'>{item.title}</Text>
                </View>
              </View>
              <Text className='review-label' style={{ marginTop: '20rpx' }}>作者</Text>
              <View className='review-input-wrapper'>
                <View className='review-input'>
                  <Text className='review-input-text'>{item.author}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View className='bottom-actions'>
        <View className='back-btn' onClick={() => setView('select')}>
          <Text className='back-btn-text'>返回</Text>
        </View>
        <View
          className={`create-btn ${loading ? 'disabled' : ''}`}
          onClick={handleCreateTasks}
        >
          <Text className='create-btn-text'>创建任务</Text>
        </View>
      </View>
    </>
  );

  return (
    <View className='tts-create-container'>
      <View className='header'>
        <View className='back-btn' onClick={() => Taro.navigateBack()}>
          <Text className='back-icon'>←</Text>
        </View>
        <Text className='header-title'>
          {view === 'select' ? '创建 TTS 任务' : '确认信息'}
        </Text>
        <View style={{ width: '80rpx' }} />
      </View>

      <ScrollView scrollY className='content-scroll'>
        {view === 'select' ? renderSelectView() : renderReviewView()}
      </ScrollView>

      <MiniPlayer />
    </View>
  );
}
