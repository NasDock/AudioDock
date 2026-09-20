import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import picker from '@ohos.file.picker';
import common from '@ohos.app.ability.common';
import { buildTheme, CommonNavBar, CommonButton, EmptyView, SkeletonBlock } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import { Logger } from 'audiodock_common';
import { albumApi, mvApi, miApi, trackApi, playlistApi, collectionApi } from 'features_network';
import type { AlbumDto, TrackDto, MVDto, AlbumTracksResp, MiDevice, MiTrackPayload, CollectionDto } from 'features_network';
import { DetailHero } from '../components/DetailHero';
import { TrackRow } from '../components/TrackRow';
import { AppIcon } from '../components/AppIcon';
import { miniPlayerHasContent } from '../components/MiniPlayer';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { XiaoAiIcon } from '../components/XiaoAiIcon';
import { mvPlaylistStore } from '../store/MvPlaylistStore';
import { resolveTrackToPlayer, playQueueFast } from '../services/trackResolver';
import { getInternalQuality } from '../services/trackQuality';
import { downloadTracks } from '../services/downloadService';
import { likesHistory, EventPayloadId } from '../services/LikesHistoryService';
import { playerStore } from '../context/PlayerStore';
import type { Track } from '../context/PlayerStore';
import { authStore } from '../context/AuthStore';

/** 与 mobile 的 PAGE_SIZE 保持一致：一次拉全，不做分页。 */
const PAGE_SIZE: number = 20000;

const SKELETON_ROWS: number[] = [0, 1, 2, 3, 4, 5, 6, 7];

@Component
export struct AlbumDetailContent {
  // 路由栈与 id 由 RootShellPage 通过 navDestination builder 注入
  // 注意：属性名不能用 'id'（ArkUI CustomComponent 保留），统一用 'entityId'
  pathStack: NavPathStack = new NavPathStack();
  entityId: string = '';
  // 车机模式详情页跳转回调：非空时优先走右栏局部渲染，不进入全局路由
  carNavCallback?: (name: string, id: string) => void;
  // 车机模式返回回调：非空时返回按钮回退到右栏 tab 列表，不弹全局路由栈
  carBackCallback?: () => void;
  @State album: AlbumDto | null = null;
  @State tracks: TrackDto[] = [];
  @State mvs: MVDto[] = [];
  @State activeTab: string = 'tracks';
  @State loading: boolean = true;
  @State error: string = '';
  @State liked: boolean = false;
  @State currentTrackId: string = '';
  @State isPlaying: boolean = false;
  @State currentMs: number = 0;
  @State isSelectionMode: boolean = false;
  @State selectedTrackIds: string[] = [];
  @State addToPlaylistVisible: boolean = false;
  @State showMoreSheet: boolean = false;
  @State showMiCast: boolean = false;
  @State showCollectionPicker: boolean = false;
  @State collections: CollectionDto[] = [];
  @State collectionsLoading: boolean = false;
  @State collectionAdding: boolean = false;
  @State showCreateCollection: boolean = false;
  @State newCollectionName: string = '';
  @State miDevices: MiDevice[] = [];
  @State miLoggedIn: boolean = false;
  @State miQRCodeUrl: string = '';
  @State miLoading: boolean = false;
  @State miCasting: boolean = false;
  @State uploadingCover: boolean = false;
  @State batchDownloading: boolean = false;
  private miPollingId: number = -1;
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  // 车机模式下 GlobalBottomBar 已在 RootShellPage 隐藏，本页也走全屏 NavDestination，
  // 不需要给 GlobalBottomBar/MiniPlayer 预留底部空间（修复底部多 56 空白）。
  @StorageLink('carModeEnabled') carModeEnabled: boolean = false;
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  private unsubLike: () => void = () => {};
  private unsubPlayer: () => void = () => {};

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.load();
    this.unsubLike = likesHistory.on('albumLike', (e) => {
      const ev = e as EventPayloadId;
      if (ev.id === this.entityId) this.liked = ev.liked;
    });
    likesHistory.isAlbumLiked(this.entityId).then((v: boolean) => this.liked = v).catch(() => undefined);
    this.unsubPlayer = playerStore.subscribe(() => {
      const v = playerStore.view();
      const cur = v.queue[v.currentIndex];
      this.currentTrackId = cur ? cur.id : '';
      this.isPlaying = v.isPlaying;
      this.currentMs = v.currentMs;
    });
  }

  aboutToDisappear(): void {
    this.unsubLike();
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
          // 多选模式：按 selectedTrackIds 过滤；MoreSheet 入口（整张专辑）：传全部 tracks
          tracks: this.isSelectionMode
            ? this.tracks.filter((tr): boolean => this.selectedTrackIds.includes(tr.id))
            : this.tracks,
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
          Text(t('albumPage.selectedCount', [['count', this.selectedTrackIds.length]]))
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
        CommonNavBar({
          title: this.album?.name ?? '',
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
      } else if (this.error.length > 0 || this.album === null) {
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
          height: this.isAudiobook() ? 440 : 380,
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })
      Column().width(0).height(0)
        .bindSheet($$this.showMiCast, this.miCastSheet(), {
          height: 420,
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })
      Column().width(0).height(0)
        .bindSheet($$this.showCollectionPicker, this.collectionPickerSheet(), {
          height: '60%',
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
            coverPath: this.album!.cover ?? null,
            heroSize: 200,
            circle: false,
            title: this.album!.name,
            subtitle: this.album!.artist ?? '',
            progress: this.isAudiobook() ? (this.album!.progress ?? 0) : 0,
            theme: this.theme,
          })
          this.ActionRow()
          if (this.mvs.length > 0) {
            this.TabBar()
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Center)
        .padding({ top: 20, bottom: 20 })
      }

      if (this.activeTab === 'mvs') {
        ForEach(this.mvs, (mv: MVDto, idx: number) => {
          ListItem() {
            TrackRow({
              index: idx,
              name: mv.name,
              source: '',
              duration: mv.duration ?? 0,
              coverPath: mv.cover ?? null,
              isCurrent: false,
              listenedPercent: 0,
              theme: this.theme,
              onRowClick: () => {
                // 跳详情页前先把整个专辑 MV 列表塞进 playlist（对齐 mobile album/[id].tsx:542）。
                mvPlaylistStore.setPlaylist(this.mvs, idx);
                router.pushUrl({ url: 'pages/MVDetailPage', params: { id: mv.id } });
              },
            })
          }
        }, (mv: MVDto) => mv.id)
      } else {
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
                listenedPercent: this.listenedPercent(tr),
                theme: this.theme,
                onRowClick: () => {
                  if (this.isSelectionMode) this.toggleTrackSelection(tr.id);
                  else this.playFrom(idx, 0);
                },
              })
            }
            .width('100%')
          }
        }, (tr: TrackDto) => tr.id)
      }
    }
    .layoutWeight(1)
    .width('100%')
    // 避让悬浮的 GlobalBottomBar（Tab 栏 56 + MiniPlayer 60，MiniPlayer 空队列不占高度），
    // 否则最后几行曲目被遮挡（对齐 mobile 的列表底部留白）
    .padding({ left: 20, right: 20, bottom: this.carModeEnabled ? 0 : (miniPlayerHasContent() ? 116 : 56) })
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.Spring)
  }

  @Builder
  ActionRow() {
    Row({ space: 10 }) {
      Row({ space: 8 }) {
        AppIcon({ name: 'play', iconSize: 20, color: this.theme.colors.onPrimary })
        Text(this.playLabel())
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.theme.colors.onPrimary)
      }
      .padding({ left: 25, right: 25, top: 10, bottom: 10 })
      .borderRadius(25)
      .backgroundColor(this.theme.colors.primary)
      .onClick(() => this.playAll())

      Column() {
        AppIcon({
          name: 'heart',
          iconSize: 24,
          color: this.liked ? this.theme.colors.primary : this.theme.colors.textSecondary,
        })
      }
      .width(44)
      .height(44)
      .borderRadius(22)
      .backgroundColor(this.theme.colors.surfaceAlt)
      .justifyContent(FlexAlign.Center)
      .onClick(() => this.toggleLike())

      if (!this.isSelectionMode && !this.isAudiobook()) {
        Column() {
          XiaoAiIcon({ iconSize: 22, color: this.theme.colors.textSecondary })
        }
        .width(44)
        .height(44)
        .borderRadius(22)
        .backgroundColor(this.theme.colors.surfaceAlt)
        .justifyContent(FlexAlign.Center)
        .onClick(() => this.handleOpenMiCast())
      }

      Column() {
        AppIcon({ name: 'list', iconSize: 24, color: this.theme.colors.textSecondary })
      }
      .width(44)
      .height(44)
      .borderRadius(22)
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
    .margin({ top: 20 })
    .justifyContent(FlexAlign.Center)
  }

  @Builder
  TabBar() {
    Row() {
      Column() {
        Text(`${t('nav.tracks')} (${this.tracks.length})`)
          .fontSize(15)
          .fontWeight(this.activeTab === 'tracks' ? FontWeight.Bold : FontWeight.Normal)
          .fontColor(this.activeTab === 'tracks' ? this.theme.colors.primary : this.theme.colors.textSecondary)
      }
      .layoutWeight(1)
      .padding({ top: 10, bottom: 10 })
      .border({
        width: { bottom: this.activeTab === 'tracks' ? 2 : 0 },
        color: this.theme.colors.primary,
      })
      .onClick(() => this.activeTab = 'tracks')

      Column() {
        Text(`MV (${this.mvs.length})`)
          .fontSize(15)
          .fontWeight(this.activeTab === 'mvs' ? FontWeight.Bold : FontWeight.Normal)
          .fontColor(this.activeTab === 'mvs' ? this.theme.colors.primary : this.theme.colors.textSecondary)
      }
      .layoutWeight(1)
      .padding({ top: 10, bottom: 10 })
      .border({
        width: { bottom: this.activeTab === 'mvs' ? 2 : 0 },
        color: this.theme.colors.primary,
      })
      .onClick(() => this.activeTab = 'mvs')
    }
    .width('100%')
    .margin({ top: 20 })
    .borderWidth({ bottom: 1 })
    .borderColor(this.theme.colors.border)
  }

  @Builder
  Skeleton() {
    Column({ space: 12 }) {
      SkeletonBlock({ blockWidth: 200, blockHeight: 200, radius: 10, theme: this.theme })
      SkeletonBlock({ blockWidth: 180, blockHeight: 28, radius: 10, theme: this.theme })
      SkeletonBlock({ blockWidth: 120, blockHeight: 20, radius: 10, theme: this.theme })
      Row({ space: 10 }) {
        SkeletonBlock({ blockWidth: 150, blockHeight: 44, radius: 22, theme: this.theme })
        SkeletonBlock({ blockWidth: 44, blockHeight: 44, radius: 22, theme: this.theme })
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
    return this.album !== null && this.album.type === 'AUDIOBOOK';
  }

  private playLabel(): string {
    const resumeId = this.album !== null ? this.album.resumeTrackId : undefined;
    if (resumeId && this.indexOfTrack(resumeId) >= 0) return t('albumPage.continuePlaying');
    return t('albumPage.playAll');
  }

  private indexOfTrack(id: string): number {
    for (let i = 0; i < this.tracks.length; i++) {
      if (this.tracks[i].id === id) return i;
    }
    return -1;
  }

  /**
   * mobile 的 "已听 x%" 依赖 track.progress / listenedAsAudiobookByUsers，
   * 但 /album/:id/tracks 从不返回这两个字段，所以实际只有当前播放的那一首会显示。
   * 这里按同样的口径实现。
   */
  private listenedPercent(tr: TrackDto): number {
    if (!this.isAudiobook()) return 0;
    if (tr.id !== this.currentTrackId) return 0;
    const durMs = (tr.duration ?? 0) * 1000;
    if (durMs <= 0) return 0;
    return Math.floor(this.currentMs / durMs * 100);
  }

  private toggleLike(): void {
    if (this.liked) likesHistory.unlikeAlbum(this.entityId);
    else likesHistory.likeAlbum(this.entityId);
  }

  private async playAll(): Promise<void> {
    let startIndex = 0;
    let startMs = 0;
    const resumeId = this.album !== null ? this.album.resumeTrackId : undefined;
    if (resumeId) {
      const found = this.indexOfTrack(resumeId);
      if (found >= 0) {
        startIndex = found;
        startMs = (this.album!.resumeProgress ?? 0) * 1000;
      }
    }
    await this.playFrom(startIndex, startMs);
  }

  private async playFrom(index: number, startMs: number): Promise<void> {
    if (this.tracks.length === 0) return;
    try {
      // 秒播：先播 index 这首，完整队列后台并行补齐
      await playQueueFast(this.tracks, index, false);
      if (startMs > 0) await playerStore.seek(startMs);
      // 不再自动打开播放详情页：播放交给 MiniPlayer，用户点 MiniPlayer 再进详情
    } catch (e) {
      Logger.w('AlbumDetail', `play failed: ${String(e)}`);
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const albumP: Promise<AlbumDto> = albumApi.getById(this.entityId);
      const tracksP: Promise<AlbumTracksResp> = albumApi.getTracks(this.entityId, PAGE_SIZE, 0, 'asc');
      const album = await albumP;
      const tracksResp = await tracksP;
      this.album = album;
      this.tracks = tracksResp.list;
      this.loadMvs(album);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  private loadMvs(album: AlbumDto): void {
    if (album.name.length === 0) return;
    mvApi.byAlbum(album.name, album.artist ?? '')
      .then((res: MVDto[]) => {
        if (res && res.length > 0) this.mvs = res;
      })
      .catch((e: Object) => {
        Logger.w('AlbumDetail', `mv load failed: ${String(e)}`);
      });
  }

  // ─── 多选模式 ───
  private toggleTrackSelection(id: string): void {
    const idx = this.selectedTrackIds.indexOf(id);
    if (idx >= 0) {
      this.selectedTrackIds = this.selectedTrackIds.filter((x: string) => x !== id);
    } else {
      this.selectedTrackIds = [...this.selectedTrackIds, id];
    }
  }

  private toggleSelectAll(): void {
    if (this.selectedTrackIds.length === this.tracks.length) {
      this.selectedTrackIds = [];
    } else {
      this.selectedTrackIds = this.tracks.map((tr: TrackDto) => tr.id);
    }
  }

  private exitSelectionMode(): void {
    this.isSelectionMode = false;
    this.selectedTrackIds = [];
  }

  // ─── 小爱音箱投送 ───
  private stopMiPolling(): void {
    if (this.miPollingId !== -1) { clearInterval(this.miPollingId); this.miPollingId = -1; }
  }

  private startMiQRPolling(lpUrl: string): void {
    this.stopMiPolling();
    this.miPollingId = setInterval(async () => {
      try {
        const res = await miApi.getQRCodeStatus(lpUrl);
        if (res.status === 'success') {
          this.stopMiPolling();
          this.miLoggedIn = true;
          const devRes = await miApi.getDevices();
          this.miDevices = devRes.devices || [];
        } else if (res.status === 'expired' || res.status === 'error') {
          this.stopMiPolling();
        }
      } catch (e) { /* silent */ }
    }, 2000);
  }

  private async handleOpenMiCast(): Promise<void> {
    this.showMiCast = true;
    this.miLoading = true;
    try {
      const auth = await miApi.getAuthStatus();
      this.miLoggedIn = auth.logged_in;
      if (auth.logged_in) {
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
          if (qr.status_url) this.startMiQRPolling(qr.status_url);
        }
      }
    } catch (e) {
      Logger.w('AlbumDetail', `loadMiDevices failed: ${String(e)}`);
      promptAction.showToast({ message: t('player.loadMiDevicesFailed') });
    } finally {
      this.miLoading = false;
    }
  }

  private handleCloseMiCast(): void {
    this.showMiCast = false;
    this.stopMiPolling();
  }

  private async handleCastPlaylistToMi(deviceId: string, deviceName: string): Promise<void> {
    if (this.tracks.length === 0) {
      promptAction.showToast({ message: t('player.miCastNoTrack') });
      return;
    }
    this.miCasting = true;
    try {
      const quality = await getInternalQuality();
      const payloads: MiTrackPayload[] = this.tracks.map((tr: TrackDto) => {
        const p: MiTrackPayload = {
          url: trackApi.streamUrl(tr.id, quality),
          title: `${tr.name} - ${tr.artist ?? ''}`,
          duration: tr.duration ?? 0,
        };
        return p;
      });
      await miApi.playPlaylist(deviceId, payloads, 0);
      promptAction.showToast({ message: t('player.miCastPlaylistSuccess', [['device', deviceName], ['count', payloads.length]]) });
      this.handleCloseMiCast();
    } catch (e) {
      Logger.w('AlbumDetail', `cast playlist to Mi failed: ${String(e)}`);
      promptAction.showToast({ message: t('player.miCastPlaylistFailed') });
    } finally {
      this.miCasting = false;
    }
  }

  // ─── 更多操作 ───
  private async handleUpdateCover(): Promise<void> {
    if (this.album === null || this.uploadingCover) return;
    // 对齐 mobile album/[id].tsx handleUpdateCover：仅 AudioDock 源支持修改封面
    if (authStore.state_.sourceType !== 'audiodock') {
      promptAction.showToast({ message: t('albumPage.audioDockOnlyCover') });
      return;
    }
    let uris: string[] = [];
    try {
      const photoPicker: picker.PhotoViewPicker = new picker.PhotoViewPicker();
      const options: picker.PhotoSelectOptions = {
        MIMEType: picker.PhotoViewMIMETypes.IMAGE_TYPE,
        maxSelectNumber: 1,
      };
      const result: picker.PhotoSelectResult = await photoPicker.select(options);
      uris = result.photoUris;
    } catch (e) {
      Logger.w('AlbumDetail', `pick cover failed: ${String(e)}`);
      return;
    }
    if (uris.length === 0) return;
    const uri = uris[0];
    this.uploadingCover = true;
    try {
      const updated = await albumApi.uploadCover(this.album.id, uri, 'image/jpeg');
      this.album = updated;
      promptAction.showToast({ message: t('common.success') });
    } catch (e) {
      Logger.w('AlbumDetail', `upload cover failed: ${String(e)}`);
      promptAction.showToast({ message: t('albumPage.uploadCoverFailed') });
    } finally {
      this.uploadingCover = false;
    }
  }

  private async handleCreatePlaylistWithAlbum(): Promise<void> {
    if (this.album === null) return;
    try {
      const pl = await playlistApi.create(this.album.name, this.album.type ?? 'MUSIC');
      const ids = this.tracks.map((tr: TrackDto) => tr.id);
      await playlistApi.addTracks(pl.id, ids);
      promptAction.showToast({ message: t('playlist.createSuccess') });
    } catch (e) {
      Logger.w('AlbumDetail', `create playlist failed: ${String(e)}`);
      promptAction.showToast({ message: t('common.operationFailed') });
    }
  }

  // 批量下载整张专辑（对齐 mobile album/[id].tsx 批量下载）：
  // 确认框 → downloadService.downloadTracks 顺序下载 → 完成提示。
  private handleBatchDownload(): void {
    if (this.batchDownloading) return;
    const album = this.album;
    if (album === null) return;
    if (this.tracks.length === 0) {
      promptAction.showToast({ message: t('common.noData') });
      return;
    }
    promptAction.showDialog({
      title: t('albumMore.batchDownload'),
      message: t('albumMore.confirmBatchDownload', [['albumName', album.name]]),
      buttons: [
        { text: t('common.cancel'), color: this.theme.colors.textSecondary },
        { text: t('common.confirm'), color: this.theme.colors.primary },
      ],
    }).then((res): void => {
      if (res.index === 1) {
        this.startBatchDownload();
      }
    });
  }

  private async startBatchDownload(): Promise<void> {
    this.batchDownloading = true;
    const ctx = this.getUIContext().getHostContext() as common.UIAbilityContext;
    const albumName: string = this.album?.name ?? '';
    try {
      await downloadTracks(ctx, this.tracks);
      promptAction.showToast({
        message: t('albumMore.batchDownloadComplete', [['albumName', albumName]]),
      });
    } catch (e) {
      Logger.w('AlbumDetail', `batch download failed: ${String(e)}`);
      promptAction.showToast({ message: t('common.operationFailed') });
    } finally {
      this.batchDownloading = false;
    }
  }

  @Builder
  moreSheet() {
    Column() {
      Text(t('albumMore.title'))
        .fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 4 });
      Text(this.album?.name ?? '')
        .fontSize(13).fontColor(this.theme.colors.textSecondary)
        .margin({ bottom: 16 });

      this.MoreOptionRow(t('albumMore.editCover'), () => {
        this.showMoreSheet = false;
        this.handleUpdateCover();
      })
      this.MoreOptionRow(t('albumMore.addToPlaylist'), () => {
        this.showMoreSheet = false;
        this.addToPlaylistVisible = true;
      })
      // 对齐 mobile AlbumMoreModal：仅有声书专辑显示「加入合集」
      if (this.isAudiobook()) {
        this.MoreOptionRow(t('albumMore.addToCollection'), () => {
          this.showMoreSheet = false;
          this.handleOpenCollectionPicker();
        })
      }
      this.MoreOptionRow(t('albumMore.createPlaylistWithSameName'), () => {
        this.showMoreSheet = false;
        this.handleCreatePlaylistWithAlbum();
      })
      this.MoreOptionRow(t('albumMore.selectTracks'), () => {
        this.showMoreSheet = false;
        this.isSelectionMode = true;
        this.selectedTrackIds = [];
      })
      this.MoreOptionRow(t('albumMore.batchDownload'), () => {
        this.showMoreSheet = false;
        this.handleBatchDownload();
      })
    }
    .width('100%').padding(20).alignItems(HorizontalAlign.Start)
  }

  // ─── 加入合集（对齐 mobile CollectionSelectModal）───
  private async handleOpenCollectionPicker(): Promise<void> {
    this.showCollectionPicker = true;
    this.collectionsLoading = true;
    try {
      const user = authStore.state_.user;
      this.collections = await collectionApi.list(user !== null ? user.id : undefined);
    } catch (e) {
      Logger.w('AlbumDetail', `collections load failed: ${String(e)}`);
      this.collections = [];
    } finally {
      this.collectionsLoading = false;
    }
  }

  private async handleAddToCollection(col: CollectionDto): Promise<void> {
    if (this.album === null || this.collectionAdding) return;
    this.collectionAdding = true;
    try {
      await collectionApi.addAlbum(col.id, this.album.id);
      promptAction.showToast({ message: t('common.success') });
      this.showCollectionPicker = false;
    } catch (e) {
      Logger.w('AlbumDetail', `add to collection failed: ${String(e)}`);
      promptAction.showToast({ message: t('common.operationFailed') });
    } finally {
      this.collectionAdding = false;
    }
  }

  private async handleCreateCollectionAndAdd(): Promise<void> {
    if (this.album === null || this.collectionAdding) return;
    const name = this.newCollectionName.trim();
    if (name.length === 0) {
      promptAction.showToast({ message: t('collection.collectionNameRequired') });
      return;
    }
    this.collectionAdding = true;
    try {
      const col = await collectionApi.create(name);
      await collectionApi.addAlbum(col.id, this.album.id);
      promptAction.showToast({ message: t('common.success') });
      this.showCreateCollection = false;
      this.newCollectionName = '';
      this.showCollectionPicker = false;
    } catch (e) {
      Logger.w('AlbumDetail', `create collection failed: ${String(e)}`);
      promptAction.showToast({ message: t('common.operationFailed') });
    } finally {
      this.collectionAdding = false;
    }
  }

  @Builder
  collectionPickerSheet() {
    Column() {
      Row() {
        Text(t('collection.selectCollection'))
          .fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
          .layoutWeight(1)
        AppIcon({ name: 'plus', iconSize: 22, color: this.theme.colors.primary })
          .onClick(() => {
            this.newCollectionName = '';
            this.showCreateCollection = true;
          })
      }
      .width('100%').margin({ top: 8, bottom: 4 })
      Text(this.album?.name ?? '')
        .fontSize(13).fontColor(this.theme.colors.textSecondary)
        .margin({ bottom: 16 });

      if (this.collectionsLoading) {
        Column({ space: 12 }) {
          LoadingProgress().width(32).height(32).color(this.theme.colors.primary);
          Text(t('common.loading')).fontSize(14).fontColor(this.theme.colors.textSecondary);
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center);
      } else if (this.collections.length === 0) {
        Column() {
          Text(t('collection.noCollections'))
            .fontSize(14).fontColor(this.theme.colors.textSecondary)
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center);
      } else {
        List() {
          ForEach(this.collections, (col: CollectionDto) => {
            ListItem() {
              Row({ space: 12 }) {
                Column() {
                  AppIcon({ name: 'folder', iconSize: 18, color: '#FFFFFFFF' })
                }
                .width(36).height(36).borderRadius(8)
                .backgroundColor(this.theme.colors.primary)
                .justifyContent(FlexAlign.Center);
                Text(col.name)
                  .fontSize(15).fontColor(this.theme.colors.text)
                  .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis });
                Text('›').fontSize(20).fontColor(this.theme.colors.textSecondary);
              }
              .width('100%').padding({ top: 12, bottom: 12 })
              .opacity(this.collectionAdding ? 0.5 : 1)
              .onClick(() => {
                if (!this.collectionAdding) this.handleAddToCollection(col);
              });
            }
          }, (col: CollectionDto) => col.id);
        }
        .layoutWeight(1).scrollBar(BarState.Off);
      }
    }
    .width('100%').height('100%').padding(20)
    .bindSheet($$this.showCreateCollection, this.createCollectionSheet(), {
      height: 240,
      dragBar: true,
      backgroundColor: this.theme.colors.surface,
    })
  }

  @Builder
  createCollectionSheet() {
    Column({ space: 16 }) {
      Text(t('collection.newCollection'))
        .fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
        .margin({ top: 8 });
      TextInput({ placeholder: t('collection.collectionNameRequired'), text: $$this.newCollectionName })
        .fontSize(15)
        .fontColor(this.theme.colors.text)
        .placeholderColor(this.theme.colors.textSecondary)
        .backgroundColor(this.theme.colors.surfaceAlt)
        .borderRadius(10)
        .padding({ left: 12, right: 12 })
        .height(44);
      Row({ space: 12 }) {
        CommonButton({
          label: t('collection.cancel'),
          theme: this.theme,
          onButtonClick: () => { this.showCreateCollection = false; },
        })
        CommonButton({
          label: t('collection.createAndAdd'),
          theme: this.theme,
          onButtonClick: () => this.handleCreateCollectionAndAdd(),
        })
      }
      .justifyContent(FlexAlign.End)
      .width('100%');
    }
    .width('100%').padding(20).alignItems(HorizontalAlign.Start)
  }

  @Builder
  MoreOptionRow(label: string, action: () => void) {
    Row({ space: 12 }) {
      Text(label).fontSize(15).fontColor(this.theme.colors.text).layoutWeight(1)
      Text('›').fontSize(18).fontColor(this.theme.colors.textSecondary)
    }
    .width('100%').padding({ top: 14, bottom: 14 })
    .onClick(action)
  }

  @Builder
  miCastSheet() {
    Column() {
      Text(t('player.miSpeakerTitle'))
        .fontSize(16).fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 16 });

      if (this.miLoading) {
        Column({ space: 12 }) {
          LoadingProgress().width(32).height(32).color(this.theme.colors.primary);
          Text(t('common.loading')).fontSize(14).fontColor(this.theme.colors.textSecondary);
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center);
      } else if (this.miLoggedIn) {
        if (this.miDevices.length === 0) {
          Column({ space: 12 }) {
            XiaoAiIcon({ iconSize: 40, color: this.theme.colors.textSecondary });
            Text(t('player.noMiDevices')).fontSize(14).fontColor(this.theme.colors.textSecondary);
          }
          .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center);
        } else {
          List() {
            ForEach(this.miDevices, (device: MiDevice) => {
              ListItem() {
                Row({ space: 12 }) {
                  Column() { XiaoAiIcon({ iconSize: 20, color: '#FFFFFFFF' }); }
                  .width(36).height(36).borderRadius(18)
                  .backgroundColor(this.theme.colors.primary)
                  .justifyContent(FlexAlign.Center);
                  Column({ space: 2 }) {
                    Text(device.name).fontSize(15).fontWeight(FontWeight.Medium)
                      .fontColor(this.theme.colors.text).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis });
                    if ((device.model ?? '').length > 0) {
                      Text(device.model ?? '').fontSize(12).fontColor(this.theme.colors.textSecondary)
                        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis });
                    }
                  }
                  .layoutWeight(1).alignItems(HorizontalAlign.Start);
                  Text('›').fontSize(20).fontColor(this.theme.colors.textSecondary);
                }
                .width('100%').padding({ top: 12, bottom: 12, left: 16, right: 16 })
                .opacity(this.miCasting ? 0.5 : 1)
                .onClick(() => {
                  if (!this.miCasting) this.handleCastPlaylistToMi(device.device_id, device.name);
                });
              }
            }, (device: MiDevice) => device.device_id);
          }
          .layoutWeight(1).scrollBar(BarState.Off);
        }
      } else if (this.miQRCodeUrl !== '') {
        Column({ space: 8 }) {
          Text(t('player.miLoginRequired')).fontSize(14).fontColor(this.theme.colors.textSecondary);
          Image(this.miQRCodeUrl).width(180).height(180).borderRadius(8)
            .backgroundColor('#FFFFFFFF').objectFit(ImageFit.Contain);
          Text(t('player.miScanQRCode')).fontSize(12).fontColor(this.theme.colors.textSecondary);
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center);
      } else {
        Column({ space: 12 }) {
          XiaoAiIcon({ iconSize: 40, color: this.theme.colors.textSecondary });
          Text(t('player.miLoginRequired')).fontSize(14).fontColor(this.theme.colors.textSecondary);
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center);
      }
    }
    .width('100%').height('100%').padding(20)
  }
}
