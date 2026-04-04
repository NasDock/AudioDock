interface CommonConstantsInterface {
  columnXs: number;
  columnSm: number;
  columnMd: number;
  columnLg: number;
  spanXs: number;
  spanSm: number;
  spanMd: number;
  spanLg: number;
  offsetXs: number;
  offsetSm: number;
  offsetMd: number;
  offsetLg: number;
  listFontWeight: number;
  listWidth: string;
  listItemWidth: string;
  columnHeight: string;
  bundleName: string;
  abilityName: string;
  breakpointsInitializeName: string;
  locationCapability: string;
  breakpointSystemName: string;
  systemColumnHeight: string;
  systemColumnWidth: string;
  systemRowWidth: string;
  textFontWeight: number;
  adaptiveColumnWidth: string;
  adaptiveColumnHeight: string;
  adaptiveFlexibleColumnWidth: string;
  adaptiveFlexShrink: number;
}

/**
 * Common constants for all features.
 */
export const commonConstants: CommonConstantsInterface = {
  /**
   * The number of columns for XS device.
   */
  columnXs: 4,

  /**
   * The number of columns for SM device.
   */
  columnSm: 4,

  /**
   * The number of columns for MD device.
   */
  columnMd: 8,

  /**
   * The number of columns for LG device.
   */
  columnLg: 12,

  /**
   * The number of span for XS device.
   */
  spanXs: 4,

  /**
   * The number of span for SM device.
   */
  spanSm: 4,

  /**
   * The number of span for MD device.
   */
  spanMd: 4,

  /**
   * The number of span for LG device.
   */
  spanLg: 4,

  /**
   * The number of offset for XS device.
   */
  offsetXs: 0,

  /**
   * The number of offset for SM device.
   */
  offsetSm: 0,

  /**
   * The number of offset for MD device.
   */
  offsetMd: 2,

  /**
   * The number of offset for LG device.
   */
  offsetLg: 4,

  /**
   * Font weight of the list.
   */
  listFontWeight: 500,

  /**
   *Width of the list.
   */
  listWidth: '100%',

  /**
   * The percentage of width of the list item.
   */
  listItemWidth: '100%',

  /**
   * The percentage of height of the column.
   */
  columnHeight: '100%',

  /**
   * The name of the bundleName.
   */
  bundleName: 'com.example.myapplication',

  /**
   * The name of the abilityName.
   */
  abilityName: 'ResponsiveLayoutItemAbility',

  /**
   * Initialize device breakpoints.
   */
  breakpointsInitializeName: 'md',

  /**
   * Localization ability.
   */
  locationCapability: 'SystemCapability.Location.Location.Core',

  /**
   * Breakpoint name.
   */
  breakpointSystemName: 'mainBreakpoint',

  /**
   * The percentage of height of column component.
   */
  systemColumnHeight: '100%',

  /**
   * The percentage of width of column component.
   */
  systemColumnWidth: '100%',

  /**
   * The percentage of width of row component.
   */
  systemRowWidth: '100%',

  /**
   * Font weight of text component.
   */
  textFontWeight: 500,

  /**
   * The percentage of width of column component.
   */
  adaptiveColumnWidth: '100%',

  /**
   * The percentage of height of column component.
   */
  adaptiveColumnHeight: '100%',

  /**
   * The percentage of height of column component.
   */
  adaptiveFlexibleColumnWidth: '100%',

  /**
   * The value of shrink of column component.
   */
  adaptiveFlexShrink: 1
};