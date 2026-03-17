import { EmbyConfig, EmbyMusicAdapter } from "./emby";
import { IMusicAdapter } from "./interface";
import { NativeMusicAdapter } from "./native";
import { SubsonicMusicAdapter } from "./subsonic";
import { SubsonicConfig } from "./subsonic/client";

let currentAdapter: IMusicAdapter = new NativeMusicAdapter();

export const getAdapter = (): IMusicAdapter => {
  // console.log("[Adapter Manager] getAdapter called, current type:", currentAdapter.constructor.name);
  return currentAdapter;
};

export const useNativeAdapter = () => {
  console.log("[Adapter Manager] Switching to Native Adapter");
  currentAdapter = new NativeMusicAdapter();
};

export const useSubsonicAdapter = (config?: SubsonicConfig) => {
  console.log("[Adapter Manager] Switching to Subsonic Adapter");
  currentAdapter = new SubsonicMusicAdapter(config);
};

export const useEmbyAdapter = (config?: EmbyConfig) => {
  console.log("[Adapter Manager] Switching to Emby Adapter");
  currentAdapter = new EmbyMusicAdapter(config);
};

