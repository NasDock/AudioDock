import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { window } from '@kit.ArkUI';
import { kvStore } from 'features_storage';
import { t, getLang } from 'features_i18n';
import { Logger } from 'audiodock_common';
import {
  artistApi, albumApi, trackApi, userDataApi, plusApi, setPlusAuthToken,
} from 'features_network';
import type { ArtistDto, AlbumDto, TrackDto } from 'features_network';
import { MiniPlayer, miniPlayerHasContent } from '../components/MiniPlayer';
import { SquirrelAgent } from '../components/SquirrelAgent';
import { AppIcon, AppIconName } from '../components/AppIcon';
import { CoverImage } from '../components/CoverImage';
import { EmbeddedPlayerPanel } from '../components/EmbeddedPlayerPanel';
import { LibraryTab } from './LibraryPage';
import { PersonalTab } from './PersonalPage';
import { ArtistDetailContent } from './ArtistDetailPage';
import { AlbumDetailContent } from './AlbumDetailPage';
import { PlaylistDetailContent } from './PlaylistDetailPage';
import { CollectionDetailContent } from './CollectionDetailPage';
import { SearchContent } from './SearchPage';
import { authStore } from '../context/AuthStore';
import { likesHistory } from '../services/LikesHistoryService';
import { resolveTrackToPlayer, playQueueFast } from '../services/trackResolver';
import { playerStore } from '../context/PlayerStore';
import type { Track } from '../context/PlayerStore';
import { syncStore } from '../context/SyncStore';
import { buildTheme, withAlpha } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';

const PAGE_SIZE: number = 8;

/** TabBuilder 按引用传参的类型（ArkTS 禁止内联对象字面量类型） */
interface TabTitleParam {
  title: string;
}

/** NavDestination 详情页 param：ArkTS 严格模式不允许内联对象字面量，必须显式类/接口 */
interface DetailNavParam {
  id: string;
}

class Section {
  id: string = '';
  title: string = '';
  type: string = '';
  artists: ArtistDto[] = [];
  albums: AlbumDto[] = [];
  tracks: TrackDto[] = [];
  // 局部刷新时递增，配合 ForEach key 强制重建对应版块，避免只改数据不重渲染。
  version: number = 0;

  constructor(id: string, title: string, type: string) {
    this.id = id;
    this.title = title;
    this.type = type;
  }
}

@Component
export struct HomeTab {
  // 路由栈由 RootShellPage 注入；进 NavDestination 内的页面用它，独立 Page 仍走 router.pushUrl
  pathStack: NavPathStack = new NavPathStack();
  // 车机模式详情页跳转回调：非空时优先走右栏局部渲染，不进入全局路由
  carNavCallback?: (name: string, id: string) => void;
  @State sections: Section[] = [];
  @State loading: boolean = true;
  @State refreshing: boolean = false;
  @State error: string = '';
  // 内容模式由 AppStorage 全局同步（对齐 mobile 共享的 usePlayMode context）：
  // 首页/声仓/设置页任一处切换，另一处经 @Watch 自动重载。
  @StorageLink('playMode') @Watch('onModeChange') mode: string = 'MUSIC';
  // 车机模式下 HomeTab 自己处于 MainPage.carContentPanel 内，车机 tab 栏已由 carContentPanel 自身 padding:56 避让，
  // 这里同步读 carModeEnabled 把 HomeTab 内部 List 的 paddingBottom 设为 0，避免叠加 56 空白。
  @StorageLink('carModeEnabled') carModeEnabled: boolean = false;
  @State isRadioMode: boolean = false;
  @State likedIds: string[] = [];
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  // 调整顺序页保存时会写入该值，触发首页按最新 section_order 重排。
  @StorageLink('sectionOrderVersion') @Watch('onSectionOrderChange') sectionOrderVersion: number = 0;
  @State theme: Theme = buildTheme('light');
  private userId: string = '';
  // 整页重载（切换模式/下拉刷新）时递增，作为所有版块的 version：
  // ForEach key 为 `${id}-${version}`，key 不变时 ArkUI 会保留旧组件，
  // 导致切换模式/刷新后版块仍显示旧内容，故每次整页重载必须换新 key。
  private reloadVersion: number = 0;

  aboutToAppear() {
    this.theme = buildTheme(this.themeMode);
    this.initData();
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  async initData(): Promise<void> {
    // baseURL / token 已由 EntryAbility + Index(authStore.loadFromStorage) 装配好，
    // 这里只取当前用户；播放模式由 @StorageLink('playMode') 提供。
    this.userId = authStore.state_.user?.id ?? '';
    this.loading = true;
    await this.loadData();
    this.loading = false;
  }

  async loadData(): Promise<void> {
    this.error = '';
    try {
      const isMusic = this.mode === 'MUSIC';
      const built: Section[] = [];

      const artists = await artistApi.latest({ type: this.mode, random: true, pageSize: PAGE_SIZE });
      if (artists.length > 0) {
        const s = new Section('artists', t('homePage.latestArtists'), 'artist');
        s.artists = artists;
        built.push(s);
      }

      const recent = await albumApi.latest({ type: this.mode, random: true, pageSize: PAGE_SIZE });
      if (recent.length > 0) {
        const s = new Section('recent', t('homePage.latestAlbums'), 'album');
        s.albums = recent;
        built.push(s);
      }

      const recommended = await albumApi.recommend({ type: this.mode, pageSize: PAGE_SIZE });
      if (recommended.length > 0) {
        const s = new Section('recommended', t('homePage.recommendedAlbums'), 'album');
        s.albums = recommended;
        built.push(s);
      }

      if (isMusic) {
        const tracks = await trackApi.latest({ type: 'MUSIC', random: true, pageSize: PAGE_SIZE });
        if (tracks.length > 0) {
          const s = new Section('tracks', t('homePage.latestTracks'), 'track');
          s.tracks = tracks;
          built.push(s);
        }
        await this.refreshLikedIds(tracks);
      } else if (this.userId.length > 0) {
        const history = await userDataApi.albumHistory({ pageSize: PAGE_SIZE, loadCount: 0, type: 'AUDIOBOOK' });
        const albums: AlbumDto[] = [];
        for (const item of history.list) {
          if (item.album) albums.push(item.album);
        }
        if (albums.length > 0) {
          const s = new Section('history', t('homePage.continueListening'), 'album');
          s.albums = albums;
          built.push(s);
        }
      }

      await this.sortWithSavedOrder(built);
      this.reloadVersion += 1;
      for (const s of built) {
        s.version = this.reloadVersion;
      }
      this.sections = built;
    } catch (e) {
      // 之前这里只 console.error，导致首页静默变成一片空白，看不出是网络挂了。
      this.error = e instanceof Error ? e.message : String(e);
      Logger.e('HomeTab', `load failed: ${this.error}`);
    }
  }

  // 按用户在「调整顺序」页保存的 section_order 对版块排序（对齐 mobile AsyncStorage 逻辑）。
  private async sortWithSavedOrder(list: Section[]): Promise<void> {
    try {
      const order = await kvStore.getJSON<string[]>('section_order');
      if (order) {
        list.sort((a: Section, b: Section): number => {
          const ia = order.indexOf(a.id);
          const ib = order.indexOf(b.id);
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        });
      }
    } catch (e) {
      Logger.w('HomeTab', `load section order failed: ${String(e)}`);
    }
  }

  onSectionOrderChange(): void {
    this.reapplyOrder();
  }

  private async reapplyOrder(): Promise<void> {
    if (this.sections.length === 0) return;
    const list = this.sections.slice();
    await this.sortWithSavedOrder(list);
    this.sections = list;
  }

  // 下拉刷新：整页重载（对齐 mobile RefreshControl + onRefresh）。
  // 播放模式无需重读 kvStore：@StorageLink('playMode') 已实时同步。
  async onPullRefresh(): Promise<void> {
    await this.loadData();
    this.refreshing = false;
  }

  // 版块刷新按钮：只局部重载对应版块，不触发整页骨架屏（对齐 mobile refreshSection）。
  async refreshSection(sectionId: string): Promise<void> {
    try {
      if (sectionId === 'artists') {
        const artists = await artistApi.latest({ type: this.mode, random: true, pageSize: PAGE_SIZE });
        if (artists.length > 0) {
          this.replaceSectionData('artists', (s: Section): void => { s.artists = artists; });
        }
      } else if (sectionId === 'recent') {
        const recent = await albumApi.latest({ type: this.mode, random: true, pageSize: PAGE_SIZE });
        if (recent.length > 0) {
          this.replaceSectionData('recent', (s: Section): void => { s.albums = recent; });
        }
      } else if (sectionId === 'recommended') {
        const recommended = await albumApi.recommend({ type: this.mode, pageSize: PAGE_SIZE });
        if (recommended.length > 0) {
          this.replaceSectionData('recommended', (s: Section): void => { s.albums = recommended; });
        }
      } else if (sectionId === 'tracks') {
        const tracks = await trackApi.latest({ type: 'MUSIC', random: true, pageSize: PAGE_SIZE });
        if (tracks.length > 0) {
          this.replaceSectionData('tracks', (s: Section): void => { s.tracks = tracks; });
          await this.refreshLikedIds(tracks);
        }
      } else if (sectionId === 'history') {
        const history = await userDataApi.albumHistory({ pageSize: PAGE_SIZE, loadCount: 0, type: 'AUDIOBOOK' });
        const albums: AlbumDto[] = [];
        for (const item of history.list) {
          if (item.album) albums.push(item.album);
        }
        if (albums.length > 0) {
          this.replaceSectionData('history', (s: Section): void => { s.albums = albums; });
        }
      }
    } catch (e) {
      Logger.w('HomeTab', `refreshSection ${sectionId} failed: ${String(e)}`);
    }
  }

  private replaceSectionData(id: string, apply: (s: Section) => void): void {
    const next: Section[] = [];
    for (const s of this.sections) {
      if (s.id === id) {
        const copy = new Section(s.id, s.title, s.type);
        copy.artists = s.artists;
        copy.albums = s.albums;
        copy.tracks = s.tracks;
        copy.version = s.version + 1;
        apply(copy);
        next.push(copy);
      } else {
        next.push(s);
      }
    }
    this.sections = next;
  }

  private async refreshLikedIds(tracks: TrackDto[]): Promise<void> {
    if (this.userId.length === 0) return;
    const ids: string[] = [];
    for (const tr of tracks) {
      try {
        if (await likesHistory.isTrackLiked(String(tr.id))) ids.push(String(tr.id));
      } catch (e) {
        Logger.w('HomeTab', `isTrackLiked failed: ${String(e)}`);
      }
    }
    this.likedIds = ids;
  }

  isLiked(id: string): boolean {
    return this.likedIds.includes(id);
  }

  async toggleLike(trackId: string): Promise<void> {
    if (this.userId.length === 0) return;
    const liked = this.isLiked(trackId);
    try {
      if (liked) await likesHistory.unlikeTrack(trackId);
      else await likesHistory.likeTrack(trackId);
      const next: string[] = [];
      for (const id of this.likedIds) {
        if (id !== trackId) next.push(id);
      }
      if (!liked) next.push(trackId);
      this.likedIds = next;
    } catch (e) {
      Logger.w('HomeTab', `toggleLike failed: ${String(e)}`);
    }
  }

  toggleMode(): void {
    this.mode = this.mode === 'MUSIC' ? 'AUDIOBOOK' : 'MUSIC';
  }

  // @Watch('onModeChange')：无论本页还是声仓/设置页切换模式都会触发。
  // 对齐 mobile：内容模式切换时保存当前模式播放状态、恢复目标模式的播放上下文，
  // MiniPlayer 随之显示对应模式的内容，并重载首页版块。
  async onModeChange(): Promise<void> {
    try {
      await kvStore.set('playMode', this.mode);
    } catch (e) {
      Logger.w('HomeTab', `save playMode failed: ${String(e)}`);
    }
    await playerStore.switchContentMode(this.mode);
    await this.loadData();
  }

  /**
   * 修复 7：进入/退出电台模式。
   * 对齐 mobile PlayerContext.tsx startRadioMode / exitRadioPlaybackContext (L296-322, L1665-1677)：
   * - 进入：调 trackApi.latest(random  true) 拿一首随机曲目，塞进 playerStore 并设 radioMode=true
   * - 退出：调 playerStore.exitRadioPlaybackContext()（自动重置 radioMode）
   * - 仅 MUSIC 模式可用（AUDIOBOOK / Emby 不开放）
   * - 成功后跳转到 PlayerPage
   */
  async toggleRadioMode(): Promise<void> {
    if (this.mode !== 'MUSIC') {
      promptAction.showToast({ message: t('mainPage.radioUnavailable') });
      return;
    }
    if (this.isRadioMode) {
      // 已经在 radio 模式，再点是跳到 PlayerPage（对齐 mobile behavior）
      router.pushUrl({ url: 'pages/PlayerPage' }).catch(() => undefined);
      return;
    }
    this.isRadioMode = true;
    try {
      const resp = await trackApi.latest({ type: 'MUSIC', pageSize: 1, random: true });
      const next = Array.isArray(resp) && resp.length > 0 ? resp[0] : null;
      if (!next || !next.id) {
        throw new Error('radio: empty list');
      }
      // 把 TrackDto 转成 Track 并启动播放（TrackDto 字段：name/cover/path，不是 title/coverUrl/url）
      const track: Track = {
        id: next.id,
        title: next.name ?? '',
        artist: next.artist,
        album: next.album,
        duration: next.duration,
        url: next.path ?? '',
        ext: next.ext,
        coverUrl: next.cover,
        lyrics: next.lyrics,
        contentType: next.type,
      };
      await playerStore.startRadioMode(track);
      router.pushUrl({ url: 'pages/PlayerPage' }).catch(() => undefined);
    } catch (e) {
      this.isRadioMode = false;
      Logger.w('HomeTab', `toggleRadioMode failed: ${String(e)}`);
      promptAction.showToast({ message: t('mainPage.radioStartFailed') });
    }
  }

  navigateToSearch(): void {
    if (this.carModeEnabled) {
      this.carNavCallback?.('Search', '');
    } else {
      this.pathStack.pushPath({ name: 'Search' });
    }
  }

  navigateToSectionOrder(): void {
    router.pushUrl({ url: 'pages/SectionOrderPage' });
  }

  navigateToArtist(id: string): void {
    if (this.carModeEnabled) {
      this.carNavCallback?.('ArtistDetail', id);
    } else {
      const param: DetailNavParam = { id: id };
      this.pathStack.pushPath({ name: 'ArtistDetail', param: param });
    }
  }

  navigateToAlbum(id: string): void {
    if (this.carModeEnabled) {
      this.carNavCallback?.('AlbumDetail', id);
    } else {
      const param: DetailNavParam = { id: id };
      this.pathStack.pushPath({ name: 'AlbumDetail', param: param });
    }
  }

  async playTrack(track: TrackDto, queue: TrackDto[]): Promise<void> {
    try {
      let idx = 0;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].id === track.id) { idx = i; break; }
      }
      // 秒播：先播用户点的这首，完整队列后台并行补齐（resolveTrackToPlayer 串行 → playQueueFast）
      await playQueueFast(queue, idx, false);
      // 不再自动打开播放详情页：播放交给 MiniPlayer，用户点 MiniPlayer 再进详情
    } catch (e) {
      Logger.w('HomeTab', `playTrack failed: ${String(e)}`);
    }
  }

  @Builder
  ArtistCard(artist: ArtistDto) {
    Column() {
      CoverImage({
        path: artist.avatar,
        imgWidth: 80, imgHeight: 80, radius: 40,
        fallbackText: artist.name,
      })
      Text(artist.name)
        .fontSize(13).fontColor(this.theme.colors.text).margin({ top: 8 })
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        .textAlign(TextAlign.Center).width(80)
    }
    .margin({ right: 16 })
    .onClick(() => this.navigateToArtist(String(artist.id)))
  }

  @Builder
  AlbumCard(album: AlbumDto, showProgress: boolean) {
    Column() {
      Stack({ alignContent: Alignment.Bottom }) {
        CoverImage({
          path: album.cover,
          imgWidth: 120, imgHeight: 120, radius: 10,
          fallbackText: album.name,
        })
        if (showProgress && album.progress !== undefined && album.progress > 0) {
          Stack() {
            Row().width('100%').height(4)
              .backgroundColor('rgba(255,255,255,0.3)')
            Row().width(album.progress + '%').height(4)
              .backgroundColor(this.theme.colors.primary)
          }
          .width(114).margin({ left: 3, right: 3, bottom: 5 })
        }
      }
      .width(120).height(120)

      Text(album.name)
        .fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 4 })
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width(120)

      Text(album.artist ?? '')
        .fontSize(12).fontColor(this.theme.colors.textSecondary)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width(120)
    }
    .margin({ right: 16 })
    .onClick(() => this.navigateToAlbum(String(album.id)))
  }

  @Builder
  TrackCard(track: TrackDto, queue: TrackDto[]) {
    Row() {
      CoverImage({
        path: track.cover,
        imgWidth: 50, imgHeight: 50, radius: 4,
        fallbackText: track.name,
      })
      Column() {
        Text(track.name)
          .fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.theme.colors.text)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width(100)
        Text(track.artist ?? '')
          .fontSize(12).fontColor(this.theme.colors.textSecondary).margin({ top: 4 })
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width(100)
      }
      .layoutWeight(1).margin({ left: 12 }).alignItems(HorizontalAlign.Start)

      Button() {
        AppIcon({
          name: 'heart', iconSize: 16,
          color: this.isLiked(String(track.id)) ? this.theme.colors.primary : this.theme.colors.textSecondary,
        })
      }
      .backgroundColor(Color.Transparent).width(32).height(32)
      .onClick(() => this.toggleLike(String(track.id)))
    }
    .width(260).padding(10)
    .backgroundColor(this.theme.colors.surface).borderRadius(8)
    .margin({ right: 12, bottom: 10 })
    .onClick(() => this.playTrack(track, queue))
  }

  @Builder
  SectionHeader(title: string, sectionId: string) {
    Row() {
      Text(title)
        .fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text).layoutWeight(1)
      Button() {
        AppIcon({ name: 'arrow-clockwise', iconSize: 16, color: this.theme.colors.text })
      }
      .backgroundColor(Color.Transparent).width(32).height(32)
      .onClick(() => this.refreshSection(sectionId))
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 20, bottom: 12 })
    .justifyContent(FlexAlign.SpaceBetween)
  }

  build() {
    if (this.loading) {
      this.LoadingSkeleton();
    } else {
      Column() {
        Row() {
          Text(t('homePage.title'))
            .fontSize(24).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
          Row() {
            if (this.mode === 'MUSIC') {
              Button() {
                AppIcon({ name: 'radio', iconSize: 18, color: this.isRadioMode ? this.theme.colors.primary : this.theme.colors.text })
              }
              .width(36).height(36)
              .backgroundColor(this.isRadioMode ? withAlpha(this.theme.colors.primary, '20') : this.theme.colors.surface)
              .borderRadius(18).margin({ right: 8 })
              .borderWidth(this.isRadioMode ? 1 : 0).borderColor(withAlpha(this.theme.colors.primary, '40'))
              .onClick(() => this.toggleRadioMode())
            }
            Button() {
              AppIcon({ name: this.mode === 'MUSIC' ? 'headphones' : 'music-note', iconSize: 18, color: this.theme.colors.text })
            }
            .width(36).height(36).backgroundColor(this.theme.colors.surface).borderRadius(18)
            .onClick(() => this.toggleMode())
          }
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 16, bottom: 8 })
        .justifyContent(FlexAlign.SpaceBetween)

        Row() {
          Text(t('homePage.searchPlaceholder')).fontSize(14).fontColor(this.theme.colors.textSecondary)
        }
        .width('100%').height(44)
        .padding({ left: 16, right: 16 }).margin({ left: 16, right: 16 })
        .backgroundColor(this.theme.colors.surface).borderRadius(10)
        .justifyContent(FlexAlign.Start).alignItems(VerticalAlign.Center)
        .onClick(() => this.navigateToSearch())

        if (this.error.length > 0) {
          this.ErrorState();
        } else {
          Refresh({ refreshing: $$this.refreshing }) {
            List() {
              ForEach(this.sections, (section: Section) => {
                ListItem() {
                  Column() {
                    this.SectionHeader(section.title, section.id)
                    Scroll() {
                      Row() {
                        if (section.type === 'artist') {
                          ForEach(section.artists, (item: ArtistDto) => {
                            this.ArtistCard(item);
                          }, (item: ArtistDto) => String(item.id))
                        } else if (section.type === 'album') {
                          ForEach(section.albums, (item: AlbumDto) => {
                            this.AlbumCard(item, section.id === 'history');
                          }, (item: AlbumDto) => String(item.id))
                        } else {
                          ForEach(this.chunkTracks(section.tracks), (chunk: TrackDto[], ci: number) => {
                            Column() {
                              ForEach(chunk, (track: TrackDto) => {
                                this.TrackCard(track, section.tracks);
                              }, (track: TrackDto) => String(track.id))
                            }
                          }, (chunk: TrackDto[], ci: number) => `chunk-${ci}`)
                        }
                      }
                      .padding({ left: 16, right: 16 })
                    }
                    .scrollBar(BarState.Off)
                    .scrollable(ScrollDirection.Horizontal)
                  }
                  .width('100%').alignItems(HorizontalAlign.Start)
                }
              }, (section: Section) => `${section.id}-${section.version}`)

              ListItem() {
                Row() {
                  AppIcon({ name: 'list', iconSize: 16, color: this.theme.colors.primary }).margin({ right: 8 })
                  Text(t('homePage.adjustOrder')).fontSize(14).fontColor(this.theme.colors.primary)
                }
                .width('100%').padding(20).justifyContent(FlexAlign.Center)
                .onClick(() => this.navigateToSectionOrder())
              }
            }
            .width('100%').height('100%')
            // 避让悬浮的 GlobalBottomBar（Tab 栏 56 + MiniPlayer 60，MiniPlayer 空队列不占高度）；
            // 车机模式 GlobalBottomBar 已隐藏 + carContentPanel 自己加了 padding:56 避让车机 tab 栏，
            // 这里设 0 避免叠加 56 空白（修复车机模式下「调整顺序」按钮上方多一大块空白）。
            .padding({ bottom: this.carModeEnabled ? 0 : (miniPlayerHasContent() ? 116 : 56) })
            .scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring)
          }
          .width('100%').layoutWeight(1)
          .onRefreshing((): void => { this.onPullRefresh(); })
        }
      }
      .width('100%').height('100%').backgroundColor(this.theme.colors.background)
    }
  }

  @Builder
  ErrorState() {
    Column({ space: 12 }) {
      Text(t('common.error')).fontSize(16).fontColor(this.theme.colors.text)
      Text(this.error).fontSize(12).fontColor(this.theme.colors.textSecondary)
        .maxLines(3).textAlign(TextAlign.Center)
      Button(t('common.retry'))
        .backgroundColor(this.theme.colors.primary).fontColor(this.theme.colors.onPrimary).borderRadius(18)
        .onClick(() => this.loadData())
    }
    .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center).padding(24)
  }

  chunkTracks(tracks: TrackDto[]): TrackDto[][] {
    const result: TrackDto[][] = [];
    for (let i = 0; i < tracks.length; i += 2) {
      const chunk: TrackDto[] = [];
      chunk.push(tracks[i]);
      if (i + 1 < tracks.length) chunk.push(tracks[i + 1]);
      result.push(chunk);
    }
    return result;
  }

  @Builder
  LoadingSkeleton() {
    Column() {
      Row() {
        Row().width(100).height(28).borderRadius(8).backgroundColor(this.theme.colors.border)
        Row().width(80).height(36).borderRadius(18).backgroundColor(this.theme.colors.border)
      }
      .width('100%').padding({ left: 16, right: 16, top: 20 })
      .justifyContent(FlexAlign.SpaceBetween)

      Row().width('90%').height(44).borderRadius(10)
        .backgroundColor(this.theme.colors.border).margin({ left: 16, right: 16, top: 16 })

      // 版块 1：艺术家（圆形头像）
      Column() {
        Row().width(120).height(24).borderRadius(8)
          .backgroundColor(this.theme.colors.border).margin({ left: 16, bottom: 12 })
        Row() {
          ForEach([1, 2, 3, 4], (i: number) => {
            Column() {
              Row().width(80).height(80).borderRadius(40)
                .backgroundColor(this.theme.colors.border).margin({ bottom: 8 })
              Row().width(60).height(14).borderRadius(4).backgroundColor(this.theme.colors.border)
            }
            .margin({ right: 16 })
          }, (i: number) => `sk-a-${i}`)
        }
        .padding({ left: 16 })
      }
      .margin({ top: 16 }).alignItems(HorizontalAlign.Start)

      // 版块 2：单曲（横向卡片）
      Column() {
        Row().width(120).height(24).borderRadius(8)
          .backgroundColor(this.theme.colors.border).margin({ left: 16, bottom: 12 })
        Row() {
          ForEach([1, 2], (i: number) => {
            Row() {
              Row().width(50).height(50).borderRadius(4)
                .backgroundColor(this.theme.colors.border).margin({ right: 12 })
              Column() {
                Row().width(100).height(14).borderRadius(4)
                  .backgroundColor(this.theme.colors.border).margin({ bottom: 8 })
                Row().width(70).height(12).borderRadius(4).backgroundColor(this.theme.colors.border)
              }
              .alignItems(HorizontalAlign.Start)
            }
            .width(260).padding(10).borderRadius(8)
            .backgroundColor(this.theme.colors.surface).margin({ right: 12 })
          }, (i: number) => `sk-t-${i}`)
        }
        .padding({ left: 16 })
      }
      .margin({ top: 16 }).alignItems(HorizontalAlign.Start)

      // 版块 3：专辑（方形封面）
      Column() {
        Row().width(120).height(24).borderRadius(8)
          .backgroundColor(this.theme.colors.border).margin({ left: 16, bottom: 12 })
        Row() {
          ForEach([1, 2, 3, 4], (i: number) => {
            Column() {
              Row().width(120).height(120).borderRadius(10)
                .backgroundColor(this.theme.colors.border).margin({ bottom: 8 })
              Row().width(100).height(14).borderRadius(4)
                .backgroundColor(this.theme.colors.border).margin({ bottom: 4 })
              Row().width(70).height(12).borderRadius(4).backgroundColor(this.theme.colors.border)
            }
            .margin({ right: 16 })
            .alignItems(HorizontalAlign.Start)
          }, (i: number) => `sk-al-${i}`)
        }
        .padding({ left: 16 })
      }
      .margin({ top: 16 }).alignItems(HorizontalAlign.Start)
    }
    .width('100%').height('100%').backgroundColor(this.theme.colors.background)
    .alignItems(HorizontalAlign.Start)
  }
}

@Component
export struct MainPageContent {
  // 路由栈由 RootShellPage 注入；Tabs 内的跳转用它，跨 NavDestination 共享同一栈
  pathStack: NavPathStack = new NavPathStack();
  // 车机模式右栏详情页状态：非空时右栏渲染详情页，空时渲染三个 Tab
  @State carDetailName: string = '';
  @State carDetailId: string = '';
  @StorageLink('mainTabIndex') currentIndex: number = 0;
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  // 车机模式三件套（对齐 mobile 的 SettingsContext + _layout.tsx）。
  // carModeEnabled 决定是否走左右布局分支；carPanelsSwapped 决定 player 在左还是在右；
  // screenBottomInset 影响根布局 paddingBottom（用户手动调底部安全区）。
  @StorageLink('carModeEnabled') @Watch('onCarModeChange') carModeEnabled: boolean = false;
  // 自动横竖屏：跟 carModeEnabled 共同决定 setPreferredOrientation 的目标值。
  // 启动值由 EntryAbility.initialize() 从 kvStore 写入 AppStorage，本页直接订阅。
  @StorageLink('autoOrientation') @Watch('onAutoOrientationChange') autoOrientation: boolean = false;
  @StorageLink('carPanelsSwapped') carPanelsSwapped: boolean = false;
  @StorageLink('screenBottomInset') screenBottomInset: number = 0;
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  @State voiceAssistantEnabled: boolean = false;
  @State isVip: boolean = false;
  // 左侧播放器面板的尺寸（onAreaChange 测量，用于布局计算 / 调试）
  @State carLayoutWidth: number = 0;
  @State carLayoutHeight: number = 0;

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.loadVoiceAssistantGate();
    this.loadAcceptSync();
    playerStore.restoreState();
    // 同步播放：注册 socket 监听 + 启动连接（对齐 mobile 的 _layout.tsx SyncProvider 包裹）
    syncStore.bindSocketEvents();
    playerStore.bindSyncSocketListeners();
    authStore.connectSyncSocket().catch((e: Error): void => {
      Logger.w('MainPageContent', `connectSyncSocket failed: ${String(e)}`);
    });
    // 启动时立刻按优先级链应用窗口方向（避免进入后再旋转闪一下）
    this.applyOrientation();
  }

  /**
   * @StorageLink('carModeEnabled') 变化时切换窗口方向。
   * 车机模式开启 → 强制横屏；关闭 → 交由 autoOrientation 决定（AUTO_ROTATION 或 PORTRAIT）。
   */
  onCarModeChange(): void {
    Logger.i('MainPageContent', `carModeEnabled -> ${this.carModeEnabled}`);
    this.applyOrientation();
  }

  /**
   * @StorageLink('autoOrientation') 变化时重算窗口方向。
   * 仅在车机模式关闭时生效；开启车机模式时横屏锁始终最高优先级。
   */
  onAutoOrientationChange(): void {
    Logger.i('MainPageContent', `autoOrientation -> ${this.autoOrientation}`);
    this.applyOrientation();
  }

  /**
   * 调用 window.setPreferredOrientation 切换主窗口方向。
   * 优先级链：carModeEnabled（最高）→ autoOrientation → 默认 PORTRAIT。
   * 不传参给 getContext：API 12+ 返回最近 component 的 context（与 MvVideoPlayer 一致）。
   */
  private applyOrientation(): void {
    let target: window.Orientation = window.Orientation.PORTRAIT;
    if (this.carModeEnabled) {
      target = window.Orientation.LANDSCAPE;
    } else if (this.autoOrientation) {
      target = window.Orientation.AUTO_ROTATION;
    }
    try {
      const ctx: Context = getContext();
      window.getLastWindow(ctx).then((win: window.Window): void => {
        win.setPreferredOrientation(target);
      }).catch((e: Error): void => {
        Logger.w('MainPageContent', `getLastWindow failed: ${String(e)}`);
      });
    } catch (e) {
      Logger.w('MainPageContent', `applyOrientation failed: ${String(e)}`);
    }
  }

  /** 启动时把 kvStore 里的「接受同步邀请」开关同步到 SyncStore，避免默认值脱节。 */
  private async loadAcceptSync(): Promise<void> {
    try {
      const v = await kvStore.get('acceptSync');
      // 未存储过时默认 true，与 mobile SettingsContext.defaultSettings.acceptSync 一致
      syncStore.setAcceptSync(v === null ? true : v === 'true');
    } catch (e) {
      Logger.w('MainPageContent', `loadAcceptSync error: ${e}`);
    }
  }

  private async loadVoiceAssistantGate(): Promise<void> {
    try {
      const enabled = await kvStore.get('voiceAssistantEnabled');
      this.voiceAssistantEnabled = enabled === 'true';
      const userId = await kvStore.get('plus_user_id');
      if (userId !== null && userId.length > 0) {
        const token = await kvStore.get('plus_token');
        if (token) setPlusAuthToken(token);
        const profile = await plusApi.getMe(userId);
        this.isVip = !!profile.vipTier && profile.vipTier !== 'NONE';
      } else {
        this.isVip = false;
      }
    } catch (e) {
      Logger.w('MainPageContent', `loadVoiceAssistantGate error: ${e}`);
    }
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  onPageShow(): void {
    // 语言可能在后台（语言页）被修改：回显时若语言已变化，切换 if 分支重建整页。
    // 不能在隐藏时重建——@StorageProp 在后台更新触发的重建会导致路由页触摸失效。
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;
    // 设置页可能修改了语音助手开关，回显时重新读取门控状态
    this.loadVoiceAssistantGate();
  }

  build() {
    // 条件读取 langAtBuild 建立依赖（框架只追踪读取状态变量的表达式，t() 是普通函数无法被追踪），
    // 语言变化使 if 分支切换，旧子树销毁、新子树重建，tab 文案与三个 Tab 页内容都按新语言重新求值。
    if (this.langAtBuild === 'zh-CN') {
      this.LocalizedContent()
    } else {
      this.LocalizedContent()
    }
  }

  @Builder
  LocalizedContent() {
    Stack({ alignContent: Alignment.Bottom }) {
      if (this.carModeEnabled) {
        // ═══ 车机模式：左右分栏布局（对齐 mobile _layout.tsx 的 carModeContainer）═══
        // [EmbeddedPlayerPanel (9:16) | ⇄ swapButton | Tabs contentPanel (flex:1)]
        // 车机模式不显示 MiniPlayer（左侧已是完整嵌入式播放器）
        Row() {
          if (!this.carPanelsSwapped) {
            this.carPlayerPanel();
            this.swapButton();
            this.carContentPanel();
          } else {
            this.carContentPanel();
            this.swapButton();
            this.carPlayerPanel();
          }
        }
        .width('100%')
        .height('100%')
        .padding({ bottom: this.screenBottomInset })
        .backgroundColor(this.theme.colors.background)
      } else {
        // ═══ 常规布局：三个 Tab 常驻，仅切换显隐 ═══
        // 之前用 if/else 按 currentIndex 切换，每次切 tab 整棵子树销毁重建，
        // aboutToAppear 重新拉数据 → 每次都闪骨架屏。改成 Stack + visibility 后
        // 状态/滚动位置/已加载数据全部保留，切回直接展示（对齐 mobile tab 导航的 keep-alive 体验）。
        // 底部 Tab 与 MiniPlayer 由 RootShellPage 内的 GlobalBottomBar 统一渲染（跨页面常驻）
        Stack() {
          HomeTab({ pathStack: this.pathStack, carNavCallback: (name: string, id: string): void => this.openCarDetail(name, id) })
            .visibility(this.currentIndex === 0 ? Visibility.Visible : Visibility.None)
          LibraryTab({ pathStack: this.pathStack, carNavCallback: (name: string, id: string): void => this.openCarDetail(name, id) })
            .visibility(this.currentIndex === 1 ? Visibility.Visible : Visibility.None)
          PersonalTab({ pathStack: this.pathStack, carNavCallback: (name: string, id: string): void => this.openCarDetail(name, id) })
            .visibility(this.currentIndex === 2 ? Visibility.Visible : Visibility.None)
        }
        .width('100%').height('100%')
        .backgroundColor(this.theme.colors.background)
      }

      if (this.voiceAssistantEnabled && this.isVip) {
        SquirrelAgent()
      }
    }
    .width('100%').height('100%').backgroundColor(this.theme.colors.background)
  }

  /** 车机模式左侧播放器面板：宽 = 高 × 9/16（对齐 mobile playerPanel 的 aspectRatio: 9/16） */
  @Builder
  carPlayerPanel() {
    EmbeddedPlayerPanel()
      .height('100%')
      .aspectRatio(9 / 16)
      .backgroundColor(this.theme.colors.background)
      .onAreaChange((_old: Area, newVal: Area): void => {
        this.carLayoutWidth = newVal.width as number;
        this.carLayoutHeight = newVal.height as number;
      });
  }

  /**
   * 车机模式中间圆形 swap 按钮（对齐 mobile _layout.tsx 的 swapButton）：
   * 点击翻转 carPanelsSwapped，让用户把播放器挪到左边还是右边。
   */
  @Builder
  swapButton() {
    Stack() {
      AppIcon({
        name: 'shuffle',
        iconSize: 18,
        color: this.theme.colors.text,
      })
    }
    .width(36)
    .height(36)
    .borderRadius(18)
    .backgroundColor(this.theme.colors.surface)
    .border({
      width: 1,
      color: this.theme.colors.border,
    })
    .margin({ left: -18, right: -18 })
    .zIndex(20)
    .alignSelf(ItemAlign.Center)
    .onClick((): void => {
      AppStorage.setOrCreate<boolean>('carPanelsSwapped', !this.carPanelsSwapped);
      kvStore.set('carPanelsSwapped', !this.carPanelsSwapped ? 'true' : 'false').catch((): void => undefined);
    })
  }

  /** 车机模式右侧内容区：三个 Tab 内容常驻切换显隐 + 底部 tab 栏 + 详情页覆盖层（不覆盖左侧播放器）。
   *  用 if/else 按 carDetailName 切换内容，避免嵌套 Navigation 的兼容性问题。 */
  @Builder
  carContentPanel() {
    Column() {
      // 上半：内容区（Tab 或详情页）
      Stack() {
        if (this.carDetailName === '') {
          // 三个 Tab 内容常驻切换显隐（保留滚动位置/已加载数据）
          Stack() {
            HomeTab({ pathStack: this.pathStack, carNavCallback: (name: string, id: string): void => this.openCarDetail(name, id) })
              .visibility(this.currentIndex === 0 ? Visibility.Visible : Visibility.None)
            LibraryTab({ pathStack: this.pathStack, carNavCallback: (name: string, id: string): void => this.openCarDetail(name, id) })
              .visibility(this.currentIndex === 1 ? Visibility.Visible : Visibility.None)
            PersonalTab({ pathStack: this.pathStack, carNavCallback: (name: string, id: string): void => this.openCarDetail(name, id) })
              .visibility(this.currentIndex === 2 ? Visibility.Visible : Visibility.None)
          }
          .width('100%')
          .height('100%')
        } else if (this.carDetailName === 'ArtistDetail') {
          ArtistDetailContent({ pathStack: this.pathStack, entityId: this.carDetailId, carNavCallback: (name: string, id: string): void => this.openCarDetail(name, id), carBackCallback: (): void => this.closeCarDetail() })
        } else if (this.carDetailName === 'AlbumDetail') {
          AlbumDetailContent({ pathStack: this.pathStack, entityId: this.carDetailId, carNavCallback: (name: string, id: string): void => this.openCarDetail(name, id), carBackCallback: (): void => this.closeCarDetail() })
        } else if (this.carDetailName === 'PlaylistDetail') {
          PlaylistDetailContent({ pathStack: this.pathStack, entityId: this.carDetailId, carNavCallback: (name: string, id: string): void => this.openCarDetail(name, id), carBackCallback: (): void => this.closeCarDetail() })
        } else if (this.carDetailName === 'CollectionDetail') {
          CollectionDetailContent({ pathStack: this.pathStack, entityId: this.carDetailId, carNavCallback: (name: string, id: string): void => this.openCarDetail(name, id), carBackCallback: (): void => this.closeCarDetail() })
        } else if (this.carDetailName === 'Search') {
          SearchContent({ pathStack: this.pathStack, carNavCallback: (name: string, id: string): void => this.openCarDetail(name, id), carBackCallback: (): void => this.closeCarDetail() })
        }
      }
      .layoutWeight(1)
      .width('100%')
      .backgroundColor(this.theme.colors.background)

      // 下半：底部 tab 栏（与 GlobalBottomBar 同款样式/逻辑，写 AppStorage('mainTabIndex')）
      Row() {
        this.CarTabItem(t('navTabs.recommend'), 'home', 0)
        this.CarTabItem(t('navTabs.soundcang'), 'headphones', 1)
        this.CarTabItem(t('navTabs.mine'), 'person', 2)
      }
      .width('100%').height(56)
      .justifyContent(FlexAlign.SpaceAround)
      .alignItems(VerticalAlign.Center)
      .border({ width: { top: 0.5 }, color: this.theme.colors.border })
      .backgroundColor(this.theme.colors.tabBar)
    }
    .layoutWeight(1)
    .height('100%')
    .backgroundColor(this.theme.colors.background)
  }

  /** 关闭车机模式右栏详情页，返回 tab 内容 */
  closeCarDetail(): void {
    this.carDetailName = '';
    this.carDetailId = '';
  }

  /** 车机模式下打开右栏详情页 */
  openCarDetail(name: string, id: string): void {
    this.carDetailName = name;
    this.carDetailId = id;
  }

  /**
   * 车机模式底部 tab 栏里的单个 tab 按钮（与 GlobalBottomBar.TabItem 同款结构）。
   * 复用 mainTabIndex AppStorage：写入后 HomeTab/LibraryTab/PersonalTab 的
   * @StorageLink('mainTabIndex') 触发重渲，visibility 切到对应子树。
   */
  @Builder
  CarTabItem(label: string, icon: AppIconName, index: number) {
    Column() {
      AppIcon({
        name: icon,
        iconSize: 24,
        color: this.currentIndex === index ? this.theme.colors.tabBarActive : this.theme.colors.tabBarInactive,
      })
        .margin({ bottom: 4 })
      Text(label)
        .fontSize(12)
        .fontColor(this.currentIndex === index ? this.theme.colors.tabBarActive : this.theme.colors.tabBarInactive)
    }
    .width('33%').height(56).justifyContent(FlexAlign.Center)
    .onClick((): void => {
      // 车机模式下切 tab：如果右栏在详情页，先关闭详情页回到 tab 根内容
      if (this.carModeEnabled && this.carDetailName !== '') {
        this.closeCarDetail();
      }
      AppStorage.setOrCreate<number>('mainTabIndex', index);
    })
  }
}
