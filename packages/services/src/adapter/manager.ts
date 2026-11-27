import { AudiobookshelfConfig, AudiobookshelfMusicAdapter } from "./audiobookshelf";
import { EmbyConfig, EmbyMusicAdapter } from "./emby";
import { FnosMusicAdapter } from "./fnos";
import type { FnosConfig } from "./fnos";
import { IMusicAdapter } from "./interface";
import { NativeMusicAdapter } from "./native";
import { SubsonicMusicAdapter } from "./subsonic";
import { SubsonicConfig } from "./subsonic/client";
import { UgreenMusicAdapter } from "./ugreen";
import type { UgreenConfig } from "./ugreen";

// 飞牛音乐的签名器/传输层注入点（第三方签名模块、Tauri 传输层挂这里）
export { getFnosSigner, setFnosSigner, setFnosAuthKeys, getFnosAuthKeys, hasFnosAuthKeys } from "./fnos";
export { setSearchRecordStorage } from "./fnos";
export type { FnosSigner, FnosSignInput, FnosSignature, FnosAuthKeys, SearchRecordStorage } from "./fnos";
export {
  normalizeFnosBaseUrl,
  normalizeFnosDeviceId,
  resolveFnosServer,
  FnosApiError,
  FNOS_CODES,
  FNOS_CODE_SESSION_EXPIRED,
  setFnosTransport,
  getFnosTransport,
  setFnosMediaProxy,
  getFnosMediaProxy,
} from "./fnos";
export type {
  FnosTransport,
  FnosTransportRequest,
  FnosTransportResponse,
  FnosErrorKind,
  FnosSystemConfig,
} from "./fnos";

// 绿联音乐（UGOS Pro com.ugreen.music）注入点
export {
  UgreenApiError,
  UGREEN_CODES,
  UGREEN_SORT,
  resolveUgreenServer,
  rsaEncryptBase64,
} from "./ugreen";
export type { UgreenResolvedServer, UgreenRawResponse, UgreenErrorKind } from "./ugreen";

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

export const useAudiobookshelfAdapter = (config?: AudiobookshelfConfig) => {
  console.log("[Adapter Manager] Switching to Audiobookshelf Adapter");
  currentAdapter = new AudiobookshelfMusicAdapter(config);
};

export const useFnosAdapter = (config?: FnosConfig) => {
  console.log("[Adapter Manager] Switching to Fnos (fnOS Music) Adapter");
  currentAdapter = new FnosMusicAdapter(config);
};

export const useUgreenAdapter = (config?: UgreenConfig) => {
  console.log("[Adapter Manager] Switching to Ugreen (UGOS Music) Adapter");
  currentAdapter = new UgreenMusicAdapter(config);
};
