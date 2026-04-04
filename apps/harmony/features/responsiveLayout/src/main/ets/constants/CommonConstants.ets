interface CommonConstantsInterface {
  breakpointsSmName: string;
  breakpointsMdName: string;
  breakpointsLgName: string;
  breakpointsXlName: string;
  tabSmVertical: boolean;
  tabMdVertical: boolean;
  tabLgVertical: boolean;
  tabXlVertical: boolean;
  tabSmBarWidth: string;
  tabMdBarWidth: string;
  tabLgBarWidth: string;
  tabXlBarWidth: string;
  tabSmBarHeight: string;
  tabMdBarHeight: string;
  tabLgBarHeight: string;
  tabXlBarHeight: string;
  tabContentWidth: string;
  tabContentHeight: string;
  flexTabBarWidth: string;
  flexTabBarHeight: string;
  firstTabChooseIndex: number;
  columnHeight: string;
  tabSize: number;
  gridSize: number;
  breakpointsInitializeName: string;
  columnAspectRatio: number;
  columnTextFontWeight: number;
  rowWidth: string;
  smColTemplate: string;
  mdColTemplate: string;
  lgColTemplate: string;
  xlColTemplate: string;
  initializeTemplate: string;
  breakpointSystemName: string;
}

/**
 * Common constants for all features.
 */
export const commonConstants: CommonConstantsInterface = {
  /**
   * Breakpoint sm.
   */
  breakpointsSmName: 'sm',

  /**
   * Breakpoint md.
   */
  breakpointsMdName: 'md',

  /**
   * Breakpoint lg.
   */
  breakpointsLgName: 'lg',

  /**
   * Breakpoint xl.
   */
  breakpointsXlName: 'xl',

  /**
   * The value of tab vertical in sm device.
   */
  tabSmVertical: false,

  /**
   * The value of tab vertical in md device.
   */
  tabMdVertical: false,

  /**
   * The value of tab vertical in lg device.
   */
  tabLgVertical: true,

  /**
   * The value of tab vertical in xl device.
   */
  tabXlVertical: true,

  /**
   * The percentage of width of tab bar in sm device.
   */
  tabSmBarWidth: '100%',

  /**
   * The percentage of width of tab bar in md device.
   */
  tabMdBarWidth: '100%',

  /**
   * The width of tab bar in lg device.
   */
  tabLgBarWidth: '96vp',

  /**
   * The width of tab bar in xl device.
   */
  tabXlBarWidth: '96vp',

  /**
   * The height of tab bar in sm device.
   */
  tabSmBarHeight: '56vp',

  /**
   * The height of tab bar in md device.
   */
  tabMdBarHeight: '56vp',

  /**
   * The percentage of height tab bar in lg device.
   */
  tabLgBarHeight: '60%',

  /**
   * The percentage of height tab bar in xl device.
   */
  tabXlBarHeight: '60%',

  /**
   * The percentage of width of tab content.
   */
  tabContentWidth: '100%',

  /**
   * The percentage of height of tab content.
   */
  tabContentHeight: '100%',

  /**
   * The percentage of width of flex component.
   */
  flexTabBarWidth: '100%',

  /**
   * The percentage of height of flex component.
   */
  flexTabBarHeight: '100%',

  /**
   * The percentage of height in row component.
   */
  firstTabChooseIndex: 0,

  /**
   * The percentage of height in row component.
   */
  columnHeight: '100%',

  /**
   * The number of tab component.
   */
  tabSize: 4,

  /**
   * The number of grid item.
   */
  gridSize: 8,

  /**
   * Initialize device breakpoints.
   */
  breakpointsInitializeName: 'md',

  /**
   *  The value of aspect ratio in column component.
   */
  columnAspectRatio: 16 / 9,

  /**
   * Font weight of text component.
   */
  columnTextFontWeight: 400,

  /**
   *  The percentage of width of row component.
   */
  rowWidth: '100%',

  /**
   * The value of  attribute of columnsTemplate in sm device.
   */
  smColTemplate: '1fr 1fr',

  /**
   * The value of  attribute of columnsTemplate in md device.
   */
  mdColTemplate: '1fr 1fr 1fr',

  /**
   * The value of  attribute of columnsTemplate in lg device.
   */
  lgColTemplate: '1fr 1fr 1fr 1fr',

  /**
   * The value of  attribute of columnsTemplate in xl device.
   */
  xlColTemplate: '1fr 1fr 1fr 1fr',

  /**
   * Initialization of attribute columnsTemplate.
   */
  initializeTemplate: '1fr 1fr',

  /**
   * Breakpoint name.
   */
  breakpointSystemName: 'mainBreakpoint'
};