/**
 * Scan Page - QR Code Scanner
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';

@Entry
@Component
struct ScanPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State flashOn: boolean = false;

  build() {
    Stack() {
      // Camera preview placeholder
      Column() {
        Text('📷')
          .fontSize(80)
          .opacity(0.3)

        Text('相机预览区域')
          .fontSize(14)
          .fontColor(this.colors.secondary)
          .margin({ top: 16 })

        Text('（实际使用相机 API）')
          .fontSize(12)
          .fontColor(this.colors.secondary)
          .margin({ top: 8 })
      }
      .width('100%')
      .height('100%')
      .backgroundColor('#000000')
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)

      // Overlay UI
      Column() {
        // Header
        Row() {
          Image($r('app.media.icon_close'))
            .width(28)
            .height(28)
            .fillColor('#FFFFFF')
            .onClick(() => router.back())

          Text('扫一扫')
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')

          Image(this.flashOn ? $r('app.media.icon_flash_on') : $r('app.media.icon_flash_off'))
            .width(28)
            .height(28)
            .fillColor('#FFFFFF')
            .onClick(() => this.flashOn = !this.flashOn)
        }
        .width('100%')
        .padding({ left: 20, right: 20, top: 16 })
        .height(56)

        Blank()

        // Scan frame
        Column() {
          // Corner indicators
          Row() {
            Column()
              .width(40)
              .height(40)
              .border({
                width: { top: 3, left: 3 },
                color: '#FFFFFF',
                radius: { topLeft: 16 }
              })
            Column()
              .layoutWeight(1)
            Column()
              .width(40)
              .height(40)
              .border({
                width: { top: 3, right: 3 },
                color: '#FFFFFF',
                radius: { topRight: 16 }
              })
          }
          .width('100%')
          .height(40)

          Row() {
            Column().layoutWeight(1).height(1)
            Column().layoutWeight(1).height(1)
          }
          .height(200)

          Row() {
            Column()
              .width(40)
              .height(40)
              .border({
                width: { bottom: 3, left: 3 },
                color: '#FFFFFF',
                radius: { bottomLeft: 16 }
              })
            Column()
              .layoutWeight(1)
            Column()
              .width(40)
              .height(40)
              .border({
                width: { bottom: 3, right: 3 },
                color: '#FFFFFF',
                radius: { bottomRight: 16 }
              })
          }
          .width('100%')
          .height(40)
        }
        .width(260)
        .height(280)

        Blank()

        // Bottom tip
        Column() {
          Text('将二维码放入框内即可自动扫描')
            .fontSize(14)
            .fontColor('rgba(255,255,255,0.8)')
            .margin({ bottom: 40 })

          Button('手动输入二维码')
            .height(44)
            .borderRadius(22)
            .backgroundColor('rgba(255,255,255,0.2)')
            .fontColor('#FFFFFF')
            .fontSize(14)
            .onClick(() => promptAction.showToast({ message: '手动输入功能开发中' }))
        }
        .padding({ bottom: 60 })
      }
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
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
