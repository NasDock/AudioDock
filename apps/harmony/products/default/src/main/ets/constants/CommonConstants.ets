/**
 * Common constants for AudioDock HarmonyOS App.
 */

// ==================== App Info ====================
export const APP_BUNDLE_NAME: string = 'com.audiodock.app';
export const APP_ABILITY_NAME: string = 'EntryAbility';

// ==================== Breakpoints ====================
export const BREAKPOINT_XS: string = 'xs';
export const BREAKPOINT_SM: string = 'sm';
export const BREAKPOINT_MD: string = 'md';
export const BREAKPOINT_LG: string = 'lg';

export const BREAKPOINT_XS_WIDTH: number = 320;
export const BREAKPOINT_SM_WIDTH: number = 520;
export const BREAKPOINT_MD_WIDTH: number = 768;
export const BREAKPOINT_LG_WIDTH: number = 1280;

// ==================== Grid System ====================
export const GRID_COLUMNS_XS: number = 4;
export const GRID_COLUMNS_SM: number = 4;
export const GRID_COLUMNS_MD: number = 8;
export const GRID_COLUMNS_LG: number = 12;

export const GRID_SPAN_XS: number = 4;
export const GRID_SPAN_SM: number = 4;
export const GRID_SPAN_MD: number = 4;
export const GRID_SPAN_LG: number = 4;

export const GRID_OFFSET_XS: number = 0;
export const GRID_OFFSET_SM: number = 0;
export const GRID_OFFSET_MD: number = 2;
export const GRID_OFFSET_LG: number = 4;

// ==================== Layout ====================
export const FULL_WIDTH: string = '100%';
export const FULL_HEIGHT: string = '100%';
export const LIST_WIDTH: string = '100%';
export const LIST_ITEM_WIDTH: string = '100%';
export const COLUMN_HEIGHT: string = '100%';

// ==================== Typography ====================
export const FONT_WEIGHT_NORMAL: number = 400;
export const FONT_WEIGHT_MEDIUM: number = 500;
export const FONT_WEIGHT_BOLD: number = 700;

export const FONT_SIZE_XS: number = 12;
export const FONT_SIZE_SM: number = 14;
export const FONT_SIZE_MD: number = 16;
export const FONT_SIZE_LG: number = 18;
export const FONT_SIZE_XL: number = 20;
export const FONT_SIZE_XXL: number = 24;

// ==================== Spacing ====================
export const SPACE_XS: string = '4vp';
export const SPACE_SM: string = '8vp';
export const SPACE_MD: string = '12vp';
export const SPACE_LG: string = '16vp';
export const SPACE_XL: string = '24vp';
export const SPACE_XXL: string = '32vp';

// ==================== Border Radius ====================
export const RADIUS_SM: number = 4;
export const RADIUS_MD: number = 8;
export const RADIUS_LG: number = 12;
export const RADIUS_XL: number = 16;
export const RADIUS_FULL: number = 9999;

// ==================== Animation ====================
export const ANIMATION_DURATION_SHORT: number = 200;
export const ANIMATION_DURATION_MEDIUM: number = 300;
export const ANIMATION_DURATION_LONG: number = 500;

// ==================== API ====================
export const API_BASE_URL: string = 'https://api.audiodock.example.com';
export const API_TIMEOUT: number = 30000; // ms
export const API_RETRY_COUNT: number = 3;

// ==================== Storage Keys ====================
export const STORAGE_KEY_TOKEN: string = 'auth_token';
export const STORAGE_KEY_PLUS_TOKEN: string = 'plus_token';
export const STORAGE_KEY_USER: string = 'user_info';
export const STORAGE_KEY_SETTINGS: string = 'app_settings';
export const STORAGE_KEY_PLAYER_STATE: string = 'player_state';
export const STORAGE_KEY_THEME: string = 'theme_mode';

// ==================== Player ====================
export const PLAYER_MIN_PROGRESS: number = 0;
export const PLAYER_MAX_PROGRESS: number = 100;
export const PLAYER_SEEK_INCREMENT: number = 10; // seconds
export const PLAYER_VOLUME_STEP: number = 0.1;

// ==================== Cache ====================
export const CACHE_MAX_SIZE: number = 500 * 1024 * 1024; // 500MB
export const CACHE_EXPIRY_HOURS: number = 24;

// ==================== Tab Bar ====================
export const TAB_BAR_HEIGHT: string = '56vp';
export const TAB_ICON_SIZE: number = 24;

// ==================== Bottom Sheet ====================
 export const BOTTOM_SHEET_MIN_HEIGHT: string = '200vp';
 export const BOTTOM_SHEET_MAX_HEIGHT: string = '80%';

// ==================== Image ====================
export const IMAGE_PLACEHOLDER: string = 'common/media/placeholder.png';
export const IMAGE_ERROR_URL: string = 'common/media/error.png';
export const THUMBNAIL_SIZE_SM: number = 80;
export const THUMBNAIL_SIZE_MD: number = 160;
export const THUMBNAIL_SIZE_LG: number = 320;

// ==================== List ====================
export const PAGE_SIZE_DEFAULT: number = 20;
export const PAGE_SIZE_MAX: number = 100;
export const LIST_LOAD_MORE_THRESHOLD: number = 5;

// ==================== Error Messages ====================
export const ERROR_NETWORK: string = 'Network error, please check your connection';
export const ERROR_SERVER: string = 'Server error, please try again later';
export const ERROR_TIMEOUT: string = 'Request timeout, please try again';
export const ERROR_AUTH: string = 'Authentication failed, please login again';
export const ERROR_UNKNOWN: string = 'An unknown error occurred';

// ==================== Grid Responsive Properties ====================
export const columnXs: number = 4;
export const columnSm: number = 4;
export const columnMd: number = 8;
export const columnLg: number = 12;

export const spanXs: number = 4;
export const spanSm: number = 4;
export const spanMd: number = 4;
export const spanLg: number = 4;

export const offsetXs: number = 0;
export const offsetSm: number = 0;
export const offsetMd: number = 2;
export const offsetLg: number = 4;

export const listFontWeight: number = 400;
export const listItemWidth: string = '100%';
export const listWidth: string = '100%';
export const columnHeight: string = '100%';

export const adaptiveColumnWidth: string = '100%';
export const adaptiveFlexibleColumnWidth: string = '100%';
export const adaptiveFlexShrink: number = 0;
export const adaptiveColumnHeight: string = '100%';

// ==================== System Capabilities ====================
export const commonConstants = {
  breakpointsInitializeName: 'mainBreakpoint',
  breakpointSystemName: 'mainBreakpoint',
  locationCapability: 'SystemCapability.Location.Location.Core',
  systemRowWidth: '100%',
  systemColumnWidth: '100%',
  systemColumnHeight: '100%',
  textFontWeight: 400,
  // Grid columns
  columnXs: 4,
  columnSm: 4,
  columnMd: 8,
  columnLg: 12,
  // Grid spans
  spanXs: 4,
  spanSm: 4,
  spanMd: 4,
  spanLg: 4,
  // Grid offsets
  offsetXs: 0,
  offsetSm: 0,
  offsetMd: 2,
  offsetLg: 4,
  // List properties
  listFontWeight: 400,
  listItemWidth: '100%',
  listWidth: '100%',
  columnHeight: '100%',
  // Adaptive layout
  adaptiveColumnWidth: '100%',
  adaptiveFlexibleColumnWidth: '100%',
  adaptiveFlexShrink: 0,
  adaptiveColumnHeight: '100%'
};
