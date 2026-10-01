import router from '@ohos.router';
import { window } from '@kit.ArkUI';
import { buildTheme, CommonNavBar, EmptyView, SkeletonBlock, CommonButton } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import { formatDuration, Logger } from 'audiodock_common';
import { httpClient, mvApi } from 'features_network';
import type { MVDto } from 'features_network';
import { MvVideoPlayer } from '../components/MvVideoPlayer';
import { mvPlaylistStore } from '../store/MvPlaylistStore';
import { playerStore } from '../context/PlayerStore';
import { getImageUrl } from '../utils/image';

@Entry
@Component
struct MVDetailPage {
  /** 当前展示的 MV（来自 store 或初次加载）。 */
  @State data: MVDto | null = null;
  /** 视频 URL（已经过 getImageUrl 拼装的绝对地址）。 */
  @State videoUrl: string = '';
  @State loading: boolean = true;
  @State error: string = '';
  /** 列表模式下视频是否在播放（受控）。 */
  @State isPlaying: boolean = true;
  /** 列表模式下上一首/下一首可用性。 */
  @State hasPrev: boolean = false;
  @State hasNext: boolean = false;
  /** 待播放列表。 */
  @State playlist: MVDto[] = [];
  /** 当前播放索引。 */
  @State currentIndex: number = 0;

  private entityId: string = '';
  private unsubPlaylist: (() => void) | null = null;

  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State theme: Theme = buildTheme('light');
  @State langAtBuild: string = getLang();
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;

  private onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    interface RouterParams { id?: string }
    const p = router.getParams() as RouterParams;
    this.entityId = p.id ?? '';

    // 进入 MV 详情时让出音频通道（对齐 mobile usePlayer().pause()）。
    // 若没在播放，pause() 内部会 no-op；不会触发多余 notify。
    playerStore.pause().catch(() => undefined);

    // 订阅 playlist store：list/currentIndex 任一变化都重新拉数据。
    this.unsubPlaylist = mvPlaylistStore.subscribe(() => this.syncFromPlaylist());

    this.syncFromPlaylist();
  }

  aboutToDisappear(): void {
    if (this.unsubPlaylist) {
      this.unsubPlaylist();
      this.unsubPlaylist = null;
    }

    // 页面销毁兜底：把主窗口方向恢复成竖屏。
    // 不依赖 isFullscreen 状态，因为用户可能通过系统返回键、侧滑手势或
    // Video 组件自己触发的 onFullscreenChange(false) 退出全屏，
    // 这些路径不一定走到 toggleFullscreen() 内部的恢复逻辑，
    // 会导致返回上一页时整个 app 还停在 LANDSCAPE。
    const ctx: Context = getContext();
    window.getLastWindow(ctx).then((win: window.Window) => {
      win.setPreferredOrientation(window.Orientation.PORTRAIT);
    }).catch(() => undefined);
  }

  onPageShow(): void {
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;
  }

  /** 从 store 同步 list/currentIndex，定位到当前 entityId 或 store 当前条目。 */
  private syncFromPlaylist(): void {
    const view = mvPlaylistStore.view();
    this.playlist = view.list;
    this.currentIndex = view.currentIndex;
    this.hasPrev = mvPlaylistStore.hasPrev();
    this.hasNext = mvPlaylistStore.hasNext();

    let target: MVDto | null = null;
    if (view.list.length > 0) {
      target = view.list[view.currentIndex] ?? null;
      // 列表里的 id 与路由 id 不一致时，优先按列表里的条目加载（避免重复请求）。
      if (target && target.id !== this.entityId) {
        this.entityId = target.id;
      }
    }
    if (target) {
      this.data = target;
      this.videoUrl = this.resolveVideoUrl(target);
      this.loading = false;
      this.error = '';
      // 切歌后从 0 开始播放（isPlaying 保持 true）。
    } else if (this.entityId.length > 0) {
      // 首次进入、store 还没塞数据的情况（直接路由跳转没经入口页）。
      this.loadById(this.entityId);
    }
  }

  private async loadById(id: string): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const dto = await mvApi.getById(id);
      if (!dto) {
        this.error = t('mv.notFound');
        this.data = null;
        this.videoUrl = '';
        return;
      }
      this.data = dto;
      this.videoUrl = this.resolveVideoUrl(dto);
    } catch (e) {
      Logger.w('MVDetailPage', `loadById failed: ${String(e)}`);
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  private resolveVideoUrl(dto: MVDto): string {
    if (!dto.path) return '';
    // 注意：这里是视频地址不是图片，不能用 getImageUrl —— 那个是封面/头像专用的
    // 分级加载工具（会拼 /image/optimize）。这里只需把相对路径拼成绝对地址。
    if (dto.path.startsWith('http://') || dto.path.startsWith('https://')) {
      return dto.path;
    }
    const base = httpClient.getBaseURL();
    const cleanPath = dto.path.startsWith('/') ? dto.path.substring(1) : dto.path;
    return `${base}/${cleanPath.split('/').map(encodeURIComponent).join('/')}`;
  }

  private togglePlay(next: boolean): void {
    this.isPlaying = next;
  }

  private playPrev(): void {
    const prev = mvPlaylistStore.prev();
    if (prev) Logger.i('MVDetailPage', `prev → ${prev.id}`);
  }

  private playNext(): void {
    const next = mvPlaylistStore.next();
    if (next) Logger.i('MVDetailPage', `next → ${next.id}`);
  }

  /** Video 组件 onFinish 后调用：列表模式下前进到下一首（对齐 mobile `id === "idle" && player.currentTime > 0` 的连播逻辑）。 */
  private onVideoEnded(): void {
    if (mvPlaylistStore.hasNext()) {
      mvPlaylistStore.next();
    } else {
      this.isPlaying = false;
    }
  }

  build() {
    // 沉浸式避让：全屏布局下页面从物理 y=0 排版，外层 Column padding 避开状态栏/小横条
    Column() {
      if (this.langAtBuild === 'zh-CN') {
        this.LocalizedContent();
      } else {
        this.LocalizedContent();
      }
    }
    .width('100%').height('100%')
    .backgroundColor(this.theme.colors.background)
    .padding({ top: this.statusBarHeightVp, bottom: this.navBarHeightVp })
  }

  @Builder
  LocalizedContent() {
    // 全屏由 VideoController.requestFullscreen 系统接管（独立全屏窗口 + 默认横屏），
    // MVDetailPage 不需要切布局：系统全屏窗口遮住整个页面，自定义控件看不见但能保证横屏。
    Column() {
      CommonNavBar({
        title: this.data?.name ?? t('mv.title'),
        theme: this.theme,
        onBack: () => router.back(),
      });
      if (this.loading) {
        Column({ space: 12 }) {
          SkeletonBlock({ blockHeight: 220, theme: this.theme });
          SkeletonBlock({ blockWidth: '60%', blockHeight: 20, theme: this.theme });
        }.padding(16);
      } else if (this.error.length > 0 || !this.data) {
        Column({ space: 12 }) {
          EmptyView({ message: this.error || t('mv.loadFailed'), theme: this.theme });
          CommonButton({
            label: t('mv.retry'),
            theme: this.theme,
            onButtonClick: () => {
              if (this.entityId.length > 0) this.loadById(this.entityId);
            },
          });
        }.padding(16).layoutWeight(1);
      } else {
        this.Content();
      }
    }.width('100%').height('100%').backgroundColor(this.theme.colors.background);
  }

  @Builder
  private Content() {
    Column() {
      // 视频区域（16:9，按屏宽自适应）
      Column() {
        MvVideoPlayer({
          mv: this.data,
          videoUrl: this.videoUrl,
          theme: this.theme,
          isPlaying: this.isPlaying,
          inPlaylist: this.playlist.length > 1,
          hasPrev: this.hasPrev,
          hasNext: this.hasNext,
          onPrev: () => this.playPrev(),
          onNext: () => this.playNext(),
          onEnded: () => this.onVideoEnded(),
          onTogglePlay: (next: boolean) => this.togglePlay(next),
        });
      }
      .width('100%')
      .aspectRatio(16 / 9)
      .backgroundColor(Color.Black);

      // MV 信息
      Column({ space: 6 }) {
        Text(this.data!.name)
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.theme.colors.text);
        if (this.data!.artist) {
          Text(this.data!.artist)
            .fontSize(13)
            .fontColor(this.theme.colors.textSecondary);
        }
        Text(formatDuration((this.data!.duration ?? 0) * 1000))
          .fontSize(11)
          .fontColor(this.theme.colors.textSecondary);
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: 16, right: 16, top: 12, bottom: 8 });

      // 播放列表（仅当有数据时显示）。当 playlist 只有当前一首时也展示，给出明确的列表入口。
      if (this.playlist.length > 0) {
        this.PlaylistSection();
      }
    }
    .width('100%')
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Start);
  }

  @Builder
  private PlaylistSection() {
    Column() {
      Row() {
        Text(t('mv.upcoming'))
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.theme.colors.text);
        Blank();
        Text(`${this.currentIndex + 1} / ${this.playlist.length}`)
          .fontSize(12)
          .fontColor(this.theme.colors.textSecondary);
      }
      .width('100%')
      .padding({ left: 16, right: 16, bottom: 8 });

      List({ space: 0 }) {
        ForEach(this.playlist, (mv: MVDto, idx: number) => {
          ListItem() {
            this.PlaylistRow(mv, idx);
          };
        }, (mv: MVDto) => mv.id);
      }
      .width('100%')
      .layoutWeight(1)
      .listDirection(Axis.Vertical)
      .divider({ strokeWidth: 0.5, color: this.theme.colors.border })
      .backgroundColor(this.theme.colors.surface);
    }
    .width('100%')
    .layoutWeight(1);
  }

  @Builder
  private PlaylistRow(mv: MVDto, idx: number) {
    Row({ space: 10 }) {
      Text(`${idx + 1}`)
        .fontSize(13)
        .fontColor(idx === this.currentIndex ? this.theme.colors.primary : this.theme.colors.textSecondary)
        .width(24)
        .textAlign(TextAlign.Center);

      Image(getImageUrl(mv.cover, 128))
        .width(64)
        .height(36)
        .borderRadius(4)
        .objectFit(ImageFit.Cover)
        .alt($r('app.media.logo'));

      Column({ space: 2 }) {
        Text(mv.name)
          .fontSize(14)
          .fontColor(idx === this.currentIndex ? this.theme.colors.primary : this.theme.colors.text)
          .fontWeight(idx === this.currentIndex ? FontWeight.Bold : FontWeight.Normal)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis });
        if (mv.artist) {
          Text(mv.artist)
            .fontSize(11)
            .fontColor(this.theme.colors.textSecondary)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis });
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start);

      if (idx === this.currentIndex) {
        Text('>')
          .fontSize(16)
          .fontColor(this.theme.colors.primary)
          .fontWeight(FontWeight.Bold);
      }
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 10, bottom: 10 })
    .backgroundColor(idx === this.currentIndex ? (this.theme.colors.primary + '14') : Color.Transparent)
    .onClick(() => {
      if (idx === this.currentIndex) return;
      mvPlaylistStore.selectById(mv.id);
    });
  }
}
