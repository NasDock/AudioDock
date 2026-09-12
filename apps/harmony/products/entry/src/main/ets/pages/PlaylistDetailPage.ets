import promptAction from '@ohos.promptAction';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import { formatDuration } from 'audiodock_common';
import { playlistApi } from 'features_network';
import type { PlaylistDto, TrackDto } from 'features_network';
import { resolveTrackToPlayer } from '../services/trackResolver';
import { playerStore } from '../context/PlayerStore';
import type { Track } from '../context/PlayerStore';
import { CoverImage } from '../components/CoverImage';
import { getImageUrl } from '../utils/image';
import { miniPlayerHasContent } from '../components/MiniPlayer';
import { AppIcon } from '../components/AppIcon';
import { Logger } from 'audiodock_common';

interface PlaylistDetail extends PlaylistDto { tracks: TrackDto[] }

@Component
export struct PlaylistDetailContent {
  // 路由栈与 id 由 RootShellPage 通过 navDestination builder 注入
  // 注意：属性名不能用 'id'（ArkUI CustomComponent 保留），统一用 'entityId'
  pathStack: NavPathStack = new NavPathStack();
  entityId: string = '';
  // 车机模式详情页跳转回调：非空时优先走右栏局部渲染，不进入全局路由
  carNavCallback?: (name: string, id: string) => void;
  // 车机模式返回回调：非空时返回按钮回退到右栏 tab 列表，不弹全局路由栈
  carBackCallback?: () => void;
  @State data: PlaylistDetail | null = null;
  @State loading: boolean = true;
  @State error: string = '';
  @State showMore: boolean = false;
  @State showRename: boolean = false;
  @State newName: string = '';
  @State renaming: boolean = false;
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  // 车机模式下 GlobalBottomBar 已在 RootShellPage 隐藏，本页也走全屏 NavDestination，
  // 不需要给 GlobalBottomBar/MiniPlayer 预留底部空间（修复底部多 56 空白）。
  @StorageLink('carModeEnabled') carModeEnabled: boolean = false;
  @StorageProp('appLang') appLang: string = 'zh-CN';
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.load();
  }

  onPageShow(): void {
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;
  }

  build() {
    if (this.langAtBuild === 'zh-CN') {
      this.LocalizedContent()
    } else {
      this.LocalizedContent()
    }
  }

  @Builder
  LocalizedContent() {
    Column() {
      // Header
      Row() {
        Text('‹').fontSize(28).fontColor(this.theme.colors.text)
          .onClick(() => {
            if (this.carBackCallback) {
              this.carBackCallback();
            } else {
              this.pathStack.pop();
            }
          })
          .width(44).height(44).textAlign(TextAlign.Center)
        Text(this.data?.name ?? '')
          .fontSize(18).fontWeight(FontWeight.Bold)
          .fontColor(this.theme.colors.text)
          .layoutWeight(1)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text('⋮').fontSize(22).fontColor(this.theme.colors.text)
          .width(44).height(44).textAlign(TextAlign.Center)
          .onClick(() => { this.showMore = true; })
      }
      .width('100%').height(56)
      .padding({ left: 10, right: 10 })
      .alignItems(VerticalAlign.Center)

      if (this.loading) {
        Column() {
          LoadingProgress().width(48).height(48).color(this.theme.colors.primary)
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (this.error || !this.data) {
        Column() {
          Text(this.error || t('detail.retry_failed'))
            .fontSize(14).fontColor(this.theme.colors.textSecondary)
          Button(t('common.retry'))
            .backgroundColor(this.theme.colors.primary).fontColor(this.theme.colors.onPrimary).borderRadius(18)
            .margin({ top: 12 })
            .onClick(() => this.load())
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
      } else {
        this.Content()
      }

      // GlobalBottomBar 已由 RootShellPage 在 Navigation 容器外统一挂载，跨页面常驻。
      // 这里不再手动挂载，避免每次进详情页重建一份。

      // ArkUI 每个组件只能绑定一个 bindSheet，用不可见锚点分散绑定（对齐 PlayerPage/AlbumDetailPage 的做法）。
      // 之前两个 bindSheet 都挂在根 Column 上，导致「⋮」更多弹窗点了不显示。
      Column().width(0).height(0)
        .bindSheet($$this.showMore, this.MoreSheet(), {
          height: 320,
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })
      Column().width(0).height(0)
        .bindSheet($$this.showRename, this.RenameSheet(), {
          height: 220,
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })
    }
    .width('100%').height('100%').backgroundColor(this.theme.colors.background)
  }

  @Builder
  Content() {
    List() {
      // 封面墙
      ListItem() {
        this.CoverWall()
      }

      // 播放全部按钮（文字/图标用 onPrimary：暗色模式下 primary 是白色，
      // 硬编码 '#FFFFFF' 会白底白字；mobile 用的是 colors.background，等价语义）
      ListItem() {
        Row() {
          AppIcon({ name: 'play', iconSize: 18, color: this.theme.colors.onPrimary })
          Text(t('playlist.playAll'))
            .fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor(this.theme.colors.onPrimary).margin({ left: 8 })
        }
        .width('100%').height(48)
        .justifyContent(FlexAlign.Center)
        .backgroundColor(this.theme.colors.primary)
        .borderRadius(12)
        // 宽度 100% + 左右间距放在外层 ListItem 的 padding 上：
        // ListItem 里 margin 不会从 100% 宽度中扣除（会向右溢出），
        // 而 Row 不写 100% 又会收缩成内容宽度。
        .onClick(() => this.handlePlayAll())
      }
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })

      // 曲目列表
      ForEach(this.data!.tracks, (tr: TrackDto, index: number) => {
        ListItem() {
          Row() {
            Text(`${index + 1}`)
              .fontSize(14)
              .fontColor(this.theme.colors.textSecondary)
              .width(30).textAlign(TextAlign.Center)
            CoverImage({
              path: tr.cover ?? '',
              imgWidth: 40, imgHeight: 40, radius: 6,
              fallbackText: (tr.name ?? '?').substring(0, 1),
            }).margin({ left: 8, right: 12 })
            Column() {
              Text(tr.name)
                .fontSize(15).fontWeight(FontWeight.Medium)
                .fontColor(this.theme.colors.text)
                .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              if (tr.artist) {
                Text(tr.artist)
                  .fontSize(12).fontColor(this.theme.colors.textSecondary)
                  .margin({ top: 3 })
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              }
            }
            .layoutWeight(1).alignItems(HorizontalAlign.Start)
            Text(formatDuration((tr.duration ?? 0) * 1000))
              .fontSize(12).fontColor(this.theme.colors.textSecondary)
          }
          .width('100%')
          .padding({ top: 10, bottom: 10, left: 16, right: 16 })
          .alignItems(VerticalAlign.Center)
          .onClick(() => this.playFromIndex(index))
        }
      }, (tr: TrackDto) => tr.id)
    }
    .width('100%').layoutWeight(1)
    // 避让悬浮的 GlobalBottomBar（Tab 栏 56 + MiniPlayer 60，MiniPlayer 空队列不占高度），
    // 否则最后几行曲目被遮挡（对齐 mobile 的列表底部留白）
    .padding({ bottom: this.carModeEnabled ? 0 : (miniPlayerHasContent() ? 116 : 56) })
    .scrollBar(BarState.Off)
  }

  // 封面墙：1:1 对齐 mobile app/playlist/[id].tsx 的 photoWall——
  // flex wrap 三行「小-大-大-小 / 大-大-大 / 小-大-大-小」，
  // 索引 [0,3,7,10] 是小格（宽 16.66%、宽高比 0.5），其余大格（宽 33.33%、1:1），
  // 每格 padding 2 做间距、图片填满、无圆角、灰底占位、整墙 100% 宽无外边距。
  @Builder
  CoverWall() {
    Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Start }) {
      ForEach(this.getWallCovers(), (url: string, idx: number) => {
        Image(getImageUrl(url, 400))
          .width(this.wallCellWidth(idx))
          .aspectRatio(this.wallCellRatio(idx))
          .padding(2)
          .objectFit(ImageFit.Cover)
          .backgroundColor('#DDDDDD')
      }, (url: string, idx: number) => `cw-${idx}`)
    }
    .width('100%')
  }

  // 索引 [0,3,7,10] 为小格（对齐 mobile 的 isSmall）
  private wallCellWidth(idx: number): string {
    return [0, 3, 7, 10].indexOf(idx) >= 0 ? '16.66%' : '33.33%';
  }

  private wallCellRatio(idx: number): number {
    return [0, 3, 7, 10].indexOf(idx) >= 0 ? 0.5 : 1;
  }

  @Builder
  MoreSheet() {
    Column() {
      Text(t('playlistDetail.title'))
        .fontSize(16).fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 12 })

      // 播放全部
      Row() {
        AppIcon({ name: 'play', iconSize: 20, color: this.theme.colors.primary })
        Text(t('playlist.playAll')).fontSize(15).fontColor(this.theme.colors.text).margin({ left: 12 })
      }
      .width('100%').padding({ top: 14, bottom: 14, left: 20, right: 20 })
      .alignItems(VerticalAlign.Center)
      .onClick(() => { this.showMore = false; this.handlePlayAll(); })

      // 重命名
      Row() {
        Text('✎').fontSize(18).fontColor(this.theme.colors.text)
        Text(t('playlistDetail.editPlaylist')).fontSize(15).fontColor(this.theme.colors.text).margin({ left: 12 })
      }
      .width('100%').padding({ top: 14, bottom: 14, left: 20, right: 20 })
      .alignItems(VerticalAlign.Center)
      .onClick(() => {
        this.showMore = false;
        this.newName = this.data?.name ?? '';
        setTimeout(() => { this.showRename = true; }, 150);
      })

      // 解散
      Row() {
        Text('🗑').fontSize(18)
        Text(t('playlistDetail.deletePlaylist')).fontSize(15).fontColor('#FF3B30').margin({ left: 12 })
      }
      .width('100%').padding({ top: 14, bottom: 14, left: 20, right: 20 })
      .alignItems(VerticalAlign.Center)
      .onClick(() => { this.showMore = false; this.handleDelete(); })
    }
    .width('100%').padding({ left: 4, right: 4 })
  }

  @Builder
  RenameSheet() {
    Column() {
      Text(t('playlistDetail.editPlaylist'))
        .fontSize(16).fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 16 })

      TextInput({ placeholder: t('playlist.namePlaceholder'), text: this.newName })
        .height(48)
        .borderRadius(10)
        .border({ width: 1, color: this.theme.colors.border })
        .backgroundColor(this.theme.colors.card)
        .fontColor(this.theme.colors.text)
        .fontSize(15)
        .padding({ left: 14, right: 14 })
        .onChange((v: string) => { this.newName = v; })

      Button() {
        if (this.renaming) {
          LoadingProgress().width(20).height(20).color(this.theme.colors.onPrimary)
        } else {
          Text(t('common.confirm')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.theme.colors.onPrimary)
        }
      }
      .width('100%').height(46)
      .borderRadius(10)
      .backgroundColor(this.theme.colors.primary)
      .margin({ top: 16 })
      .enabled(this.newName.trim().length > 0 && !this.renaming)
      .onClick(() => this.handleRename())
    }
    .width('100%').padding({ left: 20, right: 20 })
  }

  // 按专辑去重（album 为空时用曲名兜底），最多 11 张——对齐 mobile uniqueAlbums
  private getWallCovers(): string[] {
    if (!this.data || !this.data.tracks) return [];
    const urls: string[] = [];
    const seen: Set<string> = new Set();
    for (const tr of this.data.tracks) {
      const albumKey = tr.album ?? tr.name ?? '';
      if (seen.has(albumKey)) continue;
      seen.add(albumKey);
      urls.push(tr.cover ?? '');
      if (urls.length >= 11) break;
    }
    return urls;
  }

  private async handlePlayAll(): Promise<void> {
    if (!this.data || this.data.tracks.length === 0) return;
    try {
      const tracks: Track[] = [];
      for (const x of this.data.tracks) tracks.push(await resolveTrackToPlayer(x, false));
      await playerStore.playTrackList(tracks, 0);
      // 不再自动打开播放详情页：播放交给 MiniPlayer，用户点 MiniPlayer 再进详情
    } catch (e) {
      Logger.w('PlaylistDetail', `playAll failed: ${String(e)}`);
    }
  }

  private async playFromIndex(index: number): Promise<void> {
    if (!this.data || this.data.tracks.length === 0) return;
    try {
      const tracks: Track[] = [];
      for (const x of this.data.tracks) tracks.push(await resolveTrackToPlayer(x, false));
      await playerStore.playTrackList(tracks, index);
      // 不再自动打开播放详情页：播放交给 MiniPlayer，用户点 MiniPlayer 再进详情
    } catch (e) {
      Logger.w('PlaylistDetail', `playFromIndex failed: ${String(e)}`);
    }
  }

  private handleDelete(): void {
    promptAction.showDialog({
      title: t('playlistDetail.deletePlaylist'),
      message: t('playlistDetail.confirmDelete'),
      buttons: [
        { text: t('common.cancel'), color: this.theme.colors.text },
        { text: t('common.confirm'), color: '#FF3B30' },
      ],
    }).then(async (res) => {
      if (res.index === 1) {
        try {
          await playlistApi.remove(this.entityId);
          promptAction.showToast({ message: t('common.success') });
          if (this.carBackCallback) {
            this.carBackCallback();
          } else {
            this.pathStack.pop();
          }
        } catch (e) {
          promptAction.showToast({ message: t('common.operationFailed') });
        }
      }
    });
  }

  private async handleRename(): Promise<void> {
    const name = this.newName.trim();
    if (!name || this.renaming) return;
    this.renaming = true;
    try {
      await playlistApi.rename(this.entityId, name);
      if (this.data) {
        const d = this.data;
        this.data = {
          id: d.id,
          name: name,
          type: d.type,
          createdAt: d.createdAt,
          description: d.description,
          trackCount: d.trackCount,
          cover: d.cover,
          tracks: d.tracks
        } as PlaylistDetail;
      }
      this.showRename = false;
      promptAction.showToast({ message: t('common.success') });
    } catch (e) {
      promptAction.showToast({ message: t('common.operationFailed') });
    } finally {
      this.renaming = false;
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const res = await playlistApi.getById(this.entityId);
      this.data = {
        id: res.id,
        name: res.name,
        type: res.type,
        createdAt: res.createdAt,
        description: res.description,
        trackCount: res.trackCount,
        cover: res.cover,
        tracks: res.tracks ?? []
      } as PlaylistDetail;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }
}
