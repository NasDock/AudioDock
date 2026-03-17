import {
  CaretRightOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PauseCircleFilled,
  PlayCircleFilled,
  PlusOutlined,
  SearchOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
} from "@ant-design/icons";
import {
  addTrackToPlaylist,
  deletePlaylist,
  getPlaylistById,
  getPlaylists,
  removeTrackFromPlaylist,
  updatePlaylist,
  type Playlist,
} from "@soundx/services";
import {
  Button,
  Col,
  Dropdown,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Space,
  Table,
  theme,
  Typography,
  type MenuProps,
} from "antd";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PlayingIndicator from "../../components/PlayingIndicator";
import { useMessage } from "../../context/MessageContext";
import { type Track } from "../../models";
import { downloadTracks } from "../../services/downloadManager";
import { trackEvent } from "../../services/tracking";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { getCoverUrl } from "../../utils";
import { formatDuration } from "../../utils/formatDuration";
import { usePlayMode } from "../../utils/playMode";
// Use the same styles as Detail component
import styles from "../../components/Detail/index.module.less";

const { Title, Text } = Typography;

const PlaylistDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const message = useMessage();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [form] = Form.useForm();

  // Playlist Modal State
  const [isAddToPlaylistModalOpen, setIsAddToPlaylistModalOpen] =
    useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [pendingAction, setPendingAction] = useState<"add" | "move">("add");

  // Search and Sort state (to match Detail UI, though maybe client-side for now)
  const [keyword, setKeyword] = useState("");
  const [keywordMidValue, setKeywordMidValue] = useState("");
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [sort, setSort] = useState<"asc" | "desc">("asc");

  const [modalApi, modalContextHolder] = Modal.useModal();

  const { token } = theme.useToken();
  const {
    play,
    setPlaylist: setPlayerPlaylist,
    currentTrack,
    isPlaying,
  } = usePlayerStore();

  const { mode } = usePlayMode();
  const { user, device } = useAuthStore();

  const fetchPlaylist = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await getPlaylistById(id);
      if (res.code === 200) {
        setPlaylist(res.data);
      }
    } catch (error) {
      console.error("Failed to fetch playlist:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlaylist();
  }, [id]);

  const handlePlayAll = () => {
    if (playlist?.tracks && playlist.tracks.length > 0) {
      trackEvent({
        feature: "personal",
        eventName: "personal_playlist_play",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
        metadata: {
          playlistId: playlist.id,
          trackCount: playlist.tracks.length,
        },
      });
      setPlayerPlaylist(playlist.tracks);
      play(playlist.tracks[0], playlist.id);
    }
  };

  const handleDownloadSelected = () => {
    if (!playlist?.tracks) return;
    const selectedTracks = playlist.tracks.filter((t) =>
      selectedRowKeys.includes(t.id),
    );
    if (selectedTracks.length === 0) {
      message.warning("请先选择要下载的曲目");
      return;
    }
    message.info(`开始下载 ${selectedTracks.length} 首曲目`);
    downloadTracks(selectedTracks, (completed: number, total: number) => {
      if (completed === total) {
        message.success(`${total} 首曲目下载完成`);
        setIsSelectionMode(false);
        setSelectedRowKeys([]);
      }
    });
  };

  const handlePlayTrack = (track: Track) => {
    if (playlist?.tracks) {
      setPlayerPlaylist(playlist.tracks);
      play(track, -1);
    }
  };

  const handleDeletePlaylist = async () => {
    if (!id) return;
    try {
      const res = await deletePlaylist(id);
      if (res.code === 200) {
        message.success("删除成功");
        navigate("/recommended");
        window.location.reload();
      }
    } catch (error) {
      message.error("删除失败");
    }
  };

  const handleUpdatePlaylist = async () => {
    if (!id) return;
    try {
      const values = await form.validateFields();
      const res = await updatePlaylist(id, values.name);
      if (res.code === 200) {
        message.success("更新成功");
        setIsEditModalOpen(false);
        fetchPlaylist();
      }
    } catch (error) {
      message.error("更新失败");
    }
  };

  const handleRemoveTrack = async (trackId: string | number) => {
    if (!id) return;
    try {
      const res = await removeTrackFromPlaylist(id, trackId);
      if (res.code === 200) {
        message.success("移除成功");
        fetchPlaylist();
      }
    } catch (error) {
      message.error("移除失败");
    }
  };

  const openMoveToPlaylistModal = async (e: React.MouseEvent, track: Track) => {
    e.stopPropagation();
    setSelectedTrack(track);
    setPendingAction("move");
    setIsAddToPlaylistModalOpen(true);
    try {
      const res = await getPlaylists(mode, user?.id);
      if (res.code === 200) {
        setPlaylists(res.data);
      }
    } catch (error) {
      message.error("获取播放列表失败");
    }
  };

  const handleAddToPlaylist = async (targetPlaylistId: string | number) => {
    if (!selectedTrack || !id) return;
    try {
      // 1. Add to new playlist
      const addRes = await addTrackToPlaylist(
        targetPlaylistId,
        selectedTrack.id,
      );
      if (addRes.code === 200) {
        // 2. If move, remove from current playlist
        if (pendingAction === "move") {
          const removeRes = await removeTrackFromPlaylist(
            Number(id),
            selectedTrack.id,
          );
          if (removeRes.code === 200) {
            message.success("移动成功");
            fetchPlaylist();
          } else {
            message.warning("添加到新列表成功，但从当前列表移除失败");
          }
        } else {
          message.success("添加成功");
        }
        setIsAddToPlaylistModalOpen(false);
      } else {
        message.error("操作失败");
      }
    } catch (error) {
      message.error("操作失败");
    }
  };

  // Filter tracks based on keyword
  const filteredTracks =
    playlist?.tracks?.filter(
      (track) =>
        track.name.toLowerCase().includes(keyword.toLowerCase()) ||
        track.artist.toLowerCase().includes(keyword.toLowerCase()),
    ) || [];

  // Sort tracks
  const sortedTracks = [...filteredTracks].sort((_a, _b) => {
    if (sort === "asc") return 0; // Default order (creation time usually)
    return 0; // TODO: Implement specific sorting if needed, for now keep default or reverse
  });

  const columns = [
    {
      title: "#",
      key: "index",
      width: 50,
      render: (_: any, __: any, index: number) => {
        return <Text>{index + 1}</Text>;
      },
    },
    {
      title: "封面",
      key: "cover",
      width: 60,
      render: (_: any, record: Track) => {
        return (
          <div
            style={{ position: "relative" }}
            onClick={(e) => {
              e.stopPropagation();
              handlePlayTrack(record);
            }}
          >
            <img
              src={getCoverUrl(record.cover, record.id)}
              alt={record.name}
              style={{
                width: "30px",
                height: "30px",
                objectFit: "cover",
              }}
            />
            {currentTrack?.id === record.id && isPlaying && (
              <div className={styles.playIconStatus}>
                <PlayingIndicator />
              </div>
            )}
            {currentTrack?.id === record.id && isPlaying ? (
              <PauseCircleFilled className={styles.listPlayIcon} />
            ) : (
              <PlayCircleFilled className={styles.listPlayIcon} />
            )}
          </div>
        );
      },
    },
    {
      title: "标题",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (text: string, record: Track) => (
        <Text strong={currentTrack?.id === record.id}>{text}</Text>
      ),
    },
    {
      title: "时长",
      dataIndex: "duration",
      key: "duration",
      width: 80,
      render: (duration: number) => (
        <Text type="secondary">{formatDuration(duration)}</Text>
      ),
    },
    {
      title: <MoreOutlined />,
      key: "action",
      width: 30,
      render: (_: any, record: Track) => {
        const items: MenuProps["items"] = [
          {
            key: "move",
            label: "移动到播放列表",
            icon: <PlusOutlined />,
            onClick: (info) => {
              info.domEvent.stopPropagation();
              openMoveToPlaylistModal(info.domEvent as any, record);
            },
          },
          {
            key: "remove",
            label: "从列表移除",
            icon: <DeleteOutlined />,
            danger: true,
            onClick: (info) => {
              info.domEvent.stopPropagation();
              // We need to confirm before delete, but Dropdown item onClick is immediate.
              // We can use Modal.confirm or just execute directly if user prefers quick action.
              // Given previous UI had Popconfirm, let's use Modal.confirm for safety or just direct call if acceptable.
              // Let's use a simple confirm or just direct call for now as it's inside a menu.
              // Actually, let's wrap the logic in a function that shows modal.
              modalApi.confirm({
                title: "确定从列表中移除?",
                onOk: () => handleRemoveTrack(record.id),
              });
            },
          },
        ];

        return (
          <Dropdown menu={{ items }} trigger={["click"]}>
            <MoreOutlined
              style={{ cursor: "pointer", fontSize: "20px" }}
              onClick={(e) => e.stopPropagation()}
            />
          </Dropdown>
        );
      },
    },
  ];

  const coverUrl = playlist?.tracks?.[0]
    ? getCoverUrl(playlist.tracks[0].cover, playlist.tracks[0].id)
    : `https://picsum.photos/seed/${playlist?.id}/1200/400`;

  return (
    <div
      className={styles.detailContainer}
      style={{ overflowY: "auto", height: "100%" }}
    >
      {/* Header Banner */}
      <div
        className={styles.banner}
        style={{
          backgroundImage: `url(${coverUrl})`,
        }}
      >
        <div className={styles.bannerOverlay}></div>

        <Flex align="center" gap={16} className={styles.bannerContent}>
          <div
            style={{
              width: 50,
              height: 50,
              backgroundColor: token.colorFillSecondary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
            }}
          >
            <img
              src={coverUrl}
              alt="cover"
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                objectFit: "cover",
              }}
            />
          </div>
          <Flex vertical gap={0}>
            <Title level={4} style={{ color: "#fff", margin: 0 }}>
              {playlist?.name || "Unknown Playlist"}
            </Title>
            <Text type="secondary" style={{ color: "#ccc" }}>
              创建于{" "}
              {playlist?.createdAt
                ? new Date(playlist.createdAt).toLocaleDateString()
                : ""}
            </Text>
          </Flex>
        </Flex>
      </div>

      <div className={styles.contentPadding} style={{ color: token.colorText }}>
        <Row gutter={40}>
          {/* Main Content */}
          <Col span={24}>
            {/* Controls */}
            <div className={styles.controlsRow}>
              <div className={styles.mainControls}>
                <div
                  className={styles.playButton}
                  style={{
                    backgroundColor: `rgba(255, 255, 255, 0.1)`,
                    border: `0.1px solid ${token.colorTextSecondary}`,
                  }}
                >
                  <CaretRightOutlined
                    onClick={handlePlayAll}
                    style={{
                      color: token.colorTextSecondary,
                      fontSize: "30px",
                    }}
                  />
                </div>

                <div className={styles.actionGroup}>
                  <EditOutlined
                    className={styles.actionIcon}
                    onClick={() => {
                      form.setFieldsValue({ name: playlist?.name });
                      setIsEditModalOpen(true);
                    }}
                  />
                  <Popconfirm
                    title="确定解散该播放列表?"
                    description="解散后无法恢复"
                    onConfirm={handleDeletePlaylist}
                    okText="解散"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <DeleteOutlined className={styles.actionIcon} />
                  </Popconfirm>
                  <CloudDownloadOutlined
                    className={styles.actionIcon}
                    onClick={() => {
                      setIsSelectionMode(true);
                    }}
                  />
                  {isSelectionMode && (
                    <Space size={8} style={{ marginLeft: 16 }}>
                      <Button
                        type="text"
                        size="small"
                        onClick={handleDownloadSelected}
                      >
                        点击下载已选中的 ({selectedRowKeys.length})首曲目
                      </Button>
                      <Button
                        size="small"
                        type="text"
                        icon={<CloseOutlined />}
                        onClick={() => {
                          setIsSelectionMode(false);
                          setSelectedRowKeys([]);
                        }}
                      >
                        取消
                      </Button>
                    </Space>
                  )}
                </div>
              </div>

              <div
                style={{ display: "flex", alignItems: "center", gap: "15px" }}
              >
                <Input
                  prefix={
                    <SearchOutlined
                      style={{ color: token.colorTextSecondary }}
                    />
                  }
                  className={styles.searchInput}
                  onChange={(e) => setKeywordMidValue(e.target.value)}
                  onPressEnter={() => setKeyword(keywordMidValue)}
                  placeholder="搜索歌曲"
                />
                {sort === "desc" ? (
                  <SortAscendingOutlined
                    className={styles.actionIcon}
                    style={{ fontSize: "18px" }}
                    onClick={() => setSort("asc")}
                  />
                ) : (
                  <SortDescendingOutlined
                    className={styles.actionIcon}
                    style={{ fontSize: "18px" }}
                    onClick={() => setSort("desc")}
                  />
                )}
              </div>
            </div>

            {/* Track List */}
            <Table
              dataSource={sortedTracks}
              columns={columns}
              pagination={false}
              rowKey="id"
              loading={loading}
              rowClassName={styles.listCover}
              onRow={(record) => ({
                onClick: () => handlePlayTrack(record),
                style: { cursor: "pointer" },
              })}
              rowSelection={
                isSelectionMode
                  ? {
                      selectedRowKeys,
                      onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
                    }
                  : undefined
              }
            />
          </Col>
        </Row>
      </div>
      {modalContextHolder}
      <Modal
        title="编辑播放列表"
        open={isEditModalOpen}
        onOk={handleUpdatePlaylist}
        onCancel={() => setIsEditModalOpen(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="列表名称"
            rules={[{ required: true, message: "请输入列表名称" }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={pendingAction === "move" ? "移动到播放列表" : "添加到播放列表"}
        open={isAddToPlaylistModalOpen}
        onCancel={() => setIsAddToPlaylistModalOpen(false)}
        footer={null}
      >
        <List
          dataSource={playlists}
          renderItem={(item) => (
            <List.Item
              onClick={() => handleAddToPlaylist(item.id)}
              style={{ cursor: "pointer" }}
              className={styles.playlistItem}
            >
              <Text>{item.name}</Text>
              <Text type="secondary">{item._count?.tracks || 0} 首</Text>
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
};

export default PlaylistDetail;
