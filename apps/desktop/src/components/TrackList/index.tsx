import {
    CloudDownloadOutlined,
    DeleteOutlined,
    HeartFilled,
    HeartOutlined,
    MoreOutlined,
    PauseCircleFilled,
    PlayCircleFilled,
    PlayCircleOutlined,
    PlusOutlined,
} from "@ant-design/icons";
import {
    addTrackToPlaylist,
    deleteTrack,
    getDeletionImpact,
    getPlaylists,
    type Playlist,
} from "@soundx/services";
import {
    Dropdown,
    List,
    type MenuProps,
    Modal,
    Table,
    Typography,
} from "antd";
import type { ColumnProps } from "antd/es/table";
import React, { useState } from "react";
import { useMessage } from "../../context/MessageContext";
import { type Track, TrackType } from "../../models";
import { downloadTrack } from "../../services/downloadManager";
import { useAuthStore } from "../../store/auth";
import { type PlaylistSource, usePlayerStore } from "../../store/player";
import { getCoverUrl } from "../../utils";
import { formatDuration } from "../../utils/formatDuration";
import { usePlayMode } from "../../utils/playMode";
import PlayingIndicator from "../PlayingIndicator";
import styles from "./index.module.less";

const { Text } = Typography;

export interface TrackListProps {
  tracks: Track[];
  loading?: boolean;
  type?: TrackType; // Context type (e.g. if we are in an audiobook album)
  showIndex?: boolean;
  showCover?: boolean;
  showArtist?: boolean;
  showAlbum?: boolean;
  showActions?: boolean;
  showDuration?: boolean;
  onPlay?: (track: Track, tracks: Track[]) => void;
  onRefresh?: () => void; // Called after delete/like etc if needed
  rowSelection?: any; // Ant Design Table rowSelection
  albumId?: number | string;
  playlistSource?: PlaylistSource;
}

const TrackList: React.FC<TrackListProps> = ({
  tracks,
  loading = false,
  type,
  showIndex = true,
  showCover = true,
  showArtist = false,
  showAlbum = false,
  showActions = true,
  showDuration = true,
  onPlay,
  onRefresh,
  rowSelection,
  albumId,
  playlistSource,
}) => {
  const message = useMessage();
  const { user } = useAuthStore();
  const { play, setPlaylist, currentTrack, isPlaying, pause, removeTrack, toggleLike } =
    usePlayerStore();
  const { mode } = usePlayMode();

  // Modal states
  const [isAddToPlaylistModalOpen, setIsAddToPlaylistModalOpen] =
    useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [modalApi, contextHolder] = Modal.useModal();

  const handlePlayTrack = (track: Track) => {
    if (onPlay) {
      onPlay(track, tracks);
      return;
    }

    if (track.id === currentTrack?.id && isPlaying) {
      pause();
      return;
    }

    setPlaylist(tracks, playlistSource);
    const shouldResume =
      (type === TrackType.AUDIOBOOK || track.type === TrackType.AUDIOBOOK) &&
      track.progress &&
      track.progress > 0;
    
    // Attempt to use albumId from track if available, though Detail component passed the context albumId.
    // Ideally tracks in the list have albumId populated.
    play(track, albumId, shouldResume ? track.progress : 0);
  };

  const handleToggleLike = async (
    e: React.MouseEvent,
    track: Track,
    actionType: "like" | "unlike"
  ) => {
    e.stopPropagation();
    try {
      await toggleLike(track.id, actionType);
      // Optimistic update or refresh?
      // For now, we rely on parent to refresh or we just update local state if we had it.
      // But tracks are props. We can call onRefresh.
      if (onRefresh) onRefresh();
      
      // Since we can't easily mutate the props 'tracks', we rely on the component using this to re-fetch 
      // OR we could update a local state, but keeping it simple for now. 
      // NOTE: Detail page re-fetches or updates state. toggleLike is a promise.
      // We might need a way to update the track 'likedByUsers' in the UI immediately.
      // Modifying the track object in place is dirty but works for display if valid React update triggers.
      // Better: The parent handles data.
    } catch (error) {
      message.error("操作失败");
    }
  };

  const openAddToPlaylistModal = async (e: React.MouseEvent, track: Track) => {
    e.stopPropagation();
    setSelectedTrack(track);
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

  const handleAddToPlaylist = async (playlistId: number | string) => {
    if (!selectedTrack) return;
    try {
      const res = await addTrackToPlaylist(playlistId, selectedTrack.id);
      if (res.code === 200) {
        message.success("添加成功");
        setIsAddToPlaylistModalOpen(false);
      } else {
        message.error("添加失败");
      }
    } catch (error) {
      message.error("添加失败");
    }
  };

  const handleDeleteSubTrack = async (track: Track) => {
    try {
      const { data: impact } = await getDeletionImpact(track.id);

      modalApi.confirm({
        title: "确定删除该音频文件吗?",
        content: impact?.isLastTrackInAlbum
          ? `这是专辑《${impact.albumName}》的最后一个音频，删除后该专辑也将被同步删除。`
          : "删除后将无法恢复，且会同步删除本地原文件。",
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        onOk: async () => {
          try {
            const res = await deleteTrack(track.id, impact?.isLastTrackInAlbum);
            if (res.code === 200) {
              message.success("删除成功");
              removeTrack(track.id);
              if (onRefresh) onRefresh();
            } else {
              message.error("删除失败");
            }
          } catch (error) {
            message.error("删除失败");
          }
        },
      });
    } catch (error) {
      message.error("获取删除影响失败");
    }
  };

  const columns: ColumnProps<Track>[] = [
    ...(showIndex
      ? [
          {
            title: "#",
            key: "index",
            width: 70,
            render: (_: any, __: Track, index: number) => (
              <Text>{index + 1}</Text>
            ),
          } as ColumnProps<Track>,
        ]
      : []),
    ...(showCover
      ? [
          {
            title: "封面",
            key: "cover",
            width: 60,
            render: (_: any, record: Track) => (
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
            ),
          } as ColumnProps<Track>,
        ]
      : []),
    {
      title: "标题",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (text: string, record: Track) => (
        <Text
          type={
            // If it's audiobook context OR track itself says it is audiobook
            (type === TrackType.AUDIOBOOK || record.type === TrackType.AUDIOBOOK) &&
            Number(record?.progress) > 0
              ? "secondary"
              : undefined
          }
          strong={currentTrack?.id === record.id}
        >
          {text}
        </Text>
      ),
    },
    ...(showArtist
      ? [
          {
            title: "艺术家",
            dataIndex: "artist",
            key: "artist",
            ellipsis: true,
            render: (text: string) => <Text type="secondary">{text}</Text>,
          } as ColumnProps<Track>,
        ]
      : []),
    ...(showAlbum
      ? [
          {
            title: "专辑",
            dataIndex: ["album", "name"] as any, // Handle object or string based on backend?
            key: "album",
            ellipsis: true,
            render: (_: string, record: any) => {
               const albumName = typeof record.album === 'object' ? record.album?.name : record.album;
               return <Text type="secondary">{albumName}</Text>;
            },
          } as ColumnProps<Track>,
        ]
      : []),
    // Progress column for audiobook
    ...((type === TrackType.AUDIOBOOK)
      ? [
          {
            title: "进度",
            dataIndex: "progress",
            key: "progress",
            width: 70,
            render: (progress: number | undefined, record: Track) => {
              if (!progress) return <Text type="secondary">-</Text>;
              const percentage =
                record.duration && record.duration > 0
                  ? Math.round((progress / record.duration) * 100)
                  : 0;
              return (
                <Text type="secondary" style={{ fontSize: "10px" }}>
                  {percentage}%
                </Text>
              );
            },
          } as ColumnProps<Track>,
        ]
      : []),
    ...(showDuration
      ? [
          {
            title: "时长",
            dataIndex: "duration",
            key: "duration",
            width: 80,
            render: (duration: number) => (
              <Text type="secondary">{formatDuration(duration)}</Text>
            ),
          } as ColumnProps<Track>,
        ]
      : []),
    ...(showActions
      ? [
          {
            title: <MoreOutlined />,
            key: "actions",
            width: 30,
            render: (_: any, record: Track) => {
              const items: MenuProps["items"] = [
                {
                  key: "play",
                  label: "播放",
                  icon: <PlayCircleOutlined />,
                  onClick: (info) => {
                    info.domEvent.stopPropagation();
                    handlePlayTrack(record);
                  },
                },
                {
                  key: "like",
                  label: (record as any).likedByUsers?.some(
                    (like: any) => like.userId === user?.id
                  )
                    ? "取消收藏"
                    : "收藏",
                  icon: (record as any).likedByUsers?.some(
                    (like: any) => like.userId === user?.id
                  ) ? (
                    <HeartFilled style={{ color: "#ff4d4f" }} />
                  ) : (
                    <HeartOutlined />
                  ),
                  onClick: (info) => {
                    info.domEvent.stopPropagation();
                    handleToggleLike(
                      info.domEvent as any,
                      record,
                      (record as any).likedByUsers?.some(
                        (like: any) => like.userId === user?.id
                      )
                        ? "unlike"
                        : "like"
                    );
                  },
                },
                {
                  key: "add",
                  label: "添加到播放列表",
                  icon: <PlusOutlined />,
                  onClick: (info) => {
                    info.domEvent.stopPropagation();
                    openAddToPlaylistModal(info.domEvent as any, record);
                  },
                },
                {
                   key: "download",
                   label: "下载",
                   icon: <CloudDownloadOutlined />,
                   onClick: (info) => {
                     info.domEvent.stopPropagation();
                     message.info(`正在下载 ${record.name}...`);
                     downloadTrack(record).then(success => {
                       if (success) message.success(`${record.name} 下载成功`);
                       else message.error(`${record.name} 下载失败`);
                     });
                   }
                },
                {
                  key: "delete",
                  label: "删除",
                  icon: <DeleteOutlined />,
                  danger: true,
                  onClick: (info) => {
                    info.domEvent.stopPropagation();
                    handleDeleteSubTrack(record);
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
          } as ColumnProps<Track>,
        ]
      : []),
  ];

  return (
    <div className={styles.trackListContainer}>
      {contextHolder}
      <Table
        dataSource={tracks}
        columns={columns}
        pagination={false}
        rowKey="id"
        loading={loading}
        rowSelection={rowSelection}
        rowClassName={styles.listCover}
        onRow={(record) => ({
          onClick: () => handlePlayTrack(record),
          style: { cursor: "pointer" },
          id: `track-${record.id}`
        })}
      />

      <Modal
        title="添加到播放列表"
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

export default TrackList;
