import media from '@ohos.multimedia.media';
import audio from '@ohos.multimedia.audio';
import fs from '@ohos.file.fs';
import { BusinessError } from '@ohos.base';
import { Logger } from 'audiodock_common';
import type { IAudioPlayer, PlayerEvent, PlayerListener, PlayerPayload,
  TimeUpdatePayload, StateChangePayload, ErrorPayload, BufferingPayload } from './IAudioPlayer';

export class AVPlayerBackend implements IAudioPlayer {
  private player: media.AVPlayer | null = null;
  private listeners = new Map<PlayerEvent, Set<PlayerListener>>();
  private currentUrl: string = '';
  // 本地缓存文件通过 fdSrc 播放，需要持有并在切歌/释放时关闭 fd
  private currentFd: number = -1;
  private prepareResolve: (() => void) | null = null;
  private prepareReject: ((err: Error) => void) | null = null;
  /**
   * 当前曲目的内容类型（MUSIC / AUDIOBOOK），load 时更新，
   * 在 AVPlayer 进入 initialized 态时（首次 prepare 前）写入 audioRendererInfo.usage。
   * 系统靠音频流类型把发声流和 AVSession 关联；缺省时音频流不被识别为媒体流，
   * 通知栏/锁屏只显示长时任务普通通知，不出现系统媒体播控卡片。
   */
  private currentContentType: string = 'MUSIC';
  /** audioRendererInfo 是否已在当前 initialized 态设置成功（用于失败后重试）。 */
  private rendererInfoApplied: boolean = false;
  /** 当前数据源描述，audioRendererInfo 设置失败后重试时需要重建数据源。 */
  private pendingSourceIsNetwork: boolean = false;

  private async ensure(): Promise<media.AVPlayer> {
    if (this.player) return this.player;
    this.player = await media.createAVPlayer();
    Logger.i('AVPlayer', 'createAVPlayer ok');
    this.bindInternal();
    return this.player;
  }

  private closeFd(): void {
    if (this.currentFd >= 0) {
      try { fs.closeSync(this.currentFd); } catch (_e) { /* ignore */ }
      this.currentFd = -1;
    }
  }

  async load(url: string, _headers?: Record<string, string>, contentType?: string): Promise<void> {
    const p = await this.ensure();
    this.currentContentType = contentType === 'AUDIOBOOK' ? 'AUDIOBOOK' : 'MUSIC';
    // AVPlayer.url 只接受 http(s) 网络地址；本地缓存文件必须走 fdSrc
    const isNetwork = url.startsWith('http://') || url.startsWith('https://');
    this.pendingSourceIsNetwork = isNetwork;
    // 同一来源已加载则直接复用，避免重复 prepare（error 态不复用，允许重试）
    if (this.currentUrl === url && p.state !== 'error' &&
      (isNetwork ? p.url === url : this.currentFd >= 0)) {
      return;
    }
    // 新数据源：audioRendererInfo 必须在下一次 initialized 态重新写入
    this.rendererInfoApplied = false;
    // 切歌时必须先回到 idle 态，否则 AVPlayer 状态机不允许直接设置 url
    const st = p.state;
    if (st !== 'idle') {
      try { await p.stop(); } catch (_e) { /* ignore */ }
      try { await p.reset(); } catch (_e) { /* ignore */ }
    }
    this.closeFd();
    this.currentUrl = url;
    Logger.i('AVPlayer', `load url=${url}`);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.prepareReject) {
          const r = this.prepareReject;
          this.prepareResolve = null;
          this.prepareReject = null;
          r(new Error('AVPlayer prepare timeout (15s)'));
        }
      }, 15000);
      this.prepareResolve = () => { clearTimeout(timer); resolve(); };
      this.prepareReject = (e: Error) => { clearTimeout(timer); reject(e); };
      try {
        if (isNetwork) {
          // 设置 url 后播放器进入 initialized 态，prepare 在 stateChange 回调里触发
          p.url = url;
        } else {
          const file = fs.openSync(url, fs.OpenMode.READ_ONLY);
          this.currentFd = file.fd;
          const size = fs.statSync(url).size;
          // fdSrc 同样进入 initialized 态，复用同一套 prepare 流程
          p.fdSrc = { fd: file.fd, offset: 0, length: size };
        }
      } catch (e) {
        clearTimeout(timer);
        this.prepareResolve = null;
        this.prepareReject = null;
        this.closeFd();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  async play(): Promise<void> { await (await this.ensure()).play(); }
  async pause(): Promise<void> { await (await this.ensure()).pause(); }
  async stop(): Promise<void> { await (await this.ensure()).stop(); }
  async release(): Promise<void> {
    this.closeFd();
    this.currentUrl = '';
    if (this.player) { await this.player.release(); this.player = null; }
  }
  async seek(positionMs: number): Promise<void> {
    (await this.ensure()).seek(positionMs);
  }
  /**
   * 设置倍速。注意 AVPlayer.setSpeed 的参数是 PlaybackSpeed 枚举（不是裸倍率 number），
   * 传 1.25 这种小数会被参数校验拒绝（5400103）静默失败；
   * 且只能在 prepared/playing/paused/completed 态调用，其他状态 5400102 静默失败。
   * 这里做倍率→枚举映射 + 状态守卫 + speedDone 日志，失败抛错让上层知道没生效。
   */
  async setSpeed(speed: number): Promise<void> {
    const p = await this.ensure();
    const allowed = ['prepared', 'playing', 'paused', 'completed'];
    if (allowed.indexOf(p.state) < 0) {
      const msg = `setSpeed(${speed}) rejected: state=${p.state} not in [${allowed.join('/')}]`;
      Logger.w('AVPlayer', msg);
      throw new Error(msg);
    }
    const map = new Map<number, media.PlaybackSpeed>([
      [0.5, media.PlaybackSpeed.SPEED_FORWARD_0_50_X],
      [0.75, media.PlaybackSpeed.SPEED_FORWARD_0_75_X],
      [1.0, media.PlaybackSpeed.SPEED_FORWARD_1_00_X],
      [1.25, media.PlaybackSpeed.SPEED_FORWARD_1_25_X],
      [1.5, media.PlaybackSpeed.SPEED_FORWARD_1_50_X],
      [1.75, media.PlaybackSpeed.SPEED_FORWARD_1_75_X],
      [2.0, media.PlaybackSpeed.SPEED_FORWARD_2_00_X],
    ]);
    const mapped = map.get(speed);
    if (mapped === undefined) {
      const msg = `setSpeed(${speed}) rejected: no PlaybackSpeed enum mapping`;
      Logger.w('AVPlayer', msg);
      throw new Error(msg);
    }
    p.setSpeed(mapped);
    Logger.i('AVPlayer', `setSpeed(${speed}) -> enum=${mapped} state=${p.state}`);
  }
  async setVolume(v: number): Promise<void> {
    (await this.ensure()).setVolume(v);
  }

  on(event: PlayerEvent, cb: PlayerListener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: PlayerEvent, cb?: PlayerListener): void {
    const set = this.listeners.get(event);
    if (!set) return;
    if (cb) set.delete(cb); else set.clear();
  }

  private bindInternal(): void {
    const p = this.player;
    if (!p) return;
    p.on('timeUpdate', (ms: number) => {
      const pl: TimeUpdatePayload = { currentMs: ms, durationMs: p.duration };
      this.dispatch('timeUpdate', pl);
    });
    p.on('durationUpdate', (ms: number) => {
      const pl: TimeUpdatePayload = { currentMs: p.currentTime, durationMs: ms };
      this.dispatch('durationUpdate', pl);
    });
    p.on('stateChange', (s: media.AVPlayerState) => {
      const pl: StateChangePayload = { state: s as string };
      this.dispatch('stateChange', pl);
      if (s === 'initialized') {
        // audioRendererInfo 只能在 initialized 态、首次 prepare 前设置（API 12+）。
        // 声明正确的 StreamUsage（MUSIC / AUDIOBOOK），系统才会把这条音频流
        // 识别为媒体流并和 AVSession 关联，通知栏/锁屏才展示媒体播控卡片。
        // 注意：这一步若被静默吞掉，系统侧会报 "not audio broker"，整条播控链路断掉，
        // 所以成功/失败都必须打日志，失败时 reset 重建数据源重试一次。
        const usage = this.currentContentType === 'AUDIOBOOK'
          ? audio.StreamUsage.STREAM_USAGE_AUDIOBOOK
          : audio.StreamUsage.STREAM_USAGE_MUSIC;
        if (!this.rendererInfoApplied) {
          try {
            const rendererInfo: audio.AudioRendererInfo = {
              usage: usage,
              rendererFlags: 0,
            };
            p.audioRendererInfo = rendererInfo;
            this.rendererInfoApplied = true;
            Logger.i('AVPlayer', `audioRendererInfo set: usage=${this.currentContentType} state=${p.state}`);
          } catch (e) {
            const err = e as BusinessError;
            Logger.e('AVPlayer', `set audioRendererInfo failed: code=${err.code} msg=${err.message} state=${p.state}`);
            // 失败重试：回 idle 重建数据源，下一个 initialized 再设一次（只重试一次，避免死循环）
            this.retryWithRendererInfo(p);
            return;
          }
        }
        p.prepare().catch((e: BusinessError) => {
          Logger.e('AVPlayer', `prepare error: ${e.message}`);
        });
      } else if (s === 'prepared' && this.prepareResolve) {
        const r = this.prepareResolve;
        this.prepareResolve = null;
        this.prepareReject = null;
        r();
      } else if (s === 'error' && this.prepareReject) {
        const r = this.prepareReject;
        this.prepareResolve = null;
        this.prepareReject = null;
        r(new Error('AVPlayer prepare failed'));
      }
    });
    p.on('error', (err: BusinessError) => {
      const pl: ErrorPayload = { message: err.message };
      this.dispatch('error', pl);
      // 若 load 还在等 prepare 完成，直接 reject 防止 Promise 永远挂起
      if (this.prepareReject) {
        const r = this.prepareReject;
        this.prepareResolve = null;
        this.prepareReject = null;
        r(new Error(`AVPlayer error: ${err.message}`));
      }
    });
    p.on('bufferingUpdate', (_infoType: media.BufferingInfoType, value: number) => {
      const pl: BufferingPayload = { value: value };
      this.dispatch('bufferingUpdate', pl);
    });
    p.on('endOfStream', () => this.dispatch('ended', null));
  }

  private dispatch(event: PlayerEvent, payload: PlayerPayload): void {
    const set = this.listeners.get(event);
    if (set) for (const cb of set) cb(payload);
    Logger.d('AVPlayer', `${event}`);
  }

  /**
   * audioRendererInfo 设置失败后的重试：reset 回 idle → 按当前数据源类型重新设置
   * url/fdSrc → 播放器再次进入 initialized 态时重试写入 usage。
   * rendererInfoApplied 仍为 false，所以重试只会发生一次（下次成功即置 true）。
   */
  private retryWithRendererInfo(p: media.AVPlayer): void {
    const url = this.currentUrl;
    if (!url) return;
    Logger.w('AVPlayer', 'retry audioRendererInfo: reset + restore source');
    (async (): Promise<void> => {
      try {
        try { await p.reset(); } catch (_e) { /* ignore */ }
        if (this.pendingSourceIsNetwork) {
          p.url = url;
        } else {
          this.closeFd();
          const file = fs.openSync(url, fs.OpenMode.READ_ONLY);
          this.currentFd = file.fd;
          const size = fs.statSync(url).size;
          p.fdSrc = { fd: file.fd, offset: 0, length: size };
        }
      } catch (e) {
        const err = e as BusinessError;
        Logger.e('AVPlayer', `retry audioRendererInfo restore source failed: code=${err.code} msg=${err.message}`);
      }
    })().catch((): void => undefined);
  }
}

export const audioBackend = new AVPlayerBackend();