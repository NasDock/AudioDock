/**
 * Folder Index Page
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';

@Entry
@Component
struct FolderIndexPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();

  build() {
    Column() {
      this.buildHeader()

      Column() {
        Text('📁')
          .fontSize(60)

        Text('文件夹功能')
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.colors.text)
          .margin({ top: 16 })

        Text('本地文件夹管理功能开发中')
          .fontSize(14)
          .fontColor(this.colors.secondary)
          .margin({ top: 8 })
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
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

      Text('文件夹')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)
        .layoutWeight(1)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
    .height(56)
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
