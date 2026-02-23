import {
  addAlbumToHistory,
  addToHistory,
  getAlbumTracks,
  getLatestTracks,
  getTrackHistory,
  loadMoreTrack,
  reportAudiobookProgress,
  toggleTrackLike,
  toggleTrackUnLike
} from "@soundx/services";
import { create } from "zustand";
import { TrackType, type Track } from "../models";
import { getPlayMode } from "../utils/playMode";
import { useAuthStore } from "./auth";

export interface PlaylistSource {
  type: "album" | "tracks" | "history" | "favorites" | "other";
  id?: number | string;
  pageSize: number;
  currentPage: number;
  hasMore: boolean;
  params?: {
    sort?: "asc" | "desc";
    keyword?: string;
    sortBy?: string;
  };
}

interface PlayerModeState {
  currentTrack: Track | null;
  playlist: Track[];
  currentTime: number;
  duration: number;
  currentAlbumId: number | string | null;
  playlistSource: PlaylistSource | null;
}

interface PlayerState {
  // Mode-specific state (preserved per MUSIC/AUDIOBOOK)
  currentTrack: Track | null;
  playlist: Track[];
  currentTime: number;
  duration: number;
  currentAlbumId: number | string | null;
  playlistSource: PlaylistSource | null;

  // Global State
  isPlaying: boolean;
  isLoadingMore: boolean;
  playMode: "sequence" | "loop" | "shuffle" | "single";
  volume: number;
  activeMode: TrackType;
  isRadioMode: boolean;

  // Persisted States
  modes: Record<TrackType, PlayerModeState>;

  // Actions
  play: (
    track?: Track,
    albumId?: number | string,
    startTime?: number,
    fromRadio?: boolean
  ) => void;
  pause: () => void;
  setPlaylist: (tracks: Track[], source?: PlaylistSource | null) => void;
  appendTracks: (tracks: Track[], hasMore: boolean) => void;
  next: () => void;
  prev: () => void;
  setMode: (mode: "sequence" | "loop" | "shuffle" | "single") => void;
  setVolume: (volume: number) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  toggleLike: (
    trackId: number | string,
    type: "like" | "unlike"
  ) => Promise<void>;
  removeTrack: (trackId: number | string) => void;
  startRadioMode: () => Promise<void>;
  loadMoreSourceTracks: () => Promise<void>;
  insertTracksNext: (tracks: Track[]) => void;

  // Internal/System Actions
  syncActiveMode: (mode: TrackType) => void;
  _saveCurrentStateToMode: () => void;
}

const DEFAULT_MODE_STATE: PlayerModeState = {
  currentTrack: null,
  playlist: [],
  currentTime: 0,
  duration: 0,
  currentAlbumId: null,
  playlistSource: null
};

// Helper to load state from localStorage with safe defaults
const loadModeState = (mode: TrackType): PlayerModeState => {
  try {
    const key = `playerState_${mode}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_MODE_STATE, ...parsed };
    }
  } catch (e) {
    console.error(`Failed to load player state for ${mode}`, e);
  }
  return { ...DEFAULT_MODE_STATE };
};

const persistModeState = (mode: TrackType, state: PlayerModeState) => {
  try {
    localStorage.setItem(`playerState_${mode}`, JSON.stringify(state));
  } catch (e) {
    console.error(`Failed to persist player state for ${mode}`, e);
  }
};


export const usePlayerStore = create<PlayerState>((set, get) => {
  // Initialize
  const initialMode = getPlayMode(); // from utils
  const initialMusicState = loadModeState(TrackType.MUSIC);
  const initialAudiobookState = loadModeState(TrackType.AUDIOBOOK);

  const activeState = initialMode === TrackType.AUDIOBOOK ? initialAudiobookState : initialMusicState;
  
  // Load global settings
  const storedPlayMode = localStorage.getItem("playOrder") as "sequence" | "loop" | "shuffle" | "single" || "sequence";
  const storedVolume = Number(localStorage.getItem("playerVolume")) || 70;

  // Progress Reporting Helper
  let lastReportTime = 0;
  const ATTEMPT_REPORT_INTERVAL = 5; // Seconds (unified with Mobile)

  const reportProgress = (state: PlayerState, force = false) => {
    const { currentTrack, currentTime, isPlaying, activeMode } = state;

    if (activeMode !== TrackType.AUDIOBOOK || !currentTrack) return;

    const roundedTime = Math.floor(currentTime);
    if (roundedTime <= 0) return;

    // Report if forced (e.g. pause/change) or interval met
    if (force || (isPlaying && Math.abs(roundedTime - lastReportTime) >= ATTEMPT_REPORT_INTERVAL)) {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return;

      reportAudiobookProgress({
        userId,
        trackId: currentTrack.id,
        progress: roundedTime
      }).catch(e => console.error("Failed to report progress", e));
      lastReportTime = roundedTime;

      // Sync progress to local playlist and currentTrack
      const updatedPlaylist = state.playlist.map(t =>
        t.id === currentTrack.id ? { ...t, progress: roundedTime } : t
      );
      const updatedCurrentTrack = { ...currentTrack, progress: roundedTime };

      set({ playlist: updatedPlaylist, currentTrack: updatedCurrentTrack });
    }
  };

  const modes: Record<TrackType, PlayerModeState> = {
    [TrackType.MUSIC]: initialMusicState,
    [TrackType.AUDIOBOOK]: initialAudiobookState,
  };

  return {
    ...activeState,
    modes,

    isPlaying: false,
    isLoadingMore: false,
    playMode: storedPlayMode,
    volume: storedVolume,
    activeMode: initialMode,
    isRadioMode: false,

    _saveCurrentStateToMode: () => {
      const state = get();
      const newModes = { ...state.modes };

      const modeState: PlayerModeState = {
        currentTrack: state.currentTrack,
        playlist: state.playlist,
        currentTime: state.currentTime,
        duration: state.duration,
        currentAlbumId: state.currentAlbumId,
        playlistSource: state.playlistSource,
      };

      newModes[state.activeMode] = modeState;
      persistModeState(state.activeMode, modeState);

      set({ modes: newModes });
      return newModes;
    },

    syncActiveMode: (newMode: TrackType) => {
      const state = get();
      if (state.activeMode === newMode) return;

      state._saveCurrentStateToMode();

      const nextModeState = state.modes[newMode];
      set({
        activeMode: newMode,
        currentTrack: nextModeState.currentTrack,
        playlist: nextModeState.playlist,
        currentTime: nextModeState.currentTime,
        duration: nextModeState.duration,
        currentAlbumId: nextModeState.currentAlbumId,
        playlistSource: nextModeState.playlistSource,
        isPlaying: false, // Pause on switch
      });
    },

    play: async (track, albumId, startTime, fromRadio = false) => {
      const { currentTrack: current, activeMode } = get();

      if (track) {
        if (!fromRadio) {
          set({ isRadioMode: false });
        }
        if (current?.id !== track.id) {
          // Report progress of previous track before switching
          reportProgress(get(), true);
          lastReportTime = 0; // Reset for new track
          set({ currentTrack: track, isPlaying: true, currentTime: startTime || 0 });
          
          const state = get();
          persistModeState(activeMode, {
            currentTrack: track,
            playlist: state.playlist,
            currentTime: startTime || 0,
            duration: track.duration || 0,
            currentAlbumId: albumId || state.currentAlbumId,
            playlistSource: state.playlistSource,
          });

          const deviceName =
            (await window.ipcRenderer?.getName()) || window.navigator.userAgent;
          const device = JSON.parse(localStorage.getItem("device") || "{}");

          // History Logic
          try {
            const userId = useAuthStore.getState().user?.id;
            if (userId) {
              await addToHistory(track.id, userId, 0, deviceName, device.id);
            }
          } catch (e) {
            console.error("Failed to add track to history", e);
          }

          if (albumId && albumId !== get().currentAlbumId) {
            set({ currentAlbumId: albumId });
            try {
              const userId = useAuthStore.getState().user?.id;
              if (userId) {
                await addAlbumToHistory(albumId, userId);
              }
            } catch (e) {
              console.error("Failed to add album to history", e);
            }
          }
        } else {
          set({ isPlaying: true });
          if (startTime !== undefined && startTime > 0) {
            set({ currentTime: startTime });
          }
        }
      } else {
        if (current) {
          set({ isPlaying: true });
        }
      }
      get()._saveCurrentStateToMode();
    },

    pause: () => {
      const { isPlaying } = get();
      if (!isPlaying) return;
      reportProgress(get(), true); // Report immediately on pause
      set({ isPlaying: false });
      get()._saveCurrentStateToMode();
    },

    setPlaylist: (tracks, source = null) => {
      set({ playlist: tracks, playlistSource: source, isRadioMode: false });
      get()._saveCurrentStateToMode();
    },

    appendTracks: (tracks, hasMore) => {
      const { playlist, playlistSource } = get();
      // Only append if it's already a source-linked playlist
      if (!playlistSource) return;

      // Deduplicate
      const existingIds = new Set(playlist.map((t) => t.id));
      const newTracks = tracks.filter((t) => !existingIds.has(t.id));

      if (newTracks.length > 0) {
        const updatedPlaylist = [...playlist, ...newTracks];
        set({
          playlist: updatedPlaylist,
          playlistSource: {
            ...playlistSource,
            hasMore,
            currentPage: Math.max(
              playlistSource.currentPage,
              Math.floor(updatedPlaylist.length / playlistSource.pageSize) - 1
            ),
          },
        });
        get()._saveCurrentStateToMode();
      }
    },

    next: async () => {
      const {
        playlist,
        currentTrack,
        playMode,
        isRadioMode,
        playlistSource,
        isLoadingMore,
      } = get();

      if (isRadioMode) {
        try {
          const res = await getLatestTracks();
          if (res.code === 200 && res.data.length > 0) {
            const nextTrack = res.data[0];
            set({ currentTrack: nextTrack, currentTime: 0, isPlaying: true });
          }
        } catch (e) {
          console.error("Radio next error", e);
        }
        return;
      }

      if (playlist.length === 0 || !currentTrack) return;

      const currentIndex = playlist.findIndex((t) => t.id === currentTrack.id);
      let nextIndex = currentIndex + 1;

      // Lazy Loading Trigger: if we are at the end, attempt to load more
      if (
        nextIndex >= playlist.length - 2 &&
        playlistSource?.hasMore &&
        !isLoadingMore
      ) {
        await get().loadMoreSourceTracks();
      }

      if (playMode === "shuffle") {
        nextIndex = Math.floor(Math.random() * playlist.length);
      } else if (playMode === "loop") {
        nextIndex = nextIndex % playlist.length;
      } else if (playMode === "single") {
        nextIndex = currentIndex;
      }

      if (nextIndex < playlist.length) {
        const nextTrack = playlist[nextIndex];
        set({ currentTrack: nextTrack, currentTime: 0, isPlaying: true });
        reportProgress(get(), true);

        const userId = useAuthStore.getState().user?.id;
        if (userId) {
          addToHistory(Number(nextTrack.id), userId).catch(console.error);
        }
      }
      get()._saveCurrentStateToMode();
    },

    prev: async () => {
      const { playlist, currentTrack, isRadioMode } = get();

      if (isRadioMode) {
        get().next();
        return;
      }

      if (playlist.length === 0 || !currentTrack) return;

      const currentIndex = playlist.findIndex((t) => t.id === currentTrack.id);
      let prevIndex = currentIndex - 1;

      if (prevIndex < 0) {
        prevIndex = playlist.length - 1;
      }

      const prevTrack = playlist[prevIndex];
      set({ currentTrack: prevTrack, currentTime: 0, isPlaying: true });
      reportProgress(get(), true);

      const userId = useAuthStore.getState().user?.id;
        if (userId) {
          addToHistory(Number(prevTrack.id), userId).catch(console.error);
        }

      get()._saveCurrentStateToMode();
    },

    setMode: (mode) => {
      set({ playMode: mode });
      localStorage.setItem("playOrder", mode);
    },
    setVolume: (volume) => {
      set({ volume });
      localStorage.setItem("playerVolume", String(volume));
    },

    setCurrentTime: (time) => {
      set({ currentTime: time });
      // Check for progress reporting (throttled by reportProgress logic)
      reportProgress(get());

      // Near-end check for lazy loading
      const state = get();
      if (
        state.playlistSource?.hasMore &&
        !state.isLoadingMore &&
        state.currentTrack
      ) {
        const currentIndex = state.playlist.findIndex(
          (t) => t.id === state.currentTrack?.id
        );
        if (currentIndex >= state.playlist.length - 5) {
          state.loadMoreSourceTracks();
        }
      }
    },

    setDuration: (duration) => set({ duration }),

    toggleLike: async (trackId, type) => {
      try {
        const userId = useAuthStore.getState().user?.id;
        if (!userId) {
          console.warn("User not logged in, cannot toggle like");
          return;
        }
        await (type === "like" ? toggleTrackLike(trackId, userId) : toggleTrackUnLike(trackId, userId));
        
        const state = get();
        const updateTrack = (track: Track) => {
          if (track.id !== trackId) return track;
          let likedByUsers = track.likedByUsers || [];
          if (type === 'like') {
            if (!likedByUsers.some(l => l.userId === userId)) {
               likedByUsers = [...likedByUsers, {
                 id: 0, 
                 trackId: trackId,
                 userId: userId,
                 createdAt: new Date()
               }];
            }
          } else {
            likedByUsers = likedByUsers.filter(l => l.userId !== userId);
          }
          return { ...track, likedByUsers };
        };

        const newCurrentTrack = state.currentTrack ? updateTrack(state.currentTrack) : null;
        const newPlaylist = state.playlist.map(updateTrack);

        set({ 
          currentTrack: newCurrentTrack,
          playlist: newPlaylist
        });

        get()._saveCurrentStateToMode();
        
      } catch (e) {
        console.error("Failed to toggle like", e);
      }
    },

    removeTrack: (trackId) => {
      const { currentTrack, playlist, pause } = get();

      // If current track is being deleted, pause first
      if (currentTrack?.id === trackId) {
        pause();
        set({ currentTrack: null, currentTime: 0 });
      }

      const updatedPlaylist = playlist.filter(t => t.id !== trackId);
      set({ playlist: updatedPlaylist });

      get()._saveCurrentStateToMode();
    },

    startRadioMode: async () => {
      const { activeMode } = get();
      set({ isRadioMode: true });

      try {
        const res = await getLatestTracks(activeMode, true, 1);
        if (res.code === 200 && res.data && res.data.length > 0) {
          set({
            playlist: res.data,
            currentTrack: res.data[0],
            isPlaying: true,
            isRadioMode: true,
            playlistSource: null,
          });
          get()._saveCurrentStateToMode();
        }
      } catch (e) {
        console.error("Failed to start radio mode", e);
      }
    },

    loadMoreSourceTracks: async () => {
      const { playlistSource, playlist, activeMode, isLoadingMore } = get();
      if (!playlistSource || !playlistSource.hasMore || isLoadingMore) return;

      set({ isLoadingMore: true });
      try {
        let newTracks: Track[] = [];
        const nextPage = (playlistSource.currentPage || 0) + 1;
        const pageSize = playlistSource.pageSize || 50;
        const skip = nextPage * pageSize;

        if (playlistSource.type === "album" && playlistSource.id) {
          const res = await getAlbumTracks(
            playlistSource.id,
            pageSize,
            skip,
            playlistSource.params?.sort || "asc",
            playlistSource.params?.keyword,
            useAuthStore.getState().user?.id,
            playlistSource.params?.sortBy
          );
          if (res.code === 200) {
            newTracks = res.data.list;
          }
        } else if (playlistSource.type === "tracks") {
          const res = await loadMoreTrack({
            pageSize,
            loadCount: nextPage,
            type: activeMode,
          });
          if (res.code === 200 && res.data) {
            newTracks = res.data.list;
          }
        } else if (playlistSource.type === "history") {
          const res = await getTrackHistory(
            useAuthStore.getState().user?.id || 0,
            skip,
            pageSize,
            activeMode
          );
          if (res.code === 200 && res.data) {
            newTracks = res.data.list || [];
          }
        }

        if (newTracks.length > 0) {
          const updatedPlaylist = [...playlist, ...newTracks];
          const updatedSource = {
            ...playlistSource,
            currentPage: nextPage,
            hasMore: newTracks.length === pageSize,
          };
          set({
            playlist: updatedPlaylist,
            playlistSource: updatedSource,
          });
          get()._saveCurrentStateToMode();
        } else {
          set({ playlistSource: { ...playlistSource, hasMore: false } });
          get()._saveCurrentStateToMode();
        }
      } catch (e) {
        console.error("Failed to load more tracks for playlist", e);
      } finally {
        set({ isLoadingMore: false });
      }
    },
    
    insertTracksNext: (tracksToInsert) => {
      const { playlist, currentTrack } = get();
      if (!playlist.length || !currentTrack) {
        set({
          playlist: tracksToInsert,
          currentTrack: tracksToInsert[0],
          isPlaying: true,
          playlistSource: null
        });
      } else {
        const currentIndex = playlist.findIndex(t => t.id === currentTrack.id);
        const nextIndex = currentIndex === -1 ? playlist.length : currentIndex + 1;
        
        // Deduplicate? Maybe optional, but good for UX. Assuming allowed for now.
        const newPlaylist = [...playlist];
        newPlaylist.splice(nextIndex, 0, ...tracksToInsert);
        
        set({ playlist: newPlaylist });
      }
      get()._saveCurrentStateToMode();
    },
  };
});
