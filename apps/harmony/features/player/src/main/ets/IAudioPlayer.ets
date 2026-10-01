export type PlayerEvent =
  | 'timeUpdate' | 'ended' | 'error' | 'stateChange'
  | 'bufferingUpdate' | 'durationUpdate' | 'seekDone';

export interface TimeUpdatePayload { currentMs: number; durationMs: number }
export interface StateChangePayload { state: string }
export interface ErrorPayload { message: string }
export interface BufferingPayload { value: number }
export interface SeekDonePayload { positionMs: number }

export type PlayerPayload = TimeUpdatePayload | StateChangePayload | ErrorPayload | BufferingPayload | SeekDonePayload | null;

export type PlayerListener = (payload: PlayerPayload) => void;

export interface IAudioPlayer {
  /**
   * @param contentType 'MUSIC' | 'AUDIOBOOK'（对齐 PlayerStore.Track.contentType），
   *   用于设置 AVPlayer.audioRendererInfo.usage：
   *   MUSIC → STREAM_USAGE_MUSIC，AUDIOBOOK → STREAM_USAGE_AUDIOBOOK。
   *   系统靠音频流类型把发声流和 AVSession 关联，缺省会导致通知栏/锁屏不出现媒体播控卡片。
   */
  load(url: string, headers?: Record<string, string>, contentType?: string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  release(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setSpeed(speed: number): Promise<void>;
  setVolume(v: number): Promise<void>;
  on(event: PlayerEvent, cb: PlayerListener): void;
  off(event: PlayerEvent, cb?: PlayerListener): void;
}