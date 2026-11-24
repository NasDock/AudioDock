import { TrackingEvent as TE, TrackingFeature as TF } from '@soundx/services'
import { Button, Image, Input, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { setBaseURL } from '../../utils/request'
import { SOURCEMAP, SOURCETIPSMAP, SourceConfig, getSourceLogo, selectBestServer } from '../../utils/sourceUtils'
import { trackEvent } from '../../utils/tracking'
import './index.scss'

// H5 同源部署时默认指向 nginx 代理的 /api；小程序端用 localhost:3000 由用户填写
const DEFAULT_INTERNAL_ADDRESS =
  process.env.TARO_ENV === 'h5' && typeof window !== 'undefined' && window.location
    ? `${window.location.origin}/api`
    : 'http://localhost:3000'

export default function LoginForm() {
  const { t } = useTranslation();
  const { login, register, token } = useAuth()
  const params = Taro.getCurrentInstance().router?.params
  const sourceType = params?.type || 'AudioDock'
  const isAddingSource = params?.adding === 'true'
  const loginPageOpenedRef = useRef(false)

  useEffect(() => {
    if (loginPageOpenedRef.current) return
    loginPageOpenedRef.current = true
    void trackEvent({ feature: TF.LOGIN, eventName: TE.LOGIN_PAGE_OPEN })
  }, [])

  const [isLogin, setIsLogin] = useState(true)
  const [loading, setLoading] = useState(false)
  const [externalAddress, setExternalAddress] = useState('')
  const [internalAddress, setInternalAddress] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const sourceTip = useMemo(
    () => SOURCETIPSMAP[sourceType as keyof typeof SOURCETIPSMAP] || SOURCETIPSMAP.AudioDock,
    [sourceType]
  )

  useEffect(() => {
    loadSourceConfig(sourceType)
  }, [sourceType])

  useEffect(() => {
    if (token && !isAddingSource) {
      Taro.reLaunch({ url: '/pages/index/index' })
    }
  }, [token, isAddingSource])

  const loadSourceConfig = async (type: string) => {
    try {
      const configKey = `sourceConfig_${type}`
      const savedConfig = await Taro.getStorage({ key: configKey })

      if (savedConfig.data) {
        const parsed = JSON.parse(savedConfig.data)
        if (Array.isArray(parsed) && parsed.length > 0) {
          const lastConfig = parsed[parsed.length - 1] as SourceConfig
          setInternalAddress(lastConfig.internal || '')
          setExternalAddress(lastConfig.external || '')

          if (lastConfig.external) {
            await restoreCredentials(lastConfig.external, type)
          } else if (lastConfig.internal) {
            await restoreCredentials(lastConfig.internal, type)
          }
          return
        }

        if (!Array.isArray(parsed)) {
          const internal = parsed.internal || ''
          const external = parsed.external || ''
          setInternalAddress(internal)
          setExternalAddress(external)

          if (external) {
            await restoreCredentials(external, type)
          } else if (internal) {
            await restoreCredentials(internal, type)
          }
          return
        }
      }

      if (type === 'AudioDock') {
        setInternalAddress(DEFAULT_INTERNAL_ADDRESS)
      } else {
        setInternalAddress('')
      }
      setExternalAddress('')
      setUsername('')
      setPassword('')
    } catch (error) {
      if (type === 'AudioDock') {
        setInternalAddress(DEFAULT_INTERNAL_ADDRESS)
      }
      setExternalAddress('')
    }
  }

  const restoreCredentials = async (address: string, type: string) => {
    try {
      const creds = await Taro.getStorage({ key: `creds_${type}_${address}` })
      if (!creds.data) return

      const parsed = JSON.parse(creds.data)
      if (parsed.username) setUsername(parsed.username)
      if (parsed.password) setPassword(parsed.password)
    } catch (error) {
      // ignore missing credentials
    }
  }

  const persistSourceConfig = async (type: string, internal: string, external: string) => {
    const configKey = `sourceConfig_${type}`
    let existingConfigs: SourceConfig[] = []

    try {
      const existing = await Taro.getStorage({ key: configKey })
      if (existing.data) {
        const parsed = JSON.parse(existing.data)
        if (Array.isArray(parsed)) {
          existingConfigs = parsed
        } else {
          existingConfigs = [{
            id: Date.now().toString(),
            internal: parsed.internal || '',
            external: parsed.external || '',
            name: t('login.defaultServer'),
          }]
        }
      }
    } catch (error) {
      existingConfigs = []
    }

    const duplicated = existingConfigs.find(
      item => item.internal === internal && item.external === external
    )

    if (!duplicated) {
      existingConfigs.push({
        id: Date.now().toString(),
        internal,
        external,
        name: `服务器 ${existingConfigs.length + 1}`,
      })
    }

    await Taro.setStorage({
      key: configKey,
      data: JSON.stringify(existingConfigs),
    })
  }

  const handleSubmit = async () => {
    if (!externalAddress && !internalAddress) {
      Taro.showToast({ title: t('login.enterAddress'), icon: 'none' })
      return
    }

    if (!username || !password) {
      Taro.showToast({ title: t('login.fillUsernameAndPassword'), icon: 'none' })
      return
    }

    if (!isLogin && password !== confirmPassword) {
      Taro.showToast({ title: t('login.passwordMismatch'), icon: 'none' })
      return
    }

    void trackEvent({
      feature: TF.LOGIN,
      eventName: TE.LOGIN_SUBMIT,
      metadata: { sourceType, mode: isLogin ? 'login' : 'register' },
    });

    try {
      setLoading(true)

      const bestAddress = await selectBestServer(internalAddress, externalAddress, sourceType)
      if (!bestAddress) {
        Taro.showToast({ title: t('login.cannotConnectAnyAddress'), icon: 'none' })
        return
      }

      await persistSourceConfig(sourceType, internalAddress, externalAddress)

      await Taro.setStorage({
        key: `creds_${sourceType}_${bestAddress}`,
        data: JSON.stringify({ username, password }),
      })

      Taro.setStorageSync('serverAddress', bestAddress)
      Taro.setStorageSync('currentSourceType', sourceType)
      setBaseURL(bestAddress)

      const mappedType = SOURCEMAP[sourceType as keyof typeof SOURCEMAP] || 'audiodock'
      if (isLogin) {
        await login({ username, password })
      } else {
        if (mappedType === 'subsonic') {
          throw new Error(t('login.subsonicNoRegisterSupport') || 'Subsonic data source does not support registration')
        }
        await register({ username, password })
      }

      void trackEvent({
        feature: TF.LOGIN,
        eventName: TE.LOGIN_SUCCESS,
        metadata: { sourceType, mode: isLogin ? 'login' : 'register' },
      });

      if (isAddingSource) {
        Taro.showToast({ title: t('login.dataSourceAddedSuccess'), icon: 'success' })
        setTimeout(() => {
          Taro.navigateBack()
        }, 800)
        return
      }

      Taro.switchTab({ url: '/pages/personal/index' })
    } catch (error: any) {
      void trackEvent({
        feature: TF.LOGIN,
        eventName: TE.LOGIN_FAILED,
        metadata: { sourceType, mode: isLogin ? 'login' : 'register' },
      });
      Taro.showToast({ title: error.message || t('login.authFailed'), icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const canSwitchMode = sourceType === 'AudioDock'

  return (
    <View className='login-form-page'>
      <ScrollView scrollY className='scroll'>
        <View className='header'>
          <View className='switch-type' onClick={() => Taro.redirectTo({ url: '/pages/login/index' })}>
            <Text className='switch-type-text'>{t('loginForm.switchType')}</Text>
            <Text className='switch-type-icon'>▦</Text>
          </View>
        </View>

        <View className='content'>
          <View className='logo-wrap'>
            <Image src={getSourceLogo(sourceType)} className='logo' mode='aspectFill' />
            <Text className='title'>{sourceType} {isLogin ? t('loginForm.login') : t('loginForm.register')}</Text>
          </View>

          <Text className='tips'>{sourceTip}</Text>

          <View className='form'>
            <Text className='label'>{t('loginForm.externalAddress')}</Text>
            <Input
              className='input'
              placeholder='http://music.example.com'
              value={externalAddress}
              onInput={(e) => setExternalAddress(e.detail.value)}
            />

            <Text className='label'>{t('loginForm.internalAddress')}</Text>
            <Input
              className='input'
              placeholder='http://192.168.1.10:3000'
              value={internalAddress}
              onInput={(e) => setInternalAddress(e.detail.value)}
            />

            <Text className='label'>{t('login.username')}</Text>
            <Input
              className='input'
              placeholder='用户名'
              value={username}
              onInput={(e) => setUsername(e.detail.value)}
            />

            <Text className='label'>{t('login.password')}</Text>
            <Input
              className='input'
              placeholder='密码'
              password
              value={password}
              onInput={(e) => setPassword(e.detail.value)}
            />

            {!isLogin && (
              <>
                <Text className='label'>{t('loginForm.confirmPasswordLabel')}</Text>
                <Input
                  className='input'
                  placeholder='确认密码'
                  password
                  value={confirmPassword}
                  onInput={(e) => setConfirmPassword(e.detail.value)}
                />
              </>
            )}

            <Button className='submit-btn' onClick={handleSubmit} disabled={loading}>
              {loading ? t('common.loading') : (isLogin ? t('loginForm.login') : t('loginForm.register'))}
            </Button>

            <View className='switch-mode'>
              <Text
                className={`switch-mode-text ${!canSwitchMode ? 'disabled' : ''}`}
                onClick={() => {
                  if (canSwitchMode) {
                    setIsLogin(!isLogin)
                  }
                }}
              >
                {canSwitchMode
                  ? (isLogin ? t('loginForm.noAccount') : t('loginForm.hasAccount'))
                  : t('loginForm.appSlogan')}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
