import {
  AimOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  CaretRightOutlined,
  CloseOutlined,
  HeartFilled,
  HeartOutlined,
  OrderedListOutlined,
  PlusOutlined,
  SearchOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
} from "@ant-design/icons";
import {
  getAlbumById,
  getAlbumTracks,
  toggleAlbumLike,
  toggleAlbumUnLike,
} from "@soundx/services";
import { useRequest } from "ahooks";
import {
  Avatar,
  Button,
  Col,
  Flex,
  Input,
  Row,
  Space,
  theme,
  Typography,
} from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import AddToPlaylistModal from "../../components/AddToPlaylistModal";
import { useMessage } from "../../context/MessageContext";
import { type Album, type Track } from "../../models";
import { downloadTracks } from "../../services/downloadManager";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { getCoverUrl } from "../../utils";
import TrackList from "../TrackList";
import styles from "./index.module.less";

const { Title, Text } = Typography;

const Detail: React.FC = () => {
  const message = useMessage();
  const [searchParams] = useSearchParams();
  const id = searchParams.get("id");
  const { user } = useAuthStore();

  const [album, setAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [sortBy, setSortBy] = useState<"id" | "index" | "episodeNumber">(
    "episodeNumber",
  );
  const [keyword, setKeyword] = useState("");
  const [keywordMidValue, setKeywordMidValue] = useState("");
  const [isLiked, setIsLiked] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isBatchAddModalOpen, setIsBatchAddModalOpen] = useState(false);

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

  const pageSize = 50;

  // ... (like logic remains same)
  const { run: likeAlbum } = useRequest(toggleAlbumLike, {
    manual: true,
    onSuccess: (res) => {
      if (res.code === 200) {
        setIsLiked(true);
        message.success("收藏成功");
      }
    },
  });

  const { run: unlikeAlbumRequest } = useRequest(toggleAlbumUnLike, {
    manual: true,
    onSuccess: (res) => {
      if (res.code === 200) {
        setIsLiked(false);
        message.success("已取消收藏");
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
    currentSortBy: "id" | "index" | "episodeNumber",
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

  return (
    <div className={styles.detailWrapper}>
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
            opacity:
              !currentTrack || !tracks.some((t) => t.id === currentTrack.id)
                ? 0.3
                : 1,
            cursor:
              !currentTrack || !tracks.some((t) => t.id === currentTrack.id)
                ? "not-allowed"
                : "pointer",
          }}
          onClick={
            !currentTrack || !tracks.some((t) => t.id === currentTrack.id)
              ? undefined
              : locateCurrent
          }
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

      <div
        ref={containerRef}
        className={styles.detailContainer}
        onScroll={handleScroll}
      >
        {/* Header Banner */}
        <div
          className={styles.banner}
          style={{
            backgroundImage: `url(${getCoverUrl(album, album?.id)})`,
          }}
        >
          <div className={styles.bannerOverlay}></div>

          <Flex align="center" gap={16} className={styles.bannerContent}>
            <Avatar size={50} src={getCoverUrl(album, album?.id)} />
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
                          添加到...
                        </Button>
                        <Button
                          type="text"
                          size="small"
                          onClick={handleDownloadSelected}
                        >
                          下载 ({selectedRowKeys.length})
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

                  <Flex align="center" gap={4}>
                    <Button
                      type="text"
                      size="small"
                      className={styles.sortFieldBtn}
                      onClick={() => {
                        const sequence: ("id" | "index" | "episodeNumber")[] = [
                          "episodeNumber",
                          "index",
                          "id",
                        ];
                        const next =
                          sequence[
                            (sequence.indexOf(sortBy) + 1) % sequence.length
                          ];
                        setSortBy(next);
                      }}
                      style={{
                        color: token.colorTextSecondary,
                        fontSize: "12px",
                      }}
                    >
                      {sortBy === "id"
                        ? "入库顺序"
                        : sortBy === "index"
                          ? "专辑顺序"
                          : "优化排序"}
                    </Button>
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
                  </Flex>
                </div>
              </div>

              {/* Track List */}
              <TrackList
                tracks={tracks}
                loading={loading}
                type={album?.type}
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
              {/* Load More / Footer */}
              <div
                style={{
                  textAlign: "center",
                  marginTop: "32px",
                  paddingBottom: "48px",
                }}
              >
                {loading && page > 0 ? (
                  <Text type="secondary">正在努力加载中...</Text>
                ) : hasMore ? (
                  <Button
                    type="text"
                    onClick={() =>
                      id && fetchTracks(id, page, sort, keyword, sortBy)
                    }
                    style={{ color: token.colorTextSecondary }}
                  >
                    加载更多
                  </Button>
                ) : (
                  tracks.length > 0 && (
                    <div style={{ opacity: 0.4 }}>
                      <Text type="secondary" style={{ fontSize: "12px" }}>
                        — 已经到底啦 —
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
      </div>
    </div>
  );
};

export default Detail;
