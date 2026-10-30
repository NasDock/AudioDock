import { Platform } from "react-native";
import { EventEmitter, requireNativeModule } from "expo-modules-core";

/**
 * 桌面歌词（悬浮窗歌词）—— Android-only。
 * iOS / 其他平台所有 API 均为安全 no-op。
 */

interface DesktopLyricsNativeModule {
  checkPermission(): boolean;
  requestPermission(): boolean;
  show(): boolean;
  hide(): boolean;
  isShowing(): boolean;
  updateLyric(line: string): boolean;
  applyStyle(
    fontSize: number,
    textColor: string,
    strokeColor: string,
    strokeWidth: number
  ): boolean;
  updatePlaybackState(playing: boolean): boolean;
}

/** 悬浮窗一体式控制面板回传的事件 */
export type DesktopLyricsEvent =
  | {
      action: "styleChanged";
      fontSize: number;
      textColor: string;
      strokeColor: string;
      strokeWidth: number;
    }
  | { action: "closeRequested" }
  | { action: "prev" }
  | { action: "next" }
  | { action: "togglePlay" };

let nativeModule: DesktopLyricsNativeModule | null = null;

// 通过工厂函数让 emitter 类型完全从 new 表达式推断，
// 避免 EventEmitter 双重声明（build/EventEmitter vs ts-declarations）导致的类型不兼容
const createEmitter = (mod: DesktopLyricsNativeModule) =>
  new EventEmitter<{
    DesktopLyricsEvent: (event: DesktopLyricsEvent) => void;
  }>(mod as any);
let emitter: ReturnType<typeof createEmitter> | null = null;

function getNative(): DesktopLyricsNativeModule | null {
  if (Platform.OS !== "android") return null;
  if (nativeModule) return nativeModule;
  try {
    nativeModule = requireNativeModule<DesktopLyricsNativeModule>("DesktopLyrics");
    emitter = createEmitter(nativeModule);
    return nativeModule;
  } catch {
    return null;
  }
}

export interface DesktopLyricStyle {
  fontSize: number;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
}

/** 是否已授予悬浮窗权限 */
export function checkDesktopLyricsPermission(): boolean {
  try {
    return getNative()?.checkPermission() ?? false;
  } catch {
    return false;
  }
}

/** 跳转系统悬浮窗权限设置页（异步引导，用户需手动开启后返回） */
export function requestDesktopLyricsPermission(): boolean {
  try {
    return getNative()?.requestPermission() ?? false;
  } catch {
    return false;
  }
}

/** 显示桌面歌词悬浮窗（无权限时静默失败，返回 false 由调用方兜底） */
export function showDesktopLyrics(): boolean {
  try {
    const mod = getNative();
    if (!mod) return false;
    if (!mod.checkPermission()) return false;
    return mod.show();
  } catch {
    return false;
  }
}

/** 隐藏桌面歌词悬浮窗 */
export function hideDesktopLyrics(): boolean {
  try {
    return getNative()?.hide() ?? false;
  } catch {
    return false;
  }
}

/** 悬浮窗是否正在显示 */
export function isDesktopLyricsShowing(): boolean {
  try {
    return getNative()?.isShowing() ?? false;
  } catch {
    return false;
  }
}

/** 更新当前歌词行 */
export function updateDesktopLyricsLine(line: string): void {
  try {
    getNative()?.updateLyric(line);
  } catch {
    // no-op
  }
}

/** 应用样式（字号 sp / 文字颜色 / 描边颜色 / 描边宽度 dp） */
export function applyDesktopLyricsStyle(style: DesktopLyricStyle): void {
  try {
    getNative()?.applyStyle(
      style.fontSize,
      style.textColor,
      style.strokeColor,
      style.strokeWidth
    );
  } catch {
    // no-op
  }
}

/** 回推播放状态给悬浮窗（切换播放/暂停图标） */
export function updateDesktopLyricsPlaybackState(playing: boolean): void {
  try {
    getNative()?.updatePlaybackState(playing);
  } catch {
    // no-op
  }
}

/**
 * 订阅悬浮窗控制面板事件：
 * - styleChanged：用户调整了样式（需回写应用内设置持久化）
 * - closeRequested：用户点了 ✕ 关闭歌词（需关闭应用内开关）
 * - prev / next / togglePlay：用户点了播放控制按钮（需执行对应播放操作）
 */
export function addDesktopLyricsEventListener(
  callback: (event: DesktopLyricsEvent) => void
): { remove: () => void } {
  try {
    getNative();
    if (!emitter) return { remove: () => {} };
    return emitter.addListener("DesktopLyricsEvent", callback);
  } catch {
    return { remove: () => {} };
  }
}
