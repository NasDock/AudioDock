import http from '@ohos.net.http';
import { Logger } from 'audiodock_common';

/**
 * HarmonyOS 端埋点服务（对齐 packages/services/src/tracking.ts 的跨端字典）。
 *
 * ArkTS 严格模式：禁对象 spread / as const / 动态索引访问，故事件字典用静态常量类表达
 * （消费方 TE.XXX 点号访问）。新增事件时须与 shared 的 TrackingEvent 同步。
 */

const TAG = 'Tracking';
const PLUS_BASE_URL = 'https://www.audiodock.cn/api';
const TRACK_PATH = '/tracking/events';
const DEFAULT_TIMEOUT = 15_000;
const PLATFORM = 'harmony';

/** 统一事件名（与 packages/services/src/tracking.ts 的 TrackingEvent 同步） */
export class TE {
  static readonly APP_OPEN: string = 'app.open';

  static readonly SCAN_QR_REFRESH: string = 'scan_login.qr_refresh';
  static readonly SCAN_MEMBER_QR_REFRESH: string = 'scan_login.member_login_qr_refresh';
  static readonly SCAN_RESULT_SUCCESS: string = 'scan_login.result_success';
  static readonly SCAN_RESULT_FAILED: string = 'scan_login.result_failed';
  static readonly SCAN_PAGE_OPEN: string = 'scan_login.page_open';
  static readonly SCAN_ENTRY_CLICK: string = 'scan_login.entry_click';
  static readonly SCAN_MEMBER_LOGIN_REDIRECT: string = 'scan_login.member_login_redirect';
  static readonly SCAN_MEMBER_BENEFITS_REDIRECT: string = 'scan_login.member_benefits_redirect';
  static readonly SCAN_PERMISSION_REQUEST: string = 'scan_login.permission_request';
  static readonly SCAN_CAMERA_OPEN: string = 'scan_login.camera_open';
  static readonly SCAN_QR_SCANNED: string = 'scan_login.qr_scanned';
  static readonly SCAN_SCAN_FAILED: string = 'scan_login.scan_failed';
  static readonly SCAN_SESSION_CLAIMED: string = 'scan_login.session_claimed';
  static readonly SCAN_CONFIRM_SUBMIT: string = 'scan_login.confirm_submit';
  static readonly SCAN_CONFIRM_FAILED: string = 'scan_login.confirm_failed';
  static readonly SCAN_SEND_CODE: string = 'scan_login.send_code';
  static readonly SCAN_SUBMIT: string = 'scan_login.submit';
  static readonly SCAN_SUCCESS: string = 'scan_login.success';
  static readonly SCAN_FAILED: string = 'scan_login.failed';

  static readonly LOGIN_PAGE_OPEN: string = 'login.page_open';
  static readonly LOGIN_SUBMIT: string = 'login.submit';
  static readonly LOGIN_SUCCESS: string = 'login.success';
  static readonly LOGIN_FAILED: string = 'login.failed';
  static readonly LOGIN_LOGOUT: string = 'login.logout';

  static readonly MEMBER_INTERNAL_TEST_SUBMIT: string = 'member.internal_test_participate_submit';
  static readonly MEMBER_INTERNAL_TEST_SUCCESS: string = 'member.internal_test_participate_success';
  static readonly MEMBER_INTERNAL_TEST_FAILED: string = 'member.internal_test_participate_failed';
  static readonly VIP_PAGE_OPEN: string = 'vip.page_open';
  static readonly VIP_BENEFITS_OPEN: string = 'vip.benefits_open';
  static readonly VIP_PLAN_SELECT: string = 'vip.plan_select';
  static readonly VIP_PAY_SUBMIT: string = 'vip.pay_submit';
  static readonly VIP_PAY_SUCCESS: string = 'vip.pay_success';
  static readonly VIP_PAY_FAILED: string = 'vip.pay_failed';

  static readonly TTS_TASK_DELETE: string = 'tts.task_delete';
  static readonly TTS_TASK_PAUSE: string = 'tts.task_pause';
  static readonly TTS_TASK_RESUME: string = 'tts.task_resume';
  static readonly TTS_TASK_REFRESH: string = 'tts.task_refresh';
  static readonly TTS_CREATE_ENTRY_CLICK: string = 'tts.create_entry_click';
  static readonly TTS_TASK_LIST_OPEN: string = 'tts.task_list_open';
  static readonly TTS_VOICE_PREVIEW: string = 'tts.voice_preview';
  static readonly TTS_BATCH_IDENTIFY: string = 'tts.batch_identify';
  static readonly TTS_TASK_SUBMIT: string = 'tts.task_submit';
  static readonly TTS_ENTRY_CLICK: string = 'tts.entry_click';

  static readonly PLAYER_SLEEP_TIMER_SET: string = 'player.sleep_timer_set';
  static readonly PLAYER_ADD_TO_CURRENT_PLAYLIST: string = 'player.add_to_current_playlist';
  static readonly PLAYER_MORE_OPEN: string = 'player.player_more_open';
  static readonly PLAYER_SEEK: string = 'player.seek';
  static readonly PLAYER_TOGGLE: string = 'player.toggle';
  static readonly PLAYER_PLAY: string = 'player.play';
  static readonly PLAYER_PAUSE: string = 'player.pause';
  static readonly PLAYER_NEXT: string = 'player.next';
  static readonly PLAYER_PREVIOUS: string = 'player.previous';
  static readonly PLAYER_PLAY_TRACK: string = 'player.play_track';
  static readonly PLAYER_PLAY_LIST: string = 'player.play_list';
  static readonly PLAYER_LIKE: string = 'player.track_like';
  static readonly PLAYER_UNLIKE: string = 'player.track_unlike';

  static readonly RADIO_ENTER: string = 'radio.enter';
  static readonly RADIO_EXIT: string = 'radio.exit';
  static readonly RADIO_NEXT: string = 'radio.next';

  static readonly SEARCH_OPEN: string = 'search.open';
  static readonly SEARCH_SUBMIT: string = 'search.submit';
  static readonly SEARCH_RESULT_CLICK: string = 'search.result_click';

  static readonly LIBRARY_FOLDER_MODE_ENTRY: string = 'library.folder_mode_entry';
  static readonly LIBRARY_OPEN: string = 'library.open';
  static readonly HOME_OPEN: string = 'content.home_open';
  static readonly CONTENT_ALBUM_OPEN: string = 'content.album_open';
  static readonly CONTENT_ARTIST_OPEN: string = 'content.artist_open';
  static readonly CONTENT_PLAYLIST_OPEN: string = 'content.playlist_open';
  static readonly CONTENT_COLLECTION_OPEN: string = 'content.collection_open';
  static readonly CONTENT_FOLDER_OPEN: string = 'content.folder_open';
  static readonly CONTENT_MV_OPEN: string = 'content.mv_open';

  static readonly PERSONAL_PLAYLIST_PLAY: string = 'personal.playlist_play';
  static readonly PERSONAL_OPEN: string = 'personal.open';
  static readonly FAVORITE_ADD: string = 'favorite.add';
  static readonly FAVORITE_REMOVE: string = 'favorite.remove';

  static readonly SETTINGS_OPEN: string = 'settings.open';
  static readonly SETTINGS_CAR_MODE_ENABLE: string = 'settings.car_mode_enable';
  static readonly SETTINGS_CAR_MODE_DISABLE: string = 'settings.car_mode_disable';
  static readonly SETTINGS_DESKTOP_LYRICS_ENABLE: string = 'settings.desktop_lyrics_enable';
  static readonly SETTINGS_DESKTOP_LYRICS_DISABLE: string = 'settings.desktop_lyrics_disable';
  static readonly SETTINGS_USER_AGREEMENT_OPEN: string = 'settings.user_agreement_open';
  static readonly SETTINGS_PRIVACY_POLICY_OPEN: string = 'settings.privacy_policy_open';
  static readonly SETTINGS_CACHE_CLEAR: string = 'settings.cache_clear';
  static readonly SETTINGS_EXPERIENCE_PROGRAM_CHANGE: string = 'settings.experience_program_change';
  static readonly VOICE_ASSISTANT_ENABLE: string = 'voice.voice_assistant_enable';
  static readonly VOICE_ASSISTANT_DISABLE: string = 'voice.voice_assistant_disable';

  static readonly SYNC_CONTROL_INITIATE: string = 'sync.sync_control_initiate';
  static readonly SYNC_CONTROL_ACCEPT: string = 'sync.sync_control_accept';
  static readonly RELAY_PLAY_ACCEPT: string = 'relay.relay_play_accept';
  static readonly CAST_OPEN: string = 'cast.open';
  static readonly CAST_SUCCESS: string = 'cast.success';
  static readonly CAST_FAILED: string = 'cast.failed';

  static readonly THEME_PLAYER_OPEN: string = 'theme.player_open';
  static readonly THEME_PLAYER_SELECT: string = 'theme.player_select';
  static readonly QUALITY_PAGE_OPEN: string = 'quality.page_open';
  static readonly QUALITY_CHANGE: string = 'quality.change';

  static readonly TASK_CENTER_OPEN: string = 'task_center.open';
  static readonly SOURCE_MANAGE_OPEN: string = 'source.manage_open';
}

/** 由 eventName 反推 feature（取第一个点号前的段） */
function featureOf(eventName: string): string {
  const dot = eventName.indexOf('.');
  return dot > 0 ? eventName.substring(0, dot) : eventName;
}

class TrackingServiceImpl {
  private enabled: boolean = true;
  private userIdValue: string | null = null;
  private deviceIdValue: string | null = null;

  /** EntryAbility 初始化时注入：体验改进计划开关 + 会员 id + 设备 id */
  init(enabled: boolean, userId: string | null, deviceId: string | null): void {
    this.enabled = enabled;
    this.userIdValue = userId;
    this.deviceIdValue = deviceId;
  }

  setTrackingEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setMemberUserId(userId: string | null): void {
    this.userIdValue = userId;
  }

  setDeviceId(deviceId: string): void {
    this.deviceIdValue = deviceId;
  }

  /**
   * 上报单个事件。永远不抛错、不阻塞主流程。
   * userId / deviceId 由 init/setter 注入，调用方一般无需传。
   */
  async track(eventName: string, metadata?: object, userIdOverride?: string | null): Promise<void> {
    try {
      if (!this.enabled) return;
      // ArkTS 禁对象 spread，逐字段构造请求体
      const payload: Record<string, Object> = {};
      payload['platform'] = PLATFORM;
      payload['feature'] = featureOf(eventName);
      payload['eventName'] = eventName;
      // 调用方显式传入优先（对齐三端 wrapper 的修复），否则用注入的会员 id
      const userId = userIdOverride !== undefined ? userIdOverride : this.userIdValue;
      payload['userId'] = userId === null ? '' : userId;
      payload['deviceId'] = this.deviceIdValue === null ? '' : this.deviceIdValue;
      if (metadata !== undefined) payload['metadata'] = metadata;

      const httpReq = http.createHttp();
      try {
        const resp = await httpReq.request(`${PLUS_BASE_URL}${TRACK_PATH}`, {
          method: http.RequestMethod.POST,
          header: { 'Content-Type': 'application/json' },
          readTimeout: DEFAULT_TIMEOUT,
          connectTimeout: DEFAULT_TIMEOUT,
          extraData: JSON.stringify(payload),
        });
        if (resp.responseCode !== 200 && resp.responseCode !== 201) {
          Logger.w(TAG, `track ${eventName} http=${resp.responseCode}`);
        }
      } finally {
        httpReq.destroy();
      }
    } catch (e) {
      // 埋点失败绝不影响业务
      Logger.w(TAG, `track ${eventName} failed: ${String(e)}`);
    }
  }

  /** 页面打开事件，metadata 带页签名 */
  async pageOpen(eventName: string, page: string): Promise<void> {
    const meta: Record<string, Object> = {};
    meta['page'] = page;
    await this.track(eventName, meta);
  }
}

export const trackingService = new TrackingServiceImpl();

/** 便捷函数：上报单个事件 */
export function trackEvent(eventName: string, metadata?: object, userIdOverride?: string | null): Promise<void> {
  return trackingService.track(eventName, metadata, userIdOverride);
}
