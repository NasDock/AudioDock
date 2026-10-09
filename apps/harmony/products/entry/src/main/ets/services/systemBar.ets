import { window, display } from '@kit.ArkUI';
import { buildTheme } from 'features_ui';
import type { ThemeMode } from 'features_ui';
import { Logger } from 'audiodock_common';

// 持有主窗口引用，供主题切换时同步系统状态栏 / 底部小横条区域背景色。
let mainWindow: window.Window | null = null;

/** px → vp（service 无 UIContext，用默认显示屏密度换算）。 */
function pxToVp(px: number): number {
  const density: number = display.getDefaultDisplaySync().densityPixels;
  return density > 0 ? px / density : 0;
}

/**
 * 把状态栏 / 底部导航（小横条）避让区高度（vp）发布到 AppStorage。
 * 全屏沉浸布局下页面从物理 y=0 开始排版，各页面根容器用这两个值加 padding 自行避让：
 * @StorageProp('statusBarHeightVp') / @StorageProp('navBarHeightVp')。
 */
function publishAvoidArea(win: window.Window): void {
  try {
    const sys: window.AvoidArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
    AppStorage.setOrCreate('statusBarHeightVp', pxToVp(sys.topRect.height));
    const nav: window.AvoidArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
    AppStorage.setOrCreate('navBarHeightVp', pxToVp(nav.bottomRect.height));
  } catch (e) {
    Logger.w('SystemBar', `publishAvoidArea failed: ${String(e)}`);
  }
}

export function setSystemBarWindow(win: window.Window): void {
  mainWindow = win;
  // 开启沉浸式全屏布局：页面延伸到状态栏/导航栏之下。
  // 不开的话系统栏是一块独立的不透明区域，statusBarColor 不生效，只能显示系统默认白/黑条。
  // 开启后页面内容从物理 y=0 排版，必须配合 publishAvoidArea 下发的避让高度做 padding。
  win.setWindowLayoutFullScreen(true)
    .catch((e: Error) => Logger.w('SystemBar', `setWindowLayoutFullScreen failed: ${e.message}`));
  publishAvoidArea(win);
  // 旋转 / 折叠屏展开等场景避让区会变，动态刷新
  win.on('avoidAreaChange', (): void => publishAvoidArea(win));
}

/**
 * 把系统状态栏与底部导航（小横条）区域的背景色设为当前主题的 background，
 * 图标使用主题文字反差色。在启动与每次切换主题时调用。
 */
export function applySystemBar(mode: ThemeMode): void {
  if (!mainWindow) {
    return;
  }
  const theme = buildTheme(mode);
  const props: window.SystemBarProperties = {
    statusBarColor: theme.colors.background,
    navigationBarColor: theme.colors.background,
    statusBarContentColor: theme.colors.text,
    navigationBarContentColor: theme.colors.text,
  };
  mainWindow.setWindowSystemBarProperties(props)
    .catch((e: Error) => Logger.w('SystemBar', `apply failed: ${e.message}`));
  // 窗口背景色同步到最底层，确保底部小横条（home indicator）区域也跟随主题
  mainWindow.setWindowBackgroundColor(theme.colors.background);
}
