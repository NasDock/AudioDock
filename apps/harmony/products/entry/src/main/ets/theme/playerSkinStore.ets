/**
 * hm 播放页本地皮肤设置 —— 对齐 desktop/mobile playerSkinStore。
 *
 * 相当于「内置插件」：优先级低于 VIP 播放器主题插件（playerThemeStore），
 * 插件定义了的键以插件为准，插件没定义/非 VIP 时以本地选择为准。
 * 当前只有 coverStyle（square 默认 / vinyl 黑胶），与主题插件 coverStyle 同键。
 *
 * kvStore（preferences 'audiodock_kv'）持久化，key 与 desktop/mobile 同为 'audiodock-player-skin'。
 */
import { kvStore } from 'features_storage';
import { Logger } from 'audiodock_common';

const TAG = 'PlayerSkinStore';
const STORAGE_KEY = 'audiodock-player-skin';

export type CoverStyle = 'square' | 'vinyl';

interface PersistShape {
  coverStyle: CoverStyle;
}

type Listener = () => void;

export class PlayerSkinStore {
  private coverStyle: CoverStyle = 'square';
  private listeners = new Set<Listener>();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;

  isHydrated(): boolean {
    return this.hydrated;
  }

  hydrate(): Promise<void> {
    if (this.hydrating === null) {
      this.hydrating = kvStore.get(STORAGE_KEY)
        .then((raw: string | null): void => {
          if (raw === null || raw.length === 0) return;
          try {
            const parsed = JSON.parse(raw) as PersistShape;
            if (parsed.coverStyle === 'vinyl' || parsed.coverStyle === 'square') {
              this.coverStyle = parsed.coverStyle;
            }
          } catch (e) {
            Logger.w(TAG, `parse persisted skin failed: ${String(e)}`);
          }
        })
        .catch((e: Error): void => {
          Logger.w(TAG, `load skin failed: ${String(e)}`);
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
    const shape: PersistShape = { coverStyle: this.coverStyle };
    kvStore.set(STORAGE_KEY, JSON.stringify(shape)).catch((e: Error): void => {
      Logger.w(TAG, `persist failed: ${String(e)}`);
    });
  }

  getCoverStyle(): CoverStyle {
    return this.coverStyle;
  }

  setCoverStyle(v: CoverStyle): void {
    if (this.coverStyle === v) return;
    this.coverStyle = v;
    this.persist();
    this.notify();
  }
}

export const playerSkinStore = new PlayerSkinStore();
