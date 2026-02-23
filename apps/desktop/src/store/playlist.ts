import { getPlaylists, type Playlist } from "@soundx/services";
import { create } from "zustand";
import { TrackType } from "../models";

interface PlaylistState {
  playlists: Playlist[];
  loading: boolean;

  /**
   * Fetch playlists for the given mode and user.
   * If userId is not provided, it will clear the playlists.
   */
  fetchPlaylists: (
    mode: TrackType | string,
    userId?: number | string
  ) => Promise<void>;
}

export const usePlaylistStore = create<PlaylistState>((set) => ({
  playlists: [],
  loading: false,

  fetchPlaylists: async (mode, userId) => {
    if (!userId) {
      set({ playlists: [] });
      return;
    }

    set({ loading: true });
    try {
      const res = await getPlaylists(mode as any, userId);
      if (res.code === 200) {
        set({ playlists: res.data });
      }
    } catch (e) {
      console.error("Failed to fetch playlists", e);
    } finally {
      set({ loading: false });
    }
  },
}));
