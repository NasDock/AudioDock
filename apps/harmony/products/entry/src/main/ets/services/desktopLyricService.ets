import { window, display } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { Logger } from 'audiodock_common';

const TAG = 'DesktopLyric';
const FLOAT_WINDOW_NAME = 'desktop_lyric_float';

let floatWindow: window.Window | null = null;
let pendingShow: Promise<boolean> | null = null;

/**
 * 桌面歌词悬浮窗服务。
 *
 * 实现要点：
 * - window.createWindow(TYPE_FLOAT) 创建全局悬浮子窗口，需要 ohos.permission.SYSTEM_FLOAT_WINDOW
 *   （ACL 受限权限，未获授权时 createWindow 抛错，showDesktopLyricWindow 返回 false 由调用方回弹开关）。
 * - 子窗口与主窗口同进程，歌词行/样式通过 AppStorage（进程级单例）共享，
 *   DesktopLyricFloatPage 用 @StorageLink 订阅即可实时刷新，无需跨进程通道。
 * - 页面不感知窗口位置，拖动由页面 PanGesture 回调 moveDesktopLyricBy 换算位移。
 */
export async function showDesktopLyricWindow(ctx: common.Context): Promise<boolean> {
  if (floatWindow !== null) return true;
  if (pendingShow !== null) return pendingShow;
  pendingShow = (async (): Promise<boolean> => {
    try {
      const win = await window.createWindow({
        name: FLOAT_WINDOW_NAME,
        windowType: window.WindowType.TYPE_FLOAT,
        ctx: ctx,
      });
      floatWindow = win;
      // 透明背景：悬浮窗只承载歌词文字，不带底板
      win.setWindowBackgroundColor('#00000000');
      await win.setUIContent('pages/DesktopLyricFloatPage');
      // 初始尺寸/位置：屏宽 90%、高约 72vp（px），顶部下移 120px 居中
      const disp = display.getDefaultDisplaySync();
      const w = Math.floor(disp.width * 0.9);
      const h = 200;
      await win.resize(w, h);
      await win.moveWindowTo(Math.floor((disp.width - w) / 2), 160);
      await win.showWindow();
      Logger.i(TAG, 'float window shown');
      return true;
    } catch (e) {
      Logger.e(TAG, `create float window failed: ${String(e)}`);
      floatWindow = null;
      return false;
    } finally {
      pendingShow = null;
    }
  })();
  return pendingShow;
}

export async function hideDesktopLyricWindow(): Promise<void> {
  const win = floatWindow;
  floatWindow = null;
  if (win === null) return;
  try {
    await win.destroyWindow();
  } catch (e) {
    Logger.w(TAG, `destroy float window failed: ${String(e)}`);
  }
}

export function isDesktopLyricShowing(): boolean {
  return floatWindow !== null;
}

/** 悬浮窗拖动：dx/dy 为相对位移（px，与 PanGesture.onActionUpdate 的 offset 增量一致）。 */
export async function moveDesktopLyricBy(dx: number, dy: number): Promise<void> {
  if (floatWindow === null) return;
  try {
    const rect = floatWindow.getWindowProperties().windowRect;
    await floatWindow.moveWindowTo(Math.floor(rect.left + dx), Math.floor(rect.top + dy));
  } catch (e) {
    Logger.w(TAG, `moveWindowTo failed: ${String(e)}`);
  }
}
