/**
 * Player Page - Full Screen Audio Player
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { playerStore, PlayMode } from '../store';
import { Track } from '@ohos/common';

// ==================== Player Page ====================
@Entry
@Component
struct PlayerPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State isPlayingNow: boolean = false;
  @State track: Track | null = null;
  @State progress: number = 0;
  @State duration: number = 0;
  @State currentTime: number = 0;
  @State volume: number = 1.0;
  @State playMode: PlayMode = PlayMode.SEQUENCE;
  @State showLyrics: boolean = false;

  aboutToAppear() {
    this.syncState();
  }

  syncState() {
    const state = playerStore.getState();
    this.isPlayingNow = state.isPlaying;
    this.track = state.currentTrack;
    this.progress = state.progress;
    this.duration = state.duration;
    this.currentTime = state.currentTime;
    this.volume = state.volume;
    this.playMode = state.playMode;
  }

  build() {
    Column() {
      // Header
      this.buildHeader()

      // Cover art
      this.buildCoverArt()

      // Track info
      this.buildTrackInfo()

      // Progress bar
      this.buildProgressBar()

      // Control buttons
      this.buildControls()

      // Bottom actions
      this.buildBottomActions()
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors.background)
    .padding({ top: 44, bottom: 34 })
  }

  @Builder
  buildHeader() {
    Row() {
      Image($r('app.media.icon_chevron_down'))
        .width(24)
        .height(24)
        .fillColor(this.colors.text)
        .onClick(() => router.back())

      Blank()

      Text('正在播放')
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.colors.text)

      Blank()

      Image($r('app.media.icon_more'))
        .width(24)
        .height(24)
        .fillColor(this.colors.text)
        .onClick(() => promptAction.showToast({ message: '更多功能开发中' }))
    }
    .width('100%')
    .padding({ left: 20, right: 20 })
    .height(44)
  }

  @Builder
  buildCoverArt() {
    Column() {
      if (this.track?.coverUrl) {
        Image(this.track.coverUrl)
          .width('80%')
          .height('80%')
          .borderRadius(16)
          .shadow({
            radius: 30,
            color: 'rgba(0,0,0,0.3)',
            offsetX: 0,
            offsetY: 10
          })
      } else {
        Column() {
          Text(this.track?.title?.charAt(0) || '♪')
            .fontSize(80)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.colors.secondary)
        }
        .width('80%')
        .aspectRatio(1)
        .borderRadius(16)
        .backgroundColor(this.colors.card)
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
      }
    }
    .width('100%')
    .aspectRatio(1)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .padding({ top: 20, bottom: 20 })
  }

  @Builder
  buildTrackInfo() {
    Column() {
      Row() {
        Column() {
          Text(this.track?.title || '未知曲目')
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.colors.text)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })

          Text(this.track?.artist || '未知艺术家')
            .fontSize(14)
            .fontColor(this.colors.secondary)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .margin({ top: 4 })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)

        // Like button
        Image(this.track?.liked ? $r('app.media.icon_heart_filled') : $r('app.media.icon_heart'))
          .width(24)
          .height(24)
          .fillColor(this.track?.liked ? '#FF4444' : this.colors.secondary)
          .onClick(() => this.handleLike())
      }
      .width('100%')
      .padding({ left: 20, right: 20 })
    }
    .width('100%')
    .padding({ bottom: 20 })
  }

  @Builder
  buildProgressBar() {
    Column() {
      // Slider
      Slider({
        value: this.progress,
        min: 0,
        max: 100,
        style: SliderStyle.OutSet,
        step: 0.1
      })
        .width('100%')
        .height(40)
        .trackColor(this.colors.card)
        .selectedColor(this.colors.primary)
        .onChange((value: number) => {
          const seekTime = (value / 100) * this.duration;
          playerStore.seekTo(seekTime);
        })

      // Time labels
      Row() {
        Text(this.formatTime(this.currentTime))
          .fontSize(12)
          .fontColor(this.colors.secondary)

        Blank()

        Text(this.formatTime(this.duration))
          .fontSize(12)
          .fontColor(this.colors.secondary)
      }
      .width('100%')
      .padding({ left: 20, right: 20 })
    }
    .width('100%')
    .padding({ left: 20, right: 20, bottom: 20 })
  }

  @Builder
  buildControls() {
    Row() {
      // Play mode
      Image(this.getPlayModeIcon())
        .width(24)
        .height(24)
        .fillColor(this.colors.text)
        .onClick(() => this.handlePlayModeToggle())

      Blank()

      // Previous
      Image($r('app.media.icon_previous'))
        .width(32)
        .height(32)
        .fillColor(this.colors.text)
        .onClick(() => playerStore.playPrevious())

      Blank()

      // Play/Pause
      Image(this.isPlayingNow ? $r('app.media.icon_pause') : $r('app.media.icon_play'))
        .width(64)
        .height(64)
        .fillColor(this.colors.text)
        .onClick(() => this.handlePlayPause())

      Blank()

      // Next
      Image($r('app.media.icon_next'))
        .width(32)
        .height(32)
        .fillColor(this.colors.text)
        .onClick(() => playerStore.playNext())

      Blank()

      // Queue
      Image($r('app.media.icon_queue'))
        .width(24)
        .height(24)
        .fillColor(this.colors.text)
        .onClick(() => promptAction.showToast({ message: '播放队列功能开发中' }))
    }
    .width('100%')
    .padding({ left: 40, right: 40 })
    .height(80)
  }

  @Builder
  buildBottomActions() {
    Row() {
      // Lyrics toggle
      Column() {
        Image($r('app.media.icon_lyrics'))
          .width(20)
          .height(20)
          .fillColor(this.showLyrics ? this.colors.primary : this.colors.secondary)
        Text('歌词')
          .fontSize(10)
          .fontColor(this.showLyrics ? this.colors.primary : this.colors.secondary)
          .margin({ top: 4 })
      }
      .onClick(() => this.showLyrics = !this.showLyrics)

      Blank()

      // Volume
      Column() {
        Image($r('app.media.icon_volume'))
          .width(20)
          .height(20)
          .fillColor(this.colors.secondary)
        Text('音量')
          .fontSize(10)
          .fontColor(this.colors.secondary)
          .margin({ top: 4 })
      }
      .onClick(() => this.handleVolumeToggle())

      Blank()

      // Airplay / Cast
      Column() {
        Image($r('app.media.icon_cast'))
          .width(20)
          .height(20)
          .fillColor(this.colors.secondary)
        Text('投屏')
          .fontSize(10)
          .fontColor(this.colors.secondary)
          .margin({ top: 4 })
      }
      .onClick(() => promptAction.showToast({ message: '投屏功能开发中' }))
    }
    .width('60%')
    .justifyContent(FlexAlign.SpaceBetween)
    .padding({ top: 20 })
  }

  handlePlayPause() {
    if (this.isPlayingNow) {
      playerStore.pause();
    } else {
      playerStore.play();
    }
    this.syncState();
  }

  handleLike() {
    promptAction.showToast({ message: '收藏功能开发中' });
  }

  handlePlayModeToggle() {
    playerStore.toggleRepeat();
    this.syncState();
  }

  handleVolumeToggle() {
    playerStore.toggleMute();
    this.syncState();
  }

  getPlayModeIcon(): Resource {
    switch (this.playMode) {
      case PlayMode.LOOP:
        return $r('app.media.icon_loop');
      case PlayMode.SINGLE:
        return $r('app.media.icon_loop_one');
      case PlayMode.RANDOM:
        return $r('app.media.icon_shuffle');
      default:
        return $r('app.media.icon_sequence');
    }
  }

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
