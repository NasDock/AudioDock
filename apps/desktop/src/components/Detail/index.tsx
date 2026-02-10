import {
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
import { Avatar, Button, Col, Flex, Input, Row, Space, theme, Typography } from "antd";
import React, { useEffect, useState } from "react";
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
  const [keyword, setKeyword] = useState("");
  const [keywordMidValue, setKeywordMidValue] = useState("");
  const [isLiked, setIsLiked] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isBatchAddModalOpen, setIsBatchAddModalOpen] = useState(false);

  const location = useLocation();
  const hasResumed = React.useRef(false);

  const { token } = theme.useToken();
  const { play, setPlaylist, currentAlbumId, playlist, appendTracks } = usePlayerStore();

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
      
      // If this is the current playing album, initialize from player store
      if (String(currentAlbumId) === String(id) && playlist.length > 0) {
        setTracks(playlist);
        setPage(Math.ceil(playlist.length / pageSize));
        setHasMore(usePlayerStore.getState().playlistSource?.hasMore ?? true);
      } else {
        // Reset list and fetch fresh
        setTracks([]);
        setPage(0);
        setHasMore(true);
        fetchTracks(id, 0, sort, keyword);
      }
    }
  }, [id, sort, keyword]);

  // Two-way Sync: Keep detail tracks in sync with player playlist if it's the same album
  useEffect(() => {
    if (String(currentAlbumId) === String(id) && playlist.length > 0) {
      setTracks(playlist);
      setHasMore(usePlayerStore.getState().playlistSource?.hasMore ?? true);
    }
  }, [playlist, currentAlbumId, id]);

  const fetchAlbumDetails = async (albumId: number | string) => {
    try {
      const res = await getAlbumById(albumId);
      if (res.code === 200) {
        setAlbum(res.data);
        // @ts-ignore
        const likedByUsers = res.data.likedByUsers || [];
        const isLikedByCurrentUser = likedByUsers.some(
          (like: any) => like.userId === user?.id
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
    currentKeyword: string
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
        user?.id
      );
      if (res.code === 200) {
        const newTracks = res.data.list;
        const totalHasMore = newTracks.length === pageSize;
        
        if (currentPage === 0) {
          setTracks(newTracks);
        } else {
          setTracks((prev) => [...prev, ...newTracks]);
        }

        // SYNC: If this is currently playing, append to player playlist
        if (String(currentAlbumId) === String(albumId)) {
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
      fetchTracks(id, page, sort, keyword);
    }
  };

  const handlePlayAll = (resumeTrackId?: string | number, resumeProgress?: number) => {
    if (tracks.length > 0 && album) {
      setPlaylist(tracks, {
        type: 'album',
        id: album.id,
        pageSize: pageSize,
        currentPage: Math.max(0, page - 1),
        hasMore: hasMore,
        params: { sort, keyword }
      });

      let targetTrack = tracks[0];
      let startTime = 0;

      if (resumeTrackId) {
        const found = tracks.find((t) => String(t.id) === String(resumeTrackId));
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
    fetchTracks(id, 0, sort, keyword);
  };


  return (
    <div
      className={styles.detailContainer}
      onScroll={handleScroll}
      style={{ overflowY: "auto", height: "100%" }}
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
                        album && user?.id && unlikeAlbumRequest(album.id, user.id)
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
              tracks={tracks}
              loading={loading}
              type={album?.type}
              onRefresh={handleRefresh}
              rowSelection={
                isSelectionMode
                  ? {
                      selectedRowKeys,
                      onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
                    }
                  : undefined
              }
              albumId={album?.id}
              playlistSource={album ? {
                  type: 'album' as const,
                  id: album.id,
                  pageSize: pageSize,
                  currentPage: page - 1,
                  hasMore: hasMore,
                  params: { sort, keyword }
              } : undefined}
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
                  onClick={() => id && fetchTracks(id, page, sort, keyword)}
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
        tracks={tracks.filter(t => selectedRowKeys.includes(t.id))}
        onSuccess={() => {
            setIsSelectionMode(false);
            setSelectedRowKeys([]);
        }}
      />
    </div>
  );
};

export default Detail;
