import { Button, Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
// import { hello } from '../../services/auth'
import { hello } from '@soundx/services'
import { setBaseURL } from '../../utils/request'
import './index.scss'

export default function Login() {
  const { login, register, token } = useAuth()
  const [isLogin, setIsLogin] = useState(true)
  const [loading, setLoading] = useState(false)
  const [serverAddress, setServerAddress] = useState('http://localhost:3000')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [statusMessage, setStatusMessage] = useState<'ok' | 'error'>('error')
  const [isAddingSource, setIsAddingSource] = useState(false)

  useEffect(() => {
    loadServerAddress()
    checkIfAddingSource()
  }, [])

  useEffect(() => {
    if (token) {
       Taro.reLaunch({ url: '/pages/index/index' })
    }
  }, [token])

  const checkIfAddingSource = () => {
    const params = Taro.getCurrentInstance().router?.params
    if (params?.adding === 'true') {
      setIsAddingSource(true)
      setIsLogin(true) // 添加数据源时默认为登录模式
    }
  }

  const loadServerAddress = () => {
    try {
      const savedAddress = Taro.getStorageSync('serverAddress')
      if (savedAddress) {
        setServerAddress(savedAddress)
        checkServerConnectivity(savedAddress)
      }
    } catch (error) {
      console.error('Failed to load server address:', error)
    }
  }

  const checkServerConnectivity = async (address: string) => {
    if (!address) {
      setStatusMessage('error')
      return
    }

    if (!address.startsWith('http://') && !address.startsWith('https://')) {
      setStatusMessage('error')
      return
    }
    console.log(address)
    setBaseURL(address)

    try {
      const response = await hello()

      console.log(response)

      if (response.data === 'hello') {
        setStatusMessage('ok')
      } else {
        setStatusMessage('error')
      }
    } catch (error) {
      setStatusMessage('error')
    }
  }

  const handleSubmit = async () => {
    if (!serverAddress) {
      Taro.showToast({ title: '请输入服务器地址', icon: 'none' })
      return
    }
    if (!username || !password) {
      Taro.showToast({ title: '请填写所有字段', icon: 'none' })
      return
    }
    if (!isLogin && password !== confirmPassword) {
      Taro.showToast({ title: '两次密码不一致', icon: 'none' })
      return
    }

    try {
      setLoading(true)
      Taro.setStorageSync('serverAddress', serverAddress)
      setBaseURL(serverAddress)
      console.log(username, password, isLogin)
      
      if (isLogin) {
        await login({ username, password })
      } else {
        await register({ username, password })
      }
      
      // 如果是添加数据源模式，保存数据源配置并返回
      if (isAddingSource) {
        await saveSourceConfig()
        Taro.showToast({ title: '数据源添加成功', icon: 'success' })
        setTimeout(() => {
          Taro.navigateBack()
        }, 1500)
      } else {
        // 正常登录/注册流程
        Taro.showToast({ title: isLogin ? '登录成功' : '注册成功', icon: 'success' })
      }
      
    } catch (error: any) {
      Taro.showToast({ title: error.message || '认证失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  // 保存数据源配置
  const saveSourceConfig = async () => {
    try {
      // 这里需要确定数据源类型，暂时默认为AudioDock
      const sourceType = 'AudioDock'
      const configKey = `sourceConfig_${sourceType}`
      
      // 获取现有的配置
      const saved = await Taro.getStorage({ key: configKey })
      let existingConfigs: any[] = []
      
      if (saved.data) {
        existingConfigs = JSON.parse(saved.data)
      }
      
      // 添加新的配置
      const newConfig = {
        id: Date.now().toString(),
        internal: serverAddress,
        external: serverAddress,
        name: '新增服务器'
      }
      
      existingConfigs.push(newConfig)
      
      // 保存配置
      await Taro.setStorage({
        key: configKey,
        data: JSON.stringify(existingConfigs)
      })
      
    } catch (error) {
      console.error('Failed to save source config:', error)
      throw error
    }
  }

  return (
    <View className='login-container'>
      <Text className='title'>
        {isAddingSource ? '添加数据源' : (isLogin ? '欢迎登录' : '欢迎注册')}
      </Text>

      <View className='form'>
        <Text className='label'>数据源地址</Text>
        <View className='input-container'>
          <Input
            className='input'
            placeholder='http://localhost:3000'
            value={serverAddress}
            onInput={(e) => setServerAddress(e.detail.value)}
            onBlur={(e) => checkServerConnectivity(e.detail.value)}
          />
          <View className='status-icon'>
             {statusMessage === 'ok' ? <Text style={{color: 'green'}}>✓</Text> : <Text style={{color: 'red'}}>✗</Text>}
          </View>
        </View>

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

        <Button
          className='button'
          onClick={handleSubmit}
          disabled={loading}
        >
          <Text className='button-text'>
            {loading ? '加载中...' : (isLogin ? '登录' : '注册')}
          </Text>
        </Button>

        <View
          className='switch-button'
          onClick={() => setIsLogin(!isLogin)}
        >
          <Text className='switch-text'>
            {isLogin ? '没有账号？注册' : '已有账号？登录'}
          </Text>
        </View>
      </View>
    </View>
  )
}
