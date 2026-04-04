/**
 * Tab Personal Page - User Profile & Settings
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { authStore, settingsStore } from '../store';
import { ROUTE_MEMBER_DETAIL, ROUTE_SETTINGS, ROUTE_SOURCE_MANAGE, ROUTE_ADMIN } from '../constants/RouteConstants';

// ==================== Menu Item ====================
interface MenuItem {
  icon: string;
  title: string;
  badge?: string;
  onClick?: () => void;
}

// ==================== Tab Personal Page ====================
@Entry
@Component
struct TabPersonalPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State username: string = '未登录';
  @State isVip: boolean = false;
  @State avatarUrl: string = '';

  aboutToAppear() {
    this.loadUserInfo();
  }

  loadUserInfo() {
    const authState = authStore.getState();
    if (authState.user) {
      this.username = authState.user.username || '用户';
      this.avatarUrl = authState.user.avatar || '';
    }
    this.isVip = authState.isPlusMember;
  }

  build() {
    Column() {
      // Header
      this.buildHeader()

      Scroll() {
        Column() {
          // Profile card
          this.buildProfileCard()

          // VIP Banner
          this.buildVIPBanner()

          // Menu section
          this.buildMenuSection()
        }
        .padding({ bottom: 80 })
      }
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors.background)
  }

  @Builder
  buildHeader() {
    Row() {
      Text('我的')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)

      Blank()

      // Settings button
      Image($r('app.media.icon_settings'))
        .width(24)
        .height(24)
        .fillColor(this.colors.text)
        .onClick(() => router.pushUrl({ url: ROUTE_SETTINGS }))
    }
    .width('100%')
    .padding(20)
  }

  @Builder
  buildProfileCard() {
    Row() {
      // Avatar
      if (this.avatarUrl) {
        Image(this.avatarUrl)
          .width(60)
          .height(60)
          .borderRadius(30)
      } else {
        Column() {
          Text(this.username.charAt(0).toUpperCase())
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
        }
        .width(60)
        .height(60)
        .borderRadius(30)
        .backgroundColor(this.colors.primary)
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
      }

      Column() {
        Text(this.username)
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.colors.text)

        if (this.isVip) {
          Text('VIP 会员')
            .fontSize(12)
            .fontColor('#FFD700')
            .backgroundColor('rgba(255,215,0,0.2)')
            .borderRadius(4)
            .padding({ left: 8, right: 8, top: 2, bottom: 2 })
            .margin({ top: 4 })
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      .margin({ left: 16 })

      Image($r('app.media.icon_chevron_right'))
        .width(20)
        .height(20)
        .fillColor(this.colors.secondary)
        .onClick(() => router.pushUrl({ url: ROUTE_MEMBER_DETAIL }))
    }
    .width('100%')
    .padding(20)
    .backgroundColor(this.colors.card)
    .borderRadius(16)
    .margin({ left: 20, right: 20 })
  }

  @Builder
  buildVIPBanner() {
    if (!this.isVip) {
      Column() {
        Row() {
          Column() {
            Text('开通 VIP')
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')

            Text('享受无广告、高品质音质等特权')
              .fontSize(12)
              .fontColor('rgba(255,255,255,0.8)')
              .margin({ top: 4 })
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)

          Button('立即开通')
            .height(32)
            .borderRadius(16)
            .backgroundColor('#FFD700')
            .fontColor('#000000')
            .fontSize(12)
            .fontWeight(FontWeight.Bold)
            .onClick(() => router.pushUrl({ url: 'pages/MemberBenefits' }))
        }
      }
      .width('100%')
      .padding(16)
      .backgroundColor('linear-gradient(135deg, #667eea 0%, #764ba2 100%)')
      .borderRadius(16)
      .margin({ left: 20, right: 20, top: 16 })
    }
  }

  @Builder
  buildMenuSection() {
    Column() {
      // Play history
      this.buildMenuItem({ icon: '📜', title: '播放历史', onClick: () => promptAction.showToast({ message: '播放历史功能开发中' }) })

      // Favorites
      this.buildMenuItem({ icon: '❤️', title: '我的收藏', onClick: () => promptAction.showToast({ message: '我的收藏功能开发中' }) })

      // Download
      this.buildMenuItem({ icon: '⬇️', title: '下载管理', onClick: () => promptAction.showToast({ message: '下载管理功能开发中' }) })

      Divider().margin({ top: 8, bottom: 8 })

      // Data sources
      this.buildMenuItem({ icon: '💾', title: '数据源管理', onClick: () => router.pushUrl({ url: ROUTE_SOURCE_MANAGE }) })

      // Admin (if applicable)
      this.buildMenuItem({ icon: '⚙️', title: '管理后台', onClick: () => router.pushUrl({ url: ROUTE_ADMIN }) })

      // Settings
      this.buildMenuItem({ icon: '🔧', title: '设置', onClick: () => router.pushUrl({ url: ROUTE_SETTINGS }) })
    }
    .width('100%')
    .padding(20)
    .backgroundColor(this.colors.card)
    .borderRadius(16)
    .margin({ left: 20, right: 20, top: 16 })
  }

  @Builder
  buildMenuItem(item: MenuItem) {
    Row() {
      Text(item.icon)
        .fontSize(20)
        .margin({ right: 12 })

      Text(item.title)
        .fontSize(15)
        .fontColor(this.colors.text)
        .layoutWeight(1)

      if (item.badge) {
        Text(item.badge)
          .fontSize(12)
          .fontColor(this.colors.secondary)
      }

      Image($r('app.media.icon_chevron_right'))
        .width(16)
        .height(16)
        .fillColor(this.colors.secondary)
    }
    .width('100%')
    .padding({ top: 14, bottom: 14 })
    .onClick(() => item.onClick?.())
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
