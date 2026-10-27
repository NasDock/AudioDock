import {
  AimOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckSquareOutlined,
  CloseOutlined,
  DownloadOutlined,
  HeartFilled,
  HeartOutlined,
  PlayCircleOutlined,
  PlusOutlined
} from "@ant-design/icons";
import { loadMoreTrack, playMiDevicePlaylist } from "@soundx/services";
import { useInfiniteScroll } from "ahooks";
import {
  Button,
  Empty,
  Flex,
  message,
  Skeleton,
  theme,
  Tooltip,
  Typography
} from "antd";
import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AddToPlaylistModal from "../../components/AddToPlaylistModal";
import { MiDeviceSelector, XiaoAiIcon } from "../../components/MiDeviceSelector";
import TrackList from "../../components/TrackList";
import { type Track } from "../../models";
import { downloadTracks } from "../../services/downloadManager";
import { useLibraryStore } from "../../store/library";
import { usePlayerStore } from "../../store/player";
import { usePlayMode } from "../../utils/playMode";
import styles from "./index.module.less";

const { Title } = Typography;

interface Result {
  list: Track[];
  hasMore: boolean;
  nextLoadCount: number;
  total?: number;
}

const Songs: React.FC = () => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { token } = theme.useToken();
  const { play, setPlaylist, appendTracks, playlistSource, currentTrack } = usePlayerStore();
  const [messageApi, contextHolder] = message.useMessage();

  // Selection Mode
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  // Batch Add to Playlist
  const [isBatchAddModalOpen, setIsBatchAddModalOpen] = useState(false);

  // Mi Speaker cast state
  const [isMiDeviceSelectorOpen, setIsMiDeviceSelectorOpen] = useState(false);
  const [isCastingToMi, setIsCastingToMi] = useState(false);

  const { mode } = usePlayMode();
  const { heartbeatModeActive, toggleHeartbeatMode } = useLibraryStore();

  // 单曲列表的排序方式（心动模式），播放队列续载时必须与之一致
  const trackSortBy =
    mode === "MUSIC" && heartbeatModeActive ? "heartbeat" : undefined;

  // 当前播放队列是否就是本列表形成的（来源一致才允许加载更多时自动追加）
  const isQueueFromThisList =
    playlistSource?.type === "tracks" &&
    playlistSource.params?.trackSortBy === trackSortBy;

  // 点击播放时构建的播放队列来源描述，供播放中自动续载/追加使用
  const buildPlaylistSource = () => ({
    type: "tracks" as const,
    pageSize: 50,
    // nextLoadCount 是下一页的 loadCount，已加载的最后一页下标要 -1
    currentPage: (data?.nextLoadCount ?? 1) - 1,
    hasMore: data?.hasMore ?? true,
    params: { trackSortBy },
  });

  const loadMore = async (d: Result | undefined): Promise<Result> => {
    const currentLoadCount = d?.nextLoadCount ?? 0;
    const pageSize = 50;

    try {
      const res = await loadMoreTrack({
        pageSize,
        loadCount: currentLoadCount,
        type: mode === "MUSIC" ? "MUSIC" : "AUDIOBOOK",
        sortBy: trackSortBy,
      });
      if (res.code === 200 && res.data) {
        const list = res.data.list || [];
        const total = res.data.total ?? list.length;
        const hasMore =
          typeof res.data.hasMore === "boolean"
            ? res.data.hasMore
            : list.length === pageSize;

        // 列表加载出新一页后，同步追加到由本列表形成的当前播放队列
        // （appendTracks 内部去重；首次加载/已存在的曲目不会重复追加）
        if (list.length > 0 && isQueueFromThisList) {
          appendTracks(list, hasMore);
        }

        return {
          list,
          hasMore,
          nextLoadCount: currentLoadCount + 1,
          total,
        };
      }
    } catch (error) {
       console.error("Failed to fetch songs:", error);
    }

    return {
      list: d?.list || [],
      hasMore: false,
      nextLoadCount: d?.nextLoadCount ?? d?.list.length ?? 0,
      total: d?.total,
    };
  };

  const { data, loading, loadingMore, reload } = useInfiniteScroll(
    loadMore,
    {
      target: scrollRef,
      isNoMore: (d) => !d?.hasMore,
      reloadDeps: [mode, heartbeatModeActive],
    }
  );

  const handlePlayAll = () => {
    if (data?.list.length) {
      setPlaylist(data.list, buildPlaylistSource());
      play(data.list[0]);
    }
  };

  const handleToggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode);
    setSelectedRowKeys([]);
  };

  const selectedTracks = data?.list.filter(t => selectedRowKeys.includes(t.id)) || [];

  const handleBatchDownload = async () => {
    if (!selectedTracks.length) return;
    messageApi.info(`${t("songs.startDownload")} ${selectedTracks.length} ${t("songs.trackCount")}`);
    await downloadTracks(selectedTracks, (completed, total) => {
        if (completed === total) {
            messageApi.success(`${t("songs.downloadSuccess")} ${total} ${t("songs.trackCount")}`);
            setIsSelectionMode(false);
            setSelectedRowKeys([]);
        }
    });
  };

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const scrollToBottom = () => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
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

  const handleCastTracksToMi = async (deviceId: string, deviceName: string) => {
    if (!data?.list.length) {
      messageApi.warning(t("player.miCastNoTrack"));
      return;
    }
    setIsCastingToMi(true);
    try {
      const trackPayloads = data.list.map((track) => ({
        url: `${window.location.origin}/api/track/stream/${track.id}`,
        title: `${track.name} - ${track.artist ?? ""}`,
        duration: track.duration || 0,
      }));

      await playMiDevicePlaylist({
        device_id: deviceId,
        tracks: trackPayloads,
        start_index: 0,
      });

      messageApi.success(t("player.miCastPlaylistSuccess", { device: deviceName, count: trackPayloads.length }));
      setIsMiDeviceSelectorOpen(false);
    } catch (error) {
      console.error("Failed to cast tracks to Mi device:", error);
      messageApi.error(t("player.miCastPlaylistFailed"));
    } finally {
      setIsCastingToMi(false);
    }
  };

  const showFloatingActions = (data?.list.length || 0) > 50;
  const canLocateCurrent =
    !!currentTrack && !!data?.list.some((t) => t.id === currentTrack.id);


  return (
    <>
      {/* 浮动快捷按钮组必须渲染在滚动容器（.container）之外：
          .container 上的 backdrop-filter 会为 position: fixed 后代创建包含块，
          放在里面 fixed 会失效、随列表滚动被带走 */}
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
          {/* 心动模式已挪到页头按钮组最右侧，不再放贴边浮动栏 */}
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

      <div ref={scrollRef} className={styles.container}>
      <div className={styles.pageHeader}>
        <Title level={2} className={styles.title}>
            {t("songs.title")}
          </Title>
        {isSelectionMode ? (
            <Flex gap={8}>
              {/* 除心动模式外均为纯图标按钮，文字走 Tooltip 悬停展示 */}
              <Tooltip title={t("songs.cancel")}>
                <Button type="text" onClick={handleToggleSelectionMode} icon={<CloseOutlined />} />
              </Tooltip>
              <div style={{ marginRight: 8, alignSelf: 'center' }}>
                {t("songs.selectedCount", { count: selectedRowKeys.length })}
              </div>
              <Tooltip title={t("songs.addTo")}>
                <Button
                  icon={<PlusOutlined />}
                  disabled={!selectedRowKeys.length}
                  onClick={() => setIsBatchAddModalOpen(true)}
                />
              </Tooltip>
              <Tooltip title={t("songs.download")}>
                <Button
                  icon={<DownloadOutlined />}
                  disabled={!selectedRowKeys.length}
                  onClick={handleBatchDownload}
                />
              </Tooltip>
              {mode === "MUSIC" && (
                <Button
                  type={heartbeatModeActive ? "primary" : "default"}
                  icon={heartbeatModeActive ? <HeartFilled /> : <HeartOutlined />}
                  onClick={toggleHeartbeatMode}
                >
                  {t("songs.heartbeatMode")}
                </Button>
              )}
            </Flex>
        ) : (
            <Flex gap={8} align="center">
              {/* 除心动模式外均为纯图标按钮，文字走 Tooltip 悬停展示 */}
              {mode === "MUSIC" && (
                <Tooltip title={t("player.castToMiSpeaker")}>
                  <Button
                    icon={<XiaoAiIcon style={{ width: 14, height: 14 }} />}
                    onClick={() => setIsMiDeviceSelectorOpen(true)}
                    disabled={!data?.list.length}
                  />
                </Tooltip>
              )}
              <Tooltip title={t("songs.playAll")}>
                <Button
                  icon={<PlayCircleOutlined />}
                  onClick={handlePlayAll}
                  disabled={!data?.list.length}
                />
              </Tooltip>
              <Tooltip title={t("songs.batchActions")}>
                <Button
                  icon={<CheckSquareOutlined />}
                  onClick={handleToggleSelectionMode}
                />
              </Tooltip>
              {mode === "MUSIC" && (
                <Button
                  type={heartbeatModeActive ? "primary" : "default"}
                  icon={heartbeatModeActive ? <HeartFilled /> : <HeartOutlined />}
                  onClick={toggleHeartbeatMode}
                >
                  {t("songs.heartbeatMode")}
                </Button>
              )}
            </Flex>
        )}
      </div>

      <div style={{ padding: '0 24px' }}>
          {contextHolder}
          <TrackList
            tracks={data?.list || []}
            loading={loading}
            showIndex={true}
            showArtist={true}
            showAlbum={true}
            showSource={true}
            onPlay={(track, tracks) => {
              if (isSelectionMode) return;
              setPlaylist(tracks, buildPlaylistSource());
              play(track, track.albumId);
            }}
            onRefresh={reload}
            rowSelection={isSelectionMode ? {
                selectedRowKeys,
                onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
            } : undefined}
          />
      </div>

      <AddToPlaylistModal
        open={isBatchAddModalOpen}
        onCancel={() => setIsBatchAddModalOpen(false)}
        tracks={selectedTracks}
        onSuccess={() => {
            setIsSelectionMode(false);
            setSelectedRowKeys([]);
        }}
      />

      <MiDeviceSelector
        open={isMiDeviceSelectorOpen}
        onClose={() => setIsMiDeviceSelectorOpen(false)}
        onSelectDevice={(device) => handleCastTracksToMi(device.device_id, device.name)}
        loading={isCastingToMi}
      />

      {(loading || loadingMore) && (
        <div className={styles.loadingContainer}>
          <div style={{ padding: '0 24px' }}>
             <Skeleton active />
             <Skeleton active />
          </div>
        </div>
      )}

      {data && data.list.length > 0 && (
        <div className={styles.noMore}>
          {t("songs.totalTracks", {
            count: data.total || data.list.length,
            loaded: data.list.length,
          })}
        </div>
      )}

      {data?.list.length === 0 && !loading && (
        <div
          className={styles.noData}
          style={{ color: token.colorTextSecondary }}
        >
          <Empty description={t("songs.noSongs")} />
        </div>
      )}
      </div>
    </>
  );
};

export default Songs;
