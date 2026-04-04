/**
 * Route constants for AudioDock HarmonyOS App.
 * Maps to mobile/app/ routing structure.
 */

// ==================== Tab Routes ====================
export const ROUTE_TABS: string = 'pages/Tabs';
export const ROUTE_TAB_INDEX: string = 'pages/Tabs';
export const ROUTE_TAB_LIBRARY: string = 'pages/Tabs';
export const ROUTE_TAB_PERSONAL: string = 'pages/Tabs';

// ==================== Auth Routes ====================
export const ROUTE_LOGIN: string = 'pages/Login';
export const ROUTE_LOGIN_FORM: string = 'pages/LoginForm';
export const ROUTE_MEMBER_LOGIN: string = 'pages/MemberLogin';
export const ROUTE_FORGOT_PASSWORD: string = 'pages/ForgotPassword';
export const ROUTE_MEMBER_DETAIL: string = 'pages/MemberDetail';
export const ROUTE_MEMBER_BENEFITS: string = 'pages/MemberBenefits';
export const ROUTE_MEMBER_PAYMENT_SUCCESS: string = 'pages/MemberPaymentSuccess';

// ==================== Core Routes ====================
export const ROUTE_PLAYER: string = 'pages/Player';
export const ROUTE_SEARCH: string = 'pages/Search';
export const ROUTE_SETTINGS: string = 'pages/Settings';
export const ROUTE_MODAL: string = 'pages/Modal';

// ==================== Content Routes ====================
export const ROUTE_PLAYLIST_DETAIL: string = 'pages/PlaylistDetail';
export const ROUTE_ALBUM_DETAIL: string = 'pages/AlbumDetail';
export const ROUTE_ARTIST_DETAIL: string = 'pages/ArtistDetail';
export const ROUTE_COLLECTION_DETAIL: string = 'pages/CollectionDetail';
export const ROUTE_FOLDER_INDEX: string = 'pages/FolderIndex';
export const ROUTE_FOLDER_DETAIL: string = 'pages/FolderDetail';

// ==================== Admin Routes ====================
export const ROUTE_ADMIN: string = 'pages/Admin';
export const ROUTE_SOURCE_MANAGE: string = 'pages/SourceManage';

// ==================== Other Routes ====================
export const ROUTE_WIDGET: string = 'pages/Widget';
export const ROUTE_NOTIFICATION_CLICK: string = 'pages/NotificationClick';
export const ROUTE_PRODUCT_UPDATES: string = 'pages/ProductUpdates';
export const ROUTE_TTS_CREATE: string = 'pages/TtsCreate';
export const ROUTE_TTS_TASKS: string = 'pages/TtsTasks';
export const ROUTE_SCAN: string = 'pages/Scan';
export const ROUTE_SCAN_CONFIRM: string = 'pages/ScanConfirm';

// ==================== Entry Routes ====================
export const ROUTE_INDEX: string = 'pages/Index';
export const ROUTE_RESPONSIVE: string = 'pages/ResponsiveIndex';
export const ROUTE_ADAPTIVE: string = 'pages/AdaptiveIndex';
export const ROUTE_SYSTEM_CAPABILITIES: string = 'pages/SystemCapabilitiesIndex';

// ==================== Route Aliases (for compatibility) ====================
export const RESPONSIVE_ROUTE: string = 'pages/ResponsiveIndex';
export const ADAPTIVE_ROUTE: string = 'pages/AdaptiveIndex';
export const SYSTEM_CAPABILITIES_ROUTE: string = 'pages/SystemCapabilitiesIndex';
// ==================== Route Names (for navigation) ====================
interface RouteNamesType {
  TABS: string;
  TAB_INDEX: string;
  TAB_LIBRARY: string;
  TAB_PERSONAL: string;
  LOGIN: string;
  LOGIN_FORM: string;
  MEMBER_LOGIN: string;
  FORGOT_PASSWORD: string;
  MEMBER_DETAIL: string;
  MEMBER_BENEFITS: string;
  MEMBER_PAYMENT_SUCCESS: string;
  PLAYER: string;
  SEARCH: string;
  SETTINGS: string;
  MODAL: string;
  PLAYLIST_DETAIL: string;
  ALBUM_DETAIL: string;
  ARTIST_DETAIL: string;
  COLLECTION_DETAIL: string;
  FOLDER_INDEX: string;
  FOLDER_DETAIL: string;
  ADMIN: string;
  SOURCE_MANAGE: string;
  WIDGET: string;
  NOTIFICATION_CLICK: string;
  PRODUCT_UPDATES: string;
  TTS_CREATE: string;
  TTS_TASKS: string;
  SCAN: string;
  SCAN_CONFIRM: string;
}

export const RouteNames: RouteNamesType = {
  // Tabs
  TABS: 'Tabs',
  TAB_INDEX: 'TabIndex',
  TAB_LIBRARY: 'TabLibrary',
  TAB_PERSONAL: 'TabPersonal',

  // Auth
  LOGIN: 'Login',
  LOGIN_FORM: 'LoginForm',
  MEMBER_LOGIN: 'MemberLogin',
  FORGOT_PASSWORD: 'ForgotPassword',
  MEMBER_DETAIL: 'MemberDetail',
  MEMBER_BENEFITS: 'MemberBenefits',
  MEMBER_PAYMENT_SUCCESS: 'MemberPaymentSuccess',

  // Core
  PLAYER: 'Player',
  SEARCH: 'Search',
  SETTINGS: 'Settings',
  MODAL: 'Modal',

  // Content
  PLAYLIST_DETAIL: 'PlaylistDetail',
  ALBUM_DETAIL: 'AlbumDetail',
  ARTIST_DETAIL: 'ArtistDetail',
  COLLECTION_DETAIL: 'CollectionDetail',
  FOLDER_INDEX: 'FolderIndex',
  FOLDER_DETAIL: 'FolderDetail',

  // Admin
  ADMIN: 'Admin',
  SOURCE_MANAGE: 'SourceManage',

  // Other
  WIDGET: 'Widget',
  NOTIFICATION_CLICK: 'NotificationClick',
  PRODUCT_UPDATES: 'ProductUpdates',
  TTS_CREATE: 'TtsCreate',
  TTS_TASKS: 'TtsTasks',
  SCAN: 'Scan',
  SCAN_CONFIRM: 'ScanConfirm',
};

// ==================== Route Params Types ====================
export interface PlaylistDetailParams {
  id: string | number;
}

export interface AlbumDetailParams {
  id: string | number;
}

export interface ArtistDetailParams {
  id: string | number;
}

export interface CollectionDetailParams {
  id: string | number;
}

export interface FolderDetailParams {
  id: string | number;
}
