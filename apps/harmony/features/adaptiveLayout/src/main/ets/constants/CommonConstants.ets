interface CommonConstantsInterface {
  columnWidth: string;
  columnHeight: string;
  columnFlexShrink: number;
  width: string;
  height: string;
  sliderMin: number;
  sliderMax: number;
  sliderMargin: number;
  percentSign: string;
}

/**
 * Common constants for all features.
 */
export const commonConstants: CommonConstantsInterface = {
  /**
   * The percentage of width in row component.
   */
  columnWidth: '100%',

  /**
   * The percentage of height in row component.
   */
  columnHeight: '100%',

  /**
   * The value of number of the flex shrink.
   */
  columnFlexShrink: 1,

  /**
   * The percentage of width.
   */
  width: '100%',

  /**
   * The percentage of height.
   */
  height: '100%',

  /**
   * The minimum rolling value of the slider.
   */
  sliderMin: 55,

  /**
   * The maximum rolling value of the slider.
   */
  sliderMax: 90,

  /**
   * The margin between the slider and the bottom.
   */
  sliderMargin: 24,

  /**
   * The percent sign.
   */
  percentSign: '%'
};