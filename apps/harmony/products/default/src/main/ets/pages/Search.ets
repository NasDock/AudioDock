/**
 * Search Page
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import hilog from '@ohos.hilog';
import { apiService, Track, Album, Artist, SearchResult } from '@ohos/common';
import { playerStore } from '../store';
import { ROUTE_PLAYER } from '../constants/RouteConstants';

// ==================== Search Result Types ====================
type SearchCategory = 'tracks' | 'albums' | 'artists' | 'playlists';
type SearchState = 'idle' | 'loading' | 'results' | 'empty';

// ==================== Search Page ====================
@Entry
@Component
struct SearchPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State searchQuery: string = '';
  @State searchState: SearchState = 'idle';
  @State results: SearchResult | null = null;
  @State recentSearches: string[] = ['周杰伦', '陈奕迅', 'Taylor Swift'];
  @State hotKeywords: string[] = ['流行', '摇滚', '民谣', '电子', '古典', '爵士', '嘻哈', 'R&B'];
  @State selectedCategory: SearchCategory = 'tracks';

  private searchTimer: number = -1;

  build() {
    Column() {
      // Search header
      this.buildHeader()

      if (this.searchState === 'idle') {
        this.buildIdleContent()
      } else if (this.searchState === 'loading') {
        this.buildLoadingContent()
      } else if (this.searchState === 'empty') {
        this.buildEmptyContent()
      } else {
        this.buildResultsContent()
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

      // Search input
      TextInput({ placeholder: '搜索音乐、专辑、艺术家', text: this.searchQuery })
        .width('70%')
        .height(40)
        .borderRadius(20)
        .backgroundColor(this.colors.card)
        .fontColor(this.colors.text)
        .placeholderColor(this.colors.secondary)
        .fontSize(14)
        .onChange((val) => {
          this.searchQuery = val;
          this.debounceSearch();
        })
        .onSubmit(() => this.performSearch())

      Text('搜索')
        .fontSize(14)
        .fontColor(this.colors.primary)
        .margin({ left: 12 })
        .onClick(() => this.performSearch())
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
    .height(56)
  }

  @Builder
  buildIdleContent() {
    Scroll() {
      Column() {
        // Recent searches
        if (this.recentSearches.length > 0) {
          Row() {
            Text('最近搜索')
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.colors.text)

            Blank()

            Text('清除')
              .fontSize(14)
              .fontColor(this.colors.secondary)
              .onClick(() => this.recentSearches = [])
          }
          .width('100%')
          .padding({ left: 20, right: 20, top: 20, bottom: 12 })

          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.recentSearches, (keyword: string) => {
              Text(keyword)
                .fontSize(14)
                .fontColor(this.colors.text)
                .backgroundColor(this.colors.card)
                .borderRadius(16)
                .padding({ left: 14, right: 14, top: 8, bottom: 8 })
                .margin({ right: 8, bottom: 8 })
                .onClick(() => {
                  this.searchQuery = keyword;
                  this.performSearch();
                })
            })
          }
          .width('100%')
          .padding({ left: 20, right: 20 })
        }

        // Hot keywords
        Text('热门搜索')
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.colors.text)
          .width('100%')
          .padding({ left: 20, right: 20, top: 24, bottom: 12 })

        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.hotKeywords, (keyword: string) => {
            Text(keyword)
              .fontSize(14)
              .fontColor(this.colors.primary)
              .borderRadius(16)
              .border({ width: 1, color: this.colors.primary })
              .padding({ left: 14, right: 14, top: 8, bottom: 8 })
              .margin({ right: 8, bottom: 8 })
              .onClick(() => {
                this.searchQuery = keyword;
                this.performSearch();
              })
          })
        }
        .width('100%')
        .padding({ left: 20, right: 20 })
      }
      .width('100%')
      .padding({ bottom: 80 })
    }
    .layoutWeight(1)
  }

  @Builder
  buildLoadingContent() {
    Column() {
      LoadingProgress()
        .width(40)
        .height(40)

      Text('搜索中...')
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
  buildEmptyContent() {
    Column() {
      Image($r('app.media.icon_search'))
        .width(80)
        .height(80)
        .fillColor(this.colors.secondary)
        .opacity(0.5)

      Text('未找到相关结果')
        .fontSize(16)
        .fontColor(this.colors.text)
        .margin({ top: 16 })

      Text('请尝试其他关键词')
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
  buildResultsContent() {
    Column() {
      // Category tabs
      Row() {
        ForEach(['tracks', 'albums', 'artists'] as SearchCategory[], (cat: SearchCategory) => {
          Column() {
            Text(this.getCategoryName(cat))
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.selectedCategory === cat ? this.colors.primary : this.colors.secondary)

            Divider()
              .width('100%')
              .strokeWidth(this.selectedCategory === cat ? 2 : 0)
              .color(this.colors.primary)
          }
          .layoutWeight(1)
          .padding({ top: 12, bottom: 12 })
          .onClick(() => this.selectedCategory = cat)
        })
      }
      .width('100%')
      .backgroundColor(this.colors.card)
      .padding({ left: 16, right: 16 })

      // Results list
      Scroll() {
        Column() {
          if (this.selectedCategory === 'tracks') {
            this.buildTrackResults()
          } else if (this.selectedCategory === 'albums') {
            this.buildAlbumResults()
          } else {
            this.buildArtistResults()
          }
        }
        .width('100%')
        .padding({ bottom: 80 })
      }
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  buildTrackResults() {
    if (this.results?.tracks && this.results.tracks.length > 0) {
      ForEach(this.results.tracks, (track: Track) => {
        Row() {
          Column() {
            if (track.coverUrl) {
              Image(track.coverUrl)
                .width(50)
                .height(50)
                .borderRadius(8)
            } else {
              Column() {
                Text('♪')
                  .fontSize(20)
                  .fontColor(this.colors.secondary)
              }
              .width(50)
              .height(50)
              .borderRadius(8)
              .backgroundColor(this.colors.card)
              .justifyContent(FlexAlign.Center)
            }
          }

          Column() {
            Text(track.title || '未知')
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.colors.text)
              .maxLines(1)

            Text(track.artist || '未知艺术家')
              .fontSize(12)
              .fontColor(this.colors.secondary)
              .maxLines(1)
              .margin({ top: 4 })
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
          .margin({ left: 12 })

          Image($r('app.media.icon_more'))
            .width(20)
            .height(20)
            .fillColor(this.colors.secondary)
        }
        .width('100%')
        .padding({ left: 20, right: 20, top: 12, bottom: 12 })
        .onClick(() => this.playTrack(track))
      })
    } else {
      Text('暂无曲目结果')
        .fontSize(14)
        .fontColor(this.colors.secondary)
        .width('100%')
        .padding(20)
        .textAlign(TextAlign.Center)
    }
  }

  @Builder
  buildAlbumResults() {
    if (this.results?.albums && this.results.albums.length > 0) {
      Grid() {
        ForEach(this.results.albums, (album: Album) => {
          GridItem() {
            Column() {
              if (album.coverUrl) {
                Image(album.coverUrl)
                  .width('100%')
                  .aspectRatio(1)
                  .borderRadius(12)
              } else {
                Column() {
                  Text('💿')
                    .fontSize(40)
                }
                .width('100%')
                .aspectRatio(1)
                .borderRadius(12)
                .backgroundColor(this.colors.card)
                .justifyContent(FlexAlign.Center)
              }

              Text(album.name || '未知专辑')
                .fontSize(12)
                .fontColor(this.colors.text)
                .maxLines(1)
                .margin({ top: 8 })

              Text(album.artist || '')
                .fontSize(10)
                .fontColor(this.colors.secondary)
                .maxLines(1)
            }
          }
        })
      }
      .columnsTemplate('3fr 3fr 3fr')
      .columnsGap(12)
      .rowsGap(16)
      .width('100%')
      .padding(20)
    } else {
      Text('暂无专辑结果')
        .fontSize(14)
        .fontColor(this.colors.secondary)
        .width('100%')
        .padding(20)
        .textAlign(TextAlign.Center)
    }
  }

  @Builder
  buildArtistResults() {
    if (this.results?.artists && this.results.artists.length > 0) {
      ForEach(this.results.artists, (artist: Artist) => {
        Row() {
          if (artist.avatarUrl) {
            Image(artist.avatarUrl)
              .width(50)
              .height(50)
              .borderRadius(25)
          } else {
            Column() {
              Text(artist.name?.charAt(0) || '?')
                .fontSize(20)
                .fontWeight(FontWeight.Bold)
                .fontColor('#FFFFFF')
            }
            .width(50)
            .height(50)
            .borderRadius(25)
            .backgroundColor(this.colors.primary)
            .justifyContent(FlexAlign.Center)
          }

          Column() {
            Text(artist.name || '未知艺术家')
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.colors.text)

            if (artist.trackCount) {
              Text(`${artist.trackCount} 首曲目`)
                .fontSize(12)
                .fontColor(this.colors.secondary)
                .margin({ top: 4 })
            }
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
          .margin({ left: 12 })
        }
        .width('100%')
        .padding({ left: 20, right: 20, top: 12, bottom: 12 })
        .onClick(() => {
          if (artist.id) {
            router.pushUrl({ url: 'pages/ArtistDetail', params: { id: artist.id } });
          }
        })
      })
    } else {
      Text('暂无艺术家结果')
        .fontSize(14)
        .fontColor(this.colors.secondary)
        .width('100%')
        .padding(20)
        .textAlign(TextAlign.Center)
    }
  }

  debounceSearch() {
    if (this.searchTimer !== -1) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.performSearch();
    }, 500);
  }

  async performSearch() {
    if (!this.searchQuery.trim()) {
      this.searchState = 'idle';
      return;
    }

    this.searchState = 'loading';

    try {
      const response = await apiService.search(this.searchQuery);
      if (response.code === 200) {
        this.results = response.data;
        this.searchState = (response.data.tracks?.length || 0) === 0 &&
          (response.data.albums?.length || 0) === 0 &&
          (response.data.artists?.length || 0) === 0 ? 'empty' : 'results';

        // Add to recent searches
        if (!this.recentSearches.includes(this.searchQuery)) {
          this.recentSearches.unshift(this.searchQuery);
          if (this.recentSearches.length > 10) {
            this.recentSearches.pop();
          }
        }
      }
    } catch (e) {
      hilog.error(0x0001, 'Search', 'Search failed: %{public}s', JSON.stringify(e));
      this.searchState = 'empty';
    }
  }

  playTrack(track: Track) {
    if (this.results?.tracks) {
      const index = this.results.tracks.findIndex(t => t.id === track.id);
      if (index >= 0) {
        playerStore.playTrackList(this.results.tracks, index);
        router.pushUrl({ url: ROUTE_PLAYER });
      }
    }
  }

  getCategoryName(cat: SearchCategory): string {
    switch (cat) {
      case 'tracks': return '曲目';
      case 'albums': return '专辑';
      case 'artists': return '艺术家';
      default: return '';
    }
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
