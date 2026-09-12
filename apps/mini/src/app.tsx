import Taro from '@tarojs/taro';
import React, { PropsWithChildren } from 'react';
import './app.scss';
import './i18n';
import { AuthProvider } from './context/AuthContext';
import './utils/request'; // Initialize request instance

import { PlayerProvider } from './context/PlayerContext';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { ThemeProvider } from './context/ThemeContext';
import PromotionModal from './components/PromotionModal';
import { useCheckPromotion } from './utils/useCheckPromotion';

function App(props: PropsWithChildren) {
  return (
    <SettingsProvider>
      <ThemeProvider>
        <AuthProvider>
          <PlayerProvider>
            <AuthGuard>
              {props.children}
            </AuthGuard>
          </PlayerProvider>
        </AuthProvider>
      </ThemeProvider>
    </SettingsProvider>
  )
}

// Simple Guard Component to handle redirection
const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const { token, isLoading } = require('./context/AuthContext').useAuth()
  const { activityNotifyEnabled } = useSettings();
  const { promotion, checkPromotion, ignorePromotion, dismissPromotion } =
    useCheckPromotion();
  const hasCheckedRef = React.useRef(false);

  React.useEffect(() => {
    // In Mini Program, app launch doesn't have a route yet, so we might rely on pages to handle their own redirect
    // or use a more robust router guard.
    // For this simple implementation, we check token on mount.
    if (!isLoading && !token) {
        // We can't easily redirect in App onLaunch globally for all cases in MP without mixing into page logic
        // But let's try to handle basic initial check
        Taro.reLaunch({ url: '/pages/login/index' })
    }
  }, [token, isLoading])

  // Check promotion once token is ready (delayed, once per session)
  // 设置页「活动通知」关闭时不弹
  React.useEffect(() => {
    if (isLoading || !token || !activityNotifyEnabled || hasCheckedRef.current) return;
    hasCheckedRef.current = true;
    const timer = setTimeout(() => {
      void checkPromotion();
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isLoading, activityNotifyEnabled]);

  return (
    <>
      {children}
      <PromotionModal
        visible={!!promotion}
        promotion={promotion}
        onClose={dismissPromotion}
        onIgnore={ignorePromotion}
      />
    </>
  )
}

export default App
