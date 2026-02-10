import {
    AppstoreOutlined,
    AudioOutlined,
    CloudDownloadOutlined,
    CompassOutlined,
    CustomerServiceOutlined,
    HeartOutlined,
    PlusOutlined,
    SoundOutlined,
    TeamOutlined
} from "@ant-design/icons";
import { createPlaylist, TrackType } from "@soundx/services";
import { Form, Input, Modal, theme, Typography } from "antd";
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMessage } from "../../context/MessageContext";
import { useAuthStore } from "../../store/auth";
import { usePlaylistStore } from "../../store/playlist";
import { isSubsonicSource } from "../../utils";
import { usePlayMode } from "../../utils/playMode";
import styles from "./index.module.less";

const { Text, Title } = Typography;

const Sidebar: React.FC = () => {
  const message = useMessage();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { playlists, fetchPlaylists } = usePlaylistStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const { mode } = usePlayMode();
  const { user } = useAuthStore();

  useEffect(() => {
    if (user?.id) {
      fetchPlaylists(mode, user.id);
    }
  }, [mode, user?.id]);

  const isActive = (path: string) => location.pathname === path;

  const handleCreatePlaylist = async () => {
    try {
      const values = await form.validateFields();
      if (!user?.id) return;
      setLoading(true);
      const res = await createPlaylist(values.name, mode, user.id);

      if (res.code === 200) {
        message.success("创建成功");
        setIsModalOpen(false);
        form.resetFields();
        fetchPlaylists(mode, user.id);
      } else {
        message.error("创建失败");
      }
    } catch (error) {
      console.error("Create playlist error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={styles.sidebar}
      style={{ color: token.colorText, borderRightColor: token.colorBorder }}
    >
      <div className={styles.header}>
        <Title level={4} style={{ margin: 0, color: token.colorText }}>
          AudioDock
        </Title>
      </div>

      <div className={styles.menuGroup}>
        <MenuItem
          icon={<CompassOutlined />}
          text="推荐"
          onClick={() => navigate("/recommended")}
          active={isActive("/recommended")}
        />
        <MenuItem
          icon={<AppstoreOutlined />}
          text="专辑"
          onClick={() => navigate("/category")}
          active={isActive("/category")}
        />
        <MenuItem
          icon={<TeamOutlined />}
          text="艺术家"
          onClick={() => navigate("/artists")}
          active={isActive("/artists")}
        />
        {
          mode === TrackType.MUSIC && (
            <MenuItem
              icon={<AudioOutlined />}
              text="单曲"
              onClick={() => navigate("/songs")}
              active={isActive("/songs")}
            />
          )
        }
      </div>

      <div className={styles.playlistHeader}>
        <Title level={5} style={{ margin: 0, color: token.colorText }}>
          播放列表
        </Title>
        <CustomerServiceOutlined style={{ color: token.colorTextSecondary }} />
      </div>

      <div className={styles.playlistGroup}>
        <MenuItem
          icon={<CloudDownloadOutlined />}
          text="下载"
          onClick={() => navigate("/downloads")}
          active={isActive("/downloads")}
        />
        <MenuItem
          icon={<HeartOutlined />}
          text="收藏"
          onClick={() => navigate("/favorites")}
          active={isActive("/favorites")}
        />
        {!isSubsonicSource() && (
          <MenuItem
            icon={<SoundOutlined />}
            text="听过"
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
          <Text style={{ color: "inherit" }}>添加播放列表</Text>
        </div>
      </div>

      <Modal
        title="新建播放列表"
        open={isModalOpen}
        onOk={handleCreatePlaylist}
        onCancel={() => setIsModalOpen(false)}
        confirmLoading={loading}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="列表名称"
            rules={[{ required: true, message: "请输入列表名称" }]}
          >
            <Input placeholder="请输入播放列表名称" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

const MenuItem = ({
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
      className={`${styles.menuItem} ${active ? styles.active : ""}`}
      style={{
        color: active ? token.colorText : token.colorTextSecondary,
        backgroundColor: active ? token.colorFillTertiary : "transparent",
      }}
    >
      <span style={{ fontSize: "20px" }}>{icon}</span>
      <Text style={{ color: "inherit" }} ellipsis>
        {text}
      </Text>
    </div>
  );
};

export default Sidebar;
