import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { AudioQuality } from '../services/trackQuality';
import { setTrackingEnabled } from '../services/tracking';

interface SettingsState {
  acceptRelay: boolean;
  acceptSync: boolean;
  cacheEnabled: boolean;
  autoOrientation: boolean;
  autoTheme: boolean;
  carModeEnabled: boolean;
  carLayoutMode: boolean;
  carPanelsSwapped: boolean;
  screenBottomInset: number;
  voiceAssistantEnabled: boolean;
  activityNotifyEnabled: boolean;
  recommendationLikeRatio: number;
  eqGains: number[];
  experienceProgramEnabled: boolean;
  internalPlaybackQuality: AudioQuality;
  externalPlaybackQuality: AudioQuality;
}

interface SettingsContextType extends SettingsState {
  updateSetting: (key: keyof SettingsState, value: any) => Promise<void>;
  isLoading: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const defaultSettings: SettingsState = {
    acceptRelay: true,
    acceptSync: true,
    // 秒播优化：默认开启本地缓存，已播曲目落盘后直接 file:// 秒播，不走网络。
    // 用户可在设置里手动关闭；已持久化的旧设置（cacheEnabled:false）会覆盖此默认值，不受影响。
    cacheEnabled: true,
    autoOrientation: true,
    autoTheme: true,
    carModeEnabled: false,
    carLayoutMode: false,
    carPanelsSwapped: false,
    screenBottomInset: 0,
    voiceAssistantEnabled: false,
    activityNotifyEnabled: true,
    recommendationLikeRatio: 50,
    eqGains: [0, 0, 0, 0, 0],
    experienceProgramEnabled: true,
    internalPlaybackQuality: 'high',
    externalPlaybackQuality: 'standard',
  };
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const saved = await AsyncStorage.getItem('mobile-settings');
        if (saved) {
          const parsed = JSON.parse(saved);
          const nextSettings = { ...defaultSettings, ...parsed };
          setSettings(nextSettings);
          setTrackingEnabled(!!nextSettings.experienceProgramEnabled);
        }
      } catch (e) {
        console.error('Failed to load settings', e);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const updateSetting = async (key: keyof SettingsState, value: any) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      AsyncStorage.setItem('mobile-settings', JSON.stringify(next)).catch((e) => {
        console.error('Failed to save settings', e);
      });
      if (key === 'experienceProgramEnabled') {
        setTrackingEnabled(!!value);
      }
      return next;
    });
  };

  return (
    <SettingsContext.Provider value={{ ...settings, updateSetting, isLoading }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
