import { WidgetBackground } from './WidgetBackground';
import { WidgetCover } from './WidgetCover';
import { LockedCard } from './LockedCard';
import { WidgetIcon } from './WidgetIcon';
import { WIDGET_COLOR, WIDGET_FONT, WIDGET_PADDING } from './WidgetConstants';

/**
 * 上新单曲卡片（对齐 iOS AudioDockLatestWidget）。
 *
 * 4x4 L 尺寸：标题「上新单曲」+ 右上播放/暂停 + 刷新按钮 + 5 条新歌
 * 每行：封面 40x40 圆角 8 + 标题/歌手 + 行内播放
 *
 * 背景：首张新歌封面 + 模糊（对齐 iOS），无封面时回落到深紫蓝渐变。
 */

@Entry
@Component
struct LatestCard {
  @LocalStorageProp('items') items: object = [];
  @LocalStorageProp('updatedAt') updatedAt: number = 0;
  @LocalStorageProp('isPlaying') isPlaying: boolean = false;
  @LocalStorageProp('isLocked') isLocked: boolean = false;

  build() {
    if (this.isLocked) {
      LockedCard();
    } else {
      Stack() {
        // 封面磨砂玻璃背景（对齐 iOS `WidgetBackground`）
        WidgetBackground({
          cover: this.firstCover(),
          colorPrimary: '#3a3a5e',
          colorSecondary: '#222246',
        });

        Column({ space: 8 }) {
          // 标题行
          Row({ space: 8 }) {
            Text('上新单曲')
              .fontSize(WIDGET_FONT.titleLarge)
              .fontWeight(FontWeight.Bold)
              .fontColor(WIDGET_COLOR.fg);
            Blank();
            this.headerPlayButton();
            this.refreshButton();
          }
          .width('100%');

          // 列表
          Column({ space: 4 }) {
            ForEach(this.toItemArray(), (item: LatestRowData, index: number): void => {
              this.rowView(item, index);
            }, (item: LatestRowData, index: number): string => `${index}-${item.id}`);
          }
          .layoutWeight(1)
          .width('100%');
        }
        .width('100%')
        .height('100%')
        .padding(WIDGET_PADDING.card)
        .alignItems(HorizontalAlign.Start);
      }
      .width('100%')
      .height('100%')
      .borderRadius(16);
    }
  }

  private firstCover(): string {
    const arr = this.toItemArray();
    if (arr.length === 0) return '';
    return arr[0].cover;
  }

  @Builder
  headerPlayButton() {
    // 不用 WidgetIcon(name) 按值传参：图标名不会随状态刷新（真机实测冻结），
    // 双 Image + visibility 绑定才有响应式。
    Stack({ alignContent: Alignment.Center }) {
      Circle({ width: 36, height: 36 })
        .fill('#26FFFFFF');
      Image($r('app.media.ic_pause'))
        .width(18)
        .height(18)
        .fillColor(WIDGET_COLOR.fg)
        .visibility(this.isPlaying ? Visibility.Visible : Visibility.None);
      Image($r('app.media.ic_play'))
        .width(18)
        .height(18)
        .fillColor(WIDGET_COLOR.fg)
        .visibility(this.isPlaying ? Visibility.None : Visibility.Visible);
    }
    .width(36)
    .height(36)
    .onClick((): void => {
      this.sendCommand(this.isPlaying ? 'pause' : 'play');
    });
  }

  @Builder
  refreshButton() {
    Stack({ alignContent: Alignment.Center }) {
      Circle({ width: 36, height: 36 })
        .fill('#1AFFFFFF');
      WidgetIcon('refresh', 20, WIDGET_COLOR.fg);
    }
    .width(36)
    .height(36)
    .onClick((): void => {
      this.sendCommand('refresh_latest');
    });
  }

  @Builder
  rowView(item: LatestRowData, _index: number) {
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
        this.sendCommand('play_latest', item.id);
      });
    }
    .width('100%')
    .height(42);
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

  private toItemArray(): LatestRowData[] {
    const raw = this.items;
    if (!Array.isArray(raw)) return [];
    const out: LatestRowData[] = [];
    for (let i = 0; i < raw.length; i++) {
      const it = raw[i] as Record<string, string>;
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

interface LatestRowData {
  id: string;
  title: string;
  artist: string;
  cover: string;
}
