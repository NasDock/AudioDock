/**
 * Member Detail Page - User Profile & VIP Status
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import hilog from '@ohos.hilog';
import { authStore } from '../store';

// ==================== Menu Item ====================
interface MenuItem {
  icon: string;
  title: string;
  value?: string;
  onClick?: () => void;
}

// ==================== Member Detail Page ====================
@Entry
@Component
struct MemberDetailPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State userAvatar: string = '';
  @State username: string = '未登录';
  @State vipTier: string = '免费用户';
  @State isVip: boolean = false;
  @State isLoading: boolean = false;

  aboutToAppear() {
    this.loadUserInfo();
  }

  async loadUserInfo() {
    const state = authStore.getState();
    if (state.user) {
      this.username = state.user.username || '用户';
      this.userAvatar = state.user.avatar || '';
      this.vipTier = state.user.vipTier || '免费用户';
      this.isVip = state.isPlusMember;
    }
  }

  build() {
    Column() {
      // Header
      this.buildHeader()

      Scroll() {
        Column() {
          // Profile card
          this.buildProfileCard()

          // VIP Status card
          this.buildVIPCard()

          // Menu items
          this.buildMenuSection()
        }
        .padding(24)
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
      Image($r('app.media.icon_back'))
        .width(24)
        .height(24)
        .onClick(() => router.back())

      Text('会员中心')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)

      Blank()
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
    .margin({ bottom: 16 })
  }

  @Builder
  buildProfileCard() {
    Row() {
      // Avatar
      if (this.userAvatar) {
        Image(this.userAvatar)
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

        Text(this.isVip ? 'VIP 会员' : '普通用户')
          .fontSize(14)
          .fontColor(this.isVip ? '#FFD700' : this.colors.secondary)
          .margin({ top: 4 })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      .margin({ left: 16 })

      Image($r('app.media.icon_chevron_right'))
        .width(20)
        .height(20)
        .fillColor(this.colors.secondary)
        .onClick(() => promptAction.showToast({ message: '编辑资料功能开发中' }))
    }
    .width('100%')
    .padding(20)
    .backgroundColor(this.colors.card)
    .borderRadius(16)
    .margin({ bottom: 16 })
  }

  @Builder
  buildVIPCard() {
    Column() {
      Row() {
        Column() {
          Text('🎵')
            .fontSize(28)

          Text('VIP 会员')
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.colors.text)
            .margin({ top: 8 })

          Text(this.isVip ? '有效期至：2025-12-31' : '开通会员享受更多特权')
            .fontSize(12)
            .fontColor(this.colors.secondary)
            .margin({ top: 4 })
        }
        .alignItems(HorizontalAlign.Center)

        if (!this.isVip) {
          Button('立即开通')
            .height(36)
            .borderRadius(18)
            .backgroundColor('#FFD700')
            .fontColor('#000000')
            .fontSize(14)
            .fontWeight(FontWeight.Bold)
            .onClick(() => router.pushUrl({ url: 'pages/MemberBenefits' }))
        }
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .padding(20)
    .backgroundColor(this.isVip ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' : this.colors.card)
    .borderRadius(16)
    .margin({ bottom: 24 })
  }

  @Builder
  buildMenuSection() {
    Column() {
      // Menu items
      this.buildMenuItem({ icon: '💳', title: '订阅管理', onClick: () => promptAction.showToast({ message: '订阅管理功能开发中' }) })
      this.buildMenuItem({ icon: '📋', title: '使用记录', onClick: () => promptAction.showToast({ message: '使用记录功能开发中' }) })
      this.buildMenuItem({ icon: '🔐', title: '账号安全', onClick: () => promptAction.showToast({ message: '账号安全功能开发中' }) })
      this.buildMenuItem({ icon: '📞', title: '联系客服', onClick: () => promptAction.showToast({ message: '联系客服功能开发中' }) })

      Divider()
        .margin({ top: 16, bottom: 16 })

      // Logout button
      Button('退出登录')
        .width('100%')
        .height(50)
        .borderRadius(14)
        .backgroundColor('#FFE4E4')
        .fontColor('#FF4444')
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .onClick(() => this.handleLogout())
    }
    .width('100%')
    .padding(20)
    .backgroundColor(this.colors.card)
    .borderRadius(16)
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

      if (item.value) {
        Text(item.value)
          .fontSize(14)
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

  async handleLogout() {
    try {
      await authStore.logout();
      promptAction.showToast({ message: '已退出登录' });
      router.back();
    } catch (error) {
      hilog.error(0x0001, 'MemberDetail', 'Logout failed: %{public}s', JSON.stringify(error));
    }
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
