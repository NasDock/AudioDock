import { promptAction } from '@kit.ArkUI';
import { Logger } from 'audiodock_common';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import type { TrackDto } from 'features_network';
import { playlistApi } from 'features_network';
import type { PlaylistDto } from 'features_network';
import { AppIcon } from './AppIcon';
import { playerStore } from '../context/PlayerStore';
import type { Track } from '../context/PlayerStore';
import { resolveTrackToPlayer } from '../services/trackResolver';

/**
 * 「添加到播放列表」底部弹层。对齐 mobile AddToPlaylistModal：
 * - 第一项「当前播放队列」：调 playerStore.insertTracksNext 把 track 插到 currentIndex+1
 * - 下面是用户的全部 playlist（按 contentType 过滤），点击 → playlistApi.addTracks / addTrack
 *
 * 内部统一用 TrackDto[]（父页面只有 DTO），进入 PlayerStore 前通过 resolveTrackToPlayer 转成 Track。
 *
 * 使用 ArkUI 内置 bindSheet 弹出（对齐 AlbumDetailPage MoreSheet 的做法）：
 * - 自动盖在 Navigation 容器外（浮在 GlobalBottomBar mini 播放器上面）
 * - backgroundColor 用 theme.colors.surface 跟随主题（dark mode 不再白底）
 *
 * 用法（参考 AlbumDetailPage.ets / ArtistDetailPage.ets 中的「添加到播放列表」入口）：
 *   if (this.addToPlaylistVisible) {
 *     AddToPlaylistModal({
 *       visible: this.addToPlaylistVisible,  // @Link 双绑
 *       tracks: this.isSelectionMode
 *         ? this.tracks.filter(tr => this.selectedTrackIds.includes(tr.id))
 *         : this.tracks,
 *       contentMode: this.isAudiobook() ? 'AUDIOBOOK' : 'MUSIC',
 *       onClose: () => { this.addToPlaylistVisible = false; },
 *     })
 *   }
 */
@Component
export struct AddToPlaylistModal {
  // 双向绑定父页面显隐状态（@Link 支持 $$ 双绑语法，与父页 addToPlaylistVisible 配合）；
  // @Prop 是单向 props，不支持 $$this，强行使用会在运行时报 `$$this is not defined`。
  @Link @Watch('onVisibleChange') visible: boolean;
  /** 待添加的曲目（已经过滤好的 TrackDto[]，数量可为 1 或多） */
  tracks: TrackDto[] = [];
  /** 决定 playlistApi.list 的类型过滤（'MUSIC' | 'AUDIOBOOK'）。与 PlayerStore.contentMode 同源。 */
  contentMode: string = 'MUSIC';
  onClose: () => void = (): void => undefined;

  @State private playlists: PlaylistDto[] = [];
  @State private loading: boolean = false;
  @State private submitting: boolean = false;
  @State private addingPlaylistId: string = '';
  @State private langAtBuild: string = getLang();
  // 跟随系统主题（之前写死 light 导致 dark mode 下 card 仍是白色）。
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State theme: Theme = buildTheme('light');

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.langAtBuild = getLang();
    if (this.visible) {
      this.fetchPlaylists();
    }
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  /** 语言切换时重建整页（与 AlbumDetailPage.ets onPageShow 同样的处理）。 */
  onPageShow(): void {
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;
  }

  onVisibleChange(): void {
    if (this.visible) {
      this.fetchPlaylists();
    } else {
      // 关闭时清掉 pending 状态，避免下次打开时按钮仍处于禁用
      this.submitting = false;
      this.addingPlaylistId = '';
    }
  }

  private async fetchPlaylists(): Promise<void> {
    this.loading = true;
    try {
      const list: PlaylistDto[] = await playlistApi.list(this.contentMode);
      this.playlists = list;
    } catch (e) {
      Logger.w('AddToPlaylistModal', `fetchPlaylists failed: ${String(e)}`);
      this.playlists = [];
    } finally {
      this.loading = false;
    }
  }

  /** 「当前播放队列」分支：resolve TrackDto → Track → insertTracksNext */
  private async handleAddToCurrentQueue(): Promise<void> {
    if (this.tracks.length === 0 || this.submitting) return;
    this.submitting = true;
    try {
      // ArkTS 严格模式不允许 utility type / typeof 推导，
      // 这里显式声明 Promise<Track>[] 给 Promise.all，避免类型推导把
      // 数组元素推断成 Promise<Promise<Track>>。
      const promises: Promise<Track>[] = this.tracks.map(
        (t): Promise<Track> => resolveTrackToPlayer(t)
      );
      const resolved: Track[] = await Promise.all(promises);
      playerStore.insertTracksNext(resolved);
      promptAction.showToast({ message: t('addToPlaylist.added') });
      this.onClose();
    } catch (e) {
      Logger.e('AddToPlaylistModal', `addToCurrentQueue failed: ${String(e)}`);
      promptAction.showToast({ message: t('addToPlaylistModal.addFailed') });
    } finally {
      this.submitting = false;
    }
  }

  /** 「选择具体歌单」分支：调 playlistApi.addTracks（多选）/ addTrack（单首） */
  private async handleAddToPlaylist(playlistId: string): Promise<void> {
    if (this.tracks.length === 0 || this.submitting || this.addingPlaylistId.length > 0) return;
    this.addingPlaylistId = playlistId;
    try {
      if (this.tracks.length === 1) {
        await playlistApi.addTrack(playlistId, this.tracks[0].id);
      } else {
        await playlistApi.addTracks(playlistId, this.tracks.map((t): string => t.id));
      }
      promptAction.showToast({ message: t('addToPlaylist.added') });
      this.onClose();
    } catch (e) {
      Logger.e('AddToPlaylistModal', `addToPlaylist failed: ${String(e)}`);
      promptAction.showToast({ message: t('addToPlaylistModal.addFailed') });
    } finally {
      this.addingPlaylistId = '';
    }
  }

  @Builder
  private RowSeparator() {
    Divider().color(this.theme.colors.border).height(0.5);
  }

  build() {
    // 用 ArkUI 内置 bindSheet 弹出（对齐 AlbumDetailPage MoreSheet 的做法）：
    // - 盖在 Navigation 容器外，能浮在 GlobalBottomBar（mini 播放器）上面
    // - backgroundColor 直接用 surface 主题色，dark mode 下不再白底
    // - $$this.visible 是 bindSheet 的双向绑定语法（仅用于内置 API）
    Column().width(0).height(0)
      .bindSheet($$this.visible, this.sheetBody(), {
        height: 480,
        dragBar: true,
        backgroundColor: this.theme.colors.surface,
      })
  }

  @Builder
  sheetBody() {
    Column() {
      // Header
      Row() {
        Text(t('addToPlaylistModal.title'))
          .fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
          .layoutWeight(1);
        Text('×')
          .fontSize(26).fontColor(this.theme.colors.textSecondary)
          .padding({ left: 12, top: 0, right: 4, bottom: 4 })
          .onClick(() => {
            if (!this.submitting) this.onClose();
          });
      }
      .width('100%').padding({ left: 20, right: 12, top: 16, bottom: 8 })
      .alignItems(VerticalAlign.Center);

      // 「当前播放队列」入口（始终在第一位；alignment with mobile AddToPlaylistModal）
      Row() {
        // skip-forward ≈ mobile 的 play-forward-circle（"插入到下一首播放"语义）。
        AppIcon({ name: 'skip-forward', iconSize: 22, color: this.theme.colors.primary })
          .margin({ right: 12 });
        Text(t('addToPlaylist.currentPlaylist'))
          .fontSize(16).fontColor(this.theme.colors.text)
          .layoutWeight(1);
        if (this.submitting) {
          LoadingProgress().width(20).height(20).color(this.theme.colors.primary);
        }
      }
      .width('100%').height(56).padding({ left: 20, right: 20 })
      .alignItems(VerticalAlign.Center)
      .onClick(() => {
        this.handleAddToCurrentQueue();
      });

      this.RowSeparator();

      // 用户歌单列表
      if (this.loading) {
        Column() {
          LoadingProgress().width(36).height(36).color(this.theme.colors.primary);
        }
        .width('100%').padding(40).alignItems(HorizontalAlign.Center);
      } else {
        List() {
          ForEach(this.playlists, (pl: PlaylistDto) => {
            ListItem() {
              Row() {
                Text('♪')
                  .fontSize(18).fontColor(this.theme.colors.primary)
                  .margin({ right: 12 });
                Text(pl.name)
                  .fontSize(16).fontColor(this.theme.colors.text)
                  .layoutWeight(1)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis });
                if (this.addingPlaylistId === pl.id) {
                  LoadingProgress().width(20).height(20).color(this.theme.colors.primary);
                }
              }
              .width('100%').height(56).padding({ left: 20, right: 20 })
              .alignItems(VerticalAlign.Center)
              .onClick(() => {
                this.handleAddToPlaylist(pl.id);
              });
            }
          }, (pl: PlaylistDto): string => pl.id);

          if (this.playlists.length === 0) {
            ListItem() {
              Text(t('addToPlaylist.noOtherPlaylists'))
                .fontSize(14).fontColor(this.theme.colors.textSecondary)
                .width('100%').padding(40)
                .textAlign(TextAlign.Center);
            }
          }
        }
        .width('100%').height(320)
        .listDirection(Axis.Vertical)
        .divider({ strokeWidth: 0.5, color: this.theme.colors.border, startMargin: 20, endMargin: 20 });
      }
    }
    .width('100%')
    .padding({ bottom: 24 })
  }
}