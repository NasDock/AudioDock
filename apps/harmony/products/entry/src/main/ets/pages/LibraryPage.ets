import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import display from '@ohos.display';
import { kvStore } from 'features_storage';
import { t } from 'features_i18n';
import { Logger } from 'audiodock_common';
import {
  artistApi, albumApi, trackApi, collectionApi, mvApi, miApi, playlistApi,
} from 'features_network';
import type {
  ArtistDto, AlbumDto, TrackDto, CollectionDto, MVDto,
  MiDevice, MiTrackPayload, PlaylistDto,
} from 'features_network';
import { AppIcon } from '../components/AppIcon';
import { CoverImage } from '../components/CoverImage';
import { XiaoAiIcon } from '../components/XiaoAiIcon';
import { authStore } from '../context/AuthStore';
import { resolveTrackToPlayer, playQueueFast } from '../services/trackResolver';
import { playerStore } from '../context/PlayerStore';
import type { Track } from '../context/PlayerStore';
import { mvPlaylistStore } from '../store/MvPlaylistStore';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';

// ─── 网格布局常量：与 mobile library.tsx 保持一致 ───
const GAP: number = 15;
const SCREEN_PADDING: number = 40; // 左右各 20
const TARGET_WIDTH: number = 100;
/** mobile：单曲一次拉 2000，艺术家/专辑一次拉 1000。 */
const TRACK_PAGE: number = 2000;
const GRID_PAGE: number = 1000;

class TabInfo {
  key: string = '';
  label: string = '';

  constructor(key: string, label: string) {
    this.key = key;
    this.label = label;
  }
}

/** NavDestination 详情页 param：ArkTS 严格模式不允许内联对象字面量，必须显式类/接口 */
interface DetailNavParam {
  id: string;
}

@Component
export struct LibraryTab {
  // 路由栈由 RootShellPage 注入；进 NavDestination 内的页面用它，独立 Page 仍走 router.pushUrl
  pathStack: NavPathStack = new NavPathStack();
  // 车机模式详情页跳转回调：仅 carModeEnabled 时使用（右栏局部渲染），不进入全局路由
  carNavCallback?: (name: string, id: string) => void;
  // 与 MainPage 同源：车机模式开关，决定 navigateToXxx 走 carNavCallback 还是 pathStack。
  // carNavCallback 由 MainPage 无条件注入，不能用它本身当开关（否则手机端点击走车机右栏分支 → 无反应）。
  @StorageLink('carModeEnabled') carModeEnabled: boolean = false;
  // 内容模式由 AppStorage 全局同步（对齐 mobile 共享的 usePlayMode context）：
  // 首页/声仓/设置页任一处切换，另一处经 @Watch 自动重载。
  @StorageLink('playMode') @Watch('onModeChange') mode: string = 'MUSIC';
  // mobile 默认 activeTab 为 songs
  @State activeTab: string = 'songs';
  @State loading: boolean = true;
  @State refreshing: boolean = false;
  @State error: string = '';
  @State tracks: TrackDto[] = [];
  @State artists: ArtistDto[] = [];
  @State albums: AlbumDto[] = [];
  @State collections: CollectionDto[] = [];
  @State mvs: MVDto[] = [];
  @State tabCounts: Record<string, number> = {};
  // ─── 歌曲多选（对齐 mobile selection mode） ───
  @State isSelectionMode: boolean = false;
  @State selectedTrackIds: string[] = [];
  @State showAddToPlaylist: boolean = false;
  @State playlists: PlaylistDto[] = [];
  // ─── 心动模式（对齐 mobile heartbeatMode） ───
  @State heartbeatModeActive: boolean = false;
  // ─── 当前播放（定位按钮用） ───
  @State currentTrackId: string = '';
  @State currentArtist: string = '';
  @State currentAlbum: string = '';
  // ─── 小爱音箱投送（对齐 mobile MiDeviceSelector） ───
  @State showMiCast: boolean = false;
  @State miDevices: MiDevice[] = [];
  @State miLoggedIn: boolean = false;
  @State miQRCodeUrl: string = '';
  @State miLoading: boolean = false;
  @State miCasting: boolean = false;
  private miPollingId: number = -1;
  // ─── 动态网格（对齐 mobile numColumns 计算） ───
  @State numColumns: number = 3;
  @State itemWidth: number = 100;
  @State columnsTemplate: string = '1fr 1fr 1fr';
  // 修复 5：视窗切换（list/grid），对齐 mobile folder/index.tsx layoutMode
  @State viewMode: 'list' | 'grid' = 'list';
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @StorageProp('appLang') appLang: string = 'zh-CN';
  @State theme: Theme = buildTheme('light');
  private userId: string = '';
  // ForEach 仅按 key diff：整页重载（切模式/切 tab/心动模式）时递增版本拼进 key，
  // 否则 key 不变 ArkUI 保留旧组件，列表仍是旧内容/旧顺序。
  private listVersion: number = 0;
  // ─── 每 tab 数据缓存：切 tab 回来不再重新拉数据闪骨架屏（对齐 mobile 的「已有数据直接展示」） ───
  // key 格式 `${tab}_${mode}`（切内容模式后缓存自然失效，因为 key 变了）
  private tabDataLoaded: Record<string, boolean> = {};
  private unsubPlayer: () => void = () => {};
  private songScroller: Scroller = new Scroller();
  private artistScroller: Scroller = new Scroller();
  private albumScroller: Scroller = new Scroller();
  private collectionScroller: Scroller = new Scroller();
  private mvScroller: Scroller = new Scroller();

  aboutToAppear() {
    this.theme = buildTheme(this.themeMode);
    this.computeGridLayout();
    // 修复 5：从 KV 恢复视窗模式
    kvStore.get('library_view_mode')
      .then((v: string | null): void => {
        if (v === 'grid' || v === 'list') this.viewMode = v;
      })
      .catch((e: Error): void => {
        Logger.w('LibraryPage', `read library_view_mode failed: ${String(e)}`);
      });
    this.unsubPlayer = playerStore.subscribe(() => this.syncCurrentTrack());
    this.syncCurrentTrack();
    // mobile：AUDIOBOOK 模式下 songs tab 不存在，回落到 artists
    if (this.mode === 'AUDIOBOOK' && this.activeTab === 'songs') {
      this.activeTab = 'artists';
    }
    this.initData();
  }

  aboutToDisappear(): void {
    this.unsubPlayer();
    this.stopMiPolling();
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  private computeGridLayout(): void {
    try {
      const d = display.getDefaultDisplaySync();
      const widthVp = px2vp(d.width);
      const avail = widthVp - SCREEN_PADDING;
      this.numColumns = Math.max(3, Math.floor((avail + GAP) / (TARGET_WIDTH + GAP)));
      this.itemWidth = (avail - (this.numColumns - 1) * GAP) / this.numColumns;
      let tpl = '';
      for (let i = 0; i < this.numColumns; i++) {
        tpl += '1fr ';
      }
      this.columnsTemplate = tpl.trim();
    } catch (e) {
      Logger.w('LibraryTab', `computeGridLayout failed: ${String(e)}`);
    }
  }

  /**
   * 修复 5：切换 list/grid 视窗，写入 KV 持久化（对齐 mobile folder/index.tsx L286-296）。
   * 持久化键：library_view_mode。
   */
  private toggleViewMode(): void {
    this.viewMode = this.viewMode === 'list' ? 'grid' : 'list';
    kvStore.set('library_view_mode', this.viewMode).catch((e: Error): void => {
      Logger.w('LibraryPage', `save library_view_mode failed: ${String(e)}`);
    });
  }

  private syncCurrentTrack(): void {
    const v = playerStore.view();
    let id = '';
    let artist = '';
    let album = '';
    if (v.currentIndex >= 0 && v.currentIndex < v.queue.length) {
      const cur = v.queue[v.currentIndex];
      id = cur.id;
      artist = cur.artist ?? '';
      album = cur.album ?? '';
    }
    if (id !== this.currentTrackId) this.currentTrackId = id;
    if (artist !== this.currentArtist) this.currentArtist = artist;
    if (album !== this.currentAlbum) this.currentAlbum = album;
  }

  async initData(): Promise<void> {
    this.userId = authStore.state_.user?.id ?? '';
    await this.loadAllData();
  }

  /**
   * 统计各 tab 数量 + 加载当前 tab 内容。
   * 注意：旧实现这里只有 try/catch 没有 finally，一旦计数请求失败，
   * loading 永远停在 true，声仓页就卡死在骨架屏。现在统一在 finally 收口。
   */
  async loadAllData(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const counts: Record<string, number> = {};
      const isMusic = this.mode === 'MUSIC';

      const artistCount = await artistApi.loadMore({ pageSize: 1, loadCount: 0, type: this.mode });
      counts['artists'] = artistCount.total;

      const albumCount = await albumApi.loadMore({ pageSize: 1, loadCount: 0, type: this.mode });
      counts['albums'] = albumCount.total;

      if (isMusic) {
        const trackCount = await trackApi.loadMore({ pageSize: 1, loadCount: 0, type: 'MUSIC' });
        counts['songs'] = trackCount.total;

        const mvCount = await mvApi.list({ pageSize: 1, skip: 0 });
        counts['mvs'] = mvCount.total;
      } else if (this.userId.length > 0) {
        const cols = await collectionApi.list(this.userId);
        counts['collections'] = cols.length;
      }

      this.tabCounts = counts;
      await this.loadTabData(false);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      Logger.e('LibraryTab', `loadAllData failed: ${this.error}`);
    } finally {
      this.loading = false;
    }
  }

  /** 当前 tab 是否已有缓存数据（决定是否跳过加载直接展示） */
  private hasTabCache(tab: string): boolean {
    return this.tabDataLoaded[`${tab}_${this.mode}`] === true;
  }

  private markTabCache(tab: string): void {
    this.tabDataLoaded[`${tab}_${this.mode}`] = true;
  }

  /**
   * 加载当前 tab 数据。silent=true 用于下拉刷新：不显示骨架屏
   * （对齐 mobile setLoading(list.length === 0) 的行为）。
   */
  async loadTabData(silent: boolean): Promise<void> {
    if (!silent) this.loading = true;
    this.error = '';
    try {
      const sortBy = this.heartbeatModeActive ? 'heartbeat' : undefined;
      if (this.activeTab === 'songs' && this.mode === 'MUSIC') {
        const res = await trackApi.loadMore({ pageSize: TRACK_PAGE, loadCount: 0, type: 'MUSIC', sortBy });
        const list = res.list.slice();
        // 心动模式保持服务端返回顺序，其它模式按名称排序（对齐 mobile）
        if (!this.heartbeatModeActive) {
          list.sort((a: TrackDto, b: TrackDto) => a.name.localeCompare(b.name));
        }
        this.listVersion++;
        this.tracks = list;
      } else if (this.activeTab === 'artists') {
        const res = await artistApi.loadMore({ pageSize: GRID_PAGE, loadCount: 0, type: this.mode, sortBy });
        const list = res.list.slice();
        if (!this.heartbeatModeActive) {
          list.sort((a: ArtistDto, b: ArtistDto) => a.name.localeCompare(b.name));
        }
        this.listVersion++;
        this.artists = list;
      } else if (this.activeTab === 'albums') {
        const res = await albumApi.loadMore({ pageSize: GRID_PAGE, loadCount: 0, type: this.mode, sortBy });
        const list = res.list.slice();
        if (!this.heartbeatModeActive) {
          list.sort((a: AlbumDto, b: AlbumDto) => a.name.localeCompare(b.name));
        }
        this.listVersion++;
        this.albums = list;
      } else if (this.activeTab === 'collections' && this.mode === 'AUDIOBOOK' && this.userId.length > 0) {
        this.listVersion++;
        this.collections = await collectionApi.list(this.userId);
      } else if (this.activeTab === 'mvs' && this.mode === 'MUSIC') {
        const res = await mvApi.list({ pageSize: GRID_PAGE, skip: 0 });
        this.listVersion++;
        // 倒序展示：最新添加的 MV 排在前面
        this.mvs = res.list.slice().reverse();
      }
      this.markTabCache(this.activeTab);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      Logger.e('LibraryTab', `loadTabData failed: ${this.error}`);
    } finally {
      this.loading = false;
    }
  }

  // ─── 模式切换（对齐 mobile toggleMode + tab 校正 effects） ───
  toggleMode(): void {
    this.mode = this.mode === 'MUSIC' ? 'AUDIOBOOK' : 'MUSIC';
  }

  // @Watch('onModeChange')：无论本页还是首页/设置页切换模式都会触发。
  async onModeChange(): Promise<void> {
    try {
      await kvStore.set('playMode', this.mode);
    } catch (e) {
      Logger.w('LibraryTab', `save playMode failed: ${String(e)}`);
    }
    // 对齐 mobile：切换内容模式时保存当前模式播放状态、恢复目标模式的播放上下文
    await playerStore.switchContentMode(this.mode);
    // 对齐 mobile effects：非 MUSIC 时关闭心动模式；校正非法 tab；退出多选
    if (this.mode !== 'MUSIC' && this.heartbeatModeActive) {
      this.heartbeatModeActive = false;
    }
    if (this.mode === 'AUDIOBOOK' && this.activeTab === 'songs') {
      this.activeTab = 'artists';
    }
    if (this.mode !== 'AUDIOBOOK' && this.activeTab === 'collections') {
      this.activeTab = 'artists';
    }
    this.exitSelectionMode();
    await this.loadAllData();
  }

  switchTab(tab: string): void {
    this.activeTab = tab;
    // 对齐 mobile：离开 songs tab 时退出多选
    if (tab !== 'songs') {
      this.exitSelectionMode();
    }
    // 该 tab 已有数据则直接展示，不重新拉取（避免每次切 tab 闪骨架屏）；
    // 数据更新交给下拉刷新（loadTabData(true) 强制 silent 拉取）。
    if (!this.hasTabCache(tab)) {
      this.loadTabData(false);
    }
  }

  toggleHeartbeat(): void {
    this.heartbeatModeActive = !this.heartbeatModeActive;
    this.loadTabData(false);
  }

  // ─── 下拉刷新 ───
  async onPullRefresh(): Promise<void> {
    await this.loadTabData(true);
    this.refreshing = false;
  }

  navigateToSearch(): void {
    if (this.carModeEnabled && this.carNavCallback) {
      this.carNavCallback('Search', '');
    } else {
      this.pathStack.pushPath({ name: 'Search' });
    }
  }

  navigateToArtist(id: string): void {
    if (this.carModeEnabled && this.carNavCallback) {
      this.carNavCallback('ArtistDetail', id);
    } else {
      const param: DetailNavParam = { id: id };
      this.pathStack.pushPath({ name: 'ArtistDetail', param: param });
    }
  }

  navigateToAlbum(id: string): void {
    if (this.carModeEnabled && this.carNavCallback) {
      this.carNavCallback('AlbumDetail', id);
    } else {
      const param: DetailNavParam = { id: id };
      this.pathStack.pushPath({ name: 'AlbumDetail', param: param });
    }
  }

  navigateToCollection(id: string): void {
    if (this.carModeEnabled && this.carNavCallback) {
      this.carNavCallback('CollectionDetail', id);
    } else {
      const param: DetailNavParam = { id: id };
      this.pathStack.pushPath({ name: 'CollectionDetail', param: param });
    }
  }

  navigateToMv(id: string): void {
    // 把当前 MV 网格（this.mvs）作为列表塞进 playlist，再跳详情页。
    // 这样从 Library 入口进入后也能在详情页内上一首/下一首切换（对齐 mobile library.tsx:928-932）。
    const idx = this.mvs.findIndex((m) => m.id === id);
    mvPlaylistStore.setPlaylist(this.mvs, idx >= 0 ? idx : 0);
    router.pushUrl({ url: 'pages/MVDetailPage', params: { id: id } });
  }

  async playFrom(index: number): Promise<void> {
    try {
      // 秒播：先播 index 这首，完整队列后台并行补齐
      await playQueueFast(this.tracks, index, false);
      // 不再自动打开播放详情页：播放交给 MiniPlayer，用户点 MiniPlayer 再进详情
    } catch (e) {
      Logger.w('LibraryTab', `play failed: ${String(e)}`);
    }
  }

  // ─── 多选（对齐 mobile selection mode） ───
  enterSelectionMode(): void {
    this.isSelectionMode = true;
    this.selectedTrackIds = [];
  }

  exitSelectionMode(): void {
    this.isSelectionMode = false;
    this.selectedTrackIds = [];
  }

  toggleTrackSelection(id: string): void {
    const idx = this.selectedTrackIds.indexOf(id);
    if (idx >= 0) {
      this.selectedTrackIds.splice(idx, 1);
    } else {
      this.selectedTrackIds.push(id);
    }
    // 触发 @State 刷新
    this.selectedTrackIds = this.selectedTrackIds.slice();
  }

  toggleSelectAll(): void {
    if (this.selectedTrackIds.length === this.tracks.length) {
      this.selectedTrackIds = [];
    } else {
      const all: string[] = [];
      for (const tr of this.tracks) all.push(tr.id);
      this.selectedTrackIds = all;
    }
  }

  isSelected(id: string): boolean {
    return this.selectedTrackIds.indexOf(id) >= 0;
  }

  private async loadPlaylists(): Promise<void> {
    try {
      this.playlists = await playlistApi.list('MUSIC');
    } catch (e) {
      Logger.w('LibraryTab', `loadPlaylists failed: ${String(e)}`);
    }
  }

  async openAddToPlaylist(): Promise<void> {
    if (this.selectedTrackIds.length === 0) return;
    await this.loadPlaylists();
    this.showAddToPlaylist = true;
  }

  async addSelectedToPlaylist(playlistId: string): Promise<void> {
    this.showAddToPlaylist = false;
    try {
      await playlistApi.addTracks(playlistId, this.selectedTrackIds);
      promptAction.showToast({ message: t('common.addToPlaylist') });
    } catch (e) {
      Logger.w('LibraryTab', `addTracks failed: ${String(e)}`);
      promptAction.showToast({ message: t('common.operationFailed') });
    }
  }

  // 鸿蒙端暂无离线下载能力，与专辑详情页保持一致的提示口径
  handleDownloadSelected(): void {
    if (this.selectedTrackIds.length === 0) {
      promptAction.showToast({ message: t('libraryPage.selectTracksFirst') });
      return;
    }
    promptAction.showToast({ message: '该功能暂未在鸿蒙端开放' });
  }

  // ─── 悬浮按钮：定位当前播放（对齐 mobile FloatingActionButtons.handleLocateCurrent） ───
  private locateDisabled(): boolean {
    if (this.activeTab === 'songs') {
      return this.currentTrackId.length === 0 || this.findTrackIndex() < 0;
    } else if (this.activeTab === 'artists') {
      return this.currentArtist.length === 0 || this.findArtistIndex() < 0;
    } else if (this.activeTab === 'albums') {
      return this.currentAlbum.length === 0 || this.findAlbumIndex() < 0;
    }
    return true;
  }

  private findTrackIndex(): number {
    for (let i = 0; i < this.tracks.length; i++) {
      if (this.tracks[i].id === this.currentTrackId) return i;
    }
    return -1;
  }

  private findArtistIndex(): number {
    for (let i = 0; i < this.artists.length; i++) {
      if (this.artists[i].name === this.currentArtist) return i;
    }
    return -1;
  }

  private findAlbumIndex(): number {
    for (let i = 0; i < this.albums.length; i++) {
      if (this.albums[i].name === this.currentAlbum) return i;
    }
    return -1;
  }

  scrollToTop(): void {
    if (this.activeTab === 'songs') {
      this.songScroller.scrollEdge(Edge.Start);
    } else if (this.activeTab === 'artists') {
      this.artistScroller.scrollTo({ xOffset: 0, yOffset: 0, animation: true });
    } else if (this.activeTab === 'albums') {
      this.albumScroller.scrollTo({ xOffset: 0, yOffset: 0, animation: true });
    }
  }

  scrollToBottom(): void {
    if (this.activeTab === 'songs') {
      this.songScroller.scrollEdge(Edge.End);
    } else if (this.activeTab === 'artists') {
      this.artistScroller.scrollEdge(Edge.End);
    } else if (this.activeTab === 'albums') {
      this.albumScroller.scrollEdge(Edge.End);
    }
  }

  handleLocateCurrent(): void {
    if (this.locateDisabled()) return;
    try {
      if (this.activeTab === 'songs') {
        this.songScroller.scrollToIndex(this.findTrackIndex(), true, ScrollAlign.CENTER);
      } else if (this.activeTab === 'artists') {
        const row = Math.floor(this.findArtistIndex() / this.numColumns);
        const rowH = this.itemWidth + 26 + GAP;
        this.artistScroller.scrollTo({ xOffset: 0, yOffset: Math.max(0, row * rowH - 200), animation: true });
      } else if (this.activeTab === 'albums') {
        const row = Math.floor(this.findAlbumIndex() / this.numColumns);
        const rowH = this.itemWidth + 44 + GAP;
        this.albumScroller.scrollTo({ xOffset: 0, yOffset: Math.max(0, row * rowH - 200), animation: true });
      }
    } catch (e) {
      Logger.w('LibraryTab', `locate failed: ${String(e)}`);
    }
  }

  // ─── 小爱音箱投送（复用 AlbumDetailPage 的交互流程） ───
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

  async handleOpenMiCast(): Promise<void> {
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
      Logger.w('LibraryTab', `loadMiDevices failed: ${String(e)}`);
      promptAction.showToast({ message: t('player.loadMiDevicesFailed') });
    } finally {
      this.miLoading = false;
    }
  }

  private handleCloseMiCast(): void {
    this.showMiCast = false;
    this.stopMiPolling();
  }

  /**
   * 投放当前歌曲列表到小爱音箱（对齐 mobile handleCastTracksToMi：
   * 全部曲目、high 品质、/track/stream 直链）。
   */
  private async handleCastTracksToMi(deviceId: string, deviceName: string): Promise<void> {
    if (this.tracks.length === 0) {
      promptAction.showToast({ message: t('player.miCastNoTrack') });
      return;
    }
    this.miCasting = true;
    try {
      const payloads: MiTrackPayload[] = [];
      for (const tr of this.tracks) {
        const p: MiTrackPayload = {
          url: trackApi.streamUrl(tr.id, 'high'),
          title: `${tr.name} - ${tr.artist ?? ''}`,
          duration: tr.duration ?? 0,
        };
        payloads.push(p);
      }
      await miApi.playPlaylist(deviceId, payloads, 0);
      promptAction.showToast({
        message: t('player.miCastPlaylistSuccess', [['device', deviceName], ['count', payloads.length]]),
      });
      this.handleCloseMiCast();
    } catch (e) {
      Logger.w('LibraryTab', `cast tracks to Mi failed: ${String(e)}`);
      promptAction.showToast({ message: t('player.miCastPlaylistFailed') });
    } finally {
      this.miCasting = false;
    }
  }

  // ─── 布局辅助 ───
  getVisibleTabs(): TabInfo[] {
    const tabs: TabInfo[] = [];
    if (this.mode === 'MUSIC') tabs.push(new TabInfo('songs', t('nav.tracks')));
    tabs.push(new TabInfo('artists', t('nav.artists')));
    tabs.push(new TabInfo('albums', t('nav.albums')));
    if (this.mode === 'MUSIC') tabs.push(new TabInfo('mvs', 'MV'));
    if (this.mode === 'AUDIOBOOK') tabs.push(new TabInfo('collections', t('nav.collections')));
    return tabs;
  }

  getTabCount(key: string): number {
    return this.tabCounts[key] ?? 0;
  }

  /** 网格内容高度（用于 Scroll 内 Grid 定高 + 底部统计行）。 */
  private gridContentHeight(count: number, blockHeight: number): number {
    if (count <= 0) return 0;
    const rows = Math.ceil(count / this.numColumns);
    return rows * blockHeight + Math.max(0, rows - 1) * GAP;
  }

  /** 艺术家单元格块高：图 + 8 + 一行文字。 */
  private artistBlockHeight(): number {
    return this.itemWidth + 26;
  }

  /** 专辑/合集/MV 单元格块高：图 + 8 + 标题 + 4 + 副标题。 */
  private albumBlockHeight(): number {
    return this.itemWidth + 44;
  }

  private collectionCover(c: CollectionDto): string | undefined {
    if (c.cover !== undefined && c.cover.length > 0) return c.cover;
    if (c.items !== undefined && c.items.length > 0) {
      const first = c.items[0];
      if (first.album !== undefined && first.album.cover !== undefined) return first.album.cover;
    }
    return undefined;
  }

  private collectionCount(c: CollectionDto): number {
    return c.items !== undefined ? c.items.length : 0;
  }

  private showAlbumProgress(album: AlbumDto): boolean {
    if ((album.progress ?? 0) <= 0) return false;
    return album.type === 'AUDIOBOOK' || this.mode === 'AUDIOBOOK';
  }

  private showFloatingButtons(): boolean {
    return this.activeTab === 'songs' || this.activeTab === 'artists' || this.activeTab === 'albums';
  }

  private songSourceLabel(track: TrackDto): string {
    return track.source === 'WEBDAV' ? t('trackList.sourceWebdav') : t('trackList.sourceFile');
  }

  // 骨架屏参数：与各 tab 真实网格/列表尺寸保持一致
  private skRange(): number[] {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  }

  private skHasSub(): boolean {
    return this.activeTab === 'albums' || this.activeTab === 'mvs';
  }

  // ─────────────────────────── UI ───────────────────────────

  @Builder
  HeaderBuilder() {
    Row() {
      Text(t('libraryPage.title'))
        .fontSize(24).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
      Row() {
        // 小爱投送：MUSIC + songs + 非多选（对齐 mobile XiaoAiIcon 按钮）
        if (this.mode === 'MUSIC' && this.activeTab === 'songs' && !this.isSelectionMode) {
          Column() {
            XiaoAiIcon({ iconSize: 20, color: this.theme.colors.primary })
          }
          .width(36).height(36).borderRadius(18).backgroundColor(this.theme.colors.card)
          .justifyContent(FlexAlign.Center).margin({ right: 12 })
          .onClick(() => this.handleOpenMiCast())
        }
        if (this.mode === 'MUSIC' && this.activeTab === 'songs') {
          if (this.isSelectionMode) {
            // 多选模式：关闭按钮
            Column() {
              AppIcon({ name: 'close', iconSize: 20, color: this.theme.colors.primary })
            }
            .width(36).height(36).borderRadius(18).backgroundColor(this.theme.colors.card)
            .justifyContent(FlexAlign.Center).margin({ right: 12 })
            .onClick(() => this.exitSelectionMode())
          } else {
            // 进入多选
            Column() {
              AppIcon({ name: 'list', iconSize: 20, color: this.theme.colors.primary })
            }
            .width(36).height(36).borderRadius(18).backgroundColor(this.theme.colors.card)
            .justifyContent(FlexAlign.Center).margin({ right: 12 })
            .onClick(() => this.enterSelectionMode())
            // 播放全部
            Column() {
              AppIcon({ name: 'play', iconSize: 20, color: this.theme.colors.primary })
            }
            .width(36).height(36).borderRadius(18).backgroundColor(this.theme.colors.card)
            .justifyContent(FlexAlign.Center).margin({ right: 12 })
            .onClick(() => this.playFrom(0))
          }
        }
        // 修复 5：视窗切换（list/grid），对齐 mobile folder/index.tsx L286-296
        // 当前是 list 时显示 grid-outline 提示可切到网格；反之亦然
        Column() {
          AppIcon({
            name: this.viewMode === 'list' ? 'grid-outline' : 'list-outline',
            iconSize: 18,
            color: this.theme.colors.primary,
          });
        }
        .width(36).height(36).borderRadius(18).backgroundColor(this.theme.colors.card)
        .justifyContent(FlexAlign.Center).margin({ right: 12 })
        .onClick(() => this.toggleViewMode())

        // 搜索（用 AppIcon 矢量图标，尺寸与旁边 play iconSize:20 一致；
        // 旧实现用 ⌕ 文本字符渲染尺寸明显偏小，与其他按钮不一致）
        Column() {
          AppIcon({
            name: 'search',
            iconSize: 20,
            color: this.theme.colors.primary,
          });
        }
        .width(36).height(36).borderRadius(18).backgroundColor(this.theme.colors.card)
        .justifyContent(FlexAlign.Center)
        .onClick(() => this.navigateToSearch())
        // 模式切换：MUSIC 显示耳机（切到有声书），AUDIOBOOK 显示音符（切回音乐）
        Column() {
          AppIcon({
            name: this.mode === 'MUSIC' ? 'headphones' : 'music-note',
            iconSize: 18, color: this.theme.colors.primary,
          })
        }
        .width(36).height(36).borderRadius(18).backgroundColor(this.theme.colors.card)
        .justifyContent(FlexAlign.Center).margin({ left: 12 })
        .onClick(() => this.toggleMode())
      }
    }
    .width('100%')
    .padding({ left: 20, right: 20, top: 20, bottom: 15 })
    .justifyContent(FlexAlign.SpaceBetween)
  }

  @Builder
  TabBarBuilder() {
    Row() {
      Row() {
        ForEach(this.getVisibleTabs(), (tab: TabInfo) => {
          Row() {
            Text() {
              Span(tab.label)
                .fontSize(14)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.activeTab === tab.key ? this.theme.colors.onPrimary : this.theme.colors.textSecondary)
              if (this.getTabCount(tab.key) > 0) {
                Span(' ' + this.getTabCount(tab.key))
                  .fontSize(11)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.activeTab === tab.key ? this.theme.colors.onPrimary : this.theme.colors.textSecondary)
              }
            }
          }
          .layoutWeight(1)
          .height('100%')
          .borderRadius(18)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(this.activeTab === tab.key ? this.theme.colors.primary : Color.Transparent)
          .onClick(() => this.switchTab(tab.key))
        }, (tab: TabInfo) => tab.key)
      }
      .width('100%')
      .height(40)
      .padding(2)
      .borderRadius(20)
      .borderWidth(1)
      .borderColor(this.theme.colors.border)
      .backgroundColor(Color.Transparent)
    }
    .width('100%')
    .padding({ left: 20, right: 20, bottom: 15 })
  }

  // 多选工具栏（对齐 mobile selectionHeader）
  @Builder
  SelectionHeaderBuilder() {
    Row() {
      AppIcon({ name: 'list', iconSize: 24, color: this.theme.colors.text })
        .onClick(() => this.toggleSelectAll())
      Row({ space: 12 }) {
        Text(t('libraryPage.selectedCount', [['count', this.selectedTrackIds.length]]))
          .fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.theme.colors.text)
        AppIcon({
          name: 'plus', iconSize: 24,
          color: this.selectedTrackIds.length > 0 ? this.theme.colors.text : this.theme.colors.textSecondary,
        })
          .onClick(() => this.openAddToPlaylist())
        AppIcon({
          name: 'cloud-download', iconSize: 24,
          color: this.selectedTrackIds.length > 0 ? this.theme.colors.text : this.theme.colors.textSecondary,
        })
          .onClick(() => this.handleDownloadSelected())
      }
    }
    .width('100%')
    .padding({ left: 20, right: 20, top: 12, bottom: 12 })
    .justifyContent(FlexAlign.SpaceBetween)
    .border({ width: { bottom: 1 }, color: 'rgba(150,150,150,0.1)' })
  }

  @Builder
  SongItemBuilder(track: TrackDto, index: number) {
    Row() {
      if (this.isSelectionMode) {
        Column() {
          // 对齐 mobile：Ionicons checkbox / square-outline（不用 emoji，各端渲染不一致）
          AppIcon({
            name: this.isSelected(track.id) ? 'checkbox' : 'square-outline',
            iconSize: 24,
            color: this.isSelected(track.id) ? this.theme.colors.primary : this.theme.colors.textSecondary,
          })
        }
        .width(48).height(48).justifyContent(FlexAlign.Center).margin({ right: 12 })
      } else {
        CoverImage({
          path: track.cover,
          imgWidth: 48, imgHeight: 48, radius: 8,
          fallbackText: track.name,
        })
          .margin({ right: 12 })
      }
      Column() {
        Text(track.name)
          .fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.theme.colors.text)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).margin({ bottom: 2 })
        Text(`${track.artist ?? ''} · ${track.album ?? ''} · ${this.songSourceLabel(track)}`)
          .fontSize(13).fontColor(this.theme.colors.textSecondary)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1).alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .padding({ top: 10, bottom: 10 })
    .onClick(() => {
      if (this.isSelectionMode) {
        this.toggleTrackSelection(track.id);
      } else {
        this.playFrom(index);
      }
    })
  }

  @Builder
  FooterBuilder(text: string) {
    Text(text)
      .fontSize(13).fontColor(this.theme.colors.textSecondary)
      .width('100%').textAlign(TextAlign.Center)
      .padding({ top: 16, bottom: 16 })
  }

  // ─── 各 tab 内容 ───

  @Builder
  SongListBuilder() {
    List({ scroller: this.songScroller }) {
      ForEach(this.tracks, (track: TrackDto, index: number) => {
        ListItem() {
          this.SongItemBuilder(track, index);
        }
      }, (track: TrackDto) => `${track.id}-v${this.listVersion}`)
      ListItem() {
        this.FooterBuilder(t('libraryPage.loadedTracks', [['count', this.tracks.length]]))
      }
    }
    .width('100%').height('100%')
    .padding({ left: 20, right: 20 })
    .scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring)
  }

  /**
   * 修复 5：songs tab 的网格视图（对齐 mobile folder/index.tsx grid mode）。
   * 3 列起步，按 numColumns 自动撑满，封面 1:1，下方 1-2 行文字。
   */
  @Builder
  SongGridBuilder() {
    Scroll(this.songScroller) {
      Column() {
        Grid() {
          ForEach(this.tracks, (track: TrackDto, index: number) => {
            GridItem() {
              Column() {
                CoverImage({
                  path: track.cover,
                  imgWidth: this.itemWidth,
                  imgHeight: this.itemWidth,
                  radius: 8,
                  fallbackText: track.name,
                })
                Text(track.name)
                  .fontSize(13).fontWeight(FontWeight.Medium)
                  .fontColor(this.theme.colors.text).margin({ top: 8 })
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  .textAlign(TextAlign.Center).width(this.itemWidth)
                if (track.artist) {
                  Text(track.artist)
                    .fontSize(11).fontColor(this.theme.colors.textSecondary)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    .textAlign(TextAlign.Center).width(this.itemWidth)
                    .margin({ top: 2 })
                }
              }
              .alignItems(HorizontalAlign.Center)
              .onClick(() => {
                if (this.isSelectionMode) {
                  this.toggleTrackSelection(track.id);
                } else {
                  this.playFrom(index);
                }
              })
            }
          }, (track: TrackDto) => `${track.id}-v${this.listVersion}`)
        }
        .columnsTemplate(this.columnsTemplate).columnsGap(GAP).rowsGap(GAP)
        .padding({ left: 20, right: 20 })
        .width('100%')
        this.FooterBuilder(t('libraryPage.loadedTracks', [['count', this.tracks.length]]))
      }
      .width('100%').alignItems(HorizontalAlign.Start)
    }
    .width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
  }

  @Builder
  ArtistGridBuilder() {
    Scroll(this.artistScroller) {
      Column() {
        Grid() {
          ForEach(this.artists, (artist: ArtistDto) => {
            GridItem() {
              Column() {
                CoverImage({
                  path: artist.avatar,
                  imgWidth: this.itemWidth, imgHeight: this.itemWidth, radius: this.itemWidth / 2,
                  fallbackText: artist.name,
                })
                Text(artist.name)
                  .fontSize(14).fontColor(this.theme.colors.text).margin({ top: 8 })
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  .textAlign(TextAlign.Center).width(this.itemWidth)
              }
              .onClick(() => this.navigateToArtist(String(artist.id)))
            }
          }, (artist: ArtistDto) => `${artist.id}-v${this.listVersion}`)
        }
        .columnsTemplate(this.columnsTemplate).columnsGap(GAP).rowsGap(GAP)
        .padding({ left: 20, right: 20 })
        .width('100%').height(this.gridContentHeight(this.artists.length, this.artistBlockHeight()))
        this.FooterBuilder(t('libraryPage.loadedArtists', [['count', this.artists.length]]))
      }
      .width('100%').alignItems(HorizontalAlign.Start)
    }
    .width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
  }

  @Builder
  AlbumGridBuilder() {
    Scroll(this.albumScroller) {
      Column() {
        Grid() {
          ForEach(this.albums, (album: AlbumDto) => {
            GridItem() {
              Column() {
                Stack({ alignContent: Alignment.BottomStart }) {
                  CoverImage({
                    path: album.cover,
                    imgWidth: this.itemWidth, imgHeight: this.itemWidth, radius: 15,
                    fallbackText: album.name,
                  })
                  if (this.showAlbumProgress(album)) {
                    Row() {
                      Row()
                        .width((this.itemWidth - 6) * (album.progress ?? 0) / 100)
                        .height(4).borderRadius(2).backgroundColor(this.theme.colors.primary)
                    }
                    .width(this.itemWidth - 6).height(4)
                    .backgroundColor('rgba(255,255,255,0.3)')
                    .margin({ bottom: 5 })
                  }
                }
                .width(this.itemWidth).height(this.itemWidth)

                Text(album.name)
                  .fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.theme.colors.text)
                  .margin({ top: 8, bottom: 4 })
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width(this.itemWidth)
                Text(album.artist ?? '')
                  .fontSize(12).fontColor(this.theme.colors.textSecondary)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width(this.itemWidth)
              }
              .onClick(() => this.navigateToAlbum(String(album.id)))
            }
          }, (album: AlbumDto) => `${album.id}-v${this.listVersion}`)
        }
        .columnsTemplate(this.columnsTemplate).columnsGap(GAP).rowsGap(GAP)
        .padding({ left: 20, right: 20 })
        .width('100%').height(this.gridContentHeight(this.albums.length, this.albumBlockHeight()))
        this.FooterBuilder(t('libraryPage.loadedAlbums', [['count', this.albums.length]]))
      }
      .width('100%').alignItems(HorizontalAlign.Start)
    }
    .width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
  }

  @Builder
  CollectionGridBuilder() {
    Scroll(this.collectionScroller) {
      Column() {
        Grid() {
          ForEach(this.collections, (collection: CollectionDto) => {
            GridItem() {
              Column() {
                CoverImage({
                  path: this.collectionCover(collection),
                  imgWidth: this.itemWidth, imgHeight: this.itemWidth, radius: 15,
                  fallbackText: collection.name,
                })
                Text(collection.name)
                  .fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.theme.colors.text)
                  .margin({ top: 8, bottom: 4 })
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width(this.itemWidth)
                Text(t('libraryPage.artistAlbumCount', [['count', this.collectionCount(collection)]]))
                  .fontSize(12).fontColor(this.theme.colors.textSecondary)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width(this.itemWidth)
              }
              .onClick(() => this.navigateToCollection(String(collection.id)))
            }
          }, (collection: CollectionDto) => `${collection.id}-v${this.listVersion}`)
        }
        .columnsTemplate(this.columnsTemplate).columnsGap(GAP).rowsGap(GAP)
        .padding({ left: 20, right: 20 })
        .width('100%').height(this.gridContentHeight(this.collections.length, this.albumBlockHeight()))
        this.FooterBuilder(t('libraryPage.loadedCollections', [['count', this.collections.length]]))
      }
      .width('100%').alignItems(HorizontalAlign.Start)
    }
    .width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
  }

  @Builder
  MvGridBuilder() {
    Scroll(this.mvScroller) {
      Column() {
        Grid() {
          ForEach(this.mvs, (mv: MVDto) => {
            GridItem() {
              Column() {
                CoverImage({
                  path: mv.cover,
                  imgWidth: this.itemWidth, imgHeight: this.itemWidth, radius: 15,
                  fallbackText: mv.name,
                })
                Text(mv.name)
                  .fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.theme.colors.text)
                  .margin({ top: 8, bottom: 4 })
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width(this.itemWidth)
                Text(mv.artist ?? t('common.unknownArtist'))
                  .fontSize(12).fontColor(this.theme.colors.textSecondary)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width(this.itemWidth)
              }
              .onClick(() => this.navigateToMv(String(mv.id)))
            }
          }, (mv: MVDto) => `${mv.id}-v${this.listVersion}`)
        }
        .columnsTemplate(this.columnsTemplate).columnsGap(GAP).rowsGap(GAP)
        .padding({ left: 20, right: 20 })
        .width('100%').height(this.gridContentHeight(this.mvs.length, this.albumBlockHeight()))
        this.FooterBuilder(t('libraryPage.loadedMvs', [['count', this.mvs.length]]))
      }
      .width('100%').alignItems(HorizontalAlign.Start)
    }
    .width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
  }

  @Builder
  TabContentBuilder() {
    if (this.activeTab === 'songs' && this.mode === 'MUSIC') {
      // 修复 5：songs tab 根据 viewMode 选择 List / Grid
      if (this.viewMode === 'grid') {
        this.SongGridBuilder()
      } else {
        this.SongListBuilder()
      }
    } else if (this.activeTab === 'artists') {
      this.ArtistGridBuilder()
    } else if (this.activeTab === 'albums') {
      this.AlbumGridBuilder()
    } else if (this.activeTab === 'collections') {
      this.CollectionGridBuilder()
    } else {
      this.MvGridBuilder()
    }
  }

  @Builder
  ErrorBuilder() {
    Column({ space: 12 }) {
      Text(t('common.error')).fontSize(16).fontColor(this.theme.colors.text)
      Text(this.error).fontSize(12).fontColor(this.theme.colors.textSecondary)
        .maxLines(3).textAlign(TextAlign.Center)
      Button(t('common.retry'))
        .backgroundColor(this.theme.colors.primary).fontColor(this.theme.colors.onPrimary).borderRadius(18)
        .onClick(() => this.loadAllData())
    }
    .width('100%').height('100%').justifyContent(FlexAlign.Center).padding(24)
  }

  // 悬浮按钮组（对齐 mobile FloatingActionButtons：回顶/定位/心动/到底）
  @Builder
  FloatingButtonsBuilder() {
    Column({ space: 12 }) {
      Column() {
        AppIcon({ name: 'arrow-up', iconSize: 20, color: this.theme.colors.primary })
      }
      .width(38).height(38).borderRadius(19).backgroundColor(this.theme.colors.card)
      .justifyContent(FlexAlign.Center)
      .shadow({ radius: 8, color: '#33000000', offsetY: 2 })
      .onClick(() => this.scrollToTop())

      Column() {
        AppIcon({ name: 'locate', iconSize: 20, color: this.theme.colors.primary })
      }
      .width(38).height(38).borderRadius(19).backgroundColor(this.theme.colors.card)
      .justifyContent(FlexAlign.Center)
      .shadow({ radius: 8, color: '#33000000', offsetY: 2 })
      .opacity(this.locateDisabled() ? 0.3 : 1)
      .onClick(() => this.handleLocateCurrent())

      if (this.mode === 'MUSIC') {
        Column() {
          AppIcon({
            name: this.heartbeatModeActive ? 'heart-fill' : 'heart',
            iconSize: 20,
            color: this.heartbeatModeActive ? this.theme.colors.background : this.theme.colors.primary,
          })
        }
        .width(38).height(38).borderRadius(19)
        .backgroundColor(this.heartbeatModeActive ? this.theme.colors.primary : this.theme.colors.card)
        .justifyContent(FlexAlign.Center)
        .shadow({ radius: 8, color: '#33000000', offsetY: 2 })
        .onClick(() => this.toggleHeartbeat())
      }

      Column() {
        AppIcon({ name: 'arrow-down', iconSize: 20, color: this.theme.colors.primary })
      }
      .width(38).height(38).borderRadius(19).backgroundColor(this.theme.colors.card)
      .justifyContent(FlexAlign.Center)
      .shadow({ radius: 8, color: '#33000000', offsetY: 2 })
      .onClick(() => this.scrollToBottom())
    }
    .margin({ right: 20, bottom: 150 })
  }

  @Builder
  ContentSkeleton() {
    if (this.activeTab === 'songs') {
      Column() {
        ForEach(this.skRange(), (index: number) => {
          Row() {
            Row().width(48).height(48).borderRadius(8)
              .backgroundColor(this.theme.colors.border).margin({ right: 12 })
            Column() {
              Row().width(160).height(15).borderRadius(6)
                .backgroundColor(this.theme.colors.border).margin({ bottom: 8 })
              Row().width(120).height(12).borderRadius(6).backgroundColor(this.theme.colors.border)
            }
            .layoutWeight(1).alignItems(HorizontalAlign.Start)
          }
          .width('100%').padding({ top: 8, bottom: 8, left: 16, right: 16 })
        }, (index: number) => `sk-song-${index}`)
      }
      .width('100%').height('100%').alignItems(HorizontalAlign.Start)
    } else {
      Scroll() {
        Grid() {
          ForEach(this.skRange(), (index: number) => {
            GridItem() {
              Column() {
                Row().width(this.itemWidth).height(this.itemWidth)
                  .borderRadius(this.activeTab === 'artists' ? this.itemWidth / 2 : 15)
                  .backgroundColor(this.theme.colors.border)
                Row().width(this.itemWidth * 0.8).height(13).borderRadius(6)
                  .backgroundColor(this.theme.colors.border).margin({ top: 8 })
                if (this.skHasSub()) {
                  Row().width(this.itemWidth * 0.55).height(11).borderRadius(6)
                    .backgroundColor(this.theme.colors.border).margin({ top: 4 })
                }
              }
              .alignItems(HorizontalAlign.Start)
            }
          }, (index: number) => `sk-grid-${index}`)
        }
        .columnsTemplate(this.columnsTemplate).columnsGap(GAP).rowsGap(GAP)
        .padding({ left: 20, right: 20 })
        .width('100%').height(this.gridContentHeight(12, this.activeTab === 'artists' ? this.artistBlockHeight() : this.albumBlockHeight()))
      }
      .width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
    }
  }

  // 小爱音箱半模态（与 AlbumDetailPage.miCastSheet 一致）
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
                  if (!this.miCasting) this.handleCastTracksToMi(device.device_id, device.name);
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

  // 添加到播放列表半模态（与 PlayerPage.addToPlaylistSheet 一致，批量加入选中曲目）
  @Builder
  addToPlaylistSheet() {
    Column() {
      Text(t('playerMore.addToPlaylist'))
        .fontSize(16).fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 16 });
      List() {
        ForEach(this.playlists, (pl: PlaylistDto) => {
          ListItem() {
            Row() {
              Text(pl.name).fontSize(15).fontColor(this.theme.colors.text).layoutWeight(1)
              Text('›').fontSize(18).fontColor(this.theme.colors.textSecondary)
            }
            .width('100%').padding({ top: 14, bottom: 14, left: 20, right: 20 })
            .onClick(() => this.addSelectedToPlaylist(pl.id))
          }
        }, (pl: PlaylistDto) => pl.id)
      }
      .layoutWeight(1).scrollBar(BarState.Off)
    }
    .width('100%').height('100%').padding({ left: 4, right: 4 })
  }

  build() {
    // 语言切换时重建整页：条件读取 appLang 建立依赖（框架只追踪读取状态变量的表达式，
    // t() 是普通函数无法被追踪），语言变化使 if 分支切换，旧子树销毁、新子树重建，
    // 所有 t() 文案（含局部 @Builder 和 @Prop 传串的子组件）都按新语言重新求值。
    if (this.appLang === 'zh-CN') {
      this.LocalizedContent()
    } else {
      this.LocalizedContent()
    }
  }

  @Builder
  LocalizedContent() {
    Column() {
      this.HeaderBuilder()
      this.TabBarBuilder()
      if (this.isSelectionMode && this.activeTab === 'songs' && this.mode === 'MUSIC') {
        this.SelectionHeaderBuilder()
      }
      Stack({ alignContent: Alignment.BottomEnd }) {
        Refresh({ refreshing: $$this.refreshing }) {
          if (this.loading) {
            this.ContentSkeleton()
          } else if (this.error.length > 0) {
            this.ErrorBuilder()
          } else {
            this.TabContentBuilder()
          }
        }
        .onRefreshing(() => { this.onPullRefresh(); })
        if (this.showFloatingButtons() && !this.loading) {
          this.FloatingButtonsBuilder()
        }
      }
      .layoutWeight(1).width('100%')
    }
    .width('100%').height('100%').backgroundColor(this.theme.colors.background)
    .bindSheet($$this.showMiCast, this.miCastSheet(), { height: 420, dragBar: true })
    .bindSheet($$this.showAddToPlaylist, this.addToPlaylistSheet(), { height: 420, dragBar: true })
  }
}
