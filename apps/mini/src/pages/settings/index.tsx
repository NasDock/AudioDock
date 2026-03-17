import { ScrollView, Switch, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { usePlayMode } from '../../utils/playMode';
import './index.scss';

export default function Settings() {
  const { logout, user } = useAuth();
  const { mode, setMode } = usePlayMode();
  const [darkMode, setDarkMode] = useState(false);

  const handleLogout = () => {
    Taro.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          logout();
          Taro.reLaunch({ url: '/pages/login/index' });
        }
      }
    });
  };

  const renderSettingRow = (
    label: string,
    description: string,
    value: boolean,
    onValueChange: (val: boolean) => void
  ) => (
    <View className='setting-row'>
      <View className='setting-info'>
        <Text className='setting-label'>{label}</Text>
        <Text className='setting-description'>{description}</Text>
      </View>
      <Switch checked={value} onChange={(e) => onValueChange(e.detail.value)} color='#007aff' />
    </View>
  );

  return (
    <View className='settings-container'>
      <View className='header'>
        <View className='back-btn' onClick={() => Taro.navigateBack()}>
          <Text className='back-icon icon icon-back' />
        </View>
        <Text className='header-title'>设置</Text>
        <View style={{ width: '80rpx' }} />
      </View>

      <ScrollView scrollY className='content'>
        <View className='section'>
          <Text className='section-title'>通用</Text>

          {renderSettingRow(
            '深色模式',
            '开启或关闭应用的深色外观',
            darkMode,
            (val) => {
              setDarkMode(val);
              Taro.showToast({ title: '暂未实现', icon: 'none' });
            }
          )}

          {renderSettingRow(
            '有声书模式',
            '切换音乐与有声书的显示内容',
            mode === 'AUDIOBOOK',
            (val) => setMode(val ? 'AUDIOBOOK' : 'MUSIC')
          )}
        </View>

        <View className='section'>
           <Text className='section-title'>管理</Text>
           {user?.is_admin && (
             <View className='setting-row' onClick={() => Taro.navigateTo({ url: '/pages/admin/index' })}>
                <View className='setting-info'>
                   <Text className='setting-label'>管理后台</Text>
                   <Text className='setting-description'>用户与系统设置</Text>
                </View>
                <Text style={{ color: '#999' }}>&gt;</Text>
             </View>
           )}
           <View className='setting-row' onClick={() => Taro.navigateTo({ url: '/pages/source-manage/index' })}>
              <View className='setting-info'>
                 <Text className='setting-label'>数据源管理</Text>
                 <Text className='setting-description'>切换和管理音频数据源</Text>
              </View>
              <Text style={{ color: '#999' }}>&gt;</Text>
           </View>
        </View>

        <View className='section'>
          <Text className='section-title'>账户</Text>
          <View className='user-info'>
            <Text className='username'>{user?.username || '未登录'}</Text>
          </View>
          <View className='logout-btn' onClick={handleLogout}>
            <Text className='logout-text'>退出登录</Text>
          </View>
        </View>

        <View className='footer'>
          <Text className='version-text'>SoundX Mini v1.0.0</Text>
        </View>
      </ScrollView>
    </View>
  );
}
