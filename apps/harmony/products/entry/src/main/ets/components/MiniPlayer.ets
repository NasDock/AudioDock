import router from '@ohos.router';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { Logger } from 'audiodock_common';
import { trackApi } from 'features_network';
import type { PlaybackQualityOption, PlaybackQualityProfile } from 'features_network';
import { playerStore } from '../context/PlayerStore';
import type { PlayerStateView, Track } from '../context/PlayerStore';
import { getCurrentQuality } from '../services/trackQuality';
import type { Quality } from '../services/trackQuality';
import { CoverImage } from './CoverImage';
import { AppIcon } from './AppIcon';

/** 迷你播放器是否有内容（队列非空）。空队列时不占高度，供页面计算底部避让留白。 */
export function miniPlayerHasContent(): boolean {
  return playerStore.view().queue.length > 0;
}

/**
 * 全局迷你播放器，布局与行为对齐 mobile 的 MiniPlayer：
 * 封面 40×40 + 标题/艺人 + 上一首/播放暂停/下一首，点击整行进 PlayerPage。
 * MainPage 已悬浮在 tab 栏上方；其余需要展示的页面在根 Column 末尾挂载，
 * 隐藏页面（登录/播放器/设置/音源管理/MV）与 mobile 的 hideBottomBar 一致不挂。
 */
@Component
export struct MiniPlayer {
  @State private view: PlayerStateView = playerStore.view();
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @StorageProp('appLang') appLang: string = 'zh-CN';
  @State theme: Theme = buildTheme('light');
  // 音频品质徽标（对齐 mini MiniPlayer：艺术家右侧纯展示，不可点击；
  // 选中口径与 PlayerPage 一致 = 设置页偏好档校验后回落 defaultQuality）
  @State private qualityLabel: string = '';
  private qualityTrackId: string = '';
  private unsub: () => void = () => {};

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.unsub = playerStore.subscribe(() => {
      this.view = playerStore.view();
      this.refreshQualityOnTrackChange();
    });
    this.refreshQualityOnTrackChange();
  }

  aboutToDisappear(): void {
    this.unsub();
  }

  private current(): Track | null {
    if (this.view.queue.length === 0) return null;
    return this.view.queue[this.view.currentIndex] ?? null;
  }

  /** 曲目变化时拉音质档位（对齐 PlayerPage.refreshQualityProfile 的口径与竞态处理） */
  private refreshQualityOnTrackChange(): void {
    const cur = this.current();
    const curId: string = cur ? cur.id : '';
    if (curId === this.qualityTrackId) return;
    this.qualityTrackId = curId;
    if (!cur || cur.contentType === 'AUDIOBOOK') {
      this.qualityLabel = '';
      return;
    }
    trackApi.playbackQualities(curId)
      .then((profile: PlaybackQualityProfile) => {
        return getCurrentQuality().then((preferred: Quality): void => {
          if (this.qualityTrackId !== curId) return; // 慢响应覆盖新曲目状态
          const options: PlaybackQualityOption[] = profile.options ?? [];
          let selected: string = profile.defaultQuality;
          if (options.some((o: PlaybackQualityOption): boolean => o.quality === preferred)) {
            selected = preferred;
          }
          const opt = options.find((o: PlaybackQualityOption): boolean => o.quality === selected);
          this.qualityLabel = opt ? opt.label : '无损';
        });
      })
      .catch((e: Error): void => {
        Logger.w('MiniPlayer', `refreshQuality failed: ${String(e)}`);
        if (this.qualityTrackId !== curId) return;
        this.qualityLabel = '无损'; // 兜底静态文案（对齐 PlayerPage）
      });
  }

  build() {
    if (this.view.queue.length > 0) {
      Row() {
        CoverImage({
          path: this.current()?.coverUrl ?? null,
          imgWidth: 40,
          imgHeight: 40,
          radius: 4,
          fallbackText: (this.current()?.title ?? '?').substring(0, 1),
        })
        Column({ space: 2 }) {
          Text(this.current()?.title ?? '')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.theme.colors.text)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          // 艺术家 + 品质徽标（对齐 mini MiniPlayer mini-artist-row）
          Row({ space: 6 }) {
            Text(this.current()?.artist ?? '')
              .fontSize(12)
              .fontColor(this.theme.colors.textSecondary)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .flexShrink(1)
            if (this.current()?.contentType !== 'AUDIOBOOK' && this.qualityLabel.length > 0) {
              Row() {
                Text(this.qualityLabel)
                  .fontSize(10)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.theme.colors.textSecondary)
              }
              .padding({ left: 6, right: 6, top: 1, bottom: 1 })
              .borderRadius(999)
              .border({ width: 1, color: this.theme.colors.border })
            }
          }
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        .margin({ left: 10 })

        Row({ space: 20 }) {
          AppIcon({ name: 'skip-back', iconSize: 20, color: this.theme.colors.text })
            .onClick(() => playerStore.playPrevious().catch(() => undefined))
          AppIcon({
            name: this.view.isPlaying ? 'pause' : 'play',
            iconSize: 20,
            color: this.theme.colors.primary,
          })
            .onClick(() => playerStore.togglePlay().catch(() => undefined))
          AppIcon({ name: 'skip-forward', iconSize: 20, color: this.theme.colors.text })
            .onClick(() => playerStore.playNext().catch(() => undefined))
        }
        .margin({ left: 10 })
      }
      .height(60)
      .width('100%')
      .backgroundColor(this.theme.colors.background)
      .padding({ left: 10, right: 10 })
      .onClick(() => router.pushUrl({ url: 'pages/PlayerPage' }));
    }
  }
}
