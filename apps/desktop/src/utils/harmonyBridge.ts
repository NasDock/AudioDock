/**
 * HarmonyOS Bridge - Web 端调用原生能力
 * 在 HarmonyOS WebView 中通过 window.nativeBridge 调用 ArkTS 原生方法
 */

export interface HarmonyPlatformInfo {
  platform: string;
  version: string;
  arch: string;
}

export interface ScreenInfo {
  width: number;
  height: number;
  scale: number;
  densityDPI: number;
}

declare global {
  interface Window {
    nativeBridge?: {
      platform: () => string;
      getDeviceId: () => string;
      getPlatformInfo: () => string;
      setWindowTitle: (title: string) => void;
      getScreenInfo: () => string;
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
    };
  }
}

const bridge = (): typeof window.nativeBridge => {
  return window.nativeBridge;
};

export const isHarmony = (): boolean => {
  return typeof window !== 'undefined' && bridge()?.platform?.() === 'harmony-desktop';
};

export const getPlatformInfo = (): HarmonyPlatformInfo | null => {
  try {
    const info = bridge()?.getPlatformInfo?.();
    return info ? JSON.parse(info) : null;
  } catch {
    return null;
  }
};

export const getScreenInfo = (): ScreenInfo | null => {
  try {
    const info = bridge()?.getScreenInfo?.();
    return info ? JSON.parse(info) : null;
  } catch {
    return null;
  }
};

export const setWindowTitle = (title: string): void => {
  bridge()?.setWindowTitle?.(title);
};

export const minimizeWindow = (): void => {
  bridge()?.minimizeWindow?.();
};

export const maximizeWindow = (): void => {
  bridge()?.maximizeWindow?.();
};

export const closeWindow = (): void => {
  bridge()?.closeWindow?.();
};

// 在 WebView 中获取实际屏幕尺寸
export const getHarmonyScreenSize = (): { width: number; height: number } => {
  const info = getScreenInfo();
  if (info) {
    return { width: info.width, height: info.height };
  }
  return { width: 1280, height: 800 };
};

export default {
  isHarmony,
  getPlatformInfo,
  getScreenInfo,
  setWindowTitle,
  minimizeWindow,
  maximizeWindow,
  closeWindow,
  getHarmonyScreenSize,
};
