import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface SettingsState {
  acceptRelay: boolean;
  acceptSync: boolean;
  cacheEnabled: boolean;
  autoOrientation: boolean;
  autoTheme: boolean;
  voiceAssistantEnabled: boolean;
  recommendationLikeRatio: number;
  eqGains: number[];
}

interface SettingsContextType extends SettingsState {
  updateSetting: (key: keyof SettingsState, value: any) => Promise<void>;
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
    voiceAssistantEnabled: false,
    recommendationLikeRatio: 50,
    eqGains: [0, 0, 0, 0, 0],
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const saved = await AsyncStorage.getItem('mobile-settings');
      if (saved) {
        setSettings(prev => ({ ...prev, ...JSON.parse(saved) }));
      }
    } catch (e) {
      console.error('Failed to load settings', e);
    } finally {
      setIsLoading(false);
    }
  };

  const updateSetting = async (key: keyof SettingsState, value: any) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    try {
      await AsyncStorage.setItem('mobile-settings', JSON.stringify(newSettings));
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
