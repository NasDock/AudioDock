import { Text, View, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { claimScanLoginSession } from '@soundx/services'
import './index.scss'

interface ScanLoginPayload {
  kind?: string
  sessionId?: string
  secret?: string
}

async function collectMiniScanLoginPayload(): Promise<any> {
  const savedAddress = Taro.getStorageSync('serverAddress') || ''
  const sourceType = Taro.getStorageSync('currentSourceType') || 'AudioDock'
  const token = Taro.getStorageSync('token') || null
  const user = Taro.getStorageSync('user') || null
  const device = Taro.getStorageSync('device') || null

  const sourceBundles = Object.keys({
    AudioDock: 'audiodock',
    Subsonic: 'subsonic',
    Emby: 'emby',
  }).map((type) => {
    const raw = Taro.getStorageSync(`sourceConfig_${type}`)
    const parsed = raw ? JSON.parse(raw) : []
    return {
      type,
      configs: Array.isArray(parsed) ? parsed : [],
    }
  })

  return {
    deviceName: Taro.getSystemInfoSync().model || 'Mini Program',
    nativeAuth:
      token && user && savedAddress
        ? {
            baseUrl: savedAddress,
            sourceType,
            token,
            user: JSON.parse(user),
            device: device ? JSON.parse(device) : undefined,
          }
        : null,
    plusAuth: null,
    sourceBundles: sourceBundles.filter((bundle) => bundle.configs.length > 0),
  }
}

export default function ScanPage() {
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    // Auto start scanning when page loads
    handleScan()
  }, [])

  const handleScan = async () => {
    if (scanning) return
    setScanning(true)

    try {
      const result = await Taro.scanCode({ onlyFromCamera: true })

      const data = result.result as string
      const parsed: ScanLoginPayload = JSON.parse(data)

      if (parsed?.kind !== 'soundx-scan-login') {
        throw new Error('不是有效的扫码登录二维码')
      }

      const payload = await collectMiniScanLoginPayload()
      if (!payload.nativeAuth && !payload.plusAuth) {
        throw new Error('当前设备还没有可供迁移的登录态，请先在本机登录')
      }

      await claimScanLoginSession(parsed.sessionId, {
        secret: parsed.secret,
        payload,
      })

      Taro.navigateTo({
        url: `/pages/scan-confirm/index?sessionId=${parsed.sessionId}&secret=${parsed.secret}`,
      })
    } catch (error: any) {
      console.error('Scan failed:', error)
      Taro.showToast({
        title: error.message || '扫码失败',
        icon: 'none',
      })
      setTimeout(() => {
        Taro.navigateBack()
      }, 1500)
    } finally {
      setScanning(false)
    }
  }

  return (
    <View className='scan-page'>
      <View className='header'>
        <Text className='title'>扫码登录</Text>
      </View>

      <View className='content'>
        <Text className='desc'>请对准桌面端或横屏设备上的二维码</Text>
        <View className='scan-placeholder'>
          <View className='scan-icon'>📷</View>
          <Text className='scan-text'>点击按钮开始扫描</Text>
        </View>
        <Button className='scan-btn' onClick={handleScan} disabled={scanning}>
          {scanning ? '扫描中...' : '开始扫描'}
        </Button>
      </View>
    </View>
  )
}