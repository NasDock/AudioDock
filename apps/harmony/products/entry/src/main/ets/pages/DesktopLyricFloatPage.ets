import { Logger } from 'audiodock_common';
import { moveDesktopLyricBy } from '../services/desktopLyricService';

/**
 * 桌面歌词悬浮窗内容页（由 desktopLyricService 的 TYPE_FLOAT 子窗口加载）。
 *
 * - 与主窗口同进程：歌词行 / 样式直接 @StorageLink 订阅 AppStorage，
 *   PlayerStore.onTimeUpdate 写入 'desktopLyricLine' 后本页自动刷新。
 * - 文字描边：ArkUI Text 无原生描边，用 4 方向 textShadow（radius=0）模拟。
 * - 拖动：PanGesture 累积 offset 换算增量（vp→px），回调 service moveWindowTo。
 */
@Entry
@Component
struct DesktopLyricFloatPage {
  @StorageLink('desktopLyricLine') lyricLine: string = '';
  @StorageLink('desktopLyricsFontSize') fontSize: number = 18;
  @StorageLink('desktopLyricsTextColor') textColor: string = '#FFFFFF';
  @StorageLink('desktopLyricsStrokeColor') strokeColor: string = '#000000';
  @StorageLink('desktopLyricsStrokeWidth') strokeWidth: number = 2;

  private lastOffsetX: number = 0;
  private lastOffsetY: number = 0;

  build() {
    Row() {
      Text(this.lyricLine.length > 0 ? this.lyricLine : ' ')
        .fontSize(this.fontSize)
        .fontColor(this.textColor)
        .fontWeight(FontWeight.Medium)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .textAlign(TextAlign.Center)
        .textShadow([
          { radius: 0, type: ShadowType.COLOR, color: this.strokeColor, offsetX: this.strokeWidth, offsetY: 0 },
          { radius: 0, type: ShadowType.COLOR, color: this.strokeColor, offsetX: -this.strokeWidth, offsetY: 0 },
          { radius: 0, type: ShadowType.COLOR, color: this.strokeColor, offsetX: 0, offsetY: this.strokeWidth },
          { radius: 0, type: ShadowType.COLOR, color: this.strokeColor, offsetX: 0, offsetY: -this.strokeWidth },
        ])
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .padding({ left: 16, right: 16 })
    .gesture(
      PanGesture({ fingers: 1, distance: 6 })
        .onActionStart((): void => {
          this.lastOffsetX = 0;
          this.lastOffsetY = 0;
        })
        .onActionUpdate((event: GestureEvent): void => {
          const dx = event.offsetX - this.lastOffsetX;
          const dy = event.offsetY - this.lastOffsetY;
          this.lastOffsetX = event.offsetX;
          this.lastOffsetY = event.offsetY;
          // PanGesture offset 单位 vp，moveWindowTo 单位 px，需 vp2px 换算
          moveDesktopLyricBy(vp2px(dx), vp2px(dy)).catch((e: Error): void => {
            Logger.w('DesktopLyricFloatPage', `move failed: ${String(e)}`);
          });
        })
    )
  }
}
