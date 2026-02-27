import { useEffect, useState } from 'react'
import { View, Text, Image, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import './index.scss'
import { SOURCEMAP, SOURCETIPSMAP, SourceConfig, selectBestServer, getSourceLogo } from '../../utils/sourceUtils'
import { useAuth } from '../../context/AuthContext'

export default function SourceManage() {
  const { switchServer } = useAuth()
  const [configs, setConfigs] = useState<Record<string, SourceConfig[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [networkType, setNetworkType] = useState<string>('unknown')

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
                name: "默认服务器",
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
      title: '删除数据源',
      content: '确定要删除这个数据源配置吗？',
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
        title: '请至少输入一个地址',
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
          title: '无法连接到该数据源的任一地址，请检查网络或配置',
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
        title: error.message || '切换失败',
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
          <Text style={{ fontSize: '32rpx', color: '#333' }}>‹</Text>
        </View>
        <Text className="title">切换数据源</Text>
      </View>

      {/* 提示 */}
      <Text className="tip">
        Wi-Fi 环境下优先选择内网，移动网络环境下只选择外网
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
          let connectButtonText = "自动连接"
          let networkConnectDisabled = false
          let buttonClass = "connect-btn primary"

          if (config.internal && config.external) {
            connectButtonText = "自动连接"
          } else if (config.internal) {
            connectButtonText = "内网连接"
          } else if (config.external) {
            connectButtonText = "外网连接"
          }

          if (!isWifi) {
            // 移动网络或其他
            if (!config.external) {
              connectButtonText = "无法连接 (缺外网)"
              networkConnectDisabled = true
              buttonClass = "connect-btn disabled"
            } else {
              connectButtonText = "外网连接"
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
                    <Text className="label">内网地址</Text>
                    <Input
                      className="input"
                      value={config.internal}
                      onInput={(e) => updateConfig(key, uniqueId, "internal", e.detail.value)}
                      placeholder="http://192.168.x.x:port"
                      placeholderClass="placeholder"
                    />
                  </View>

                  <View className="input-group">
                    <Text className="label">外网地址</Text>
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
          <Text>暂无数据源配置</Text>
        </View>
      )}

      {/* 添加数据源按钮 */}
      <View className="add-btn" onClick={handleAddSource}>
        <Text className="add-icon" style={{ fontSize: '32rpx', color: '#07c160' }}>+</Text>
        <Text className="add-text">添加数据源</Text>
      </View>
    </View>
  )
}