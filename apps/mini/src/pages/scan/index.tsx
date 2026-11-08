import { Text, View, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { claimScanLoginSession } from '@soundx/services'
import { trackEvent } from '../../utils/tracking'
import './index.scss'

interface ScanLoginPayload {
  kind?: string
  sessionId?: string
  secret?: string
}

// 服务端要求 sourceBundles 的 internal/external 均非空（否则整个 claim 被 400 拒绝），
// 单地址配置用另一侧地址互补回填，双侧皆空的配置丢弃
const sanitizeConfigs = (
  configs: Array<{ id: string; internal: string; external: string; name?: string }>,
) =>
  configs
    .map((config) => ({
      ...config,
      internal: config.internal || config.external || '',
      external: config.external || config.internal || '',
    }))
    .filter((config) => config.internal && config.external)

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
      configs: sanitizeConfigs(Array.isArray(parsed) ? parsed : []),
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
  const { t } = useTranslation();
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    // Auto start scanning when page loads
    handleScan()
  }, [])

  const handleScan = async () => {
    if (scanning) return
    setScanning(true)

    try {
      trackEvent({
        feature: 'scan_login',
        eventName: 'scan_login_camera_open'
      });
      const result = await Taro.scanCode({ onlyFromCamera: true })

      const data = result.result as string
      const parsed: ScanLoginPayload = JSON.parse(data)

      if (parsed?.kind !== 'soundx-scan-login') {
        throw new Error(t('scan.notValidQR'))
      }

      const payload = await collectMiniScanLoginPayload()
      if (!payload.nativeAuth && !payload.plusAuth) {
        throw new Error(t('scan.noLoginState'))
      }

      trackEvent({
        feature: 'scan_login',
        eventName: 'scan_login_qr_scanned',
        sessionId: parsed.sessionId
      });

      await claimScanLoginSession(parsed.sessionId as string, {
        secret: parsed.secret as string,
        payload,
      })

      trackEvent({
        feature: 'scan_login',
        eventName: 'scan_login_session_claimed',
        sessionId: parsed.sessionId
      });

      Taro.navigateTo({
        url: `/pages/scan-confirm/index?sessionId=${parsed.sessionId}&secret=${parsed.secret}`,
      })
    } catch (error: any) {
      console.error('Scan failed:', error)
      trackEvent({
        feature: 'scan_login',
        eventName: 'scan_login_failed',
        metadata: { message: error.message || 'unknown_error' }
      });
      Taro.showToast({
        title: error.message || t('scan.scanFailed'),
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
        <Text className='title'>{t('scan.scanLoginTitle')}</Text>
      </View>

      <View className='content'>
        <Text className='desc'>{t('scan.scanQRDesc')}</Text>
        <View className='scan-placeholder'>
          <View className='scan-icon'>📷</View>
          <Text className='scan-text'>{t('scan.clickToScan')}</Text>
        </View>
        <Button className='scan-btn' onClick={handleScan} disabled={scanning}>
          {scanning ? t('scan.scanning') : t('scan.startScan')}
        </Button>
      </View>
    </View>
  )
}