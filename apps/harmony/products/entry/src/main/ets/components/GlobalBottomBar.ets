import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t } from 'features_i18n';
import { AppIcon, AppIconName } from './AppIcon';
import { MiniPlayer } from './MiniPlayer';

/**
 * 全局底部 Tab 栏，对齐 mobile 的 GlobalBottomBar：
 * MiniPlayer + 三个 tab（推荐/声仓/我的）。
 * 在 RootShellPage 内、与 Navigation 平级渲染，跨页面常驻（对齐 mobile _layout.tsx 的平级挂载）。
 * 详情页（搜索/专辑/艺术家/播放列表/合集）底部展示，点击 tab 跳回 MainTabs。
 *
 * 车机模式（carModeEnabled=true）下隐藏 MiniPlayer，只保留 tab 栏——
 * 此时左侧 MainPage 已有完整的嵌入式播放器，再叠一个 miniPlayer 体验冗余。
 * 对齐 mobile GlobalBottomBar 的 `!carLayoutMode && <MiniPlayer />`。
 */
@Component
export struct GlobalBottomBar {
  pathStack: NavPathStack = new NavPathStack();
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @StorageLink('carModeEnabled') carModeEnabled: boolean = false;
  @StorageLink('mainTabIndex') mainTabIndex: number = 0;
  @StorageProp('appLang') appLang: string = 'zh-CN';
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;
  @State theme: Theme = buildTheme('light');

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
  }

  private switchToTab(index: number): void {
    // 通过 AppStorage 通知 MainPageContent 切换 tab，然后跳回主页 destination
    AppStorage.setOrCreate('mainTabIndex', index);
    try {
      // NavPathStack 的 API 是 popToName(name, animate?)，不是 popTo({ name })
      this.pathStack.popToName('MainTabs', false);
    } catch (e) {
      // 兜底：如果路径栈里没有 MainTabs（如首次进入），就忽略
    }
  }

  build() {
    Column() {
      // 车机模式下不渲染 MiniPlayer（左侧 MainPage 已有完整嵌入式播放器）
      if (!this.carModeEnabled) {
        MiniPlayer();
      }

      Row() {
        this.TabItem(t('navTabs.recommend'), 'home', 0)
        this.TabItem(t('navTabs.soundcang'), 'headphones', 1)
        this.TabItem(t('navTabs.mine'), 'person', 2)
      }
      .width('100%').height(56)
      .justifyContent(FlexAlign.SpaceAround)
      .alignItems(VerticalAlign.Center)
      .border({ width: { top: 0.5 }, color: this.theme.colors.border })
    }
    .width('100%')
    // 沉浸式避让：全屏布局下 tab 栏贴在物理底部会被小横条盖住，
    // 底部 padding 抬起内容，padding 区域由本组件背景填充（对齐 mobile height: 49 + insets.bottom）。
    .padding({ bottom: this.navBarHeightVp })
    // 对齐 mobile GlobalBottomBar 的 colors.tabBar（亮色=白/暗色=黑，与 MiniPlayer 的 background 一致），
    // 之前用 surface（灰）导致 tab 栏和 MiniPlayer 之间有明显色差
    .backgroundColor(this.theme.colors.tabBar)
  }

  @Builder
  TabItem(label: string, icon: AppIconName, index: number) {
    Column() {
      AppIcon({
        name: icon,
        iconSize: 24,
        color: this.mainTabIndex === index ? this.theme.colors.tabBarActive : this.theme.colors.tabBarInactive,
      })
        .margin({ bottom: 4 })
      Text(label)
        .fontSize(12)
        .fontColor(this.mainTabIndex === index ? this.theme.colors.tabBarActive : this.theme.colors.tabBarInactive)
    }
    .width('33%').height(56).justifyContent(FlexAlign.Center)
    .onClick(() => this.switchToTab(index))
  }
}