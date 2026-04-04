/**
 * Collection Detail Page - User's Favorites/Collection
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { Track } from '@ohos/common';
import { playerStore } from '../store';
import { ROUTE_PLAYER } from '../constants/RouteConstants';

@Entry
@Component
struct CollectionDetailPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State collectionName: string = '我的收藏';
  @State tracks: Track[] = [];
  @State loading: boolean = false;

  aboutToAppear() {
    const params = router.getParams() as Record<string, string>;
    if (params?.name) {
      this.collectionName = params.name;
    }
    this.loadCollection();
  }

  async loadCollection() {
    this.loading = true;
    // Mock data
    this.tracks = [];
    this.loading = false;
  }

  build() {
    Column() {
      this.buildHeader()

      if (this.loading) {
        this.buildLoading()
      } else if (this.tracks.length === 0) {
        this.buildEmpty()
      } else {
        this.buildContent()
      }
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

      Text(this.collectionName)
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)
        .layoutWeight(1)

      Image($r('app.media.icon_more'))
        .width(24)
        .height(24)
        .fillColor(this.colors.text)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
    .height(56)
  }

  @Builder
  buildLoading() {
    Column() {
      LoadingProgress().width(40).height(40)
      Text('加载中...').fontSize(14).fontColor(this.colors.secondary).margin({ top: 12 })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  buildEmpty() {
    Column() {
      Text('❤️')
        .fontSize(60)

      Text('暂无收藏内容')
        .fontSize(16)
        .fontColor(this.colors.text)
        .margin({ top: 16 })

      Text('开始收藏喜欢的音乐吧')
        .fontSize(14)
        .fontColor(this.colors.secondary)
        .margin({ top: 8 })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  buildContent() {
    Column() {
      Row() {
        Text(`${this.tracks.length} 首曲目`)
          .fontSize(14)
          .fontColor(this.colors.secondary)

        Blank()

        Button('播放全部')
          .height(32)
          .borderRadius(16)
          .backgroundColor(this.colors.primary)
          .fontColor('#FFFFFF')
          .fontSize(12)
          .onClick(() => this.playAll())
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 12, bottom: 12 })

      List() {
        ForEach(this.tracks, (track: Track, index: number) => {
          ListItem() {
            Row() {
              if (track.coverUrl) {
                Image(track.coverUrl)
                  .width(50)
                  .height(50)
                  .borderRadius(8)
              } else {
                Column() {
                  Text('♪').fontSize(20).fontColor(this.colors.secondary)
                }
                .width(50)
                .height(50)
                .borderRadius(8)
                .backgroundColor(this.colors.card)
                .justifyContent(FlexAlign.Center)
              }

              Column() {
                Text(track.title || '未知')
                  .fontSize(14)
                  .fontColor(this.colors.text)
                  .maxLines(1)

                Text(track.artist || '未知艺术家')
                  .fontSize(12)
                  .fontColor(this.colors.secondary)
                  .maxLines(1)
                  .margin({ top: 4 })
              }
              .layoutWeight(1)
              .margin({ left: 12 })

              Image($r('app.media.icon_heart_filled'))
                .width(20)
                .height(20)
                .fillColor('#FF4444')
                .onClick(() => promptAction.showToast({ message: '已取消收藏' }))

              Image($r('app.media.icon_more'))
                .width(20)
                .height(20)
                .fillColor(this.colors.secondary)
                .margin({ left: 12 })
            }
            .width('100%')
            .padding({ top: 8, bottom: 8, left: 20, right: 20 })
          }
          .onClick(() => this.playTrack(index))
        })
      }
      .layoutWeight(1)
    }
  }

  playAll() {
    if (this.tracks.length > 0) {
      playerStore.playTrackList(this.tracks, 0);
      router.pushUrl({ url: ROUTE_PLAYER });
    }
  }

  playTrack(index: number) {
    playerStore.playTrackList(this.tracks, index);
    router.pushUrl({ url: ROUTE_PLAYER });
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
