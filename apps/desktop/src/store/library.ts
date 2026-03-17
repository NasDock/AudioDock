import { create } from "zustand";

interface LibraryState {
  heartbeatModeActive: boolean;
  setHeartbeatModeActive: (active: boolean) => void;
  toggleHeartbeatMode: () => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  heartbeatModeActive: false,
  setHeartbeatModeActive: (active: boolean) =>
    set({ heartbeatModeActive: active }),
  toggleHeartbeatMode: () =>
    set((state) => ({ heartbeatModeActive: !state.heartbeatModeActive })),
}));

