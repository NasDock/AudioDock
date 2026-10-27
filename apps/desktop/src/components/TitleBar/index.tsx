import {
  BorderOutlined,
  CloseOutlined,
  MinusOutlined,
  SwitcherOutlined,
} from "@ant-design/icons";
import { theme } from "antd";
import React, { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isLinux,
  isTauri,
  isWindows,
  tauriCloseWindow,
  tauriMaximizeWindow,
  tauriMinimizeWindow,
} from "../../utils/platform";
import styles from "./index.module.less";

import logo from "../../assets/logo.png";

/**
 * Windows / Linux 专属自定义标题栏。
 *
 * tauri.windows.conf.json 与 tauri.linux.conf.json 均设置 decorations:false，
 * 系统不绘制原生窗口按钮，需要前端提供最小化 / 最大化(还原) / 关闭三个按钮。
 * macOS 走 titleBarStyle: Overlay 的原生红绿灯，无需渲染本组件。
 *
 * 关闭走 window.close() → Rust 端 CloseRequested，会遵循「最小化到托盘」设置。
 */
const TitleBar: React.FC = () => {
  const { token } = theme.useToken();
  const [isMaximized, setIsMaximized] = useState(false);

  const showCustomControls = isTauri() && (isWindows() || isLinux());

  // 全局 CSS 变量：页面用 calc(100vh - var(--titlebar-height, 0px)) 扣除标题栏高度，
  // macOS / web 不渲染本组件时变量不存在，fallback 0px 不影响原布局
  // --sidebar-top-padding：Win/Linux 顶部已由本组件占位，侧边栏标题上移；
  // macOS 变量不存在 → fallback 30px，为 Overlay 红绿灯按钮预留位置
  useEffect(() => {
    if (!showCustomControls) return;
    document.documentElement.style.setProperty("--titlebar-height", "36px");
    document.documentElement.style.setProperty("--sidebar-top-padding", "12px");
    return () => {
      document.documentElement.style.removeProperty("--titlebar-height");
      document.documentElement.style.removeProperty("--sidebar-top-padding");
    };
  }, [showCustomControls]);

  // 同步最大化状态：初始化查一次，窗口尺寸变化（拖拽吸附/双击标题栏等）时刷新
  useEffect(() => {
    if (!showCustomControls) return;
    const win = getCurrentWindow();
    const sync = () => {
      win
        .isMaximized()
        .then(setIsMaximized)
        .catch(() => undefined);
    };
    sync();
    const unlistenPromise = win.onResized(sync);
    return () => {
      unlistenPromise
        .then((fn) => fn())
        .catch(() => undefined);
    };
  }, [showCustomControls]);

  if (!showCustomControls) return null;

  return (
    <div
      className={styles.titleBar}
      // 文字色优先插件主题的 --ad-header-text（与 Header 图标同款写法），
      // 未激活插件主题时回落到 antd 的 colorText token，明暗主题自动适配。
      style={{ color: "var(--ad-header-text, " + token.colorText + ")" }}
      data-tauri-drag-region
      onDoubleClick={(e) => {
        // 双击空白区域切换最大化（按钮区域已拦截，见 controls 的 stopPropagation）
        e.preventDefault();
        void tauriMaximizeWindow();
      }}
    >
      <div className={styles.titleInfo} data-tauri-drag-region>
        <img
          src={logo}
          alt="AudioDock"
          className={styles.appIcon}
          data-tauri-drag-region
        />
        <span className={styles.appTitle} data-tauri-drag-region>
          AudioDock
        </span>
      </div>
      <div
        className={styles.controls}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <div
          className={styles.controlBtn}
          title="最小化"
          onClick={() => {
            void tauriMinimizeWindow();
          }}
        >
          <MinusOutlined />
        </div>
        <div
          className={styles.controlBtn}
          title={isMaximized ? "还原" : "最大化"}
          onClick={() => {
            void tauriMaximizeWindow();
          }}
        >
          {isMaximized ? <SwitcherOutlined /> : <BorderOutlined />}
        </div>
        <div
          className={`${styles.controlBtn} ${styles.closeBtn}`}
          title="关闭"
          onClick={() => {
            void tauriCloseWindow();
          }}
        >
          <CloseOutlined />
        </div>
      </div>
    </div>
  );
};

export default TitleBar;
