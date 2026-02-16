import {
    DeleteOutlined,
    HeartFilled,
    HeartOutlined,
    MoreOutlined,
    PauseCircleFilled,
    PlayCircleFilled,
    PlayCircleOutlined,
    PlusOutlined
} from "@ant-design/icons";
import { Dropdown, List, theme, Typography } from "antd";
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { TrackType, type Album, type Track } from "../../models";
import { resolveArtworkUri } from "../../services/trackResolver";
import { useAuthStore } from "../../store/auth";
import PlayingIndicator from "../PlayingIndicator";
import styles from "./index.module.less";

const { Text } = Typography;

interface QueueListProps {
  tracks: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onPlay: (track: Track) => void;
  onPuse: (track: Track) => void;
  onLoadMore?: () => void;
  onToggleLike: (
    e: React.MouseEvent,
    track: Track,
    type: "like" | "unlike"
  ) => void;
  onAddToPlaylist: (e: React.MouseEvent, track: Track) => void;
  onDelete: (track: Track) => void;
  className?: string;
  style?: React.CSSProperties;
}

export interface QueueListRef {
    scrollToActive: () => void;
}

const getCoverUrl = (item?: Track | Album | null) => {
    if (!item) return `https://picsum.photos/seed/0/300/300`;
    return resolveArtworkUri(item) || `https://picsum.photos/seed/${item.id}/300/300`;
  };

export const QueueList = forwardRef<QueueListRef, QueueListProps>(({
  tracks,
  currentTrack,
  isPlaying,
  hasMore,
  isLoadingMore,
  onPlay,
  onPuse,
  onLoadMore,
  onToggleLike,
  onAddToPlaylist,
  onDelete,
  className,
  style,
}, ref) => {
  const { token } = theme.useToken();
  const { user } = useAuthStore();
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToActive = () => {
    if (containerRef.current && currentTrack) {
        const activeElement = containerRef.current.querySelector(
          `.${styles.activeItem}`
        );
        if (activeElement) {
          activeElement.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
  }

  useImperativeHandle(ref, () => ({
    scrollToActive
  }));

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      if (!onLoadMore || !hasMore || isLoadingMore) return;
      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
      if (scrollHeight - scrollTop - clientHeight < 100) {
        onLoadMore();
      }
  };

  useEffect(() => {
    scrollToActive();
  }, [currentTrack?.id]);

  return (
    <div 
        ref={containerRef} 
        onScroll={handleScroll}
        style={{ height: "100%", overflowY: "auto" }}
    >
      <List
        className={className}
        style={style}
        itemLayout="horizontal"
        dataSource={tracks}
        renderItem={(item: Track) => {
          const isCurrent = currentTrack?.id === item.id;
          // @ts-ignore
          const isLiked = item.likedByUsers?.some(
            (like: any) => like.userId === user?.id
          );

          return (
            <List.Item
              className={`${styles.playlistItem} ${
                isCurrent ? styles.activeItem : ""
              }`}
              onClick={() =>
                item.id === currentTrack?.id && isPlaying
                  ? onPuse(item)
                  : onPlay(item)
              }
            style={{
              cursor: "pointer",
              backgroundColor: isCurrent
                ? token.colorFillTertiary
                : "transparent", // Use token for consistency
            }}
            actions={[
              <Dropdown
                key="more"
                trigger={["click"]}
                menu={{
                  items: [
                    {
                      key: "play",
                      label: "播放",
                      icon: <PlayCircleOutlined />,
                      onClick: (info) => {
                        info.domEvent.stopPropagation();
                        onPlay(item);
                      },
                    },
                    {
                      key: "like",
                      label: isLiked ? "取消收藏" : "收藏",
                      icon: isLiked ? (
                        <HeartFilled style={{ color: "#ff4d4f" }} />
                      ) : (
                        <HeartOutlined />
                      ),
                      onClick: (info) => {
                        info.domEvent.stopPropagation();
                        onToggleLike(
                          info.domEvent as any,
                          item,
                          isLiked ? "unlike" : "like"
                        );
                      },
                    },
                    {
                      key: "add",
                      label: "添加到播放列表",
                      icon: <PlusOutlined />,
                      onClick: (info) => {
                        info.domEvent.stopPropagation();
                        onAddToPlaylist(info.domEvent as any, item);
                      },
                    },
                    {
                      key: "delete",
                      label: "删除",
                      icon: <DeleteOutlined />,
                      danger: true,
                      onClick: (info) => {
                        info.domEvent.stopPropagation();
                        onDelete(item);
                      },
                    },
                  ],
                }}
              >
                <MoreOutlined
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    color: token.colorTextSecondary,
                    cursor: "pointer",
                    fontSize: "20px",
                  }}
                />
              </Dropdown>,
            ]}
          >
            <List.Item.Meta
              className={styles.listCover}
              avatar={
                <div style={{ position: "relative" }}>
                  <img
                    src={getCoverUrl(item)}
                    alt={item.name}
                    style={{
                      width: "50px",
                      height: "50px",
                      objectFit: "cover",
                      borderRadius: "4px",
                    }}
                  />
                  {isCurrent && isPlaying && (
                    <div className={styles.playIconStatus}>
                      <PlayingIndicator />
                    </div>
                  )}
                  <div className={styles.playIconOverlay}>
                    {isCurrent && isPlaying ? (
                      <PauseCircleFilled className={styles.listPlayIcon} />
                    ) : (
                      <PlayCircleFilled className={styles.listPlayIcon} />
                    )}
                  </div>
                </div>
              }
              title={
                <Text
                  style={{
                    fontSize: "16px",
                    color: isCurrent ? token.colorPrimary : undefined,
                  }}
                  type={
                    item?.type === TrackType.AUDIOBOOK
                      ? Number(item?.progress) > 0
                        ? "secondary"
                        : undefined
                      : undefined
                  }
                  strong={currentTrack?.id === item.id}
                  ellipsis
                >
                  {item.name}
                </Text>
              }
              description={
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text type="secondary" ellipsis>
                    {item.artist}
                  </Text>
                  {item.type === "AUDIOBOOK" &&
                    item.progress &&
                    item.progress > 0 && (
                      <Text type="secondary" style={{ fontSize: "12px" }}>
                        {Math.round(
                          (item.progress / (item.duration || 1)) * 100
                        )}
                        %
                      </Text>
                    )}
                </div>
              }
            />
          </List.Item>
        );
      }}
      />
      {isLoadingMore && (
        <div style={{ textAlign: "center", padding: "16px" }}>
          <Text type="secondary">加载中...</Text>
        </div>
      )}
    </div>
  );
});
