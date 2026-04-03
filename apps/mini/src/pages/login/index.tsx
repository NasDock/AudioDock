import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { SOURCEMAP, SOURCETIPSMAP, getSourceLogo } from '../../utils/sourceUtils'
import './index.scss'

export default function Login() {
  const params = Taro.getCurrentInstance().router?.params
  const adding = params?.adding === 'true'

  const handleSelect = (type: string) => {
    const query = adding ? `?type=${type}&adding=true` : `?type=${type}`
    Taro.navigateTo({ url: `/pages/login-form/index${query}` })
  }

  const handleScanLogin = () => {
    Taro.navigateTo({ url: '/pages/scan/index' })
  }

  return (
    <View className='login-selection'>
      <View className='header'>
        <Image src={getSourceLogo('AudioDock')} className='app-logo' mode='aspectFill' />
        <Text className='title'>选择数据源类型</Text>
        <Text className='subtitle'>请选择您要连接的服务器类型</Text>
      </View>

      <View className='source-list'>
        {Object.keys(SOURCEMAP).map((key) => (
          <View key={key} className='source-card' onClick={() => handleSelect(key)}>
            <View className='card-content'>
              <Image src={getSourceLogo(key)} className='card-icon' mode='aspectFill' />
              <View className='card-text'>
                <Text className='card-title'>{key}</Text>
                <Text className='card-desc'>
                  {SOURCETIPSMAP[key as keyof typeof SOURCETIPSMAP]}
                </Text>
              </View>
              <Text className='card-arrow'>›</Text>
            </View>
          </View>
        ))}
      </View>

      <View className='scan-login'>
        <Text className='scan-login-text' onClick={handleScanLogin}>
          扫码登录
        </Text>
      </View>
    </View>
  )
}
