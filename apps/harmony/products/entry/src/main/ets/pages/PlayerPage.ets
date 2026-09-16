import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import type { common } from '@kit.AbilityKit';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import { formatDuration, Logger } from 'audiodock_common';
import { trackApi, playlistApi, artistApi, albumApi, miApi, plusApi, setPlusAuthToken, deviceApi } from 'features_network';
import type { PlaylistDto, ArtistDto, AlbumDto, MiDevice, TrackDto, OnlineDevice } from 'features_network';
import { kvStore } from 'features_storage';
import type { LyricLine } from 'features_player';
import { playerStore } from '../context/PlayerStore';
import type { PlayerStateView, Track } from '../context/PlayerStore';
import { syncStore } from '../context/SyncStore';
import type { SyncStateView } from '../context/SyncStore';
import { resolveTrackToPlayer } from '../services/trackResolver';
import { getInternalQuality } from '../services/trackQuality';
import { getOrCreateDeviceId } from '../utils/device';
import { socketService } from 'features_socket';
import { likesHistory } from '../services/LikesHistoryService';
import { downloadTrack, isTrackDownloaded } from '../services/downloadService';
import type { EventPayload, EventPayloadId } from '../services/LikesHistoryService';
import { CoverImage } from '../components/CoverImage';
import { AppIcon } from '../components/AppIcon';
import type { AppIconName } from '../components/AppIcon';
import { XiaoAiIcon } from '../components/XiaoAiIcon';
import { PlayingIndicator } from '../components/PlayingIndicator';
import { SyncInviteModal } from '../components/SyncInviteModal';
import { SyncNotification } from '../components/SyncNotification';

class MoreOption {
  key: string = '';
  label: string = '';

  constructor(key: string, label: string) {
    this.key = key;
    this.label = label;
  }
}

/** 播放流转的播放列表载体 */
class TransferPlaylist {
  list: Track[] = [];
  index: number = 0;
}

/** 播放流转 payload（ArkTS 严格模式要求显式 class，禁用未声明接口的对象字面量） */
class TransferSessionPayload {
  targetDeviceId: string = '';
  currentTrack: Track | null = null;
  playlist: TransferPlaylist = new TransferPlaylist();
  progress: number = 0;
}

/** 把任意端（web/mobile/hm）发来的流转曲目规范化为 hm 播放器内部 Track。 */
function normalizeTransferTrack(raw: Record<string, Object>): Track {
  const pickStr = (...keys: string[]): string => {
    for (const k of keys) {
      const v = raw[k];
      if (v !== undefined && v !== null && String(v) !== '') return String(v);
    }
    return '';
  };
  const pickNum = (key: string): number | undefined => {
    const v = raw[key];
    return typeof v === 'number' ? v : undefined;
  };
  const id = pickStr('id');
  const path = pickStr('path');
  let url = pickStr('url');
  if (!url) {
    if (path && (path.startsWith('http://') || path.startsWith('https://'))) {
      url = path;
    } else if (id) {
      url = trackApi.streamUrl(id, 'high');
    }
  }
  const track: Track = {
    id,
    title: pickStr('title', 'name'),
    url,
    artist: pickStr('artist') || undefined,
    album: pickStr('album') || undefined,
    duration: pickNum('duration'),
    ext: pickStr('ext') || undefined,
    coverUrl: pickStr('coverUrl', 'cover') || undefined,
    lyrics: pickStr('lyrics') || undefined,
    contentType: pickStr('contentType', 'type') || undefined,
  };
  return track;
}

/**
 * 播放器详情页，布局与行为对齐 mobile 的 PlayerDetailView：
 * 竖屏：顶部左侧返回（chevron-down）、右侧更多按钮（⋮，打开选项半模态）；中部封面 200×200
 * （点按切换歌词）/ 歌词列表（高亮当前行并自动滚动居中，点按切回封面）；底部信息行
 * （曲名+艺人+喜欢）、进度条（松手 seek）、控制行（播放模式 / 上一首 / 播放暂停 / 下一首 / 播放列表）。
 * 横屏（根容器 width > height）：左右双列布局——左列封面 250×250 居中 + 返回/更多按钮
 * 绝对定位于左上/右上 + 控制条悬浮左列底部（bottom:40, left:10%），空间不足时 3s 无操作
 * 自动隐藏控制条、点封面切换显隐；右列常驻歌词列表（有声书时为播放列表）。
 * 播放列表用半模态展示，点击行跳转播放。
 */
@Entry
@Component
struct PlayerPage {
  @State private view: PlayerStateView = playerStore.view();
  @State private showLyrics: boolean = false;
  @State private showPlaylist: boolean = false;
  // 修复 3：播放列表三 Tab（current/history/favorites），对齐 mobile PlaylistModal TabType
  @State private playlistTab: 'current' | 'history' | 'favorites' = 'current';
  @State private playlistTabLoaded: Record<string, boolean> = {};
  @State private showMore: boolean = false;
  @State private liked: boolean = false;
  @State private showSleepTimer: boolean = false;
  @State private showAddToPlaylist: boolean = false;
  @State private showLyricsSize: boolean = false;
  @State private showControlPos: boolean = false;
  // 有声书：跳过片头/片尾设置半模态（对齐 mobile PlayerMoreModal skip modal）
  @State private showSkipSheet: boolean = false;
  @State private skipSheetType: 'intro' | 'outro' = 'intro';
  /** 弹窗内临时值，确认后才写入 playerStore（对齐 mobile tempSkipTime） */
  @State private tempSkipTime: number = 0;
  @State private lyricFontSize: number = 16;
  // 修复 1：当前曲目下载状态（对齐 mobile PlayerMoreModal isDownloaded / isDownloading）
  @State private isDownloaded: boolean = false;
  @State private isDownloading: boolean = false;
  @State private controlBottomOffset: number = 0;
  @State private playlists: PlaylistDto[] = [];
  // 小爱音箱投放相关状态（对齐 mobile player.tsx 的 mi* 状态）
  @State private showMiCast: boolean = false;
  @State private miDevices: MiDevice[] = [];
  @State private miLoggedIn: boolean = false;
  @State private miQRCodeUrl: string = '';
  @State private miLoading: boolean = false;
  @State private miCasting: boolean = false;
  // 在线设备（播放流转）
  @State private onlineDevices: OnlineDevice[] = [];
  @State private transferringId: string = '';
  @State private selfDeviceId: string = '';
  private miPollingId: number = -1;
  // 同步播放相关状态（对齐 mobile player.tsx 的 sync* 状态）
  @State private syncView: SyncStateView = syncStore.view();
  @State private showSyncInvite: boolean = false;
  @State private syncCheckLoading: boolean = false;
  // [修复 2] 同步控制入口常驻（不再软下线）。isPlusVip 仍用于：
  // - 加载状态（页面打开时拉一次 plus profile）
  // - 非会员点击 sync 时弹"开通 Plus"对话框（对齐 mobile player.tsx handleSyncPress 的 VIP 校验）
  @State private isPlusVip: boolean = false;
  private unsubSync: (() => void) | null = null;
  private unsubPlayerLeft: (() => void) | null = null;
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  private lyricScroller: Scroller = new Scroller();
  private lastTrackId: string = '';
  private lastLyricIndex: number = -1;
  private unsub: () => void = () => {};
  private unsubLike: () => void = () => {};
  // ─── 横屏布局状态（对齐 mobile player.tsx landscape 逻辑） ───
  // isLandscape：根容器 onAreaChange 测得 width > height 时进入横屏双列布局
  @State private isLandscape: boolean = false;
  // controlsVisible + controlsOpacity：空间不足（needsAutoHide）时控制条 3s 无操作自动隐藏
  @State private controlsVisible: boolean = true;
  @State private controlsOpacity: number = 1;
  @State private containerHeight: number = 0;
  @State private leftColumnWidth: number = 0;
  private controlsHeight: number = 0;
  private hideTimerId: number = -1;

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    // 恢复歌词字号（对齐 mobile player.tsx useEffect onMount 读 AsyncStorage 'lyric_font_size'）
    kvStore.get('lyric_font_size')
      .then((v: string | null): void => {
        const n: number = v !== null ? Number(v) : NaN;
        if (!Number.isNaN(n) && n >= 12 && n <= 40) this.lyricFontSize = n;
      })
      .catch((e: Error): void => {
        Logger.w('PlayerPage', `read lyric_font_size failed: ${String(e)}`);
      });
    // 恢复控制组底部偏移（对齐 mobile player.tsx L328 读 AsyncStorage 'player_controls_bottom_offset'）
    kvStore.get('player_controls_bottom_offset')
      .then((v: string | null): void => {
        const n: number = v !== null ? Number(v) : NaN;
        if (!Number.isNaN(n) && n >= 0 && n <= 120) this.controlBottomOffset = n;
      })
      .catch((e: Error): void => {
        Logger.w('PlayerPage', `read player_controls_bottom_offset failed: ${String(e)}`);
      });
    this.unsub = playerStore.subscribe(() => {
      this.view = playerStore.view();
      const cur = this.current();
      const curId = cur ? cur.id : '';
      if (curId !== this.lastTrackId) {
        this.lastTrackId = curId;
        this.refreshLike();
        // 修复 1：曲目变化时刷新 isDownloaded
        this.refreshDownloadStatus();
      }
      // 横屏时右侧歌词常驻（对齐 mobile: isLandscape ? type !== AUDIOBOOK : showLyrics）
      const lyricsVisible = this.isLandscape || this.showLyrics;
      if (lyricsVisible && this.view.activeLyricIndex !== this.lastLyricIndex) {
        this.lastLyricIndex = this.view.activeLyricIndex;
        if (this.lastLyricIndex >= 0) {
          this.lyricScroller.scrollToIndex(this.lastLyricIndex, true, ScrollAlign.CENTER);
        }
      }
    });
    this.unsubLike = likesHistory.on('trackLike', (p: EventPayload) => {
      const payload = p as EventPayloadId;
      const cur = this.current();
      if (cur && payload.id === cur.id) this.liked = payload.liked;
    });
    // 同步播放状态订阅 + player_left 弹窗（对齐 mobile player.tsx 的 player_left 处理）
    this.syncView = syncStore.view();
    this.unsubSync = syncStore.subscribe((): void => {
      this.syncView = syncStore.view();
    });
    this.unsubPlayerLeft = syncStore.onPlayerLeft((p): void => {
      promptAction.showDialog({
        title: t('sync.syncStatus'),
        message: t('player.userDisconnected', [
          ['username', p.username || ''],
          ['deviceName', p.deviceName || ''],
        ]),
        buttons: [{ text: t('common.ok'), color: '#3F51B5' }],
      }).catch(() => undefined);
    });
    const cur = this.current();
    this.lastTrackId = cur ? cur.id : '';
    this.refreshLike();
    this.refreshDownloadStatus();
    this.loadVipStatus();
    // 播放流转：注册接收端监听 + 初始化本机 deviceId
    socketService.on('transfer_received', this.onTransferReceived);
    getOrCreateDeviceId().then((id: string): void => {
      this.selfDeviceId = id;
    }).catch(() => undefined);
    const params = router.getParams() as Record<string, string> | undefined;
    const trackId = params?.['trackId'];
    if (trackId) this.loadSingle(trackId);
  }

  // [软下线] 校验 plus VIP 状态，驱动同步控制入口的显隐（对齐 PersonalPage.loadVipStatus）
  private async loadVipStatus(): Promise<void> {
    try {
      const plusUserId = await kvStore.get('plus_user_id');
      if (plusUserId !== null && plusUserId.length > 0) {
        const token = await kvStore.get('plus_token');
        if (token) setPlusAuthToken(token);
        const profile = await plusApi.getMe(plusUserId);
        this.isPlusVip = !!profile.vipTier && profile.vipTier !== 'NONE';
      }
    } catch (e) {
      Logger.w('PlayerPage', `loadVipStatus failed: ${String(e)}`);
    }
  }

  aboutToDisappear(): void {
    this.unsub();
    this.unsubLike();
    if (this.unsubSync) this.unsubSync();
    if (this.unsubPlayerLeft) this.unsubPlayerLeft();
    socketService.off('transfer_received', this.onTransferReceived);
    if (this.hideTimerId !== -1) {
      clearTimeout(this.hideTimerId);
      this.hideTimerId = -1;
    }
    this.stopMiPolling();
  }

  // ─── 横屏控制条自动隐藏（对齐 mobile player.tsx resetHideTimer / needsAutoHide） ───
  // needsAutoHide = isLandscape && 封面(250) + 控制条高度 + 80 > 容器高度
  private needsAutoHide(): boolean {
    return this.isLandscape && this.controlsHeight > 0 &&
      250 + this.controlsHeight + 80 > this.containerHeight;
  }

  // 悬浮控制条顶部 y 坐标：对齐 mobile bottom:40（容器高 - 40 - 控制条自身高），不小于 0
  private controlsTop(): number {
    return Math.max(0, this.containerHeight - 40 - this.controlsHeight);
  }

  private resetHideTimer(): void {
    if (this.hideTimerId !== -1) {
      clearTimeout(this.hideTimerId);
      this.hideTimerId = -1;
    }
    if (!this.needsAutoHide()) {
      this.showLandscapeControls();
      return;
    }
    this.showLandscapeControls();
    this.hideTimerId = setTimeout(() => {
      this.hideTimerId = -1;
      if (this.isLandscape && this.needsAutoHide()) {
        this.controlsVisible = false;
        animateTo({ duration: 300, curve: Curve.EaseOut }, () => {
          this.controlsOpacity = 0;
        });
      }
    }, 3000);
  }

  private showLandscapeControls(): void {
    this.controlsVisible = true;
    animateTo({ duration: 300, curve: Curve.EaseOut }, () => {
      this.controlsOpacity = 1;
    });
  }

  private current(): Track | null {
    if (this.view.queue.length === 0) return null;
    return this.view.queue[this.view.currentIndex] ?? null;
  }

  private refreshLike(): void {
    const cur = this.current();
    if (!cur) { this.liked = false; return; }
    likesHistory.isTrackLiked(cur.id)
      .then((v: boolean) => { this.liked = v; })
      .catch(() => undefined);
  }

  private toggleLike(): void {
    const cur = this.current();
    if (!cur) return;
    if (this.liked) {
      likesHistory.unlikeTrack(cur.id).catch(() => undefined);
    } else {
      likesHistory.likeTrack(cur.id).catch(() => undefined);
    }
  }

  // ===== 小爱音箱投放（对齐 mobile player.tsx） =====
  private stopMiPolling(): void {
    if (this.miPollingId !== -1) {
      clearInterval(this.miPollingId);
      this.miPollingId = -1;
    }
  }

  private startMiQRPolling(lpUrl: string): void {
    this.stopMiPolling();
    this.miPollingId = setInterval(async () => {
      try {
        const status = await miApi.getQRCodeStatus(lpUrl);
        if (status.status === 'success') {
          this.stopMiPolling();
          this.miLoggedIn = true;
          this.miQRCodeUrl = '';
          promptAction.showToast({ message: t('player.miLoginSuccess') });
          const res = await miApi.getDevices();
          this.miDevices = res.devices || [];
        } else if (status.status === 'expired' || status.status === 'error') {
          this.stopMiPolling();
          this.miQRCodeUrl = '';
        }
      } catch (e) {
        // 静默失败，等待下次轮询
      }
    }, 2000);
  }

  private async handleOpenMiCast(): Promise<void> {
    this.showMiCast = true;
    this.miLoading = true;
    // 打开弹窗时加载在线设备 + 订阅上下线事件实时刷新
    this.loadOnlineDevices();
    socketService.on('device_online', this.onDevicePresenceChange);
    socketService.on('device_offline', this.onDevicePresenceChange);
    try {
      const auth = await miApi.getAuthStatus();
      this.miLoggedIn = auth.logged_in;
      if (auth.logged_in) {
        const res = await miApi.getDevices();
        this.miDevices = res.devices || [];
      } else {
        const qr = await miApi.getQRCode();
        if (qr.already_logged_in) {
          this.miLoggedIn = true;
          const res = await miApi.getDevices();
          this.miDevices = res.devices || [];
        } else if (qr.qrcode_url) {
          this.miQRCodeUrl = qr.qrcode_url;
          if (qr.status_url) this.startMiQRPolling(qr.status_url);
        }
      }
    } catch (e) {
      Logger.w('PlayerPage', `loadMiDevices failed: ${String(e)}`);
      promptAction.showToast({ message: t('player.loadMiDevicesFailed') });
    } finally {
      this.miLoading = false;
    }
  }

  private handleCloseMiCast(): void {
    this.showMiCast = false;
    this.stopMiPolling();
    socketService.off('device_online', this.onDevicePresenceChange);
    socketService.off('device_offline', this.onDevicePresenceChange);
  }

  /** WS 设备上下线回调：刷新在线设备列表 */
  private onDevicePresenceChange = (): void => {
    this.loadOnlineDevices();
  };

  /** 加载当前账号的在线设备列表（排除本机，仅保留在线） */
  private async loadOnlineDevices(): Promise<void> {
    try {
      if (this.selfDeviceId === '') {
        this.selfDeviceId = await getOrCreateDeviceId();
      }
      const list = await deviceApi.listMyDevices();
      const selfId = this.selfDeviceId;
      this.onlineDevices = list.filter((d: OnlineDevice) => d.isOnline && (d.deviceId ?? '') !== selfId);
    } catch (e) {
      Logger.w('PlayerPage', `loadOnlineDevices failed: ${String(e)}`);
    }
  }

  /** 播放流转：把当前播放推给目标在线设备 */
  private async handleTransferToDevice(target: OnlineDevice): Promise<void> {
    const cur = this.current();
    if (!cur) {
      promptAction.showToast({ message: t('player.miCastNoTrack') });
      return;
    }
    const targetDeviceId = target.deviceId ?? '';
    if (targetDeviceId === '') {
      promptAction.showToast({ message: t('player.transferFailed') });
      return;
    }
    if (!socketService.isConnected()) {
      Logger.w('PlayerPage', '[Transfer] socket not connected, cannot emit transfer_session');
      promptAction.showToast({ message: t('player.transferFailed') });
      return;
    }
    this.transferringId = targetDeviceId;
    try {
      // harmony 内部用毫秒，流转协议统一用秒（对齐 mobile/desktop）
      const progressSec = Math.floor(this.view.currentMs / 1000);
      const pl = new TransferPlaylist();
      pl.list = this.view.queue;
      pl.index = this.view.currentIndex;
      const payload = new TransferSessionPayload();
      payload.targetDeviceId = targetDeviceId;
      payload.currentTrack = cur;
      payload.playlist = pl;
      payload.progress = progressSec;
      Logger.i('PlayerPage', `[Transfer] emit transfer_session: target=${targetDeviceId} (${target.name}) trackId=${cur.id} progress=${progressSec}s`);

      // 等服务端 ack（transfer_sent / transfer_failed），5s 超时兜底
      const delivered = await this.awaitTransferAck(targetDeviceId, payload);

      if (!delivered) {
        promptAction.showToast({ message: t('player.transferFailed') });
        return;
      }
      if (this.view.isPlaying) {
        await playerStore.togglePlay();
      }
      promptAction.showToast({ message: t('player.transferSuccess', [['device', target.name]]) });
      this.handleCloseMiCast();
    } catch (e) {
      Logger.w('PlayerPage', `[Transfer] transfer failed: ${String(e)}`);
      promptAction.showToast({ message: t('player.transferFailed') });
    } finally {
      this.transferringId = '';
    }
  }

  /** 发出 transfer_session 并等待服务端 ack（transfer_sent/transfer_failed），超时按失败处理 */
  private awaitTransferAck(targetDeviceId: string, payload: TransferSessionPayload): Promise<boolean> {
    return new Promise<boolean>((resolve: (value: boolean) => void): void => {
      let settled = false;
      let timer: number = -1;
      const cleanup = (): void => {
        settled = true;
        socketService.off('transfer_sent', onSent);
        socketService.off('transfer_failed', onFailed);
        if (timer !== -1) {
          clearTimeout(timer);
          timer = -1;
        }
      };
      const onSent = (p: Object | null | undefined): void => {
        const rec = p as Record<string, Object> | null;
        const ackId = rec ? String(rec['targetDeviceId'] ?? '') : '';
        if (settled || ackId !== targetDeviceId) return;
        Logger.i('PlayerPage', `[Transfer] transfer_sent ack for ${targetDeviceId}`);
        cleanup();
        resolve(true);
      };
      const onFailed = (p: Object | null | undefined): void => {
        const rec = p as Record<string, Object> | null;
        const ackId = rec ? String(rec['targetDeviceId'] ?? '') : '';
        const reason = rec ? String(rec['reason'] ?? '') : '';
        if (settled || ackId !== targetDeviceId) return;
        Logger.w('PlayerPage', `[Transfer] transfer_failed: reason=${reason} target=${ackId}`);
        cleanup();
        resolve(false);
      };
      timer = setTimeout((): void => {
        if (settled) return;
        Logger.w('PlayerPage', `[Transfer] ack timeout for ${targetDeviceId}（服务端 5s 未回，按未送达处理）`);
        cleanup();
        resolve(false);
      }, 5000) as number;
      socketService.on('transfer_sent', onSent);
      socketService.on('transfer_failed', onFailed);
      socketService.emit('transfer_session', payload);
    });
  }

  /** 接收端：监听其他设备发来的流转请求，接管播放 */
  private onTransferReceived = (payload: Object | null | undefined): void => {
    this.handleTransferReceived(payload);
  };

  private async handleTransferReceived(payload: Object | null | undefined): Promise<void> {
    if (!payload) {
      Logger.w('PlayerPage', '[Transfer] transfer_received payload 为空，忽略');
      return;
    }
    try {
      const p = payload as Record<string, Object>;
      const playlistObj = p['playlist'] as Record<string, Object> | undefined;
      const rawList = playlistObj ? (playlistObj['list'] as Record<string, Object>[]) : undefined;
      const index = playlistObj ? Number(playlistObj['index'] ?? 0) : 0;
      const rawTrack = p['currentTrack'] as Record<string, Object> | undefined;
      const progressSec = Number(p['progress'] ?? 0);
      const fromDevice = String(p['fromDeviceName'] ?? '');
      // 各端 Track 模型字段命名不同（hm 用 title/url/coverUrl，web/mobile 用 name/path/cover），
      // 统一规范化后再交给播放器，否则只有同名字段（artist 等）能存活，歌名/播放地址全丢。
      const list: Track[] | undefined = rawList && Array.isArray(rawList)
        ? rawList.map((it: Record<string, Object>): Track => normalizeTransferTrack(it))
        : undefined;
      const track: Track | undefined = rawTrack ? normalizeTransferTrack(rawTrack) : undefined;
      Logger.i('PlayerPage', `[Transfer] handle transfer_received: from=${fromDevice} trackId=${track?.id ?? '(none)'} title=${track?.title ?? ''} listLen=${list ? list.length : 0} index=${index} progress=${progressSec}s`);

      if (list && list.length > 0) {
        await playerStore.playTrackList(list, Math.max(0, index));
      } else if (track) {
        await playerStore.playTrack(track);
      } else {
        Logger.w('PlayerPage', '[Transfer] transfer_received 无 playlist 且无 currentTrack，忽略');
        return;
      }
      // 秒 → 毫秒
      if (progressSec > 0) {
        await playerStore.seek(progressSec * 1000);
      }
      promptAction.showToast({ message: t('player.transferReceived', [['device', fromDevice]]) });
    } catch (e) {
      Logger.e('PlayerPage', `[Transfer] handleTransferReceived failed: ${String(e)}`);
    }
  }

  private async handleCastToMi(deviceId: string, deviceName: string): Promise<void> {
    const cur = this.current();
    if (!cur) {
      promptAction.showToast({ message: t('player.miCastNoTrack') });
      return;
    }
    this.miCasting = true;
    try {
      const quality = await getInternalQuality();
      const url = trackApi.streamUrl(cur.id, quality);
      const title = `${cur.title} - ${cur.artist ?? ''}`;
      await miApi.playByUrl(deviceId, url, title);
      if (this.view.isPlaying) {
        await playerStore.togglePlay();
      }
      promptAction.showToast({ message: t('player.miCastSuccess', [['device', deviceName]]) });
      this.handleCloseMiCast();
    } catch (e) {
      Logger.w('PlayerPage', `cast to Mi failed: ${String(e)}`);
      promptAction.showToast({ message: t('player.miCastFailed') });
    } finally {
      this.miCasting = false;
    }
  }

  private playModeIcon(): AppIconName {
    switch (this.view.playMode) {
      case 'SHUFFLE': return 'shuffle';
      case 'LOOP_LIST': return 'repeat';
      case 'LOOP_SINGLE': return 'repeat-once';
      default: return 'playlist';
    }
  }

  /** 在线设备平台图标（desktop/tablet/tv/watch/phone/mini/web） */
  private platformIcon(platform: string): AppIconName {
    switch (platform) {
      case 'desktop': return 'desktop';
      case 'tablet': return 'tablet';
      case 'tv': return 'tv';
      case 'watch': return 'watch';
      default: return 'music-note'; // phone / mini / web 兜底
    }
  }

  // ─── 同步播放入口（对齐 mobile player.tsx 的 handleSyncPress / handleDisconnect） ───

  /**
   * 同步按钮点击：
     1. 已同步 → 弹确认 → 断开
     2. 未同步 → 校验 plus VIP → 通过则打开 SyncInviteModal
   */
  private async handleSyncPress(): Promise<void> {
    if (this.syncCheckLoading) return;
    const sv = syncStore.view();
    if (sv.isSynced) {
      this.confirmLeaveSync();
      return;
    }
    this.syncCheckLoading = true;
    try {
      const plusToken = await kvStore.get('plus_token');
      const plusUserId = await kvStore.get('plus_user_id');
      if (!plusToken || !plusUserId) {
        await promptAction.showDialog({
          title: t('playerPage.notice'),
          message: t('playerPage.vipFeatureOnly'),
          buttons: [
            { text: t('common.cancel'), color: '#888' },
            { text: t('playerPage.activateNow'), color: '#3F51B5' },
          ],
        }).catch(() => undefined);
        // ArkUI 的 showDialog 不返回 button index；按 mobile 行为简单提示，跳转交由用户主动去 PersonalPage
        return;
      }
      setPlusAuthToken(plusToken);
      let id: string = plusUserId;
      try {
        const parsed = JSON.parse(plusUserId) as string;
        if (parsed) id = parsed;
      } catch { /* keep raw */ }
      const profile = await plusApi.getMe(id);
      const vipTier = profile?.vipTier;
      const isVip = !!vipTier && vipTier !== 'NONE';
      if (isVip) {
        this.showSyncInvite = true;
      } else {
        await promptAction.showDialog({
          title: t('playerPage.notice'),
          message: t('playerPage.vipFeatureOnly'),
          buttons: [
            { text: t('common.cancel'), color: '#888' },
            { text: t('playerPage.activateNow'), color: '#3F51B5' },
          ],
        }).catch(() => undefined);
      }
    } catch (e) {
      Logger.w('PlayerPage', `VIP check failed: ${String(e)}`);
      promptAction.showToast({ message: t('playerPage.vipStatusFailed') });
    } finally {
      this.syncCheckLoading = false;
    }
  }

  /** 已同步时弹确认；用户点确认后断开并清空 SyncStore。 */
  private confirmLeaveSync(): void {
    promptAction.showDialog({
      title: t('sync.syncStatus'),
      message: t('sync.disconnectConfirm'),
      buttons: [
        { text: t('common.cancel'), color: '#888' },
        { text: t('common.confirm'), color: '#3F51B5' },
      ],
    }).then((res): void => {
      // showDialog 回调按 button index 区分：0=cancel, 1=confirm
      if (res.index === 1) {
        playerStore.leaveSyncSession();
      }
    }).catch(() => undefined);
  }

  onPageShow(): void {
    // 语言可能在后台（语言页/系统设置）被修改：回显时若语言已变化，切换 if 分支重建整页。
    // 不能在隐藏时重建——@StorageProp 在后台更新触发的重建会导致路由页触摸失效，
    // 因此用 langAtBuild 把重建延迟到页面可见时。
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;
  }

  build() {
    // 语言切换时重建整页：条件读取 langAtBuild 建立依赖（框架只追踪读取状态变量的表达式，
    // t() 是普通函数无法被追踪），语言变化使 if 分支切换，旧子树销毁、新子树重建，
    // 所有 t() 文案（含局部 @Builder 和 @Prop 传串的子组件）都按新语言重新求值。
    if (this.langAtBuild === 'zh-CN') {
      this.LocalizedContent()
    } else {
      this.LocalizedContent()
    }
  }

  @Builder
  LocalizedContent() {
    // 注意：必须用 Stack 包裹，不能用 Column。
    // 原因——SyncNotification 内部用 width('100%').height('100%') 占据全屏做悬浮通知，
    // 如果放在 Column 里，它的 height('100%') 会跟 content() 的 layoutWeight(1) 抢主轴空间，
    // 把整个 content 高度压扁成几乎 0，controls() 信息行/进度条/控制行全部被挤出屏幕外。
    // Stack 子元素之间不互相挤占空间，SyncNotification 作为顶层叠层不影响主 Column layout。
    Stack({ alignContent: Alignment.TopStart }) {
      // 主体内容（占满 Stack 100%×100%）
      Column() {
        if (this.view.queue.length === 0) {
          if (!this.isLandscape) {
            this.header();
          }
          Text(t('player.empty'))
            .fontColor(this.theme.colors.textSecondary)
            .margin({ top: 80 });
        } else if (this.isLandscape) {
          this.landscapeContent();
        } else {
          this.header();
          this.content();
        }
      }
      .width('100%').height('100%')
      .onAreaChange((oldVal: Area, newVal: Area) => {
        // 对齐 mobile: isLandscape = width > height；方向切换时重置自动隐藏计时
        const landscape = (newVal.width as number) > (newVal.height as number);
        const changed = landscape !== this.isLandscape;
        this.isLandscape = landscape;
        this.containerHeight = newVal.height as number;
        if (changed) {
          if (this.needsAutoHide()) {
            this.resetHideTimer();
          } else {
            if (this.hideTimerId !== -1) {
              clearTimeout(this.hideTimerId);
              this.hideTimerId = -1;
            }
            this.showLandscapeControls();
          }
        }
      });

      // ArkUI 每个组件只能绑定一个 bindSheet，用不可见锚点分散绑定。
      // 独立挂在 Stack 层而非内容 Column 内：竖屏时内容 Column 被 if/else 整段替换会重建锚点，
      // 导致已打开的半模态跟随旧子树销毁。
      Column().width(0).height(0)
        .bindSheet($$this.showPlaylist, this.playlistSheet(), {
          height: '60%',
          dragBar: true,
          backgroundColor: this.theme.colors.background,
        })
      Column().width(0).height(0)
        .bindSheet($$this.showMore, this.moreSheet(), {
          height: '55%',
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })
      Column().width(0).height(0)
        .bindSheet($$this.showSleepTimer, this.sleepTimerSheet(), {
          height: 360,
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })
      Column().width(0).height(0)
        .bindSheet($$this.showAddToPlaylist, this.addToPlaylistSheet(), {
          height: '50%',
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })
      Column().width(0).height(0)
        .bindSheet($$this.showLyricsSize, this.lyricsSizeSheet(), {
          height: 280,
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })
      Column().width(0).height(0)
        .bindSheet($$this.showControlPos, this.controlPosSheet(), {
          height: 260,
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })
      // 有声书：跳过片头/片尾设置（对齐 mobile PlayerMoreModal skip modal）
      Column().width(0).height(0)
        .bindSheet($$this.showSkipSheet, this.skipSheet(), {
          height: 420,
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })
      Column().width(0).height(0)
        .bindSheet($$this.showMiCast, this.miCastSheet(), {
          height: 420,
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })
      Column().width(0).height(0)
        .bindSheet($$this.showSyncInvite, this.syncInviteSheet(), {
          height: '70%',
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })

      // 同步邀请通知：覆盖在所有内容之上（顶级 Stack，作为叠层不参与主轴 layout）
      Stack() { SyncNotification() }
        .width('100%').height('100%')
        .hitTestBehavior(HitTestMode.Transparent);
    }
    .width('100%').height('100%')
    .backgroundColor(this.theme.colors.background);
  }

  @Builder header() {
    Row() {
      AppIcon({ name: 'chevron-down', iconSize: 26, color: this.theme.colors.text })
        .width(44).height(44)
        .onClick(() => router.back());
      Row().layoutWeight(1);
      Text('⋮')
        .fontSize(22)
        .fontColor(this.theme.colors.text)
        .width(44).height(44)
        .textAlign(TextAlign.Center)
        .onClick(() => { this.showMore = true; });
    }
    .width('100%').height(56)
    .padding({ left: 10, right: 10 });
  }

  /**
   * 横屏布局（对齐 mobile player.tsx 的 landscape 分支）：
   * 左列：返回/更多按钮绝对定位于左上/右上，封面 250×250 居中，
   *       控制条悬浮叠在左列底部（bottom:40, left:10%），空间不足时 3s 无操作自动隐藏，点封面切换显隐；
   * 右列：歌词列表常驻居中滚动（有声书时显示播放列表）。
   */
  @Builder landscapeContent() {
    Row() {
      // ── 左列（对齐 landscapeLeft: flex:1, center, padding:24） ──
      Stack({ alignContent: Alignment.Center }) {
        CoverImage({
          path: this.current()?.coverUrl ?? null,
          imgWidth: 250,
          imgHeight: 250,
          radius: 15,
          fallbackText: (this.current()?.title ?? '?').substring(0, 1),
        })
          .onClick(() => {
            // 对齐 mobile: needsAutoHide 时点封面切换控制条显隐
            if (this.needsAutoHide()) {
              if (this.controlsVisible) {
                if (this.hideTimerId !== -1) {
                  clearTimeout(this.hideTimerId);
                  this.hideTimerId = -1;
                }
                this.controlsVisible = false;
                animateTo({ duration: 300, curve: Curve.EaseOut }, () => {
                  this.controlsOpacity = 0;
                });
              } else {
                this.resetHideTimer();
              }
            }
          });

        // 悬浮控制条（对齐 landscapeControls: absolute, bottom:40, left:10%, width:80%, radius:16, padding:10）
        Column() {
          this.controls();
        }
        .width('80%')
        .borderRadius(16)
        .padding(10)
        .backgroundColor(this.theme.colors.background)
        .position({ x: '10%', y: this.controlsTop() })
        .opacity(this.controlsOpacity)
        .hitTestBehavior(this.controlsVisible ? HitTestMode.Default : HitTestMode.None)
        .onAreaChange((oldVal: Area, newVal: Area) => {
          const firstMeasure = this.controlsHeight <= 0;
          this.controlsHeight = newVal.height as number;
          if (firstMeasure && this.needsAutoHide()) {
            this.resetHideTimer();
          }
        });

        // 返回按钮（对齐 landscapeBackBtn: absolute, top:20, left:20, zIndex:10）
        Row() {
          AppIcon({ name: 'chevron-down', iconSize: 26, color: this.theme.colors.text });
        }
        .width(44).height(44)
        .justifyContent(FlexAlign.Center)
        .position({ x: 20, y: 20 })
        .zIndex(10)
        .onClick(() => router.back());

        // 更多按钮（对齐 landscapeMoreBtn: absolute, top:20, right:20, zIndex:10）
        Row() {
          Text('⋮')
            .fontSize(22)
            .fontColor(this.theme.colors.text)
            .textAlign(TextAlign.Center);
        }
        .width(44).height(44)
        .justifyContent(FlexAlign.Center)
        .position({ x: this.leftColumnWidth - 64, y: 20 })
        .zIndex(10)
        .onClick(() => { this.showMore = true; });
      }
      .layoutWeight(1)
      .height('100%')
      .padding(24)
      // 左列 Stack 有 padding:24，position 以自身宽为基准，'.translate(-64)' 需要补偿 padding
      // 因此把左列宽度测出来算右侧偏移，保证按钮贴右边缘（对齐 mobile right:20）
      .onAreaChange((oldVal: Area, newVal: Area) => {
        this.leftColumnWidth = newVal.width as number;
      });

      // ── 右列（对齐 landscapeRight: flex:1, padding:24, paddingTop:34, paddingBottom:14, center） ──
      Column() {
        if (this.current()?.contentType === 'AUDIOBOOK') {
          this.playlistPanel();
        } else {
          this.lyricsView();
        }
      }
      .layoutWeight(1)
      .height('100%')
      .padding({ left: 24, right: 24, top: 34, bottom: 14 })
      .justifyContent(FlexAlign.Center);
    }
    .width('100%')
    .layoutWeight(1);
  }

  /** 横屏右列播放列表面板（对齐 mobile landscape 中 AUDIOBOOK 时的 renderPlaylist 内联列表）。 */
  @Builder playlistPanel() {
    List() {
      ForEach(this.view.queue, (track: Track, index: number) => {
        ListItem() {
          Row({ space: 10 }) {
            if (index === this.view.currentIndex && this.view.isPlaying) {
              PlayingIndicator({ color: this.theme.colors.primary })
                .width(30);
            } else {
              Text(`${index + 1}`)
                .fontSize(14)
                .fontColor(index === this.view.currentIndex
                  ? this.theme.colors.primary
                  : this.theme.colors.textSecondary)
                .width(30)
                .textAlign(TextAlign.Center);
            }
            CoverImage({
              path: track.coverUrl ?? null,
              imgWidth: 20,
              imgHeight: 20,
              radius: 2,
              fallbackText: (track.title ?? '?').substring(0, 1),
            });
            Column({ space: 2 }) {
              Text(track.title)
                .fontSize(15)
                .fontColor(index === this.view.currentIndex
                  ? this.theme.colors.primary
                  : this.theme.colors.text)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis });
              Text(track.artist ?? '')
                .fontSize(12)
                .fontColor(this.theme.colors.textSecondary)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis });
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start);
          }
          .width('100%')
          .padding({ top: 10, bottom: 10, left: 16, right: 16 })
          .onClick(() => {
            playerStore.playTrackList(this.view.queue, index).catch(() => undefined);
          });
        }
      }, (track: Track, index: number) => `${index}_${track.id}`);
    }
    .width('100%')
    .layoutWeight(1)
    .scrollBar(BarState.Off);
  }

  @Builder content() {
    Column() {
      // 中部：封面 / 歌词，占满剩余空间
      Column() {
        if (this.showLyrics) {
          this.lyricsView();
        } else {
          CoverImage({
            path: this.current()?.coverUrl ?? null,
            imgWidth: 200,
            imgHeight: 200,
            radius: 20,
            fallbackText: (this.current()?.title ?? '?').substring(0, 1),
          })
            .onClick(() => { this.showLyrics = true; });
        }
      }
      .layoutWeight(1)
      .width('100%')
      .justifyContent(FlexAlign.Center);

      // 控制组底部偏移（对齐 mobile player.tsx L1406 <View style={{ marginBottom: controlsBottomOffset }}>）
      Column() {
        this.controls();
      }
      .width('100%')
      .margin({ bottom: this.controlBottomOffset });
    }
    .width('100%')
    .layoutWeight(1)
    .padding({ left: 30, right: 30 });
  }

  @Builder lyricsView() {
    if (this.view.lyrics.length === 0) {
      Text(t('player.noLyrics'))
        .fontSize(16)
        .fontColor(this.theme.colors.textSecondary)
        .onClick(() => {
          // 横屏时歌词常驻右列，不做切换（对齐 mobile 横屏无点按切回）
          if (!this.isLandscape) this.showLyrics = false;
        });
    } else {
      List({ scroller: this.lyricScroller }) {
        ForEach(this.view.lyrics, (line: LyricLine, index: number) => {
          ListItem() {
            Text(line.text)
              // 修复：之前用硬编码 17/15，导致即使 lyricFontSize 已持久化、弹层里 +/- 也实际不会改变歌词大小
              // 现在以 lyricFontSize 为基线，活动行 +1、非活动行 -1，对齐 mobile player.tsx 的 ActiveLyricLine.fontSize 处理
              .fontSize(index === this.view.activeLyricIndex
                ? this.lyricFontSize + 1
                : this.lyricFontSize - 1)
              .fontWeight(index === this.view.activeLyricIndex ? FontWeight.Bold : FontWeight.Medium)
              .fontColor(index === this.view.activeLyricIndex
                ? this.theme.colors.primary
                : this.theme.colors.text)
              .opacity(index === this.view.activeLyricIndex ? 1 : 0.4)
              .textAlign(TextAlign.Center)
              .width('100%')
              .padding({ top: 10, bottom: 10, left: 20, right: 20 });
          }
        }, (line: LyricLine, index: number) => `${index}_${line.time}`);
      }
      .width('100%')
      .height('100%')
      .scrollBar(BarState.Off)
      .onClick(() => {
        if (!this.isLandscape) this.showLyrics = false;
      });
    }
  }

  @Builder controls() {
    Column() {
      // 信息行：曲名 + 艺人 + 喜欢
      Row({ space: 16 }) {
        Column({ space: 5 }) {
          Text(this.current()?.title ?? '')
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.theme.colors.text)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis });
          Text(this.current()?.artist ?? '')
            .fontSize(14)
            .fontColor(this.theme.colors.textSecondary)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis });
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start);

        AppIcon({
          name: this.liked ? 'heart-fill' : 'heart',
          iconSize: 24,
          color: this.liked ? this.theme.colors.primary : this.theme.colors.text,
        })
          .onClick(() => this.toggleLike());

        XiaoAiIcon({
          iconSize: 24,
          color: this.miLoggedIn ? this.theme.colors.primary : this.theme.colors.text,
        })
          .onClick(() => { this.handleOpenMiCast(); });

        // 修复 2：去掉软下线，同步播放按钮常驻（对齐 mobile player.tsx Ionicons people / people-outline）
        // 非会员点击时 handleSyncPress 内部弹"请开通 Plus"对话框（参考 mobile player.tsx L268-322）
        AppIcon({
          name: this.syncView.isSynced ? 'person-fill' : 'person',
          iconSize: 24,
          color: this.syncView.isSynced ? this.theme.colors.primary : this.theme.colors.text,
        })
          .width(28).height(28)
          .margin({ left: 4 })
          .onClick((): void => {
            this.handleSyncPress().catch((e: Error): void => {
              Logger.w('PlayerPage', `handleSyncPress rejected: ${String(e)}`);
            });
          });
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
      .margin({ bottom: 20 });

      // 进度行
      Row({ space: 10 }) {
        Text(formatDuration(this.view.currentMs))
          .fontSize(12)
          .fontColor(this.theme.colors.textSecondary);
        Slider({
          value: this.view.currentMs,
          min: 0,
          max: Math.max(1, this.view.durationMs),
        })
          .layoutWeight(1)
          .trackColor(this.theme.colors.border)
          .selectedColor(this.theme.colors.primary)
          .blockColor(this.theme.colors.primary)
          .onChange((value: number, mode: SliderChangeMode) => {
            // 对齐 mobile：松手/点击才 seek，拖动中不打断播放
            if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) {
              playerStore.seek(value).catch(() => undefined);
            }
          });
        Text(formatDuration(this.view.durationMs))
          .fontSize(12)
          .fontColor(this.theme.colors.textSecondary);
      }
      .width('100%')
      .margin({ bottom: 20 });

      // 控制行：模式 | 上一首 播放 下一首 | 播放列表
      Row() {
        if (!this.view.radioMode) {
          AppIcon({ name: this.playModeIcon(), iconSize: 24, color: this.theme.colors.textSecondary })
            .onClick(() => playerStore.togglePlayMode());
        }

        Row({ space: 30 }) {
          AppIcon({ name: 'skip-back', iconSize: 32, color: this.theme.colors.text })
            .onClick(() => playerStore.playPrevious().catch(() => undefined));
          Stack() {
            AppIcon({
              name: this.view.isPlaying ? 'pause' : 'play',
              iconSize: 28,
              color: this.theme.colors.background,
            });
          }
          .width(50).height(50)
          .borderRadius(25)
          .backgroundColor(this.theme.colors.text)
          .onClick(() => playerStore.togglePlay().catch(() => undefined));
          AppIcon({ name: 'skip-forward', iconSize: 32, color: this.theme.colors.text })
            .onClick(() => playerStore.playNext().catch(() => undefined));
        }
        .alignItems(VerticalAlign.Center);

        if (!this.view.radioMode) {
          AppIcon({ name: 'list', iconSize: 24, color: this.theme.colors.textSecondary })
            .onClick(() => { this.showPlaylist = true; });
        }
      }
      .width('100%')
      .justifyContent(this.view.radioMode ? FlexAlign.Center : FlexAlign.SpaceBetween)
      .margin({ bottom: 30 });
    }
    .width('100%');
  }

  @Builder playlistSheet() {
    Column() {
      Text(t('player.playlistTitle'))
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 8 });

      // 修复 3：Tab 切换行（当前 / 听过 / 收藏），对齐 mobile PlaylistModal L234-268
      Row({ space: 16 }) {
        this.PlaylistTabBtn('current', t('player.playlistTitle'));
        this.PlaylistTabBtn('history', t('common.listened'));
        this.PlaylistTabBtn('favorites', t('common.favorites'));
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 4, bottom: 12 })

      // 列表内容（按 tab 切换数据源）
      if (this.playlistTab === 'current') {
        List() {
          ForEach(this.view.queue, (track: Track, index: number) => {
            ListItem() {
              Row({ space: 10 }) {
                if (index === this.view.currentIndex && this.view.isPlaying) {
                  PlayingIndicator({ color: this.theme.colors.primary })
                    .width(30);
                } else {
                  Text(`${index + 1}`)
                    .fontSize(14)
                    .fontColor(index === this.view.currentIndex
                      ? this.theme.colors.primary
                      : this.theme.colors.textSecondary)
                    .width(30)
                    .textAlign(TextAlign.Center);
                }
                CoverImage({
                  path: track.coverUrl ?? null,
                  imgWidth: 20,
                  imgHeight: 20,
                  radius: 2,
                  fallbackText: (track.title ?? '?').substring(0, 1),
                });
                Column({ space: 2 }) {
                  Text(track.title)
                    .fontSize(15)
                    .fontColor(index === this.view.currentIndex
                      ? this.theme.colors.primary
                      : this.theme.colors.text)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
                  Text(track.artist ?? '')
                    .fontSize(12)
                    .fontColor(this.theme.colors.textSecondary)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start);
              }
              .width('100%')
              .padding({ top: 10, bottom: 10, left: 16, right: 16 })
              .onClick(() => {
                this.showPlaylist = false;
                playerStore.playTrackList(this.view.queue, index).catch(() => undefined);
              });
            }
          }, (track: Track, index: number) => `${index}_${track.id}`);
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off);
      } else if (this.playlistTab === 'history') {
        List() {
          ForEach(this.view.historyTracks, (track: Track) => {
            ListItem() {
              Row({ space: 10 }) {
                CoverImage({
                  path: track.coverUrl ?? null,
                  imgWidth: 20,
                  imgHeight: 20,
                  radius: 2,
                  fallbackText: (track.title ?? '?').substring(0, 1),
                });
                Column({ space: 2 }) {
                  Text(track.title)
                    .fontSize(15)
                    .fontColor(this.theme.colors.text)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
                  Text(track.artist ?? '')
                    .fontSize(12)
                    .fontColor(this.theme.colors.textSecondary)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start);
              }
              .width('100%')
              .padding({ top: 10, bottom: 10, left: 16, right: 16 })
              .onClick(() => {
                this.showPlaylist = false;
                playerStore.playTrackList([track], 0).catch(() => undefined);
              });
            }
          }, (track: Track): string => track.id);
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off);
      } else {
        // favorites
        List() {
          ForEach(this.view.favoritesTracks, (track: Track) => {
            ListItem() {
              Row({ space: 10 }) {
                CoverImage({
                  path: track.coverUrl ?? null,
                  imgWidth: 20,
                  imgHeight: 20,
                  radius: 2,
                  fallbackText: (track.title ?? '?').substring(0, 1),
                });
                Column({ space: 2 }) {
                  Text(track.title)
                    .fontSize(15)
                    .fontColor(this.theme.colors.text)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
                  Text(track.artist ?? '')
                    .fontSize(12)
                    .fontColor(this.theme.colors.textSecondary)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start);
              }
              .width('100%')
              .padding({ top: 10, bottom: 10, left: 16, right: 16 })
              .onClick(() => {
                this.showPlaylist = false;
                playerStore.playTrackList([track], 0).catch(() => undefined);
              });
            }
          }, (track: Track): string => track.id);
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off);
      }
    }
    .width('100%')
    .height('100%')
    .padding({ left: 4, right: 4 });
  }

  /** 修复 3：播放列表 Tab 按钮（带 active 高亮 + 首次切到该 tab 时按需拉数据） */
  @Builder
  PlaylistTabBtn(key: 'current' | 'history' | 'favorites', label: string) {
    Column() {
      Text(label)
        .fontSize(14)
        .fontWeight(this.playlistTab === key ? FontWeight.Bold : FontWeight.Normal)
        .fontColor(this.playlistTab === key ? this.theme.colors.primary : this.theme.colors.textSecondary)
      if (this.playlistTab === key) {
        Text('')
          .width(20)
          .height(2)
          .backgroundColor(this.theme.colors.primary)
          .margin({ top: 4 })
      }
    }
    .alignItems(HorizontalAlign.Center)
    .padding({ top: 4, bottom: 4 })
    .onClick(() => { this.selectPlaylistTab(key); });
  }

  /**
   * 切 tab 时按需触发懒加载（避免冷启动慢；切到 history/favorites 才调 API）。
   * 对齐 mobile PlaylistModal useEffect onTabChange。
   */
  private selectPlaylistTab(key: 'current' | 'history' | 'favorites'): void {
    this.playlistTab = key;
    if (this.playlistTabLoaded[key]) return;
    this.playlistTabLoaded[key] = true;
    if (key === 'history') {
      playerStore.loadHistory().catch((e: Error): void => {
        Logger.w('PlayerPage', `loadHistory rejected: ${String(e)}`);
      });
    } else if (key === 'favorites') {
      playerStore.loadFavorites().catch((e: Error): void => {
        Logger.w('PlayerPage', `loadFavorites rejected: ${String(e)}`);
      });
    }
  }

  @Builder moreSheet() {
    Column() {
      Text(t('playerMore.moreOptions'))
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 8 });
      // 有声书控制组（对齐 mobile PlayerMoreModal audiobookControls：
      // 仅当前曲目为 AUDIOBOOK 时显示，5 键横排 + 底部分隔线）
      if (this.current()?.contentType === 'AUDIOBOOK') {
        Row() {
          this.SkipEdgeBtn('intro')
          this.AudiobookCtrlBtn('skip-back', t('playerMore.back15s'), '', (): void => this.skipBackward15())
          this.AudiobookCtrlBtn('speedometer', `${this.view.speed}x`, '', (): void => this.togglePlaybackRate())
          this.AudiobookCtrlBtn('skip-forward', t('playerMore.forward15s'), '', (): void => this.skipForward15())
          this.SkipEdgeBtn('outro')
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceAround)
        .alignItems(VerticalAlign.Top)
        .padding({ left: 20, right: 20, top: 20, bottom: 20 })
        .border({ width: { bottom: 1 }, color: { bottom: this.theme.colors.border } })
        .margin({ bottom: 8 });
      }
      List() {
        ForEach(this.getMoreOptions(), (opt: MoreOption) => {
          ListItem() {
            Row() {
              Text(opt.label)
                .fontSize(15)
                .fontColor(this.theme.colors.text)
                .layoutWeight(1);
              Text('›')
                .fontSize(20)
                .fontColor(this.theme.colors.textSecondary);
            }
            .width('100%')
            .padding({ top: 16, bottom: 16, left: 20, right: 20 })
            .onClick(() => this.onMoreOption(opt.key));
          }
        }, (opt: MoreOption) => opt.key)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off);
    }
    .width('100%')
    .height('100%')
    .padding({ left: 4, right: 4 });
  }

  /**
   * 有声书控制组中间三键：图标 + 标签（对齐 mobile controlButton）。
   * icon 用 AppIcon；speed 档位的 key 传 'speedometer'。
   * sub 为预留的小字（片头/片尾显示当前秒数用，中间三键传 ''）。
   */
  @Builder
  AudiobookCtrlBtn(icon: AppIconName, label: string, sub: string, onTap: () => void) {
    Column() {
      AppIcon({ name: icon, iconSize: 30, color: this.theme.colors.text })
      Text(label)
        .fontSize(12)
        .fontColor(this.theme.colors.textSecondary)
        .margin({ top: 8 })
        .maxLines(1)
      if (sub.length > 0) {
        Text(sub)
          .fontSize(10)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.theme.colors.primary)
          .margin({ top: 2 })
      }
    }
    .alignItems(HorizontalAlign.Center)
    .onClick(onTap)
  }

  /**
   * 有声书控制组两端：片头/片尾跳过设置（对齐 mobile skipButton：
   * 图标激活时变 primary 色 + 标签 + 当前秒数/关 小字）。
   */
  @Builder
  SkipEdgeBtn(type: 'intro' | 'outro') {
    Column() {
      AppIcon({
        name: type === 'intro' ? 'skip-back-outline' : 'skip-forward-outline',
        iconSize: 30,
        color: (type === 'intro' ? this.view.skipIntroDuration : this.view.skipOutroDuration) > 0
          ? this.theme.colors.primary : this.theme.colors.text,
      })
      Text(type === 'intro' ? t('playerMore.intro') : t('playerMore.outro'))
        .fontSize(12)
        .fontColor(this.theme.colors.textSecondary)
        .margin({ top: 8 })
      Text((type === 'intro' ? this.view.skipIntroDuration : this.view.skipOutroDuration) > 0
        ? `${type === 'intro' ? this.view.skipIntroDuration : this.view.skipOutroDuration}s`
        : t('playerMore.turnOff'))
        .fontSize(10)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.primary)
        .margin({ top: 2 })
    }
    .alignItems(HorizontalAlign.Center)
    .onClick((): void => this.openSkipSheet(type))
  }

  private getMoreOptions(): MoreOption[] {
    // 对齐 mobile PlayerMoreModal.tsx L333-340：下载项随状态切换文案（downloading/downloaded/download）
    const dlLabel: string = this.isDownloading
      ? t('playerMore.downloading', [['name', this.current()?.title ?? '']])
      : this.isDownloaded
        ? t('playerMore.downloaded')
        : t('playerMore.download');
    const opts: MoreOption[] = [
      new MoreOption('artist', t('playerMore.artistDetails')),
      new MoreOption('album', t('playerMore.albumDetails')),
      new MoreOption('track', t('playerMore.trackDetails')),
      // 修复 1：更多选项-下载入口（历史 bug：菜单根本没渲染 download 项）
      new MoreOption('download', dlLabel),
      // 对齐 mobile PlayerMoreModal L310：激活时显示剩余 mm:ss（来自 playerStore 全局定时器）
      new MoreOption('sleepTimer', this.view.sleepTimerRemainingSec > 0
        ? t('playerMore.sleepTimerWithTime', [['time', this.formatSleepRemaining(this.view.sleepTimerRemainingSec)]])
        : t('playerMore.sleepTimer')),
      new MoreOption('addToPlaylist', t('playerMore.addToPlaylist')),
      new MoreOption('lyricsSize', t('playerMore.adjustLyricsSize')),
      new MoreOption('controlPosition', t('playerMore.controlPosition')),
    ];
    return opts;
  }

  private onMoreOption(key: string): void {
    this.showMore = false;
    const cur = this.current();
    if (key === 'artist') {
      if (!cur || !cur.artist) { promptAction.showToast({ message: t('common.unknownArtist') }); return; }
      this.navigateToArtist(cur.artist);
    } else if (key === 'album') {
      if (!cur || !cur.album) { promptAction.showToast({ message: t('common.unknownAlbum') }); return; }
      this.navigateToAlbum(cur.album);
    } else if (key === 'track') {
      if (!cur) return;
      promptAction.showDialog({
        title: `${t('playerMore.trackDetails')} · ${cur.title}`,
        message: `ID: ${cur.id}\n${cur.artist ? t('common.artists') + ': ' + cur.artist + '\n' : ''}${cur.album ? t('playerMore.albumDetails') + ': ' + cur.album + '\n' : ''}${cur.duration ? t('player.sleepTimer') + ': ' + formatDuration((cur.duration) * 1000) : ''}`,
        buttons: [{ text: t('common.close'), color: this.theme.colors.primary }],
      });
    } else if (key === 'download') {
      // 修复 1：点击"下载" → 调 downloadService.downloadTrack
      if (!cur || this.isDownloaded || this.isDownloading) return;
      this.handleDownloadCurrent().catch((e: Error): void => {
        Logger.w('PlayerPage', `handleDownloadCurrent failed: ${String(e)}`);
      });
    } else if (key === 'sleepTimer') {
      setTimeout(() => { this.showSleepTimer = true; }, 150);
    } else if (key === 'addToPlaylist') {
      if (!cur) return;
      this.loadPlaylists();
      setTimeout(() => { this.showAddToPlaylist = true; }, 150);
    } else if (key === 'lyricsSize') {
      setTimeout(() => { this.showLyricsSize = true; }, 150);
    } else if (key === 'controlPosition') {
      setTimeout(() => { this.showControlPos = true; }, 150);
    }
  }

  private async navigateToArtist(name: string): Promise<void> {
    try {
      // 历史 bug：用 latest(50) + find 命中率极低（曲目艺人不在最近 50 则永远 toast unknown）。
      // 改用 search API，按名字精确匹配；limit=10 是兜底（搜索结果按相关度排，取首条最稳）。
      const results = await artistApi.search(name, 10);
      // 优先取完全同名；否则取第一条非空
      const found: ArtistDto | undefined =
        results.find((a: ArtistDto): boolean => a.name === name) ?? results[0];
      if (found && found.id) {
        // ArtistDetailPage 已迁入 NavDestination；PlayerPage 是独立 Page 没法直接持有 pathStack，
        // 用 pendingNavDest + router.back() 桥接：RootShellPage.onPageShow 会读取并 pushPath
        AppStorage.setOrCreate('pendingNavDest', { name: 'ArtistDetail', id: String(found.id) });
        router.back();
      } else {
        promptAction.showToast({ message: t('common.unknownArtist') });
      }
    } catch (e) {
      Logger.w('PlayerPage', `navigateToArtist failed: ${String(e)}`);
      promptAction.showToast({ message: t('common.operationFailed') });
    }
  }

  private async navigateToAlbum(name: string): Promise<void> {
    try {
      // 同 navigateToArtist：改用 albumApi.search 而非 latest(50) + find
      const results = await albumApi.search(name, 10);
      const found: AlbumDto | undefined =
        results.find((a: AlbumDto): boolean => a.name === name) ?? results[0];
      if (found && found.id) {
        // 同 navigateToArtist：pendingNavDest + router.back() 桥接
        AppStorage.setOrCreate('pendingNavDest', { name: 'AlbumDetail', id: String(found.id) });
        router.back();
      } else {
        promptAction.showToast({ message: t('common.unknownAlbum') });
      }
    } catch (e) {
      Logger.w('PlayerPage', `navigateToAlbum failed: ${String(e)}`);
      promptAction.showToast({ message: t('common.operationFailed') });
    }
  }

  /** 定时关闭剩余秒数 → mm:ss 展示（对齐 mobile remainingTime 格式） */
  private formatSleepRemaining(sec: number): string {
    const m: number = Math.floor(sec / 60);
    const s: number = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  /**
   * 定时关闭改由 playerStore 全局管理（对齐 mobile PlayerContext.sleepTimer），
   * 页面关闭后继续计时，到点自动 pause。这里只负责下发指令 + toast。
   */
  private setSleepTimer(minutes: number): void {
    if (minutes <= 0) {
      playerStore.setSleepTimer(0);
      promptAction.showToast({ message: t('player.cancelTimer') });
      return;
    }
    playerStore.setSleepTimer(minutes);
    promptAction.showToast({ message: t('player.sleepTimerSet', [['time', minutes]]) });
  }

  // ─── 有声书控制组（对齐 mobile PlayerMoreModal audiobookControls） ───

  /** 倍速循环：0.5 → 1 → 1.25 → 1.5 → 2（对齐 mobile handleTogglePlaybackRate） */
  private togglePlaybackRate(): void {
    const rates: number[] = [0.5, 1, 1.25, 1.5, 2];
    const cur: number = rates.indexOf(this.view.speed);
    const next: number = rates[(cur + 1) % rates.length];
    playerStore.setSpeed(next).catch((e: Error): void => {
      Logger.w('PlayerPage', `setSpeed failed: ${String(e)}`);
    });
  }

  /** 后退 15s（对齐 mobile handleSkipBackward：seekTo(max(0, position-15))） */
  private skipBackward15(): void {
    const targetMs: number = Math.max(0, this.view.currentMs - 15000);
    playerStore.seek(targetMs).catch(() => undefined);
  }

  /** 前进 15s（对齐 mobile handleSkipForward：seekTo(position+15)，不超出总时长） */
  private skipForward15(): void {
    let targetMs: number = this.view.currentMs + 15000;
    if (this.view.durationMs > 0) targetMs = Math.min(targetMs, this.view.durationMs);
    playerStore.seek(targetMs).catch(() => undefined);
  }

  /** 打开跳过片头/片尾设置：读取当前全局值到临时态（对齐 mobile openPendingModal skip 分支） */
  private openSkipSheet(type: 'intro' | 'outro'): void {
    this.skipSheetType = type;
    const curVal: number = type === 'intro' ? this.view.skipIntroDuration : this.view.skipOutroDuration;
    this.tempSkipTime = curVal === 0 ? 30 : curVal;
    this.showSkipSheet = true;
  }

  /** 确认：临时态写入 playerStore 全局（对齐 mobile confirmSkip） */
  private confirmSkip(): void {
    if (this.skipSheetType === 'intro') playerStore.setSkipIntroDuration(this.tempSkipTime);
    else playerStore.setSkipOutroDuration(this.tempSkipTime);
    this.showSkipSheet = false;
  }

  /** 关闭/清零（对齐 mobile clearSkip） */
  private clearSkip(): void {
    if (this.skipSheetType === 'intro') playerStore.setSkipIntroDuration(0);
    else playerStore.setSkipOutroDuration(0);
    this.showSkipSheet = false;
  }

  /** 秒 → m:ss 大字号显示（对齐 mobile formatTime） */
  private formatSkipClock(sec: number): string {
    const m: number = Math.floor(sec / 60);
    const s: number = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  private async loadPlaylists(): Promise<void> {
    try {
      this.playlists = await playlistApi.list('MUSIC');
    } catch (e) {
      Logger.w('PlayerPage', `loadPlaylists failed: ${String(e)}`);
    }
  }

  private async addToPlaylist(playlistId: string): Promise<void> {
    const cur = this.current();
    if (!cur) return;
    this.showAddToPlaylist = false;
    try {
      await playlistApi.addTrack(playlistId, cur.id);
      promptAction.showToast({ message: t('player.addedToPlaylist') });
    } catch (e) {
      promptAction.showToast({ message: t('player.addToPlaylistFailed') });
    }
  }

  @Builder sleepTimerSheet() {
    Column() {
      Text(t('playerMore.sleepTimer'))
        .fontSize(16).fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 16 });
      if (this.view.sleepTimerRemainingSec > 0) {
        Row() {
          Text(`${t('player.cancelTimer')} (${this.formatSleepRemaining(this.view.sleepTimerRemainingSec)})`)
            .fontSize(15).fontColor('#FF3B30')
        }
        .width('100%').padding({ top: 14, bottom: 14, left: 20, right: 20 })
        .onClick(() => { this.showSleepTimer = false; this.setSleepTimer(0); })
      }
      ForEach([15, 20, 30, 45, 60, 120], (min: number) => {
        Row() {
          Text(`${min} ${t('common.minutes')}`)
            .fontSize(15).fontColor(this.theme.colors.text)
        }
        .width('100%').padding({ top: 14, bottom: 14, left: 20, right: 20 })
        .onClick(() => { this.showSleepTimer = false; this.setSleepTimer(min); })
      }, (min: number) => `st-${min}`)
    }
    .width('100%').padding({ left: 4, right: 4 })
  }

  /**
   * 跳过片头/片尾设置半模态（对齐 mobile PlayerMoreModal skip modal）：
   * 大字号时间 + 加减按钮（±1/±10）+ 预设快捷键（30/60/90/120s）+ 关闭/确认。
   * 全局配置，对所有有声书生效。
   */
  @Builder skipSheet() {
    Column() {
      Text(this.skipSheetType === 'intro' ? t('playerMore.setAutoSkipIntro') : t('playerMore.setAutoSkipOutro'))
        .fontSize(16).fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 4 });
      Text(t('playerMore.appliesToAllAudiobooks'))
        .fontSize(12).fontColor(this.theme.colors.textSecondary)
        .margin({ bottom: 10 });

      // 大字号时间显示（对齐 mobile fontSize:48 primary tabular-nums）
      Text(this.formatSkipClock(this.tempSkipTime))
        .fontSize(48).fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.primary)
        .margin({ top: 10, bottom: 10 });

      // 加减控制栏（对齐 mobile AdjustButton -10/-1 | +1/+10）
      Row({ space: 16 }) {
        this.SkipAdjustBtn(-10, '-10')
        this.SkipAdjustBtn(-1, '-1')
        Column()
          .width(1).height(20)
          .backgroundColor(this.theme.colors.border)
        this.SkipAdjustBtn(1, '+1')
        this.SkipAdjustBtn(10, '+10')
      }
      .margin({ top: 10, bottom: 8 });

      // 常用预设快捷键（对齐 mobile TimePresetChip 30/60/90/120）
      Row({ space: 10 }) {
        ForEach([30, 60, 90, 120], (sec: number) => {
          Text(`${sec}s`)
            .fontSize(12).fontWeight(FontWeight.Medium)
            .fontColor(this.tempSkipTime === sec ? '#FFFFFF' : this.theme.colors.text)
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .borderRadius(16)
            .border({
              width: 1,
              color: this.tempSkipTime === sec ? this.theme.colors.primary : this.theme.colors.border,
            })
            .backgroundColor(this.tempSkipTime === sec ? this.theme.colors.primary : '#19969696')
            .onClick(() => { this.tempSkipTime = sec; })
        }, (sec: number) => `preset-${sec}`)
      }
      .margin({ top: 16, bottom: 16 });

      // 底部操作按钮（对齐 mobile：左 关（红底） flex:1 / 右 完成（primary） flex:2）
      Row({ space: 12 }) {
        Text(t('playerMore.turnOff'))
          .fontSize(15).fontWeight(FontWeight.Medium)
          .fontColor('#FF3B30')
          .textAlign(TextAlign.Center)
          .layoutWeight(1)
          .padding(14)
          .borderRadius(12)
          .backgroundColor('#19FF3B30')
          .onClick(() => this.clearSkip())
        Text(t('common.done'))
          .fontSize(15).fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
          .textAlign(TextAlign.Center)
          .layoutWeight(2)
          .padding(14)
          .borderRadius(12)
          .backgroundColor(this.theme.colors.primary)
          .onClick(() => this.confirmSkip())
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 10 });
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
    .padding({ left: 4, right: 4 });
  }

  /** 加减按钮：44 圆形灰底（对齐 mobile AdjustButton） */
  @Builder
  SkipAdjustBtn(delta: number, label: string) {
    Text(label)
      .fontSize(14).fontWeight(FontWeight.Medium)
      .fontColor(this.theme.colors.text)
      .textAlign(TextAlign.Center)
      .width(44).height(44)
      .borderRadius(22)
      .backgroundColor('#19969696')
      .onClick(() => {
        const next: number = this.tempSkipTime + delta;
        this.tempSkipTime = next < 0 ? 0 : next;
      })
  }

  @Builder addToPlaylistSheet() {
    Column() {
      Text(t('playerMore.addToPlaylist'))
        .fontSize(16).fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 16 });
      List() {
        ForEach(this.playlists, (pl: PlaylistDto) => {
          ListItem() {
            Row() {
              Text(pl.name).fontSize(15).fontColor(this.theme.colors.text).layoutWeight(1)
              Text('›').fontSize(18).fontColor(this.theme.colors.textSecondary)
            }
            .width('100%').padding({ top: 14, bottom: 14, left: 20, right: 20 })
            .onClick(() => this.addToPlaylist(pl.id))
          }
        }, (pl: PlaylistDto) => pl.id)
      }
      .layoutWeight(1).scrollBar(BarState.Off)
    }
    .width('100%').height('100%').padding({ left: 4, right: 4 })
  }

  @Builder lyricsSizeSheet() {
    Column() {
      Text(t('playerMore.adjustLyricsSize'))
        .fontSize(16).fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 16 });
      Text(t('lyricsSize.currentSize') + `: ${this.lyricFontSize}`)
        .fontSize(13).fontColor(this.theme.colors.textSecondary)
        .margin({ bottom: 12 });
      Row({ space: 20 }) {
        Button('-').width(50).height(50).borderRadius(25)
          .backgroundColor(this.theme.colors.surface)
          .fontColor(this.theme.colors.text).fontSize(24)
          .onClick(() => { if (this.lyricFontSize > 12) this.lyricFontSize -= 2; this.saveLyricSize(); })
        Text(`${this.lyricFontSize}`)
          .fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
        Button('+').width(50).height(50).borderRadius(25)
          .backgroundColor(this.theme.colors.surface)
          .fontColor(this.theme.colors.text).fontSize(24)
          .onClick(() => { if (this.lyricFontSize < 40) this.lyricFontSize += 2; this.saveLyricSize(); })
      }
      .margin({ bottom: 16 });
      Button(t('common.reset'))
        .backgroundColor(this.theme.colors.primary).fontColor('#FFFFFF').borderRadius(18)
        .onClick(() => { this.lyricFontSize = 16; this.saveLyricSize(); })
    }
    .width('100%').padding(20).alignItems(HorizontalAlign.Center)
  }

  @Builder controlPosSheet() {
    Column() {
      Text(t('playerMore.controlPosition'))
        .fontSize(16).fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 16 });
      Slider({ value: this.controlBottomOffset, min: 0, max: 120, step: 1 })
        .width('80%')
        .trackColor(this.theme.colors.border)
        .selectedColor(this.theme.colors.primary)
        .blockColor(this.theme.colors.primary)
        .onChange((v: number, mode: SliderChangeMode) => {
          // 实时更新（对齐 mobile onValueChange 实时反馈）；松手/点击时落盘
          this.controlBottomOffset = v;
          if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) {
            this.saveControlOffset(v);
          }
        });
      Text(`${this.controlBottomOffset}`)
        .fontSize(13).fontColor(this.theme.colors.textSecondary)
        .margin({ top: 8, bottom: 16 });
      Button(t('common.reset'))
        .backgroundColor(this.theme.colors.primary).fontColor('#FFFFFF').borderRadius(18)
        .onClick(() => { this.controlBottomOffset = 0; this.saveControlOffset(0); })
    }
    .width('100%').padding(20).alignItems(HorizontalAlign.Center)
  }

  @Builder miCastSheet() {
    Column() {
      Text(t('player.miSpeakerTitle'))
        .fontSize(16).fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 16 });

      // 我的在线设备（播放流转）
      if (this.onlineDevices.length > 0) {
        Text(t('player.onlineDevices'))
          .fontSize(12)
          .fontColor(this.theme.colors.textSecondary)
          .margin({ bottom: 6 })
          .alignSelf(ItemAlign.Start);
        List() {
          ForEach(this.onlineDevices, (d: OnlineDevice) => {
            ListItem() {
              Row({ space: 12 }) {
                Column() {
                  AppIcon({ name: this.platformIcon(d.platform ?? 'phone'), iconSize: 20, color: '#FFFFFFFF' });
                }
                .width(36).height(36).borderRadius(18)
                .backgroundColor('#FF34C759')
                .justifyContent(FlexAlign.Center);

                Column({ space: 2 }) {
                  Text(d.name && d.name.length > 0 ? d.name : t(`player.platform_${d.platform ?? 'web'}`))
                    .fontSize(15).fontWeight(FontWeight.Medium)
                    .fontColor(this.theme.colors.text)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis });
                  Text(t(`player.platform_${d.platform ?? 'web'}`))
                    .fontSize(12).fontColor(this.theme.colors.textSecondary)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis });
                }
                .layoutWeight(1).alignItems(HorizontalAlign.Start);

                if (this.transferringId === (d.deviceId ?? '')) {
                  LoadingProgress().width(18).height(18).color(this.theme.colors.textSecondary);
                } else {
                  AppIcon({ name: 'cast', iconSize: 18, color: this.theme.colors.textSecondary });
                }
              }
              .width('100%')
              .padding({ top: 12, bottom: 12, left: 16, right: 16 })
              .opacity(this.transferringId !== '' ? 0.5 : 1)
              .onClick(() => {
                if (this.transferringId === '') this.handleTransferToDevice(d);
              });
            }
          }, (d: OnlineDevice) => String(d.deviceId ?? d.id));
        }
        .height(Math.min(this.onlineDevices.length * 64, 200))
        .scrollBar(BarState.Off);

        Text(t('player.miSpeakerSection'))
          .fontSize(12)
          .fontColor(this.theme.colors.textSecondary)
          .margin({ top: 8, bottom: 6 })
          .alignSelf(ItemAlign.Start);
      }

      if (this.miLoading) {
        Column({ space: 12 }) {
          LoadingProgress().width(32).height(32).color(this.theme.colors.primary);
          Text(t('common.loading'))
            .fontSize(14).fontColor(this.theme.colors.textSecondary);
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center);
      } else if (this.miLoggedIn) {
        if (this.miDevices.length === 0) {
          Column({ space: 12 }) {
            XiaoAiIcon({ iconSize: 40, color: this.theme.colors.textSecondary });
            Text(t('player.noMiDevices'))
              .fontSize(14).fontColor(this.theme.colors.textSecondary);
          }
          .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center);
        } else {
          List() {
            ForEach(this.miDevices, (device: MiDevice) => {
              ListItem() {
                Row({ space: 12 }) {
                  Column() {
                    XiaoAiIcon({ iconSize: 20, color: '#FFFFFFFF' });
                  }
                  .width(36).height(36).borderRadius(18)
                  .backgroundColor(this.theme.colors.primary)
                  .justifyContent(FlexAlign.Center);

                  Column({ space: 2 }) {
                    Text(device.name)
                      .fontSize(15).fontWeight(FontWeight.Medium)
                      .fontColor(this.theme.colors.text)
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis });
                    if ((device.model ?? '').length > 0) {
                      Text(device.model ?? '')
                        .fontSize(12).fontColor(this.theme.colors.textSecondary)
                        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis });
                    }
                  }
                  .layoutWeight(1).alignItems(HorizontalAlign.Start);

                  Text('›').fontSize(20).fontColor(this.theme.colors.textSecondary);
                }
                .width('100%')
                .padding({ top: 12, bottom: 12, left: 16, right: 16 })
                .opacity(this.miCasting ? 0.5 : 1)
                .onClick(() => {
                  if (!this.miCasting) this.handleCastToMi(device.device_id, device.name);
                });
              }
            }, (device: MiDevice) => device.device_id);
          }
          .layoutWeight(1).scrollBar(BarState.Off);
        }
      } else if (this.miQRCodeUrl !== '') {
        Column({ space: 8 }) {
          Text(t('player.miLoginRequired'))
            .fontSize(14).fontColor(this.theme.colors.textSecondary);
          Image(this.miQRCodeUrl)
            .width(180).height(180).borderRadius(8)
            .backgroundColor('#FFFFFFFF')
            .objectFit(ImageFit.Contain);
          Text(t('player.miScanQRCode'))
            .fontSize(12).fontColor(this.theme.colors.textSecondary);
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center);
      } else {
        Column({ space: 12 }) {
          XiaoAiIcon({ iconSize: 40, color: this.theme.colors.textSecondary });
          Text(t('player.miLoginRequired'))
            .fontSize(14).fontColor(this.theme.colors.textSecondary);
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center);
      }

      Row() {
        Text(t('common.close'))
          .fontSize(15).fontWeight(FontWeight.Medium)
          .fontColor(this.theme.colors.text);
      }
      .width('100%').padding({ top: 12, bottom: 12 })
      .margin({ top: 12 })
      .borderRadius(8)
      .backgroundColor(this.theme.colors.border)
      .justifyContent(FlexAlign.Center)
      .onClick(() => this.handleCloseMiCast());
    }
    .width('100%').height('100%')
    .padding({ left: 16, right: 16, bottom: 12 });
  }

  @Builder syncInviteSheet() {
    SyncInviteModal({
      visible: this.showSyncInvite,
      onClose: (): void => { this.showSyncInvite = false; },
    });
  }

  private saveLyricSize(): void {
    kvStore.set('lyric_font_size', String(this.lyricFontSize)).catch(() => undefined);
  }

  private saveControlOffset(v: number): void {
    kvStore.set('player_controls_bottom_offset', String(v)).catch(() => undefined);
  }

  // ─── 修复 1：当前曲目下载相关 ───

  /**
   * 刷新当前曲目的"是否已下载"状态。
   * 异步探测 FileCache.hasAudio(trackId, ext)，多种 ext 任意命中即 true。
   */
  private refreshDownloadStatus(): void {
    const cur = this.current();
    if (!cur) {
      this.isDownloaded = false;
      return;
    }
    isTrackDownloaded(cur.id)
      .then((yes: boolean): void => { this.isDownloaded = yes; })
      .catch((e: Error): void => {
        Logger.w('PlayerPage', `isTrackDownloaded(${cur.id}) failed: ${String(e)}`);
      });
  }

  /**
   * 下载当前曲目（对齐 mobile PlayerMoreModal.handleDownload）。
   * 入口：onMoreOption('download') 或 controls 区未来扩展的下载图标。
   * 修复：Track 没有 path 字段，用 trackApi.getById 拿 TrackDto（含 path）再传。
   */
  private async handleDownloadCurrent(): Promise<void> {
    const cur = this.current();
    if (!cur) return;
    if (this.isDownloaded || this.isDownloading) return;
    this.isDownloading = true;
    try {
      // 优先用当前 Track 上已有的 url/title/artist/album/coverUrl 兜底；
      // 再用 trackApi.getById 补 path（外部源 URL）或覆盖 title。
      let dto: TrackDto | null = null;
      try {
        dto = await trackApi.getById(cur.id);
      } catch (e) {
        Logger.w('PlayerPage', `getById(${cur.id}) failed: ${String(e)}`);
      }
      const trackDto: TrackDto = dto ?? {
        id: cur.id,
        name: cur.title,
        artist: cur.artist,
        album: cur.album,
        duration: cur.duration,
        cover: cur.coverUrl,
        path: cur.url,
        ext: cur.ext,
        lyrics: cur.lyrics,
        type: cur.contentType,
      };
      const ctx = this.getUIContext().getHostContext() as common.UIAbilityContext;
      await downloadTrack(ctx, trackDto);
      this.isDownloaded = true;
      promptAction.showToast({
        message: t('common.downloadSuccess', [['name', cur.title]]),
      });
    } catch (e) {
      Logger.w('PlayerPage', `download track failed: ${String(e)}`);
      promptAction.showToast({
        message: t('common.downloadFailed', [['name', cur.title]]),
      });
    } finally {
      this.isDownloading = false;
    }
  }

  private loadSingle(trackId: string): void {
    trackApi.getById(trackId)
      .then((dto) => resolveTrackToPlayer(dto, false))
      .then((track) => playerStore.playTrack(track))
      .catch(() => undefined);
  }

  pageTransition() {
    PageTransitionEnter({ duration: 300, curve: Curve.EaseOut })
      .slide(SlideEffect.Bottom)
    PageTransitionExit({ duration: 300, curve: Curve.EaseIn })
      .slide(SlideEffect.Bottom)
  }
}
