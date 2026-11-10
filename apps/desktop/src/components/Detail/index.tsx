import {
    AimOutlined,
    ArrowDownOutlined,
    ArrowUpOutlined,
    CaretRightOutlined,
    CloseOutlined,
    EllipsisOutlined,
    HeartFilled,
    HeartOutlined,
    OrderedListOutlined,
    PlusOutlined,
    SearchOutlined,
    SortAscendingOutlined,
    SortDescendingOutlined,
} from "@ant-design/icons";
import {
    type AlbumTrackSortBy,
    getAlbumById,
    getAlbumTracks,
    playMiDevicePlaylist,
    toggleAlbumLike,
    toggleAlbumUnLike,
    uploadAlbumCover,
    getMvsByAlbum,
} from "@soundx/services";
import type { Mv } from "@soundx/services";
import { useRequest } from "ahooks";
import {
    Avatar,
    Button,
    Col,
    Dropdown,
    Flex,
    Input,
    type MenuProps,
    Row,
    Space,
    theme,
    Typography,
} from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AddToPlaylistModal from "../../components/AddToPlaylistModal";
import { MiDeviceSelector, XiaoAiIcon } from "../../components/MiDeviceSelector";
import { useMessage } from "../../context/MessageContext";
import { type Album, type Track } from "../../models";
import { downloadTracks } from "../../services/downloadManager";
import { resolveArtworkUri } from "../../services/trackResolver";
import { useAuthStore } from "../../store/auth";
import { useMvPlaylistStore } from "../../store/mvPlaylist";
import { usePlayerStore } from "../../store/player";
import { getCoverUrl, isMvSupported } from "../../utils";
import LazyImage from "../LazyImage";
import TrackList from "../TrackList";
import styles from "./index.module.less";

const { Title, Text } = Typography;

const Detail: React.FC = () => {
  const message = useMessage();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get("id");
  const { user } = useAuthStore();
  const { setPlaylist: setMvPlaylist } = useMvPlaylistStore();

  const [album, setAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [mvs, setMvs] = useState<Mv[]>([]);
  const [activeTab, setActiveTab] = useState<"tracks" | "mvs">("tracks");
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [sortBy, setSortBy] = useState<AlbumTrackSortBy>(
    "fileName",
  );
  const [keyword, setKeyword] = useState("");
  const [keywordMidValue, setKeywordMidValue] = useState("");
  const [isLiked, setIsLiked] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isBatchAddModalOpen, setIsBatchAddModalOpen] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  // Mi Speaker cast state
  const [isMiDeviceSelectorOpen, setIsMiDeviceSelectorOpen] = useState(false);
  const [isCastingToMi, setIsCastingToMi] = useState(false);

  const location = useLocation();
  const hasResumed = React.useRef(false);

  const { token } = theme.useToken();
  const {
    play,
    setPlaylist,
    currentAlbumId,
    playlist,
    appendTracks,
    currentTrack,
  } = usePlayerStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const isAudioDockSource =
    (localStorage.getItem("selectedSourceType") || "AudioDock") === "AudioDock";

  const pageSize = 50;

  // ... (like logic remains same)
  const { run: likeAlbum } = useRequest(toggleAlbumLike, {
    manual: true,
    onSuccess: (res) => {
      if (res.code === 200) {
        setIsLiked(true);
        message.success(t('detail.liked'));
      }
    },
  });

  const { run: unlikeAlbumRequest } = useRequest(toggleAlbumUnLike, {
    manual: true,
    onSuccess: (res) => {
      if (res.code === 200) {
        setIsLiked(false);
        message.success(t('detail.unliked'));
      }
    },
  });

  useEffect(() => {
    if (id) {
      hasResumed.current = false;
      fetchAlbumDetails(id);

      const playerSource = usePlayerStore.getState().playlistSource;
      const playerParams = playerSource?.params;
      const isParamSame =
        playerParams?.sort === sort &&
        playerParams?.keyword === keyword &&
        playerParams?.sortBy === sortBy;

      // If this is the current playing album AND parameters match, initialize from player store
      if (
        String(currentAlbumId) === String(id) &&
        playlist.length > 0 &&
        isParamSame
      ) {
        setTracks(playlist);
        setPage(Math.ceil(playlist.length / pageSize));
        setHasMore(playerSource?.hasMore ?? true);
      } else {
        // Reset list and fetch fresh
        setTracks([]);
        setPage(0);
        setHasMore(true);
        fetchTracks(id, 0, sort, keyword, sortBy);
      }
    }
  }, [id, sort, keyword, sortBy]);

  // Two-way Sync: Keep detail tracks in sync with player playlist if it's the same album AND same parameters
  useEffect(() => {
    const playerSource = usePlayerStore.getState().playlistSource;
    const playerParams = playerSource?.params;
    const isParamSame =
      playerParams?.sort === sort &&
      playerParams?.keyword === keyword &&
      playerParams?.sortBy === sortBy;

    if (
      String(currentAlbumId) === String(id) &&
      playlist.length > 0 &&
      isParamSame
    ) {
      setTracks(playlist);
      setHasMore(playerSource?.hasMore ?? true);
    }
  }, [playlist, currentAlbumId, id, sort, keyword, sortBy]);

  const fetchAlbumDetails = async (albumId: number | string) => {
    try {
      const res = await getAlbumById(albumId);
      if (res.code === 200) {
        setAlbum(res.data);
        // @ts-ignore
        const likedByUsers = res.data.likedByUsers || [];
        const isLikedByCurrentUser = likedByUsers.some(
          (like: any) => like.userId === user?.id,
        );
        setIsLiked(isLikedByCurrentUser);
        
        // load MVs（飞牛音乐没有 MV 能力，跳过无效请求）
        if (isMvSupported() && res.data?.name) {
            getMvsByAlbum(res.data.name, res.data.artist).then((mvRes: any[]) => {
                if (mvRes?.length) {
                    setMvs(mvRes);
                }
            }).catch((e: any) => console.error(e));
        }
      }
    } catch (error) {
      console.error("Failed to fetch album details:", error);
    }
  };

  const fetchTracks = async (
    albumId: number | string,
    currentPage: number,
    currentSort: "asc" | "desc",
    currentKeyword: string,
    currentSortBy: AlbumTrackSortBy,
  ) => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await getAlbumTracks(
        albumId,
        pageSize,
        currentPage * pageSize,
        currentSort,
        currentKeyword,
        user?.id,
        currentSortBy,
      );
      if (res.code === 200) {
        const newTracks = res.data.list;
        const totalHasMore = newTracks.length === pageSize;

        if (currentPage === 0) {
          setTracks(newTracks);
        } else {
          setTracks((prev) => [...prev, ...newTracks]);
        }

        // SYNC: If this is currently playing AND parameters match, append to player playlist
        const playerSource = usePlayerStore.getState().playlistSource;
        const playerParams = playerSource?.params;
        const isParamSame =
          playerParams?.sort === currentSort &&
          playerParams?.keyword === currentKeyword &&
          playerParams?.sortBy === currentSortBy;

        if (String(currentAlbumId) === String(albumId) && isParamSame) {
          appendTracks(newTracks, totalHasMore);
        }

        setHasMore(totalHasMore);
        setPage(currentPage + 1);
      }
    } catch (error) {
      console.error("Failed to fetch tracks:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (
      scrollHeight - scrollTop < clientHeight + 100 &&
      hasMore &&
      !loading &&
      id
    ) {
      fetchTracks(id, page, sort, keyword, sortBy);
    }
  };

  const handleCoverFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !album) return;
    if (!isAudioDockSource) {
      message.warning(t('detail.audioDockOnlyCover'));
      return;
    }
    try {
      setUploadingCover(true);
      const res = await uploadAlbumCover(album.id, file);
      if (res.code === 200) {
        setAlbum(res.data);
        message.success(t('detail.coverUpdated'));
      } else {
        message.error(res.message || t('detail.coverUploadFailed'));
      }
    } catch (error) {
      console.error("Failed to upload album cover:", error);
      message.error(t('detail.coverUploadFailed'));
    } finally {
      setUploadingCover(false);
    }
  };


  const coverMenuItems: MenuProps["items"] = [
    {
      key: "upload",
      label: t('detail.modifyCover'),
      onClick: () => coverInputRef.current?.click(),
      disabled: uploadingCover || !isAudioDockSource,
    },
  ].filter(Boolean) as MenuProps["items"];

  const handlePlayAll = (
    resumeTrackId?: string | number,
    resumeProgress?: number,
  ) => {
    if (tracks.length > 0 && album) {
      setPlaylist(tracks, {
        type: "album",
        id: album.id,
        pageSize: pageSize,
        currentPage: Math.max(0, page - 1),
        hasMore: hasMore,
        params: { sort, keyword, sortBy },
      });

      let targetTrack = tracks[0];
      let startTime = 0;

      if (resumeTrackId) {
        const found = tracks.find(
          (t) => String(t.id) === String(resumeTrackId),
        );
        if (found) {
          targetTrack = found;
          startTime = resumeProgress || 0;
        }
      }

      play(targetTrack, album.id, startTime);
    }
  };

  // Auto-resume from navigation state
  useEffect(() => {
    if (tracks.length > 0 && !hasResumed.current) {
      const state = location.state as any;
      if (state?.resumeTrackId) {
        handlePlayAll(state.resumeTrackId, state.resumeProgress);
        hasResumed.current = true;
      }
    }
  }, [tracks, location.state]);

  const handleDownloadSelected = () => {
    const selectedTracks = tracks.filter((t) => selectedRowKeys.includes(t.id));
    if (selectedTracks.length === 0) {
      message.warning(t('detail.selectTracksFirst'));
      return;
    }
    message.info(t('detail.downloadStarted', { count: selectedTracks.length }));
    downloadTracks(selectedTracks, (completed: number, total: number) => {
      if (completed === total) {
        message.success(t('detail.downloadComplete', { count: total }));
        setIsSelectionMode(false);
        setSelectedRowKeys([]);
      }
    });
  };

  const handleRefresh = () => {
    // When a track is deleted or updated, we should refresh the list.
    // Ideally we re-fetch the current view.
    if (!id) return;
    // Simple approach: reset
    setTracks([]);
    setPage(0);
    setHasMore(true);
    fetchTracks(id, 0, sort, keyword, sortBy);
  };

  const scrollToTop = () => {
    containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const scrollToBottom = () => {
    containerRef.current?.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: "smooth",
    });
  };

  const locateCurrent = () => {
    if (!currentTrack) return;
    const element = document.getElementById(`track-${currentTrack.id}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  const showFloatingActions = tracks.length > 50;
  const canLocateCurrent =
    !!currentTrack && tracks.some((t) => t.id === currentTrack.id);
  const isAudiobookAlbum = album?.type === "AUDIOBOOK";

  const handleCastAlbumToMi = async (deviceId: string, deviceName: string) => {
    if (tracks.length === 0) {
      message.warning(t("player.miCastNoTrack"));
      return;
    }
    setIsCastingToMi(true);
    try {
      const trackPayloads = tracks.map((track) => ({
        url: `${window.location.origin}/api/track/stream/${track.id}`,
        title: `${track.name} - ${track.artist ?? ""}`,
        duration: track.duration || 0,
      }));

      await playMiDevicePlaylist({
        device_id: deviceId,
        tracks: trackPayloads,
        start_index: 0,
      });

      message.success(t("player.miCastPlaylistSuccess", { device: deviceName, count: trackPayloads.length }));
      setIsMiDeviceSelectorOpen(false);
    } catch (error) {
      console.error("Failed to cast album to Mi device:", error);
      message.error(t("player.miCastPlaylistFailed"));
    } finally {
      setIsCastingToMi(false);
    }
  };

  const sortMenuItems: MenuProps["items"] = [
    {
      key: "sort-fileName",
      label: t("detail.sortByFileName"),
    },
    {
      key: "sort-episodeNumber",
      label: t("detail.sortByOptimized"),
    },
    {
      key: "sort-fileCreatedAt",
      label: t("detail.sortByFileCreatedAt"),
    },
    {
      key: "sort-fileModifiedAt",
      label: t("detail.sortByFileModifiedAt"),
    },
    {
      type: "divider",
    },
    {
      key: "order-asc",
      label: t("detail.sortAscending"),
    },
    {
      key: "order-desc",
      label: t("detail.sortDescending"),
    },
  ];

  return (
    <div className={styles.detailWrapper}>
      {showFloatingActions && (
        <div className={styles.floatingActions}>
          <div
            className={styles.floatingButton}
            style={{
              backgroundColor: token.colorBgElevated,
              color: token.colorPrimary,
            }}
            onClick={scrollToTop}
          >
            <ArrowUpOutlined />
          </div>
          <div
            className={styles.floatingButton}
            style={{
              backgroundColor: token.colorBgElevated,
              color: token.colorPrimary,
              opacity: canLocateCurrent ? 1 : 0.3,
              cursor: canLocateCurrent ? "pointer" : "not-allowed",
            }}
            onClick={canLocateCurrent ? locateCurrent : undefined}
          >
            <AimOutlined />
          </div>
          <div
            className={styles.floatingButton}
            style={{
              backgroundColor: token.colorBgElevated,
              color: token.colorPrimary,
            }}
            onClick={scrollToBottom}
          >
            <ArrowDownOutlined />
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className={styles.detailContainer}
        onScroll={handleScroll}
      >
        {/* Header Banner */}
        <div
          className={styles.banner}
          style={{
            // 全屏模糊背景：模糊会抹掉细节，用最小档即可，视觉无损
            backgroundImage: `url(${getCoverUrl(album, album?.id, 128)})`,
          }}
        >
          <div className={styles.bannerOverlay}></div>

          <Flex align="center" gap={16} className={styles.bannerContent}>
            <div className={styles.coverWrapper}>
              <Avatar size={50} src={getCoverUrl(album, album?.id, 128)} />
              <Dropdown menu={{ items: coverMenuItems }} trigger={["click"]}>
                <div className={styles.coverMenuButton}>
                  <EllipsisOutlined />
                </div>
              </Dropdown>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleCoverFileChange}
              />
            </div>
            <Flex vertical gap={0}>
              <Title level={4} style={{ color: "#fff", margin: 0 }}>
                {album?.name || "Unknown Album"}
              </Title>
              <Text type="secondary" style={{ color: "#ccc" }}>
                {album?.artist || "Unknown Artist"}
              </Text>
            </Flex>
          </Flex>
        </div>

        <div
          className={styles.contentPadding}
          style={{ color: token.colorText }}
        >
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
                      onClick={() => handlePlayAll()}
                      style={{
                        color: token.colorTextSecondary,
                        fontSize: "30px",
                      }}
                    />
                  </div>
                  <Typography.Text
                    type="secondary"
                    className={styles.actionGroup}
                  >
                    {isAudiobookAlbum && activeTab === "tracks" && (
                      <Dropdown
                        menu={{
                          items: sortMenuItems,
                          onClick: ({ key }) => {
                            if (key.startsWith("sort-")) {
                              setSortBy(key.replace("sort-", "") as AlbumTrackSortBy);
                            } else if (key === "order-asc") {
                              setSort("asc");
                            } else if (key === "order-desc") {
                              setSort("desc");
                            }
                          },
                          selectable: false,
                        }}
                        trigger={["click"]}
                      >
                        <Button
                          type="text"
                          size="small"
                          className={styles.iconOnlyButton}
                          icon={
                            sort === "asc" ? (
                              <SortAscendingOutlined className={styles.actionIcon} />
                            ) : (
                              <SortDescendingOutlined className={styles.actionIcon} />
                            )
                          }
                        />
                      </Dropdown>
                    )}
                    {isLiked ? (
                      <HeartFilled
                        className={styles.actionIcon}
                        style={{ color: "#ff4d4f" }}
                        onClick={() =>
                          album &&
                          user?.id &&
                          unlikeAlbumRequest(album.id, user.id)
                        }
                      />
                    ) : (
                      <HeartOutlined
                        className={styles.actionIcon}
                        onClick={() =>
                          album && user?.id && likeAlbum(album.id, user.id)
                        }
                      />
                    )}
                    {!isSelectionMode && !isAudiobookAlbum && activeTab === "tracks" && (
                      <XiaoAiIcon
                        className={styles.actionIcon}
                        style={{ width: 18, height: 18 }}
                        onClick={() => {
                          setIsMiDeviceSelectorOpen(true);
                        }}
                      />
                    )}
                    <OrderedListOutlined
                      className={styles.actionIcon}
                      onClick={() => {
                        setIsSelectionMode(true);
                      }}
                    />
                    {isSelectionMode && (
                      <Space size={8} style={{ marginLeft: 16 }}>
                        <Button
                          icon={<PlusOutlined />}
                          size="small"
                          onClick={() => setIsBatchAddModalOpen(true)}
                        >
                          {t('detail.addTo')}...
                        </Button>
                        <Button
                          type="text"
                          size="small"
                          onClick={handleDownloadSelected}
                        >
                          {t('detail.downloading', { count: selectedRowKeys.length })}
                        </Button>
                        <Button
                          size="small"
                          type="text"
                          icon={<CloseOutlined />}
                          onClick={() => {
                            setIsSelectionMode(false);
                            setSelectedRowKeys([]);
                          }}
                        />
                      </Space>
                    )}
                  </Typography.Text>
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
                  />
                </div>
              </div>

              {isMvSupported() && mvs.length > 0 && (
                <div style={{ display: 'flex', gap: 24, marginBottom: 24, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                  <div
                    style={{
                      padding: '12px 0',
                      cursor: 'pointer',
                      color: activeTab === 'tracks' ? token.colorPrimary : token.colorText,
                      borderBottom: activeTab === 'tracks' ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
                      fontWeight: activeTab === 'tracks' ? 'bold' : 'normal'
                    }}
                    onClick={() => setActiveTab('tracks')}
                  >
                    {t('nav.tracks')} ({tracks.length})
                  </div>
                  <div
                    style={{
                      padding: '12px 0',
                      cursor: 'pointer',
                      color: activeTab === 'mvs' ? token.colorPrimary : token.colorText,
                      borderBottom: activeTab === 'mvs' ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
                      fontWeight: activeTab === 'mvs' ? 'bold' : 'normal'
                    }}
                    onClick={() => setActiveTab('mvs')}
                  >
                    MV ({mvs.length})
                  </div>
                </div>
              )}

              {/* Track List */}
              {isMvSupported() && activeTab === 'mvs' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {mvs.map((mv, index) => (
                    <div 
                      key={mv.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px',
                        cursor: 'pointer',
                        borderRadius: 8,
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = token.colorFillAlter}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                      onClick={() => {
                        setMvPlaylist(mvs, index);
                        navigate(`/mv/${mv.id}`);
                      }}
                    >
                      <div style={{ width: 40, textAlign: 'center', color: token.colorTextSecondary }}>
                        {index + 1}
                      </div>
                      <LazyImage
                        src={resolveArtworkUri(mv, { width: 160, format: "webp" })}
                        alt={mv.name}
                        width={80}
                        height={45}
                        style={{ borderRadius: 4, marginRight: 16 }}
                      />
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ color: token.colorText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {mv.name}
                        </div>
                      </div>
                      <div style={{ width: 80, textAlign: 'right', color: token.colorTextSecondary }}>
                        {mv.duration ? `${Math.floor(mv.duration / 60)}:${String(mv.duration % 60).padStart(2, '0')}` : '--:--'}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <TrackList
                  tracks={tracks}
                  loading={loading}
                  type={album?.type}
                  showSource={true}
                  onRefresh={handleRefresh}
                  rowSelection={
                    isSelectionMode
                      ? {
                          selectedRowKeys,
                          onChange: (keys: React.Key[]) =>
                            setSelectedRowKeys(keys),
                        }
                      : undefined
                  }
                  albumId={album?.id}
                  playlistSource={
                    album
                      ? {
                          type: "album" as const,
                          id: album.id,
                          pageSize: pageSize,
                          currentPage: page - 1,
                          hasMore: hasMore,
                          params: { sort, keyword, sortBy },
                        }
                      : undefined
                  }
                />
              )}
              {/* Load More / Footer */}
              <div
                style={{
                  textAlign: "center",
                  marginTop: "32px",
                  paddingBottom: "48px",
                }}
              >
                {loading && page > 0 ? (
                  <Text type="secondary">{t('detail.loading')}</Text>
                ) : hasMore ? (
                  <Button
                    type="text"
                    onClick={() =>
                      id && fetchTracks(id, page, sort, keyword, sortBy)
                    }
                    style={{ color: token.colorTextSecondary }}
                  >
                    {t('detail.loadMore')}
                  </Button>
                ) : (
                  tracks.length > 0 && (
                    <div style={{ opacity: 0.4 }}>
                      <Text type="secondary" style={{ fontSize: "12px" }}>
                        — {t('detail.noMore')} —
                      </Text>
                    </div>
                  )
                )}
              </div>
            </Col>
          </Row>
        </div>
        <AddToPlaylistModal
          open={isBatchAddModalOpen}
          onCancel={() => setIsBatchAddModalOpen(false)}
          tracks={tracks.filter((t) => selectedRowKeys.includes(t.id))}
          onSuccess={() => {
            setIsSelectionMode(false);
            setSelectedRowKeys([]);
          }}
        />
        <MiDeviceSelector
          open={isMiDeviceSelectorOpen}
          onClose={() => setIsMiDeviceSelectorOpen(false)}
          onSelectDevice={(device) => handleCastAlbumToMi(device.device_id, device.name)}
          loading={isCastingToMi}
        />
      </div>
    </div>
  );
};

export default Detail;
