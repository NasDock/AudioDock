import { theme } from 'antd';
import type { ThemeConfig } from 'antd/es/config-provider';

export const getThemeConfig = (mode: 'light' | 'dark'): ThemeConfig => {
  const isDark = mode === 'dark';
  return {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: isDark ? '#ffffff' : '#000000',
      colorBgContainer: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.6)',
      colorBorder: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
    },
    components: {
      Layout: {
        colorBgBody: 'transparent',
        colorBgHeader: 'transparent',
      },
      Button: {
        colorPrimaryText: isDark ? '#000' : '#fff',
      },
      Menu: {
        itemBg: 'transparent',
        subMenuItemBg: 'transparent',
        activeBarBorderWidth: 0,
      },
      Drawer: {
        colorBgElevated: isDark ? 'rgba(24, 24, 36, 0.8)' : 'rgba(255, 255, 255, 0.8)',
      },
      Popover: {
        colorBgElevated: isDark ? 'rgba(30, 30, 40, 0.85)' : 'rgba(255, 255, 255, 0.85)',
        colorBorder: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)',
      },
      Tooltip: {
        colorBgSpotlight: isDark ? 'rgba(30, 30, 40, 0.9)' : 'rgba(50, 50, 50, 0.9)',
      },
    },
  };
};
