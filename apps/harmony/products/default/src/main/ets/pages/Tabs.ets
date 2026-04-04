/**
 * Tabs Page - Main Tab Navigation Container
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import { playerStore } from '../store';
import { ROUTE_PLAYER, ROUTE_SEARCH, ROUTE_SETTINGS } from '../constants/RouteConstants';

// ==================== Tab Info ====================
interface TabItem {
  index: number;
  name: string;
  title: string;
  icon: string;
  iconActive: string;
  route: string;
}

const TABS: TabItem[] = [
  { index: 0, name: 'index', title: '首页', icon: 'home', iconActive: 'home_filled', route: 'pages/TabIndex' },
  { index: 1, name: 'library', title: '音乐库', icon: 'library', iconActive: 'library_filled', route: 'pages/TabLibrary' },
  { index: 2, name: 'personal', title: '我的', icon: 'person', iconActive: 'person_filled', route: 'pages/TabPersonal' }
];

// ==================== Tabs Page ====================
@Entry
@Component
struct TabsPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State currentTabIndex: number = 0;
  @State showMiniPlayer: boolean = false;

  private tabController: TabsController = new TabsController();

  build() {
    Column() {
      // Tab content
      Tabs({ controller: this.tabController, index: this.currentTabIndex }) {
        TabContent() {
          this.buildTabContent('pages/TabIndex')
        }
        .padding({ bottom: 60 })

        TabContent() {
          this.buildTabContent('pages/TabLibrary')
        }
        .padding({ bottom: 60 })

        TabContent() {
          this.buildTabContent('pages/TabPersonal')
        }
        .padding({ bottom: 60 })
      }
      .layoutWeight(1)
      .barHeight(0)
      .onChange((index) => {
        this.currentTabIndex = index;
      })

      // Custom tab bar
      this.buildTabBar()
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors.background)
  }

  @Builder
  buildTabContent(pageRoute: string) {
    Navigation() {
      if (pageRoute === 'pages/TabIndex') {
        this.buildHomeTab()
      } else if (pageRoute === 'pages/TabLibrary') {
        this.buildLibraryTab()
      } else if (pageRoute === 'pages/TabPersonal') {
        this.buildPersonalTab()
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  buildHomeTab() {
    Column() {
      // Home content placeholder
      this.buildHomeContent()
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  buildHomeContent() {
    Column() {
      Text('首页')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)
        .width('100%')
        .padding(20)

      Text('正在加载...')
        .fontSize(14)
        .fontColor(this.colors.secondary)
        .width('100%')
        .padding(20)
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  buildLibraryTab() {
    Column() {
      Text('音乐库')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)
        .width('100%')
        .padding(20)
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  buildPersonalTab() {
    Column() {
      Text('我的')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)
        .width('100%')
        .padding(20)
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  buildTabBar() {
    Column() {
      Row() {
        // Tab items
        Row() {
          ForEach(TABS, (tab: TabItem) => {
            Column() {
              // Icon
              Text(tab.index === this.currentTabIndex ? tab.iconActive : tab.icon)
                .fontSize(24)
                .fontColor(tab.index === this.currentTabIndex ? this.colors.primary : this.colors.secondary)

              // Label
              Text(tab.title)
                .fontSize(12)
                .fontColor(tab.index === this.currentTabIndex ? this.colors.primary : this.colors.secondary)
                .margin({ top: 4 })
            }
            .layoutWeight(1)
            .height(50)
            .justifyContent(FlexAlign.Center)
            .onClick(() => {
              this.currentTabIndex = tab.index;
              this.tabController.changeIndex(tab.index);
            })
          })
        }
        .width('70%')
        .height('100%')
      }
      .width('100%')
      .height(50)
      .backgroundColor(this.colors.card)
      .borderRadius(25)
      .padding({ left: 12, right: 12 })
    }
    .width('100%')
    .height(60)
    .padding({ bottom: 8 })
    .backgroundColor(this.colors.background)
    .alignItems(HorizontalAlign.Center)
  }
}

// ==================== Theme Colors ====================
class ThemeColors {
  background: string = '#FFFFFF';
  card: string = '#F5F5F5';
  text: string = '#000000';
  secondary: string = '#666666';
  border: string = '#E0E0E0';
  primary: string = '#007AFF';
}
