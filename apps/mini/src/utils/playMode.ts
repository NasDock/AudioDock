import Taro from '@tarojs/taro';
import { useState, useEffect, useCallback } from 'react';

export type PlayMode = 'MUSIC' | 'AUDIOBOOK';

const CONTENT_MODE_KEY = 'contentMode';

export const usePlayMode = () => {
  const [mode, setModeState] = useState<PlayMode>('MUSIC');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    loadMode();
  }, []);

  const loadMode = () => {
    try {
      // Audiobookshelf 全部是有声书，强制 AUDIOBOOK，否则书单会按 MUSIC 过滤成空
      const sourceType = Taro.getStorageSync('currentSourceType');
      if (sourceType === 'Audiobookshelf') {
        setModeState('AUDIOBOOK');
        return;
      }
      const saved = Taro.getStorageSync(CONTENT_MODE_KEY);
      if (saved === 'MUSIC' || saved === 'AUDIOBOOK') {
        setModeState(saved);
      }
    } catch (error) {
      console.error('Failed to load play mode:', error);
    } finally {
      setIsLoaded(true);
    }
  };

  const setMode = useCallback(async (newMode: PlayMode) => {
    setModeState(newMode);
    try {
      Taro.setStorageSync(CONTENT_MODE_KEY, newMode);
    } catch (error) {
      console.error('Failed to save play mode:', error);
    }
  }, []);

  return {
    mode,
    setMode,
    isLoaded,
  };
};
