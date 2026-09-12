import { ConfigProvider, message, Skeleton } from "antd";
import zhCN from "antd/locale/zh_CN";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Header from "./components/Header/index";
import Player from "./components/Player/index";
import Sidebar from "./components/Sidebar/index";
import { getThemeConfig } from "./config/themeConfig";
import { MessageProvider } from "./context/MessageContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { useUiTheme } from "./hooks/useUiTheme";
import CarMode, { type CarModeSeekBridge } from "./components/CarMode/index";
import LyricWindow from "./pages/LyricWindow";
import Recommended from "./pages/Recommended";

const ArtistDetail = lazy(() => import("./pages/ArtistDetail"));
const ArtistList = lazy(() => import("./pages/ArtistList"));
const Category = lazy(() => import("./pages/Category"));
const Collections = lazy(() => import("./pages/Collections"));
const CollectionDetail = lazy(() => import("./pages/CollectionDetail"));
const Favorites = lazy(() => import("./pages/Favorites"));
const Listened = lazy(() => import("./pages/Listened"));
const PlaylistDetail = lazy(() => import("./pages/PlaylistDetail"));
const Detail = lazy(() => import("./components/Detail/index"));
const Settings = lazy(() => import("./pages/Settings/index"));
const Folder = lazy(() => import("./pages/Folder/index"));
const Downloads = lazy(() => import("./pages/Downloads/index"));
const UserManagement = lazy(() => import("./pages/Admin/UserManagement/index"));
const Songs = lazy(() => import("./pages/Songs/index"));
const Login = lazy(() => import("./pages/Login/index"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword/index"));
const SourceManage = lazy(() => import("./pages/SourceManage/index"));
const TaskList = lazy(() => import("./pages/TTS/TaskList/index"));
const TaskCenter = lazy(() => import("./pages/TaskCenter/index"));
const CreateTask = lazy(() => import("./pages/TTS/CreateTask/index"));
const ProductUpdates = lazy(() => import("./pages/ProductUpdates/index"));
const MemberLogin = lazy(() => import("./pages/MemberLogin/index"));
const MemberBenefits = lazy(() => import("./pages/MemberBenefits/index"));
const MemberDetail = lazy(() => import("./pages/MemberDetail/index"));

import { theme } from "antd";
import { useEffect, useRef } from "react";
import InviteListener from "./components/InviteListener";
import MiniPlayer from "./components/MiniPlayer";
import UpdateModal from "./components/UpdateModal";
import PromotionModal from "./components/PromotionModal";
import { useCheckUpdate } from "./hooks/useCheckUpdate";
import { useCheckPromotion } from "./hooks/useCheckPromotion";
import i18n from "./i18n";
import { socketService } from "./services/socket";
import { useAuthStore } from "./store/auth";
import { useSettingsStore, type SettingsState } from "./store/settings";
import { isTauri } from "./utils/platform";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Wrapper to provide consistent background and color based on theme tokens
const RootWrapper = ({
  children,
  mode,
}: {
  children: React.ReactNode;
  mode: string;
}) => {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        backgroundColor: mode === "dark" ? "#000" : undefined,
        color: token.colorText,
        minHeight: "100vh",
        width: "100vw",
        overflowX: "hidden",
      }}
    >
      {children}
    </div>
  );
};

const AppContent = () => {
  const { mode } = useTheme();
  const { plugin: uiPlugin } = useUiTheme();
  const themeConfig = getThemeConfig(mode, uiPlugin);
  const [messageApi, contextHolder] = message.useMessage();
  const { token, user } = useAuthStore();

  const { checkUpdate, updateInfo, cancelUpdate } = useCheckUpdate();
  const { promotion, checkPromotion, ignorePromotion, dismissPromotion } =
    useCheckPromotion();

  useEffect(() => {
    // Check update on startup
    const timer = setTimeout(() => {
      checkUpdate();
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  const settings = useSettingsStore((state: SettingsState) => state);
  const { autoLaunch, language, activityNotifyEnabled } = settings.general;
  const carModeEnabled = settings.carMode?.enabled ?? false;
  const carModeSeekBridgeRef = useRef<CarModeSeekBridge>({ current: null });

  useEffect(() => {
    // Check promotion on startup (delayed, once)
    // 设置页「活动通知」关闭时不弹
    if (!activityNotifyEnabled) return;
    const timer = setTimeout(() => {
      checkPromotion();
    }, 6000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityNotifyEnabled]);

  useEffect(() => {
    if (token && user) {
      socketService.connect();
    } else {
      socketService.disconnect();
    }
  }, [token, user]);

  useEffect(() => {
    if (language === "system") {
      const systemLang = navigator.language.startsWith("zh") ? "zh-CN" : "en";
      if (i18n.language !== systemLang) {
        i18n.changeLanguage(systemLang);
      }
    }
  }, [language, i18n.language]);

  useEffect(() => {
    if (isTauri()) {
      invoke("set_auto_launch", { enable: autoLaunch }).catch(console.error);
      
      const handlePositionUpdate = (pos: { x: number; y: number }) => {
        useSettingsStore.getState().updateDesktopLyric("x", pos.x);
        useSettingsStore.getState().updateDesktopLyric("y", pos.y);
      };

      let unlisten: (() => void) | undefined;
      listen("lyric:position-updated", (event) => {
        handlePositionUpdate(event.payload as { x: number; y: number });
      }).then((fn) => {
        unlisten = fn;
      });
      
      return () => {
        if (unlisten) unlisten();
      };
    }
  }, []);

  useEffect(() => {
    // Sync the persisted download path to the backend early so the local media
    // streaming server can resolve cached audio files from the start.
    if (isTauri()) {
      invoke("update_download_path", {
        path: useSettingsStore.getState().download.downloadPath,
      }).catch(console.error);
    }
  }, []);

  const isLyricWindow = window.location.hash.includes("/lyric");
  const isMiniPlayer = window.location.hash.includes("/mini");

  if (isLyricWindow) {
    return (
      <ConfigProvider theme={themeConfig} locale={zhCN}>
        <LyricWindow />
      </ConfigProvider>
    );
  }

  if (isMiniPlayer) {
    return (
      <ConfigProvider theme={themeConfig} locale={zhCN}>
        <MiniPlayer
          onRestore={() => {
            if (isTauri()) {
              invoke("show_main_window").catch(console.error);
            }
          }}
        />
      </ConfigProvider>
    );
  }

  // If no token, and not in login/source-manage, redirect (or show login routes)
  // We can handle this via Routes structure.

  const isAuthenticated = !!token;

  // 业务页面 Routes（普通模式与车机模式共用）
  const mainRoutes = (
    <Suspense fallback={<Skeleton active />}>
      <Routes>
        <Route path="/" element={<Navigate to="/recommended" replace />} />
        <Route path="/recommended" element={<Recommended />} />
        <Route path="/detail" element={<Detail />} />
        <Route path="/artist/:id" element={<ArtistDetail />} />
        <Route path="/category" element={<Category />} />
        <Route path="/mvs" element={<Mvs />} />
        <Route path="/mv" element={<MvDetail />} />
        <Route path="/mv/:id" element={<MvDetail />} />
        <Route path="/collections" element={<Collections />} />
        <Route path="/collection/:id" element={<CollectionDetail />} />
        <Route path="/songs" element={<Songs />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/listened" element={<Listened />} />
        <Route path="/artists" element={<ArtistList />} />
        <Route path="/playlist/:id" element={<PlaylistDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/folders" element={<Folder />} />
        <Route path="/folder/:id" element={<Folder />} />
        <Route path="/downloads" element={<Downloads />} />
        <Route path="/admin/users" element={<UserManagement />} />
        <Route path="/tts/tasks" element={<TaskList />} />
        <Route path="/tts/create" element={<CreateTask />} />
        <Route path="/product-updates" element={<ProductUpdates />} />
        <Route path="/task-center" element={<TaskCenter />} />
      </Routes>
    </Suspense>
  );

  return (
    <ConfigProvider theme={themeConfig} locale={zhCN}>
      <RootWrapper mode={mode}>
        {contextHolder}
        <MessageProvider messageApi={messageApi}>
          <Suspense fallback={<Skeleton active />}>
            <Routes>
              <Route path="/member-login" element={<MemberLogin />} />

              <>
                <Route path="/source-manage" element={<SourceManage />} />
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/member-benefits" element={<MemberBenefits />} />
                <Route path="/member-detail" element={<MemberDetail />} />

                {isAuthenticated ? (
                  <Route
                    path="/*"
                    element={
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          height: "100vh",
                          width: "100vw",
                          backgroundColor: "transparent",
                        }}
                      >
                        {carModeEnabled ? (
                          <CarMode seekBridge={carModeSeekBridgeRef.current}>
                            <div
                              style={{
                                display: "flex",
                                flex: 1,
                                minWidth: 0,
                                overflow: "hidden",
                              }}
                            >
                              <Sidebar />
                              <div
                                style={{
                                  flex: 1,
                                  display: "flex",
                                  flexDirection: "column",
                                  overflow: "hidden",
                                }}
                              >
                                <Header />
                                {mainRoutes}
                              </div>
                            </div>
                          </CarMode>
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              flex: 1,
                              overflow: "hidden",
                            }}
                          >
                            <Sidebar />
                            <div
                              style={{
                                flex: 1,
                                display: "flex",
                                flexDirection: "column",
                                overflow: "hidden",
                              }}
                            >
                              <Header />
                              {mainRoutes}
                            </div>
                          </div>
                        )}

                        <Player
                          hideMiniPlayer={carModeEnabled}
                          seekBridge={
                            carModeEnabled
                              ? carModeSeekBridgeRef.current
                              : undefined
                          }
                        />
                        <UpdateModal
                          visible={!!updateInfo}
                          updateInfo={updateInfo}
                          onCancel={cancelUpdate}
                        />
                        <PromotionModal
                          visible={!!promotion}
                          promotion={promotion}
                          onClose={dismissPromotion}
                          onIgnore={ignorePromotion}
                        />
                        <InviteListener />
                      </div>
                    }
                  />
                ) : (
                  <Route
                    path="*"
                    element={<Navigate to="/source-manage" replace />}
                  />
                )}
              </>
            </Routes>
          </Suspense>
        </MessageProvider>
      </RootWrapper>
    </ConfigProvider>
  );
};

// ... existing imports

const Mvs = lazy(() => import("./pages/Mvs"));
const MvDetail = lazy(() => import("./pages/MvDetail"));

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
