/**
 * AudioPlayer Service for AudioDock HarmonyOS App.
 * Implements audio playback using HarmonyOS AVPlayer.
 */
import { audio } from '@kit.AudioKit';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import type { Track } from '../https/models';

// ==================== Constants ====================
const PLAYER_STATE_KEY = 'AudioPlayerState';

// ==================== Player State ====================
export enum PlayMode {
  SEQUENCE = 'sequence',
  LOOP = 'loop',
  SINGLE = 'single',
  RANDOM = 'random'
}

export interface AudioPlayerState {
  currentTrack: Track | null;
  playlist: Track[];
  currentIndex: number;
  isPlaying: boolean;
  progress: number;
  duration: number;
  currentTime: number;
  volume: number;
  isMuted: boolean;
  isLoading: boolean;
  repeatMode: 'off' | 'one' | 'all';
  shuffleEnabled: boolean;
  playMode: PlayMode;
}

const DEFAULT_STATE: AudioPlayerState = {
  currentTrack: null,
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  progress: 0,
  duration: 0,
  currentTime: 0,
  volume: 1.0,
  isMuted: false,
  isLoading: false,
  repeatMode: 'off',
  shuffleEnabled: false,
  playMode: PlayMode.SEQUENCE
};

// ==================== Helpers ====================

/**
 * Get the playable URL from a track (handles both url and path fields)
 */
function getTrackUrl(track: Track): string {
  const trackAny = track as unknown as Record<string, string>;
  return trackAny.url || (track as unknown as Record<string, string>).path || '';
}

/**
 * Get cover URL from track
 */
function getTrackCoverUrl(track: Track): string | undefined {
  const trackAny = track as unknown as Record<string, string>;
  return trackAny.coverUrl || trackAny.cover || undefined;
}

/**
 * Get duration from track (in seconds)
 */
function getTrackDuration(track: Track): number {
  const trackAny = track as unknown as Record<string, number>;
  return trackAny.duration || track.duration || 0;
}

// ==================== Audio Player ====================

/**
 * AVPlayer interface to match HarmonyOS AVPlayer API
 */
interface AVPlayerInterface {
  setSrc(src: string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(time: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setSpeed(speed: number): Promise<void>;
  release(): Promise<void>;
  currentTime: number;
  duration: number;
  state: number;
  on(event: string, callback: (data: Object) => void): void;
  off(event: string): void;
}

export class AudioPlayer {
  private static instance: AudioPlayer;

  // HarmonyOS AVPlayer - use interface type for proper method access
  private avPlayer: AVPlayerInterface | null = null;

  // State (in-memory)
  private state: AudioPlayerState = {
    currentTrack: DEFAULT_STATE.currentTrack,
    playlist: DEFAULT_STATE.playlist,
    currentIndex: DEFAULT_STATE.currentIndex,
    isPlaying: DEFAULT_STATE.isPlaying,
    progress: DEFAULT_STATE.progress,
    duration: DEFAULT_STATE.duration,
    currentTime: DEFAULT_STATE.currentTime,
    volume: DEFAULT_STATE.volume,
    isMuted: DEFAULT_STATE.isMuted,
    isLoading: DEFAULT_STATE.isLoading,
    repeatMode: DEFAULT_STATE.repeatMode,
    shuffleEnabled: DEFAULT_STATE.shuffleEnabled,
    playMode: DEFAULT_STATE.playMode
  };

  // State
  private playlist: Track[] = [];
  private currentIndex: number = -1;
  private isInitialized: boolean = false;
  private currentUrl: string = '';
  private progressInterval: number = -1;

  // Context
  private context: common.UIAbilityContext | null = null;

  // Callbacks
  private onPlaybackStartCb?: () => void;
  private onPlaybackPauseCb?: () => void;
  private onPlaybackStopCb?: () => void;
  private onPlaybackCompleteCb?: () => void;
  private onTrackChangeCb?: (track: Track) => void;
  private onErrorCb?: (error: Error) => void;
  private onProgressUpdateCb?: (currentTime: number, duration: number) => void;

  private constructor() {}

  public static getInstance(): AudioPlayer {
    if (!AudioPlayer.instance) {
      AudioPlayer.instance = new AudioPlayer();
    }
    return AudioPlayer.instance;
  }

  /**
   * Get current state
   */
  public getState(): AudioPlayerState {
    return {
      currentTrack: this.state.currentTrack,
      playlist: this.state.playlist,
      currentIndex: this.state.currentIndex,
      isPlaying: this.state.isPlaying,
      progress: this.state.progress,
      duration: this.state.duration,
      currentTime: this.state.currentTime,
      volume: this.state.volume,
      isMuted: this.state.isMuted,
      isLoading: this.state.isLoading,
      repeatMode: this.state.repeatMode,
      shuffleEnabled: this.state.shuffleEnabled,
      playMode: this.state.playMode
    };
  }

  /**
   * Update state
   */
  private updateState(partial: Partial<AudioPlayerState>): void {
    const current = this.getState();
    this.state = {
      currentTrack: partial.currentTrack !== undefined ? partial.currentTrack : current.currentTrack,
      playlist: partial.playlist !== undefined ? partial.playlist : current.playlist,
      currentIndex: partial.currentIndex !== undefined ? partial.currentIndex : current.currentIndex,
      isPlaying: partial.isPlaying !== undefined ? partial.isPlaying : current.isPlaying,
      progress: partial.progress !== undefined ? partial.progress : current.progress,
      duration: partial.duration !== undefined ? partial.duration : current.duration,
      currentTime: partial.currentTime !== undefined ? partial.currentTime : current.currentTime,
      volume: partial.volume !== undefined ? partial.volume : current.volume,
      isMuted: partial.isMuted !== undefined ? partial.isMuted : current.isMuted,
      isLoading: partial.isLoading !== undefined ? partial.isLoading : current.isLoading,
      repeatMode: partial.repeatMode !== undefined ? partial.repeatMode : current.repeatMode,
      shuffleEnabled: partial.shuffleEnabled !== undefined ? partial.shuffleEnabled : current.shuffleEnabled,
      playMode: partial.playMode !== undefined ? partial.playMode : current.playMode,
    };
  }

  /**
   * Initialize the audio player
   */
  public async initialize(context: common.UIAbilityContext): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.context = context;

    try {
      // Create audio player using audio namespace
      const audioModule = audio as Record<string, Object>;
      if (audioModule.createAVPlayer) {
        this.avPlayer = await (audioModule.createAVPlayer as () => Promise<AVPlayerInterface>)();
      } else {
        // Fallback for older SDKs - try AVPlayer.create()
        const createFn = (audio as Record<string, Object>).AVPlayer;
        if (typeof createFn === 'function') {
          this.avPlayer = await ((createFn as () => Promise<AVPlayerInterface>)());
        } else {
          console.warn('[AudioPlayer] AVPlayer not available, using placeholder');
          this.avPlayer = null;
        }
      }
      this.setupEventListeners();
      this.isInitialized = true;
      console.info('[AudioPlayer] Initialized successfully');
    } catch (error) {
      const err = error as BusinessError;
      console.error(`[AudioPlayer] Init failed: ${err.code}, ${err.message}`);
      this.onErrorCb?.(new Error(err.message));
    }
  }

  /**
   * Set event callbacks
   */
  public setCallbacks(callbacks: {
    onPlaybackStart?: () => void;
    onPlaybackPause?: () => void;
    onPlaybackStop?: () => void;
    onPlaybackComplete?: () => void;
    onTrackChange?: (track: Track) => void;
    onError?: (error: Error) => void;
    onProgressUpdate?: (currentTime: number, duration: number) => void;
  }): void {
    this.onPlaybackStartCb = callbacks.onPlaybackStart;
    this.onPlaybackPauseCb = callbacks.onPlaybackPause;
    this.onPlaybackStopCb = callbacks.onPlaybackStop;
    this.onPlaybackCompleteCb = callbacks.onPlaybackComplete;
    this.onTrackChangeCb = callbacks.onTrackChange;
    this.onErrorCb = callbacks.onError;
    this.onProgressUpdateCb = callbacks.onProgressUpdate;
  }

  /**
   * Set up AVPlayer event listeners
   */
  private setupEventListeners(): void {
    if (!this.avPlayer) return;

    // Handle playback state changes
    this.avPlayer.on('playbackStateChange', (state: Object) => {
      const stateObj = state as Record<string, string>;
      const stateStr = stateObj.state || '';
      console.info(`[AudioPlayer] State changed: ${stateStr}`);

      switch (stateStr) {
        case 'playing':
          this.startProgressTracking();
          this.updateState({ isLoading: false, isPlaying: true });
          this.onPlaybackStartCb?.();
          break;
        case 'paused':
          this.stopProgressTracking();
          this.updateState({ isPlaying: false });
          this.onPlaybackPauseCb?.();
          break;
        case 'stopped':
          this.stopProgressTracking();
          this.updateState({ isPlaying: false, currentTime: 0, progress: 0 });
          this.onPlaybackStopCb?.();
          break;
        case 'completed':
          this.handleTrackComplete();
          break;
        case 'idle':
        default:
          break;
      }
    });

    // Handle audio interrupts (e.g., phone calls)
    this.avPlayer.on('audioInterrupt', (interruptEvent: Object) => {
      const event = interruptEvent as Record<string, Object>;
      const hintType = event.hintType as number;
      // 1 = PAUSE, 2 = STOP
      if (hintType === 1 || hintType === 2) {
        this.updateState({ isPlaying: false });
      }
    });
  }

  /**
   * Load and optionally play a track URL
   */
  public async loadTrack(url: string, autoPlay: boolean = true): Promise<void> {
    if (!this.avPlayer) {
      console.error('[AudioPlayer] Not initialized');
      return;
    }

    try {
      this.updateState({ isLoading: true });
      this.currentUrl = url;

      // Set audio source URL
      await this.avPlayer.setSrc(url);

      if (autoPlay) {
        await this.avPlayer.play();
      }
    } catch (error) {
      const err = error as BusinessError;
      console.error(`[AudioPlayer] Load track failed: ${err.code}, ${err.message}`);
      this.updateState({ isLoading: false });
      this.onErrorCb?.(new Error(err.message));
    }
  }

  /**
   * Load a Track object
   */
  public async loadTrackFromModel(track: Track, autoPlay: boolean = true): Promise<void> {
    const url = getTrackUrl(track);
    if (!url) {
      console.error('[AudioPlayer] No URL available for track:', track.id);
      this.onErrorCb?.(new Error('No URL available for track'));
      return;
    }
    await this.loadTrack(url, autoPlay);
  }

  /**
   * Play playlist starting from a specific index
   */
  public async playTracks(tracks: Track[], startIndex: number = 0, resumeProgress: number = 0): Promise<void> {
    if (tracks.length === 0) {
      console.warn('[AudioPlayer] Empty playlist');
      return;
    }

    this.playlist = tracks.slice();
    this.currentIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));

    const track = this.playlist[this.currentIndex];
    this.updateState({
      playlist: tracks,
      currentIndex: this.currentIndex,
      currentTrack: track,
      isPlaying: false
    });

    // Load and play the first track
    await this.playCurrentTrack(resumeProgress);
  }

  /**
   * Play current track (optionally from a specific position)
   */
  private async playCurrentTrack(startPosition: number = 0): Promise<void> {
    if (this.currentIndex < 0 || this.currentIndex >= this.playlist.length) {
      console.warn('[AudioPlayer] Invalid current index');
      return;
    }

    const track = this.playlist[this.currentIndex];
    if (!track) {
      console.warn('[AudioPlayer] No track at index');
      return;
    }

    const url = getTrackUrl(track);
    if (!url) {
      console.warn('[AudioPlayer] No URL for track');
      return;
    }

    this.updateState({
      currentTrack: track,
      isLoading: true
    });
    this.onTrackChangeCb?.(track);

    try {
      await this.loadTrack(url, false);

      if (startPosition > 0 && this.avPlayer) {
        await this.avPlayer.seek(startPosition * 1000); // Convert to ms
      }

      await this.avPlayer?.play();
      this.updateState({ isPlaying: true });
    } catch (error) {
      const err = error as BusinessError;
      console.error(`[AudioPlayer] Play current track failed: ${err.message}`);
      this.updateState({ isLoading: false });
      this.onErrorCb?.(new Error(err.message));
    }
  }

  /**
   * Add track(s) to the end of the playlist
   */
  public addToPlaylist(tracks: Track[]): void {
    this.playlist = this.playlist.concat(tracks);
    this.updateState({ playlist: this.playlist.slice() });
  }

  /**
   * Insert track(s) after current track
   */
  public insertNext(tracks: Track[]): void {
    if (this.currentIndex < 0) {
      this.playlist = tracks.slice();
      this.currentIndex = 0;
    } else {
      const before = this.playlist.slice(0, this.currentIndex + 1);
      const after = this.playlist.slice(this.currentIndex + 1);
      this.playlist = before.concat(tracks).concat(after);
    }
    this.updateState({ playlist: this.playlist.slice() });
  }

  /**
   * Remove track from playlist by index
   */
  public removeFromPlaylist(index: number): void {
    if (index < 0 || index >= this.playlist.length) return;

    this.playlist.splice(index, 1);

    // Adjust current index if needed
    if (index < this.currentIndex) {
      this.currentIndex--;
    } else if (index === this.currentIndex) {
      // Current track was removed
      if (this.playlist.length > 0) {
        this.currentIndex = Math.min(this.currentIndex, this.playlist.length - 1);
      } else {
        this.currentIndex = -1;
        this.updateState({ currentTrack: null });
      }
    }
    this.updateState({ playlist: this.playlist.slice(), currentIndex: this.currentIndex });
  }

  /**
   * Clear the playlist
   */
  public clearPlaylist(): void {
    this.playlist = [];
    this.currentIndex = -1;
    this.updateState({ playlist: [], currentIndex: -1, currentTrack: null });
  }

  /**
   * Play / Resume
   */
  public async play(): Promise<void> {
    if (!this.avPlayer) return;

    try {
      await this.avPlayer.play();
      this.updateState({ isPlaying: true });
    } catch (error) {
      const err = error as BusinessError;
      console.error(`[AudioPlayer] Play failed: ${err.message}`);
    }
  }

  /**
   * Pause
   */
  public async pause(): Promise<void> {
    if (!this.avPlayer) return;

    try {
      await this.avPlayer.pause();
      this.updateState({ isPlaying: false });
    } catch (error) {
      const err = error as BusinessError;
      console.error(`[AudioPlayer] Pause failed: ${err.message}`);
    }
  }

  /**
   * Toggle play/pause
   */
  public async togglePlayPause(): Promise<void> {
    const state = this.getState();
    if (state.isPlaying) {
      await this.pause();
    } else {
      await this.play();
    }
  }

  /**
   * Stop playback
   */
  public async stop(): Promise<void> {
    if (!this.avPlayer) return;

    try {
      await this.avPlayer.stop();
      this.stopProgressTracking();
      this.updateState({
        isPlaying: false,
        currentTime: 0,
        progress: 0
      });
    } catch (error) {
      const err = error as BusinessError;
      console.error(`[AudioPlayer] Stop failed: ${err.message}`);
    }
  }

  /**
   * Seek to position (in seconds)
   */
  public async seekTo(seconds: number): Promise<void> {
    if (!this.avPlayer) return;

    const state = this.getState();
    const clampedTime = Math.max(0, Math.min(seconds, state.duration));

    try {
      await this.avPlayer.seek(clampedTime * 1000); // Convert to ms
      this.updateState({ currentTime: clampedTime });
    } catch (error) {
      const err = error as BusinessError;
      console.error(`[AudioPlayer] Seek failed: ${err.message}`);
    }
  }

  /**
   * Skip forward by seconds
   */
  public async skipForward(seconds: number = 15): Promise<void> {
    const state = this.getState();
    await this.seekTo(state.currentTime + seconds);
  }

  /**
   * Skip backward by seconds
   */
  public async skipBackward(seconds: number = 15): Promise<void> {
    const state = this.getState();
    await this.seekTo(state.currentTime - seconds);
  }

  /**
   * Play next track
   */
  public async playNext(): Promise<void> {
    const state = this.getState();
    const repeatMode = state.repeatMode;
    const shuffleEnabled = state.shuffleEnabled;

    if (this.playlist.length === 0) return;

    let nextIndex: number;

    if (shuffleEnabled) {
      nextIndex = Math.floor(Math.random() * this.playlist.length);
    } else if (this.currentIndex < this.playlist.length - 1) {
      nextIndex = this.currentIndex + 1;
    } else if (repeatMode === 'all') {
      nextIndex = 0;
    } else {
      // End of playlist
      await this.stop();
      return;
    }

    this.currentIndex = nextIndex;
    this.updateState({ currentIndex: nextIndex });
    await this.playCurrentTrack();
  }

  /**
   * Play previous track
   */
  public async playPrevious(): Promise<void> {
    const state = this.getState();

    if (this.playlist.length === 0) return;

    // If current time > 3 seconds, restart current track
    if (state.currentTime > 3) {
      await this.seekTo(0);
      return;
    }

    let prevIndex: number;

    if (this.currentIndex > 0) {
      prevIndex = this.currentIndex - 1;
    } else if (state.repeatMode === 'all') {
      prevIndex = this.playlist.length - 1;
    } else {
      prevIndex = 0;
    }

    this.currentIndex = prevIndex;
    this.updateState({ currentIndex: prevIndex });
    await this.playCurrentTrack();
  }

  /**
   * Jump to specific index in playlist
   */
  public async skipToIndex(index: number): Promise<void> {
    if (index < 0 || index >= this.playlist.length) return;
    this.currentIndex = index;
    this.updateState({ currentIndex: index });
    await this.playCurrentTrack();
  }

  /**
   * Set volume (0.0 - 1.0)
   */
  public async setVolume(volume: number): Promise<void> {
    const clampedVolume = Math.max(0, Math.min(1, volume));

    if (this.avPlayer) {
      try {
        await this.avPlayer.setVolume(clampedVolume);
        this.updateState({ volume: clampedVolume, isMuted: clampedVolume === 0 });
      } catch (error) {
        const err = error as BusinessError;
        console.error(`[AudioPlayer] Set volume failed: ${err.message}`);
      }
    }
  }

  /**
   * Mute/unmute
   */
  public async toggleMute(): Promise<void> {
    const state = this.getState();
    await this.setVolume(state.isMuted ? state.volume : 0);
    this.updateState({ isMuted: !state.isMuted });
  }

  /**
   * Set playback speed
   */
  public async setSpeed(speed: number): Promise<void> {
    if (!this.avPlayer) return;

    const clampedSpeed = Math.max(0.5, Math.min(2.0, speed));

    try {
      await this.avPlayer.setSpeed(clampedSpeed);
    } catch (error) {
      const err = error as BusinessError;
      console.error(`[AudioPlayer] Set speed failed: ${err.message}`);
    }
  }

  /**
   * Set shuffle mode
   */
  public setShuffleEnabled(enabled: boolean): void {
    this.updateState({ shuffleEnabled: enabled });
  }

  /**
   * Set repeat mode
   */
  public setRepeatMode(mode: 'off' | 'one' | 'all'): void {
    this.updateState({ repeatMode: mode });
  }

  /**
   * Cycle through repeat modes
   */
  public toggleRepeatMode(): void {
    const state = this.getState();
    const modes: Array<'off' | 'one' | 'all'> = ['off', 'all', 'one'];
    const currentIdx = modes.indexOf(state.repeatMode);
    const nextIdx = (currentIdx + 1) % modes.length;
    this.updateState({ repeatMode: modes[nextIdx] });
  }

  /**
   * Handle track completion
   */
  private async handleTrackComplete(): Promise<void> {
    const state = this.getState();

    if (state.repeatMode === 'one') {
      // Repeat single track
      await this.seekTo(0);
      await this.play();
      return;
    }

    // Play next or stop
    await this.playNext();
    this.onPlaybackCompleteCb?.();
  }

  /**
   * Start progress tracking
   */
  private startProgressTracking(): void {
    this.stopProgressTracking();

    // Update progress every 500ms
    this.progressInterval = setInterval(() => {
      this.updateProgress();
    }, 500);
  }

  /**
   * Stop progress tracking
   */
  private stopProgressTracking(): void {
    if (this.progressInterval !== -1) {
      clearInterval(this.progressInterval);
      this.progressInterval = -1;
    }
  }

  /**
   * Update playback progress
   */
  private updateProgress(): void {
    if (!this.avPlayer) return;

    try {
      const currentTime = (this.avPlayer.currentTime || 0) / 1000; // ms to seconds
      const duration = (this.avPlayer.duration || 0) / 1000;

      if (duration > 0) {
        const progress = (currentTime / duration) * 100;
        this.updateState({ currentTime, duration, progress });
        this.onProgressUpdateCb?.(currentTime, duration);
      }
    } catch (error) {
      // Ignore progress update errors
    }
  }

  /**
   * Get current playback position (seconds)
   */
  public getCurrentTime(): number {
    if (!this.avPlayer) return 0;
    return (this.avPlayer.currentTime || 0) / 1000;
  }

  /**
   * Get total duration (seconds)
   */
  public getDuration(): number {
    if (!this.avPlayer) return 0;
    return (this.avPlayer.duration || 0) / 1000;
  }

  /**
   * Check if currently playing
   */
  public isCurrentlyPlaying(): boolean {
    const state = this.avPlayer?.state;
    // state is a number: 0=idle, 1=playing, 2=paused, 3=stopped, 4=prepared
    return state === 1;
  }

  /**
   * Get current playlist
   */
  public getPlaylist(): Track[] {
    return this.playlist.slice();
  }

  /**
   * Get current track index
   */
  public getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Get current track
   */
  public getCurrentTrack(): Track | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.playlist.length) {
      return null;
    }
    return this.playlist[this.currentIndex];
  }

  /**
   * Get player state
   */
  public getPlayerState(): AudioPlayerState {
    return this.getState();
  }

  /**
   * Release the audio player
   */
  public async release(): Promise<void> {
    this.stopProgressTracking();

    if (this.avPlayer) {
      try {
        await this.avPlayer.stop();
        await this.avPlayer.release();
      } catch (error) {
        console.warn('[AudioPlayer] Release error:', error);
      }
      this.avPlayer = null;
    }

    this.isInitialized = false;
    console.info('[AudioPlayer] Released');
  }
}

// ==================== Singleton Export ====================
export const audioPlayer = AudioPlayer.getInstance();
