import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SettingsState {
  general: {
    autoLaunch: boolean;
    minimizeToTray: boolean;
    language: string;
    theme: 'system' | 'light' | 'dark';
    acceptRelay: boolean;
    acceptSync: boolean;
    recommendationLikeRatio: number;
  };
  desktopLyric: {
    enable: boolean;
    lockPosition: boolean;
    fontSize: number;
    fontColor: string;
    strokeWidth: number;
    strokeColor: string;
    shadow: boolean;
    alwaysOnTop: boolean;
    fontWeight: number;
    x?: number;
    y?: number;
  };
  download: {
    downloadPath: string;
    quality: '128k' | '320k' | 'flac';
    concurrentDownloads: number;
    cacheEnabled: boolean;
  };

  updateGeneral: (key: keyof SettingsState['general'], value: any) => void;
  updateDesktopLyric: (key: keyof SettingsState['desktopLyric'], value: any) => void;
  updateDownload: (key: keyof SettingsState['download'], value: any) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      general: {
        autoLaunch: false,
        minimizeToTray: true,
        language: 'zh-CN',
        theme: 'system',
        acceptRelay: true,
        acceptSync: true,
        recommendationLikeRatio: 50,
      },
      desktopLyric: {
        enable: false,
        lockPosition: false,
        fontSize: 28,
        fontColor: '#ffffff',
        strokeWidth: 2,
        strokeColor: '#000000',
        shadow: true,
        alwaysOnTop: true,
        fontWeight: 500,
      },
      download: {
        downloadPath: '~/Music/Downloads',
        quality: '320k',
        concurrentDownloads: 3,
        cacheEnabled: true,
      },

      updateGeneral: (key, value) => {
        set((state) => ({
          general: { ...state.general, [key]: value },
        }));

        if ((window as any).ipcRenderer) {
          if (key === 'autoLaunch') {
            (window as any).ipcRenderer.invoke('set-auto-launch', value);
          }
          if (key === 'minimizeToTray') {
            (window as any).ipcRenderer.send('settings:update-minimize-to-tray', value);
          }
        }
      },
      updateDesktopLyric: (key, value) => {
        set((state) => ({
          desktopLyric: { ...state.desktopLyric, [key]: value },
        }));

        if ((window as any).ipcRenderer) {
          if (key === "enable") {
            if (value) {
              (window as any).ipcRenderer.send("lyric:open", get().desktopLyric);
            } else {
              (window as any).ipcRenderer.send("lyric:close");
            }
          }
          if (key === "lockPosition") {
            (window as any).ipcRenderer.send("lyric:set-mouse-ignore", value);
          }
          (window as any).ipcRenderer.send("lyric:settings-update", { [key]: value });
        }
      },
      updateDownload: (key, value) => {
        set((state) => ({
          download: { ...state.download, [key]: value },
        }));
        
        if (key === 'downloadPath' && (window as any).ipcRenderer) {
          (window as any).ipcRenderer.send('settings:update-download-path', value);
        }
      },
    }),
    {
      name: 'soundx-settings',
      version: 3,
      migrate: (persistedState: any, version: number) => {
        if (version === 0) {
          // Migration from version 0 to 1
          if (persistedState.general) {
            if (persistedState.general.acceptRelay === undefined) {
              persistedState.general.acceptRelay = true;
            }
            if (persistedState.general.acceptSync === undefined) {
              persistedState.general.acceptSync = true;
            }
          }
        }
        if (version <= 1) {
          // Migration to version 2
          if (persistedState.download && persistedState.download.cacheEnabled === undefined) {
            persistedState.download.cacheEnabled = true;
          }
        }
        if (version <= 2) {
          if (persistedState.general && persistedState.general.recommendationLikeRatio === undefined) {
            persistedState.general.recommendationLikeRatio = 50;
          }
        }
        return persistedState;
      },
    }
  )
);
