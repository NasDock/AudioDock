/**
 * Album Detail Page
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import hilog from '@ohos.hilog';
import { apiService, Album, Track } from '@ohos/common';
import { playerStore } from '../store';
import { ROUTE_PLAYER } from '../constants/RouteConstants';

@Entry
@Component
struct AlbumDetailPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State album: Album | null = null;
  @State tracks: Track[] = [];
  @State loading: boolean = true;

  aboutToAppear() {
    const params = router.getParams() as Record<string, string | number>;
    if (params?.id) {
      this.loadAlbum(params.id as number);
    }
  }

  async loadAlbum(id: number) {
    this.loading = true;
    try {
      const response = await apiService.getAlbumById(id);
      if (response.code === 200) {
        this.album = response.data;
        this.tracks = response.data.tracks || [];
      }
    } catch (e) {
      hilog.error(0x0001, 'AlbumDetail', 'Failed to load album: %{public}s', JSON.stringify(e));
    } finally {
      this.loading = false;
    }
  }

  build() {
    Column() {
      this.buildHeader()
      if (this.loading) {
        this.buildLoading()
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

      Text(this.album?.name || '专辑')
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
  buildContent() {
    Column() {
      Row() {
        if (this.album?.coverUrl) {
          Image(this.album.coverUrl)
            .width(120)
            .height(120)
            .borderRadius(12)
        } else {
          Column() {
            Text('💿').fontSize(40)
          }
          .width(120)
          .height(120)
          .borderRadius(12)
          .backgroundColor(this.colors.card)
          .justifyContent(FlexAlign.Center)
          .alignItems(HorizontalAlign.Center)
        }

        Column() {
          Text(this.album?.name || '未知专辑')
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.colors.text)

          Text(this.album?.artist || '未知艺术家')
            .fontSize(14)
            .fontColor(this.colors.secondary)
            .margin({ top: 8 })

          Text(`${this.album?.releaseDate || ''} · ${this.tracks.length} 首`)
            .fontSize(12)
            .fontColor(this.colors.secondary)
            .margin({ top: 4 })

          Button('播放全部')
            .height(36)
            .borderRadius(18)
            .backgroundColor(this.colors.primary)
            .fontColor('#FFFFFF')
            .fontSize(14)
            .margin({ top: 12 })
            .onClick(() => this.playAll())
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        .margin({ left: 16 })
      }
      .width('100%')
      .padding(20)

      List() {
        ForEach(this.tracks, (track: Track, index: number) => {
          ListItem() {
            Row() {
              Text(`${index + 1}`)
                .fontSize(14)
                .fontColor(this.colors.secondary)
                .width(40)

              Column() {
                Text(track.title || '未知')
                  .fontSize(14)
                  .fontColor(this.colors.text)
                  .maxLines(1)

                if (track.duration) {
                  Text(this.formatDuration(track.duration))
                    .fontSize(12)
                    .fontColor(this.colors.secondary)
                    .margin({ top: 4 })
                }
              }
              .layoutWeight(1)

              Image($r('app.media.icon_more'))
                .width(20)
                .height(20)
                .fillColor(this.colors.secondary)
            }
            .width('100%')
            .padding({ top: 12, bottom: 12, left: 20, right: 20 })
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

  formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
