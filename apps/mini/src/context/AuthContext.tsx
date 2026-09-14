import { login as loginApi, register as registerApi, setPlusToken, setServiceConfig, SOURCEMAP, useEmbyAdapter, useNativeAdapter, useSubsonicAdapter } from '@soundx/services'
import Taro from '@tarojs/taro'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { User } from '../models'
import { setBaseURL, getBaseURL } from '../utils/request'
import { selectBestServer } from '../utils/sourceUtils'

// ── 设备信息（在线设备列表 / 播放流转） ──
const DEVICE_ID_KEY = 'audiodock_device_id';
const getMiniDeviceId = (): string => {
  try {
    const existing = Taro.getStorageSync(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = `mini_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    Taro.setStorageSync(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return `mini_ephemeral_${Math.random().toString(36).slice(2, 12)}`;
  }
};
const getMiniDeviceName = (): string => {
  try {
    return Taro.getSystemInfoSync().model || 'Mini Program';
  } catch {
    return 'Mini Program';
  }
};

interface AuthContextType {
  user: User | null
  token: string | null
  isLoading: boolean
  login: (user: Partial<User>) => Promise<void>
  register: (user: Partial<User>) => Promise<void>
  logout: () => Promise<void>
  device: any | null
  switchServer: (address: string, sourceType: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  device: null,
  switchServer: async () => {},
})

export const useAuth = () => useContext(AuthContext)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [device, setDevice] = useState<any | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadAuthData()
  }, [])

  const loadAuthData = async () => {
    try {
      let serverAddress = Taro.getStorageSync('serverAddress')
      const sourceType = Taro.getStorageSync('currentSourceType') || 'AudioDock'
      if (serverAddress) {
        setBaseURL(serverAddress)
      }

      // --- Auto Switch Data Source (Internal/External) on Startup ---
      try {
        const configKey = `sourceConfig_${sourceType}`;
        const configStr = Taro.getStorageSync(configKey);
        if (configStr) {
          const parsed = JSON.parse(configStr);
          const configList = Array.isArray(parsed) ? parsed : [parsed];
          const matchedConfig = configList.find((c: any) => c.internal === serverAddress || c.external === serverAddress) || configList[0];
          
          if (matchedConfig && (matchedConfig.internal || matchedConfig.external)) {
            const bestAddress = await selectBestServer(matchedConfig.internal || "", matchedConfig.external || "", sourceType);
            if (bestAddress && bestAddress !== serverAddress) {
              console.log(`[AutoSwitch] Switching from ${serverAddress} to ${bestAddress}`);
              
              // Migrate creds to the new address if they don't exist yet
              const oldCreds = Taro.getStorageSync(`creds_${sourceType}_${serverAddress || ''}`);
              const newCreds = Taro.getStorageSync(`creds_${sourceType}_${bestAddress}`);
              if (!newCreds && oldCreds) {
                Taro.setStorageSync(`creds_${sourceType}_${bestAddress}`, oldCreds);
              }

              serverAddress = bestAddress;
              setBaseURL(bestAddress);
              Taro.setStorageSync('serverAddress', bestAddress);
            }
          }
        }
      } catch (e) {
        console.warn("Failed to auto-switch data source on startup:", e);
      }
      // --------------------------------------------------------------

      // 加载凭证并切换适配器
      const mappedType = SOURCEMAP[sourceType as keyof typeof SOURCEMAP] || 'audiodock'
      const credsKey = `creds_${sourceType}_${serverAddress || ''}`
      let username: string | undefined
      let password: string | undefined
      try {
        const savedCreds = Taro.getStorageSync(credsKey)
        if (savedCreds) {
          const parsed = JSON.parse(savedCreds)
          username = parsed.username
          password = parsed.password
        }
      } catch (e) {
        // ignore
      }
      setServiceConfig({ username, password, baseUrl: serverAddress || undefined, clientName: 'SoundX Mini' })
      if (mappedType === 'subsonic') {
        useSubsonicAdapter()
      } else if (mappedType === 'emby') {
        useEmbyAdapter()
      } else {
        useNativeAdapter()
      }

      const savedToken = Taro.getStorageSync('token')
      const savedUser = Taro.getStorageSync('user')
      const savedDevice = Taro.getStorageSync('device')
      const savedPlusToken = Taro.getStorageSync('plus_token')

      if (savedToken) {
        setToken(savedToken)
      }
      if (savedUser) {
        setUser(JSON.parse(savedUser))
      }
      if (savedDevice) {
        setDevice(JSON.parse(savedDevice))
      }
      if (savedPlusToken) {
        setPlusToken(savedPlusToken)
      }
    } catch (error) {
      console.error('Failed to load auth data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const login = async (credentials: Partial<User>) => {
    try {
      const res = await loginApi({
        ...credentials,
        deviceName: getMiniDeviceName(),
        deviceId: getMiniDeviceId(),
        platform: 'mini',
      })
      if (res.code === 200 && res.data) {
        console.log(res, 'res')
        const { token: newToken, device: newDevice } = res.data
        const userData = res.data
        setToken(newToken)
        setUser(userData)
        Taro.setStorageSync('token', newToken);
        Taro.setStorageSync('user', JSON.stringify(userData))
        if (newDevice) {
          setDevice(newDevice)
          Taro.setStorageSync('device', JSON.stringify(newDevice))
        }
      } else {
        throw new Error(res.message || 'Login failed')
      }
    } catch (error) {
      throw error
    }
  }

  const register = async (credentials: Partial<User>) => {
    try {
      const res = await registerApi({
        ...credentials,
        deviceName: getMiniDeviceName(),
        deviceId: getMiniDeviceId(),
        platform: 'mini',
      })
      if (res.code === 200 && res.data) {
        const { token: newToken, device: newDevice } = res.data
        const userData = res.data
        setToken(newToken)
        setUser(userData)
        Taro.setStorageSync('token', newToken)
        Taro.setStorageSync('user', JSON.stringify(userData))
        if (newDevice) {
          setDevice(newDevice)
          Taro.setStorageSync('device', JSON.stringify(newDevice))
        }
      } else {
        throw new Error(res.message || 'Registration failed')
      }
    } catch (error) {
      throw error
    }
  }

  const logout = async () => {
    try {
      setToken(null)
      setUser(null)
      setDevice(null)
      Taro.removeStorageSync('token')
      Taro.removeStorageSync('user')
      Taro.removeStorageSync('device')
    } catch (error) {
      console.error('Failed to logout:', error)
    }
  }

  const switchServer = async (address: string, sourceType: string) => {
    try {
      // 保存服务器地址
      Taro.setStorageSync('serverAddress', address)
      Taro.setStorageSync('currentSourceType', sourceType)

      // 更新请求基础URL
      setBaseURL(address)

      // 加载保存的凭证
      const credsKey = `creds_${sourceType}_${address}`
      let username: string | undefined
      let password: string | undefined
      try {
        const savedCreds = Taro.getStorageSync(credsKey)
        if (savedCreds) {
          const parsed = JSON.parse(savedCreds)
          username = parsed.username
          password = parsed.password
        }
      } catch (e) {
        // ignore
      }

      // 配置服务（凭证 + 适配器）
      const mappedType = SOURCEMAP[sourceType as keyof typeof SOURCEMAP] || 'audiodock'
      setServiceConfig({ username, password, baseUrl: address, clientName: 'SoundX Mini' })
      if (mappedType === 'subsonic') {
        useSubsonicAdapter()
      } else if (mappedType === 'emby') {
        useEmbyAdapter()
      } else {
        useNativeAdapter()
      }

      // 清除当前用户信息（需要重新登录）
      setToken(null)
      setUser(null)
      Taro.removeStorageSync('token')
      Taro.removeStorageSync('user')

      Taro.showToast({
        title: t('auth.switchServerSuccess'),
        icon: 'success',
        duration: 2000
      })

      // 跳转到登录页面
      setTimeout(() => {
        Taro.reLaunch({ url: '/pages/login/index' })
      }, 2000)
    } catch (error) {
      console.error('Failed to switch server:', error)
      throw error
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, token, isLoading, login, register, logout, device, switchServer }}
    >
      {children}
    </AuthContext.Provider>
  )
}
