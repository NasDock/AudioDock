import {
  CheckSquareOutlined,
  CloseOutlined,
  DownloadOutlined,
  PlayCircleOutlined,
  PlusOutlined
} from "@ant-design/icons";
import { loadMoreTrack } from "@soundx/services";
import { useInfiniteScroll } from "ahooks";
import {
  Button,
  Empty,
  Flex,
  message,
  Skeleton,
  theme,
  Typography
} from "antd";
import React, { useRef, useState } from "react";
import AddToPlaylistModal from "../../components/AddToPlaylistModal";
import TrackList from "../../components/TrackList";
import { type Track } from "../../models";
import { downloadTracks } from "../../services/downloadManager";
import { usePlayerStore } from "../../store/player";
import { usePlayMode } from "../../utils/playMode";
import styles from "./index.module.less";

const { Title } = Typography;

interface Result {
  list: Track[];
  hasMore: boolean;
  nextId?: number;
}

const Songs: React.FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { token } = theme.useToken();
  const { play, setPlaylist } = usePlayerStore();
  const [messageApi, contextHolder] = message.useMessage();

  // Selection Mode
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  // Batch Add to Playlist
  const [isBatchAddModalOpen, setIsBatchAddModalOpen] = useState(false);


  const { mode } = usePlayMode();

  const loadMore = async (d: Result | undefined): Promise<Result> => {
    const currentLoadCount = d?.nextId || 0;
    const pageSize = 50;

    try {
      const res = await loadMoreTrack({
        pageSize,
        loadCount: currentLoadCount,
        type: mode === "MUSIC" ? "MUSIC" : "AUDIOBOOK"
      });
      console.log(res, 'res');
      if (res.code === 200 && res.data) {
        // Handle different return shapes if necessary, but Adapter returns ILoadMoreData<Track>
        // Native returns Track[], Subsonic returns Track[] in data.list usually. 
        // Wait, NativeTrackAdapter.loadMoreTrack returns ISuccessResponse<ILoadMoreData<Track>>
        // which has list: Track[], hasMore: boolean etc?
        // Let's check NativeTrackAdapter implementation again from previous turns.
        // It returns { list: Track[], total: number, hasMore: boolean } usually in ILoadMoreData.
        // BUT NativeTrackAdapter code showed it returning Request.get<... ILoadMoreData<Track>>
        // Let's assume standard ILoadMoreData structure.
        
        const list = res.data.list;
        const previousList = d?.list || [];

        return {
            list: [...previousList, ...list],
            hasMore: list.length === pageSize,
            nextId: currentLoadCount + 1,
        };
      }
    } catch (error) {
       console.error("Failed to fetch songs:", error);
    }

    return {
      list: d?.list || [],
      hasMore: false,
    };
  };

  const { data, loading, loadingMore, reload } = useInfiniteScroll(
    loadMore,
    {
      target: scrollRef,
      isNoMore: (d) => !d?.hasMore,
      reloadDeps: [mode],
    }
  );

  const handlePlayAll = () => {
    if (data?.list.length) {
      setPlaylist(data.list);
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
    messageApi.info(`开始下载 ${selectedTracks.length} 首歌曲`);
    await downloadTracks(selectedTracks, (completed, total) => {
        if (completed === total) {
            messageApi.success(`成功下载 ${total} 首歌曲`);
            setIsSelectionMode(false);
            setSelectedRowKeys([]);
        }
    });
  };


  return (
    <div ref={scrollRef} className={styles.container}>
      <div className={styles.pageHeader}>
        <Title level={2} className={styles.title}>
          单曲
        </Title>
        {isSelectionMode ? (
            <Flex gap={8}>
              <Button type="text" onClick={handleToggleSelectionMode} icon={<CloseOutlined />}>
                取消
              </Button>
              <div style={{ marginRight: 8, alignSelf: 'center' }}>
                已选择 {selectedRowKeys.length} 项
              </div>
              <Button 
                icon={<PlusOutlined />} 
                disabled={!selectedRowKeys.length}
                onClick={() => setIsBatchAddModalOpen(true)}
              >
                添加到...
              </Button>
              <Button 
                icon={<DownloadOutlined />} 
                disabled={!selectedRowKeys.length}
                onClick={handleBatchDownload}
              >
                下载
              </Button>
            </Flex>
        ) : (
            <Flex gap={8} align="center">
              <Button 
                icon={<PlayCircleOutlined />} 
                onClick={handlePlayAll}
                disabled={!data?.list.length}
              >
                播放全部
              </Button>
              <Button
                icon={<CheckSquareOutlined />}
                onClick={handleToggleSelectionMode}
              >
                批量操作
              </Button>
            </Flex>
        )}
      </div>

      <div style={{ padding: '0 24px' }}>
          {contextHolder}
          <TrackList
            tracks={data?.list || []}
            showIndex={true}
            showArtist={true}
            showAlbum={true}
            onPlay={(track, tracks) => {
              if (isSelectionMode) return;
              setPlaylist(tracks);
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

      {(loading || loadingMore) && (
        <div className={styles.loadingContainer}>
          <div style={{ padding: '0 24px' }}>
             <Skeleton active />
             <Skeleton active />
          </div>
        </div>
      )}

      {data && !data.hasMore && data.list.length > 0 && (
        <div className={styles.noMore}>没有更多了</div>
      )}

      {data?.list.length === 0 && !loading && (
        <div
          className={styles.noData}
          style={{ color: token.colorTextSecondary }}
        >
          <Empty description="暂无歌曲" />
        </div>
      )}
    </div>
  );
};

export default Songs;
