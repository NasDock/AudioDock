import {
  getMiAuthStatus,
  getMiDevices,
  getMiQRCode,
  getMiQRCodeStatus,
  getUserDevices,
  type Device as OnlineDevice,
  type MiDevice,
  type MiQRCodeResponse,
} from '@soundx/services';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import XiaoAiIcon from '../XiaoAiIcon';
import './index.scss';

export interface MiDeviceSelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelectDevice: (device: MiDevice) => void;
  /** 播放流转：点击在线设备时回调（由父组件 player 页处理 transfer） */
  onTransferToDevice?: (device: OnlineDevice) => void;
  loading?: boolean;
  title?: string;
}

const MiDeviceSelector: React.FC<MiDeviceSelectorProps> = ({
  visible,
  onClose,
  onSelectDevice,
  onTransferToDevice,
  loading: externalLoading,
  title,
}) => {
  const { t } = useTranslation();
  const [miDevices, setMiDevices] = useState<MiDevice[]>([]);
  const [onlineDevices, setOnlineDevices] = useState<OnlineDevice[]>([]);
  const [miLoggedIn, setMiLoggedIn] = useState(false);
  const [miQRCode, setMiQRCode] = useState<MiQRCodeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isBusy = externalLoading || isLoading;

  const stopPolling = () => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  useEffect(() => {
    if (visible) {
      loadDevices();
      loadOnlineDevices();
    } else {
      stopPolling();
    }
  }, [visible]);

  // 加载当前账号的在线设备（HTTP 兜底，mini 暂不常驻 WS）
  const loadOnlineDevices = async () => {
    try {
      const selfId = Taro.getStorageSync('audiodock_device_id') || '';
      const res = await getUserDevices();
      if (res.code === 200 && res.data) {
        setOnlineDevices(
          res.data.filter((d) => d.isOnline && (d.deviceId ?? '') !== selfId),
        );
      }
    } catch (e) {
      console.error('Failed to load online devices:', e);
    }
  };

  const loadDevices = async () => {
    setIsLoading(true);
    stopPolling();
    try {
      const authRes = await getMiAuthStatus();
      setMiLoggedIn(authRes.logged_in);

      if (authRes.logged_in) {
        const res = await getMiDevices();
        setMiDevices(res.devices || []);
        setMiQRCode(null);
      } else {
        const qrRes = await getMiQRCode();
        setMiQRCode(qrRes);
        if (qrRes.already_logged_in) {
          setMiLoggedIn(true);
          const res = await getMiDevices();
          setMiDevices(res.devices || []);
        } else if (qrRes.status_url) {
          startQRPolling(qrRes.status_url);
        }
      }
    } catch (error) {
      console.error('Failed to load Mi devices:', error);
      Taro.showToast({ title: t('playerPage.loadMiDevicesFailed'), icon: 'none' });
      setMiDevices([]);
    } finally {
      setIsLoading(false);
    }
  };

  const startQRPolling = (lpUrl: string) => {
    stopPolling();
    pollingTimerRef.current = setInterval(async () => {
      try {
        const statusRes = await getMiQRCodeStatus(lpUrl);
        if (statusRes.status === 'success') {
          stopPolling();
          setMiLoggedIn(true);
          setMiQRCode(null);
          Taro.showToast({ title: t('playerPage.miLoginSuccess'), icon: 'success' });
          const res = await getMiDevices();
          setMiDevices(res.devices || []);
        } else if (statusRes.status === 'expired' || statusRes.status === 'error') {
          stopPolling();
          setMiQRCode(null);
        }
      } catch (error) {
        console.error('QR polling error:', error);
      }
    }, 3000);
  };

  const handleDevicePress = (device: MiDevice) => {
    if (isBusy) return;
    onSelectDevice(device);
  };

  if (!visible) return null;

  return (
    <View className='mi-device-mask' onClick={onClose}>
      <View className='mi-device-sheet' onClick={(e) => e.stopPropagation()}>
        <Text className='mi-device-title'>
          {title || t('playerPage.miSpeakerTitle')}
        </Text>

        {/* 我的在线设备（播放流转） */}
        {onlineDevices.length > 0 && (
          <View className='mi-online-section'>
            <Text className='mi-device-secondary mi-online-label'>
              {t('playerPage.onlineDevices')}
            </Text>
            {onlineDevices.map((d) => (
              <View
                key={String(d.deviceId ?? d.id)}
                className='mi-device-row'
                onClick={() => !isBusy && onTransferToDevice?.(d)}
              >
                <View className='mi-device-icon mi-online-icon'>
                  <Text className='mi-online-icon-text'>
                    {d.platform === 'desktop' ? '💻' : d.platform === 'tv' ? '📺' : d.platform === 'tablet' ? '📱' : '📱'}
                  </Text>
                </View>
                <View className='mi-device-info'>
                  <Text className='mi-device-name' numberOfLines={1}>
                    {d.name}
                  </Text>
                  <Text className='mi-device-model' numberOfLines={1}>
                    {t(`playerPage.platform_${d.platform || 'phone'}`)}
                  </Text>
                </View>
                <Text className='mi-device-chevron icon icon-back' />
              </View>
            ))}
            <Text className='mi-device-secondary mi-online-label' style={{ marginTop: 12 }}>
              {t('playerPage.miSpeakerSection')}
            </Text>
          </View>
        )}

        {isLoading ? (
          <View className='mi-device-center'>
            <Text className='mi-device-secondary'>{t('common.loading')}</Text>
          </View>
        ) : miLoggedIn ? (
          miDevices.length === 0 ? (
            <View className='mi-device-center'>
              <XiaoAiIcon size={40} />
              <Text className='mi-device-secondary'>{t('playerPage.noMiDevices')}</Text>
            </View>
          ) : (
            <ScrollView scrollY className='mi-device-list'>
              {miDevices.map((device) => (
                <View
                  key={device.device_id}
                  className={`mi-device-row ${isBusy ? 'disabled' : ''}`}
                  onClick={() => handleDevicePress(device)}
                >
                  <View className='mi-device-icon'>
                    <XiaoAiIcon size={10} />
                  </View>
                  <View className='mi-device-info'>
                    <Text className='mi-device-name' numberOfLines={1}>
                      {device.name}
                    </Text>
                    {!!device.model && (
                      <Text className='mi-device-model' numberOfLines={1}>
                        {device.model}
                      </Text>
                    )}
                  </View>
                  <Text className='mi-device-chevron icon icon-back' />
                </View>
              ))}
            </ScrollView>
          )
        ) : miQRCode?.qrcode_url ? (
          <View className='mi-device-center'>
            <Text className='mi-device-secondary'>{t('playerPage.miLoginRequired')}</Text>
            <Image
              src={miQRCode.qrcode_url}
              className='mi-device-qrcode'
              mode='aspectFit'
            />
            <Text className='mi-device-hint'>{t('playerPage.miScanQRCode')}</Text>
          </View>
        ) : (
          <View className='mi-device-center'>
            <XiaoAiIcon size={40} />
            <Text className='mi-device-secondary'>{t('playerPage.miLoginRequired')}</Text>
            <View className='mi-device-retry' onClick={() => !isBusy && loadDevices()}>
              <Text className='mi-device-retry-text'>{t('common.retry')}</Text>
            </View>
          </View>
        )}

        <View className='mi-device-close' onClick={onClose}>
          <Text className='mi-device-close-text'>{t('common.close')}</Text>
        </View>
      </View>
    </View>
  );
};

export default MiDeviceSelector;
