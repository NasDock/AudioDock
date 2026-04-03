import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { confirmScanLoginSession, getScanLoginSession, reportScanLoginResultViaSocket } from '@soundx/services'
import './index.scss'

interface SourceConfig {
  id: string
  internal: string
  external: string
  name?: string
}

interface SourceBundle {
  type: string
  configs: SourceConfig[]
}

interface ScanStatus {
  status: string
  sessionId: string
  deviceName?: string
  sourceBundles: SourceBundle[]
  hasNativeAuth: boolean
  hasPlusAuth: boolean
}

export default function ScanConfirmPage() {
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)
  const [selectedConfigIds, setSelectedConfigIds] = useState<Record<string, string[]>>({})
  const [waitResult, setWaitResult] = useState(false)

  const pollTimerRef = useRef<number | null>(null)
  const sessionIdRef = useRef<string>('')
  const secretRef = useRef<string>('')

  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params
    const sessionId = params?.sessionId
    const secret = params?.secret

    if (!sessionId || !secret) {
      Taro.showToast({ title: '缺少会话参数', icon: 'none' })
      Taro.navigateBack()
      return
    }

    sessionIdRef.current = sessionId as string
    secretRef.current = secret as string

    fetchSession(sessionId as string, secret as string)

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
      }
    }
  }, [])

  const fetchSession = async (sessionId: string, secret: string) => {
    try {
      const res = await getScanLoginSession(sessionId, secret)
      setScanStatus(res.data)

      // Auto-select all available bundles by default
      const initialSelected: Record<string, string[]> = {}
      res.data.sourceBundles.forEach((bundle: SourceBundle) => {
        initialSelected[bundle.type] = bundle.configs.map((c) => c.id)
      })
      setSelectedConfigIds(initialSelected)
    } catch (error: any) {
      Taro.showToast({ title: error.message || '获取信息失败', icon: 'none' })
      setTimeout(() => {
        Taro.navigateBack()
      }, 1500)
    } finally {
      setLoading(false)
    }
  }

  const pollSessionStatus = async () => {
    try {
      const res = await getScanLoginSession(sessionIdRef.current, secretRef.current)
      const status = res.data.status

      if (status === 'success') {
        stopPolling()
        setConfirming(false)
        Taro.showToast({ title: '登录成功', icon: 'success' })
        // Report success via socket so desktop knows
        reportScanLoginResultViaSocket(sessionIdRef.current, secretRef.current, true)
        setTimeout(() => {
          Taro.reLaunch({ url: '/pages/index/index' })
        }, 1500)
      } else if (status === 'failed') {
        stopPolling()
        setConfirming(false)
        Taro.showToast({ title: '登录失败', icon: 'none' })
        reportScanLoginResultViaSocket(sessionIdRef.current, secretRef.current, false, 'User rejected')
        setTimeout(() => {
          Taro.reLaunch({ url: '/pages/index/index' })
        }, 1500)
      }
    } catch (error: any) {
      console.error('Poll error:', error)
    }
  }

  const startPolling = () => {
    if (pollTimerRef.current) return
    pollTimerRef.current = setInterval(pollSessionStatus, 2000) as unknown as number
  }

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  const toggleConfigSelection = (type: string, configId: string) => {
    if (waitResult) return
    setSelectedConfigIds((prev) => {
      const current = new Set(prev[type] || [])
      if (current.has(configId)) current.delete(configId)
      else current.add(configId)
      return {
        ...prev,
        [type]: Array.from(current),
      }
    })
  }

  const handleConfirmScan = async () => {
    if (!sessionIdRef.current || !secretRef.current) return

    try {
      setConfirming(true)
      setWaitResult(true)
      const selections = Object.entries(selectedConfigIds).map(([type, configIds]) => ({
        type,
        configIds,
      }))
      await confirmScanLoginSession(sessionIdRef.current, {
        secret: secretRef.current,
        selections,
      })

      // Start polling to check result
      startPolling()

      // Show waiting message
      Taro.showToast({ title: '已确认，等待目标设备...', icon: 'none', duration: 3000 })
    } catch (error: any) {
      Taro.showToast({ title: error.message || '确认发送失败', icon: 'none' })
      setConfirming(false)
      setWaitResult(false)
    }
  }

  if (loading || !scanStatus) {
    return (
      <View className='scan-confirm-page'>
        <View className='loading'>加载中...</View>
      </View>
    )
  }

  return (
    <View className='scan-confirm-page'>
      <View className='header'>
        <Text className='title'>确认同步内容</Text>
      </View>

      <View className='content'>
        <Text className='desc'>
          请勾选要分享给该登录目标设备的数据源，确认登录后目标设备将自动登录。
        </Text>

        <View className='list'>
          {scanStatus.sourceBundles.map((bundle) => (
            <View key={bundle.type} className='bundle-card'>
              <Text className='bundle-title'>{bundle.type}</Text>
              {bundle.configs.map((config) => {
                const checked = (selectedConfigIds[bundle.type] || []).includes(config.id)
                return (
                  <View
                    key={config.id}
                    className={`bundle-item ${waitResult ? 'disabled' : ''}`}
                    onClick={() => toggleConfigSelection(bundle.type, config.id)}
                  >
                    <View className={`checkbox ${checked ? 'checked' : ''}`}>
                      {checked && <Text className='checkmark'>✓</Text>}
                    </View>
                    <View className='bundle-item-info'>
                      <Text className='bundle-item-title'>{config.name || '未命名数据源'}</Text>
                      <Text className='bundle-item-meta'>
                        {config.internal || '无内网地址'} / {config.external || '无外网地址'}
                      </Text>
                    </View>
                  </View>
                )
              })}
            </View>
          ))}
          {scanStatus.sourceBundles.length === 0 && (
            <Text className='desc-empty'>
              扫码设备没有提供任何数据源。将仅同步用户自身状态。
            </Text>
          )}
        </View>

        <View className='btn-wrap'>
          <View
            className={`confirm-btn ${confirming ? 'disabled' : ''} ${waitResult ? 'waiting' : ''}`}
            onClick={handleConfirmScan}
          >
            <Text className='confirm-btn-text'>
              {waitResult ? '等待目标设备...' : (confirming ? '确认中...' : '确认登录')}
            </Text>
          </View>
        </View>
      </View>
    </View>
  )
}