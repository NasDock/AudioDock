import {
  AppstoreOutlined,
  CrownFilled,
  CrownOutlined,
  CustomerServiceOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  FolderOutlined,
  GithubOutlined,
  ImportOutlined,
  LeftOutlined,
  LogoutOutlined,
  MoonOutlined,
  PlusOutlined,
  ReadOutlined,
  ReloadOutlined,
  RetweetOutlined,
  RightOutlined,
  RollbackOutlined,
  SearchOutlined,
  SettingOutlined,
  SunOutlined,
  WifiOutlined
} from "@ant-design/icons";
import {
  addSearchRecord,
  check,
  clearSearchHistory,
  createCompactTask,
  createImportTask,
  getHotSearches,
  getImportTask,
  getRunningImportTask,
  getSearchHistory,
  plusGetMe,
  removePlusToken,
  searchAll,
  setPlusToken,
  setServiceConfig,
  SOURCEMAP,
  TaskStatus,
  uploadUserAvatar,
  useNativeAdapter,
  useSubsonicAdapter,
  type ImportTask,
  type SearchResults as SearchResultsType,
} from "@soundx/services";
import {
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Modal,
  Popover,
  Progress,
  Spin,
  Tag,
  theme,
  Tooltip,
  Typography
} from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMessage } from "../../context/MessageContext";
import { useTheme } from "../../context/ThemeContext";
import { TrackType } from "../../models";
import { trackEvent } from "../../services/tracking";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { isEmbySource, isSubsonicSource } from "../../utils";
import { isWeb, isWindows } from "../../utils/platform";
import { usePlayMode } from "../../utils/playMode";
import SearchResults from "../SearchResults";
import styles from "./index.module.less";

import emby from "../../assets/emby.png";
import logo from "../../assets/logo.png";
import subsonic from "../../assets/subsonic.png";

const { Text } = Typography;

const ServerSwitcherModal: React.FC<{
  onSelect: (url: string, type: string) => void;
}> = ({ onSelect }) => {
  const [configs, setConfigs] = useState<
    Array<{
      type: string;
      list: Array<{
        id: string;
        internal: string;
        external: string;
        name?: string;
      }>;
    }>
  >([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const { token: themeToken } = theme.useToken();
  const navigate = useNavigate();

  const loadConfigs = () => {
    const allConfigs: Array<{
      type: string;
      list: Array<{
        id: string;
        internal: string;
        external: string;
        name?: string;
      }>;
    }> = [];

    Object.keys(SOURCEMAP).forEach((type) => {
      const configKey = `sourceConfig_${type}`;
      const data = localStorage.getItem(configKey);
      if (data) {
        try {
          const parsed = JSON.parse(data);
          allConfigs.push({
            type,
            list: Array.isArray(parsed) ? parsed : [],
          });
          return;
        } catch {
          allConfigs.push({ type, list: [] });
          return;
        }
      }

      // Migration from legacy history if exists
      const historyKey = `serverHistory_${type}`;
      const historyData = localStorage.getItem(historyKey);
      if (historyData) {
        try {
          const history = JSON.parse(historyData);
          const migrated = history.map((h: any, index: number) => ({
            id: `migrated_${Date.now()}_${index}`,
            internal: h.value,
            external: "",
            name: `历史记录 ${index + 1}`,
          }));
          localStorage.setItem(configKey, JSON.stringify(migrated));
          allConfigs.push({ type, list: migrated });
          return;
        } catch {
          allConfigs.push({ type, list: [] });
          return;
        }
      }

      allConfigs.push({ type, list: [] });
    });

    setConfigs(allConfigs);
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  const handleDelete = (type: string, id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const configKey = `sourceConfig_${type}`;
    const currentTypeConfigs =
      configs.find((item) => item.type === type)?.list || [];
    const newConfigs = currentTypeConfigs.filter((c) => c.id !== id);
    localStorage.setItem(configKey, JSON.stringify(newConfigs));
    setConfigs((prev) =>
      prev.map((item) =>
        item.type === type
          ? {
              ...item,
              list: newConfigs,
            }
          : item
      )
    );
  };

  const handleConnect = async (
    address: string,
    configId: string,
    sourceType: string
  ) => {
    setLoadingId(`${sourceType}_${configId}_${address}`);
    try {
      // Connect to the specific address chosen by the user
      onSelect(address, sourceType);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <Flex
        vertical
        gap={12}
        style={{ maxHeight: 400, overflowY: "auto", padding: "4px" }}
      >
        {configs.flatMap(({ type, list }) =>
          list.map((item, index) => {
          const currentAddress = localStorage.getItem("serverAddress");
          const currentSource = localStorage.getItem("selectedSourceType");
          const isSourceMatch = currentSource === type;
          const sourceLogo =
            type === "Emby" ? emby : type === "Subsonic" ? subsonic : logo;
          const displayName = `${type}数据源[${index + 1}]`;

          const renderAddressRow = (label: string, address: string) => {
            if (!address) return null;
            const isActive = isSourceMatch && currentAddress === address;
            const isConnecting = loadingId === `${type}_${item.id}_${address}`;

            return (
              <Flex
                key={address}
                justify="space-between"
                align="center"
                style={{
                  padding: "6px 8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  backgroundColor: isActive
                    ? `${themeToken.colorPrimary}15`
                    : "transparent",
                  transition: "all 0.2s",
                }}
                className="address-row"
              >
                <Flex vertical gap={2} style={{ flex: 1 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {label}
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      color: isActive ? themeToken.colorPrimary : undefined,
                    }}
                  >
                    {address}
                  </Text>
                </Flex>
                <Flex align="center" gap={8}>
                  {isActive ? (
                    <Text type="success" style={{ fontSize: 10 }}>
                      ● 已连接
                    </Text>
                  ) : (
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleConnect(address, item.id, type);
                      }}
                      style={{ fontSize: 10 }}
                    >
                      连接
                    </Button>
                  )}
                  {isConnecting && <Spin size="small" />}
                </Flex>
              </Flex>
            );
          };

          return (
            <Card
              key={`${type}_${item.id}`}
              size="small"
              className={styles.switcherCard}
              style={{
                borderColor:
                  isSourceMatch &&
                  (currentAddress === item.internal ||
                    currentAddress === item.external)
                    ? themeToken.colorPrimary
                    : undefined,
              }}
            >
              <Flex vertical gap={8}>
                <Flex justify="space-between" align="center">
                  <Flex align="center" gap={8}>
                    <img style={{ width: 18 }} src={sourceLogo} alt={type} />
                    <Text strong style={{ fontSize: 14 }}>
                      {displayName}
                    </Text>
                    <Tag>{type}</Tag>
                  </Flex>
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(type, item.id, e);
                    }}
                  />
                </Flex>
                <Flex vertical gap={4}>
                  {renderAddressRow("内网地址", item.internal)}
                  {renderAddressRow("外网地址", item.external)}
                </Flex>
              </Flex>
            </Card>
          );
        })
        )}

        {configs.every((item) => item.list.length === 0) && (
          <Empty
            description="暂无历史数据源"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}

        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          style={{ marginTop: 8 }}
          onClick={() => {
            Modal.destroyAll();
            navigate("/source-manage");
          }}
        >
          添加数据源
        </Button>
      </Flex>
    </div>
  );
};

const Header: React.FC = () => {
  const message = useMessage();
  const navigate = useNavigate();
  const location = useLocation();
  const { themeSetting, toggleTheme } = useTheme();
  const { token } = theme.useToken();
  const pollTimerRef = useRef<number | null>(null);
  const [modal, contextHolder] = Modal.useModal();

  // Search state
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultsType | null>(
    null,
  );
  const [showResults, setShowResults] = useState(false);
  const searchTimerRef = useRef<number | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [hotSearches, setHotSearches] = useState<
    { keyword: string; count: number }[]
  >([]);

  // Mode state: 'music' | 'audiobook'
  const { mode: playMode, setMode: setPlayMode } = usePlayMode();
  const isRadioMode = usePlayerStore((state) => state.isRadioMode);
  const { logout, user, device } = useAuthStore();

  // Import task state
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importTask, setImportTask] = useState<ImportTask | null>(null);
  const [isPlusVip, setIsPlusVip] = useState(false);
  const [plusVipData, setPlusVipData] = useState<any>(null);

  const fetchSearchMeta = async () => {
    try {
      const [historyRes, hotRes] = await Promise.all([
        getSearchHistory(),
        getHotSearches(),
      ]);
      if (historyRes.code === 200) setSearchHistory(historyRes.data);
      if (hotRes.code === 200) setHotSearches(hotRes.data);
    } catch (e) {
      console.error("Failed to fetch search meta", e);
    }
  };

  const handleClearHistory = async () => {
    try {
      await clearSearchHistory();
      setSearchHistory([]);
    } catch (e) {
      message.error("清空历史失败");
    }
  };

  const handleSelectKeyword = (keyword: string) => {
    setSearchKeyword(keyword);
    performSearch(keyword);
  };

  const performSearch = async (value: string) => {
    try {
      const type = playMode;
      const results = await searchAll(value.trim(), type);
      setSearchResults(results);
      setShowResults(true);
      // Save record
      addSearchRecord(value.trim());
    } catch (error) {
      console.error("Search error:", error);
    }
  };

  const handleLogout = () => {
    logout();
    message.success("已退出/切换服务端账号");
    // Optionally reload to reset app state
    window.location.reload();
  };

  // ... inside component
  const togglePlayMode = () => {
    document.body.style.transition = "transform 0.25s ease";
    document.body.style.transform = "scaleX(-1)"; // 开启
    setTimeout(() => {
      // 1. Save current path for the current mode
      const currentPath = location.pathname + location.search + location.hash;
      localStorage.setItem(`route_history_${playMode}`, currentPath);

      // 2. Determine new mode
      const newMode =
        playMode === TrackType.MUSIC ? TrackType.AUDIOBOOK : TrackType.MUSIC;

      // 3. Restore path for the new mode
      const savedPath = localStorage.getItem(`route_history_${newMode}`);
      // Default to root if no history, or maybe we want specific defaults per mode
      const targetPath = savedPath || "/";

      navigate(targetPath);
      setPlayMode(newMode);

      document.body.style.transform = ""; // 关闭
    }, 250);

    // Reload to apply changes globally if needed, though usePlayMode handles reactivity
    // window.location.reload(); // Removed reload as we now have reactive state
  };

  const iconStyle = { color: token.colorTextSecondary };
  const actionIconStyle = { color: token.colorText };

  const handleUpdateLibrary = async (mode: "incremental" | "full" | "compact") => {
    message.loading(
      `${mode === "incremental" ? "增量" : mode === "full" ? "全量" : "精简"}任务创建中...`,
    );

    try {
      const res =
        mode === "compact"
          ? await createCompactTask()
          : await createImportTask({ mode });
      if (res.code === 200 && res.data) {
        const taskId = res.data.id;
        setIsImportModalOpen(true);
        setImportTask({
          id: taskId,
          status: TaskStatus.INITIALIZING,
          mode,
          message: mode === "compact" ? "正在启动精简任务..." : "正在初始化...",
        });

        // Clear previous timer if any
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);

        pollTimerRef.current = setInterval(() => {
          pollTaskStatus(taskId);
        }, 1000);
      } else {
        message.error(res.message || "任务创建失败");
      }
    } catch (error) {
      console.error("Task creation error:", error);
      message.error("创建任务失败，请检查网络或后端服务");
    }
  };

  const pollTaskStatus = async (taskId: string) => {
    try {
      const res = await getImportTask(taskId);
      if (res.code === 200 && res.data) {
        setImportTask(res.data);
        const { status, total } = res.data;
        if (status === TaskStatus.SUCCESS) {
          if (res.data.mode === "compact") {
            message.success("精简完成");
          } else {
            message.success(`导入成功！共导入 ${total} 首歌曲`);
          }
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          // Auto close modal after a short delay
          setTimeout(() => setIsImportModalOpen(false), 2000);
        } else if (status === TaskStatus.FAILED) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        }
      }
    } catch (error) {
      console.error("Poll error:", error);
      // Don't stop polling on transient network errors, but maybe limit retries?
      // For simplicity, we just log.
    }
  };

  // Search handlers
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchKeyword(value);

    if (!value.trim()) {
      setSearchResults(null);
    }
  };

  const handleCloseSearch = () => {
    setShowResults(false);
  };

  // Click outside to close search results
  useEffect(() => {
    check().then((res) => {
      if (res.code == 200) {
      } else if (res.code === 401) {
        message.error("登录信息已过期，请重新登录");
        logout();
      }
    });
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setShowResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (user) {
      // Check if there's a task running on server
      getRunningImportTask().then((taskRes) => {
        if (taskRes.code === 200 && taskRes.data) {
          const taskId = taskRes.data.id;
          setImportTask(taskRes.data);
          setIsImportModalOpen(true);

          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = setInterval(() => {
            pollTaskStatus(taskId);
          }, 1000);
        }
      });
    }
  }, [user]);

  // Fetch Plus VIP status
  useEffect(() => {
    const plusToken = localStorage.getItem("plus_token");
    const plusUserId = localStorage.getItem("plus_user_id");

    if (plusToken && plusUserId) {
      setPlusToken(plusToken);
      // Remove quotes from JSON.stringify if present (though it's better to use JSON.parse)
      let id = plusUserId;
      try {
        id = JSON.parse(plusUserId);
      } catch (e) {
        // fallback
      }

      plusGetMe(id)
        .then((res) => {
          if (res.data.code === 200 && res.data.data) {
            const vipTier = res.data.data.vipTier;
            setIsPlusVip(vipTier && vipTier !== "NONE");
            setPlusVipData(res.data.data);
          }
        })
        .catch((err) => {
          console.error("Failed to fetch plus profile", err);
        });
    }
  }, []);

  return (
    <div className={`${styles.header} ${isWindows() ? styles.winHeader : ""}`}>
      {/* Navigation Controls */}
      <div className={styles.navControls}>
        <div className={styles.navGroup}>
          <Tooltip title="后退">
            <LeftOutlined
              onClick={() => navigate(-1)}
              className={styles.navIcon}
              style={iconStyle}
            />
          </Tooltip>
          <Tooltip title="前进">
            <RightOutlined
              onClick={() => navigate(1)}
              className={styles.navIcon}
              style={iconStyle}
            />
          </Tooltip>
          <Tooltip title="刷新">
            <ReloadOutlined
              onClick={() => window.location.reload()}
              className={styles.navIcon}
              style={iconStyle}
            />
          </Tooltip>
        </div>
      </div>

      {/* Search Bar */}
      <div className={styles.searchBar} ref={searchContainerRef}>
        <Input
          prefix={
            <SearchOutlined style={{ color: token.colorTextSecondary }} />
          }
          placeholder="搜索单曲、艺术家、专辑"
          bordered={false}
          className={styles.searchInput}
          style={{ color: token.colorText }}
          value={searchKeyword}
          onChange={handleSearchChange}
          onPressEnter={() => {
            if (searchKeyword.trim()) {
              performSearch(searchKeyword.trim());
            }
          }}
          onFocus={() => {
            setShowResults(true);
            fetchSearchMeta();
          }}
        />
        {showResults && (
          <SearchResults
            results={searchResults}
            onClose={handleCloseSearch}
            history={searchHistory}
            hotSearches={hotSearches}
            onSelectKeyword={handleSelectKeyword}
            onClearHistory={handleClearHistory}
          />
        )}
      </div>

      {/* User Actions */}
      <div className={styles.userActions}>
        {playMode === TrackType.MUSIC && !isSubsonicSource() && !isEmbySource() && (
          <Tooltip title="情景电台">
            <div
              className={`${styles.actionIcon} ${isRadioMode ? styles.radioActive : ""}`}
              style={actionIconStyle}
              onClick={() => usePlayerStore.getState().startRadioMode()}
            >
              <WifiOutlined />
            </div>
          </Tooltip>
        )}
        {playMode !== TrackType.MUSIC && !isEmbySource() && (
          <Tooltip title="TTS">
            <div
              className={styles.actionIcon}
              style={actionIconStyle}
              onClick={() => navigate("/tts/tasks")}
            >
              <AppstoreOutlined />
            </div>
          </Tooltip>
        )}
        {!isSubsonicSource() && (
          <Tooltip
            title={
              playMode === TrackType.MUSIC
                ? "切换至有声书模式"
                : "切换至音乐模式"
            }
          >
            <div
              onClick={togglePlayMode}
              className={styles.actionIcon}
              style={actionIconStyle}
            >
              {playMode === TrackType.MUSIC ? (
                <CustomerServiceOutlined />
              ) : (
                <ReadOutlined />
              )}
            </div>
          </Tooltip>
        )}

        {!isWeb() && (
          <Tooltip title="mini播放器">
            <ImportOutlined
              className={styles.actionIcon}
              style={actionIconStyle}
              onClick={() => {
                if ((window as any).ipcRenderer) {
                  (window as any).ipcRenderer.send("window:set-mini");
                }
              }}
            />
          </Tooltip>
        )}

        {!isSubsonicSource() && (
          <Tooltip title="文件夹">
            <div
              className={styles.actionIcon}
              style={actionIconStyle}
              onClick={() => {
                trackEvent({
                  feature: "library",
                  eventName: "folder_mode_entry",
                  userId: user?.id ? String(user.id) : undefined,
                  deviceId: device?.id ? String(device.id) : undefined,
                });
                navigate(`/folders`);
              }}
            >
              <FolderOutlined />
            </div>
          </Tooltip>
        )}

        <Tooltip title="切换服务端">
          <div
            className={styles.actionIcon}
            style={actionIconStyle}
            onClick={() => {
              const handleSwitchServer = (url: string, type: string) => {
                const mappedType =
                  SOURCEMAP[type as keyof typeof SOURCEMAP] || "audiodock";

                // 1. Update localStorage
                localStorage.setItem("serverAddress", url);
                localStorage.setItem("selectedSourceType", type);
                localStorage.setItem(`serverAddress_${type}`, url);

                // 2. Load credentials if available
                const credsKey = `creds_${type}_${url}`;
                const savedCreds = localStorage.getItem(credsKey);
                let username = undefined;
                let password = undefined;
                if (savedCreds) {
                  const creds = JSON.parse(savedCreds);
                  username = creds.username;
                  password = creds.password;
                }

                // 3. Configure service and adapter
                setServiceConfig({
                  username,
                  password,
                  clientName: "SoundX Desktop",
                });

                if (mappedType === "subsonic") {
                  useSubsonicAdapter();
                } else {
                  useNativeAdapter();
                }

                // 4. Update auth store
                useAuthStore.getState().switchServer(url);

                // 5. Cleanup and reload
                Modal.destroyAll();
                message.success(`已切换至 ${type} 服务端: ${url}`);
                window.location.reload();
              };

              modal.confirm({
                title: "切换服务端",
                content: <ServerSwitcherModal onSelect={handleSwitchServer} />,
                footer: null,
                closable: true,
                width: 460,
              });
            }}
          >
            <DatabaseOutlined />
          </div>
        </Tooltip>
        <Tooltip
          title={
            themeSetting === "dark"
              ? "切换至亮色模式"
              : themeSetting === "light"
                ? "切换至跟随系统"
                : "切换至暗色模式"
          }
        >
          <div
            className={styles.actionIcon}
            style={actionIconStyle}
            onClick={toggleTheme}
          >
            {themeSetting === "dark" ? (
              <MoonOutlined />
            ) : themeSetting === "light" ? (
              <SunOutlined />
            ) : (
              <span style={{ fontSize: "10px", fontWeight: "bold" }}>Auto</span>
            )}
          </div>
        </Tooltip>
        <Tooltip title="会员服务">
          <div
            className={styles.actionIcon}
            style={{ ...actionIconStyle }}
            onClick={(e) => {
              e.stopPropagation();
              const plusToken = localStorage.getItem("plus_token");
              if (plusToken) {
                if (isPlusVip) {
                  modal.info({
                    title: "会员详情",
                    content: (
                      <div style={{ marginTop: 12 }}>
                        <Flex vertical gap={12}>
                          <Flex justify="space-between">
                            <Text type="secondary">会员等级</Text>
                            <Text strong style={{ color: "#FFD700" }}>
                              {plusVipData?.vipTier === "LIFETIME"
                                ? "永久会员"
                                : "年度会员"}
                            </Text>
                          </Flex>
                          <Flex justify="space-between">
                            <Text type="secondary">到期时间</Text>
                            <Text>
                              {plusVipData?.vipTier === "LIFETIME"
                                ? "永久有效"
                                : plusVipData?.vipExpiresAt
                                  ? new Date(
                                      plusVipData.vipExpiresAt,
                                    ).toLocaleDateString()
                                  : "未知"}
                            </Text>
                          </Flex>
                          <Button 
                            danger 
                            ghost 
                            size="small"
                            style={{ marginTop: 8 }}
                            onClick={() => {
                              modal.confirm({
                                title: "退出/切换会员账号",
                                content: "确定要退出/切换会员账号吗？",
                                okText: "确定",
                                cancelText: "取消",
                                onOk: () => {
                                  localStorage.removeItem("plus_token");
                                  localStorage.removeItem("plus_user_id");
                                  removePlusToken();
                                  setIsPlusVip(false);
                                  setPlusVipData(null);
                                  message.success("会员账号已退出/切换");
                                  navigate("/member-login");
                                }
                              });
                            }}
                          >
                            退出/切换会员账号
                          </Button>
                        </Flex>
                      </div>
                    ),
                    icon: <CrownFilled style={{ color: "#FFD700" }} />,
                    okText: "知道了",
                  });
                } else {
                  navigate("/member-benefits");
                }
              } else {
                navigate("/member-login");
              }
            }}
          >
            {isPlusVip ? (
              <CrownFilled style={{ fontSize: 18, color: "#FFD700" }} />
            ) : (
              <CrownOutlined style={{ fontSize: 18 }} />
            )}
          </div>
        </Tooltip>
        <Popover
          content={
            <div className={styles.userMenu}>
              <div className={styles.userMenuItem}>
                嗨！{user?.username || "未知"}
              </div>
              <div
                className={styles.userMenuItem}
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*";
                  input.onchange = async (e: any) => {
                    const file = e.target.files[0];
                    if (file && user?.id) {
                      try {
                        const res = await uploadUserAvatar(user.id, file);
                        if (res.code === 200) {
                          message.success("头像修改成功，可能需要重新登录以应用部分界面！");
                          // Updating user state is handled manually or via re-fetch
                          const url = localStorage.getItem("serverAddress") || "http://localhost:3000";
                          const updatedUser = { ...user, avatar: res.data.avatar };
                          localStorage.setItem(`user_${url}`, JSON.stringify(updatedUser));
                          useAuthStore.setState({ user: updatedUser as any });
                        } else {
                          message.error(res.message || "修改头像失败");
                        }
                      } catch (err) {
                        message.error("上传错误");
                      }
                    }
                  };
                  input.click();
                }}
              >
                <PlusOutlined />
                更换头像
              </div>
              <div
                className={styles.userMenuItem}
                onClick={() => {
                  if (window.ipcRenderer) {
                    window.ipcRenderer?.openExternal(
                      "https://github.com/mmdctjj/AudioDock",
                    );
                  } else {
                    window.open(
                      "https://github.com/mmdctjj/AudioDock",
                      "_blank",
                    );
                  }
                }}
              >
                <GithubOutlined />求 Star！！！
              </div>
              <div
                className={styles.userMenuItem}
                onClick={() => {
                  modal.confirm({
                    title: "确认增量更新？",
                    content: "增量更新只增加新数据，不删除旧数据",
                    okText: "确认更新",
                    cancelText: "取消",
                    onOk: () => handleUpdateLibrary("incremental"),
                  });
                }}
              >
                <RollbackOutlined />
                增量更新音频文件
              </div>
              <div
                className={styles.userMenuItem}
                onClick={() => {
                  modal.confirm({
                    title: "确认全量更新？",
                    content:
                      "全量更新将核对所有音频文件。您的播放历史、收藏记录、歌单由于文件指纹机制将得到保留。仅当文件在磁盘上被物理删除时，对应的记录才会被清除。",
                    okText: "确认更新",
                    cancelText: "取消",
                    onOk: () => handleUpdateLibrary("full"),
                  });
                }}
              >
                <RetweetOutlined />
                全量更新音频文件
              </div>
              <div
                className={styles.userMenuItem}
                onClick={() => {
                  modal.confirm({
                    title: "确认精简数据？",
                    content:
                      "将清除已标记为假死的数据，并核对数据库单曲路径。若文件不存在，将删除对应单曲及相关收藏/收听记录；若专辑无曲目会删除专辑；若艺术家无曲目和作品也会删除。",
                    okText: "确认精简",
                    cancelText: "取消",
                    onOk: () => handleUpdateLibrary("compact"),
                  });
                }}
              >
                <DeleteOutlined />
                精简数据
              </div>

              <div className={styles.userMenuItem}>
                <DeleteOutlined />
                清空缓存文件
              </div>

              <div
                className={styles.userMenuItem}
                onClick={() => navigate("/product-updates")}
              >
                <ReadOutlined className={styles.actionIcon} />
                产品动态
              </div>
              <div
                className={styles.userMenuItem}
                onClick={() => navigate("/settings")}
              >
                <SettingOutlined className={styles.actionIcon} />
                设置
              </div>
              <div className={styles.userMenuItem} onClick={handleLogout}>
                <LogoutOutlined />
                退出/切换服务端账号
              </div>
            </div>
          }
        >
          <Flex
            gap={12}
            align="center"
            style={{ paddingRight: isWindows() ? "140px" : "0" }}
          >
            <div className={styles.avatar}>
              <img
                src={
                  user?.avatar
                    ? `${localStorage.getItem("serverAddress")}${user.avatar}`
                    : `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.username || "Felix"}`
                }
                alt="avatar"
              />
            </div>
          </Flex>
        </Popover>
      </div>
      {contextHolder}
      <Modal
        title={importTask?.mode === "compact" ? "精简数据进度" : "数据入库进度"}
        open={isImportModalOpen}
        onCancel={() => {
          if (
            importTask?.status === TaskStatus.SUCCESS ||
            importTask?.status === TaskStatus.FAILED
          ) {
            setIsImportModalOpen(false);
          } else {
            message.info("任务正在后台运行...");
            setIsImportModalOpen(false);
          }
        }}
        footer={null}
        destroyOnClose
      >
        <div style={{ padding: "20px 0" }}>
          <div style={{ marginBottom: 16 }}>
            状态：
            {importTask?.message &&
            importTask.status !== TaskStatus.FAILED &&
            importTask.status !== TaskStatus.SUCCESS
              ? importTask.message
              : importTask?.status === TaskStatus.INITIALIZING
                ? importTask?.mode === "compact" ? "正在初始化精简任务..." : "正在初始化..."
                : importTask?.status === TaskStatus.PREPARING
                  ? importTask?.mode === "compact" ? "正在精简数据库..." : "正在准备环境..."
                : importTask?.status === TaskStatus.PARSING
                  ? "正在解析媒体文件..."
                  : importTask?.status === TaskStatus.SUCCESS
                    ? importTask?.mode === "compact" ? "精简完成" : "入库完成"
                    : importTask?.status === TaskStatus.FAILED
                      ? importTask?.mode === "compact" ? "精简失败" : "入库失败"
                      : "准备中"}
          </div>
          {importTask?.status === TaskStatus.FAILED && (
            <div style={{ color: token.colorError, marginBottom: 16 }}>
              错误：{importTask.message}
            </div>
          )}
          <Progress
            percent={
              importTask?.total
                ? Math.round(
                    ((importTask.current || 0) / importTask.total) * 100,
                  )
                : 0
            }
            status={
              importTask?.status === TaskStatus.FAILED
                ? "exception"
                : importTask?.status === TaskStatus.SUCCESS
                  ? "success"
                  : "active"
            }
          />
          {importTask?.mode !== "compact" && (
          <Flex vertical gap={4} style={{ marginTop: 12 }}>
            <Flex justify="space-between" align="center">
              <Text type="secondary" style={{ fontSize: 12 }}>
                本地文件入库进度
              </Text>
              <Text style={{ fontSize: 13 }}>
                {importTask?.localCurrent || 0} / {importTask?.localTotal || 0}
              </Text>
            </Flex>
            <Flex justify="space-between" align="center">
              <Text type="secondary" style={{ fontSize: 12 }}>
                WebDAV 文件入库进度
              </Text>
              <Text style={{ fontSize: 13 }}>
                {importTask?.webdavCurrent || 0} /{" "}
                {importTask?.webdavTotal || 0}
              </Text>
            </Flex>
            <Flex
              justify="space-between"
              align="center"
              style={{
                marginTop: 4,
                paddingTop: 4,
                borderTop: `1px dashed ${token.colorBorderSecondary}`,
              }}
            >
              <Text strong style={{ fontSize: 12 }}>
                总进度
              </Text>
              <Text strong style={{ fontSize: 13 }}>
                {importTask?.current || 0} / {importTask?.total || 0}
              </Text>
            </Flex>
          </Flex>
          )}
          {importTask?.mode !== "compact" && importTask?.currentFileName && (
            <div
              style={{
                marginTop: 12,
                fontSize: 12,
                color: token.colorTextTertiary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontStyle: "italic",
                padding: "4px 8px",
                backgroundColor: token.colorFillAlter,
                borderRadius: 4,
              }}
            >
              正在处理: {importTask.currentFileName}
            </div>
          )}
        </div>
      </Modal>

    </div>
  );
};

export default Header;
