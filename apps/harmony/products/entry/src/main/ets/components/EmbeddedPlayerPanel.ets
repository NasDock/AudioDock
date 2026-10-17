import router from '@ohos.router';
import { formatDuration } from 'audiodock_common';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t } from 'features_i18n';
import type { LyricLine } from 'features_player';
import { playerStore } from '../context/PlayerStore';
import type { PlayerStateView, Track } from '../context/PlayerStore';
import { CoverImage } from './CoverImage';
import { AppIcon, AppIconName } from './AppIcon';
import { likesHistory } from '../services/LikesHistoryService';

/** likesHistory.on('trackLike', ...) 回调载荷（不能写内联对象字面量类型） */
interface TrackLikePayload {
  id: string;
  liked: boolean;
}

/**
 * 车机模式左侧 9:16 面板里的嵌入式播放器（对齐 mobile PlayerDetailView embedded 模式）。
 *
 * 仅承载核心播放体验：封面 + 曲名/艺人 + 喜欢 + 进度条 + 上一首/播放/下一首。
 * 不包含歌词视图、小爱音箱投放、同步播放邀请、睡眠定时等次要功能——
 * 这些放在 9:16 窄面板里会非常拥挤，需要时直接点击面板底部进 PlayerPage 全屏使用。
 *
 * 全屏播放器入口：点击面板任意位置 → router.pushUrl({ url: 'pages/PlayerPage' })。
 * 留白态文案：当 playerStore.queue 为空时显示「AudioDock / 听见你的声音」占位。
 */
@Component
export struct EmbeddedPlayerPanel {
  @State private view: PlayerStateView = playerStore.view();
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State theme: Theme = buildTheme('light');
  @State liked: boolean = false;
  @State showLyrics: boolean = false;  // 封面/歌词切换：false=封面，true=歌词
  private unsub: () => void = () => {};
  private unsubLike: () => void = () => {};
  private lastTrackId: string = '';
  // 歌词滚动状态：activeLyricIndex 变化时 scrollToIndex 居中当前行（对齐 PlayerPage 横屏右列的处理）。
  private lyricScroller: Scroller = new Scroller();
  private lastLyricIndex: number = -1;

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.unsub = playerStore.subscribe((): void => {
      this.view = playerStore.view();
      const cur = this.current();
      const curId = cur ? cur.id : '';
      if (curId !== this.lastTrackId) {
        this.lastTrackId = curId;
        this.refreshLike();
      }
      // 歌词滚动：activeLyricIndex 变化时自动滚动到当前行（对齐 PlayerPage 横屏右列）。
      // 9:16 窄面板里歌词区只占少量高度，scrollToIndex 居中即可。
      if (this.view.activeLyricIndex !== this.lastLyricIndex &&
          this.view.activeLyricIndex >= 0) {
        this.lastLyricIndex = this.view.activeLyricIndex;
        this.lyricScroller.scrollToIndex(this.lastLyricIndex, true, ScrollAlign.CENTER);
      }
    });
    this.unsubLike = likesHistory.on('trackLike', (p): void => {
      const cur = this.current();
      const payload = p as TrackLikePayload;
      if (cur && payload.id === cur.id) this.liked = payload.liked;
    });
    const cur = this.current();
    this.lastTrackId = cur ? cur.id : '';
    this.refreshLike();
  }

  aboutToDisappear(): void {
    this.unsub();
    this.unsubLike();
  }

  private current(): Track | null {
    if (this.view.queue.length === 0) return null;
    return this.view.queue[this.view.currentIndex] ?? null;
  }

  private refreshLike(): void {
    const cur = this.current();
    if (!cur) { this.liked = false; return; }
    likesHistory.isTrackLiked(cur.id)
      .then((v: boolean): void => { this.liked = v; })
      .catch((): void => undefined);
  }

  private toggleLike(): void {
    const cur = this.current();
    if (!cur) return;
    if (this.liked) {
      likesHistory.unlikeTrack(cur.id).catch((): void => undefined);
    } else {
      likesHistory.likeTrack(cur.id).catch((): void => undefined);
    }
  }

  private playModeIcon(): AppIconName {
    switch (this.view.playMode) {
      case 'SHUFFLE': return 'shuffle';
      case 'LOOP_LIST': return 'repeat';
      case 'LOOP_SINGLE': return 'repeat-once';
      default: return 'playlist';
    }
  }

  private openFullPlayer(): void {
    router.pushUrl({ url: 'pages/PlayerPage' }).catch((): void => undefined);
  }

  /** 切换封面/歌词显示（车机模式专用，不进入详情页） */
  private toggleCoverLyrics(): void {
    if (this.view.lyrics.length > 0) {
      this.showLyrics = !this.showLyrics;
    }
  }

  build() {
    Column() {
      if (this.view.queue.length === 0 || !this.current()) {
        // 留白态：车机空状态文案（对齐 mobile player.tsx 的 carEmptyState）
        Column() {
          Text('AudioDock')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.theme.colors.text)
            .margin({ bottom: 8 })
          Text(t('player.empty'))
            .fontSize(14)
            .fontColor(this.theme.colors.textSecondary)
            .opacity(0.55)
            .textAlign(TextAlign.Center)
            .padding({ left: 16, right: 16 })
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
      } else {
        // 顶部曲名 + 喜欢
        Column({ space: 6 }) {
          Text(this.current()?.title ?? '')
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.theme.colors.text)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('90%')
            .textAlign(TextAlign.Center)

          Row({ space: 8 }) {
            Text(this.current()?.artist ?? '')
              .fontSize(13)
              .fontColor(this.theme.colors.textSecondary)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
              .textAlign(TextAlign.Center)

            AppIcon({
              name: this.liked ? 'heart-fill' : 'heart',
              iconSize: 18,
              color: this.liked ? this.theme.colors.primary : this.theme.colors.textSecondary,
            })
              .width(28).height(28)
              .onClick((): void => this.toggleLike())
          }
          .width('90%')
          .justifyContent(FlexAlign.Center)
        }
        .width('100%')
        .margin({ top: 12, bottom: 12 })
        .alignItems(HorizontalAlign.Center)

        // 封面/歌词切换区（点击切换显示，不进入详情页）
        Stack() {
          if (this.showLyrics && this.view.lyrics.length > 0) {
            // 歌词视图（车机模式左侧 9:16 面板里的简化版，对齐 mobile landscape 右列）：
            // 自动滚动当前行居中；无字号调节。点击切回封面。
            List({ scroller: this.lyricScroller }) {
              ForEach(this.view.lyrics, (line: LyricLine, index: number) => {
                ListItem() {
                  Text(line.text)
                    .fontSize(index === this.view.activeLyricIndex ? 14 : 12)
                    .fontWeight(index === this.view.activeLyricIndex
                      ? FontWeight.Bold : FontWeight.Medium)
                    .fontColor(index === this.view.activeLyricIndex
                      ? this.theme.colors.primary : this.theme.colors.text)
                    .opacity(index === this.view.activeLyricIndex ? 1 : 0.5)
                    .textAlign(TextAlign.Center)
                    .width('100%')
                    .padding({ top: 4, bottom: 4, left: 12, right: 12 })
                }
              }, (line: LyricLine, index: number) => `${index}_${line.time}`);
            }
            .width('100%')
            .height('100%')
            .scrollBar(BarState.Off)
          } else {
            // 封面
            CoverImage({
              path: this.current()?.coverUrl ?? null,
              imgWidth: 200,
              imgHeight: 200,
              radius: 12,
              fallbackText: (this.current()?.title ?? '?').substring(0, 1),
            })
          }
        }
        .layoutWeight(1)
        .width('100%')
        .alignContent(Alignment.Center)
        .onClick((): void => this.toggleCoverLyrics())

        // 进度 + 控制行
        Column() {
          Row({ space: 10 }) {
            Text(formatDuration(this.view.currentMs))
              .fontSize(11)
              .fontColor(this.theme.colors.textSecondary)
              .width(40)
              .textAlign(TextAlign.End)

            // 进度条三段式：底轨 + 缓存层自绘（Stack 垫底），Slider trackColor 设透明。
            // ArkUI Slider 轨道两端内缩半个滑块宽，自定义层用 padding 内缩 8vp 对齐
            //（blockSize 显式固定为 16 保持 inset 可预期）。
            Stack() {
              Stack() {
                Row()
                  .width('100%')
                  .height(4)
                  .borderRadius(2)
                  .backgroundColor(this.theme.colors.border);
                Row()
                  .width(`${this.view.bufferedPercent}%`)
                  .height(4)
                  .borderRadius(2)
                  .backgroundColor(`#4D${this.theme.colors.primary.substring(3)}`);
              }
              .width('100%')
              .height(4)
              .padding({ left: 8, right: 8 });
              Slider({
                value: this.view.currentMs,
                min: 0,
                max: Math.max(1, this.view.durationMs),
              })
                .width('100%')
                .trackColor(Color.Transparent)
                .trackThickness(4)
                .blockSize({ width: 16, height: 16 })
                .selectedColor(this.theme.colors.primary)
                .blockColor(this.theme.colors.primary)
                .onChange((value: number, mode: SliderChangeMode): void => {
                  if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) {
                    playerStore.seek(value).catch((): void => undefined);
                  }
                });
            }
            .layoutWeight(1)
            .alignContent(Alignment.Center);

            Text(formatDuration(this.view.durationMs))
              .fontSize(11)
              .fontColor(this.theme.colors.textSecondary)
              .width(40)
          }
          .width('100%')
          .margin({ bottom: 16 })

          // 控制行：上一首 / 播放 / 下一首 + 播放模式（精简版，9:16 宽度下不堆模式/列表入口）
          Row() {
            AppIcon({ name: this.playModeIcon(), iconSize: 20, color: this.theme.colors.textSecondary })
              .width(36).height(36)
              .onClick((): void => {
                playerStore.togglePlayMode();
              })

            Row({ space: 24 }) {
              AppIcon({ name: 'skip-back', iconSize: 26, color: this.theme.colors.text })
                .width(40).height(40)
                .onClick((): void => {
                  playerStore.playPrevious().catch((): void => undefined);
                })

              Stack() {
                AppIcon({
                  name: this.view.isPlaying ? 'pause' : 'play',
                  iconSize: 26,
                  color: this.theme.colors.background,
                });
              }
              .width(56).height(56)
              .borderRadius(28)
              .backgroundColor(this.theme.colors.text)
              .alignContent(Alignment.Center)
              .onClick((): void => {
                playerStore.togglePlay().catch((): void => undefined);
              })

              AppIcon({ name: 'skip-forward', iconSize: 26, color: this.theme.colors.text })
                .width(40).height(40)
                .onClick((): void => {
                  playerStore.playNext().catch((): void => undefined);
                })
            }
            .layoutWeight(1)
            .justifyContent(FlexAlign.Center)

            // 入口按钮：跳到全屏 PlayerPage 使用列表/歌词/小爱音箱/同步等次要功能
            AppIcon({ name: 'expand', iconSize: 18, color: this.theme.colors.textSecondary })
              .width(36).height(36)
              .onClick((): void => this.openFullPlayer())
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)
          .alignItems(VerticalAlign.Center)
        }
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 20 })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.theme.colors.background);
  }
}