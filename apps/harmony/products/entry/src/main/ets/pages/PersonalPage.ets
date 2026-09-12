import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import picker from '@ohos.file.picker';
import { kvStore } from 'features_storage';
import { t } from 'features_i18n';
import { Logger } from 'audiodock_common';
import { playlistApi, userDataApi, plusApi, setPlusAuthToken, userApi, taskApi } from 'features_network';
import type { PlaylistDto, TrackDto, AlbumDto, ImportTask, ImportTaskMode } from 'features_network';
import { AppIcon, AppIconName } from '../components/AppIcon';
import { XiaoAiIcon } from '../components/XiaoAiIcon';
import { CoverImage } from '../components/CoverImage';
import { authStore } from '../context/AuthStore';
import { resolveTrackToPlayer } from '../services/trackResolver';
import { playerStore } from '../context/PlayerStore';
import type { Track } from '../context/PlayerStore';
import { getDownloadedTracks, removeDownloadedTrack } from '../services/downloadService';
import type { DownloadedMeta } from '../services/downloadService';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { jumpToAppMarket } from '../utils/browserUtils';

// ArkTS strict 拒绝内联对象字面量类型，所以用 class 显式表达
// "三态联合"，再用 `kind` 区分渲染。
class ListRow {
  kind: 'track' | 'album' | 'playlist' = 'track';
  track: TrackDto | null = null;
  album: AlbumDto | null = null;
  playlist: PlaylistDto | null = null;

  static fromTrack(item: TrackDto): ListRow {
    const r = new ListRow();
    r.kind = 'track';
    r.track = item;
    return r;
  }

  static fromAlbum(item: AlbumDto): ListRow {
    const r = new ListRow();
    r.kind = 'album';
    r.album = item;
    return r;
  }

  static fromPlaylist(item: PlaylistDto): ListRow {
    const r = new ListRow();
    r.kind = 'playlist';
    r.playlist = item;
    return r;
  }

  // 已下载曲目 → TrackDto（字段映射：trackId→id / title→name / coverUrl→cover）。
  // 保留 ext/type，供点击播放时 resolveTrackToPlayer 命中本地 FileCache。
  static fromDownloaded(m: DownloadedMeta): ListRow {
    const r = new ListRow();
    r.kind = 'track';
    const t: TrackDto = {
      id: m.trackId,
      name: m.title,
      artist: m.artist,
      album: m.album,
      duration: m.duration,
      cover: m.coverUrl,
      ext: m.ext,
      type: m.type,
    };
    r.track = t;
    return r;
  }

  name(): string {
    if (this.kind === 'track' && this.track) return this.track.name;
    if (this.kind === 'album' && this.album) return this.album.name;
    if (this.kind === 'playlist' && this.playlist) return this.playlist.name;
    return '';
  }

  cover(): string {
    if (this.kind === 'track' && this.track) return this.track.cover ?? '';
    if (this.kind === 'album' && this.album) return this.album.cover ?? '';
    if (this.kind === 'playlist' && this.playlist) return this.coverAt(0);
    return '';
  }

  /**
   * 歌单封面：后端 list 不返回顶层 cover，返回前 4 首曲目的 { id, cover }。
   * 取第 i 首的封面（对齐 mobile StackedCover 叠放不同封面）；
   * 不足 i+1 首时回退到第一首，保证堆叠层不为空。
   */
  coverAt(i: number): string {
    if (this.kind !== 'playlist' || !this.playlist) return '';
    const direct = this.playlist.cover ?? '';
    const ts = this.playlist.tracks ?? [];
    if (ts.length === 0) return direct;
    const idx = i < ts.length ? i : 0;
    const c = ts[idx].cover ?? '';
    return c !== '' ? c : direct;
  }

  subtitle(): string {
    if (this.kind === 'track' && this.track) {
      return `${this.track.artist ?? ''} · ${this.track.album ?? ''}`;
    }
    if (this.kind === 'album' && this.album) {
      return this.album.artist ?? '';
    }
    if (this.kind === 'playlist' && this.playlist) {
      // 对齐 mobile：_count.tracks 优先，兜底 tracks.length
      const n = this.playlist._count?.tracks ?? (this.playlist.tracks ?? []).length;
      return `${n} 首`;
    }
    return '';
  }
}

/** NavDestination 详情页 param：ArkTS 严格模式不允许内联对象字面量，必须显式类/接口 */
interface DetailNavParam {
  id: string;
}

class TabInfo {
  key: string = '';
  label: string = '';

  constructor(key: string, label: string) {
    this.key = key;
    this.label = label;
  }
}

@Component
export struct PersonalTab {
  // 路由栈由 RootShellPage 注入；进 NavDestination 内的页面用它，独立 Page 仍走 router.pushUrl
  pathStack: NavPathStack = new NavPathStack();
  // 车机模式详情页跳转回调：仅 carModeEnabled 时使用（右栏局部渲染），不进入全局路由
  carNavCallback?: (name: string, id: string) => void;
  // 与 MainPage 同源：车机模式开关，决定 onRowClick 走 carNavCallback 还是 pathStack
  @StorageLink('carModeEnabled') carModeEnabled: boolean = false;
  // 内容模式由 AppStorage 全局同步（对齐 mobile usePlayMode）：设置页/首页/声仓
  // 任一处切换有声书模式，本页经 @Watch 实时重载列表与菜单（TTS 入口等）。
  @StorageLink('playMode') @Watch('onModeChange') mode: string = 'MUSIC';
  // 与 AuthStore.SourceType / SOURCEMAP / kvStore 写入端保持一致（全小写）
  @State sourceType: string = 'audiodock';
  @State activeTab: string = 'playlists';
  @State activeSubTab: string = 'album';
  @State loading: boolean = true;
  @State error: string = '';
  @State username: string = '';
  @State avatar: string = '';
  @State userId: string = '';
  @State rows: ListRow[] = [];
  @State menuVisible: boolean = false;
  @State createModalVisible: boolean = false;
  @State newPlaylistName: string = '';
  @State creating: boolean = false;
  @State isPlusVip: boolean = false;
  // 会员体系登录态（plus_token 是否存在），驱动皇冠三段显隐：
  // 未登录 → 展示灰色皇冠引导会员登录；已登录会员 → 金色皇冠；已登录非会员 → 隐藏。
  @State isPlusLoggedIn: boolean = false;
  // 库导入进度 modal 相关
  @State importModalVisible: boolean = false;
  @State importTask: ImportTask | null = null;
  // 头像上传 loading
  @State uploadingAvatar: boolean = false;
  // 是否有进行中的库导入任务（控制 header 任务中心入口显隐）
  @State hasActiveImportTask: boolean = false;
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @StorageProp('appLang') appLang: string = 'zh-CN';
  @State theme: Theme = buildTheme('light');

  // 内部状态：定时器 id（不需要响应式）
  private pollTimerId: number | null = null;
  private tasksPollTimerId: number | null = null;

  aboutToAppear() {
    this.theme = buildTheme(this.themeMode);
    this.initData();
  }

  aboutToDisappear() {
    this.clearPollTimer();
    this.clearTasksPollTimer();
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  // @Watch('onModeChange')：设置页/首页/声仓切换内容模式都会触发，
  // 立即重载当前 tab 数据，让 TTS 入口等依赖 mode 的菜单/列表实时刷新。
  async onModeChange(): Promise<void> {
    await this.loadData();
  }

  async initData(): Promise<void> {
    const user = authStore.state_.user;
    this.userId = user?.id ?? '';
    this.username = user?.username ?? '';
    this.avatar = user?.avatar ?? '';
    try {
      const savedSource = await kvStore.get('selectedSourceType');
      // 防御性 toLowerCase：与 SourceManagePage.ets:223 / LoginPage.ets:203 写入端保持一致
      if (savedSource) this.sourceType = savedSource.toLowerCase();
    } catch (e) {
      Logger.w('PersonalTab', `read storage failed: ${String(e)}`);
    }
    await this.loadData();
    this.loadVipStatus();
    this.checkRunningImportTask();
    this.startTasksPoll();
  }

  private async loadVipStatus(): Promise<void> {
    try {
      const plusToken = await kvStore.get('plus_token');
      this.isPlusLoggedIn = !!plusToken && plusToken.length > 0;
      const plusUserId = await kvStore.get('plus_user_id');
      if (plusUserId !== null && plusUserId.length > 0) {
        if (plusToken) setPlusAuthToken(plusToken);
        const profile = await plusApi.getMe(plusUserId);
        this.isPlusVip = !!profile.vipTier && profile.vipTier !== 'NONE';
      }
    } catch (e) {
      Logger.w('PersonalTab', `loadVipStatus failed: ${String(e)}`);
    }
  }

  async loadData(): Promise<void> {
    this.loading = true;
    this.error = '';
    if (this.activeTab === 'downloads') {
      try {
        const metas: DownloadedMeta[] = await getDownloadedTracks();
        // 按内容模式过滤（对齐 mobile personal.tsx L479 tracks.filter(t => t.type === mode)）；
        // type 缺失的历史数据兜底全显示。
        const filtered: DownloadedMeta[] = metas.filter(
          (m: DownloadedMeta): boolean => !m.type || m.type === this.mode
        );
        const rows: ListRow[] = [];
        for (const m of filtered) rows.push(ListRow.fromDownloaded(m));
        this.rows = rows;
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
        Logger.e('PersonalTab', `load downloads failed: ${this.error}`);
      } finally {
        this.loading = false;
      }
      return;
    }
    if (this.userId.length === 0) {
      this.rows = [];
      this.loading = false;
      return;
    }
    try {
      if (this.activeTab === 'playlists') {
        const list = await playlistApi.list(this.mode);
        const rows: ListRow[] = [];
        for (const p of list) rows.push(ListRow.fromPlaylist(p));
        this.rows = rows;
      } else if (this.activeTab === 'favorites') {
        if (this.activeSubTab === 'track') {
          const res = await userDataApi.likedTracks({ pageSize: 100, loadCount: 0, type: this.mode });
          const rows: ListRow[] = [];
          for (const it of res.list) {
            if (it.track) rows.push(ListRow.fromTrack(it.track));
          }
          this.rows = rows;
        } else {
          const res = await userDataApi.likedAlbums({ pageSize: 100, loadCount: 0, type: this.mode });
          const rows: ListRow[] = [];
          for (const it of res.list) {
            if (it.album) rows.push(ListRow.fromAlbum(it.album));
          }
          this.rows = rows;
        }
      } else if (this.activeTab === 'history') {
        if (this.activeSubTab === 'track') {
          const res = await userDataApi.trackHistory({ pageSize: 100, loadCount: 0, type: this.mode });
          const rows: ListRow[] = [];
          for (const it of res.list) {
            if (it.track) rows.push(ListRow.fromTrack(it.track));
          }
          this.rows = rows;
        } else {
          const res = await userDataApi.albumHistory({ pageSize: 100, loadCount: 0, type: this.mode });
          const rows: ListRow[] = [];
          for (const it of res.list) {
            if (it.album) rows.push(ListRow.fromAlbum(it.album));
          }
          this.rows = rows;
        }
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      Logger.e('PersonalTab', `load failed: ${this.error}`);
    } finally {
      this.loading = false;
    }
  }

  switchTab(tab: string): void {
    this.activeTab = tab;
    this.loadData();
  }

  switchSubTab(tab: string): void {
    this.activeSubTab = tab;
    this.loadData();
  }

  navigateToSettings(): void {
    router.pushUrl({ url: 'pages/SettingsPage' });
  }

  navigateToSourceManage(): void {
    router.pushUrl({ url: 'pages/SourceManagePage' });
  }

  navigateToMiSpeaker(): void {
    router.pushUrl({ url: 'pages/MiSpeakerPage' });
  }

  openMenu(): void {
    this.menuVisible = true;
  }

  closeMenu(): void {
    this.menuVisible = false;
  }

  closeCreateModal(): void {
    this.createModalVisible = false;
    this.newPlaylistName = '';
  }

  // TTS 已接入；其它需要后端任务系统的功能（任务中心页、scanner 入口等）按需降级。
  handleMenuAction(action: string): void {
    this.menuVisible = false;
    if (action === 'createPlaylist') {
      this.createModalVisible = true;
      return;
    }
    if (action === 'openStoreDebug') {
      this.jumpToAppMarketDebug();
      return;
    }
    if (action === 'tts') {
      this.openTtsTasks();
      return;
    }
    if (action === 'incremental') {
      this.handleUpdateLibrary('incremental');
      return;
    }
    if (action === 'full') {
      this.handleUpdateLibrary('full');
      return;
    }
    if (action === 'compact') {
      this.handleUpdateLibrary('compact');
      return;
    }
    promptAction.showToast({ message: '该功能暂未在鸿蒙端开放' });
  }

  /**
   * 调起华为 AppGallery 跳转到本应用详情页（复用 browserUtils.jumpToAppMarket）。
   *
   * 方案：
   *   1. 优先用 `appmarket://` scheme + bundleName 直接拉起 AppGallery
   *   2. 失败 → 兜底 `ohos.want.action.viewData` 打开 AppGallery web URL，
   *      让系统根据已注册的 deep link 路由
   *   3. 全失败 → 打日志，不抛异常
   *
   * 备注：appId 暂用 PLACEHOLDER，等上架后替换（browserUtils 内维护）。
   */
  jumpToAppMarketDebug(): void {
    jumpToAppMarket(getContext(this));
  }

  // 对齐 mobile handleOpenTtsTasks：校验会员登录与 VIP 状态后进入 TTS 任务列表。
  async openTtsTasks(): Promise<void> {
    const plusToken = await kvStore.get('plus_token');
    if (!plusToken) {
      promptAction.showDialog({
        title: t('common.memberFeature'),
        message: t('common.loginFirst'),
        buttons: [
          { text: t('common.cancel'), color: this.theme.colors.textSecondary },
          { text: t('personalPage.memberLogin'), color: this.theme.colors.primary },
        ],
      }).then((res) => {
        if (res.index === 1) {
          router.pushUrl({ url: 'pages/MemberLoginPage' });
        }
      });
      return;
    }
    if (this.isPlusVip) {
      router.pushUrl({ url: 'pages/TtsTaskListPage' });
      return;
    }
    // [软下线] 去开通入口已隐藏，仅保留会员功能提示。恢复时还原 goActivate 按钮与跳 MemberBenefitsPage 的 then 分支。
    promptAction.showDialog({
      title: t('common.memberFeature'),
      message: t('common.ttsVipRequired'),
      buttons: [
        { text: t('common.cancel'), color: this.theme.colors.textSecondary },
      ],
    });
  }

  // 扫码登录入口：VIP 校验 + 跳转 ScanPage
  async handleOpenScanEntry(): Promise<void> {
    const plusToken = await kvStore.get('plus_token');
    if (!plusToken) {
      promptAction.showDialog({
        title: t('personalPage.memberOnlyTitle'),
        message: t('personalPage.scanLoginMemberOnly'),
        buttons: [
          { text: t('common.cancel'), color: this.theme.colors.textSecondary },
          { text: t('personalPage.memberLogin'), color: this.theme.colors.primary },
        ],
      }).then((res) => {
        if (res.index === 1) {
          router.pushUrl({ url: 'pages/MemberLoginPage' });
        }
      });
      return;
    }
    if (this.isPlusVip) {
      router.pushUrl({ url: 'pages/ScanPage' });
      return;
    }
    // [软下线] 去开通入口已隐藏，仅保留会员功能提示。恢复时还原 goActivate 按钮与跳 MemberBenefitsPage 的 then 分支。
    promptAction.showDialog({
      title: t('personalPage.memberOnlyTitle'),
      message: t('personalPage.scanLoginVipRequired'),
      buttons: [
        { text: t('common.cancel'), color: this.theme.colors.textSecondary },
      ],
    });
  }

  // 任务中心入口：目前还没有 TaskCenterPage，提示后续接入
  handleOpenTaskCenter(): void {
    promptAction.showToast({ message: t('personalPage.taskCenterNotAvailable') });
  }

  canCreate(): boolean {
    return this.newPlaylistName.trim().length > 0 && !this.creating;
  }

  async handleCreatePlaylist(): Promise<void> {
    const name = this.newPlaylistName.trim();
    if (name.length === 0 || this.creating) return;
    this.creating = true;
    try {
      await playlistApi.create(name, this.mode);
      promptAction.showToast({ message: t('playlist.createSuccess') });
      this.createModalVisible = false;
      this.newPlaylistName = '';
      await this.loadData();
    } catch (e) {
      promptAction.showToast({ message: t('personal.createFailed') });
      Logger.e('PersonalTab', `create playlist failed: ${String(e)}`);
    } finally {
      this.creating = false;
    }
  }

  // 头像更换：photoAccessHelper 选择图片 → userApi.uploadAvatar(multipart) → 更新本地 + 后端
  async onAvatarClick(): Promise<void> {
    if (this.uploadingAvatar) return;
    // sourceType 全小写比对，与 AuthStore.SourceType / kvStore 写入端对齐
    // 历史 bug：默认值与判断曾用 'AudioDock' 大写，与实际存储 'audiodock' 不一致，导致头像永远走错误分支
    if (this.sourceType !== 'audiodock') {
      promptAction.showDialog({
        title: t('personalPage.updateFailed'),
        message: t('personalPage.avatarUnsupported'),
        buttons: [
          { text: t('common.ok'), color: this.theme.colors.textSecondary },
        ],
      });
      return;
    }
    const userId = authStore.state_.user?.id;
    if (!userId) return;
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
      Logger.w('PersonalTab', `pick avatar failed: ${String(e)}`);
      promptAction.showToast({ message: t('personalPage.uploadAvatarFailed') });
      return;
    }
    if (uris.length === 0) return;
    const uri = uris[0];
    try {
      this.uploadingAvatar = true;
      const res = await userApi.uploadAvatar(String(userId), uri, 'image/jpeg');
      const nextAvatar: string =
        (res.avatar !== undefined && res.avatar.length > 0 ? res.avatar : (res.url ?? uri.split('/').pop() ?? ''));
      // 更新本组件显示
      this.avatar = nextAvatar;
      // 更新 authStore（内存 + 落盘 kvStore + 通知订阅者），对齐 mobile 上传后写 AsyncStorage user_{baseUrl}
      await authStore.updateAvatar(nextAvatar);
    } catch (e) {
      Logger.e('PersonalTab', `upload avatar failed: ${String(e)}`);
      promptAction.showDialog({
        title: t('personalPage.updateFailed'),
        message: t('personalPage.uploadAvatarFailed'),
        buttons: [
          { text: t('common.ok'), color: this.theme.colors.textSecondary },
        ],
      });
    } finally {
      this.uploadingAvatar = false;
    }
  }

  // 会员入口：点击用户名旁皇冠图标跳转。
  // 三段逻辑：未登录会员体系 → 引导会员登录页；已登录会员 → 会员详情页；
  // 已登录非会员 → 皇冠已隐藏不可达（防御性保留注释）。
  // [软下线] 非会员跳 MemberBenefitsPage（去开通）的分支已移除，恢复时参考 git 历史。
  async onCrownClick(): Promise<void> {
    if (!this.isPlusLoggedIn) {
      router.pushUrl({ url: 'pages/MemberLoginPage' });
      return;
    }
    if (this.isPlusVip) {
      router.pushUrl({ url: 'pages/MemberDetailPage' });
    }
  }

  getTabs(): TabInfo[] {
    const tabs: TabInfo[] = [
      new TabInfo('playlists', t('personal.playlists')),
      new TabInfo('favorites', t('personal.favorites')),
    ];
    if (this.sourceType !== 'Emby') {
      tabs.push(new TabInfo('history', t('personal.history')));
    }
    tabs.push(new TabInfo('downloads', t('personalPage.downloads')));
    return tabs;
  }

  private rowKey(row: ListRow, idx: number): string {
    if (row.kind === 'track' && row.track) return `t-${row.track.id}`;
    if (row.kind === 'album' && row.album) return `a-${row.album.id}`;
    if (row.kind === 'playlist' && row.playlist) return `p-${row.playlist.id}`;
    return `r-${idx}`;
  }

  private onRowClick(row: ListRow): void {
    if (row.kind === 'playlist' && row.playlist) {
      const id = String(row.playlist.id);
      // 车机模式才走右栏局部渲染；普通模式必须 pushPath 进全局路由。
      // carNavCallback 由 MainPage 无条件注入，不能用它本身当开关（否则手机端点击无反应）。
      if (this.carModeEnabled && this.carNavCallback) {
        this.carNavCallback('PlaylistDetail', id);
      } else {
        const param: DetailNavParam = { id: id };
        this.pathStack.pushPath({ name: 'PlaylistDetail', param: param });
      }
    } else if (row.kind === 'album' && row.album) {
      const id = String(row.album.id);
      if (this.carModeEnabled && this.carNavCallback) {
        this.carNavCallback('AlbumDetail', id);
      } else {
        const param: DetailNavParam = { id: id };
        this.pathStack.pushPath({ name: 'AlbumDetail', param: param });
      }
    } else if (row.kind === 'track' && row.track) {
      this.playTrackRow(row);
    }
  }

  private async playTrackRow(row: ListRow): Promise<void> {
    if (!row.track) return;
    try {
      const queue: TrackDto[] = [];
      for (const r of this.rows) {
        if (r.kind === 'track' && r.track) queue.push(r.track);
      }
      const list: Track[] = [];
      for (const item of queue) list.push(await resolveTrackToPlayer(item, false));
      let idx = 0;
      const targetId = row.track.id;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].id === targetId) { idx = i; break; }
      }
      await playerStore.playTrackList(list, idx);
      // 不再自动打开播放详情页：播放交给 MiniPlayer，用户点 MiniPlayer 再进详情
    } catch (e) {
      Logger.w('PersonalTab', `playTrack failed: ${String(e)}`);
    }
  }

  // 下载 tab 长按删除（对齐 mobile handleDeleteDownload）：
  // 确认框 → removeDownloadedTrack → 重新加载列表。
  private handleDeleteDownload(row: ListRow): void {
    if (!row.track) return;
    const trackId: string = row.track.id;
    promptAction.showDialog({
      title: t('personalPage.deleteDownloadTitle'),
      message: t('personalPage.deleteDownloadMessage'),
      buttons: [
        { text: t('common.cancel'), color: this.theme.colors.textSecondary },
        { text: t('common.delete'), color: '#FF3B30' },
      ],
    }).then((res): void => {
      if (res.index === 1) {
        removeDownloadedTrack(trackId)
          .then((): Promise<void> => this.loadData())
          .catch((e: Error): void => {
            Logger.w('PersonalTab', `remove downloaded track failed: ${String(e)}`);
          });
      }
    });
  }

  // ─────────────── 库导入（增量/全量/精简） ───────────────

  private async checkRunningImportTask(): Promise<void> {
    try {
      const running = await taskApi.getRunningImportTask();
      if (running !== null) {
        this.importTask = running;
        this.importModalVisible = true;
        this.startPoll(running.id);
      }
    } catch (e) {
      Logger.w('PersonalTab', `checkRunningImportTask failed: ${String(e)}`);
    }
  }

  private startTasksPoll(): void {
    this.clearTasksPollTimer();
    const tick = async (): Promise<void> => {
      try {
        const active = await taskApi.hasActiveImportTasks();
        this.hasActiveImportTask = active;
      } catch {
        // ignore 单次失败，下一轮再查
      }
    };
    tick();
    this.tasksPollTimerId = setInterval((): void => { tick(); }, 3000);
  }

  private clearTasksPollTimer(): void {
    if (this.tasksPollTimerId !== null) {
      clearInterval(this.tasksPollTimerId);
      this.tasksPollTimerId = null;
    }
  }

  private handleUpdateLibrary(mode: ImportTaskMode): void {
    let title = '';
    let message = '';
    let action = t('personalPage.confirmUpdateAction');
    if (mode === 'compact') {
      title = t('personalPage.confirmCompactTitle');
      message = t('personalPage.confirmCompactContent');
      action = t('personalPage.confirmCompactAction');
    } else if (mode === 'full') {
      title = t('personalPage.confirmFullTitle');
      message = t('personalPage.confirmFullContent');
    } else {
      title = t('personalPage.confirmIncrementalTitle');
      message = t('personalPage.confirmIncrementalContent');
    }
    promptAction.showDialog({
      title,
      message,
      buttons: [
        { text: t('common.cancel'), color: this.theme.colors.textSecondary },
        { text: action, color: this.theme.colors.primary },
      ],
    }).then((res): void => {
      if (res.index === 1) {
        this.startImportTask(mode);
      }
    });
  }

  private async startImportTask(mode: ImportTaskMode): Promise<void> {
    try {
      const resp = mode === 'compact'
        ? await taskApi.createCompactTask()
        : await taskApi.createImportTask({ mode });
      this.importTask = {
        id: resp.id,
        status: 'INITIALIZING',
        mode,
        message: mode === 'compact' ? t('personalPage.taskStartCompact') : t('personalPage.taskInit'),
      };
      this.importModalVisible = true;
      this.hasActiveImportTask = true;
      this.startPoll(resp.id);
    } catch (e) {
      Logger.e('PersonalTab', `startImportTask(${mode}) failed: ${String(e)}`);
      promptAction.showDialog({
        title: t('common.error'),
        message: t('personalPage.taskCreateFailedHint'),
        buttons: [
          { text: t('common.ok'), color: this.theme.colors.textSecondary },
        ],
      });
    }
  }

  private startPoll(taskId: string): void {
    this.clearPollTimer();
    const tick = async (): Promise<void> => {
      try {
        const task = await taskApi.getImportTask(taskId);
        this.importTask = task;
        if (task.status === 'SUCCESS') {
          this.clearPollTimer();
          this.hasActiveImportTask = false;
          setTimeout((): void => {
            this.importModalVisible = false;
            this.loadData();
          }, 1500);
        } else if (task.status === 'FAILED') {
          this.clearPollTimer();
          this.hasActiveImportTask = false;
        }
      } catch (e) {
        Logger.w('PersonalTab', `poll failed: ${String(e)}`);
      }
    };
    tick();
    this.pollTimerId = setInterval((): void => { tick(); }, 1000);
  }

  private clearPollTimer(): void {
    if (this.pollTimerId !== null) {
      clearInterval(this.pollTimerId);
      this.pollTimerId = null;
    }
  }

  private closeImportModal(): void {
    this.importModalVisible = false;
    this.clearPollTimer();
  }

  // ─────────────── Build helpers ───────────────

  @Builder
  HeaderBuilder() {
    Row() {
      Button() {
        AppIcon({ name: 'plus', iconSize: 26, color: this.theme.colors.text })
      }
      .width(36).height(36).backgroundColor(Color.Transparent)
      .onClick((): void => this.openMenu())

      Row() {
        Button() {
          AppIcon({ name: 'scan', iconSize: 22, color: this.theme.colors.text })
        }
        .width(36).height(36).backgroundColor(Color.Transparent).margin({ right: 4 })
        .onClick((): void => { this.handleOpenScanEntry(); })

        if (this.hasActiveImportTask) {
          Button() {
            AppIcon({ name: 'list-outline', iconSize: 22, color: this.theme.colors.text })
          }
          .width(36).height(36).backgroundColor(Color.Transparent).margin({ right: 4 })
          .onClick((): void => { this.handleOpenTaskCenter(); })
        }

        Button() {
          AppIcon({ name: 'server-outline', iconSize: 22, color: this.theme.colors.text })
        }
        .width(36).height(36).backgroundColor(Color.Transparent).margin({ right: 8 })
        .onClick((): void => this.navigateToSourceManage())

        Button() {
          XiaoAiIcon({ iconSize: 22, color: this.theme.colors.text })
        }
        .width(36).height(36).backgroundColor(Color.Transparent).margin({ right: 8 })
        .onClick((): void => this.navigateToMiSpeaker())

        Button() {
          AppIcon({ name: 'settings-outline', iconSize: 22, color: this.theme.colors.text })
        }
        .width(36).height(36).backgroundColor(Color.Transparent)
        .onClick((): void => this.navigateToSettings())
      }
      .alignItems(VerticalAlign.Center)
    }
    .width('100%').height(50)
    .padding({ left: 20, right: 20 })
    .justifyContent(FlexAlign.SpaceBetween).alignItems(VerticalAlign.Center)
  }

  @Builder
  UserInfoBuilder() {
    Column() {
      Stack({ alignContent: Alignment.BottomEnd }) {
        if (this.uploadingAvatar) {
          Stack({ alignContent: Alignment.Center }) {
            LoadingProgress().width(32).height(32).color(this.theme.colors.primary)
          }
          .width(80).height(80).borderRadius(40)
          .backgroundColor(this.theme.colors.surface)
        } else {
          CoverImage({
            path: this.avatar,
            imgWidth: 80, imgHeight: 80, radius: 40,
            fallbackText: this.username || '?',
          })
        }
        Stack({ alignContent: Alignment.Center }) {
          AppIcon({ name: 'camera', iconSize: 14, color: this.theme.colors.text })
        }
        .width(24).height(24).borderRadius(12)
        .backgroundColor(this.theme.colors.surface)
        .border({ width: 1, color: 'rgba(0,0,0,0.1)' })
      }
      .width(80).height(80).margin({ bottom: 15 })
      .onClick((): void => { this.onAvatarClick(); })

      Row() {
        Text(this.username || t('common.notLoggedIn'))
          .fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
        // 皇冠三段逻辑：未登录会员体系 → 灰色皇冠（点击引导会员登录）；
        // 已登录会员 → 金色皇冠（点击进会员权益页）；已登录非会员 → 隐藏。
        if (this.isPlusVip || !this.isPlusLoggedIn) {
          AppIcon({ name: 'crown', iconSize: 24, color: this.isPlusVip ? '#FFD700' : this.theme.colors.textSecondary })
            .margin({ left: 8 })
            .onClick((): void => { this.onCrownClick(); })
        }
      }
      .alignItems(VerticalAlign.Center)
    }
    .width('100%').alignItems(HorizontalAlign.Center).padding({ top: 8, bottom: 16 })
  }

  @Builder
  TabBarBuilder() {
    Row() {
      ForEach(this.getTabs(), (tab: TabInfo) => {
        Column() {
          Text(tab.label)
            .fontSize(16)
            .fontWeight(this.activeTab === tab.key ? FontWeight.Bold : FontWeight.Normal)
            .fontColor(this.activeTab === tab.key ? this.theme.colors.primary : this.theme.colors.textSecondary)
        }
        .layoutWeight(1).alignItems(HorizontalAlign.Center)
        .padding({ top: 15, bottom: 15 })
        .border({
          width: { bottom: this.activeTab === tab.key ? 2 : 0 },
          color: this.theme.colors.primary,
        })
        .onClick((): void => this.switchTab(tab.key))
      }, (tab: TabInfo) => tab.key)
    }
    .width('100%')
    .padding({ left: 20, right: 20 })
    .border({ width: { bottom: 1 }, color: this.theme.colors.border })
  }

  @Builder
  SubTabBuilder() {
    if (this.activeTab === 'favorites' || this.activeTab === 'history') {
      Row({ space: 12 }) {
        Row() {
          Text(t('personal.album'))
            .fontSize(14)
            .fontWeight(this.activeSubTab === 'album' ? FontWeight.Bold : FontWeight.Normal)
            .fontColor(this.activeSubTab === 'album' ? this.theme.colors.primary : this.theme.colors.textSecondary)
        }
        .padding({ left: 16, right: 16, top: 6, bottom: 6 }).borderRadius(20)
        .backgroundColor(Color.Transparent)
        .onClick((): void => this.switchSubTab('album'))

        if (this.mode !== 'AUDIOBOOK') {
          Row() {
            Text(t('personal.track'))
              .fontSize(14)
              .fontWeight(this.activeSubTab === 'track' ? FontWeight.Bold : FontWeight.Normal)
              .fontColor(this.activeSubTab === 'track' ? this.theme.colors.primary : this.theme.colors.textSecondary)
          }
          .padding({ left: 16, right: 16, top: 6, bottom: 6 }).borderRadius(20)
          .backgroundColor(Color.Transparent)
          .onClick((): void => this.switchSubTab('track'))
        }
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 10, bottom: 10 })
      .justifyContent(FlexAlign.Start)
    }
  }

  @Builder
  ListRowBuilder(row: ListRow) {
    Row() {
      if (row.kind === 'playlist') {
        // 堆叠封面：对齐 mobile StackedCover 视觉（每层用不同曲目封面，不足时回退第一张）
        Stack({ alignContent: Alignment.TopStart }) {
          CoverImage({
            path: row.coverAt(2),
            imgWidth: 50, imgHeight: 50, radius: 8,
            fallbackText: row.name(),
          })
            .offset({ x: 12, y: 6 })
            .opacity(0.7)
            .scale({ x: 0.92, y: 0.92 })
          CoverImage({
            path: row.coverAt(1),
            imgWidth: 50, imgHeight: 50, radius: 8,
            fallbackText: row.name(),
          })
            .offset({ x: 6, y: 3 })
            .opacity(0.85)
            .scale({ x: 0.96, y: 0.96 })
          CoverImage({
            path: row.coverAt(0),
            imgWidth: 50, imgHeight: 50, radius: 8,
            fallbackText: row.name(),
          })
        }
        .width(62).height(56)
        .margin({ right: 15 })
      } else {
        CoverImage({
          path: row.cover(),
          imgWidth: 50, imgHeight: 50, radius: 8,
          fallbackText: row.name(),
        }).margin({ right: 15 })
      }

      Column() {
        Text(row.name())
          .fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.theme.colors.text)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })

        Text(row.subtitle())
          .fontSize(13).fontColor(this.theme.colors.textSecondary).margin({ top: 4 })
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1).alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .padding(15).alignItems(VerticalAlign.Center)
    .border({ width: { bottom: 0.5 }, color: this.theme.colors.border })
    .onClick((): void => this.onRowClick(row))
    .gesture(
      LongPressGesture({ repeat: false })
        .onAction((event: GestureEvent): void => {
          if (this.activeTab === 'downloads') this.handleDeleteDownload(row);
        })
    )
  }

  @Builder
  LoadingSkeleton() {
    Column() {
      ForEach([1, 2, 3, 4, 5, 6, 7, 8], (index: number) => {
        Row() {
          Row().width(50).height(50).borderRadius(8)
            .backgroundColor(this.theme.colors.border).margin({ right: 15 })
          Column() {
            Row().width(150).height(16).borderRadius(8)
              .backgroundColor(this.theme.colors.border).margin({ bottom: 8 })
            Row().width(92).height(13).borderRadius(6).backgroundColor(this.theme.colors.border)
          }
          .layoutWeight(1).alignItems(HorizontalAlign.Start)
        }
        .width('100%').padding(15)
      }, (index: number) => `psk-${index}`)
    }
    .width('100%').layoutWeight(1).alignItems(HorizontalAlign.Start)
  }

  @Builder
  EmptyState() {
    Column() {
      Text(t('common.noData')).fontSize(14).fontColor(this.theme.colors.textSecondary).margin({ top: 40 })
    }
    .width('100%').layoutWeight(1).alignItems(HorizontalAlign.Center)
  }

  @Builder
  ErrorState() {
    Column({ space: 12 }) {
      Text(t('common.error')).fontSize(16).fontColor(this.theme.colors.text)
      Text(this.error).fontSize(12).fontColor(this.theme.colors.textSecondary)
        .maxLines(3).textAlign(TextAlign.Center)
      Button(t('common.retry'))
        .backgroundColor(this.theme.colors.primary).fontColor(this.theme.colors.onPrimary).borderRadius(18)
        .onClick((): void => { this.loadData(); })
    }
    .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center).padding(24)
  }

  @Builder
  MenuItemBuilder(icon: AppIconName, label: string, action: string) {
    Row() {
      AppIcon({ name: icon, iconSize: 22, color: this.theme.colors.text }).margin({ right: 12 })
      Text(label).fontSize(16).fontColor(this.theme.colors.text)
    }
    .width('100%')
    .padding({ top: 12, bottom: 12, left: 16, right: 16 })
    .alignItems(VerticalAlign.Center)
    .onClick((): void => this.handleMenuAction(action))
  }

  @Builder
  MenuDivider() {
    Row().width('100%').height(1).backgroundColor(this.theme.colors.border)
  }

  @Builder
  MenuOverlay() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%').height('100%')
        .backgroundColor('rgba(0,0,0,0.4)')
        .onClick((): void => this.closeMenu())

      Column() {
        this.MenuItemBuilder('playlist', t('personal.createPlaylist'), 'createPlaylist')
        this.MenuDivider()
        this.MenuItemBuilder('arrow-clockwise', t('personal.incrementalUpdate'), 'incremental')
        this.MenuDivider()
        this.MenuItemBuilder('repeat', t('personal.fullUpdate'), 'full')
        // [软下线] 非会员隐藏 TTS 有声书入口：菜单项增加 isPlusVip 判断。恢复时去掉 && this.isPlusVip 即可。
        if (this.sourceType !== 'Emby' && this.mode !== 'MUSIC' && this.isPlusVip) {
          this.MenuDivider()
          this.MenuItemBuilder('headphones', t('personal.ttsConversion'), 'tts')
        }
        this.MenuDivider()
        this.MenuItemBuilder('folder', t('personal.compactData'), 'compact')
        this.MenuDivider()
        // 评价入口：拉起华为 AppGallery 跳转到本应用详情页，方便用户打分评论。
        this.MenuItemBuilder('gear', t('personal.rateApp'), 'openStoreDebug')
      }
      .width(220)
      .backgroundColor(this.theme.colors.surface).borderRadius(12)
      .padding({ top: 8, bottom: 8 })
    }
    .width('100%').height('100%')
  }

  @Builder
  CreateModalOverlay() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%').height('100%')
        .backgroundColor('rgba(0,0,0,0.4)')
        .onClick((): void => this.closeCreateModal())

      Column() {
        Text(t('playlist.newPlaylist'))
          .fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
          .textAlign(TextAlign.Center).width('100%').margin({ bottom: 20 })

        TextInput({ placeholder: t('playlist.namePlaceholder'), text: this.newPlaylistName })
          .placeholderColor(this.theme.colors.textSecondary)
          .fontColor(this.theme.colors.text)
          .fontSize(16)
          .backgroundColor(this.theme.colors.background)
          .borderRadius(12).border({ width: 1, color: this.theme.colors.border })
          .height(48).margin({ bottom: 24 })
          .onChange((value: string): void => { this.newPlaylistName = value; })

        Row({ space: 12 }) {
          Row() {
            Text(t('common.cancel')).fontSize(16).fontColor(this.theme.colors.textSecondary)
          }
          .padding({ top: 10, bottom: 10, left: 20, right: 20 })
          .onClick((): void => this.closeCreateModal())

          Row() {
            if (this.creating) {
              LoadingProgress().width(20).height(20).color(this.theme.colors.onPrimary)
            } else {
              Text(t('common.confirm'))
                .fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.onPrimary)
            }
          }
          .padding({ top: 10, bottom: 10, left: 24, right: 24 }).borderRadius(10)
          .backgroundColor(this.theme.colors.primary)
          .opacity(this.canCreate() ? 1 : 0.5)
          .onClick((): void => { this.handleCreatePlaylist(); })
        }
        .width('100%').justifyContent(FlexAlign.End)
      }
      .width('80%')
      .backgroundColor(this.theme.colors.surface).borderRadius(20).padding(24)
    }
    .width('100%').height('100%')
  }

  @Builder
  ImportProgressOverlay() {
    if (this.importTask !== null) {
      Stack({ alignContent: Alignment.Center }) {
        Column()
          .width('100%').height('100%')
          .backgroundColor('rgba(0,0,0,0.4)')
          .onClick((): void => { this.closeImportModal(); })

        Column() {
          Text(t('personalPage.taskImportProgress'))
            .fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
            .margin({ bottom: 16 })

          // 进度条
          Progress({
            value: this.importTask.status === 'SUCCESS' ? 100 :
              this.importTask.status === 'FAILED' ? 0 :
                (this.importTask.total && this.importTask.total > 0
                  ? Math.min(100, Math.round(((this.importTask.current ?? 0) / this.importTask.total) * 100))
                  : 0),
            total: 100,
          })
            .width('100%').height(6)
            .color(this.theme.colors.primary)
            .backgroundColor(this.theme.colors.border)
            .margin({ bottom: 12 })

          Text(this.importTask.message ?? this.importTask.currentFileName ?? t('common.loading'))
            .fontSize(14).fontColor(this.theme.colors.textSecondary)
            .maxLines(2).textAlign(TextAlign.Center)

          if (this.importTask.total !== undefined && this.importTask.total > 0) {
            Text(`${this.importTask.current ?? 0} / ${this.importTask.total}`)
              .fontSize(12).fontColor(this.theme.colors.textSecondary)
              .margin({ top: 4 })
          }

          Row({ space: 12 }) {
            if (this.importTask.status === 'SUCCESS' || this.importTask.status === 'FAILED') {
              Row() {
                Text(t('common.ok'))
                  .fontSize(15).fontColor(this.theme.colors.onPrimary)
                  .fontWeight(FontWeight.Bold)
              }
              .padding({ top: 10, bottom: 10, left: 24, right: 24 }).borderRadius(10)
              .backgroundColor(this.theme.colors.primary)
              .onClick((): void => this.closeImportModal())
            } else {
              Row() {
                Text(t('common.cancel'))
                  .fontSize(15).fontColor(this.theme.colors.textSecondary)
              }
              .padding({ top: 10, bottom: 10, left: 24, right: 24 })
              .onClick((): void => this.closeImportModal())
            }
          }
          .width('100%').justifyContent(FlexAlign.Center).margin({ top: 20 })
        }
        .width('80%')
        .backgroundColor(this.theme.colors.surface).borderRadius(20).padding(24)
      }
      .width('100%').height('100%')
    }
  }

  build() {
    if (this.appLang === 'zh-CN') {
      this.LocalizedContent()
    } else {
      this.LocalizedContent()
    }
  }

  @Builder
  LocalizedContent() {
    Stack({ alignContent: Alignment.Center }) {
      Column() {
        this.HeaderBuilder()
        this.UserInfoBuilder()
        this.TabBarBuilder()
        this.SubTabBuilder()

        if (this.loading) {
          this.LoadingSkeleton();
        } else if (this.error.length > 0) {
          this.ErrorState();
        } else if (this.rows.length === 0) {
          this.EmptyState();
        } else {
          List() {
            ForEach(this.rows, (row: ListRow, idx: number) => {
              ListItem() {
                this.ListRowBuilder(row);
              }
            }, (row: ListRow, idx: number) => this.rowKey(row, idx))
          }
          .width('100%').layoutWeight(1)
          .scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring)
        }
      }
      .width('100%').height('100%').backgroundColor(this.theme.colors.background)

      if (this.menuVisible) {
        this.MenuOverlay();
      }
      if (this.createModalVisible) {
        this.CreateModalOverlay();
      }
      if (this.importModalVisible) {
        this.ImportProgressOverlay();
      }
    }
    .width('100%').height('100%')
  }
}