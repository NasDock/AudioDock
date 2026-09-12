import Taro from '@tarojs/taro';
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { AudioQuality } from '../services/trackQuality';

interface SettingsState {
  acceptRelay: boolean;
  acceptSync: boolean;
  cacheEnabled: boolean;
  autoOrientation: boolean;
  autoTheme: boolean;
  carModeEnabled: boolean;
  carLayoutMode: boolean;
  voiceAssistantEnabled: boolean;
  activityNotifyEnabled: boolean;
  recommendationLikeRatio: number;
  screenBottomInset: number;
  experienceProgramEnabled: boolean;
  externalPlaybackQuality: AudioQuality;
}

interface SettingsContextType extends SettingsState {
  updateSetting: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => Promise<void>;
  isLoading: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<SettingsState>({
    acceptRelay: true,
    acceptSync: true,
    cacheEnabled: false,
    autoOrientation: true,
    autoTheme: true,
    carModeEnabled: false,
    carLayoutMode: false,
    voiceAssistantEnabled: true,
    activityNotifyEnabled: true,
    recommendationLikeRatio: 50,
    screenBottomInset: 0,
    experienceProgramEnabled: true,
    externalPlaybackQuality: 'standard',
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const saved = Taro.getStorageSync('mini-settings');
      if (saved) {
        setSettings(prev => ({ ...prev, ...JSON.parse(saved) }));
      }
    } catch (e) {
      console.error('Failed to load settings', e);
    } finally {
      setIsLoading(false);
    }
  };

  const updateSetting = async <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    try {
      Taro.setStorageSync('mini-settings', JSON.stringify(newSettings));
    } catch (e) {
      console.error('Failed to save settings', e);
    }
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
