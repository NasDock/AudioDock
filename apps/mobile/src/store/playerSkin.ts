/**
 * Mobile 播放页本地皮肤设置（对齐 desktop store/playerSkin.ts）：
 * 相当于「内置插件」，优先级低于 VIP 播放器主题插件（playerThemeStore）——
 * 插件定义了的键以插件为准，插件没定义/非 VIP 时以本地选择为准。
 *
 * 当前只有 coverStyle（square 默认 / vinyl 黑胶），与主题插件 coverStyle 同键。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

export type CoverStyle = "square" | "vinyl";

interface PlayerSkinState {
  coverStyle: CoverStyle;
}

const STORAGE_KEY = "audiodock-player-skin";

let state: PlayerSkinState = { coverStyle: "square" };
let listeners: Array<() => void> = [];
let hydrated = false;

const notify = () => listeners.forEach((fn) => fn());

const persist = () => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((e) => {
    console.warn("Failed to persist player skin", e);
  });
};

const hydrate = (): void => {
  AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.coverStyle === "vinyl" || parsed.coverStyle === "square")) {
            state = { coverStyle: parsed.coverStyle };
          }
        } catch (e) {
          console.warn("Failed to parse persisted player skin", e);
        }
      }
    })
    .catch((e) => console.warn("Failed to load player skin", e))
    .finally(() => {
      hydrated = true;
      notify();
    });
};

void hydrate();

export const playerSkinStore = {
  getState: () => state,
  isHydrated: () => hydrated,

  subscribe: (fn: () => void) => {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },

  setCoverStyle: (coverStyle: CoverStyle) => {
    if (state.coverStyle === coverStyle) return;
    state = { coverStyle };
    persist();
    notify();
  },
};

/** React 订阅入口 */
export function usePlayerSkin(): PlayerSkinState & {
  setCoverStyle: (v: CoverStyle) => void;
} {
  const state = useSyncExternalStore(
    playerSkinStore.subscribe,
    playerSkinStore.getState,
  );
  return { ...state, setCoverStyle: playerSkinStore.setCoverStyle };
}
