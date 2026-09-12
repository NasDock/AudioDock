import { Logger } from 'audiodock_common';
import { kvStore } from 'features_storage';
import { audioBackend, findActiveLine, parseLRC } from 'features_player';
import { socketService } from 'features_socket';
import type { LyricLine } from 'features_player';
import { userDataApi } from 'features_network';
import type { TrackDto } from 'features_network';
import { syncStore } from './SyncStore';
import { authStore } from './AuthStore';

export interface Track {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  url: string;
  ext?: string;
  coverUrl?: string;
  lyrics?: string;
  /** 内容类型 MUSIC | AUDIOBOOK，来自 TrackDto.type；用于内容模式切换时的状态归属。 */
  contentType?: string;
}

export type PlayMode = 'SEQUENCE' | 'LOOP_LIST' | 'LOOP_SINGLE' | 'SHUFFLE';
export type PlayerState = 'idle' | 'preparing' | 'ready' | 'playing' | 'paused' | 'stopped' | 'error';

/** 同步会话中发送 sync_command 的 payload（对齐 mobile socketClient.emit('sync_command', ...)）。 */
export interface SyncCommandPayload {
  sessionId: string;
  type: 'play' | 'pause' | 'seek' | 'track_change' | 'playlist' | 'leave';
  data?: Object;
  /** 单播时的目标 socketId；undefined 表示广播。 */
  targetSocketId?: string;
}

/** 入站 sync_event 的 payload。 */
export interface SyncEventPayload {
  type: string;
  data: Object;
  fromUserId: string;
}

/** 入站 request_initial_state 的 payload。 */
export interface RequestInitialStatePayload {
  sessionId: string;
  fromSocketId: string;
}

/**
 * 从 SyncStore 传过来的 SyncTrack（=object）字段中重建一个 Track 实例。
 * 之所以不用 `as Track` 直接强转：ArkTS 严格模式禁止 object → interface 的 downcast，
 * 哪怕字段全部齐全也会报 "missing properties"。这里走一遍字段白名单显式构造，
 * 既绕开 downcast 检查，也能在缺失字段时降级为空串而不是 undefined。
 */
function buildTrackFromRaw(raw: Record<string, Object>): Track {
  return {
    id: String(raw['id'] ?? ''),
    title: String(raw['title'] ?? ''),
    url: String(raw['url'] ?? ''),
    artist: raw['artist'] ? String(raw['artist']) : undefined,
    album: raw['album'] ? String(raw['album']) : undefined,
    duration: typeof raw['duration'] === 'number' ? Number(raw['duration']) : undefined,
    ext: raw['ext'] ? String(raw['ext']) : undefined,
    coverUrl: raw['coverUrl'] ? String(raw['coverUrl']) : undefined,
    contentType: raw['contentType'] ? String(raw['contentType']) : undefined,
  };
}

/**
 * 从 features_network 拉到的 TrackHistoryItem.track / TrackLikeItem.track（强类型 TrackDto）
 * 重建 PlayerStore.Track。字段映射同 services/trackResolver.ets#toPlayerTrack，
 * 听过/收藏页面只展示，不直接播放，故 url 留空字符串。
 */
function buildTrackFromDto(dto: TrackDto): Track {
  return {
    id: dto.id,
    title: dto.name,
    url: '',
    artist: dto.artist,
    album: dto.album,
    duration: dto.duration,
    ext: dto.ext,
    coverUrl: dto.cover,
    lyrics: dto.lyrics,
    contentType: dto.type,
  };
}

export interface PlayerStateView {
  queue: Track[];
  currentIndex: number;
  currentMs: number;
  durationMs: number;
  state: PlayerState;
  isPlaying: boolean;
  playMode: PlayMode;
  speed: number;
  shuffleSeed: number;
  radioMode: boolean;
  activeLyricIndex: number;
  lyrics: LyricLine[];
  currentLyric: string;
  /** 修复 3：听过/收藏 tab 数据（对齐 mobile PlaylistModal current/history/favorites） */
  historyTracks: Track[];
  favoritesTracks: Track[];
}

type Listener = () => void;

export class PlayerStore {
  queue: Track[] = [];
  currentIndex: number = -1;
  currentMs: number = 0;
  durationMs: number = 0;
  state: PlayerState = 'idle';
  isPlaying: boolean = false;
  playMode: PlayMode = 'SEQUENCE';
  speed: number = 1.0;
  shuffleSeed: number = 0;
  radioMode: boolean = false;
  lyrics: LyricLine[] = [];
  activeLyricIndex: number = -1;
  currentLyric: string = '';
  /** 当前内容模式 MUSIC | AUDIOBOOK（对齐 mobile PlayModeContext），决定状态持久化的键。 */
  contentMode: string = 'MUSIC';
  // 修复 3：听过/收藏数据
  historyTracks: Track[] = [];
  favoritesTracks: Track[] = [];
  /** 已加载进音频后端的曲目 id，用于恢复态下点播放时判断是否需要重新 load。 */
  private loadedTrackId: string = '';

  private listeners = new Set<Listener>();

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  view(): PlayerStateView {
    return {
      queue: this.queue, currentIndex: this.currentIndex,
      currentMs: this.currentMs, durationMs: this.durationMs,
      state: this.state, isPlaying: this.isPlaying,
      playMode: this.playMode, speed: this.speed,
      shuffleSeed: this.shuffleSeed, radioMode: this.radioMode,
      activeLyricIndex: this.activeLyricIndex,
      lyrics: this.lyrics, currentLyric: this.currentLyric,
      historyTracks: this.historyTracks,
      favoritesTracks: this.favoritesTracks,
    };
  }

  /**
   * 修复 3：拉听过的曲目（对齐 mobile PlaylistModal L101-138 调 userDataApi.trackHistory）。
   * 把 TrackHistoryItem 数组投影成 Track[]，存到 view.historyTracks 并 notify。
   */
  async loadHistory(): Promise<void> {
    try {
      const resp = await userDataApi.trackHistory({ pageSize: 50, loadCount: 1, type: 'MUSIC' });
      // LoadMoreResp<T>.list —— 不是 .items（错误 #22/#23 修复）
      // ArkTS 严格模式禁用 type predicate / intersection types / 对象字面量当类型，
      // 这里用 filter(Boolean) + map 内 as TrackDto 显式收窄。
      this.historyTracks = (resp.list ?? [])
        .filter((it): boolean => !!it.track)
        .map((it): Track => buildTrackFromDto(it.track as TrackDto));
      this.notify();
    } catch (e) {
      Logger.w('PlayerStore', `loadHistory failed: ${String(e)}`);
    }
  }

  /**
   * 修复 3：拉收藏的曲目（对齐 mobile PlaylistModal 调 userDataApi.likedTracks）。
   */
  async loadFavorites(): Promise<void> {
    try {
      const resp = await userDataApi.likedTracks({ pageSize: 50, loadCount: 1, type: 'MUSIC' });
      this.favoritesTracks = (resp.list ?? [])
        .filter((it): boolean => !!it.track)
        .map((it): Track => buildTrackFromDto(it.track as TrackDto));
      this.notify();
    } catch (e) {
      Logger.w('PlayerStore', `loadFavorites failed: ${String(e)}`);
    }
  }

  setLyricsText(raw: string): void {
    this.lyrics = parseLRC(raw);
    this.activeLyricIndex = -1;
    this.currentLyric = '';
    this.notify();
  }

  async playTrackList(tracks: Track[], startIndex: number): Promise<void> {
    if (tracks.length === 0) return;
    this.applyIncomingContentMode(tracks[Math.max(0, Math.min(startIndex, tracks.length - 1))]);
    this.queue = tracks.slice();
    this.currentIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
    this.persistState();
    await this.loadCurrent();
    this.broadcastSync('playlist', this.queue);
    const cur = this.queue[this.currentIndex];
    if (cur) this.broadcastSync('track_change', cur);
  }

  async playTrack(track: Track): Promise<void> {
    if (this.queue.length === 0 || this.queue[this.currentIndex]?.id !== track.id) {
      this.applyIncomingContentMode(track);
      this.queue = [track];
      this.currentIndex = 0;
      this.persistState();
    }
    await this.loadCurrent();
    const cur = this.queue[this.currentIndex];
    if (cur) this.broadcastSync('track_change', cur);
  }

  // ─── 修复 7：电台模式（对齐 mobile PlayerContext.tsx enter/exitRadioPlaybackContext） ───

  /**
   * 进入电台模式：把 radioMode 置 true 并播指定曲目。
   * 调用方（MainPage.toggleRadioMode）负责跳路由与拿曲目。
   */
  async startRadioMode(track: Track): Promise<void> {
    this.radioMode = true;
    this.notify();
    await this.playTrack(track);
  }

  /**
   * 退出电台模式：复位 radioMode。
   * 注：实际切歌/停止仍由用户主动操作（mobile 也是仅 reset state）。
   */
  exitRadioPlaybackContext(): void {
    if (!this.radioMode) return;
    this.radioMode = false;
    this.notify();
  }

  /** 新曲目的内容模式与当前不同时，先持久化当前模式状态再切换（对齐 mobile switchContentModeForIncomingTrack）。 */
  private applyIncomingContentMode(track: Track): void {
    const next = track.contentType === 'AUDIOBOOK' ? 'AUDIOBOOK' : 'MUSIC';
    if (next === this.contentMode) return;
    this.persistState();
    this.contentMode = next;
  }

  // insertTracksNext: insert tracks right after the currently playing one.
  // Mirrors mobile PlayerContext.insertTracksNext (apps/mobile/src/context/PlayerContext.tsx:2260).
  // - Empty queue: treat as play-this-batch via playTrackList(tracks, 0)
  // - Otherwise: splice into queue at currentIndex + 1, no currentIndex move, no audio restart
  insertTracksNext(tracks: Track[]): void {
    if (tracks.length === 0) return;
    if (this.queue.length === 0 || this.currentIndex < 0) {
      this.playTrackList(tracks, 0).catch(() => undefined);
      return;
    }
    const insertAt = Math.min(this.currentIndex + 1, this.queue.length);
    this.queue = [
      ...this.queue.slice(0, insertAt),
      ...tracks,
      ...this.queue.slice(insertAt),
    ];
    this.persistState();
    this.notify();
    this.broadcastSync('playlist', this.queue);
  }

  async playNext(): Promise<void> {
    if (this.queue.length === 0) return;
    const next = this.computeNextIndex();
    if (next < 0) return;
    this.currentIndex = next;
    this.persistState();
    await this.loadCurrent();
  }

  async playPrevious(): Promise<void> {
    if (this.queue.length === 0) return;
    if (this.currentMs > 3000) { await audioBackend.seek(0); return; }
    const prev = this.computePrevIndex();
    if (prev < 0) return;
    this.currentIndex = prev;
    this.persistState();
    await this.loadCurrent();
  }

  async togglePlay(): Promise<void> {
    const cur = this.queue[this.currentIndex];
    if (cur && this.loadedTrackId !== cur.id) {
      // 恢复态（冷启动/内容模式切换后）曲目尚未加载进后端：加载并从记录位置续播
      await this.loadCurrent(this.currentMs);
      return;
    }
    // 用 isPlaying 判断而不是 state —— state 由 AVPlayer 异步回调设置，
    // 在 await audioBackend.play/pause 返回时可能还没同步；isPlaying 才是用户感知的真实状态。
    // 同时显式同步 state，避免下次 togglePlay 判断时 state 与 isPlaying 不一致
    if (this.isPlaying) {
      await audioBackend.pause();
      this.isPlaying = false;
      this.state = 'paused';
    } else {
      await audioBackend.play();
      this.isPlaying = true;
      this.state = 'playing';
    }
    this.notify();
    this.broadcastSync(this.isPlaying ? 'play' : 'pause');
  }

  async seek(ms: number): Promise<void> {
    await audioBackend.seek(ms);
    this.currentMs = ms;
    this.notify();
    this.broadcastSync('seek', ms);
  }

  /**
   * 仅暂停当前音频（不释放、不切歌）。对齐 mobile usePlayer().pause()，
   * 用于「进入 MV 详情页时让出音频通道」场景：MV 详情页 onAppear 调用一次即可。
   */
  async pause(): Promise<void> {
    if (this.state === 'playing' || this.isPlaying) {
      await audioBackend.pause();
      this.isPlaying = false;
      this.state = 'paused';
      this.notify();
      this.broadcastSync('pause');
    }
  }

  /**
   * 仅恢复播放（不切歌、不重置）。对齐 mobile usePlayer().resume()。
   * 主要给 sync_event 入站用：避免触发 togglePlay 的「未加载则加载并续播」分支。
   */
  async resume(): Promise<void> {
    if (this.state === 'paused' || !this.isPlaying) {
      await audioBackend.play();
      this.isPlaying = true;
      this.state = 'playing';
      this.notify();
      this.broadcastSync('play');
    }
  }

  async setSpeed(s: number): Promise<void> {
    this.speed = s;
    await audioBackend.setSpeed(s);
    this.notify();
  }

  setMode(mode: PlayMode): void { this.playMode = mode; this.persistState(); this.notify(); }

  // 对齐 mobile 的 togglePlayMode 循环顺序
  togglePlayMode(): void {
    const order: PlayMode[] = ['SEQUENCE', 'SHUFFLE', 'LOOP_LIST', 'LOOP_SINGLE'];
    const next = order[(order.indexOf(this.playMode) + 1) % order.length];
    this.setMode(next);
  }

  clear(): void {
    this.queue = []; this.currentIndex = -1;
    this.currentMs = 0; this.durationMs = 0;
    this.state = 'idle'; this.isPlaying = false;
    this.lyrics = []; this.activeLyricIndex = -1; this.currentLyric = '';
    this.loadedTrackId = '';
    audioBackend.stop().catch(() => undefined);
    this.persistState();
    this.notify();
  }

  private async loadCurrent(resumeMs: number = 0): Promise<void> {
    const t = this.queue[this.currentIndex];
    if (!t) return;
    this.state = 'preparing';
    this.notify();
    try {
      // contentType 透传给 AVPlayerBackend，用于设置 AVPlayer.audioRendererInfo.usage，
      // 系统靠它把发声流和 AVSession 关联，通知栏/锁屏才展示媒体播控卡片。
      await audioBackend.load(t.url, undefined, t.contentType ?? this.contentMode);
      await audioBackend.play();
      this.loadedTrackId = t.id;
      this.state = 'playing'; this.isPlaying = true;
      // 后端 duration 字段单位是秒，PlayerStore 内部统一用毫秒
      this.durationMs = (t.duration ?? 0) * 1000;
      this.currentMs = resumeMs > 0 ? resumeMs : 0;
      if (resumeMs > 0) {
        audioBackend.seek(resumeMs).catch(() => undefined);
      }
      this.setLyricsText(t.lyrics ?? '');
      Logger.i('PlayerStore', `playing ${t.id} ${t.title}`);
      this.notify();
    } catch (e) {
      this.state = 'error';
      Logger.e('PlayerStore', `load failed: ${String(e)}`);
      this.notify();
    }
  }

  private computeNextIndex(): number {
    if (this.playMode === 'LOOP_SINGLE') return this.currentIndex;
    if (this.playMode === 'SHUFFLE') {
      if (this.queue.length <= 1) return this.currentIndex;
      let i = Math.floor(Math.random() * this.queue.length);
      if (i === this.currentIndex) i = (i + 1) % this.queue.length;
      return i;
    }
    const next = this.currentIndex + 1;
    if (next >= this.queue.length) return this.playMode === 'LOOP_LIST' ? 0 : -1;
    return next;
  }

  private computePrevIndex(): number {
    const prev = this.currentIndex - 1;
    if (prev < 0) return this.playMode === 'LOOP_LIST' ? this.queue.length - 1 : -1;
    return prev;
  }

  // Called by playbackService on AVPlayer events
  onTimeUpdate(ms: number, durationMs: number): void {
    this.currentMs = ms;
    if (durationMs > 0) this.durationMs = durationMs;
    if (this.lyrics.length > 0) {
      const idx = findActiveLine(this.lyrics, ms);
      if (idx !== this.activeLyricIndex) {
        this.activeLyricIndex = idx;
        this.currentLyric = idx >= 0 ? this.lyrics[idx].text : '';
      }
    }
    this.notify();
  }

  onStateChange(s: PlayerState): void {
    this.state = s; this.isPlaying = s === 'playing'; this.notify();
  }

  onEndOfStream(): void {
    if (this.playMode === 'LOOP_SINGLE') {
      audioBackend.seek(0).then(() => audioBackend.play()).catch(() => undefined);
      return;
    }
    this.playNext().catch(() => undefined);
  }

  onError(): void {
    this.state = 'error'; this.notify();
    this.playNext().catch(() => undefined);
  }

  // ─── 持久化（对齐 mobile playbackState_${mode} 机制：音乐/有声书各自独立播放上下文） ───
  private stateKey(): string {
    return `playbackState_${this.contentMode}`;
  }

  private persistState(): void {
    if (this.queue.length === 0) {
      kvStore.set(this.stateKey(), '').catch(() => undefined);
      return;
    }
    const data = JSON.stringify({
      queue: this.queue,
      currentIndex: this.currentIndex,
      playMode: this.playMode,
      currentMs: this.currentMs,
    });
    kvStore.set(this.stateKey(), data).catch(() => undefined);
  }

  /** 切换内容模式：持久化当前模式状态、停止播放，恢复目标模式的状态（对齐 mobile 的 mode 变化 effect）。 */
  async switchContentMode(mode: string): Promise<void> {
    if (mode !== 'MUSIC' && mode !== 'AUDIOBOOK') return;
    if (mode === this.contentMode) return;
    this.persistState();
    this.contentMode = mode;
    audioBackend.stop().catch(() => undefined);
    this.loadedTrackId = '';
    await this.loadPersistedState();
  }

  /** 从当前内容模式的持久化键恢复队列（不自动播放）。 */
  private async loadPersistedState(): Promise<void> {
    try {
      let raw = await kvStore.get(this.stateKey());
      // 旧版本只有一个全局 playbackState 键，音乐模式下做一次迁移读取
      if ((raw === null || raw.length === 0) && this.contentMode === 'MUSIC') {
        raw = await kvStore.get('playbackState');
      }
      if (raw === null || raw.length === 0) {
        this.resetToIdle();
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, Object>;
      const queue = parsed['queue'] as Track[];
      if (!Array.isArray(queue) || queue.length === 0) {
        this.resetToIdle();
        return;
      }
      this.queue = queue;
      this.currentIndex = (parsed['currentIndex'] as number) ?? 0;
      if (this.currentIndex < 0 || this.currentIndex >= queue.length) this.currentIndex = 0;
      const pm = parsed['playMode'] as string;
      if (pm === 'SEQUENCE' || pm === 'LOOP_LIST' || pm === 'LOOP_SINGLE' || pm === 'SHUFFLE') {
        this.playMode = pm;
      }
      this.currentMs = (parsed['currentMs'] as number) ?? 0;
      this.state = 'paused';
      this.isPlaying = false;
      this.durationMs = (queue[this.currentIndex]?.duration ?? 0) * 1000;
      this.setLyricsText(queue[this.currentIndex]?.lyrics ?? '');
      Logger.i('PlayerStore', `restored[${this.contentMode}] ${queue.length} tracks, index=${this.currentIndex}`);
      this.notify();
    } catch (e) {
      Logger.w('PlayerStore', `loadPersistedState failed: ${String(e)}`);
      this.resetToIdle();
    }
  }

  /** 目标模式没有保存的播放状态时回到空态（MiniPlayer 随之隐藏），不触发持久化。 */
  private resetToIdle(): void {
    this.queue = []; this.currentIndex = -1;
    this.currentMs = 0; this.durationMs = 0;
    this.state = 'idle'; this.isPlaying = false;
    this.lyrics = []; this.activeLyricIndex = -1; this.currentLyric = '';
    this.notify();
  }

  /** 应用启动时调用：按首页保存的内容模式恢复对应播放上下文（不自动播放）。 */
  async restoreState(): Promise<void> {
    try {
      const savedMode = await kvStore.get('playMode');
      if (savedMode === 'MUSIC' || savedMode === 'AUDIOBOOK') {
        this.contentMode = savedMode;
      }
    } catch (e) {
      Logger.w('PlayerStore', `read playMode failed: ${String(e)}`);
    }
    await this.loadPersistedState();
  }

  // ────────────────────────────────────────────────────────────
  // 同步播放（对齐 mobile PlayerContext 的 isSynced / broadcastSync / sync_event 处理）
  // ────────────────────────────────────────────────────────────

  /**
   * 防止「处理 sync_event 导致的本地状态变更」再次触发 broadcastSync 引发回环。
   * 用普通字段而非 ref，结构体本身即可变；调用方在 await 块前后手动 set/clear。
   */
  private isProcessingSync: boolean = false;

  /** 同步相关的 socket listener 是否已绑定（幂等）。 */
  private syncListenersBound: boolean = false;

  /**
   * 在自身状态变化（pause/play/seek/track_change/playlist）时向同步会话广播。
   * 仅在已加入会话且非由 sync_event 触发的本地操作时发送。
   */
  broadcastSync(type: 'play' | 'pause' | 'seek' | 'track_change' | 'playlist' | 'leave',
                data?: Object): void {
    const sv = syncStore.view();
    if (!sv.isSynced || !sv.sessionId) return;
    if (this.isProcessingSync) return;
    const payload: SyncCommandPayload = {
      sessionId: sv.sessionId,
      type,
      data,
    };
    socketService.emit('sync_command', payload);
  }

  /** 由调用方（一般是 Index.ets 启动后）触发：注册 sync_event / request_initial_state 监听。 */
  bindSyncSocketListeners(): void {
    if (this.syncListenersBound) return;
    this.syncListenersBound = true;
    socketService.on('sync_event', (payload: Object | null | undefined): void => {
      if (!payload) return;
      this.handleSyncEvent(payload as SyncEventPayload);
    });
    socketService.on('request_initial_state', (payload: Object | null | undefined): void => {
      if (!payload) return;
      this.handleRequestInitialState(payload as RequestInitialStatePayload);
    });
    // 监听 SyncStore 的 lastAcceptedInvite，自动应用对方的播放上下文
    // 同时根据 isSynced 翻转触发发起方自动 resume
    syncStore.subscribe((): void => {
      this.maybeApplyAcceptedInvite();
      this.maybeAutoResumeOnSessionStart();
    });
    Logger.i('PlayerStore', 'sync listeners bound');
  }

  unbindSyncSocketListeners(): void {
    if (!this.syncListenersBound) return;
    this.syncListenersBound = false;
    socketService.off('sync_event');
    socketService.off('request_initial_state');
  }

  /**
   * 当 SyncStore 标记自己已加入会话（isSynced=true）且本端是「发起方」（没有
   * lastAcceptedInvite）时，自动恢复播放，让被邀请方加入后能跟上节奏。
   * 对齐 mobile 的 prevIsSyncedRef useEffect。
   */
  private prevIsSynced: boolean = false;
  maybeAutoResumeOnSessionStart(): void {
    const sv = syncStore.view();
    if (sv.isSynced && !this.prevIsSynced && !sv.lastAcceptedInvite) {
      Logger.i('PlayerStore', '[Sync] Session active, initiator resuming playback');
      this.resume().catch((e: Error): void => {
        Logger.w('PlayerStore', `auto-resume failed: ${String(e)}`);
      });
    }
    this.prevIsSynced = sv.isSynced;
  }

  /**
   * 处理来自其他端的同步命令。isProcessingSync 在块执行期间为 true，
   * 防止由此触发的本端 broadcastSync 引发回环。
   */
  private async handleSyncEvent(payload: SyncEventPayload): Promise<void> {
    // 忽略自己发出的事件（理论上 socket 服务端不会回环，但保底）
    const localId = authStore.state_.user?.id ?? '';
    if (payload.fromUserId === localId) return;
    this.isProcessingSync = true;
    try {
      switch (payload.type) {
        case 'play':
          await this.resume();
          break;
        case 'pause':
          await this.pause();
          break;
        case 'seek':
          await this.audioSeekOnly(Number(payload.data));
          break;
        case 'track_change': {
          const raw = payload.data as Record<string, Object>;
          const incomingId = typeof raw['id'] === 'string' ? raw['id'] : '';
          if (incomingId && this.queue[this.currentIndex]?.id !== incomingId) {
            const incoming = buildTrackFromRaw(raw);
            await this.applyIncomingContentMode(incoming);
            this.queue = [incoming];
            this.currentIndex = 0;
            await this.loadCurrent();
          }
          break;
        }
        case 'playlist': {
          const list = payload.data as Record<string, Object>[];
          if (Array.isArray(list) && list.length > 0) {
            this.queue = list.map((r): Track => buildTrackFromRaw(r));
            if (this.currentIndex < 0 || this.currentIndex >= list.length) {
              this.currentIndex = 0;
            }
            await this.loadCurrent();
          }
          break;
        }
        case 'leave':
          Logger.i('PlayerStore', 'remote participant left sync session');
          break;
        default:
          break;
      }
    } catch (e) {
      Logger.w('PlayerStore', `handleSyncEvent failed: ${String(e)}`);
    } finally {
      // 短暂防回环窗口：避免 pause/play 后立即 broadcast 同一事件
      setTimeout((): void => {
        this.isProcessingSync = false;
      }, 100);
    }
  }

  /**
   * 仅 seek，不广播（用于 sync_event 入站，避免回环）。
   * 与公开 seek() 的差异：seek() 会调 broadcastSync('seek', ms)，这里不会。
   */
  private async audioSeekOnly(ms: number): Promise<void> {
    await audioBackend.seek(ms);
    this.currentMs = ms;
    this.notify();
  }

  /**
   * 收到 request_initial_state 时，把自己当前曲目 + 播放/暂停状态推给请求方。
   * 对齐 mobile 的 handleRequestInitialState：先发 track_change 再发 play/pause。
   */
  private handleRequestInitialState(payload: RequestInitialStatePayload): void {
    const cur = this.queue[this.currentIndex];
    if (!cur) return;
    const tcPayload: SyncCommandPayload = {
      sessionId: payload.sessionId,
      type: 'track_change',
      data: cur,
      targetSocketId: payload.fromSocketId,
    };
    socketService.emit('sync_command', tcPayload);
    setTimeout((): void => {
      const ppPayload: SyncCommandPayload = {
        sessionId: payload.sessionId,
        type: this.isPlaying ? 'play' : 'pause',
        data: this.currentMs,
        targetSocketId: payload.fromSocketId,
      };
      socketService.emit('sync_command', ppPayload);
    }, 200);
  }

  /**
   * SyncStore.lastAcceptedInvite 变化时自动应用对方上下文（setQueue → setTrack → seekTo）。
   * 只在「刚 accept、本地还未载入该曲」时执行，避免重复触发。
   */
  private appliedInviteSessionId: string = '';
  private maybeApplyAcceptedInvite(): void {
    const sv = syncStore.view();
    const inv = sv.lastAcceptedInvite;
    if (!inv || inv.sessionId === this.appliedInviteSessionId) return;
    this.appliedInviteSessionId = inv.sessionId;
    this.isProcessingSync = true;
    const apply = async (): Promise<void> => {
      try {
        // 从 SyncInvite 的 SyncTrack（=object）读取 id/title/url 等字段，避免 ArkTS 不允许 object → Track 的 downcast
        const incomingRaw: Record<string, Object> | null =
          inv.currentTrack ? (inv.currentTrack as Record<string, Object>) : null;
        let activeTrack: Track | null = null;
        if (inv.playlist && inv.playlist.length > 0) {
          const remoteRaw: Record<string, Object>[] = inv.playlist as Record<string, Object>[];
          this.queue = remoteRaw.map((raw): Track => buildTrackFromRaw(raw));
          const idx = incomingRaw
            ? this.queue.findIndex((t): boolean => t.id === String(incomingRaw['id'] ?? ''))
            : 0;
          this.currentIndex = idx >= 0 ? idx : 0;
          activeTrack = this.queue[this.currentIndex] ?? null;
        } else if (incomingRaw) {
          activeTrack = buildTrackFromRaw(incomingRaw);
          this.queue = [activeTrack];
          this.currentIndex = 0;
        }
        if (activeTrack) {
          await this.applyIncomingContentMode(activeTrack);
          await this.loadCurrent(typeof inv.progress === 'number' ? inv.progress : 0);
        }
      } catch (e) {
        Logger.w('PlayerStore', `applyInviteContext failed: ${String(e)}`);
      } finally {
        setTimeout((): void => {
          this.isProcessingSync = false;
        }, 1000);
      }
    };
    apply().catch((e: Error): void => {
      Logger.w('PlayerStore', `applyInviteContext rejected: ${String(e)}`);
    });
  }

  /**
   * 由 UI（PlayerPage 「断开」按钮）调用：发送 player_left 并清空 SyncStore 状态。
   * 注意：这里不主动 stop 当前播放，让用户继续听自己的本地队列。
   */
  leaveSyncSession(): void {
    syncStore.leaveSession();
  }

  private notify(): void {
    for (const l of this.listeners) l();
    // 状态变化时主动推卡片（不依赖 widgetBridge.install 的订阅时机，
    // 对齐 iOS 的 commit() 三连：写 Preferences → 批量 updateForm）
    // 注意：loadPersistedState 恢复状态时也会调 notify()，但此时 isPlaying=false，
    // 推空状态会覆盖 restoreNowPlayingFromPersistedState 恢复的卡片数据。
    // 所以只在「真正播放状态变化」时才推（isPlaying 或 queue 有值）。
    if (this.isPlaying || this.queue.length > 0) {
      // 走 WidgetBridge.scheduleSyncNowPlaying 的 300ms 节流，避免进度 tick（~50ms 一次）
      // 高频 notify() 把 formProvider.updateForm 打爆（系统 hilog: isReportOverSize,checkFail）。
      this.schedulePushToWidget();
    }
  }

  private schedulePushToWidget(): void {
    // 动态 import 避免循环依赖（PlayerStore → WidgetBridge → PlayerStore）
    import('../services/WidgetBridge').then((mod): void => {
      mod.widgetBridge.scheduleSyncNowPlaying();
    }).catch((e: Error): void => {
      Logger.w('PlayerStore', `schedulePushToWidget import: ${e.message}`);
    });
  }
}

export const playerStore: PlayerStore = new PlayerStore();
