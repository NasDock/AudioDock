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
import LyricWindow from "./pages/LyricWindow";
import Recommended from "./pages/Recommended";

const ArtistDetail = lazy(() => import("./pages/ArtistDetail"));
const ArtistList = lazy(() => import("./pages/ArtistList"));
const Category = lazy(() => import("./pages/Category"));
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
const ProductUpdates = lazy(() => import("./pages/ProductUpdates/index"));

import { theme } from "antd";
import { useEffect } from "react";
import InviteListener from "./components/InviteListener";
import MiniPlayer from "./components/MiniPlayer";
import UpdateModal from "./components/UpdateModal";
import { useCheckUpdate } from "./hooks/useCheckUpdate";
import { socketService } from "./services/socket";
import { useAuthStore } from "./store/auth";
import { useSettingsStore, type SettingsState } from "./store/settings";

// Wrapper to provide consistent background and color based on theme tokens
const RootWrapper = ({ children, mode }: { children: React.ReactNode; mode: string }) => {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        backgroundColor: mode === "dark" ? "#000" : token.colorBgLayout,
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
  const themeConfig = getThemeConfig(mode);
  const [messageApi, contextHolder] = message.useMessage();
  const { token, user } = useAuthStore();

  const { checkUpdate, updateInfo, cancelUpdate } = useCheckUpdate();

  useEffect(() => {
    // Check update on startup
    const timer = setTimeout(() => {
      checkUpdate();
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (token && user) {
      socketService.connect();
    } else {
      socketService.disconnect();
    }
  }, [token, user]);

  // Sync settings on startup
  const settings = useSettingsStore((state: SettingsState) => state);
  const { autoLaunch, minimizeToTray } = settings.general;

  useEffect(() => {
    if ((window as any).ipcRenderer) {
      (window as any).ipcRenderer.invoke("set-auto-launch", autoLaunch);
      (window as any).ipcRenderer.send(
        "settings:update-minimize-to-tray",
        minimizeToTray,
      );
      (window as any).ipcRenderer.send(
        "settings:update-download-path",
        settings.download.downloadPath,
      );

      const handlePositionUpdate = (
        _event: any,
        pos: { x: number; y: number },
      ) => {
        useSettingsStore.getState().updateDesktopLyric("x", pos.x);
        useSettingsStore.getState().updateDesktopLyric("y", pos.y);
      };

      (window as any).ipcRenderer.on(
        "lyric:position-updated",
        handlePositionUpdate,
      );
      return () => {
        (window as any).ipcRenderer.off(
          "lyric:position-updated",
          handlePositionUpdate,
        );
      };
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
            if ((window as any).ipcRenderer) {
              (window as any).ipcRenderer.send("window:restore-main");
            }
          }}
        />
      </ConfigProvider>
    );
  }

  // If no token, and not in login/source-manage, redirect (or show login routes)
  // We can handle this via Routes structure.

  const isAuthenticated = !!token;

  return (
    <ConfigProvider theme={themeConfig} locale={zhCN}>
      <RootWrapper mode={mode}>
        {contextHolder}
        <MessageProvider messageApi={messageApi}>
          <Suspense fallback={<Skeleton active />}>
            <Routes>
              <Route path="/source-manage" element={<SourceManage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />

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
                        // Inner layout can keep its own background logic if needed for glass effect
                        backgroundColor: "transparent",
                      }}
                    >
                      <div
                        style={{ display: "flex", flex: 1, overflow: "hidden" }}
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
                          <Suspense fallback={<Skeleton active />}>
                            <Routes>
                              <Route
                                path="/"
                                element={<Navigate to="/recommended" replace />}
                              />
                              <Route
                                path="/recommended"
                                element={<Recommended />}
                              />
                              <Route path="/detail" element={<Detail />} />
                              <Route
                                path="/artist/:id"
                                element={<ArtistDetail />}
                              />
                              <Route path="/category" element={<Category />} />
                              <Route path="/songs" element={<Songs />} />
                              <Route
                                path="/favorites"
                                element={<Favorites />}
                              />
                              <Route path="/listened" element={<Listened />} />
                              <Route path="/artists" element={<ArtistList />} />
                              <Route
                                path="/playlist/:id"
                                element={<PlaylistDetail />}
                              />
                              <Route path="/settings" element={<Settings />} />
                              <Route path="/folders" element={<Folder />} />
                              <Route path="/folder/:id" element={<Folder />} />
                              <Route
                                path="/downloads"
                                element={<Downloads />}
                              />
                              <Route
                                path="/admin/users"
                                element={<UserManagement />}
                              />
                              <Route
                                path="/product-updates"
                                element={<ProductUpdates />}
                              />
                            </Routes>
                          </Suspense>
                        </div>
                      </div>

                      <Player />
                      <UpdateModal
                        visible={!!updateInfo}
                        updateInfo={updateInfo}
                        onCancel={cancelUpdate}
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
            </Routes>
          </Suspense>
        </MessageProvider>
      </RootWrapper>
    </ConfigProvider>
  );
};

// ... existing imports

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
