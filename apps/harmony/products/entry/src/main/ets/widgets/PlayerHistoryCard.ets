import { WidgetBackground } from './WidgetBackground';
import { WidgetCover } from './WidgetCover';
import { LockedCard } from './LockedCard';
import { WidgetIcon } from './WidgetIcon';
import { WIDGET_COLOR, WIDGET_FONT, WIDGET_PADDING, WIDGET_RADIUS } from './WidgetConstants';

/**
 * 播放与听过卡片（对齐 iOS AudioDockPlayerHistoryWidget）。
 *
 * 4x4 L 尺寸：
 * - 顶部正在播放（封面 96x96 圆角 12 + 歌名/歌手 + 三键播控）
 * - 下方 3 条最近听过（封面 40x40 圆角 8 + 标题/歌手 + 行内播放）
 *
 * 数据：FormBindingData.nowPlaying + items
 */

@Entry
@Component
struct PlayerHistoryCard {
  @LocalStorageProp('nowPlaying') nowPlaying: object | null = null;
  @LocalStorageProp('items') items: object = [];
  @LocalStorageProp('updatedAt') updatedAt: number = 0;
  @LocalStorageProp('isLocked') isLocked: boolean = false;

  build() {
    if (this.isLocked) {
      LockedCard();
    } else {
      Stack() {
        // 顶部正在播放有封面时用封面做整体背景
        this.maybeBackdrop();

        Column({ space: 10 }) {
          // 顶部正在播放区
          this.nowPlayingBlock();

          // 分隔
          Row()
            .width('100%')
            .height(1)
            .backgroundColor('#1AFFFFFF');

          // 历史列表
          Column({ space: 6 }) {
            ForEach(this.toItemArray(), (item: HistoryRowData, index: number): void => {
              this.rowView(item, index);
            }, (item: HistoryRowData, index: number): string => `${index}-${item.id}`);
          }
          .layoutWeight(1)
          .width('100%');
        }
        .width('100%')
        .height('100%')
        .padding(WIDGET_PADDING.card);
      }
      .width('100%')
      .height('100%')
      .backgroundColor('#1a1a2e')
      .borderRadius(16);
    }
  }

  @Builder
  maybeBackdrop() {
    WidgetBackground({
      cover: this.toNowPlaying()?.cover ?? '',
      colorPrimary: '#3a3a5e',
      colorSecondary: '#222246',
    });
  }

  @Builder
  nowPlayingBlock() {
    Row({ space: 10 }) {
      WidgetCover({ cover: this.toNowPlaying()?.cover ?? '', preset: 'large' });

      Column({ space: 4 }) {
        Text(this.toNowPlaying()?.title ?? '未在播放')
          .fontSize(WIDGET_FONT.titleLarge)
          .fontColor(WIDGET_COLOR.fg)
          .fontWeight(FontWeight.Bold)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%');
        Text(this.toNowPlaying()?.artist ?? ' ')
          .fontSize(WIDGET_FONT.artistLarge)
          .fontColor(WIDGET_COLOR.fgSecondary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%');
        Blank();
        this.transportRow();
      }
      .layoutWeight(1)
      .height('100%')
      .alignItems(HorizontalAlign.Start);
    }
    .width('100%')
    .height(110);
  }

  @Builder
  transportRow() {
    Row({ space: 12 }) {
      this.iconBtn('prev', 'prev');
      this.playPauseBtn();
      this.iconBtn('next', 'next');
    }
    .width('100%');
  }

  @Builder
  playPauseBtn() {
    // 不用 iconBtn(name, method) 按值传参：图标名不会随状态刷新（真机实测冻结），
    // 双 Image + visibility 绑定才有响应式。
    Stack({ alignContent: Alignment.Center }) {
      Image($r('app.media.ic_pause'))
        .width(34)
        .height(34)
        .fillColor(WIDGET_COLOR.fg)
        .visibility(this.toNowPlaying()?.isPlaying ? Visibility.Visible : Visibility.None);
      Image($r('app.media.ic_play'))
        .width(34)
        .height(34)
        .fillColor(WIDGET_COLOR.fg)
        .visibility(this.toNowPlaying()?.isPlaying ? Visibility.None : Visibility.Visible);
    }
    .width(56)
    .height(56)
    .borderRadius(WIDGET_RADIUS.button)
    .onClick((): void => {
      this.sendCommand(this.toNowPlaying()?.isPlaying ? 'pause' : 'play');
    });
  }

  @Builder
  iconBtn(icon: string, method: string) {
    Stack({ alignContent: Alignment.Center }) {
      WidgetIcon(icon, 34, WIDGET_COLOR.fg);
    }
    .width(56)
    .height(56)
    .borderRadius(WIDGET_RADIUS.button)
    .onClick((): void => {
      this.sendCommand(method);
    });
  }

  @Builder
  rowView(item: HistoryRowData, _index: number) {
    Row({ space: 8 }) {
      WidgetCover({ cover: item.cover, preset: 'small' });
      Column({ space: 2 }) {
        Text(item.title || '—')
          .fontSize(WIDGET_FONT.titleList)
          .fontWeight(FontWeight.Medium)
          .fontColor(WIDGET_COLOR.fg)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis });
        Text(item.artist || ' ')
          .fontSize(WIDGET_FONT.artistList)
          .fontColor(WIDGET_COLOR.fgSecondary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis });
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start);

      Stack({ alignContent: Alignment.Center }) {
        Circle({ width: 22, height: 22 })
          .fill('#1AFFFFFF');
        WidgetIcon('play', 10, WIDGET_COLOR.fg);
      }
      .width(22)
      .height(22)
      .onClick((): void => {
        this.sendCommand('play_history', item.id);
      });
    }
    .width('100%')
    .height(44);
  }

  /**
   * 播控指令统一直达主 App（对齐官方 CardInfoRefresh 示例的 call 事件）。
   * 详见 AudioDockPlayerCard.sendCommand。
   */
  private sendCommand(method: string, id: string = ''): void {
    try {
      const params: Record<string, string> = {};
      params['method'] = 'widgetCommand';
      params['widgetAction'] = method;
      if (id !== '') params['id'] = id;
      postCardAction(this, {
        action: 'call',
        abilityName: 'EntryAbility',
        params,
      });
    } catch (e) { /* swallow */ }
  }

  private toNowPlaying(): NowPlayingLite | null {
    if (!this.nowPlaying || typeof this.nowPlaying !== 'object') return null;
    const o = this.nowPlaying as Record<string, string | number | boolean>;
    return {
      title: String(o['title'] ?? ''),
      artist: String(o['artist'] ?? ''),
      cover: String(o['cover'] ?? ''),
      isPlaying: !!o['isPlaying'],
    };
  }

  private toItemArray(): HistoryRowData[] {
    const raw = this.items;
    if (!Array.isArray(raw)) return [];
    const out: HistoryRowData[] = [];
    for (let i = 0; i < raw.length; i++) {
      const it = raw[i] as Record<string, string | number | boolean>;
      if (!it || typeof it !== 'object') continue;
      out.push({
        id: String(it['id'] ?? ''),
        title: String(it['title'] ?? ''),
        artist: String(it['artist'] ?? ''),
        cover: String(it['cover'] ?? ''),
      });
    }
    return out;
  }
}

interface NowPlayingLite {
  title: string;
  artist: string;
  cover: string;
  isPlaying: boolean;
}

interface HistoryRowData {
  id: string;
  title: string;
  artist: string;
  cover: string;
}
