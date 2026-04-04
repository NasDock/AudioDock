/**
 * Tab Index (Home) Page
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import hilog from '@ohos.hilog';
import { playerStore } from '../store';
import { apiService, Track, Album, Artist } from '@ohos/common';
import { ROUTE_SEARCH } from '../constants/RouteConstants';

// ==================== Theme Colors ====================
class ThemeColors {
  background: string = '#FFFFFF';
  card: string = '#F5F5F5';
  text: string = '#000000';
  secondary: string = '#666666';
  border: string = '#E0E0E0';
  primary: string = '#007AFF';
}

// ==================== Section Types ====================
interface Section {
  id: string;
  title: string;
  tracks: Track[];
  type: 'artist' | 'album' | 'track';
}

// ==================== Tab Index Page ====================
@Entry
@Component
struct TabIndexPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State sections: Section[] = [];
  @State loading: boolean = true;
  @State refreshing: boolean = false;

  aboutToAppear() {
    this.loadData();
  }

  async loadData() {
    this.loading = true;

    try {
      const tracksRes = await apiService.getLatestTracks('MUSIC', false, 20);
      if (tracksRes.code === 200 && tracksRes.data) {
        const allTracks: Track[] = tracksRes.data as Track[];
        this.sections = [
          {
            id: 'latest',
            title: '最新音乐',
            tracks: allTracks.slice(0, 6),
            type: 'track'
          },
          {
            id: 'recommend',
            title: '推荐音乐',
            tracks: allTracks.slice(6, 12),
            type: 'track'
          }
        ];
      }
    } catch (e) {
      hilog.error(0x0001, 'TabIndex', 'Failed to load data: %{public}s', JSON.stringify(e));
    } finally {
      this.loading = false;
    }
  }

  build() {
    Column() {
      this.buildHeader()

      if (this.loading) {
        this.buildLoadingState()
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
      Column() {
        Image($r('app.media.icon_search'))
          .width(24)
          .height(24)
          .fillColor(this.colors.text)
      }
      .width(44)
      .height(44)
      .justifyContent(FlexAlign.Center)
      .onClick(() => router.pushUrl({ url: ROUTE_SEARCH }))

      Blank()

      Text('AudioDock')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)

      Blank()

      Column() {
        Image($r('app.media.icon_settings'))
          .width(24)
          .height(24)
          .fillColor(this.colors.text)
      }
      .width(44)
      .height(44)
      .justifyContent(FlexAlign.Center)
      .onClick(() => router.pushUrl({ url: 'pages/Settings' }))
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
    .height(56)
  }

  @Builder
  buildLoadingState() {
    Column() {
      LoadingProgress()
        .width(40)
        .height(40)

      Text('加载中...')
        .fontSize(14)
        .fontColor(this.colors.secondary)
        .margin({ top: 12 })
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
        ForEach(this.sections, (section: Section) => {
          this.buildSection(section)
        })
      }
      .padding({ bottom: 80 })
    }
    .width('100%')
    .layoutWeight(1)
    .edgeEffect(EdgeEffect.Spring)
  }

  @Builder
  buildSection(section: Section) {
    Column() {
      Row() {
        Text(section.title)
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.colors.text)

        Blank()

        Text('更多 >')
          .fontSize(14)
          .fontColor(this.colors.secondary)
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 20, bottom: 12 })

      Scroll() {
        Row() {
          ForEach(section.tracks, (track: Track, index: number) => {
            this.buildTrackCard(track, index)
          })
        }
        .padding({ left: 20, right: 20 })
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
    }
    .width('100%')
  }

  @Builder
  buildTrackCard(track: Track, index: number) {
    Column() {
      Stack() {
        if (track.coverUrl && track.coverUrl !== '') {
          Image(track.coverUrl)
            .width(140)
            .height(140)
            .borderRadius(12)
            .backgroundColor(this.colors.card)
        } else {
          Column() {
            Text(track.title?.charAt(0) || '?')
              .fontSize(32)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.colors.secondary)
          }
          .width(140)
          .height(140)
          .borderRadius(12)
          .backgroundColor(this.colors.card)
          .justifyContent(FlexAlign.Center)
          .alignItems(HorizontalAlign.Center)
        }

        Column() {
          Image($r('app.media.icon_play'))
            .width(32)
            .height(32)
            .fillColor('#FFFFFF')
        }
        .width(44)
        .height(44)
        .borderRadius(22)
        .backgroundColor('rgba(0,0,0,0.5)')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .position({ x: 54, y: 54 })
      }
      .onClick(() => this.handlePlayTrack(index))

      Text(track.title || '未知')
        .fontSize(14)
        .fontColor(this.colors.text)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .margin({ top: 8 })
        .width(140)

      Text(track.artist || '')
        .fontSize(12)
        .fontColor(this.colors.secondary)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width(140)
        .margin({ top: 2 })
    }
    .margin({ right: 12 })
  }

  handlePlayTrack(index: number) {
    const allTracks: Track[] = [];
    for (let i = 0; i < this.sections.length; i++) {
      const sectionTracks = this.sections[i].tracks;
      for (let j = 0; j < sectionTracks.length; j++) {
        allTracks.push(sectionTracks[j]);
      }
    }
    
    let globalIndex = 0;
    for (let i = 0; i < this.sections.length; i++) {
      const sectionTracks = this.sections[i].tracks;
      for (let j = 0; j < sectionTracks.length; j++) {
        if (i === 0 && j === index) {
          playerStore.playTrackList(allTracks, globalIndex);
          return;
        }
        globalIndex++;
      }
    }
  }
}
