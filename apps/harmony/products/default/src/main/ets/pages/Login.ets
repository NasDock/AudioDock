/**
 * Login Page - Server Type Selection
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import { promptAction } from '@kit.ArkUI';
import { authStore } from '../store';
import { ROUTE_LOGIN_FORM } from '../constants/RouteConstants';

// ==================== Types ====================
interface SourceType {
  key: string;
  name: string;
  icon: Resource;
  description: string;
}

// ==================== Constants ====================
const SOURCE_TYPES: SourceType[] = [
  {
    key: 'AudioDock',
    name: 'AudioDock',
    icon: $r('app.media.icon_logo'),
    description: 'AudioDock 官方数据源'
  },
  {
    key: 'Subsonic',
    name: 'Subsonic',
    icon: $r('app.media.icon_subsonic'),
    description: 'Subsonic 兼容服务器 (Jellyfin, Navidrome, etc.)'
  },
  {
    key: 'Emby',
    name: 'Emby',
    icon: $r('app.media.icon_emby'),
    description: 'Emby / Jellyfin 媒体服务器'
  }
];

// ==================== Login Page ====================
@Entry
@Component
struct LoginPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State isLoading: boolean = false;

  build() {
    Column() {
      // Header
      this.buildHeader()

      // Source Type List
      List() {
        ForEach(SOURCE_TYPES, (source: SourceType) => {
          ListItem() {
            this.buildSourceCard(source)
          }
          .padding({ bottom: 16 })
        })
      }
      .layoutWeight(1)
      .padding({ left: 20, right: 20 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors.background)
  }

  @Builder
  buildHeader() {
    Column() {
      Image($r('app.media.icon_logo'))
        .width(100)
        .height(100)
        .borderRadius(16)
        .margin({ top: 40, bottom: 20 })

      Text('选择数据源类型')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)

      Text('请选择您要连接的服务器类型')
        .fontSize(14)
        .fontColor(this.colors.secondary)
        .margin({ top: 8 })
    }
    .width('100%')
    .padding({ top: 40, bottom: 40, left: 20, right: 20 })
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  buildSourceCard(source: SourceType) {
    Row() {
      Image(source.icon)
        .width(50)
        .height(50)
        .borderRadius(8)
        .margin({ right: 16 })

      Column() {
        Text(source.name)
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.colors.text)

        Text(source.description)
          .fontSize(12)
          .fontColor(this.colors.secondary)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ top: 4 })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      Image($r('app.media.icon_chevron_right'))
        .width(28)
        .height(28)
        .fillColor(this.colors.text)
    }
    .width('100%')
    .padding(20)
    .backgroundColor(this.colors.card)
    .borderRadius(16)
    .border({
      width: 1,
      color: this.colors.border
    })
    .onClick(() => this.navigateToLoginForm(source.key))
  }

  navigateToLoginForm(type: string) {
    router.pushUrl({
      url: ROUTE_LOGIN_FORM,
      params: { type }
    });
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
