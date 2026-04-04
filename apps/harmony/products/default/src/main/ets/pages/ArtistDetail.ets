/**
 * Artist Detail Page
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { Artist, Track, Album } from '@ohos/common';
import { playerStore } from '../store';
import { ROUTE_PLAYER, ROUTE_ALBUM_DETAIL } from '../constants/RouteConstants';

@Entry
@Component
struct ArtistDetailPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State artist: Artist | null = null;
  @State tracks: Track[] = [];
  @State albums: Album[] = [];
  @State loading: boolean = true;

  aboutToAppear() {
    const params = router.getParams() as Record<string, string | number>;
    if (params?.id) {
      this.loadArtist(params.id as number);
    }
  }

  async loadArtist(id: number) {
    this.loading = true;
    // Mock data for demonstration
    this.artist = { id, name: '艺术家', trackCount: 50, albumCount: 5 };
    this.tracks = [];
    this.albums = [];
    this.loading = false;
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

      Text(this.artist?.name || '艺术家')
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
    Scroll() {
      Column() {
        // Artist header
        Column() {
          if (this.artist?.avatarUrl) {
            Image(this.artist.avatarUrl)
              .width(120)
              .height(120)
              .borderRadius(60)
          } else {
            Column() {
              Text(this.artist?.name?.charAt(0) || '?')
                .fontSize(48)
                .fontWeight(FontWeight.Bold)
                .fontColor('#FFFFFF')
            }
            .width(120)
            .height(120)
            .borderRadius(60)
            .backgroundColor(this.colors.primary)
            .justifyContent(FlexAlign.Center)
            .alignItems(HorizontalAlign.Center)
          }

          Text(this.artist?.name || '未知艺术家')
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.colors.text)
            .margin({ top: 16 })

          Text(`${this.artist?.trackCount || 0} 首曲目 · ${this.artist?.albumCount || 0} 张专辑`)
            .fontSize(14)
            .fontColor(this.colors.secondary)
            .margin({ top: 8 })

          Row() {
            Button('播放全部')
              .height(36)
              .borderRadius(18)
              .backgroundColor(this.colors.primary)
              .fontColor('#FFFFFF')
              .fontSize(14)
              .onClick(() => this.playAll())

            Button('收藏')
              .height(36)
              .borderRadius(18)
              .backgroundColor(this.colors.card)
              .fontColor(this.colors.text)
              .fontSize(14)
              .margin({ left: 12 })
              .onClick(() => promptAction.showToast({ message: '收藏功能开发中' }))
          }
          .margin({ top: 16 })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Center)
        .padding(20)

        // Albums section
        if (this.albums.length > 0) {
          Column() {
            Text('专辑')
              .fontSize(18)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.colors.text)
              .width('100%')
              .padding({ left: 20, top: 20, bottom: 12 })

            Scroll() {
              Row() {
                ForEach(this.albums, (album: Album) => {
                  Column() {
                    if (album.coverUrl) {
                      Image(album.coverUrl)
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
                    }

                    Text(album.name || '未知')
                      .fontSize(12)
                      .fontColor(this.colors.text)
                      .maxLines(1)
                      .margin({ top: 8 })
                  }
                  .margin({ right: 12 })
                  .onClick(() => router.pushUrl({ url: ROUTE_ALBUM_DETAIL, params: { id: album.id } }))
                })
              }
              .padding({ left: 20, right: 20 })
            }
            .scrollable(ScrollDirection.Horizontal)
            .scrollBar(BarState.Off)
          }
          .width('100%')
        }

        // Popular tracks
        Text('热门曲目')
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.colors.text)
          .width('100%')
          .padding({ left: 20, top: 20, bottom: 12 })

        ForEach(this.tracks.slice(0, 10), (track: Track, index: number) => {
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

              Text(track.album || '')
                .fontSize(12)
                .fontColor(this.colors.secondary)
                .maxLines(1)
                .margin({ top: 4 })
            }
            .layoutWeight(1)

            Image($r('app.media.icon_more'))
              .width(20)
              .height(20)
              .fillColor(this.colors.secondary)
          }
          .width('100%')
          .padding({ top: 12, bottom: 12, left: 20, right: 20 })
          .onClick(() => this.playTrack(index))
        })
      }
      .width('100%')
      .padding({ bottom: 80 })
    }
    .layoutWeight(1)
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
