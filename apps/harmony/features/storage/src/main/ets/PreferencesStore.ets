import preferences from '@ohos.data.preferences';
import common from '@ohos.app.ability.common';
import { Logger } from 'audiodock_common';
import type { KeyValueStore } from 'audiodock_common';

const STORE_NAME = 'audiodock_kv';

export class PreferencesStore implements KeyValueStore {
  private prefs: preferences.Preferences | null = null;
  private ctx: common.Context | null = null;
  private mem: Map<string, string> = new Map<string, string>();
  private warned: boolean = false;

  /**
   * 接受任意 Context（UIAbilityContext / FormExtensionContext / ApplicationContext），
   * 让 FormExtensionAbility 也能复用主 App 的 KV 存储（共享 STORE_NAME 即可读到主 App 写入的数据）。
   * 同包名 HAP 共享同一个 preferences 数据目录。
   */
  async init(context: common.Context): Promise<void> {
    this.ctx = context;
    this.prefs = await preferences.getPreferences(context, STORE_NAME);
    Logger.i('PreferencesStore', 'KV store ready');
  }

  /**
   * 跨进程同步：丢弃本进程缓存的 Preferences 实例，下次读写会从磁盘重新加载。
   *
   * 为什么需要：preferences 是「每进程一份内存缓存实例」。主 App 进程和卡片进程各自持有一份，
   * 一个进程 flush 到磁盘后，另一个进程的实例仍返回旧的内存缓存值 —— 这就是卡片读不到
   * 主 App 播放状态、主 App 读不到卡片注册的 formId 的根因。
   *
   * 代价：一次磁盘加载。只在读「会被其他进程写入」的数据时调用（widget_* 系列），
   * 普通 KV 读写不调用，避免性能损耗。
   */
  async pull(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      await preferences.removePreferencesFromCache(ctx, STORE_NAME);
      this.prefs = await preferences.getPreferences(ctx, STORE_NAME);
    } catch (e) {
      Logger.w('PreferencesStore', `pull: ${String(e)}`);
    }
  }

  /** 读「可能刚被其他进程写入」的值（先 pull 再 get） */
  async getFresh(key: string): Promise<string | null> {
    await this.pull();
    return this.get(key);
  }

  /** 读「可能刚被其他进程写入」的 JSON（先 pull 再 getJSON） */
  async getJSONFresh<T>(key: string): Promise<T | null> {
    await this.pull();
    return this.getJSON<T>(key);
  }

  // ponytail: Preview 不跑 Ability 生命周期，init 不会被调用 → 降级内存存储让 Preview 可用；
  // 真机 EntryAbility 总会先 init，行为不变。数据仅活在当次 Preview 会话。
  private memStore(): Map<string, string> {
    if (!this.warned) {
      Logger.w('PreferencesStore', 'not initialized, using in-memory fallback (preview)');
      this.warned = true;
    }
    return this.mem;
  }

  async get(key: string): Promise<string | null> {
    const prefs = this.prefs;
    if (!prefs) return this.memStore().get(key) ?? null;
    const v = await prefs.get(key, '') as string;
    return v === '' ? null : v;
  }

  async set(key: string, value: string): Promise<void> {
    const prefs = this.prefs;
    if (!prefs) { this.memStore().set(key, value); return; }
    await prefs.put(key, value);
    await prefs.flush();
  }

  async delete(key: string): Promise<void> {
    const prefs = this.prefs;
    if (!prefs) { this.memStore().delete(key); return; }
    await prefs.delete(key);
    await prefs.flush();
  }

  async clear(): Promise<void> {
    const prefs = this.prefs;
    if (!prefs) { this.memStore().clear(); return; }
    await prefs.clear();
    await prefs.flush();
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (raw === null) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  async setJSON<T>(key: string, value: T): Promise<void> {
    await this.set(key, JSON.stringify(value));
  }
}

export const kvStore = new PreferencesStore();
