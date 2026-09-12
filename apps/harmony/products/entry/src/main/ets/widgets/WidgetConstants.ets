/**
 * 桌面小部件尺寸/颜色/间距常量（对齐 iOS AudioDockWidget 视觉规范）。
 *
 * 卡片尺寸单位为 vp（虚拟像素，720p 设计稿）。
 * iOS 小部件对 HarmonyOS 卡片尺寸映射：
 *   iOS small 158x158  → HarmonyOS 2x2   (158 x 158 vp)
 *   iOS medium 338x158 → HarmonyOS 4x2   (326 x 158 vp)
 *   iOS large 338x338  → HarmonyOS 4x4   (326 x 326 vp)
 */

/** HarmonyOS 卡片标准尺寸（vp） */
export class WIDGET_SIZE {
  static readonly S2_W: number = 158;
  static readonly S2_H: number = 158;
  static readonly M4_W: number = 326;
  static readonly M4_H: number = 158;
  static readonly L4_W: number = 326;
  static readonly L4_H: number = 326;
  static readonly PORTRAIT_W: number = 158;
  static readonly PORTRAIT_H: number = 326;
}

/** 字号（fp）—— 与 iOS 字号保持视觉一致 */
export class WIDGET_FONT {
  static readonly titleLarge: number = 14;
  static readonly artistLarge: number = 12;
  static readonly titleList: number = 13;
  static readonly artistList: number = 11;
  static readonly titleSmall: number = 11;
  static readonly lockTitle: number = 14;
  static readonly lockSub: number = 11;
  static readonly badge: number = 9;
}

/** 圆角（vp） */
export class WIDGET_RADIUS {
  static readonly coverLarge: number = 14;
  static readonly coverMedium: number = 12;
  static readonly coverSmall: number = 8;
  static readonly card: number = 16;
  static readonly button: number = 999;
}

/** 颜色（ArkUI 8 位 hex 是 #AARRGGBB，透明度在前，不是 CSS 的 #RRGGBBAA） */
export class WIDGET_COLOR {
  static readonly fg: string = '#FFFFFF';
  static readonly fgSecondary: string = '#B3FFFFFF';
  static readonly fgTertiary: string = '#80FFFFFF';
  static readonly placeholderBg: string = '#1AFFFFFF';
  static readonly btnActiveBg: string = '#26FFFFFF';
  static readonly overlayDark: string = '#38000000';
  static readonly overlayLight: string = '#14FFFFFF';
}

/** 间距 */
export class WIDGET_PADDING {
  static readonly card: number = 12;
  static readonly cardSmall: number = 8;
  static readonly listItemGap: number = 8;
}

/** iOS mode 按钮的 cycle 顺序 */
export const MODE_CYCLE_ORDER: ReadonlyArray<string> =
  ['SEQUENCE', 'SHUFFLE', 'LOOP_LIST', 'LOOP_SINGLE'];

/** getImageUrl 在卡片里使用的尺寸：固定 300 */
export const WIDGET_THUMB_WIDTH: number = 300;
