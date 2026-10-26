import {
  AppstoreOutlined,
  AppstoreAddOutlined,
  AudioOutlined,
  CloudDownloadOutlined,
  CompassOutlined,
  CustomerServiceOutlined,
  HeartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SoundOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  VideoCameraOutlined
} from "@ant-design/icons";
import { createPlaylist, TrackType } from "@soundx/services";
import { Form, Input, Modal, Popover, theme, Tooltip, Typography } from "antd";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useMessage } from "../../context/MessageContext";
import { useAuthStore } from "../../store/auth";
import { usePlaylistStore } from "../../store/playlist";
import { isEmbySource, isSubsonicSource } from "../../utils";
import { isWeb } from "../../utils/platform";
import { usePlayMode } from "../../utils/playMode";
import styles from "./index.module.less";

const { Text, Title } = Typography;

const SIDEBAR_COLLAPSED_KEY = "audiodock_sidebar_collapsed";

const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const message = useMessage();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { playlists, fetchPlaylists } = usePlaylistStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  // 折叠状态持久化：折叠后仅显示图标，播放列表收进侧边弹窗
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
  );
  const [playlistOpen, setPlaylistOpen] = useState(false);

  const { mode } = usePlayMode();
  const { user } = useAuthStore();

  useEffect(() => {
    if (user?.id) {
      fetchPlaylists(mode, user.id);
    }
  }, [mode, user?.id]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  };

  const isActive = (path: string) => location.pathname === path;

  const handleCreatePlaylist = async () => {
    try {
      const values = await form.validateFields();
      if (!user?.id) return;
      setLoading(true);
      const res = await createPlaylist(values.name, mode, user.id);

      if (res.code === 200) {
        message.success(t("playlist.createSuccess"));
        setIsModalOpen(false);
        form.resetFields();
        fetchPlaylists(mode, user.id);
      } else {
        message.error(t("playlist.createFailed"));
      }
    } catch (error) {
      console.error("Create playlist error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}
      style={{ color: token.colorText, borderRightColor: token.colorBorder }}
      data-tauri-drag-region
    >
      <div
        className={`${styles.header} ${collapsed ? styles.headerCollapsed : ""}`}
        data-tauri-no-drag
      >
        {!collapsed && (
          <Title
            level={4}
            style={{ margin: 0, color: token.colorText, whiteSpace: "nowrap" }}
          >
            AudioDock
          </Title>
        )}
        <Tooltip
          title={collapsed ? t("nav.expand") : t("nav.collapse")}
          placement="right"
        >
          <div
            className={styles.collapseBtn}
            style={{ color: token.colorTextSecondary }}
            onClick={toggleCollapsed}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </div>
        </Tooltip>
      </div>

      <div className={styles.menuGroup} data-tauri-no-drag>
        <MenuItem
          icon={<CompassOutlined />}
          text={t("nav.recommended")}
          onClick={() => navigate("/recommended")}
          active={isActive("/recommended")}
          collapsed={collapsed}
        />
        <MenuItem
          icon={<AppstoreOutlined />}
          text={t("nav.albums")}
          onClick={() => navigate("/category")}
          active={isActive("/category")}
          collapsed={collapsed}
        />
        {mode === TrackType.AUDIOBOOK && (
          <MenuItem
            icon={<AppstoreAddOutlined />}
            text={t("nav.collections")}
            onClick={() => navigate("/collections")}
            active={isActive("/collections")}
            collapsed={collapsed}
          />
        )}
        <MenuItem
          icon={<TeamOutlined />}
          text={t("nav.artists")}
          onClick={() => navigate("/artists")}
          active={isActive("/artists")}
          collapsed={collapsed}
        />
        {
          mode === TrackType.MUSIC && (
            <>
              <MenuItem
                icon={<AudioOutlined />}
                text={t("nav.tracks")}
                onClick={() => navigate("/songs")}
                active={isActive("/songs")}
                collapsed={collapsed}
              />
              <MenuItem
                icon={<VideoCameraOutlined />}
                text="MV"
                onClick={() => navigate("/mvs")}
                active={isActive("/mvs")}
                collapsed={collapsed}
              />
            </>
          )
        }
      </div>

      {collapsed ? (
        /* 折叠态：整个播放列表模块（下载/收藏/听过/歌单）收进侧边弹窗，仅保留一个入口图标 */
        <div className={styles.menuGroup} data-tauri-no-drag>
          <Popover
            open={playlistOpen}
            onOpenChange={setPlaylistOpen}
            trigger="click"
            placement="rightTop"
            arrow={false}
            content={
              <div className={styles.playlistPopup} data-tauri-no-drag>
                {/* 快捷入口：下载 / 收藏 / 听过 */}
                <div className={styles.playlistPopupQuick}>
                  {!isWeb() && (
                    <PopupQuickItem
                      icon={<CloudDownloadOutlined />}
                      text={t("nav.downloads")}
                      active={isActive("/downloads")}
                      onClick={() => {
                        setPlaylistOpen(false);
                        navigate("/downloads");
                      }}
                    />
                  )}
                  <PopupQuickItem
                    icon={<HeartOutlined />}
                    text={t("nav.favorites")}
                    active={isActive("/favorites")}
                    onClick={() => {
                      setPlaylistOpen(false);
                      navigate("/favorites");
                    }}
                  />
                  {!isSubsonicSource() && !isEmbySource() && (
                    <PopupQuickItem
                      icon={<SoundOutlined />}
                      text={t("nav.listened")}
                      active={isActive("/listened")}
                      onClick={() => {
                        setPlaylistOpen(false);
                        navigate("/listened");
                      }}
                    />
                  )}
                </div>
                <div className={styles.playlistPopupDivider} />
                <div className={styles.playlistPopupHeader}>
                  <Text strong>{t("nav.playlists")}</Text>
                  <Tooltip title={t("nav.addPlaylist")}>
                    <PlusOutlined
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        setPlaylistOpen(false);
                        setIsModalOpen(true);
                      }}
                    />
                  </Tooltip>
                </div>
                <div className={styles.playlistPopupList}>
                  {playlists.map((playlist) => (
                    <div
                      key={playlist.id}
                      className={styles.playlistPopupItem}
                      onClick={() => {
                        setPlaylistOpen(false);
                        navigate(`/playlist/${playlist.id}`);
                      }}
                    >
                      <Text style={{ color: "inherit" }} ellipsis>
                        {playlist.name}
                      </Text>
                    </div>
                  ))}
                </div>
              </div>
            }
          >
            <div>
              <Tooltip
                title={t("nav.playlists")}
                placement="right"
                open={playlistOpen ? false : undefined}
              >
                <div
                  className={`${styles.menuItem} ${styles.collapsedItem}`}
                  style={{ color: token.colorTextSecondary }}
                >
                  <span style={{ fontSize: "20px" }}>
                    <UnorderedListOutlined />
                  </span>
                </div>
              </Tooltip>
            </div>
          </Popover>
        </div>
      ) : (
        <>
          <div className={styles.playlistHeader} data-tauri-no-drag>
            <Title level={5} style={{ margin: 0, color: token.colorText }}>
              {t("nav.playlists")}
            </Title>
            <CustomerServiceOutlined style={{ color: token.colorTextSecondary }} />
          </div>

          <div className={styles.playlistGroup} data-tauri-no-drag>
            {!isWeb() && (
              <MenuItem
                icon={<CloudDownloadOutlined />}
                text={t("nav.downloads")}
                onClick={() => navigate("/downloads")}
                active={isActive("/downloads")}
              />
            )}
            <MenuItem
              icon={<HeartOutlined />}
              text={t("nav.favorites")}
              onClick={() => navigate("/favorites")}
              active={isActive("/favorites")}
            />
            {!isSubsonicSource() && !isEmbySource() && (
              <MenuItem
                icon={<SoundOutlined />}
                text={t("nav.listened")}
                onClick={() => navigate("/listened")}
                active={isActive("/listened")}
              />
            )}

            {/* Dynamic Playlists */}
            {playlists.map((playlist) => (
              <MenuItem
                key={playlist.id}
                icon={<></>}
                text={playlist.name}
                onClick={() => navigate(`/playlist/${playlist.id}`)}
                active={isActive(`/playlist/${playlist.id}`)}
              />
            ))}

            <div
              className={styles.addPlaylist}
              style={{ color: token.colorTextSecondary, cursor: "pointer" }}
              onClick={() => setIsModalOpen(true)}
            >
              <div
                className={styles.addIcon}
                style={{ backgroundColor: token.colorFillTertiary }}
              >
                <PlusOutlined style={{ fontSize: "14px" }} />
              </div>
              <Text style={{ color: "inherit" }}>{t("nav.addPlaylist")}</Text>
            </div>
          </div>
        </>
      )}

      <Modal
        title={t("playlist.newPlaylist")}
        open={isModalOpen}
        onOk={handleCreatePlaylist}
        onCancel={() => setIsModalOpen(false)}
        confirmLoading={loading}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t("playlist.playlistName")}
            rules={[{ required: true, message: t("playlist.playlistNamePlaceholder") }]}
          >
            <Input placeholder={t("playlist.playlistNamePlaceholder")} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

// 折叠态弹窗内的快捷入口项（图标 + 文字）
const PopupQuickItem = ({
  icon,
  text,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  text: string;
  active?: boolean;
  onClick?: () => void;
}) => {
  const { token } = theme.useToken();

  return (
    <div
      onClick={onClick}
      className={styles.playlistPopupItem}
      style={
        active
          ? {
              color: token.colorTextLightSolid,
              backgroundColor: token.colorPrimary,
            }
          : undefined
      }
    >
      <span style={{ fontSize: "16px", display: "flex" }}>{icon}</span>
      <Text style={{ color: "inherit" }} ellipsis>
        {text}
      </Text>
    </div>
  );
};

const MenuItem = ({
  icon,
  text,
  active = false,
  onClick,
  collapsed = false,
}: {
  icon: React.ReactNode;
  text: string;
  active?: boolean;
  onClick?: () => void;
  collapsed?: boolean;
}) => {
  const { token } = theme.useToken();

  const item = (
    <div
      onClick={onClick}
      className={`${styles.menuItem} ${active ? styles.active : ""} ${
        collapsed ? styles.collapsedItem : ""
      }`}
      style={
        active
          ? {
              color: token.colorTextLightSolid,
              backgroundColor: token.colorPrimary,
            }
          : { color: token.colorTextSecondary }
      }
    >
      <span style={{ fontSize: "20px" }}>{icon}</span>
      {!collapsed && (
        <Text style={{ color: "inherit" }} ellipsis>
          {text}
        </Text>
      )}
    </div>
  );

  // 折叠态：仅展示图标，hover 用 Tooltip 展示名称
  return collapsed ? (
    <Tooltip title={text} placement="right">
      {item}
    </Tooltip>
  ) : (
    item
  );
};

export default Sidebar;
