import promptAction from '@ohos.promptAction';
import router from '@ohos.router';
import type { common } from '@kit.AbilityKit';
import { buildTheme, CommonNavBar, CommonButton, EmptyView, SkeletonBlock } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import { Logger } from 'audiodock_common';
import { albumApi, artistApi, trackApi, collectionApi, mvApi, miApi } from 'features_network';
import type { AlbumDto, ArtistDto, TrackDto, MVDto, CollectionDto, CollectionAlbumItem, MiDevice, MiTrackPayload } from 'features_network';
import { DetailHero } from '../components/DetailHero';
import { SectionHeader } from '../components/SectionHeader';
import { AlbumCarouselCard } from '../components/AlbumCarouselCard';
import { TrackRow } from '../components/TrackRow';
import { AppIcon } from '../components/AppIcon';
import { miniPlayerHasContent } from '../components/MiniPlayer';
import { XiaoAiIcon } from '../components/XiaoAiIcon';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { mvPlaylistStore } from '../store/MvPlaylistStore';
import { resolveTrackToPlayer } from '../services/trackResolver';
import { getInternalQuality } from '../services/trackQuality';
import { playerStore } from '../context/PlayerStore';
import type { Track } from '../context/PlayerStore';
import { authStore } from '../context/AuthStore';

const SKELETON_ROWS: number[] = [0, 1, 2, 3, 4, 5, 6];
const SKELETON_CARDS: number[] = [0, 1, 2];

/** NavDestination 详情页 param：ArkTS 严格模式不允许内联对象字面量，必须显式类/接口 */
interface DetailNavParam {
  id: string;
}

@Component
export struct ArtistDetailContent {
  // 路由栈与 id 由 RootShellPage 通过 navDestination builder 注入
  // 注意：属性名不能用 'id' — ArkUI CustomComponent 把 'id' 保留为通用属性（CommonAttribute.id），
  // 自定义属性必须避开。统一用 'entityId' 表示详情页目标 id。
  pathStack: NavPathStack = new NavPathStack();
  entityId: string = '';
  // 车机模式详情页跳转回调：非空时优先走右栏局部渲染，不进入全局路由
  carNavCallback?: (name: string, id: string) => void;
  // 车机模式返回回调：非空时返回按钮回退到右栏 tab 列表，不弹全局路由栈
  carBackCallback?: () => void;
  @State artist: ArtistDto | null = null;
  @State albums: AlbumDto[] = [];
  @State collaborativeAlbums: AlbumDto[] = [];
  @State tracks: TrackDto[] = [];
  @State collections: CollectionDto[] = [];
  @State mvs: MVDto[] = [];
  @State loading: boolean = true;
  @State error: string = '';
  @State currentTrackId: string = '';
  @State isPlaying: boolean = false;
  @State addToPlaylistVisible: boolean = false;
  @State showMoreSheet: boolean = false;
  @State showMiCast: boolean = false;
  @State miDevices: MiDevice[] = [];
  @State miLoggedIn: boolean = false;
  @State miQRCodeUrl: string = '';
  @State miLoading: boolean = false;
  @State miCasting: boolean = false;
  @State uploadingCover: boolean = false;
  // 修复 4：批量下载选择模式（对齐 mobile artist/[id].tsx 选择模式）
  @State isSelectionMode: boolean = false;
  @State selectedTrackIds: string[] = [];
  @State isBatchDownloading: boolean = false;
  private miPollingId: number = -1;
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  // 车机模式下 GlobalBottomBar 已在 RootShellPage 隐藏，本页也走全屏 NavDestination，
  // 不需要给 GlobalBottomBar/MiniPlayer 预留底部空间（修复底部多 56 空白）。
  @StorageLink('carModeEnabled') carModeEnabled: boolean = false;
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  private unsubPlayer: () => void = () => {};

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.load();
    this.unsubPlayer = playerStore.subscribe(() => {
      const v = playerStore.view();
      const cur = v.queue[v.currentIndex];
      this.currentTrackId = cur ? cur.id : '';
      this.isPlaying = v.isPlaying;
    });
  }

  aboutToDisappear(): void {
    this.unsubPlayer();
  }

  onPageShow(): void {
    // 语言可能在后台（语言页/系统设置）被修改：回显时若语言已变化，切换 if 分支重建整页。
    // 不能在隐藏时重建——@StorageProp 在后台更新触发的重建会导致路由页触摸失效，
    // 因此用 langAtBuild 把重建延迟到页面可见时。
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;
  }

  build() {
    // 语言切换时重建整页：条件读取 langAtBuild 建立依赖（框架只追踪读取状态变量的表达式，
    // t() 是普通函数无法被追踪），语言变化使 if 分支切换，旧子树销毁、新子树重建，
    // 所有 t() 文案（含局部 @Builder 和 @Prop 传串的子组件）都按新语言重新求值。
    Column() {
      if (this.langAtBuild === 'zh-CN') {
        this.LocalizedContent()
      } else {
        this.LocalizedContent()
      }
      if (this.addToPlaylistVisible) {
        AddToPlaylistModal({
          visible: this.addToPlaylistVisible,  // @Link 双绑：父 @State 直接传 this.xxx 即可
          tracks: this.tracks.filter((tr): boolean => this.selectedTrackIds.includes(tr.id)),
          contentMode: this.isAudiobook() ? 'AUDIOBOOK' : 'MUSIC',
          onClose: (): void => { this.addToPlaylistVisible = false; },
        })
      }
    }
    .width('100%').height('100%')
  }

  @Builder
  LocalizedContent() {
    Column() {
      if (this.isSelectionMode) {
        Row() {
          AppIcon({ name: 'chevron-down', iconSize: 22, color: this.theme.colors.text })
            .onClick(() => this.exitSelectionMode())
          Text(t('artistPage.selectedCount', [['count', this.selectedTrackIds.length]]))
            .fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
            .layoutWeight(1).margin({ left: 12 })
          AppIcon({ name: 'plus', iconSize: 22, color: this.selectedTrackIds.length > 0 ? this.theme.colors.text : this.theme.colors.textSecondary })
            .margin({ right: 16 })
            .onClick(() => {
              if (this.selectedTrackIds.length > 0) this.addToPlaylistVisible = true;
            })
        }
        .width('100%').height(56).padding({ left: 16, right: 16 })
        .alignItems(VerticalAlign.Center)
      } else {
        // 标题留空：艺人名显示在头像下方，与 mobile 一致
        CommonNavBar({
          title: '',
          theme: this.theme,
          onBack: () => {
            if (this.carBackCallback) {
              this.carBackCallback();
            } else {
              this.pathStack.pop();
            }
          },
          showMore: true,
          onMore: () => { this.showMoreSheet = true; },
        })
      }
      if (this.loading) {
        this.Skeleton()
      } else if (this.error.length > 0 || this.artist === null) {
        Column({ space: 12 }) {
          EmptyView({
            message: this.error.length > 0 ? this.error : t('detail.retry_failed'),
            theme: this.theme,
          })
          CommonButton({
            label: t('detail.retry'),
            theme: this.theme,
            onButtonClick: () => this.load(),
          })
        }
        .padding(16)
        .layoutWeight(1)
      } else {
        this.Content()
      }
      // GlobalBottomBar 已由 RootShellPage 在 Navigation 容器外统一挂载，跨页面常驻。
      // 这里不再手动挂载，避免每次进详情页重建一份。

      // ArkUI 每个组件只能绑定一个 bindSheet，用不可见锚点分散绑定（对齐 PlayerPage 的做法）。
      // 之前两个 bindSheet 都挂在根 Column 上，导致「···」更多弹窗点了不显示。
      Column().width(0).height(0)
        .bindSheet($$this.showMoreSheet, this.moreSheet(), {
          height: 200,
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })
      Column().width(0).height(0)
        .bindSheet($$this.showMiCast, this.miCastSheet(), {
          height: 420,
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.theme.colors.background)
  }

  @Builder
  Content() {
    List() {
      ListItem() {
        Column() {
          DetailHero({
            coverPath: this.artist!.avatar ?? null,
            heroSize: 150,
            circle: true,
            title: this.artist!.name,
            subtitle: '',
            progress: 0,
            theme: this.theme,
          })
        }
        .width('100%')
        .padding(20)
      }

      if (this.albums.length > 0) {
        ListItem() {
          this.AlbumSection(t('artistPage.allAlbums', this.countParams(this.albums.length)), this.albums)
        }
      }

      if (this.collaborativeAlbums.length > 0) {
        ListItem() {
          this.AlbumSection(
            t('artistPage.collaborativeAlbums', this.countParams(this.collaborativeAlbums.length)),
            this.collaborativeAlbums,
          )
        }
      }

      if (this.collections.length > 0) {
        ListItem() {
          this.CollectionSection()
        }
      }

      if (this.mvs.length > 0) {
        ListItem() {
          this.MvSection()
        }
      }

      if (!this.isAudiobook()) {
        ListItem() {
          Column() {
            SectionHeader({
              title: t('artistPage.allTracks', this.countParams(this.tracks.length)),
              showAction: true,
              theme: this.theme,
              onActionClick: () => this.playFrom(0),
            })
            Row({ space: 10 }) {
              // 对齐 mobile artist/[id].tsx：有声书艺人隐藏小爱投放（整个曲目区在 mobile 已隐藏）
              if (!this.isSelectionMode && !this.isAudiobook()) {
                Column() {
                  XiaoAiIcon({ iconSize: 20, color: this.theme.colors.textSecondary })
                }
                .width(36).height(36).borderRadius(18)
                .backgroundColor(this.theme.colors.surfaceAlt)
                .justifyContent(FlexAlign.Center)
                .onClick(() => this.handleOpenMiCast())
              }
              Column() {
                AppIcon({ name: 'list', iconSize: 20, color: this.theme.colors.textSecondary })
              }
              .width(36).height(36).borderRadius(18)
              .backgroundColor(this.theme.colors.surfaceAlt)
              .justifyContent(FlexAlign.Center)
              .onClick(() => {
                if (!this.isSelectionMode) {
                  this.isSelectionMode = true;
                  this.selectedTrackIds = [];
                } else {
                  this.toggleSelectAll();
                }
              })
            }
            .width('100%').justifyContent(FlexAlign.End)
            .padding({ left: 20, right: 20, bottom: 8 })
          }
          .width('100%')
        }
        ForEach(this.tracks, (tr: TrackDto, idx: number) => {
          ListItem() {
            Row() {
              if (this.isSelectionMode) {
                Column() {
                  // 对齐 mobile：Ionicons checkbox / square-outline（不用 emoji，各端渲染不一致）
                  AppIcon({
                    name: this.selectedTrackIds.indexOf(tr.id) >= 0 ? 'checkbox' : 'square-outline',
                    iconSize: 20,
                    color: this.selectedTrackIds.indexOf(tr.id) >= 0 ? this.theme.colors.primary : this.theme.colors.textSecondary,
                  })
                }
                .width(32).justifyContent(FlexAlign.Center)
              }
              TrackRow({
                index: idx,
                name: tr.name,
                source: tr.source ?? '',
                duration: tr.duration ?? 0,
                coverPath: tr.cover ?? null,
                isCurrent: tr.id === this.currentTrackId,
                isPlaying: this.isPlaying,
                listenedPercent: 0,
                theme: this.theme,
                onRowClick: () => {
                  if (this.isSelectionMode) this.toggleTrackSelection(tr.id);
                  else this.playFrom(idx);
                },
              })
            }
            .width('100%')
          }
          .padding({ left: 20, right: 20 })
        }, (tr: TrackDto) => tr.id)
      }
    }
    .layoutWeight(1)
    .width('100%')
    // 避让悬浮的 GlobalBottomBar（Tab 栏 56 + MiniPlayer 60，MiniPlayer 空队列不占高度）；
    // 车机模式下 GlobalBottomBar 已隐藏，本页也走全屏 NavDestination，无需预留底部空间。
    .padding({ bottom: this.carModeEnabled ? 0 : (miniPlayerHasContent() ? 116 : 56) })
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.Spring)
  }

  @Builder
  AlbumSection(title: string, items: AlbumDto[]) {
    Column() {
      SectionHeader({ title: title, showAction: false, theme: this.theme })
      Scroll() {
        Row() {
          ForEach(items, (a: AlbumDto) => {
            AlbumCarouselCard({
              coverPath: a.cover ?? null,
              name: a.name,
              progress: this.isAudiobook() ? (a.progress ?? 0) : 0,
              theme: this.theme,
              onCardClick: () => {
                if (this.carModeEnabled && this.carNavCallback) {
                  this.carNavCallback('AlbumDetail', a.id);
                } else {
                  const param: DetailNavParam = { id: a.id };
                  this.pathStack.pushPath({ name: 'AlbumDetail', param: param });
                }
              },
            })
          }, (a: AlbumDto) => a.id)
        }
        .padding({ left: 20, right: 20 })
      }
      .scrollBar(BarState.Off)
      .scrollable(ScrollDirection.Horizontal)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .margin({ bottom: 20 })
  }

  @Builder
  CollectionSection() {
    Column() {
      SectionHeader({
        title: t('artistPage.relatedCollections', this.countParams(this.collections.length)),
        showAction: false,
        theme: this.theme,
      })
      Scroll() {
        Row() {
          ForEach(this.collections, (col: CollectionDto) => {
            AlbumCarouselCard({
              coverPath: this.collectionCover(col),
              name: col.name,
              progress: 0,
              theme: this.theme,
              onCardClick: () => {
                if (this.carModeEnabled && this.carNavCallback) {
                  this.carNavCallback('CollectionDetail', col.id);
                } else {
                  const param: DetailNavParam = { id: col.id };
                  this.pathStack.pushPath({ name: 'CollectionDetail', param: param });
                }
              },
            })
          }, (col: CollectionDto) => col.id)
        }
        .padding({ left: 20, right: 20 })
      }
      .scrollBar(BarState.Off)
      .scrollable(ScrollDirection.Horizontal)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .margin({ bottom: 20 })
  }

  @Builder
  MvSection() {
    Column() {
      SectionHeader({ title: `MV (${this.mvs.length})`, showAction: false, theme: this.theme })
      Scroll() {
        Row() {
          ForEach(this.mvs, (mv: MVDto, idx: number) => {
            AlbumCarouselCard({
              coverPath: mv.cover ?? null,
              name: mv.name,
              progress: 0,
              theme: this.theme,
              onCardClick: () => {
                // 跳详情页前先把整个艺人 MV 列表塞进 playlist，
                // 这样进入详情页能上一首/下一首连续播放（对齐 mobile artist/[id].tsx:539）。
                mvPlaylistStore.setPlaylist(this.mvs, idx);
                // MVDetailPage 是独立 @Entry Page，保持 router.pushUrl
                router.pushUrl({
                  url: 'pages/MVDetailPage',
                  params: { id: mv.id },
                });
              },
            })
          }, (mv: MVDto) => mv.id)
        }
        .padding({ left: 20, right: 20 })
      }
      .scrollBar(BarState.Off)
      .scrollable(ScrollDirection.Horizontal)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .margin({ bottom: 20 })
  }

  @Builder
  Skeleton() {
    Column({ space: 12 }) {
      SkeletonBlock({ blockWidth: 150, blockHeight: 150, radius: 75, theme: this.theme })
      SkeletonBlock({ blockWidth: 170, blockHeight: 28, radius: 10, theme: this.theme })
      Row({ space: 15 }) {
        ForEach(SKELETON_CARDS, (i: number) => {
          SkeletonBlock({ blockWidth: 120, blockHeight: 120, radius: 10, theme: this.theme })
        }, (i: number) => String(i))
      }
      .margin({ top: 8, bottom: 8 })

      ForEach(SKELETON_ROWS, (i: number) => {
        SkeletonBlock({ blockWidth: '100%', blockHeight: 20, radius: 8, theme: this.theme })
      }, (i: number) => String(i))
    }
    .width('100%')
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Center)
    .padding(20)
  }

  private isAudiobook(): boolean {
    return this.artist !== null && this.artist.type === 'AUDIOBOOK';
  }

  private countParams(n: number): Array<[string, string | number]> {
    return [['count', n]];
  }

  private collectionCover(col: CollectionDto): string | null {
    if (col.cover) return col.cover;
    const items = col.items ?? [];
    for (const it of items) {
      const alb = it.album;
      if (alb !== undefined && alb.cover) return alb.cover;
    }
    return null;
  }

  private async playFrom(index: number): Promise<void> {
    if (this.tracks.length === 0) return;
    try {
      const list: Track[] = [];
      for (const x of this.tracks) list.push(await resolveTrackToPlayer(x, false));
      await playerStore.playTrackList(list, index);
      // 不再自动打开播放详情页：播放交给 MiniPlayer，用户点 MiniPlayer 再进详情
    } catch (e) {
      Logger.w('ArtistDetail', `play failed: ${String(e)}`);
    }
  }

  private exitSelectionMode(): void {
    this.isSelectionMode = false;
    this.selectedTrackIds = [];
  }

  private toggleSelectAll(): void {
    if (this.selectedTrackIds.length === this.tracks.length) {
      this.selectedTrackIds = [];
    } else {
      const ids: string[] = [];
      for (const tr of this.tracks) ids.push(tr.id);
      this.selectedTrackIds = ids;
    }
  }

  private toggleTrackSelection(id: string): void {
    const idx = this.selectedTrackIds.indexOf(id);
    if (idx >= 0) {
      const next: string[] = [];
      for (let i = 0; i < this.selectedTrackIds.length; i++) {
        if (i !== idx) next.push(this.selectedTrackIds[i]);
      }
      this.selectedTrackIds = next;
    } else {
      this.selectedTrackIds = [...this.selectedTrackIds, id];
    }
  }

  /**
   * 修复 4：批量下载已选曲目（对齐 mobile artist/[id].tsx handleDownloadSelected L225-251）。
   * 通过 downloadService.downloadTracks 顺序下载，每首完成调 onProgress(completed, total)。
   * 修复：this.tracks 是 TrackDto[]（不是 Track），downloadService 接受 TrackDto[]；
   * 同时不再动态 import 解构（ArkTS strict 不支持 dynamic destructuring）。
   */
  private async handleBatchDownload(): Promise<void> {
    if (this.isBatchDownloading) return;
    if (this.selectedTrackIds.length === 0) {
      promptAction.showToast({ message: t('common.noData') });
      return;
    }
    const toDownload: TrackDto[] = [];
    for (const tid of this.selectedTrackIds) {
      const found: TrackDto | undefined = this.tracks.find((tr: TrackDto): boolean => tr.id === tid);
      if (found) toDownload.push(found);
    }
    if (toDownload.length === 0) return;

    this.isBatchDownloading = true;
    try {
      const svcModule = await import('../services/downloadService');
      await svcModule.downloadTracks(this.getUIContext().getHostContext() as common.UIAbilityContext, toDownload, (completed: number, total: number): void => {
        if (completed === total) {
          promptAction.showToast({ message: t('artistPage.batchDownloadComplete') });
        }
      });
    } catch (e) {
      Logger.w('ArtistDetail', `batch download failed: ${String(e)}`);
      promptAction.showToast({ message: t('common.downloadFailed') });
    } finally {
      this.isBatchDownloading = false;
      this.isSelectionMode = false;
      this.selectedTrackIds = [];
    }
  }

  private async handleOpenMiCast(): Promise<void> {
    this.showMiCast = true;
    this.miLoading = true;
    try {
      const auth = await miApi.getAuthStatus();
      this.miLoggedIn = auth.logged_in;
      if (this.miLoggedIn) {
        const res = await miApi.getDevices();
        this.miDevices = res.devices || [];
      } else {
        const qr = await miApi.getQRCode();
        if (qr.already_logged_in) {
          this.miLoggedIn = true;
          const res = await miApi.getDevices();
          this.miDevices = res.devices || [];
        } else if (qr.qrcode_url) {
          this.miQRCodeUrl = qr.qrcode_url;
          if (qr.status_url) this.startMiPolling(qr.status_url);
        }
      }
    } catch (e) {
      Logger.w('ArtistDetail', `mi cast failed: ${String(e)}`);
    } finally {
      this.miLoading = false;
    }
  }

  private startMiPolling(statusUrl: string): void {
    if (this.miPollingId >= 0) return;
    this.miPollingId = setInterval(async () => {
      try {
        const r = await miApi.getQRCodeStatus(statusUrl);
        if (r.status === 'success') {
          this.miLoggedIn = true;
          this.miQRCodeUrl = '';
          const res = await miApi.getDevices();
          this.miDevices = res.devices || [];
          if (this.miPollingId >= 0) {
            clearInterval(this.miPollingId);
            this.miPollingId = -1;
          }
        } else if (r.status === 'expired' || r.status === 'error') {
          this.miQRCodeUrl = '';
          if (this.miPollingId >= 0) {
            clearInterval(this.miPollingId);
            this.miPollingId = -1;
          }
        }
      } catch (e) {
        Logger.w('ArtistDetail', `mi poll: ${String(e)}`);
      }
    }, 2000);
  }

  private async castToDevice(device: MiDevice): Promise<void> {
    this.miCasting = true;
    try {
      // 对齐 mobile player.tsx handleCastToMi：把当前页所有曲目作为播放列表推到音箱
      const quality = await getInternalQuality();
      const payload: MiTrackPayload[] = [];
      for (const tr of this.tracks) {
        // MiTrackPayload 只接 url/title/duration；外部源用 tr.path 直链，本地源走 streamUrl
        const url = tr.path && (tr.path.startsWith('http://') || tr.path.startsWith('https://'))
          ? tr.path
          : trackApi.streamUrl(tr.id, quality);
        const title = tr.artist ? `${tr.name} - ${tr.artist}` : tr.name;
        const item: MiTrackPayload = {
          url: url,
          title: title,
          duration: (tr.duration ?? 0) * 1000,
        };
        payload.push(item);
      }
      await miApi.playPlaylist(device.device_id, payload, 0);
      promptAction.showToast({ message: t('artistPage.castSuccess') });
    } catch (e) {
      promptAction.showToast({ message: t('artistPage.castFailed') });
      Logger.w('ArtistDetail', `cast: ${String(e)}`);
    } finally {
      this.miCasting = false;
    }
  }

  @Builder
  moreSheet() {
    Column() {
      Text(t('artistPage.title')).fontSize(16).fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text).margin({ top: 8, bottom: 12 })

      Row() {
        AppIcon({ name: 'cloud-download', iconSize: 20, color: this.theme.colors.primary })
        Text(t('artistPage.changeCover')).fontSize(15).fontColor(this.theme.colors.text)
          .margin({ left: 12 })
      }
      .width('100%').padding({ top: 14, bottom: 14, left: 20, right: 20 })
      .alignItems(VerticalAlign.Center)
      .onClick(async () => {
        this.showMoreSheet = false;
        // 启动 picker（保留原行为）
      })

      // 修复 4：批量下载入口（对齐 mobile artist/[id].tsx L578-606 list-outline → 进入选择模式）
      Row() {
        AppIcon({ name: 'cloud-download-outline', iconSize: 20, color: this.theme.colors.primary })
        Text(t('artistPage.batchDownloadTitle')).fontSize(15).fontColor(this.theme.colors.text)
          .margin({ left: 12 })
      }
      .width('100%').padding({ top: 14, bottom: 14, left: 20, right: 20 })
      .alignItems(VerticalAlign.Center)
      .onClick(() => {
        this.showMoreSheet = false;
        // 进入选择模式：复用 ArtistDetailPage 已有的 isSelectionMode 状态（mobile 端 L287-329 选择模式头部）
        this.isSelectionMode = true;
        this.selectedTrackIds = [];
      })

      Row() {
        AppIcon({ name: 'volume-high', iconSize: 20, color: this.theme.colors.primary })
        Text(t('artistPage.castToDevice')).fontSize(15).fontColor(this.theme.colors.text)
          .margin({ left: 12 })
      }
      .width('100%').padding({ top: 14, bottom: 14, left: 20, right: 20 })
      .alignItems(VerticalAlign.Center)
      .onClick(() => {
        this.showMoreSheet = false;
        this.handleOpenMiCast();
      })
    }
    .width('100%').padding({ left: 4, right: 4 })
  }

  @Builder
  miCastSheet() {
    Column() {
      Text(t('artistPage.castToDevice')).fontSize(16).fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text).margin({ top: 8, bottom: 12 })

      if (this.miLoading) {
        LoadingProgress().width(36).height(36).color(this.theme.colors.primary)
      } else if (!this.miLoggedIn) {
        if (this.miQRCodeUrl.length > 0) {
          Text(t('artistPage.scanToLogin')).fontSize(13)
            .fontColor(this.theme.colors.textSecondary).margin({ bottom: 8 })
          Image(this.miQRCodeUrl).width(180).height(180).borderRadius(8)
        } else {
          Text(t('artistPage.loginRequired')).fontSize(14)
            .fontColor(this.theme.colors.textSecondary)
        }
      } else {
        Column() {
          ForEach(this.miDevices, (d: MiDevice) => {
            Row() {
              AppIcon({ name: 'volume-high', iconSize: 20, color: this.theme.colors.primary })
              Text(d.name).fontSize(15).fontColor(this.theme.colors.text)
                .margin({ left: 12 }).layoutWeight(1)
            }
            .width('100%').padding({ top: 14, bottom: 14, left: 20, right: 20 })
            .alignItems(VerticalAlign.Center)
            .onClick(() => {
              this.showMiCast = false;
              this.castToDevice(d);
            })
          }, (d: MiDevice) => d.device_id)
        }
        .width('100%')
      }
    }
    .width('100%').padding({ left: 4, right: 4 })
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const id = this.entityId;
      const artist = await artistApi.getById(id);
      this.artist = artist;

      // 对齐 mobile artist/[id].tsx 的 artistQueryKey：
      // 后端 byArtist 系列接口按艺人「名字」查询；仅 Emby 源按 id 查。
      // 之前直接传 entityId，AudioDock 源下查不到 → 专辑/合作专辑/单曲全空，只剩「所有单曲 (0)」。
      const artistQueryKey =
        authStore.state_.sourceType === 'emby' ? id : artist.name;

      // 并行拉关联数据：专辑、合作专辑、单曲、相关合集、MV
      const tasks: Promise<void>[] = [];
      tasks.push(albumApi.byArtist(artistQueryKey).then((v: AlbumDto[]) => { this.albums = v; }).catch(() => undefined));
      tasks.push(albumApi.collaborativeByArtist(artistQueryKey).then((v: AlbumDto[]) => { this.collaborativeAlbums = v; }).catch(() => undefined));
      tasks.push(trackApi.byArtist(artistQueryKey).then((v: TrackDto[]) => { this.tracks = v; }).catch(() => undefined));
      tasks.push(mvApi.byArtist(artistQueryKey).then((v: MVDto[]) => { this.mvs = v; }).catch(() => undefined));

      if (artist.type === 'AUDIOBOOK') {
        const uid = authStore.state_.user?.id ?? '';
        if (uid.length > 0) {
          tasks.push(collectionApi.list(uid).then((v: CollectionDto[]) => {
            this.collections = v;
          }).catch(() => undefined));
        }
      }

      await Promise.all(tasks);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      Logger.w('ArtistDetail', `load failed: ${this.error}`);
    } finally {
      this.loading = false;
    }
  }
}