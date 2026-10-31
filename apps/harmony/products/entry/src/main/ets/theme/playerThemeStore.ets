/**
 * hm 播放器主题存储 —— 对齐 apps/mobile/src/store/playerTheme.ts。
 *
 * - kvStore（preferences 'audiodock_kv'）持久化，key 与 mobile AsyncStorage 同为 'soundx-player-themes'；
 * - 内存态 + subscribe 通知（对齐 PlayerStore 的 listeners 模式）；
 * - 导入 / 原位更新 / 删除 / 激活；rawJson 保留原始文本，unknown 键零剥离；
 * - VIP 门槛不在 store 层：由消费方（PlayerPage）判定，与 mobile usePlayerTheme 一致。
 */
import { kvStore } from 'features_storage';
import { Logger } from 'audiodock_common';
import {
  validatePlayerTheme,
  type PlayerThemePlugin,
  type PlayerThemeTokens,
  type ValidationErr,
} from './playerThemeSchema';

const TAG = 'PlayerThemeStore';
/** 与 mobile AsyncStorage 的 STORAGE_KEY 对齐 */
const STORAGE_KEY = 'soundx-player-themes';

export interface ThemeImportResult {
  ok: boolean;
  error: string;
  warnings: string[];
  /** 导入成功时的新主题 id；更新时为原 id */
  id: string;
}

interface PersistShape {
  themes: Record<string, PlayerThemePlugin>;
  order: string[];
  activeId: string | null;
}

type Listener = () => void;

/** id 生成：meta.name slug + 8 位随机后缀（同 mobile newId） */
function newId(name: string): string {
  const slugRaw = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').substring(0, 32);
  const slug = slugRaw.length > 0 ? slugRaw : 'theme';
  return `${slug}-${Math.random().toString(36).substring(2, 10)}`;
}

export class PlayerThemeStore {
  private themes: Record<string, PlayerThemePlugin> = {};
  private order: string[] = [];
  private activeId: string | null = null;
  private listeners = new Set<Listener>();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;

  isHydrated(): boolean {
    return this.hydrated;
  }

  /** 模块首次使用时水合；重复调用返回同一 Promise */
  hydrate(): Promise<void> {
    if (this.hydrating === null) {
      this.hydrating = kvStore.get(STORAGE_KEY)
        .then((raw: string | null): void => {
          if (raw === null || raw.length === 0) return;
          try {
            const parsed = JSON.parse(raw) as PersistShape;
            if (parsed && typeof parsed === 'object' && parsed.themes && typeof parsed.themes === 'object') {
              this.themes = parsed.themes;
              this.order = Array.isArray(parsed.order) ? parsed.order : Object.keys(parsed.themes);
              if (typeof parsed.activeId === 'string' && parsed.themes[parsed.activeId] !== undefined) {
                this.activeId = parsed.activeId;
              } else {
                this.activeId = null;
              }
            }
          } catch (e) {
            Logger.w(TAG, `parse persisted themes failed: ${String(e)}`);
          }
        })
        .catch((e: Error): void => {
          Logger.w(TAG, `load themes failed: ${String(e)}`);
        })
        .finally((): void => {
          this.hydrated = true;
          this.notify();
        });
    }
    return this.hydrating;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private persist(): void {
    const shape: PersistShape = {
      themes: this.themes,
      order: this.order,
      activeId: this.activeId,
    };
    kvStore.set(STORAGE_KEY, JSON.stringify(shape)).catch((e: Error): void => {
      Logger.w(TAG, `persist failed: ${String(e)}`);
    });
  }

  getThemes(): Record<string, PlayerThemePlugin> {
    return this.themes;
  }

  getOrder(): string[] {
    return this.order;
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  importTheme(jsonText: string): ThemeImportResult {
    const result = validatePlayerTheme(jsonText);
    if (!result.ok) {
      // ArkTS 对 `!result.ok` 的判别联合收窄不可靠，显式断言
      return { ok: false, error: (result as ValidationErr).error, warnings: [], id: '' };
    }
    const id = newId(result.plugin.meta.name);
    this.themes[id] = result.plugin;
    if (!this.order.includes(id)) this.order.push(id);
    this.persist();
    this.notify();
    return { ok: true, error: '', warnings: result.warnings, id };
  }

  /** 原位更新：保留 id / 顺序 / 激活态（对齐 mobile updateTheme） */
  updateTheme(id: string, jsonText: string): ThemeImportResult {
    if (this.themes[id] === undefined) {
      return { ok: false, error: '主题不存在或已被删除', warnings: [], id: '' };
    }
    const result = validatePlayerTheme(jsonText);
    if (!result.ok) {
      return { ok: false, error: (result as ValidationErr).error, warnings: [], id: '' };
    }
    this.themes[id] = result.plugin;
    this.persist();
    this.notify();
    return { ok: true, error: '', warnings: result.warnings, id };
  }

  removeTheme(id: string): void {
    if (this.themes[id] === undefined) return;
    // ArkTS 禁对象 rest/spread 解构，用 Reflect.deleteProperty 等价删除
    const next: Record<string, PlayerThemePlugin> = {};
    const keys = Object.keys(this.themes);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== id) next[keys[i]] = this.themes[keys[i]];
    }
    this.themes = next;
    this.order = this.order.filter((x: string): boolean => x !== id);
    if (this.activeId === id) this.activeId = null;
    this.persist();
    this.notify();
  }

  setActive(id: string | null): void {
    if (id !== null && this.themes[id] === undefined) return;
    this.activeId = id;
    this.persist();
    this.notify();
  }

  /**
   * 当前模式生效的 token；无激活主题 / 该模式无 player 段时返回 null。
   * mode 由消费方按当前主题模式换算（light → light；dark/festive → dark，对齐 mobile）。
   * VIP 门槛在消费方（PlayerPage）判定，对齐 mobile usePlayerTheme。
   */
  activeTokens(mode: 'light' | 'dark'): PlayerThemeTokens | null {
    if (this.activeId === null) return null;
    const plugin = this.themes[this.activeId];
    if (plugin === undefined) return null;
    const tokens = mode === 'dark' ? plugin.dark : plugin.light;
    return tokens ?? null;
  }
}

export const playerThemeStore = new PlayerThemeStore();
