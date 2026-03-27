import {
  AppstoreAddOutlined,
  HeartFilled,
  HeartOutlined,
  MoreOutlined,
  PictureOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import {
  addAlbumToCollection,
  createCollection,
  getAlbumById,
  getAlbumTracks,
  getCollectionMembership,
  getCollections,
  toggleAlbumLike,
  toggleAlbumUnLike,
  uploadAlbumCover,
} from "@soundx/services";
import type { MenuProps } from "antd";
import {
  Button,
  Dropdown,
  Input,
  Modal,
  Skeleton,
  theme,
  Typography,
} from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMessage } from "../../context/MessageContext";
import { TrackType, type Album, type Track } from "../../models";
import { resolveArtworkUri } from "../../services/trackResolver";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { isEmbySource, isSubsonicSource } from "../../utils";
import styles from "./index.module.less";

const { Title } = Typography;

interface CoverComponent extends React.FC<{
  item: Album | Track;
  size?: number;
  isTrack?: boolean;
  isHistory?: boolean;
  onClick?: (item: Album | Track) => void;
}> {
  Skeleton: React.FC;
}

const Cover: CoverComponent = ({
  item,
  size,
  isTrack = false,
  isHistory = false,
  onClick,
}) => {
  const message = useMessage();
  const navigate = useNavigate();
  const { play, setPlaylist } = usePlayerStore();
  const [isLiked, setIsLiked] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [collections, setCollections] = useState<any[]>([]);
  const [membership, setMembership] = useState<number[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const { user } = useAuthStore();
  const { token: themeToken } = theme.useToken();
  const isAudioDockSource = !isSubsonicSource() && !isEmbySource();
  const suppressClickRef = useRef(false);

  useEffect(() => {
    // Check if album is liked
    if (!isTrack && (item as Album).id) {
      checkIfLiked((item as Album).id);
    }
  }, [item, isTrack]);

  const checkIfLiked = async (albumId: number | string) => {
    try {
      const res = await getAlbumById(albumId as unknown as number);
      if (res.code === 200) {
        // @ts-ignore - likedByUsers is included in response
        const likedByUsers = res.data.likedByUsers || [];
        const isLikedByCurrentUser = likedByUsers.some(
          (like: any) => like.userId === user?.id,
        );
        setIsLiked(isLikedByCurrentUser);
      }
    } catch (error) {
      console.error("Failed to check like status:", error);
    }
  };

  const suppressNextClick = () => {
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (collectionModalOpen) return;
    if (onClick) {
      onClick(item);
      return;
    }
    if (isTrack) {
      // For tracks, play directly
      play(item as Track);
      setPlaylist([item as Track]);
    } else {
      // If provided with resume data AND it is from history section, play directly instead of navigating
      if (isHistory) {
        handlePlayAlbum();
      } else {
        // For regular albums, navigate to detail page
        navigate(`/detail?id=${item.id}`);
      }
    }
  };

  const handleMoreClick: React.MouseEventHandler = (e) => {
    suppressNextClick();
    e.preventDefault();
    e.stopPropagation();
    // Ensure the event doesn't bubble to cover container
    (e.nativeEvent as any).stopImmediatePropagation?.();
  };

  const handlePlayAlbum = async () => {
    if (isTrack) {
      play(item as Track);
      setPlaylist([item as Track]);
    } else {
      try {
        const pageSize = 50;
        const res = await getAlbumTracks((item as Album).id, pageSize, 0);
        if (res.code === 200 && res.data.list.length > 0) {
          const tracks = res.data.list;
          const totalHasMore = tracks.length === pageSize;

          // Pass source info for lazy loading
          setPlaylist(tracks, {
            type: "album",
            id: item.id,
            pageSize: pageSize,
            currentPage: 0,
            hasMore: totalHasMore,
          });

          // Check for resume info
          const resumeTrackId = (item as any).resumeTrackId;
          const resumeProgress = (item as any).resumeProgress;

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

          play(targetTrack, (item as Album).id, startTime);
          message.success(startTime > 0 ? "继续播放" : "开始播放");
        }
      } catch (error) {
        console.error(error);
        message.error("播放失败");
      }
    }
  };

  const openCollectionModal = async () => {
    if (isTrack || !user?.id) return;
    setCollectionLoading(true);
    setCollectionModalOpen(true);
    try {
      const [listRes, membershipRes] = await Promise.all([
        getCollections(user.id),
        getCollectionMembership(item.id, user.id),
      ]);
      if (listRes.code === 200) setCollections(listRes.data || []);
      if (membershipRes.code === 200) setMembership(membershipRes.data || []);
    } finally {
      setCollectionLoading(false);
    }
  };

  const addToCollection = async (collectionId: number) => {
    if (isTrack) return;
    if (membership.includes(collectionId)) return;
    try {
      const res = await addAlbumToCollection(collectionId, item.id);
      if (res.code === 200) {
        setMembership((prev) => [...prev, collectionId]);
        message.success("已添加到合集");
      } else {
        message.error(res.message || "添加失败");
      }
    } catch (error) {
      message.error("添加失败");
    }
  };

  const handleCreateCollection = async () => {
    if (!user?.id || isTrack) return;
    const res = await createCollection(user.id, {
      name: newCollectionName.trim() || undefined,
      albumId: item.id,
    });
    if (res.code === 200) {
      const listRes = await getCollections(user.id);
      if (listRes.code === 200) setCollections(listRes.data || []);
      setNewCollectionName("");
    }
  };

  const handleCoverFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isTrack) return;
    if (!isAudioDockSource) {
      message.warning("仅 AudioDock 源支持修改封面");
      return;
    }
    try {
      setUploadingCover(true);
      const res = await uploadAlbumCover(item.id, file);
      if (res.code === 200) {
        message.success("封面已更新");
      } else {
        message.error(res.message || "封面上传失败");
      }
    } catch (error) {
      message.error("封面上传失败");
    } finally {
      setUploadingCover(false);
    }
  };

  const handleToggleLike = async () => {
    if (isTrack) return;

    try {
      if (isLiked) {
        const res = await toggleAlbumUnLike((item as Album).id, user?.id || 0);
        if (res.code === 200) {
          setIsLiked(false);
          message.success("已取消收藏");
        }
      } else {
        const res = await toggleAlbumLike((item as Album).id, user?.id || 0);
        if (res.code === 200) {
          setIsLiked(true);
          message.success("收藏成功");
        }
      }
    } catch (error) {
      message.error("操作失败");
    }
  };

  const menuItems: MenuProps["items"] = [
    {
      key: "play",
      label: "播放",
      icon: <PlayCircleOutlined />,
      onClick: handlePlayAlbum,
    },
    !isTrack && {
      key: "cover",
      label: "修改封面",
      icon: <PictureOutlined />,
      onClick: ({
        domEvent,
      }: {
        domEvent?: React.MouseEvent<HTMLDivElement>;
      }) => {
        suppressNextClick();
        domEvent?.preventDefault();
        domEvent?.stopPropagation();
        (domEvent as any)?.nativeEvent?.stopImmediatePropagation?.();
        const input = document.getElementById(
          `cover-input-${item.id}`,
        ) as HTMLInputElement;
        input?.click();
      },
      disabled: uploadingCover || !isAudioDockSource,
    },
    !isTrack &&
      (item as Album).type === TrackType.AUDIOBOOK && {
        key: "collection",
        label: "添加到合集",
        icon: <AppstoreAddOutlined />,
        onClick: ({ domEvent }: { domEvent?: any }) => {
          suppressNextClick();
          domEvent?.preventDefault();
          domEvent?.stopPropagation();
          (domEvent as any)?.nativeEvent?.stopImmediatePropagation?.();
          openCollectionModal();
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
      onClick: handleToggleLike,
    },
  ].filter(Boolean) as MenuProps["items"];

  return (
    <div
      className={styles.coverContainer}
      onClick={handleClick}
      style={size ? { width: size } : undefined}
    >
      <input
        id={`cover-input-${item.id}`}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleCoverFileChange}
      />
      <div className={styles.imageWrapper}>
        <img
          src={
            resolveArtworkUri(item) ||
            `https://picsum.photos/seed/${item.id}/300/300`
          }
          alt={item.name}
          className={styles.image}
        />
        {!isTrack &&
          (item as Album).progress !== undefined &&
          (item as Album).progress! > 0 && (
            <div className={styles.progressBarWrapper}>
              <div
                className={styles.progressBar}
                style={{
                  width: `${(item as Album).progress}%`,
                  backgroundColor: theme.useToken().token.colorBgBase,
                }}
              />
            </div>
          )}
        {!isTrack && (
          <div
            className={styles.moreButton}
            onMouseDown={handleMoreClick}
            onClick={handleMoreClick}
          >
            <Dropdown
              menu={{ items: menuItems }}
              trigger={["click"]}
              placement="bottomRight"
              onOpenChange={(open) => {
                if (open) suppressNextClick();
              }}
            >
              <MoreOutlined
                onMouseDown={handleMoreClick}
                onClick={handleMoreClick}
                style={{ fontSize: "20px", cursor: "pointer" }}
              />
            </Dropdown>
          </div>
        )}
      </div>
      <Title level={5} className={styles.title}>
        {item.name}
      </Title>
      <div
        className={styles.artist}
        style={{ color: themeToken.colorTextSecondary }}
      >
        {item.artist}
      </div>
      <Modal
        title="添加到合集"
        open={collectionModalOpen}
        onCancel={() => {
          suppressNextClick();
          setCollectionModalOpen(false);
        }}
        footer={null}
      >
        <div
          style={{ display: "flex", gap: 8, marginBottom: 12 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Input
            placeholder="合集名称（可选）"
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
          />
          <Button type="primary" onClick={handleCreateCollection}>
            新建
          </Button>
        </div>
        <div
          style={{ maxHeight: 360, overflowY: "auto" }}
          onClick={(e) => e.stopPropagation()}
        >
          {collectionLoading ? (
            <div style={{ padding: 12 }}>加载中...</div>
          ) : (
            collections.map((col) => {
              const selected = membership.includes(Number(col.id));
              return (
                <div
                  key={col.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 0",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span>{col.name}</span>
                    <span style={{ fontSize: 12, opacity: 0.6 }}>
                      {col._count?.items ?? col.items?.length ?? 0} 张专辑
                    </span>
                  </div>
                  <Button
                    type={selected ? "default" : "primary"}
                    disabled={selected}
                    onClick={() => addToCollection(Number(col.id))}
                  >
                    {selected ? "已添加" : "添加"}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Modal>
    </div>
  );
};

Cover.Skeleton = () => {
  return (
    <div>
      <div className={styles.skeletonWrapper}>
        <Skeleton.Node active className={styles.skeletonNode}>
          <div style={{ width: "100%", height: "100%" }} />
        </Skeleton.Node>
      </div>
      <Skeleton
        active
        title={{ width: "80%", style: { height: "20px", marginBottom: "8px" } }}
        paragraph={{ rows: 1, width: "60%" }}
      />
    </div>
  );
};

export default Cover;
