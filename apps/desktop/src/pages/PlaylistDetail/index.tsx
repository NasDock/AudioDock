import {
  CaretRightOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  SearchOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import {
  addTrackToPlaylist,
  deletePlaylist,
  getPlaylistById,
  getPlaylistTracksPaged,
  getPlaylists,
  playMiDevicePlaylist,
  removeTrackFromPlaylist,
  updatePlaylist,
  type Playlist,
  toPagedResult,
} from "@soundx/services";
import {
  Button,
  Col,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Space,
  theme,
  Typography,
  type MenuProps,
} from "antd";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  MiDeviceSelector,
  XiaoAiIcon,
} from "../../components/MiDeviceSelector";
import TrackList from "../../components/TrackList";
import { useMessage } from "../../context/MessageContext";
import { useLoadMore } from "../../hooks/useLoadMore";
import { type Track } from "../../models";
import { downloadTracks } from "../../services/downloadManager";
import { trackEvent } from "../../services/tracking";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { usePlaylistStore } from "../../store/playlist";
import { getCoverUrl } from "../../utils";
import { usePlayMode } from "../../utils/playMode";
// Use the same styles as Detail component
import styles from "../../components/Detail/index.module.less";

const { Title, Text } = Typography;

const PlaylistDetail: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const message = useMessage();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
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

  // Mi Speaker cast state
  const [isMiDeviceSelectorOpen, setIsMiDeviceSelectorOpen] = useState(false);
  const [isCastingToMi, setIsCastingToMi] = useState(false);

  const { token } = theme.useToken();
  const {
    play,
    setPlaylist: setPlayerPlaylist,
  } = usePlayerStore();

  const { mode } = usePlayMode();
  const { user, device } = useAuthStore();

  const fetchPlaylist = async () => {
    if (!id) return;
    try {
      const res = await getPlaylistById(id);
      if (res.code === 200) {
        setPlaylist(res.data);
      }
    } catch (error) {
      console.error("Failed to fetch playlist:", error);
    }
  };

  // tracks 用 useLoadMore 分页加载（pageSize=100），sentinel 进入视口自动 loadMore
  const {
    list: tracks,
    hasMore,
    loading: tracksLoading,
    loadingMore,
    sentinelRef,
    reload: reloadTracks,
  } = useLoadMore<Track, { playlistId: number | string }>({
    args: { playlistId: id ?? "" },
    deps: [id],
    pageSize: 100,
    fetcher: ({ playlistId: pid, skip, pageSize }) =>
      getPlaylistTracksPaged(pid, skip, pageSize).then((res: { data: import("@soundx/services").ILoadMoreData<Track> | undefined | null }) =>
        toPagedResult(res.data, pageSize),
      ),
  });

  useEffect(() => {
    fetchPlaylist();
  }, [id]);

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      trackEvent({
        feature: "personal",
        eventName: "personal_playlist_play",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
        metadata: {
          playlistId: playlist?.id,
          trackCount: tracks.length,
        },
      });
      setPlayerPlaylist(tracks);
      play(tracks[0], playlist?.id ?? "");
    }
  };

  const handleDownloadSelected = () => {
    if (tracks.length === 0) return;
    const selectedTracks = tracks.filter((t) =>
      selectedRowKeys.includes(t.id),
    );
    if (selectedTracks.length === 0) {
      message.warning(t("playlistDetail.selectTracksFirst"));
      return;
    }
    message.info(
      t("playlistDetail.startDownload", { count: selectedTracks.length }),
    );
    downloadTracks(selectedTracks, (completed: number, total: number) => {
      if (completed === total) {
        message.success(t("playlistDetail.downloadComplete", { count: total }));
        setIsSelectionMode(false);
        setSelectedRowKeys([]);
      }
    });
  };

  const handleCastPlaylistToMi = async (
    deviceId: string,
    deviceName: string,
  ) => {
    if (tracks.length === 0) {
      message.warning(t("player.miCastNoTrack"));
      return;
    }
    setIsCastingToMi(true);
    try {
      const castTracks = tracks.map((track) => ({
        url: `${window.location.origin}/api/track/stream/${track.id}`,
        title: `${track.name} - ${track.artist ?? ""}`,
        duration: track.duration || 0,
      }));

      await playMiDevicePlaylist({
        device_id: deviceId,
        tracks: castTracks,
        start_index: 0,
      });

      message.success(
        t("player.miCastPlaylistSuccess", {
          device: deviceName,
          count: castTracks.length,
        }),
      );
      setIsMiDeviceSelectorOpen(false);
    } catch (error) {
      console.error("Failed to cast playlist to Mi device:", error);
      message.error(t("player.miCastPlaylistFailed"));
    } finally {
      setIsCastingToMi(false);
    }
  };

  const handlePlayTrack = (track: Track) => {
    if (tracks.length > 0) {
      setPlayerPlaylist(tracks);
      play(track, -1);
    }
  };

  const handleDeletePlaylist = async () => {
    if (!id) return;
    try {
      const res = await deletePlaylist(id);
      if (res.code === 200) {
        message.success(t("common.success"));
        navigate("/recommended");
        window.location.reload();
      }
    } catch (error) {
      message.error(t("common.error"));
    }
  };

  const handleUpdatePlaylist = async () => {
    if (!id) return;
    try {
      const values = await form.validateFields();
      const res = await updatePlaylist(id, values.name);
      if (res.code === 200) {
        message.success(t("common.success"));
        setIsEditModalOpen(false);
        fetchPlaylist();
        // Refresh sidebar playlist list
        if (user?.id) {
          usePlaylistStore.getState().fetchPlaylists(mode, user.id);
        }
      }
    } catch (error) {
      message.error(t("common.error"));
    }
  };

  const handleRemoveTrack = async (trackId: string | number) => {
    if (!id) return;
    try {
      const res = await removeTrackFromPlaylist(id, trackId);
      if (res.code === 200) {
        message.success(t("playlistDetail.removedSuccess"));
        // 移除后只刷新 tracks 分页（无需重新拉 playlist 头部信息）
        reloadTracks();
      }
    } catch (error) {
      message.error(t("playlistDetail.removeFailed"));
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
            message.success(t("playlistDetail.moveSuccess"));
            fetchPlaylist();
          } else {
            message.warning(t("playlistDetail.addSuccessRemoveFailed"));
          }
        } else {
          message.success(t("common.success"));
        }
        setIsAddToPlaylistModalOpen(false);
      } else {
        message.error(t("common.error"));
      }
    } catch (error) {
      message.error(t("common.error"));
    }
  };

  // Filter tracks based on keyword
  const filteredTracks = useMemo(() => {
    if (!keyword) return tracks;
    const k = keyword.toLowerCase();
    return tracks.filter(
      (track) =>
        track.name.toLowerCase().includes(k) ||
        (track.artist || "").toLowerCase().includes(k),
    );
  }, [tracks, keyword]);

  // Sort tracks
  const sortedTracks = [...filteredTracks].sort((_a, _b) => {
    if (sort === "asc") return 0; // Default order (creation time usually)
    return 0; // TODO: Implement specific sorting if needed, for now keep default or reverse
  });

  // 每行「更多」菜单里的歌单专属操作（移入其他歌单 / 从当前歌单移除）。
  // 表格改用统一 TrackList（CSS Grid + 虚拟列表），列宽由 gridTemplateColumns
  // 显式给出，不再依赖 antd Table 的 colgroup —— Win 下表格单元格会竖排错位。
  const extraMenuItems = (record: Track): MenuProps["items"] => [
    {
      key: "move",
      label: t("playlistDetail.moveToPlaylist"),
      icon: <SwapOutlined />,
      onClick: () => {
        setSelectedTrack(record);
        setPendingAction("move");
        setIsAddToPlaylistModalOpen(true);
        getPlaylists(mode, user?.id)
          .then((res) => {
            if (res.code === 200) setPlaylists(res.data);
          })
          .catch(() => message.error(t("player.getPlaylistsFailed")));
      },
    },
    {
      key: "remove",
      label: t("playlistDetail.removeFromList"),
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => {
        modalApi.confirm({
          title: t("playlistDetail.confirmRemove"),
          onOk: () => handleRemoveTrack(record.id),
        });
      },
    },
  ];

  const coverUrl = playlist?.tracks?.[0]
    ? getCoverUrl(playlist.tracks[0].cover, playlist.tracks[0].id, 600)
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
              {t("playlistDetail.createdAt")}
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
                    title={t("playlistDetail.confirmDelete")}
                    description={t("playlistDetail.deleteWarning")}
                    onConfirm={handleDeletePlaylist}
                    okText={t("playlistDetail.disband")}
                    cancelText={t("common.cancel")}
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
                  <XiaoAiIcon
                    className={styles.actionIcon}
                    style={{ width: 18, height: 18 }}
                    onClick={() => {
                      setIsMiDeviceSelectorOpen(true);
                    }}
                  />
                  {isSelectionMode && (
                    <Space size={8} style={{ marginLeft: 16 }}>
                      <Button
                        type="text"
                        size="small"
                        onClick={handleDownloadSelected}
                      >
                        {t("playlistDetail.clickToDownload", {
                          count: selectedRowKeys.length,
                        })}
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
                        {t("common.cancel")}
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
                  placeholder={t("playlistDetail.searchPlaceholder")}
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
            <TrackList
              tracks={sortedTracks}
              loading={tracksLoading}
              showIndex
              showCover
              showArtist={false}
              showAlbum={false}
              showSource={false}
              showDuration
              showActions
              onPlay={handlePlayTrack}
              onRefresh={reloadTracks}
              extraMenuItems={extraMenuItems}
              rowSelection={
                isSelectionMode
                  ? {
                      selectedRowKeys,
                      onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
                    }
                  : undefined
              }
            />
            {/* 分页 sentinel：进入视口时自动 loadMore（useLoadMore 内部 IntersectionObserver） */}
            {hasMore && (
              <div
                ref={sentinelRef}
                style={{
                  padding: "12px 0",
                  textAlign: "center",
                  color: token.colorTextSecondary,
                  fontSize: 12,
                }}
              >
                {loadingMore ? "加载中…" : "上拉/滚动加载更多"}
              </div>
            )}
            {!hasMore && tracks.length > 0 && (
              <div
                style={{
                  padding: "12px 0",
                  textAlign: "center",
                  color: token.colorTextSecondary,
                  fontSize: 12,
                }}
              >
                — 已加载全部 {tracks.length} 首 —
              </div>
            )}
          </Col>
        </Row>
      </div>
      {modalContextHolder}
      <Modal
        title={t("playlistDetail.editPlaylist")}
        open={isEditModalOpen}
        onOk={handleUpdatePlaylist}
        onCancel={() => setIsEditModalOpen(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t("playlistDetail.listName")}
            rules={[
              {
                required: true,
                message: t("playlistDetail.enterListName") || "",
              },
            ]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          pendingAction === "move"
            ? t("playlistDetail.moveToPlaylist")
            : t("addToPlaylistModal.title")
        }
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
              <Text type="secondary">
                {item._count?.tracks || 0}{" "}
                {t("playlist.trackCount", { count: "" }).replace("首", "")}首
              </Text>
            </List.Item>
          )}
        />
      </Modal>
      <MiDeviceSelector
        open={isMiDeviceSelectorOpen}
        onClose={() => setIsMiDeviceSelectorOpen(false)}
        onSelectDevice={(device) =>
          handleCastPlaylistToMi(device.device_id, device.name)
        }
        loading={isCastingToMi}
      />
    </div>
  );
};

export default PlaylistDetail;
