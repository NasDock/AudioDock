/**
 * Settings Store - App Settings State Management
 * Uses in-memory state.
 */

// ==================== Theme Mode ====================
export enum ThemeMode {
  LIGHT = 'light',
  DARK = 'dark',
  FESTIVE = 'festive',
  SYSTEM = 'system'
}

// ==================== Content Mode ====================
export enum ContentMode {
  MUSIC = 'MUSIC',
  AUDIOBOOK = 'AUDIOBOOK'
}

// ==================== Settings State ====================
export interface SettingsState {
  theme: ThemeMode;
  autoOrientation: boolean;
  carLayoutMode: boolean;
  voiceAssistantEnabled: boolean;
  contentMode: ContentMode;
  sleepTimerMinutes: number | null;
  equalizerPreset: string;
  lyricsFontSize: number;
  downloadQuality: string;
  cacheSize: number; // bytes
  autoDownload: boolean;
  notifyOnUpdate: boolean;
  language: string;
  serverAddress: string;
}

// ==================== Default State ====================
const DEFAULT_SETTINGS: SettingsState = {
  theme: ThemeMode.SYSTEM,
  autoOrientation: true,
  carLayoutMode: false,
  voiceAssistantEnabled: false,
  contentMode: ContentMode.MUSIC,
  sleepTimerMinutes: null,
  equalizerPreset: 'normal',
  lyricsFontSize: 16,
  downloadQuality: 'high',
  cacheSize: 500 * 1024 * 1024, // 500MB
  autoDownload: false,
  notifyOnUpdate: true,
  language: 'zh-CN',
  serverAddress: ''
};

// ==================== Settings Store ====================
export class SettingsStore {
  private static instance: SettingsStore;
  private state: SettingsState = {
    theme: DEFAULT_SETTINGS.theme,
    autoOrientation: DEFAULT_SETTINGS.autoOrientation,
    carLayoutMode: DEFAULT_SETTINGS.carLayoutMode,
    voiceAssistantEnabled: DEFAULT_SETTINGS.voiceAssistantEnabled,
    contentMode: DEFAULT_SETTINGS.contentMode,
    sleepTimerMinutes: DEFAULT_SETTINGS.sleepTimerMinutes,
    equalizerPreset: DEFAULT_SETTINGS.equalizerPreset,
    lyricsFontSize: DEFAULT_SETTINGS.lyricsFontSize,
    downloadQuality: DEFAULT_SETTINGS.downloadQuality,
    cacheSize: DEFAULT_SETTINGS.cacheSize,
    autoDownload: DEFAULT_SETTINGS.autoDownload,
    notifyOnUpdate: DEFAULT_SETTINGS.notifyOnUpdate,
    language: DEFAULT_SETTINGS.language,
    serverAddress: DEFAULT_SETTINGS.serverAddress
  };

  private constructor() {}

  public static getInstance(): SettingsStore {
    if (!SettingsStore.instance) {
      SettingsStore.instance = new SettingsStore();
    }
    return SettingsStore.instance;
  }

  /**
   * Get current settings state
   */
  public getState(): SettingsState {
    return {
      theme: this.state.theme,
      autoOrientation: this.state.autoOrientation,
      carLayoutMode: this.state.carLayoutMode,
      voiceAssistantEnabled: this.state.voiceAssistantEnabled,
      contentMode: this.state.contentMode,
      sleepTimerMinutes: this.state.sleepTimerMinutes,
      equalizerPreset: this.state.equalizerPreset,
      lyricsFontSize: this.state.lyricsFontSize,
      downloadQuality: this.state.downloadQuality,
      cacheSize: this.state.cacheSize,
      autoDownload: this.state.autoDownload,
      notifyOnUpdate: this.state.notifyOnUpdate,
      language: this.state.language,
      serverAddress: this.state.serverAddress
    };
  }

  /**
   * Update settings
   */
  public async updateSettings(partial: Partial<SettingsState>): Promise<void> {
    const current = this.getState();
    this.state = {
      theme: partial.theme !== undefined ? partial.theme : current.theme,
      autoOrientation: partial.autoOrientation !== undefined ? partial.autoOrientation : current.autoOrientation,
      carLayoutMode: partial.carLayoutMode !== undefined ? partial.carLayoutMode : current.carLayoutMode,
      voiceAssistantEnabled: partial.voiceAssistantEnabled !== undefined ? partial.voiceAssistantEnabled : current.voiceAssistantEnabled,
      contentMode: partial.contentMode !== undefined ? partial.contentMode : current.contentMode,
      sleepTimerMinutes: partial.sleepTimerMinutes !== undefined ? partial.sleepTimerMinutes : current.sleepTimerMinutes,
      equalizerPreset: partial.equalizerPreset !== undefined ? partial.equalizerPreset : current.equalizerPreset,
      lyricsFontSize: partial.lyricsFontSize !== undefined ? partial.lyricsFontSize : current.lyricsFontSize,
      downloadQuality: partial.downloadQuality !== undefined ? partial.downloadQuality : current.downloadQuality,
      cacheSize: partial.cacheSize !== undefined ? partial.cacheSize : current.cacheSize,
      autoDownload: partial.autoDownload !== undefined ? partial.autoDownload : current.autoDownload,
      notifyOnUpdate: partial.notifyOnUpdate !== undefined ? partial.notifyOnUpdate : current.notifyOnUpdate,
      language: partial.language !== undefined ? partial.language : current.language,
      serverAddress: partial.serverAddress !== undefined ? partial.serverAddress : current.serverAddress,
    };
  }

  /**
   * Set theme
   */
  public async setTheme(theme: ThemeMode): Promise<void> {
    await this.updateSettings({ theme });
  }

  /**
   * Set auto orientation
   */
  public async setAutoOrientation(enabled: boolean): Promise<void> {
    await this.updateSettings({ autoOrientation: enabled });
  }

  /**
   * Set car layout mode
   */
  public async setCarLayoutMode(enabled: boolean): Promise<void> {
    await this.updateSettings({ carLayoutMode: enabled });
  }

  /**
   * Set voice assistant
   */
  public async setVoiceAssistantEnabled(enabled: boolean): Promise<void> {
    await this.updateSettings({ voiceAssistantEnabled: enabled });
  }

  /**
   * Set content mode
   */
  public async setContentMode(mode: ContentMode): Promise<void> {
    await this.updateSettings({ contentMode: mode });
  }

  /**
   * Toggle content mode between MUSIC and AUDIOBOOK
   */
  public async toggleContentMode(): Promise<void> {
    const current = this.getState().contentMode;
    const next = current === ContentMode.MUSIC ? ContentMode.AUDIOBOOK : ContentMode.MUSIC;
    await this.setContentMode(next);
  }

  /**
   * Set sleep timer
   */
  public async setSleepTimer(minutes: number | null): Promise<void> {
    await this.updateSettings({ sleepTimerMinutes: minutes });
  }

  /**
   * Clear sleep timer
   */
  public async clearSleepTimer(): Promise<void> {
    await this.updateSettings({ sleepTimerMinutes: null });
  }

  /**
   * Set lyrics font size
   */
  public async setLyricsFontSize(size: number): Promise<void> {
    await this.updateSettings({ lyricsFontSize: size });
  }

  /**
   * Set server address
   */
  public async setServerAddress(address: string): Promise<void> {
    await this.updateSettings({ serverAddress: address });
  }

  /**
   * Set download quality
   */
  public async setDownloadQuality(quality: string): Promise<void> {
    await this.updateSettings({ downloadQuality: quality });
  }

  /**
   * Set auto download
   */
  public async setAutoDownload(enabled: boolean): Promise<void> {
    await this.updateSettings({ autoDownload: enabled });
  }

  /**
   * Set notify on update
   */
  public async setNotifyOnUpdate(enabled: boolean): Promise<void> {
    await this.updateSettings({ notifyOnUpdate: enabled });
  }

  /**
   * Set language
   */
  public async setLanguage(language: string): Promise<void> {
    await this.updateSettings({ language });
  }

  /**
   * Clear all settings to defaults
   */
  public async resetToDefaults(): Promise<void> {
    this.state = {
      theme: DEFAULT_SETTINGS.theme,
      autoOrientation: DEFAULT_SETTINGS.autoOrientation,
      carLayoutMode: DEFAULT_SETTINGS.carLayoutMode,
      voiceAssistantEnabled: DEFAULT_SETTINGS.voiceAssistantEnabled,
      contentMode: DEFAULT_SETTINGS.contentMode,
      sleepTimerMinutes: DEFAULT_SETTINGS.sleepTimerMinutes,
      equalizerPreset: DEFAULT_SETTINGS.equalizerPreset,
      lyricsFontSize: DEFAULT_SETTINGS.lyricsFontSize,
      downloadQuality: DEFAULT_SETTINGS.downloadQuality,
      cacheSize: DEFAULT_SETTINGS.cacheSize,
      autoDownload: DEFAULT_SETTINGS.autoDownload,
      notifyOnUpdate: DEFAULT_SETTINGS.notifyOnUpdate,
      language: DEFAULT_SETTINGS.language,
      serverAddress: DEFAULT_SETTINGS.serverAddress
    };
  }
}

// ==================== Singleton Export ====================
export const settingsStore = SettingsStore.getInstance();
