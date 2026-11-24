import { TrackingEvent as TE, TrackingFeature as TF } from '@soundx/services'
import { useEffect, useRef, useState } from 'react'
import { View, Text, Image, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useTranslation } from 'react-i18next'
import './index.scss'
import { SOURCEMAP, SOURCETIPSMAP, SourceConfig, selectBestServer, getSourceLogo } from '../../utils/sourceUtils'
import { useAuth } from '../../context/AuthContext'
import { trackEvent } from '../../utils/tracking'

export default function SourceManage() {
  const { t } = useTranslation();
  const { switchServer } = useAuth()
  const [configs, setConfigs] = useState<Record<string, SourceConfig[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [networkType, setNetworkType] = useState<string>('unknown')
  const sourceManageOpenedRef = useRef(false)

  useEffect(() => {
    if (sourceManageOpenedRef.current) return
    sourceManageOpenedRef.current = true
    void trackEvent({ feature: TF.SOURCE, eventName: TE.SOURCE_MANAGE_OPEN })
  }, [])

  useEffect(() => {
    loadAllConfigs()
    checkNetwork()
  }, [])

  // 检查网络类型
  const checkNetwork = () => {
    Taro.getNetworkType({
      success: (res) => {
        setNetworkType(res.networkType)
      }
    })
  }

  // 加载所有配置
  const loadAllConfigs = async () => {
    const newConfigs: Record<string, SourceConfig[]> = {}
    
    for (const key of Object.keys(SOURCEMAP)) {
      try {
        const configKey = `sourceConfig_${key}`
        const saved = await Taro.getStorage({ key: configKey })
        if (saved.data) {
          const parsed = JSON.parse(saved.data)
          if (Array.isArray(parsed)) {
            newConfigs[key] = parsed
          } else {
            // 迁移：将旧的对象格式转换为数组
            newConfigs[key] = [
              {
                id: Date.now().toString(),
                internal: parsed.internal || "",
                external: parsed.external || "",
                name: t('sourceManage.defaultServer'),
              },
            ]
          }
        } else {
          // 没有保存的配置，空数组
          newConfigs[key] = []
        }
      } catch (e) {
        newConfigs[key] = []
      }
    }
    
    setConfigs(newConfigs)
  }

  // 更新配置
  const updateConfig = (key: string, id: string, field: keyof SourceConfig, value: string) => {
    setConfigs(prevState => ({
      ...prevState,
      [key]: prevState[key].map(item =>
        item.id === id ? { ...item, [field]: value } : item
      )
    }))
  }

  // 删除配置
  const deleteConfig = (key: string, id: string) => {
    Taro.showModal({
      title: t('sourceManage.deleteDataSource'),
      content: t('sourceManage.confirmDeleteDataSource'),
      success: async (res) => {
        if (res.confirm) {
          const newKeyConfigs = configs[key].filter(item => item.id !== id)
          setConfigs(prevState => ({
            ...prevState,
            [key]: newKeyConfigs
          }))
          
          await Taro.setStorage({
            key: `sourceConfig_${key}`,
            data: JSON.stringify(newKeyConfigs)
          })
        }
      }
    })
  }

  // 保存配置
  const saveConfig = async (key: string) => {
    const config = configs[key]
    await Taro.setStorage({
      key: `sourceConfig_${key}`,
      data: JSON.stringify(config)
    })
  }

  // 连接数据源
  const handleConnect = async (key: string, id: string) => {
    const configList = configs[key]
    const config = configList.find(c => c.id === id)

    if (!config || (!config.internal && !config.external)) {
      Taro.showToast({
        title: t('sourceManage.enterAddress'),
        icon: 'none'
      })
      return
    }

    try {
      setLoadingId(id)
      await saveConfig(key) // 保存该key的所有配置

      const bestAddress = await selectBestServer(
        config.internal,
        config.external,
        key
      )

      if (!bestAddress) {
        setExpanded(prevState => ({ ...prevState, [id]: true }))
        Taro.showToast({
          title: t('sourceManage.cannotConnectDataSource'),
          icon: 'none'
        })
        return
      }

      // 切换服务器
      await switchServer(bestAddress, key)
      
      // 成功消息会在switchServer中显示
    } catch (error: any) {
      console.error(error)
      setExpanded(prevState => ({ ...prevState, [id]: true }))
      Taro.showToast({
        title: error.message || t('common.error'),
        icon: 'none'
      })
    } finally {
      setLoadingId(null)
    }
  }

  // 添加数据源
  const handleAddSource = () => {
    Taro.navigateTo({
      url: '/pages/login/index?adding=true'
    })
  }

  const isWifi = networkType === 'wifi'

  return (
    <View className="source-manage">
      {/* 头部 */}
      <View className="header">
        <View className="back-btn" onClick={() => Taro.navigateBack()}>
          <Text style={{ fontSize: '48rpx', color: '#333' }}>‹</Text>
        </View>
        <Text className="title">{t('sourceManage.switchDataSource')}</Text>
        <View style={{ width: '80rpx' }} />
      </View>

      {/* 提示 */}
      <Text className="tip">
        {t('sourceManage.wifiTip')}
      </Text>

      {/* 数据源列表 */}
      {Object.keys(SOURCEMAP).map(key => {
        const configList = configs[key] || []
        if (configList.length === 0) return null

        return configList.map(config => {
          const uniqueId = config.id
          const isLoading = loadingId === uniqueId
          const hasValue = !!(config.internal || config.external)
          const isExpanded = expanded[uniqueId] ?? !hasValue

          // 确定连接按钮文本和状态
          let connectButtonText = t('sourceManage.autoConnect')
          let networkConnectDisabled = false
          let buttonClass = "connect-btn primary"

          if (config.internal && config.external) {
            connectButtonText = t('sourceManage.autoConnect')
          } else if (config.internal) {
            connectButtonText = t('sourceManage.internalConnect')
          } else if (config.external) {
            connectButtonText = t('sourceManage.externalConnect')
          }

          if (!isWifi) {
            // 移动网络或其他
            if (!config.external) {
              connectButtonText = t('sourceManage.cannotConnectMissing')
              networkConnectDisabled = true
              buttonClass = "connect-btn disabled"
            } else {
              connectButtonText = t('sourceManage.externalConnect')
            }
          }

          const toggleExpand = () => {
            setExpanded(prevState => ({
              ...prevState,
              [uniqueId]: !isExpanded
            }))
          }

          return (
            <View key={uniqueId} className="source-card">
              {/* 卡片头部 */}
              <View className="card-header">
                {hasValue && (
                  <View className="expand-btn" onClick={toggleExpand}>
                    <Text style={{ fontSize: '32rpx', color: '#666' }}>
                      {isExpanded ? '▲' : '▼'}
                    </Text>
                  </View>
                )}
                <Image 
                  src={getSourceLogo(key)} 
                  className="logo" 
                  mode="aspectFill"
                />
                <View className="info">
                  <Text className="name">{key}</Text>
                  <Text className="desc">
                    {SOURCETIPSMAP[key as keyof typeof SOURCETIPSMAP]}
                  </Text>
                </View>
              </View>

              {/* 展开的配置表单 */}
              {isExpanded && (
                <>
                  <View className="input-group">
                    <Text className="label">{t('sourceManage.internalAddress')}</Text>
                    <Input
                      className="input"
                      value={config.internal}
                      onInput={(e) => updateConfig(key, uniqueId, "internal", e.detail.value)}
                      placeholder="http://192.168.x.x:port"
                      placeholderClass="placeholder"
                    />
                  </View>

                  <View className="input-group">
                    <Text className="label">{t('sourceManage.externalAddress')}</Text>
                    <Input
                      className="input"
                      value={config.external}
                      onInput={(e) => updateConfig(key, uniqueId, "external", e.detail.value)}
                      placeholder="https://example.com"
                      placeholderClass="placeholder"
                    />
                  </View>
                </>
              )}

              {/* 操作按钮 */}
              <View className="actions">
                <View 
                  className="delete-btn"
                  onClick={() => deleteConfig(key, uniqueId)}
                >
                  <Text style={{ fontSize: '24rpx', color: '#fff' }}>×</Text>
                </View>
                <View 
                  className={buttonClass}
                  onClick={() => !networkConnectDisabled && !isLoading && handleConnect(key, uniqueId)}
                >
                  {isLoading ? (
                    <Text style={{ fontSize: '24rpx', color: '#fff' }}>...</Text>
                  ) : (
                    <Text>{connectButtonText}</Text>
                  )}
                </View>
              </View>
            </View>
          )
        })
      })}

      {/* 如果没有配置，显示空状态 */}
      {Object.keys(configs).every(key => !configs[key] || configs[key].length === 0) && (
        <View className="empty">
          <Text>{t('sourceManage.noDataSourceConfig')}</Text>
        </View>
      )}

      {/* 添加数据源按钮 */}
      <View className="add-btn" onClick={handleAddSource}>
        <Text className="add-icon" style={{ fontSize: '32rpx', color: '#000000' }}>+</Text>
        <Text className="add-text">{t('sourceManage.addDataSource')}</Text>
      </View>
    </View>
  )
}