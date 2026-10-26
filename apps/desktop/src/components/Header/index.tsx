import {
  AppstoreOutlined,
  AudioOutlined,
  // BorderOutlined, // 已随 winControls 迁移到 TitleBar
  // CloseOutlined, // 已随 winControls 迁移到 TitleBar
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
  // MinusOutlined, // 已随 winControls 迁移到 TitleBar
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
  UnorderedListOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import {
  addSearchRecord,
  check,
  clearSearchHistory,
  createCompactTask,
  createImportTask,
  getCurrentUser,
  getHotSearches,
  getImportTask,
  getRunningImportTask,
  getSearchHistory,
  hasActiveTasks,
  plusDeleteMe,
  plusGetMe,
  plusParticipateInternalTest,
  searchAll,
  setPlusToken as setPlusServiceToken,
  setServiceConfig,
  SOURCEMAP,
  speechToText,
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
  Typography,
} from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useMessage } from "../../context/MessageContext";
import { useTheme } from "../../context/ThemeContext";
import { TrackType } from "../../models";
import { trackEvent } from "../../services/tracking";
import { resolveArtworkUri } from "../../services/trackResolver";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { useSettingsStore } from "../../store/settings";
import { isEmbySource, isSubsonicSource } from "../../utils";
// isWindows/tauriMinimizeWindow/tauriMaximizeWindow/tauriCloseWindow 已随 winControls 迁移到 TitleBar
import { isTauri, isWeb, tauriOpenExternal } from "../../utils/platform";
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
  const { t } = useTranslation();
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
            name: `${t("header.historyRecord")} ${index + 1}`,
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
          : item,
      ),
    );
  };

  const handleConnect = async (
    address: string,
    configId: string,
    sourceType: string,
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
            const displayName = `${type}${t("header.dataSource")}[${index + 1}]`;

            const renderAddressRow = (label: string, address: string) => {
              if (!address) return null;
              const isActive = isSourceMatch && currentAddress === address;
              const isConnecting =
                loadingId === `${type}_${item.id}_${address}`;

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
                        ● {t("header.connected")}
                      </Text>
                    ) : (
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConnect(address, item.id, type);
                        }}
                        style={{ fontSize: 10 }}
                      >
                        {t("header.connect")}
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
                    {renderAddressRow(
                      t("header.internalAddress"),
                      item.internal,
                    )}
                    {renderAddressRow(
                      t("header.externalAddress"),
                      item.external,
                    )}
                  </Flex>
                </Flex>
              </Card>
            );
          }),
        )}

        {configs.every((item) => item.list.length === 0) && (
          <Empty
            description={t("header.noHistoryData")}
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
          {t("header.addDataSource")}
        </Button>
      </Flex>
    </div>
  );
};

const getAvatarUrl = (path?: string | null, fallbackSeed?: string) => {
  const dicebear = `https://api.dicebear.com/7.x/avataaars/svg?seed=${fallbackSeed || "Felix"}`;
  if (!path) {
    return dicebear;
  }
  // 头像恒走缩略图档（128 ≤ THUMBNAIL_MAX_WIDTH），不区分内外网。
  // http(s) 外链、/music/ 等非 /covers/ 路径由 resolveArtworkUri 原样返回。
  return resolveArtworkUri(path, { width: 128 }) || dicebear;
};

const Header: React.FC = () => {
  const message = useMessage();
  const navigate = useNavigate();
  const location = useLocation();
  const { themeSetting, toggleTheme } = useTheme();
  const { token } = theme.useToken();
  const { t } = useTranslation();
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
  const searchInputRef = useRef<any>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [hotSearches, setHotSearches] = useState<
    { keyword: string; count: number }[]
  >([]);

  // ASR Recording state
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Mode state: 'music' | 'audiobook'
  const { mode: playMode, setMode: setPlayMode } = usePlayMode();
  const isRadioMode = usePlayerStore((state) => state.isRadioMode);
  const { logout, user, device, setPlusToken: setMemberToken } = useAuthStore();

  // Import task state
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importTask, setImportTask] = useState<ImportTask | null>(null);
  const [isPlusVip, setIsPlusVip] = useState(false);
  const [, setPlusVipData] = useState<any>(null);
  const [redeemingInternalTestCode, setRedeemingInternalTestCode] =
    useState(false);
  // 任务中心入口显隐：仅当存在进行中任务时显示
  const [showTaskCenterEntry, setShowTaskCenterEntry] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const active = await hasActiveTasks();
        console.log("Checked active tasks:", active);
        if (!cancelled) setShowTaskCenterEntry(active);
      } catch (e) {
        /* 忽略：网络异常时不改变入口状态 */
        console.warn("Failed to check active tasks", e);
      }
    };
    check();
    const timer = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const refreshCurrentUser = async () => {
      if (!user) return;
      try {
        const res = await getCurrentUser();
        if (res.code !== 200 || !res.data) return;
        const serverAddress =
          localStorage.getItem("serverAddress") || "http://localhost:3000";
        localStorage.setItem(`user_${serverAddress}`, JSON.stringify(res.data));
        useAuthStore.setState({ user: res.data as any });
      } catch (error) {
        console.warn("Failed to refresh current user", error);
      }
    };

    void refreshCurrentUser();
  }, [user?.id]);

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
      message.error(t("header.clearHistoryFailed"));
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

  // antd 的 css-dev-only-* 类会给内层 <input> 单独设 color 覆盖外层 style，
  // 这里直接通过 ref 把 token.colorText 写到 input 元素上，inline style 永远胜出。
  useEffect(() => {
    const inner: HTMLInputElement | undefined =
      searchInputRef.current?.input ?? searchInputRef.current;
    if (inner && inner.tagName === "INPUT") {
      inner.style.color = token.colorText;
    }
  }, [token.colorText]);

  const handleLogout = () => {
    logout();
    message.success(t("header.logoutSuccess"));
    // Optionally reload to reset app state
    window.location.reload();
  };

  const handleDeleteMemberAccount = () => {
    const plusToken = localStorage.getItem("plus_token");
    if (!plusToken) {
      message.warning(t("header.pleaseLoginMemberFirst"));
      navigate("/member-login");
      return;
    }

    modal.confirm({
      title: t("header.cancelMembership"),
      content: t("header.confirmCancelMembership"),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await plusDeleteMe();
          if (res.data?.code !== 200 || !res.data?.data?.ok) {
            throw new Error(
              res.data?.message || t("header.cancelMembershipFailed"),
            );
          }

          setMemberToken(null);
          message.success(t("header.membershipCancelled"));
          navigate("/member-login", { replace: true });
        } catch (error) {
          console.error("Failed to delete plus member account:", error);
          message.error(
            error instanceof Error
              ? error.message
              : t("header.cancelMembershipFailedRetry"),
          );
        }
      },
    });
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

  const iconStyle = { color: "var(--ad-header-text, " + token.colorTextSecondary + ")" };
  const actionIconStyle = { color: "var(--ad-header-text, " + token.colorText + ")" };

  const handleUpdateLibrary = async (
    mode: "incremental" | "full" | "compact",
  ) => {
    message.loading(
      mode === "incremental"
        ? t("header.incremental") + t("header.taskCreating")
        : mode === "full"
          ? t("header.full") + t("header.taskCreating")
          : t("header.compact") + t("header.taskCreating"),
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
          message:
            mode === "compact"
              ? t("header.initializingCompact")
              : t("header.initializing"),
        });

        // Clear previous timer if any
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);

        pollTimerRef.current = setInterval(() => {
          pollTaskStatus(taskId);
        }, 1000);
      } else {
        message.error(res.message || t("header.taskCreateFailed"));
      }
    } catch (error) {
      console.error("Task creation error:", error);
      message.error(t("header.createTaskFailed"));
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
            message.success(t("header.compactComplete"));
          } else {
            message.success(t("header.importSuccess", { count: total }));
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
  const handleToggleRecord = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, {
            type: "audio/webm",
          });
          stream.getTracks().forEach((track) => track.stop());

          try {
            message.loading({
              content: t("header.recognizing", "正在识别..."),
              key: "asr",
            });

            const file = new File([audioBlob], "record.webm", {
              type: "audio/webm",
            });
            const text = await speechToText(file);

            if (text) {
              message.success({
                content: t("header.recognizeSuccess", "识别成功"),
                key: "asr",
              });
              setSearchKeyword(text);
              performSearch(text);
            } else {
              message.error({
                content: t("header.recognizeFailed", "识别失败"),
                key: "asr",
              });
            }
          } catch (error) {
            console.error("ASR error:", error);
            message.error({
              content: t("header.recognizeError", "识别发生错误"),
              key: "asr",
            });
          }
        };

        mediaRecorder.start();
        setIsRecording(true);
      } catch (error) {
        console.error("Microphone access denied:", error);
        message.error(t("header.micAccessDenied", "无法访问麦克风"));
      }
    }
  };

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
        message.error(t("header.loginExpired"));
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
      setPlusServiceToken(plusToken);
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

  const handleRedeemInternalTestCode = async () => {
    if (isPlusVip) {
      message.info(t("header.alreadyHasBetaAccess"));
      return;
    }

    const plusUserId = localStorage.getItem("plus_user_id");
    if (!plusUserId) {
      message.error(t("header.pleaseLoginMemberFirstBeta"));
      return;
    }

    try {
      setRedeemingInternalTestCode(true);
      trackEvent({
        feature: "member",
        eventName: "internal_test_participate_submit",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
      });
      const vipStartsAt = new Date();
      const vipEndsAt = new Date(vipStartsAt);
      vipEndsAt.setMonth(vipEndsAt.getMonth() + 1);
      const res = await plusParticipateInternalTest({
        vipStartsAt: vipStartsAt.toISOString(),
        vipEndsAt: vipEndsAt.toISOString(),
      });
      const payload = res.data?.data;

      if (res.data?.code !== 200 || !payload?.ok) {
        throw new Error(
          res.data?.message || t("header.participateInternalTestFailed"),
        );
      }

      localStorage.setItem("plus_vip_status", "true");
      localStorage.setItem(
        "plus_vip_data",
        JSON.stringify({
          ...payload,
          vipExpiresAt: payload.vipEndsAt,
        }),
      );
      localStorage.setItem("plus_vip_updated_at", Date.now().toString());
      setIsPlusVip(true);
      setPlusVipData(payload);
      trackEvent({
        feature: "member",
        eventName: "internal_test_participate_success",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
      });
      message.success(t("header.betaAccessGranted"));
    } catch (error) {
      console.error("Failed to redeem internal test code:", error);
      trackEvent({
        feature: "member",
        eventName: "internal_test_participate_failed",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
        metadata: {
          message: error instanceof Error ? error.message : "unknown_error",
        },
      });
      message.error(
        error instanceof Error ? error.message : t("common.operationFailed"),
      );
    } finally {
      setRedeemingInternalTestCode(false);
    }
  };

  return (
    <div className={`${styles.header}`} data-tauri-drag-region>
      {/* Navigation Controls */}
      <div className={styles.navControls} data-tauri-no-drag>
        <div className={styles.navGroup}>
          <Tooltip title={t("header.back")}>
            <LeftOutlined
              onClick={() => navigate(-1)}
              className={styles.navIcon}
              style={iconStyle}
            />
          </Tooltip>
          <Tooltip title={t("header.forward")}>
            <RightOutlined
              onClick={() => navigate(1)}
              className={styles.navIcon}
              style={iconStyle}
            />
          </Tooltip>
          <Tooltip title={t("header.refresh")}>
            <ReloadOutlined
              onClick={() => window.location.reload()}
              className={styles.navIcon}
              style={iconStyle}
            />
          </Tooltip>
        </div>
      </div>

      {/* Search Bar */}
      <div
        className={styles.searchBar}
        ref={searchContainerRef}
        style={{ display: "flex", alignItems: "center" }}
        data-tauri-no-drag
      >
        <Tooltip
          title={
            isRecording
              ? t("header.stopRecord", "停止录音")
              : t("header.startRecord", "语音搜索")
          }
        >
          <div
            onClick={handleToggleRecord}
            style={{
              padding: "0 8px",
              cursor: "pointer",
              color: isRecording ? token.colorError : token.colorTextSecondary,
            }}
          >
            <AudioOutlined style={{ fontSize: 16 }} />
          </div>
        </Tooltip>
        <Input
          ref={searchInputRef}
          prefix={
            <SearchOutlined style={{ color: token.colorTextSecondary }} />
          }
          placeholder={t("header.searchPlaceholder")}
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
      <div className={styles.userActions} data-tauri-no-drag>
        {playMode === TrackType.MUSIC &&
          !isSubsonicSource() &&
          !isEmbySource() && (
            <Tooltip title={t("header.scenarioRadio")}>
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
              onClick={() => {
                const plusToken = localStorage.getItem("plus_token");
                if (!plusToken) {
                  message.info(t("common.loginFirst"));
                  navigate("/member-login");
                  return;
                }

                if (!isPlusVip) {
                  message.info(t("common.vipOnly"));
                  navigate("/member-benefits");
                  return;
                }

                trackEvent({
                  feature: "tts",
                  eventName: "tts_task_list_open",
                  userId: user?.id ? String(user.id) : undefined,
                  deviceId: device?.id ? String(device.id) : undefined,
                });
                navigate("/tts/tasks");
              }}
            >
              <AppstoreOutlined />
            </div>
          </Tooltip>
        )}
        {!isSubsonicSource() && (
          <Tooltip
            title={
              playMode === TrackType.MUSIC
                ? t("header.switchToAudiobookMode")
                : t("header.switchToMusicMode")
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
          <Tooltip title={t("header.miniPlayer")}>
            <ImportOutlined
              className={styles.actionIcon}
              style={actionIconStyle}
              onClick={() => {
                if (isTauri()) {
                  invoke("create_mini_window").catch(console.error);
                }
              }}
            />
          </Tooltip>
        )}

        {!isSubsonicSource() && (
          <Tooltip title={t("header.folder")}>
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

        <Tooltip title={t("header.switchServer")}>
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
                message.success(t("header.switchedTo", { type, url }));
                window.location.reload();
              };

              modal.confirm({
                title: t("header.switchServer"),
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
              ? t("header.switchToLightMode")
              : themeSetting === "light"
                ? t("header.switchToSystem")
                : t("header.switchToDarkMode")
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
        <Tooltip title={t("header.memberService")}>
          <div
            className={styles.actionIcon}
            style={{ ...actionIconStyle }}
            onClick={(e) => {
              e.stopPropagation();
              const plusToken = localStorage.getItem("plus_token");
              if (plusToken) {
                if (isPlusVip) {
                  navigate("/member-detail");
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
        {showTaskCenterEntry && (
          <Tooltip title={t("header.taskCenter")}>
            <div
              className={styles.actionIcon}
              style={{ ...actionIconStyle }}
              onClick={(e) => {
                e.stopPropagation();
                navigate("/task-center");
              }}
            >
              <UnorderedListOutlined style={{ fontSize: 18 }} />
            </div>
          </Tooltip>
        )}
        <Popover
          content={
            <div className={styles.userMenu}>
              <div className={styles.userMenuItem}>
                {t("header.hi")}
                {user?.username || t("common.unknown")}
              </div>
              <div
                className={styles.userMenuItem}
                onClick={() => {
                  if (!redeemingInternalTestCode) {
                    void handleRedeemInternalTestCode();
                  }
                }}
              >
                <CrownOutlined />
                {isPlusVip
                  ? t("header.internalTestEnabled")
                  : redeemingInternalTestCode
                    ? t("header.internalTestApplying")
                    : t("header.internalTest")}
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
                          message.success(t("header.avatarChangeSuccess"));
                          // Updating user state is handled manually or via re-fetch
                          const url =
                            localStorage.getItem("serverAddress") ||
                            "http://localhost:3000";
                          const nextAvatar =
                            res.data?.avatar ||
                            (res.data?.user as any)?.avatar ||
                            user.avatar;
                          const updatedUser = {
                            ...user,
                            avatar: nextAvatar,
                          };
                          localStorage.setItem(
                            `user_${url}`,
                            JSON.stringify(updatedUser),
                          );
                          useAuthStore.setState({ user: updatedUser as any });
                        } else {
                          message.error(
                            res.message || t("header.avatarChangeFailed"),
                          );
                        }
                      } catch (err) {
                        message.error(t("header.uploadError"));
                      }
                    }
                  };
                  input.click();
                }}
              >
                <PlusOutlined />
                {t("header.changeAvatar")}
              </div>
              <div
                className={styles.userMenuItem}
                onClick={() => {
                  void tauriOpenExternal("https://github.com/mmdctjj/AudioDock");
                }}
              >
                <GithubOutlined />
                {t("header.giveStar")}
              </div>
              <div
                className={styles.userMenuItem}
                onClick={() => {
                  modal.confirm({
                    title: t("header.confirmIncrementalUpdate"),
                    content: t("header.incrementalUpdateContent"),
                    okText: t("header.confirmUpdate"),
                    cancelText: t("common.cancel"),
                    onOk: () => handleUpdateLibrary("incremental"),
                  });
                }}
              >
                <RollbackOutlined />
                {t("header.incrementalUpdate")}
              </div>
              <div
                className={styles.userMenuItem}
                onClick={() => {
                  modal.confirm({
                    title: t("header.confirmFullUpdate"),
                    content: t("header.fullUpdateContent"),
                    okText: t("header.confirmUpdate"),
                    cancelText: t("common.cancel"),
                    onOk: () => handleUpdateLibrary("full"),
                  });
                }}
              >
                <RetweetOutlined />
                {t("header.fullUpdate")}
              </div>
              <div
                className={styles.userMenuItem}
                onClick={() => {
                  modal.confirm({
                    title: t("header.confirmCompactData"),
                    content: t("header.compactDataContent"),
                    okText: t("header.confirmCompact"),
                    cancelText: t("common.cancel"),
                    onOk: () => handleUpdateLibrary("compact"),
                  });
                }}
              >
                <DeleteOutlined />
                {t("header.compactData")}
              </div>

              <div
                className={styles.userMenuItem}
                onClick={() => {
                  modal.confirm({
                    title: t("header.clearCache"),
                    content: t("settings.confirmClearCache", { label: "" }),
                    okText: t("common.confirm"),
                    cancelText: t("common.cancel"),
                    onOk: async () => {
                      try {
                        if (isTauri()) {
                          await invoke("cache_clear", {
                            downloadPath:
                              useSettingsStore.getState().download.downloadPath,
                          });
                        }
                        const PRESERVED_KEYS = new Set([
                          "serverAddress",
                          "selectedSourceType",
                          "plus_token",
                          "plus_user_id",
                          "plus_vip_status",
                          "plus_vip_data",
                          "plus_vip_updated_at",
                          "userId",
                          "i18nextLng",
                        ]);
                        const keysToPreserve: Record<string, string> = {};
                        for (let i = 0; i < localStorage.length; i++) {
                          const key = localStorage.key(i);
                          if (key && PRESERVED_KEYS.has(key)) {
                            keysToPreserve[key] =
                              localStorage.getItem(key) || "";
                          }
                        }
                        localStorage.clear();
                        for (const [key, value] of Object.entries(
                          keysToPreserve,
                        )) {
                          localStorage.setItem(key, value);
                        }
                        message.success(t("settings.cacheCleared"));
                      } catch (error) {
                        console.warn("Failed to clear cache", error);
                        message.error(t("common.error"));
                      }
                    },
                  });
                }}
              >
                <DeleteOutlined />
                {t("header.clearCache")}
              </div>

              <div
                className={styles.userMenuItem}
                onClick={() => navigate("/product-updates")}
              >
                <ReadOutlined className={styles.actionIcon} />
                {t("header.productUpdates")}
              </div>
              <div
                className={styles.userMenuItem}
                onClick={() => navigate("/settings")}
              >
                <SettingOutlined className={styles.actionIcon} />
                {t("common.settings")}
              </div>
              <div className={styles.userMenuItem} onClick={handleLogout}>
                <LogoutOutlined />
                {t("header.logout")}
              </div>
              <div
                className={styles.userMenuItem}
                onClick={handleDeleteMemberAccount}
                style={{ color: "#ff4d4f" }}
              >
                <DeleteOutlined />
                {t("header.cancelMembership")}
              </div>
            </div>
          }
        >
          <Flex gap={12} align="center">
            <div className={styles.avatar}>
              <img
                src={getAvatarUrl(user?.avatar, user?.username || "Felix")}
                alt="avatar"
              />
            </div>
          </Flex>
        </Popover>
        {/* 窗口控制按钮已迁移到 Header 上方的 TitleBar 组件（components/TitleBar），此处注释保留以便恢复
        {isWindows() && (
          <Flex className={styles.winControls}>
            <div
              className={styles.winControlBtn}
              onClick={() => { tauriMinimizeWindow(); }}
            >
              <MinusOutlined />
            </div>
            <div
              className={styles.winControlBtn}
              onClick={() => { tauriMaximizeWindow(); }}
            >
              <BorderOutlined />
            </div>
            <div
              className={`${styles.winControlBtn} ${styles.winCloseBtn}`}
              onClick={() => { tauriCloseWindow(); }}
            >
              <CloseOutlined />
            </div>
          </Flex>
        )}
        */}
      </div>
      {contextHolder}
      <Modal
        title={
          importTask?.mode === "compact"
            ? t("header.compactDataProgress")
            : t("header.importProgress")
        }
        open={isImportModalOpen}
        onCancel={() => {
          if (
            importTask?.status === TaskStatus.SUCCESS ||
            importTask?.status === TaskStatus.FAILED
          ) {
            setIsImportModalOpen(false);
          } else {
            message.info(t("header.taskRunningBackground"));
            setIsImportModalOpen(false);
          }
        }}
        footer={null}
        destroyOnClose
      >
        <div style={{ padding: "20px 0" }}>
          <div style={{ marginBottom: 16 }}>
            {t("header.status")}
            {importTask?.message &&
            importTask.status !== TaskStatus.FAILED &&
            importTask.status !== TaskStatus.SUCCESS
              ? importTask.message
              : importTask?.status === TaskStatus.INITIALIZING
                ? importTask?.mode === "compact"
                  ? t("header.initializingCompact")
                  : t("header.initializing")
                : importTask?.status === TaskStatus.PREPARING
                  ? importTask?.mode === "compact"
                    ? t("header.compactingDb")
                    : t("header.preparingEnv")
                  : importTask?.status === TaskStatus.PARSING
                    ? t("header.parsing")
                    : importTask?.status === TaskStatus.SUCCESS
                      ? importTask?.mode === "compact"
                        ? t("header.compactComplete")
                        : t("header.importComplete")
                      : importTask?.status === TaskStatus.FAILED
                        ? importTask?.mode === "compact"
                          ? t("header.compactFailed")
                          : t("header.importFailed")
                        : t("header.preparingOrDefault")}
          </div>
          {importTask?.status === TaskStatus.FAILED && (
            <div style={{ color: token.colorError, marginBottom: 16 }}>
              {t("common.error")}: {importTask.message}
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
                  {t("header.localFileProgress")}
                </Text>
                <Text style={{ fontSize: 13 }}>
                  {importTask?.localCurrent || 0} /{" "}
                  {importTask?.localTotal || 0}
                </Text>
              </Flex>
              <Flex justify="space-between" align="center">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t("header.webdavFileProgress")}
                </Text>
                <Text style={{ fontSize: 13 }}>
                  {importTask?.webdavCurrent || 0} /{" "}
                  {importTask?.webdavTotal || 0}
                </Text>
              </Flex>
              <Flex justify="space-between" align="center">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t("header.mvFileProgress")}
                </Text>
                <Text style={{ fontSize: 13 }}>
                  {importTask?.mvCurrent || 0} / {importTask?.mvTotal || 0}
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
                  {t("header.totalProgress")}
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
              {t("header.processing")} {importTask.currentFileName}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default Header;
