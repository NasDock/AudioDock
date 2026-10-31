/**
 * Mobile 播放器主题存储（对齐 mobile 现有手写 store 模式，见 mvPlaylist.ts）。
 *
 * - 内存态 + 订阅（useSyncExternalStore 消费）；
 * - AsyncStorage 持久化，模块加载时异步水合；
 * - 与 desktop store/uiTheme.ts 行为对齐：导入（JSON 文本校验）、删除、激活；
 *   unknown 字段零剥离，原样存取。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import {
  validatePlayerTheme,
  type PlayerThemePlugin,
  type ValidationResult,
} from "../config/playerThemeSchema";

const STORAGE_KEY = "soundx-player-themes";

interface PlayerThemeState {
  /** id → 已导入主题（含原始 unknown 字段，零剥离） */
  themes: Record<string, PlayerThemePlugin>;
  /** id 顺序，便于 UI 展示 */
  order: string[];
  activeId: string | null;
}

let state: PlayerThemeState = { themes: {}, order: [], activeId: null };
let listeners: Array<() => void> = [];
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

const notify = () => listeners.forEach((fn) => fn());

const persist = () => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((e) => {
    console.warn("Failed to persist player themes", e);
  });
};

/** 模块加载即开始水合；hook 侧可用 useSyncExternalStore 自动拿到水合后的值 */
const hydrate = (): Promise<void> => {
  if (!hydratePromise) {
    hydratePromise = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (
              parsed &&
              typeof parsed === "object" &&
              parsed.themes &&
              typeof parsed.themes === "object"
            ) {
              state = {
                themes: parsed.themes,
                order: Array.isArray(parsed.order)
                  ? parsed.order.filter((id: unknown) => typeof id === "string")
                  : Object.keys(parsed.themes),
                activeId:
                  typeof parsed.activeId === "string" && parsed.themes[parsed.activeId]
                    ? parsed.activeId
                    : null,
              };
            }
          } catch (e) {
            console.warn("Failed to parse persisted player themes", e);
          }
        }
      })
      .catch((e) => console.warn("Failed to load player themes", e))
      .finally(() => {
        hydrated = true;
        notify();
      });
  }
  return hydratePromise;
};

void hydrate();

/** id 生成：基于 meta.name + 8 位随机后缀，避免同名校验冲突（同 desktop） */
const newId = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 32) || "theme"}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

export const playerThemeStore = {
  getState: () => state,
  isHydrated: () => hydrated,
  hydrate,

  subscribe: (fn: () => void) => {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },

  importTheme: (jsonText: string): ValidationResult & { id?: string } => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      return { ok: false, error: `JSON 解析失败：${(e as Error).message}` };
    }
    const result = validatePlayerTheme(parsed);
    if (!result.ok) return result;

    const id = newId(result.plugin.meta.name);
    state = {
      ...state,
      themes: { ...state.themes, [id]: result.plugin },
      order: state.order.includes(id) ? state.order : [...state.order, id],
    };
    persist();
    notify();
    return { ...result, id };
  },

  /** 原位更新已有主题：保留 id / 顺序 / 激活态，仅替换校验后的内容 */
  updateTheme: (id: string, jsonText: string): ValidationResult => {
    if (!state.themes[id]) {
      return { ok: false, error: "主题不存在或已被删除" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      return { ok: false, error: `JSON 解析失败：${(e as Error).message}` };
    }
    const result = validatePlayerTheme(parsed);
    if (!result.ok) return result;

    state = {
      ...state,
      themes: { ...state.themes, [id]: result.plugin },
    };
    persist();
    notify();
    return result;
  },

  removeTheme: (id: string) => {
    const { [id]: _, ...rest } = state.themes;
    void _;
    state = {
      themes: rest,
      order: state.order.filter((x) => x !== id),
      activeId: state.activeId === id ? null : state.activeId,
    };
    persist();
    notify();
  },

  setActive: (id: string | null) => {
    if (id !== null && !state.themes[id]) return;
    state = { ...state, activeId: id };
    persist();
    notify();
  },
};

/** React 订阅入口 */
export function usePlayerThemeState(): PlayerThemeState {
  return useSyncExternalStore(playerThemeStore.subscribe, playerThemeStore.getState);
}
