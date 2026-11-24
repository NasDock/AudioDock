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
  TrackingEvent as TE,
  TrackingFeature as TF,
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
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AddToPlaylistModal from "../../components/AddToPlaylistModal";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { usePlaylistStore } from "../../store/playlist";
import { trackEvent } from "../../services/tracking";
import { getCoverUrl } from "../../utils";
import { usePlayMode } from "../../utils/playMode";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";

const { Text } = Typography;

const FolderPage: React.FC = () => {
  const { t } = useTranslation();
  const reportedOpenRef = useRef(false);
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
    if (!reportedOpenRef.current) {
      reportedOpenRef.current = true;
      trackEvent({
        feature: TF.CONTENT,
        eventName: TE.CONTENT_FOLDER_OPEN,
        metadata: { folderId: id ?? "root", page: id ? "detail" : "list" },
      });
    }
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
      messageApi.info(t("folder.noSelection"));
      return;
    }

    modalAPI.confirm({
      title: t("folder.confirmBatchDelete"),
      content: t("folder.confirmBatchDeleteContent", { folders: selectedFolders.length, tracks: selectedTracks.length }),
      okText: t("folder.confirmDelete"),
      okType: "danger",
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          const res = await batchDeleteItems({
            folderIds: selectedFolders,
            trackIds: selectedTracks,
          });
          if (res.code === 200) {
            messageApi.success(t("folder.batchDeleteSuccess"));
            setIsSelectionMode(false);
            setSelectedFolders([]);
            setSelectedTracks([]);
            fetchData();
          }
        } catch (error) {
          messageApi.error(t("folder.deleteFailed"));
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
    const hide = messageApi.loading(t('folder.fetchingSongs'), 0);
    try {
      const tracks = await getAllTracks(folderId);
      hide();
      if (tracks.length > 0) {
        setPlaylist(tracks);
        play(tracks[0]);
        messageApi.success(t("folder.addedTracksToPlaylist", { count: tracks.length }));
      } else {
        messageApi.info(t("folder.noPlayableTracks"));
      }
    } catch (error) {
      hide();
      messageApi.error(t("folder.playFailed"));
    }
  };

  const openAddToPlaylistModal = async (tracks: any[]) => {
    if (tracks.length === 0) {
      messageApi.info(t("folder.noSelectedSongs"));
      return;
    }
    setTargetTracks(tracks);
    setIsPlaylistModalOpen(true);
  };

  const handleFolderAddToPlaylist = async (folderId: number | string) => {
    const hide = messageApi.loading(t("folder.fetchingAllSongs"), 0);
    try {
      const tracks = await getAllTracks(folderId);
      hide();
      openAddToPlaylistModal(tracks);
    } catch (error) {
      hide();
      messageApi.error(t("folder.operationFailed"));
    }
  };

  const handleBatchAddToPlaylist = async () => {
    const hide = messageApi.loading(t("folder.processingSelectedFolders"), 0);
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
      messageApi.error(t("folder.fetchDataFailed"));
    }
  };

  const handleCreatePlaylistFromFolder = (folder: FolderType) => {
    if (!user) {
      messageApi.error(t("folder.pleaseLoginFirst"));
      return;
    }
    const userId = user.id;

    modalAPI.confirm({
      title: t("folder.createSameNamePlaylist"),
      content: t("folder.confirmCreateSameNamePlaylist", { name: folder.name }),
      okText: t("folder.confirmCreate"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        const hide = messageApi.loading(
          t("folder.creatingSameNamePlaylist", { name: folder.name }),
          0
        );
        try {
          // 1. Get all tracks
          const tracks = await getAllTracks(folder.id);
          if (tracks.length === 0) {
            hide();
            messageApi.info(t("folder.noSongsInFolder"));
            return;
          }

          // 2. Create playlist
          const playlistRes = await createPlaylist(
            folder.name,
            mode === "MUSIC" ? "MUSIC" : "AUDIOBOOK",
            userId
          );
          if (playlistRes.code !== 200 || !playlistRes.data) {
            throw new Error(t("folder.createPlaylistFailed"));
          }
          const playlistId = playlistRes.data.id;

          // 3. Add tracks
          const trackIds = tracks.map((t) => t.id);
          const addRes = await addTracksToPlaylist(playlistId, trackIds);

          hide();
          if (addRes.code === 200) {
            messageApi.success(
              t("folder.createSameNamePlaylistSuccess", { name: folder.name, count: tracks.length })
            );
            // Update sidebar playlists
            usePlaylistStore.getState().fetchPlaylists(mode, userId);
          } else {
            messageApi.error(t("folder.addSongsToPlaylistFailed"));
          }
        } catch (error) {
          hide();
          console.error(error);
          messageApi.error(t("folder.operationFailed"));
        }
      },
    });
  };

  const handlePlayCurrent = async () => {
    if (!data) return;
    const hide = messageApi.loading(t("folder.fetchingSongs"), 0);
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
        messageApi.success(t("folder.addedTracksToPlaylist", { count: tracks.length }));
      } else {
        messageApi.info(t("folder.noPlayableSongs"));
      }
    } catch (e) {
      hide();
      messageApi.error(t("folder.operationFailed"));
    }
  };

  const handleDeleteFolder = (folder: FolderType) => {
    modalAPI.confirm({
      title: t("folder.confirmDeleteFolder"),
      content: t("folder.deleteFolderContent", { name: folder.name }),
      okText: t("folder.confirmDelete"),
      okType: "danger",
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          const res = await deleteFolder(folder.id);
          if (res.code === 200) {
            messageApi.success(t("folder.folderDeleted"));
            fetchData();
          }
        } catch (error) {
          messageApi.error(t("folder.deleteFailed"));
        }
      },
    });
  };

  const handleDeleteTrack = (track: any) => {
    modalAPI.confirm({
      title: t("folder.confirmDeleteTrack"),
      content: t("folder.deleteTrackContent", { name: track.name }),
      okText: t("folder.confirmDelete"),
      okType: "danger",
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          const res = await deleteTrack(track.id);
          if (res.code === 200) {
            messageApi.success(t("folder.trackDeleted"));
            fetchData();
          }
        } catch (error) {
          messageApi.error(t("folder.deleteFailed"));
        }
      },
    });
  };

  const handleShowFolderProperties = async (folder: FolderType) => {
    try {
      const res = await getFolderStats(folder.id);
      if (res.code === 200) {
        modalAPI.info({
          title: t("folder.folderProperties"),
          content: (
            <div>
              <p>
                <b>{t("folder.nameLabel")}</b> {folder.name}
              </p>
              <p>
                <b>{t("folder.pathLabel")}</b> {res.data.path}
              </p>
              <p>
                <b>{t("folder.containsTracksLabel")}</b> {res.data.trackCount} {t("folder.itemCountUnit")}
              </p>
              <p>
                <b>{t("folder.containsFoldersLabel")}</b> {res.data.folderCount} {t("folder.itemCountUnit")}
              </p>
            </div>
          ),
        });
      }
    } catch (error) {
      messageApi.error(t("folder.getPropertiesFailed"));
    }
  };

  const handleShowTrackProperties = (track: any) => {
    modalAPI.info({
      title: t("folder.trackProperties"),
      content: (
        <div>
          <p>
            <b>{t("folder.titleLabel")}</b> {track.name}
          </p>
          <p>
            <b>{t("common.artists")}:</b> {track.artist || t("common.unknown")}
          </p>
          <p>
            <b>{t("nav.albums")}:</b> {track.album || t("common.unknown")}
          </p>
          <p>
            <b>{t("folder.pathLabel")}</b> {track.path}
          </p>
          {track.cover && (
            <div style={{ marginTop: 12 }}>
              <p>
                <b>{t("folder.coverLabel")}</b>
              </p>
              <img
                src={getCoverUrl(track, track.id, 300)}
                alt={t("folder.coverLabel")}
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
          <HomeOutlined /> {t("folder.all")}
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
                {t("folder.playAll")}
              </Button>
              <Button
                size="small"
                onClick={() => setIsSelectionMode(true)}
                disabled={!data?.children.length && !data?.tracks.length}
              >
                {t("folder.batchEdit")}
              </Button>
            </Space>
          ) : (
            <Space size="small">
              <Button size="small" onClick={handleSelectAll}>
                {selectedFolders.length === (data?.children.length || 0) &&
                selectedTracks.length === (data?.tracks.length || 0)
                  ? t("common.cancel") + " " + t("folder.selectAll")
                  : t("folder.selectAll")}
              </Button>
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={handleBatchAddToPlaylist}
                disabled={selectedFolders.length === 0 && selectedTracks.length === 0}
              >
                {t("folder.addTo")}
              </Button>
              <Button
                size="small"
                danger
                type="primary"
                onClick={handleBatchDelete}
                disabled={selectedFolders.length === 0 && selectedTracks.length === 0}
              >
                {t("folder.batchDelete")}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedFolders([]);
                  setSelectedTracks([]);
                }}
              >
                {t("folder.done")}
              </Button>
            </Space>
          )}
        </div>
      </div>

      {contextHolder}

      <Spin spinning={loading}>
        <div className={styles.content}>
          {!loading && !data?.children?.length && !data?.tracks?.length ? (
            <Empty description={t("folder.noContent")} style={{ marginTop: 100 }} />
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
                                label: t("folder.playAll"),
                                icon: <PlayCircleOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  handlePlayAll(folder.id);
                                },
                              },
                              {
                                key: "add",
                                label: t("folder.addToPlaylist"),
                                icon: <PlusOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  handleFolderAddToPlaylist(folder.id);
                                },
                              },
                              {
                                key: "createPlaylist",
                                label: t("folder.createSameNamePlaylist"),
                                icon: <FolderAddOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  handleCreatePlaylistFromFolder(folder);
                                },
                              },
                              {
                                key: "properties",
                                label: t("folder.properties"),
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
                                label: t("folder.delete"),
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
                          src={getCoverUrl(track, track.id, 96)}
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
                                label: t("folder.play"),
                                icon: <PlayCircleOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  handleTrackClick(track);
                                },
                              },
                              {
                                key: "add",
                                label: t("folder.addToPlaylist"),
                                icon: <PlusOutlined />,
                                onClick: ({ domEvent }) => {
                                  domEvent.stopPropagation();
                                  openAddToPlaylistModal([track]);
                                },
                              },
                              {
                                key: "properties",
                                label: t("folder.properties"),
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
                                label: t("folder.delete"),
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
