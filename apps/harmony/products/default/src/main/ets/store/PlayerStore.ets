/**
 * Player Store - Audio Playback State Management
 * Uses in-memory state.
 */
import { Track } from '@ohos/common';

// ==================== Play Modes ====================
export enum PlayMode {
  SEQUENCE = 'sequence',
  LOOP = 'loop',
  SINGLE = 'single',
  RANDOM = 'random'
}

// ==================== Player State ====================
export interface PlayerState {
  currentTrack: Track | null;
  playlist: Track[];
  currentIndex: number;
  isPlaying: boolean;
  progress: number; // 0-100
  duration: number; // seconds
  currentTime: number; // seconds
  volume: number; // 0-1
  isMuted: boolean;
  playMode: PlayMode;
  isLoading: boolean;
  repeatMode: 'off' | 'one' | 'all';
  shuffleEnabled: boolean;
}

// ==================== Default State ====================
const DEFAULT_PLAYER_STATE: PlayerState = {
  currentTrack: null,
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  progress: 0,
  duration: 0,
  currentTime: 0,
  volume: 1.0,
  isMuted: false,
  playMode: PlayMode.SEQUENCE,
  isLoading: false,
  repeatMode: 'off',
  shuffleEnabled: false
};

// ==================== Player Store ====================
export class PlayerStore {
  private static instance: PlayerStore;
  private state: PlayerState = {
    currentTrack: DEFAULT_PLAYER_STATE.currentTrack,
    playlist: DEFAULT_PLAYER_STATE.playlist,
    currentIndex: DEFAULT_PLAYER_STATE.currentIndex,
    isPlaying: DEFAULT_PLAYER_STATE.isPlaying,
    progress: DEFAULT_PLAYER_STATE.progress,
    duration: DEFAULT_PLAYER_STATE.duration,
    currentTime: DEFAULT_PLAYER_STATE.currentTime,
    volume: DEFAULT_PLAYER_STATE.volume,
    isMuted: DEFAULT_PLAYER_STATE.isMuted,
    playMode: DEFAULT_PLAYER_STATE.playMode,
    isLoading: DEFAULT_PLAYER_STATE.isLoading,
    repeatMode: DEFAULT_PLAYER_STATE.repeatMode,
    shuffleEnabled: DEFAULT_PLAYER_STATE.shuffleEnabled
  };

  private constructor() {}

  public static getInstance(): PlayerStore {
    if (!PlayerStore.instance) {
      PlayerStore.instance = new PlayerStore();
    }
    return PlayerStore.instance;
  }

  /**
   * Get current player state
   */
  public getState(): PlayerState {
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
      playMode: this.state.playMode,
      isLoading: this.state.isLoading,
      repeatMode: this.state.repeatMode,
      shuffleEnabled: this.state.shuffleEnabled
    };
  }

  /**
   * Set current track
   */
  public setCurrentTrack(track: Track | null): void {
    this.updateState({ currentTrack: track });
  }

  /**
   * Set playlist and optionally start playing
   */
  public setPlaylist(tracks: Track[], startIndex: number = 0, autoPlay: boolean = true): void {
    this.updateState({
      playlist: tracks,
      currentIndex: startIndex,
      currentTrack: tracks[startIndex] || null,
      isPlaying: autoPlay
    });
  }

  /**
   * Play a track list
   */
  public async playTrackList(tracks: Track[], index: number = 0, resumeProgress: number = 0): Promise<void> {
    this.updateState({
      playlist: tracks,
      currentIndex: index,
      currentTrack: tracks[index] || null,
      isPlaying: true,
      isLoading: true,
      currentTime: resumeProgress
    });
  }

  /**
   * Play/Resume
   */
  public async play(): Promise<void> {
    this.updateState({ isPlaying: true });
  }

  /**
   * Pause
   */
  public async pause(): Promise<void> {
    this.updateState({ isPlaying: false });
  }

  /**
   * Toggle play/pause
   */
  public async togglePlay(): Promise<void> {
    const state = this.getState();
    this.updateState({ isPlaying: !state.isPlaying });
  }

  /**
   * Play next track
   */
  public async playNext(): Promise<void> {
    const state = this.getState();
    const playlist = state.playlist;
    const currentIndex = state.currentIndex;
    const repeatMode = state.repeatMode;
    const shuffleEnabled = state.shuffleEnabled;

    if (playlist.length === 0) return;

    let nextIndex: number;

    if (shuffleEnabled) {
      nextIndex = Math.floor(Math.random() * playlist.length);
    } else if (currentIndex < playlist.length - 1) {
      nextIndex = currentIndex + 1;
    } else if (repeatMode === 'all') {
      nextIndex = 0;
    } else {
      // End of playlist
      this.updateState({ isPlaying: false });
      return;
    }

    this.updateState({
      currentIndex: nextIndex,
      currentTrack: playlist[nextIndex]
    });
  }

  /**
   * Play previous track
   */
  public async playPrevious(): Promise<void> {
    const state = this.getState();
    const playlist = state.playlist;
    const currentIndex = state.currentIndex;
    const repeatMode = state.repeatMode;

    if (playlist.length === 0) return;

    // If current time > 3 seconds, restart current track
    if (state.currentTime > 3) {
      this.updateState({ currentTime: 0, progress: 0 });
      return;
    }

    let prevIndex: number;

    if (currentIndex > 0) {
      prevIndex = currentIndex - 1;
    } else if (repeatMode === 'all') {
      prevIndex = playlist.length - 1;
    } else {
      prevIndex = 0;
    }

    this.updateState({
      currentIndex: prevIndex,
      currentTrack: playlist[prevIndex]
    });
  }

  /**
   * Seek to position
   */
  public async seekTo(seconds: number): Promise<void> {
    const state = this.getState();
    const progress = state.duration > 0 ? (seconds / state.duration) * 100 : 0;
    this.updateState({ currentTime: seconds, progress });
  }

  /**
   * Set volume
   */
  public async setVolume(volume: number): Promise<void> {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    this.updateState({ volume: clampedVolume, isMuted: clampedVolume === 0 });
  }

  /**
   * Toggle mute
   */
  public async toggleMute(): Promise<void> {
    const state = this.getState();
    this.updateState({ isMuted: !state.isMuted });
  }

  /**
   * Set play mode
   */
  public async setPlayMode(mode: PlayMode): Promise<void> {
    this.updateState({ playMode: mode });
  }

  /**
   * Toggle shuffle
   */
  public async toggleShuffle(): Promise<void> {
    const state = this.getState();
    this.updateState({ shuffleEnabled: !state.shuffleEnabled });
  }

  /**
   * Toggle repeat mode (off -> all -> one)
   */
  public async toggleRepeat(): Promise<void> {
    const state = this.getState();
    const modes: Array<'off' | 'one' | 'all'> = ['off', 'all', 'one'];
    const currentIdx = modes.indexOf(state.repeatMode);
    const nextIdx = (currentIdx + 1) % modes.length;
    this.updateState({ repeatMode: modes[nextIdx] });
  }

  /**
   * Update playback progress
   */
  public updateProgress(currentTime: number, duration: number): void {
    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
    this.updateState({ currentTime, duration, progress });
  }

  /**
   * Set loading state
   */
  public setLoading(loading: boolean): void {
    this.updateState({ isLoading: loading });
  }

  /**
   * Update state
   */
  public updateState(partial: Partial<PlayerState>): void {
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
      playMode: partial.playMode !== undefined ? partial.playMode : current.playMode,
      isLoading: partial.isLoading !== undefined ? partial.isLoading : current.isLoading,
      repeatMode: partial.repeatMode !== undefined ? partial.repeatMode : current.repeatMode,
      shuffleEnabled: partial.shuffleEnabled !== undefined ? partial.shuffleEnabled : current.shuffleEnabled,
    };
  }
}

// ==================== Singleton Export ====================
export const playerStore = PlayerStore.getInstance();
