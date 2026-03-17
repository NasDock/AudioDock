import { Button, Image, Input, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { setBaseURL } from '../../utils/request'
import { SOURCEMAP, SOURCETIPSMAP, SourceConfig, getSourceLogo, selectBestServer } from '../../utils/sourceUtils'
import './index.scss'

export default function LoginForm() {
  const { login, register, token } = useAuth()
  const params = Taro.getCurrentInstance().router?.params
  const sourceType = params?.type || 'AudioDock'
  const isAddingSource = params?.adding === 'true'

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
        setInternalAddress('http://localhost:3000')
      } else {
        setInternalAddress('')
      }
      setExternalAddress('')
      setUsername('')
      setPassword('')
    } catch (error) {
      if (type === 'AudioDock') {
        setInternalAddress('http://localhost:3000')
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
            name: '默认服务器',
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
      Taro.showToast({ title: '请至少输入一个地址', icon: 'none' })
      return
    }

    if (!username || !password) {
      Taro.showToast({ title: '请填写用户名和密码', icon: 'none' })
      return
    }

    if (!isLogin && password !== confirmPassword) {
      Taro.showToast({ title: '两次密码不一致', icon: 'none' })
      return
    }

    try {
      setLoading(true)

      const bestAddress = await selectBestServer(internalAddress, externalAddress, sourceType)
      if (!bestAddress) {
        Taro.showToast({ title: '无法连接到任一地址', icon: 'none' })
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
          throw new Error('Subsonic 数据源不支持注册')
        }
        await register({ username, password })
      }

      if (isAddingSource) {
        Taro.showToast({ title: '数据源添加成功', icon: 'success' })
        setTimeout(() => {
          Taro.navigateBack()
        }, 800)
        return
      }

      Taro.reLaunch({ url: '/pages/index/index' })
    } catch (error: any) {
      Taro.showToast({ title: error.message || '认证失败', icon: 'none' })
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
            <Text className='switch-type-text'>切换类型</Text>
            <Text className='switch-type-icon'>▦</Text>
          </View>
        </View>

        <View className='content'>
          <View className='logo-wrap'>
            <Image src={getSourceLogo(sourceType)} className='logo' mode='aspectFill' />
            <Text className='title'>{sourceType} {isLogin ? '登录' : '注册'}</Text>
          </View>

          <Text className='tips'>{sourceTip}</Text>

          <View className='form'>
            <Text className='label'>外网地址 (External)</Text>
            <Input
              className='input'
              placeholder='http://music.example.com'
              value={externalAddress}
              onInput={(e) => setExternalAddress(e.detail.value)}
            />

            <Text className='label'>内网地址 (Internal)</Text>
            <Input
              className='input'
              placeholder='http://192.168.1.10:3000'
              value={internalAddress}
              onInput={(e) => setInternalAddress(e.detail.value)}
            />

            <Text className='label'>用户名</Text>
            <Input
              className='input'
              placeholder='用户名'
              value={username}
              onInput={(e) => setUsername(e.detail.value)}
            />

            <Text className='label'>密码</Text>
            <Input
              className='input'
              placeholder='密码'
              password
              value={password}
              onInput={(e) => setPassword(e.detail.value)}
            />

            {!isLogin && (
              <>
                <Text className='label'>确认密码</Text>
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
              {loading ? '加载中...' : (isLogin ? '登录' : '注册')}
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
                  ? (isLogin ? '没有账号？注册' : '已有账号？登录')
                  : 'AudioDock 听见你的声音'}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
