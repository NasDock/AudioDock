/**
 * Source Manage Page - Data Source Management
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { apiService } from '@ohos/common';

interface Source {
  type: string;
  address: string;
  status: string;
}

@Entry
@Component
struct SourceManagePage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State sources: Source[] = [];
  @State loading: boolean = false;

  build() {
    Column() {
      this.buildHeader()

      Scroll() {
        Column() {
          // Add source button
          Button('+ 添加数据源')
            .width('90%')
            .height(50)
            .borderRadius(14)
            .backgroundColor(this.colors.primary)
            .fontColor('#FFFFFF')
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .onClick(() => promptAction.showToast({ message: '添加数据源功能开发中' }))
            .margin({ top: 20 })

          // Source list
          Column() {
            if (this.sources.length === 0) {
              Column() {
                Text('💾')
                  .fontSize(60)
                  .margin({ bottom: 16 })

                Text('暂无数据源')
                  .fontSize(16)
                  .fontColor(this.colors.text)

                Text('添加数据源以开始使用')
                  .fontSize(14)
                  .fontColor(this.colors.secondary)
                  .margin({ top: 8 })
              }
              .width('100%')
              .padding(40)
              .alignItems(HorizontalAlign.Center)
            } else {
              ForEach(this.sources, (source: Source) => {
                this.buildSourceItem(source)
              })
            }
          }
          .width('100%')
          .margin({ top: 20 })
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

      Text('数据源管理')
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
  buildSourceItem(source: Source) {
    Row() {
      Column() {
        Text(source.type || 'AudioDock')
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.colors.text)

        Text(source.address || '')
          .fontSize(12)
          .fontColor(this.colors.secondary)
          .margin({ top: 4 })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      // Status indicator
      Circle()
        .width(10)
        .height(10)
        .fill(source.status === 'connected' ? '#4CAF50' : '#FF5722')
        .margin({ right: 12 })

      Image($r('app.media.icon_more'))
        .width(20)
        .height(20)
        .fillColor(this.colors.secondary)
        .onClick(() => promptAction.showToast({ message: '数据源设置功能开发中' }))
    }
    .width('100%')
    .padding(16)
    .backgroundColor(this.colors.card)
    .borderRadius(12)
    .margin({ left: 16, right: 16, bottom: 12 })
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
