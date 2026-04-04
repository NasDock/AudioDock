interface CommonConstantsInterface {
  breakpointsSmName: string;
  breakpointsMdName: string;
  breakpointsLgName: string;
  breakpointsXlName: string;
  breakpointsSmSize: number;
  breakpointsMdSize: number;
  breakpointsLgSize: number;
  breakpointsXlSize: number;
  breakpointsInitializeName: string;
  breakpointIdInitializeName: string;
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
   * The break point value of sm device.
   */
  breakpointsSmSize: 0,

  /**
   * The break point value of md device.
   */
  breakpointsMdSize: 600,

  /**
   * The break point value of lg device.
   */
  breakpointsLgSize: 840,

  /**
   * The break point value of xl device.
   */
  breakpointsXlSize: 1320,

  /**
   * Initialize device breakpoints.
   */
  breakpointsInitializeName: 'md',

  /**
   * Initialize device breakpoint Id.
   */
  breakpointIdInitializeName: 'unknown'
};