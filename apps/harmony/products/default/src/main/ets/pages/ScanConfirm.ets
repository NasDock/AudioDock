/**
 * Scan Confirm Page - Confirm Scan Login
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';

@Entry
@Component
struct ScanConfirmPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State deviceName: string = 'AudioDock';
  @State serverAddress: string = '';

  build() {
    Column() {
      this.buildHeader()

      Column() {
        Image($r('app.media.icon_logo'))
          .width(80)
          .height(80)
          .borderRadius(16)
          .margin({ top: 40 })

        Text('确认登录')
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.colors.text)
          .margin({ top: 20 })

        Text(`设备 "${this.deviceName}" 请求登录`)
          .fontSize(14)
          .fontColor(this.colors.secondary)
          .margin({ top: 8 })

        Text('服务器：' + this.serverAddress)
          .fontSize(12)
          .fontColor(this.colors.secondary)
          .margin({ top: 4 })

        // Data to import
        Column() {
          Text('以下数据将被同步：')
            .fontSize(14)
            .fontColor(this.colors.text)
            .width('100%')
            .margin({ bottom: 12 })

          this.buildDataItem('播放历史', true)
          this.buildDataItem('收藏夹', true)
          this.buildDataItem('个人设置', true)
          this.buildDataItem('登录状态', false)
        }
        .width('90%')
        .padding(20)
        .backgroundColor(this.colors.card)
        .borderRadius(16)
        .margin({ top: 32 })

        Blank()

        // Buttons
        Row() {
          Button('取消')
            .layoutWeight(1)
            .height(50)
            .borderRadius(25)
            .backgroundColor(this.colors.card)
            .fontColor(this.colors.text)
            .fontSize(16)
            .onClick(() => router.back())

          Button('确认登录')
            .layoutWeight(1)
            .height(50)
            .borderRadius(25)
            .backgroundColor(this.colors.primary)
            .fontColor('#FFFFFF')
            .fontSize(16)
            .margin({ left: 12 })
            .onClick(() => this.handleConfirm())
        }
        .width('90%')
        .padding({ bottom: 40 })
      }
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors.background)
  }

  @Builder
  buildHeader() {
    Row() {
      Image($r('app.media.icon_close'))
        .width(24)
        .height(24)
        .fillColor(this.colors.text)
        .onClick(() => router.back())

      Text('扫码确认')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)

      Blank()
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
    .height(56)
  }

  @Builder
  buildDataItem(label: string, selected: boolean) {
    Row() {
      Text(label)
        .fontSize(14)
        .fontColor(this.colors.text)

      Blank()

      Text(selected ? '✓' : '—')
        .fontSize(16)
        .fontColor(selected ? this.colors.primary : this.colors.secondary)
    }
    .width('100%')
    .padding({ top: 8, bottom: 8 })
  }

  handleConfirm() {
    promptAction.showToast({ message: '登录成功' });
    router.replaceUrl({ url: 'pages/Tabs' });
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
