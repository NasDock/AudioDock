/**
 * Tab Library Page - Music Library
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import { ROUTE_PLAYLIST_DETAIL, ROUTE_ALBUM_DETAIL, ROUTE_ARTIST_DETAIL, ROUTE_COLLECTION_DETAIL, ROUTE_FOLDER_INDEX } from '../constants/RouteConstants';

// ==================== Library Item ====================
interface LibraryItem {
  id: string;
  icon: string;
  title: string;
  count?: number;
  route: string;
}

// ==================== Tab Library Page ====================
@Entry
@Component
struct TabLibraryPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();

  private libraryItems: LibraryItem[] = [
    { id: 'playlist', icon: '🎵', title: '歌单', count: 0, route: ROUTE_PLAYLIST_DETAIL },
    { id: 'album', icon: '💿', title: '专辑', count: 0, route: ROUTE_ALBUM_DETAIL },
    { id: 'artist', icon: '🎤', title: '艺术家', count: 0, route: ROUTE_ARTIST_DETAIL },
    { id: 'collection', icon: '❤️', title: '收藏', count: 0, route: ROUTE_COLLECTION_DETAIL },
    { id: 'folder', icon: '📁', title: '文件夹', count: 0, route: ROUTE_FOLDER_INDEX },
  ];

  build() {
    Column() {
      // Header
      this.buildHeader()

      Scroll() {
        Column() {
          // Library grid
          Grid() {
            ForEach(this.libraryItems, (item: LibraryItem) => {
              GridItem() {
                this.buildLibraryItem(item)
              }
            })
          }
          .columnsTemplate('1fr 1fr')
          .columnsGap(12)
          .rowsGap(12)
          .width('100%')
          .padding({ left: 20, right: 20 })
        }
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
    Text('音乐库')
      .fontSize(24)
      .fontWeight(FontWeight.Bold)
      .fontColor(this.colors.text)
      .width('100%')
      .padding(20)
  }

  @Builder
  buildLibraryItem(item: LibraryItem) {
    Row() {
      Column() {
        Text(item.icon)
          .fontSize(32)
          .margin({ bottom: 8 })

        Text(item.title)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.colors.text)

        if (item.count !== undefined && item.count > 0) {
          Text(`${item.count} 首`)
            .fontSize(12)
            .fontColor(this.colors.secondary)
            .margin({ top: 4 })
        }
      }
      .width('100%')
      .padding(20)
      .backgroundColor(this.colors.card)
      .borderRadius(16)
      .alignItems(HorizontalAlign.Center)
    }
    .width('100%')
    .height(140)
    .onClick(() => {
      // Navigate to the respective page
      if (item.route) {
        router.pushUrl({ url: item.route });
      }
    })
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
