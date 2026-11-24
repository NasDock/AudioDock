/**
 * 跨端统一埋点字典。
 *
 * 所有端（desktop / mobile / mini）的 trackEvent 调用统一从这里取 feature / eventName，
 * 避免同一功能在不同端用不同字面量（历史上出现过 scan_login_confirm_submit vs
 * scan_login_confirm_click 之类的分叉）。harmony（ArkTS）无法引用本包，需在
 * apps/harmony 内维护一份等价常量（见 features/network/.../tracking.ets），新增事件时
 * 两端必须同步。
 *
 * 命名约定：
 * - feature = 业务域（见 TrackingFeature）
 * - eventName = `${feature}.${动作}`，小写下划线
 * - 一个用户动作尽量在四端用同一个 eventName；只有某端独有的动作才用该端专属事件。
 */

export const TrackingFeature = {
  APP: "app",
  SCAN_LOGIN: "scan_login",
  LOGIN: "login",
  MEMBER: "member",
  VIP: "vip",
  TTS: "tts",
  PLAYER: "player",
  RADIO: "radio",
  SEARCH: "search",
  LIBRARY: "library",
  PERSONAL: "personal",
  CONTENT: "content",
  FAVORITE: "favorite",
  DOWNLOAD: "download",
  SHARE: "share",
  SETTINGS: "settings",
  VOICE: "voice",
  SYNC: "sync",
  RELAY: "relay",
  CAST: "cast",
  THEME: "theme",
  QUALITY: "quality",
  LYRIC: "lyric",
  PLUGIN: "plugin",
  TASK_CENTER: "task_center",
  SOURCE: "source",
} as const;

export const TrackingEvent = {
  // ---- app 生命周期 ----
  APP_OPEN: "app.open",

  // ---- 扫码登录 / 会员登录 ----
  SCAN_QR_REFRESH: "scan_login.qr_refresh",
  SCAN_MEMBER_QR_REFRESH: "scan_login.member_login_qr_refresh",
  SCAN_RESULT_SUCCESS: "scan_login.result_success",
  SCAN_RESULT_FAILED: "scan_login.result_failed",
  SCAN_PAGE_OPEN: "scan_login.page_open",
  SCAN_ENTRY_CLICK: "scan_login.entry_click",
  SCAN_MEMBER_LOGIN_REDIRECT: "scan_login.member_login_redirect",
  SCAN_MEMBER_BENEFITS_REDIRECT: "scan_login.member_benefits_redirect",
  SCAN_PERMISSION_REQUEST: "scan_login.permission_request",
  SCAN_CAMERA_OPEN: "scan_login.camera_open",
  SCAN_QR_SCANNED: "scan_login.qr_scanned",
  SCAN_SCAN_FAILED: "scan_login.scan_failed",
  SCAN_SESSION_CLAIMED: "scan_login.session_claimed",
  SCAN_CONFIRM_SUBMIT: "scan_login.confirm_submit",
  SCAN_CONFIRM_FAILED: "scan_login.confirm_failed",
  SCAN_SEND_CODE: "scan_login.send_code",
  SCAN_SUBMIT: "scan_login.submit",
  SCAN_SUCCESS: "scan_login.success",
  SCAN_FAILED: "scan_login.failed",
  SCAN_SOURCE_LOGIN_SUBMIT: "scan_login.source_login_submit",
  SCAN_SOURCE_REGISTER_SUBMIT: "scan_login.source_register_submit",
  SCAN_SOURCE_LOGIN_SUCCESS: "scan_login.source_login_success",
  SCAN_SOURCE_REGISTER_SUCCESS: "scan_login.source_register_success",
  SCAN_SOURCE_LOGIN_FAILED: "scan_login.source_login_failed",
  SCAN_SOURCE_REGISTER_FAILED: "scan_login.source_register_failed",

  // ---- 普通登录（手机号/邮箱） ----
  LOGIN_PAGE_OPEN: "login.page_open",
  LOGIN_SUBMIT: "login.submit",
  LOGIN_SUCCESS: "login.success",
  LOGIN_FAILED: "login.failed",
  LOGIN_FORGOT_PASSWORD_OPEN: "login.forgot_password_open",
  LOGIN_LOGOUT: "login.logout",

  // ---- 会员 / 内测 ----
  MEMBER_INTERNAL_TEST_SUBMIT: "member.internal_test_participate_submit",
  MEMBER_INTERNAL_TEST_SUCCESS: "member.internal_test_participate_success",
  MEMBER_INTERNAL_TEST_FAILED: "member.internal_test_participate_failed",
  VIP_PAGE_OPEN: "vip.page_open",
  VIP_BENEFITS_OPEN: "vip.benefits_open",
  VIP_PLAN_SELECT: "vip.plan_select",
  VIP_PAY_SUBMIT: "vip.pay_submit",
  VIP_PAY_SUCCESS: "vip.pay_success",
  VIP_PAY_FAILED: "vip.pay_failed",

  // ---- TTS ----
  TTS_TASK_DELETE: "tts.task_delete",
  TTS_TASK_PAUSE: "tts.task_pause",
  TTS_TASK_RESUME: "tts.task_resume",
  TTS_TASK_FILTER_CHANGE: "tts.task_filter_change",
  TTS_TASK_REFRESH: "tts.task_refresh",
  TTS_CREATE_ENTRY_CLICK: "tts.create_entry_click",
  TTS_TASK_LIST_OPEN: "tts.task_list_open",
  TTS_VOICE_PREVIEW: "tts.voice_preview",
  TTS_FILE_SELECT: "tts.file_select",
  TTS_BATCH_IDENTIFY: "tts.batch_identify",
  TTS_TASK_SUBMIT: "tts.task_submit",
  TTS_ENTRY_CLICK: "tts.entry_click",
  TTS_LOCAL_FILES_REFRESH: "tts.local_files_refresh",
  TTS_MEMBER_BENEFITS_REDIRECT: "tts.member_benefits_redirect",

  // ---- 播放器 ----
  PLAYER_SLEEP_TIMER_SET: "player.sleep_timer_set",
  PLAYER_ADD_TO_CURRENT_PLAYLIST: "player.add_to_current_playlist",
  PLAYER_MORE_OPEN: "player.player_more_open",
  PLAYER_EQUALIZER_OPEN: "player.equalizer_open",
  PLAYER_EQUALIZER_CHANGE: "player.equalizer_change",
  PLAYER_SEEK_FORWARD_15: "player.seek_forward_15",
  PLAYER_SEEK_BACKWARD_15: "player.seek_backward_15",
  PLAYER_SEEK: "player.seek",
  PLAYER_TOGGLE: "player.toggle",
  PLAYER_PLAY: "player.play",
  PLAYER_PAUSE: "player.pause",
  PLAYER_NEXT: "player.next",
  PLAYER_PREVIOUS: "player.previous",
  PLAYER_PLAY_TRACK: "player.play_track",
  PLAYER_PLAY_LIST: "player.play_list",
  PLAYER_LIKE: "player.track_like",
  PLAYER_UNLIKE: "player.track_unlike",
  PLAYER_CAST_MI_OPEN: "player.cast_to_mi_open",

  // ---- 电台 ----
  RADIO_ENTER: "radio.enter",
  RADIO_EXIT: "radio.exit",
  RADIO_NEXT: "radio.next",

  // ---- 搜索 ----
  SEARCH_OPEN: "search.open",
  SEARCH_SUBMIT: "search.submit",
  SEARCH_RESULT_CLICK: "search.result_click",
  SEARCH_CLEAR: "search.clear",

  // ---- 资料库 / 首页 / 内容详情 ----
  LIBRARY_FOLDER_MODE_ENTRY: "library.folder_mode_entry",
  LIBRARY_OPEN: "library.open",
  HOME_OPEN: "content.home_open",
  CONTENT_ALBUM_OPEN: "content.album_open",
  CONTENT_ARTIST_OPEN: "content.artist_open",
  CONTENT_PLAYLIST_OPEN: "content.playlist_open",
  CONTENT_COLLECTION_OPEN: "content.collection_open",
  CONTENT_FOLDER_OPEN: "content.folder_open",
  CONTENT_MV_OPEN: "content.mv_open",
  CONTENT_CATEGORY_OPEN: "content.category_open",

  // ---- 个人页 / 收藏 ----
  PERSONAL_PLAYLIST_PLAY: "personal.playlist_play",
  PERSONAL_OPEN: "personal.open",
  FAVORITE_ADD: "favorite.add",
  FAVORITE_REMOVE: "favorite.remove",

  // ---- 下载 ----
  DOWNLOAD_PAGE_OPEN: "download.page_open",
  DOWNLOAD_START: "download.start",
  DOWNLOAD_SUCCESS: "download.success",
  DOWNLOAD_FAILED: "download.failed",
  DOWNLOAD_CANCEL: "download.cancel",

  // ---- 分享 ----
  SHARE_CLICK: "share.click",
  SHARE_SUCCESS: "share.success",
  SHARE_FAILED: "share.failed",

  // ---- 设置 ----
  SETTINGS_CAR_MODE_ENABLE: "settings.car_mode_enable",
  SETTINGS_CAR_MODE_DISABLE: "settings.car_mode_disable",
  SETTINGS_CAR_MODE_INSET_OPEN: "settings.car_mode_screen_inset_open",
  SETTINGS_DESKTOP_LYRICS_ENABLE: "settings.desktop_lyrics_enable",
  SETTINGS_DESKTOP_LYRICS_DISABLE: "settings.desktop_lyrics_disable",
  SETTINGS_WEBDAV_SAVE: "settings.webdav_sources_save",
  SETTINGS_USER_AGREEMENT_OPEN: "settings.user_agreement_open",
  SETTINGS_PRIVACY_POLICY_OPEN: "settings.privacy_policy_open",
  SETTINGS_CACHE_CLEAR: "settings.cache_clear",
  SETTINGS_EXPERIENCE_PROGRAM_CHANGE: "settings.experience_program_change",
  SETTINGS_OPEN: "settings.open",
  VOICE_ASSISTANT_ENABLE: "voice.voice_assistant_enable",
  VOICE_ASSISTANT_DISABLE: "voice.voice_assistant_disable",
  VOICE_ASSISTANT_USE: "voice.voice_assistant_use",

  // ---- 设备流转 / 同步 / 投屏 ----
  SYNC_CONTROL_INITIATE: "sync.sync_control_initiate",
  SYNC_CONTROL_ACCEPT: "sync.sync_control_accept",
  RELAY_PLAY_ACCEPT: "relay.relay_play_accept",
  CAST_OPEN: "cast.open",
  CAST_DEVICE_SELECT: "cast.device_select",
  CAST_SUCCESS: "cast.success",
  CAST_FAILED: "cast.failed",

  // ---- 主题 / 音质 / 歌词 ----
  THEME_UI_PLUGIN_OPEN: "theme.ui_plugin_open",
  THEME_UI_PLUGIN_IMPORT: "theme.ui_plugin_import",
  THEME_UI_PLUGIN_APPLY: "theme.ui_plugin_apply",
  THEME_PLAYER_OPEN: "theme.player_open",
  THEME_PLAYER_SELECT: "theme.player_select",
  THEME_SKIN_CHANGE: "theme.skin_change",
  QUALITY_PAGE_OPEN: "quality.page_open",
  QUALITY_CHANGE: "quality.change",
  LYRIC_PAGE_OPEN: "lyric.page_open",
  LYRIC_MANUAL_SCROLL: "lyric.manual_scroll",
  LYRIC_CLICK_SEEK: "lyric.click_seek",

  // ---- 插件 / 任务中心 / 数据源 ----
  PLUGIN_CENTER_OPEN: "plugin.center_open",
  PLUGIN_ENABLE: "plugin.enable",
  PLUGIN_DISABLE: "plugin.disable",
  TASK_CENTER_OPEN: "task_center.open",
  TASK_CLAIM: "task_center.task_claim",
  SOURCE_MANAGE_OPEN: "source.manage_open",
  SOURCE_ADD: "source.add",
  SOURCE_REMOVE: "source.remove",
  SOURCE_SWITCH: "source.switch",
} as const;

/** 事件名到 feature 的映射，供只拿到 eventName 的地方反推 feature 用 */
export const trackingFeatureOf = (eventName: string): string => {
  const dot = eventName.indexOf(".");
  return dot > 0 ? eventName.substring(0, dot) : eventName;
};
