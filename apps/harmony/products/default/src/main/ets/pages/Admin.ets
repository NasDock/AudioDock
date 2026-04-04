/**
 * Admin Page - Admin Dashboard
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';

interface AdminStats {
  totalTracks: number;
  totalUsers: number;
  totalPlaylists: number;
  totalAlbums: number;
}

@Entry
@Component
struct AdminPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State stats: AdminStats = {
    totalTracks: 0,
    totalUsers: 0,
    totalPlaylists: 0,
    totalAlbums: 0
  };

  build() {
    Column() {
      this.buildHeader()

      Scroll() {
        Column() {
          // Stats cards
          Grid() {
            GridItem() {
              this.buildStatCard('🎵', '曲目', this.stats.totalTracks)
            }
            GridItem() {
              this.buildStatCard('👥', '用户', this.stats.totalUsers)
            }
            GridItem() {
              this.buildStatCard('📋', '歌单', this.stats.totalPlaylists)
            }
            GridItem() {
              this.buildStatCard('💿', '专辑', this.stats.totalAlbums)
            }
          }
          .columnsTemplate('1fr 1fr')
          .rowsTemplate('1fr 1fr')
          .columnsGap(12)
          .rowsGap(12)
          .width('100%')
          .height(200)
          .padding({ left: 20, right: 20, top: 20 })

          // Admin menu
          Column() {
            this.buildMenuItem('📊', '数据统计', () => promptAction.showToast({ message: '数据统计功能开发中' }))
            this.buildMenuItem('👥', '用户管理', () => promptAction.showToast({ message: '用户管理功能开发中' }))
            this.buildMenuItem('🎵', '音乐管理', () => promptAction.showToast({ message: '音乐管理功能开发中' }))
            this.buildMenuItem('📋', '歌单管理', () => promptAction.showToast({ message: '歌单管理功能开发中' }))
            this.buildMenuItem('🔧', '系统设置', () => promptAction.showToast({ message: '系统设置功能开发中' }))
            this.buildMenuItem('📜', '操作日志', () => promptAction.showToast({ message: '操作日志功能开发中' }))
          }
          .width('100%')
          .padding(20)
          .backgroundColor(this.colors.card)
          .borderRadius(16)
          .margin({ left: 16, right: 16, top: 20 })
        }
        .width('100%')
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
      Image($r('app.media.icon_back'))
        .width(24)
        .height(24)
        .fillColor(this.colors.text)
        .onClick(() => router.back())

      Text('管理后台')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)
        .layoutWeight(1)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
    .height(56)
  }

  @Builder
  buildStatCard(icon: string, label: string, value: number) {
    Column() {
      Text(icon).fontSize(28)
      Text(`${value}`)
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)
        .margin({ top: 8 })
      Text(label)
        .fontSize(12)
        .fontColor(this.colors.secondary)
        .margin({ top: 4 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors.card)
    .borderRadius(16)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  buildMenuItem(icon: string, title: string, onClick: () => void) {
    Row() {
      Text(icon).fontSize(20).margin({ right: 12 })
      Text(title).fontSize(15).fontColor(this.colors.text).layoutWeight(1)
      Image($r('app.media.icon_chevron_right'))
        .width(16)
        .height(16)
        .fillColor(this.colors.secondary)
    }
    .width('100%')
    .padding({ top: 14, bottom: 14, left: 16, right: 16 })
    .onClick(onClick)
  }
}

class ThemeColors {
  background: string = '#FFFFFF';
  card: string = '#F5F5F5';
  text: string = '#000000';
  secondary: string = '#666666';
  border: string = '#E0E0E0';
  primary: string = '#007AFF';
}
