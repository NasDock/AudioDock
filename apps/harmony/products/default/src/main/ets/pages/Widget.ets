/**
 * Widget Page - Desktop Widget Display
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import { playerStore } from '../store';

@Entry
@Component
struct WidgetPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State trackTitle: string = '未播放';
  @State trackArtist: string = '';
  @State isPlaying: boolean = false;

  aboutToAppear() {
    this.syncState();
  }

  syncState() {
    const state = playerStore.getState();
    this.trackTitle = state.currentTrack?.title || '未播放';
    this.trackArtist = state.currentTrack?.artist || '';
    this.isPlaying = state.isPlaying;
  }

  build() {
    Column() {
      // Header
      Row() {
        Image($r('app.media.icon_logo'))
          .width(24)
          .height(24)
          .borderRadius(4)

        Text('AudioDock')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.colors.text)
          .margin({ left: 8 })

        Blank()

        if (this.isPlaying) {
          Text('♪')
            .fontSize(14)
            .fontColor(this.colors.primary)
        }
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 8, bottom: 8 })

      // Track info
      Row() {
        Column() {
          Text(this.trackTitle)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.colors.text)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })

          Text(this.trackArtist)
            .fontSize(12)
            .fontColor(this.colors.secondary)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .margin({ top: 2 })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 4, bottom: 4 })

      // Controls
      Row() {
        Image($r('app.media.icon_previous'))
          .width(20)
          .height(20)
          .fillColor(this.colors.text)
          .onClick(() => playerStore.playPrevious())

        Image(this.isPlaying ? $r('app.media.icon_pause') : $r('app.media.icon_play'))
          .width(28)
          .height(28)
          .fillColor(this.colors.text)
          .onClick(() => this.isPlaying ? playerStore.pause() : playerStore.play())

        Image($r('app.media.icon_next'))
          .width(20)
          .height(20)
          .fillColor(this.colors.text)
          .onClick(() => playerStore.playNext())
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .padding({ top: 8, bottom: 8 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors.card)
    .borderRadius(16)
    .onClick(() => router.pushUrl({ url: 'pages/Player' }))
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
