/**
 * Storage Helper for AudioDock HarmonyOS App.
 * Wraps HarmonyOS AppStorage/Preferrence for persistent storage.
 */
import { preferences } from '@kit.ArkData';

// ==================== Constants ====================
const STORAGE_FILE_NAME: string = 'audiodock_prefs';

// ==================== Storage Keys ====================
export const StorageKeys: Record<string, string> = {
  TOKEN: 'auth_token',
  PLUS_TOKEN: 'plus_token',
  USER_ID: 'user_id',
  USER_INFO: 'user_info',
  BASE_URL: 'server_address',
  THEME: 'theme_mode',
  SETTINGS: 'app_settings',
  PLAYER_STATE: 'player_state',
  PLUS_VIP_STATUS: 'plus_vip_status',
  PLUS_VIP_DATA: 'plus_vip_data',
  PLAY_HISTORY: 'play_history',
  DOWNLOADED_TRACKS: 'downloaded_tracks',
};

// ==================== Storage Helper ====================
export class StorageHelper {
  private static instance: StorageHelper;
  private prefs: preferences.Preferences | null = null;
  private initPromise: Promise<void> | null = null;

  private constructor() {
    this.initPromise = this.init();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): StorageHelper {
    if (!StorageHelper.instance) {
      StorageHelper.instance = new StorageHelper();
    }
    return StorageHelper.instance;
  }

  /**
   * Initialize storage
   */
  private async init(): Promise<void> {
    try {
      const context = getContext();
      this.prefs = await preferences.getPreferences(context, {
        name: STORAGE_FILE_NAME
      });
    } catch (e) {
      console.error('[StorageHelper] Failed to init preferences:', e);
    }
  }

  /**
   * Ensure initialization is complete
   */
  private async ensureInit(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  // ==================== String Operations ====================

  /**
   * Get string value
   */
  public async getString(key: string): Promise<string | null> {
    await this.ensureInit();
    if (!this.prefs) return null;
    try {
      return await this.prefs.get(key, '') as string || null;
    } catch (e) {
      console.error(`[StorageHelper] Failed to get string ${key}:`, e);
      return null;
    }
  }

  /**
   * Set string value
   */
  public async setString(key: string, value: string): Promise<void> {
    await this.ensureInit();
    if (!this.prefs) return;
    try {
      await this.prefs.put(key, value);
      await this.prefs.flush();
    } catch (e) {
      console.error(`[StorageHelper] Failed to set string ${key}:`, e);
    }
  }

  // ==================== Number Operations ====================

  /**
   * Get number value
   */
  public async getNumber(key: string): Promise<number | null> {
    await this.ensureInit();
    if (!this.prefs) return null;
    try {
      const val = await this.prefs.get(key, 0);
      return typeof val === 'number' ? val : null;
    } catch (e) {
      console.error(`[StorageHelper] Failed to get number ${key}:`, e);
      return null;
    }
  }

  /**
   * Set number value
   */
  public async setNumber(key: string, value: number): Promise<void> {
    await this.ensureInit();
    if (!this.prefs) return;
    try {
      await this.prefs.put(key, value);
      await this.prefs.flush();
    } catch (e) {
      console.error(`[StorageHelper] Failed to set number ${key}:`, e);
    }
  }

  // ==================== Boolean Operations ====================

  /**
   * Get boolean value
   */
  public async getBoolean(key: string): Promise<boolean | null> {
    await this.ensureInit();
    if (!this.prefs) return null;
    try {
      const val = await this.prefs.get(key, false);
      return typeof val === 'boolean' ? val : null;
    } catch (e) {
      console.error(`[StorageHelper] Failed to get boolean ${key}:`, e);
      return null;
    }
  }

  /**
   * Set boolean value
   */
  public async setBoolean(key: string, value: boolean): Promise<void> {
    await this.ensureInit();
    if (!this.prefs) return;
    try {
      await this.prefs.put(key, value);
      await this.prefs.flush();
    } catch (e) {
      console.error(`[StorageHelper] Failed to set boolean ${key}:`, e);
    }
  }

  // ==================== Object Operations ====================

  /**
   * Get object value (JSON serialized)
   */
  public async getObject<T>(key: string): Promise<T | null> {
    const str = await this.getString(key);
    if (!str) return null;
    try {
      return JSON.parse(str) as T;
    } catch (e) {
      console.error(`[StorageHelper] Failed to parse object ${key}:`, e);
      return null;
    }
  }

  /**
   * Set object value (JSON serialized)
   */
  public async setObject<T>(key: string, value: T): Promise<void> {
    try {
      await this.setString(key, JSON.stringify(value));
    } catch (e) {
      console.error(`[StorageHelper] Failed to serialize object ${key}:`, e);
    }
  }

  // ==================== Delete Operations ====================

  /**
   * Delete a key
   */
  public async delete(key: string): Promise<void> {
    await this.ensureInit();
    if (!this.prefs) return;
    try {
      await this.prefs.delete(key);
      await this.prefs.flush();
    } catch (e) {
      console.error(`[StorageHelper] Failed to delete ${key}:`, e);
    }
  }

  /**
   * Clear all data
   */
  public async clear(): Promise<void> {
    await this.ensureInit();
    if (!this.prefs) return;
    try {
      await this.prefs.clear();
      await this.prefs.flush();
    } catch (e) {
      console.error('[StorageHelper] Failed to clear storage:', e);
    }
  }

  /**
   * Check if a key exists
   */
  public async has(key: string): Promise<boolean> {
    await this.ensureInit();
    if (!this.prefs) return false;
    try {
      return await this.prefs.has(key);
    } catch (e) {
      console.error(`[StorageHelper] Failed to check ${key}:`, e);
      return false;
    }
  }

  // ==================== Batch Operations ====================

  /**
   * Get all keys
   * Note: getAllKeys() may not be available in all HarmonyOS versions
   */
  public async getAllKeys(): Promise<string[]> {
    await this.ensureInit();
    if (!this.prefs) return [];
    try {
      // Use known keys as fallback since getAllKeys may not be available
      const knownKeys: string[] = [
        'auth_token', 'plus_token', 'user_id', 'user_info',
        'server_address', 'theme_mode', 'app_settings',
        'player_state', 'plus_vip_status', 'plus_vip_data',
        'play_history', 'downloaded_tracks'
      ];
      return knownKeys;
    } catch (e) {
      console.error('[StorageHelper] Failed to get all keys:', e);
      return [];
    }
  }
}

// ==================== Singleton Export ====================
export const storage = StorageHelper.getInstance();
