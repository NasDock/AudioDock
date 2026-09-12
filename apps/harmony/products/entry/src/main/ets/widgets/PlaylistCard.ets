import { WidgetBackground } from './WidgetBackground';
import { WidgetCover } from './WidgetCover';
import { LockedCard } from './LockedCard';
import { WidgetIcon } from './WidgetIcon';
import { WIDGET_COLOR, WIDGET_FONT, WIDGET_PADDING } from './WidgetConstants';

/**
 * 播放列表卡片（对齐 iOS AudioDockPlaylistWidget）。
 *
 * 4x4 L 尺寸：标题「播放列表」+ 右上播放/暂停 + 前 3 个歌单
 * 每行：封面 44x44 圆角 8 + 名字 + 行内播放按钮
 *
 * 背景：首张歌单封面 + 模糊（对齐 iOS），无封面时回落到深紫蓝渐变。
 * 数据来源：FormBindingData.items (PlaylistsSnapshotItem[])
 */

@Entry
@Component
struct PlaylistCard {
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
            Text('播放列表')
              .fontSize(WIDGET_FONT.titleLarge)
              .fontWeight(FontWeight.Bold)
              .fontColor(WIDGET_COLOR.fg);
            Blank();
            this.headerPlayButton();
          }
          .width('100%');

          // 列表
          Column({ space: 6 }) {
            ForEach(this.toItemArray(), (item: PlaylistRowData, index: number): void => {
              this.rowView(item, index);
            }, (item: PlaylistRowData, index: number): string => `${index}-${item.id}`);
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
      Circle({ width: 40, height: 40 })
        .fill('#26FFFFFF');
      Image($r('app.media.ic_pause'))
        .width(20)
        .height(20)
        .fillColor(WIDGET_COLOR.fg)
        .visibility(this.isPlaying ? Visibility.Visible : Visibility.None);
      Image($r('app.media.ic_play'))
        .width(20)
        .height(20)
        .fillColor(WIDGET_COLOR.fg)
        .visibility(this.isPlaying ? Visibility.None : Visibility.Visible);
    }
    .width(40)
    .height(40)
    .onClick((): void => {
      this.sendCommand(this.isPlaying ? 'pause' : 'play');
    });
  }

  @Builder
  rowView(item: PlaylistRowData, _index: number) {
    Row({ space: 8 }) {
      WidgetCover({ cover: item.cover, preset: 'small' });
      Column({ space: 2 }) {
        Text(item.name || '—')
          .fontSize(WIDGET_FONT.titleList)
          .fontWeight(FontWeight.Medium)
          .fontColor(WIDGET_COLOR.fg)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis });
        Text(this.formatCount(item.trackCount))
          .fontSize(WIDGET_FONT.artistList)
          .fontColor(WIDGET_COLOR.fgSecondary);
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start);

      // 行内播放按钮
      Stack({ alignContent: Alignment.Center }) {
        Circle({ width: 24, height: 24 })
          .fill('#1AFFFFFF');
        WidgetIcon('play', 11, WIDGET_COLOR.fg);
      }
      .width(24)
      .height(24)
      .onClick((): void => {
        this.sendCommand('play_playlist', item.id);
      });
    }
    .width('100%')
    .height(48);
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

  /**
   * 把 FormBindingData 里的 items（object 类型，ArkTS 严格模式不让直接转）转成 RowData 数组。
   * ArkTS 不允许 `as unknown as T[]`，用 Object.entries + 类型守卫显式构造。
   */
  private toItemArray(): PlaylistRowData[] {
    const raw = this.items;
    if (!Array.isArray(raw)) return [];
    const out: PlaylistRowData[] = [];
    for (let i = 0; i < raw.length; i++) {
      const it = raw[i] as Record<string, string | number>;
      if (!it || typeof it !== 'object') continue;
      out.push({
        id: String(it['id'] ?? ''),
        name: String(it['name'] ?? ''),
        cover: String(it['cover'] ?? ''),
        trackCount: typeof it['trackCount'] === 'number' ? it['trackCount'] : 0,
      });
    }
    return out;
  }

  private formatCount(n: number): string {
    if (n <= 0) return ' ';
    return `${n} 首`;
  }
}

interface PlaylistRowData {
  id: string;
  name: string;
  cover: string;
  trackCount: number;
}
