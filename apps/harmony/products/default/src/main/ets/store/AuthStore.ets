/**
 * Auth Store - Authentication State Management
 * Uses in-memory state with StorageHelper for persistence.
 */
import { apiService, User, storage, StorageKeys } from '@ohos/common';

// ==================== Auth State ====================
export interface AuthState {
  token: string;
  plusToken: string;
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isPlusMember: boolean;
}

// ==================== Auth Store ====================
export class AuthStore {
  private static instance: AuthStore;
  
  private state: AuthState = {
    token: '',
    plusToken: '',
    user: null,
    isLoading: false,
    isAuthenticated: false,
    isPlusMember: false
  };

  private constructor() {}

  public static getInstance(): AuthStore {
    if (!AuthStore.instance) {
      AuthStore.instance = new AuthStore();
    }
    return AuthStore.instance;
  }

  /**
   * Get current auth state
   */
  public getState(): AuthState {
    return { ...this.state };
  }

  /**
   * Get auth token
   */
  public getToken(): string {
    return this.state.token;
  }

  /**
   * Get plus token
   */
  public getPlusToken(): string {
    return this.state.plusToken;
  }

  /**
   * Get user info
   */
  public getUser(): User | null {
    return this.state.user;
  }

  /**
   * Check if authenticated
   */
  public isAuth(): boolean {
    return this.state.isAuthenticated;
  }

  /**
   * Set auth token and persist
   */
  public async setToken(token: string): Promise<void> {
    this.state.token = token;
    this.state.isAuthenticated = !!token;
    await storage.setString(StorageKeys.TOKEN, token);
  }

  /**
   * Set plus token and persist
   */
  public async setPlusToken(plusToken: string): Promise<void> {
    this.state.plusToken = plusToken;
    this.state.isPlusMember = !!plusToken;
    await storage.setString(StorageKeys.PLUS_TOKEN, plusToken);
  }

  /**
   * Set user info
   */
  public async setUser(user: User | null): Promise<void> {
    this.state.user = user;
    if (user) {
      await storage.setString(StorageKeys.USER_INFO, JSON.stringify(user));
    } else {
      await storage.delete(StorageKeys.USER_INFO);
    }
  }

  /**
   * Login with credentials
   */
  public async login(username: string, password: string): Promise<boolean> {
    this.state.isLoading = true;

    try {
      const response = await apiService.login(username, password);
      
      if (response.code === 200) {
        await this.setToken(response.data.token);
        await this.setUser(response.data.user);
        this.state.isLoading = false;
        return true;
      }
      
      this.state.isLoading = false;
      return false;
    } catch (e) {
      this.state.isLoading = false;
      return false;
    }
  }

  /**
   * Login with plus token
   */
  public async memberLogin(plusToken: string): Promise<boolean> {
    this.state.isLoading = true;

    try {
      const response = await apiService.memberLogin(plusToken);
      
      if (response.code === 200) {
        await this.setPlusToken(response.data.plusToken);
        await this.setUser(response.data.user);
        this.state.isLoading = false;
        return true;
      }
      
      this.state.isLoading = false;
      return false;
    } catch (e) {
      this.state.isLoading = false;
      return false;
    }
  }

  /**
   * Logout
   */
  public async logout(): Promise<void> {
    await apiService.logout();
    await storage.delete(StorageKeys.TOKEN);
    await storage.delete(StorageKeys.PLUS_TOKEN);
    await storage.delete(StorageKeys.USER_INFO);
    
    this.state = {
      token: '',
      plusToken: '',
      user: null,
      isLoading: false,
      isAuthenticated: false,
      isPlusMember: false
    };
  }

  /**
   * Check authentication
   */
  public async checkAuth(): Promise<boolean> {
    try {
      const response = await apiService.check();
      if (response.code === 401) {
        await this.logout();
        return false;
      }
      if (response.code === 200) {
        await this.setUser(response.data);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Load persisted state
   */
  public async loadPersistedState(): Promise<void> {
    const token = await storage.getString(StorageKeys.TOKEN);
    const plusToken = await storage.getString(StorageKeys.PLUS_TOKEN);
    const userJson = await storage.getString(StorageKeys.USER_INFO);
    const user = userJson ? JSON.parse(userJson) as User : null;

    this.state = {
      token: token || '',
      plusToken: plusToken || '',
      user,
      isLoading: false,
      isAuthenticated: !!token,
      isPlusMember: !!plusToken
    };
  }
}

// ==================== Singleton Export ====================
export const authStore = AuthStore.getInstance();
