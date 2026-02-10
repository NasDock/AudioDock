import { PlaySquareOutlined, UnorderedListOutlined } from "@ant-design/icons";
import {
  addTracksToPlaylist,
  getPlaylists,
  type Playlist,
} from "@soundx/services";
import { List, message, Modal, theme } from "antd";
import React, { useEffect, useState } from "react";
import type { Track } from "../../models";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { usePlayMode } from "../../utils/playMode";

interface AddToPlaylistModalProps {
  open: boolean;
  onCancel: () => void;
  tracks: Track[];
  onSuccess?: () => void;
}

const AddToPlaylistModal: React.FC<AddToPlaylistModalProps> = ({
  open,
  onCancel,
  tracks,
  onSuccess,
}) => {
  const { token } = theme.useToken();
  const { user } = useAuthStore();
  const { mode } = usePlayMode();
  const { insertTracksNext } = usePlayerStore();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const fetchPlaylists = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await getPlaylists(mode, user.id);
      if (res.code === 200) {
        setPlaylists(res.data);
      }
    } catch (error) {
      messageApi.error("获取播放列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchPlaylists();
    }
  }, [open, mode, user]);

  const handleAddToCurrentPlaylist = () => {
    if (tracks.length === 0) return;
    insertTracksNext(tracks);
    messageApi.success(`已添加 ${tracks.length} 首歌曲到播放队列`);
    if (onSuccess) onSuccess();
    onCancel();
  };

  const handleAddToSpecificPlaylist = async (playlistId: number | string) => {
    if (tracks.length === 0) return;
    const hide = messageApi.loading("正在添加到播放列表...", 0);
    try {
      const trackIds = tracks.map((t) => t.id);
      const res = await addTracksToPlaylist(playlistId, trackIds);
      if (res.code === 200) {
        hide();
        messageApi.success(`成功添加 ${tracks.length} 首歌曲`);
        if (onSuccess) onSuccess();
        onCancel();
      } else {
        hide();
        messageApi.error("添加失败");
      }
    } catch (error) {
      hide();
      messageApi.error("添加失败");
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        title="添加到播放列表"
        open={open}
        onCancel={onCancel}
        footer={null}
        destroyOnClose
      >
        <List
          loading={loading}
          header={
            <List.Item
              onClick={handleAddToCurrentPlaylist}
              style={{
                cursor: "pointer",
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
                padding: "12px 16px",
              }}
            >
              <List.Item.Meta
                avatar={
                  <PlaySquareOutlined
                    style={{ fontSize: 24, color: token.colorPrimary }}
                  />
                }
                title={
                  <span style={{ color: token.colorText }}>当前播放队列</span>
                }
                description="插入到正在播放之后"
              />
            </List.Item>
          }
          dataSource={playlists}
          renderItem={(item) => (
            <List.Item
              onClick={() => handleAddToSpecificPlaylist(item.id)}
              style={{ cursor: "pointer", padding: "12px 16px" }}
            >
              <List.Item.Meta
                avatar={<UnorderedListOutlined style={{ fontSize: 20 }} />}
                title={item.name}
                description={`${item._count?.tracks || 0} 首`}
              />
            </List.Item>
          )}
          style={{ maxHeight: 400, overflowY: "auto" }}
        />
      </Modal>
    </>
  );
};

export default AddToPlaylistModal;
