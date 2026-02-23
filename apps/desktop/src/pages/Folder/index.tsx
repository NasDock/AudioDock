import {
  AudioOutlined,
  DeleteOutlined,
  FolderAddOutlined,
  FolderFilled,
  HomeOutlined,
  InfoCircleOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  addTracksToPlaylist,
  batchDeleteItems,
  createPlaylist,
  deleteFolder,
  deleteTrack,
  getFolderContents,
  getFolderRoots,
  getFolderStats,
  type Folder as FolderType,
} from "@soundx/services";
import {
  Breadcrumb,
  Button,
  Checkbox,
  Col,
  Dropdown,
  Empty,
  message,
  Modal,
  Row,
  Space,
  Spin,
  theme,
  Typography
} from "antd";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AddToPlaylistModal from "../../components/AddToPlaylistModal";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { usePlaylistStore } from "../../store/playlist";
import { getCoverUrl } from "../../utils";
import { usePlayMode } from "../../utils/playMode";
import styles from "./index.module.less";

const { Text } = Typography;

const FolderPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { mode } = usePlayMode();
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    children: FolderType[];
    tracks: any[];
    breadcrumbs: FolderType[];
    name?: string;
  } | null>(null);

  const { play, setPlaylist } = usePlayerStore();
  const [messageApi, contextHolder] = message.useMessage();

  const [modalAPI, modalHandle] = Modal.useModal();

  // Batch selection state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState<(number | string)[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<(number | string)[]>([]);

  // Playlist selection state
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [targetTracks, setTargetTracks] = useState<any[]>([]);

  const { user } = useAuthStore();

  const fetchData = async () => {
    setLoading(true);
    try {
      if (!id) {
        const res = await getFolderRoots(mode);
        if (res.code === 200) {
          setData({
            children: res.data,
            tracks: [],
            breadcrumbs: [],
          });
        }
      } else {
        const res = await getFolderContents(Number(id));
        if (res.code === 200) {
          setData(res.data);
        }
      }
    } catch (error) {
      console.error("Failed to fetch folder data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id, mode]);

  const handleFolderClick = (folderId: number | string) => {
    if (isSelectionMode) {
      toggleFolderSelection(folderId);
      return;
    }
    navigate(`/folder/${folderId}`);
  };

  const handleTrackClick = (track: any) => {
    if (isSelectionMode) {
      toggleTrackSelection(track.id);
      return;
    }
    if (data?.tracks) {
      setPlaylist(data.tracks);
      play(track);
    }
  };

  const toggleFolderSelection = (id: number | string) => {
    setSelectedFolders((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleTrackSelection = (id: number | string) => {
    setSelectedTracks((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (data) {
      const allFolderIds = data.children.map((f) => f.id);
      const allTrackIds = data.tracks.map((t) => t.id);
      
      const isAllSelected = 
        selectedFolders.length === allFolderIds.length && 
        selectedTracks.length === allTrackIds.length;

      if (isAllSelected) {
        setSelectedFolders([]);
        setSelectedTracks([]);
      } else {
        setSelectedFolders(allFolderIds as number[]);
        setSelectedTracks(allTrackIds as number[]);
      }
    }
  };

  const handleBatchDelete = () => {
    if (selectedFolders.length === 0 && selectedTracks.length === 0) {
      messageApi.info("未选中任何项目");
      return;
    }

    modalAPI.confirm({
      title: "确认批量删除",
      content: `将会物理删除选中的 ${selectedFolders.length} 个文件夹和 ${selectedTracks.length} 个音轨及其所有内容，此操作不可恢复。确定要继续吗？`,
      okText: "确定删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await batchDeleteItems({
            folderIds: selectedFolders,
            trackIds: selectedTracks,
          });
          if (res.code === 200) {
            messageApi.success("批量删除成功");
            setIsSelectionMode(false);
            setSelectedFolders([]);
            setSelectedTracks([]);
            fetchData();
          }
        } catch (error) {
          messageApi.error("删除失败");
        }
      },
    });
  };

  const getAllTracks = async (folderId: number | string): Promise<any[]> => {
    try {
      const res = await getFolderContents(folderId);
      if (res.code !== 200 || !res.data) return [];
      
      let allTracks = res.data.tracks || [];
      
      if (res.data.children && res.data.children.length > 0) {
        // Fetch children in parallel
        const childrenTracks = await Promise.all(
          res.data.children.map((child: FolderType) => getAllTracks(child.id))
        );
        childrenTracks.forEach(tracks => {
          allTracks = [...allTracks, ...tracks];
        });
      }
      return allTracks;
    } catch (e) {
      console.error(e);
      return [];
    }
  };

  const handlePlayAll = async (folderId: number | string) => {
    const hide = messageApi.loading('正在获取所有歌曲...', 0);
    try {
      const tracks = await getAllTracks(folderId);
      hide();
      if (tracks.length > 0) {
        setPlaylist(tracks);
        play(tracks[0]);
        messageApi.success(`已添加 ${tracks.length} 首歌曲到播放列表`);
      } else {
        messageApi.info("该文件夹下没有可播放的音轨");
      }
    } catch (error) {
      hide();
      messageApi.error("播放失败");
    }
  };

  const openAddToPlaylistModal = async (tracks: any[]) => {
    if (tracks.length === 0) {
      messageApi.info("没有选中的歌曲");
      return;
    }
    setTargetTracks(tracks);
    setIsPlaylistModalOpen(true);
  };

  const handleFolderAddToPlaylist = async (folderId: number | string) => {
    const hide = messageApi.loading('正在提取所有歌曲...', 0);
    try {
      const tracks = await getAllTracks(folderId);
      hide();
      openAddToPlaylistModal(tracks);
    } catch (error) {
      hide();
      messageApi.error("操作失败");
    }
  };

  const handleBatchAddToPlaylist = async () => {
    const hide = messageApi.loading('正在处理选中的文件夹...', 0);
    try {
      let allTracks = [...data?.tracks.filter(t => selectedTracks.includes(t.id)) || []];
      
      if (selectedFolders.length > 0) {
        const folderTracksArr = await Promise.all(
          selectedFolders.map(fid => getAllTracks(fid))
        );
        folderTracksArr.forEach(tracks => {
          allTracks = [...allTracks, ...tracks];
        });
      }
      
      // Remove duplicates by ID
      const uniqueTracks = Array.from(new Map(allTracks.map(t => [t.id, t])).values());
      hide();
      openAddToPlaylistModal(uniqueTracks);
    } catch (error) {
      hide();
      messageApi.error("获取数据失败");
    }
  };

  const handleCreatePlaylistFromFolder = (folder: FolderType) => {
    if (!user) {
      messageApi.error("请先登录");
      return;
    }
    const userId = user.id;

    modalAPI.confirm({
      title: "创建同名播放列表",
      content: `将会创建一个名为 "${folder.name}" 的播放列表，并添加该文件夹下的所有歌曲。是否继续？`,
      okText: "确认创建",
      cancelText: "取消",
      onOk: async () => {
        const hide = messageApi.loading(
          `正在为文件夹 "${folder.name}" 创建同名歌单...`,
          0
        );
        try {
          // 1. Get all tracks
          const tracks = await getAllTracks(folder.id);
          if (tracks.length === 0) {
            hide();
            messageApi.info("该文件夹下没有歌曲");
            return;
          }

          // 2. Create playlist
          const playlistRes = await createPlaylist(
            folder.name,
            mode === "MUSIC" ? "MUSIC" : "AUDIOBOOK",
            userId
          );
          if (playlistRes.code !== 200 || !playlistRes.data) {
            throw new Error("创建歌单失败");
          }
          const playlistId = playlistRes.data.id;

          // 3. Add tracks
          const trackIds = tracks.map((t) => t.id);
          const addRes = await addTracksToPlaylist(playlistId, trackIds);

          hide();
          if (addRes.code === 200) {
            messageApi.success(
              `成功创建歌单 "${folder.name}" 并添加 ${tracks.length} 首歌曲`
            );
            // Update sidebar playlists
            usePlaylistStore.getState().fetchPlaylists(mode, userId);
          } else {
            messageApi.error("添加歌曲到歌单失败");
          }
        } catch (error) {
          hide();
          console.error(error);
          messageApi.error("操作失败");
        }
      },
    });
  };

  const handlePlayCurrent = async () => {
    if (!data) return;
    const hide = messageApi.loading("正在获取所有歌曲...", 0);
    try {
      let tracks: any[] = [];
      if (id) {
        // Specific folder
        tracks = await getAllTracks(id);
      } else {
        // Root: iterate children
        if (data.children) {
          const rootTracks = await Promise.all(
            data.children.map((child: FolderType) => getAllTracks(child.id))
          );
          rootTracks.forEach((t) => tracks.push(...t));
        }
      }
      hide();
      if (tracks.length > 0) {
        setPlaylist(tracks);
        play(tracks[0]);
        messageApi.success(`已添加 ${tracks.length} 首歌曲到播放列表`);
      } else {
        messageApi.info("没有可播放的歌曲");
      }
    } catch (e) {
      hide();
      messageApi.error("操作失败");
    }
  };

  const handleDeleteFolder = (folder: FolderType) => {
    modalAPI.confirm({
      title: "确认删除文件夹",
      content: `将会物理删除文件夹 "${folder.name}" 及其所有内容（包括音频文件和历史记录），此操作不可恢复。确定要继续吗？`,
      okText: "确定删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await deleteFolder(folder.id);
          if (res.code === 200) {
            messageApi.success("文件夹已删除");
            fetchData();
          }
        } catch (error) {
          messageApi.error("删除失败");
        }
      },
    });
  };

  const handleDeleteTrack = (track: any) => {
    modalAPI.confirm({
      title: "确认删除音轨",
      content: `将会物理删除音轨 "${track.name}" 及其历史记录，此操作不可恢复。确定要继续吗？`,
      okText: "确定删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await deleteTrack(track.id);
          if (res.code === 200) {
            messageApi.success("音轨已删除");
            fetchData();
          }
        } catch (error) {
          messageApi.error("删除失败");
        }
      },
    });
  };

  const handleShowFolderProperties = async (folder: FolderType) => {
    try {
      const res = await getFolderStats(folder.id);
      if (res.code === 200) {
        modalAPI.info({
          title: "文件夹属性",
          content: (
            <div>
              <p>
                <b>名称:</b> {folder.name}
              </p>
              <p>
                <b>路径:</b> {res.data.path}
              </p>
              <p>
                <b>包含单曲:</b> {res.data.trackCount} 个
              </p>
              <p>
                <b>包含文件夹:</b> {res.data.folderCount} 个
              </p>
            </div>
          ),
        });
      }
    } catch (error) {
      messageApi.error("获取属性失败");
    }
  };

  const handleShowTrackProperties = (track: any) => {
    modalAPI.info({
      title: "音轨属性",
      content: (
        <div>
          <p>
            <b>标题:</b> {track.name}
          </p>
          <p>
            <b>艺术家:</b> {track.artist || "未知"}
          </p>
          <p>
            <b>专辑:</b> {track.album || "未知"}
          </p>
          <p>
            <b>路径:</b> {track.path}
          </p>
          {track.cover && (
            <div style={{ marginTop: 12 }}>
              <p>
                <b>封面:</b>
              </p>
              <img
                src={getCoverUrl(track, track.id)}
                alt="封面"
                style={{
                  width: 120,
                  height: 120,
                  objectFit: "cover",
                  borderRadius: 8,
                }}
              />
            </div>
          )}
        </div>
      ),
    });
  };

  const breadcrumbItems = [
    {
      title: (
        <span
          onClick={() => navigate("/folders")}
          style={{ cursor: "pointer" }}
        >
          <HomeOutlined /> 全部
        </span>
      ),
    },
    ...(data?.breadcrumbs || []).map((b) => ({
      title: (
        <span
          onClick={() => navigate(`/folder/${b.id}`)}
          style={{ cursor: "pointer" }}
        >
          {b.name}
        </span>
      ),
    })),
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Breadcrumb items={breadcrumbItems} className={styles.breadcrumb} />
        <div className={styles.headerActions}>
          {!isSelectionMode ? (
            <Space>
              <Button
                icon={<PlayCircleOutlined />}
                type="primary"
                onClick={handlePlayCurrent}
                disabled={!data?.children.length && !data?.tracks.length}
              >
                播放全部
              </Button>
              <Button
                size="small"
                onClick={() => setIsSelectionMode(true)}
                disabled={!data?.children.length && !data?.tracks.length}
              >
                批量编辑
              </Button>
            </Space>
          ) : (
            <Space size="small">
              <Button size="small" onClick={handleSelectAll}>
                {selectedFolders.length === (data?.children.length || 0) &&
                selectedTracks.length === (data?.tracks.length || 0)
                  ? "取消全选"
                  : "全选"}
              </Button>
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={handleBatchAddToPlaylist}
                disabled={selectedFolders.length === 0 && selectedTracks.length === 0}
              >
                添加到...
              </Button>
              <Button
                size="small"
                danger
                type="primary"
                onClick={handleBatchDelete}
                disabled={selectedFolders.length === 0 && selectedTracks.length === 0}
              >
                批量删除
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedFolders([]);
                  setSelectedTracks([]);
                }}
              >
                完成
              </Button>
            </Space>
          )}
        </div>
      </div>

      {contextHolder}

      <Spin spinning={loading}>
        <div className={styles.content}>
          {!loading && !data?.children?.length && !data?.tracks?.length ? (
            <Empty description="暂无内容" style={{ marginTop: 100 }} />
          ) : (
            <Row gutter={[16, 16]}>
              {/* Folders */}
              {data?.children?.map((folder) => (
                <Col
                  xs={12}
                  sm={8}
                  md={6}
                  lg={4}
                  xl={3}
                  key={`folder-${folder.id}`}
                >
                  <div
                    className={`${styles.item} ${
                      selectedFolders.includes(folder.id) ? styles.selected : ""
                    }`}
                    onClick={() => handleFolderClick(folder.id)}
                  >
                    {isSelectionMode && (
                      <Checkbox
                        className={styles.checkbox}
                        checked={selectedFolders.includes(folder.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleFolderSelection(folder.id)}
                      />
                    )}
                    <div
                      className={styles.iconWrapper}
                      style={{ backgroundColor: token.colorFillTertiary }}
                    >
                      <FolderFilled
                        style={{ fontSize: 48, color: "#faad14" }}
                      />
                      {!isSelectionMode && (
                        <Dropdown
                          menu={{
                            items: [
                              {
                                key: "play",
                                label: "播放全部",
                                icon: <PlayCircleOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  handlePlayAll(folder.id);
                                },
                              },
                              {
                                key: "add",
                                label: "添加到播放列表",
                                icon: <PlusOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  handleFolderAddToPlaylist(folder.id);
                                },
                              },
                              {
                                key: "createPlaylist",
                                label: "创建同名播放列表",
                                icon: <FolderAddOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  handleCreatePlaylistFromFolder(folder);
                                },
                              },
                              {
                                key: "properties",
                                label: "属性",
                                icon: <InfoCircleOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  handleShowFolderProperties(folder);
                                },
                              },
                              {
                                type: "divider",
                              },
                              {
                                key: "delete",
                                label: "删除",
                                danger: true,
                                icon: <DeleteOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  handleDeleteFolder(folder);
                                },
                              },
                            ],
                          }}
                          trigger={["click"]}
                        >
                          <div
                            className={styles.moreButton}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreOutlined />
                          </div>
                        </Dropdown>
                      )}
                    </div>
                    <Text
                      className={styles.itemName}
                      ellipsis
                      style={{ color: token.colorPrimary }}
                    >
                      {folder.name}
                    </Text>
                  </div>
                </Col>
              ))}

              {/* Tracks */}
              {data?.tracks?.map((track) => (
                <Col
                  xs={12}
                  sm={8}
                  md={6}
                  lg={4}
                  xl={3}
                  key={`track-${track.id}`}
                >
                  <div
                    className={`${styles.item} ${
                      selectedTracks.includes(track.id) ? styles.selected : ""
                    }`}
                    onClick={() => handleTrackClick(track)}
                  >
                    {isSelectionMode && (
                      <Checkbox
                        className={styles.checkbox}
                        checked={selectedTracks.includes(track.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleTrackSelection(track.id)}
                      />
                    )}
                    <div
                      className={styles.iconWrapper}
                      style={{ backgroundColor: token.colorFillTertiary }}
                    >
                      {track.cover ? (
                        <img
                          src={getCoverUrl(track, track.id)}
                          alt={track.name}
                          className={styles.cover}
                        />
                      ) : (
                        <AudioOutlined
                          style={{ fontSize: 48, color: token.colorPrimary }}
                        />
                      )}
                      {!isSelectionMode && (
                        <Dropdown
                          menu={{
                            items: [
                              {
                                key: "play",
                                label: "播放",
                                icon: <PlayCircleOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  handleTrackClick(track);
                                },
                              },
                              {
                                key: "add",
                                label: "添加到播放列表",
                                icon: <PlusOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  openAddToPlaylistModal([track]);
                                },
                              },
                              {
                                key: "properties",
                                label: "属性",
                                icon: <InfoCircleOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  handleShowTrackProperties(track);
                                },
                              },
                              {
                                type: "divider",
                              },
                              {
                                key: "delete",
                                label: "删除",
                                danger: true,
                                icon: <DeleteOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  handleDeleteTrack(track);
                                },
                              },
                            ],
                          }}
                          trigger={["click"]}
                        >
                          <div
                            className={styles.moreButton}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreOutlined />
                          </div>
                        </Dropdown>
                      )}
                    </div>
                    <Text
                      className={styles.itemName}
                      ellipsis
                      title={track.name}
                      style={{ color: token.colorPrimary }}
                    >
                      {track.name}
                    </Text>
                  </div>
                </Col>
              ))}
            </Row>
          )}
        </div>
      </Spin>
      {modalHandle}

      <AddToPlaylistModal
        open={isPlaylistModalOpen}
        onCancel={() => setIsPlaylistModalOpen(false)}
        tracks={targetTracks}
        onSuccess={() => {
            setIsSelectionMode(false);
            setSelectedFolders([]);
            setSelectedTracks([]);
        }}
      />
    </div>
  );
};

export default FolderPage;
