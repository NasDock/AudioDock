import {
    CheckSquareOutlined,
    CloseOutlined,
    DownloadOutlined,
    EllipsisOutlined,
    PlusOutlined
} from "@ant-design/icons";
import {
    getAlbumsByArtist,
    getArtistById,
    getCollaborativeAlbumsByArtist,
    getCollections,
    getTracksByArtist,
    uploadArtistAvatar,
} from "@soundx/services";
import {
    Avatar,
    Button,
    Col,
    Dropdown,
    Empty,
    Flex,
    type MenuProps,
    message,
    Row,
    Skeleton,
    Typography
} from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AddToPlaylistModal from "../../components/AddToPlaylistModal";
import Cover from "../../components/Cover";
import TrackList from "../../components/TrackList";
import { getBaseURL } from "../../https";
import { type Album, type Artist, type Track, TrackType } from "../../models";
import { downloadTracks } from "../../services/downloadManager";
import { resolveArtworkUri } from "../../services/trackResolver";
import { useAuthStore } from "../../store/auth";
import { usePlayMode } from "../../utils/playMode";
import styles from "./index.module.less";

const { Title } = Typography;

const ArtistDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // const message = useMessage(); // Use messageApi from antd 5
  const [messageApi, contextHolder] = message.useMessage();

  const [artist, setArtist] = useState<Artist | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [collaborativeAlbums, setCollaborativeAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [relatedCollections, setRelatedCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { mode } = usePlayMode();
  const { user } = useAuthStore();
  const isEmbySource = (localStorage.getItem("selectedSourceType") || "").toLowerCase() === "emby";

  // Selection Mode
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isBatchAddModalOpen, setIsBatchAddModalOpen] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const isAudioDockSource =
    (localStorage.getItem("selectedSourceType") || "AudioDock") === "AudioDock";

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const artistRes = await getArtistById(id as unknown as number);
        if (artistRes.code === 200 && artistRes.data) {
          setArtist(artistRes.data);
          const artistQueryKey = isEmbySource ? String(id) : artistRes.data.name;
          const [albumsRes, collaborativeRes, tracksRes] = await Promise.all([
            getAlbumsByArtist(artistQueryKey),
            getCollaborativeAlbumsByArtist(artistQueryKey),
            getTracksByArtist(artistQueryKey),
          ]);

          if (albumsRes.code === 200 && albumsRes.data) {
            setAlbums(albumsRes.data);
          }
          if (collaborativeRes.code === 200 && collaborativeRes.data) {
            setCollaborativeAlbums(collaborativeRes.data);
          }
          if (tracksRes.code === 200 && tracksRes.data) {
            setTracks(tracksRes.data);
          }
        } else {
          messageApi.error("Failed to load artist details");
        }
      } catch (error) {
        console.error("Error fetching artist details:", error);
        messageApi.error("Error fetching artist details");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  useEffect(() => {
    const loadRelatedCollections = async () => {
      if (mode !== TrackType.AUDIOBOOK || !user?.id || !artist) {
        setRelatedCollections([]);
        return;
      }
      try {
        const res = await getCollections(user.id);
        if (res.code !== 200) {
          setRelatedCollections([]);
          return;
        }
        const artistAlbumIds = new Set(
          [...albums, ...collaborativeAlbums].map((album) => String(album.id)),
        );
        const filtered = (res.data || []).filter((col: any) =>
          (col.items || []).some((item: any) =>
            artistAlbumIds.has(String(item.album?.id)),
          ),
        );
        setRelatedCollections(filtered);
      } catch (error) {
        setRelatedCollections([]);
      }
    };

    loadRelatedCollections();
  }, [mode, user?.id, artist, albums, collaborativeAlbums]);

  const handleToggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode);
    setSelectedRowKeys([]);
  };

  const selectedTracks = tracks.filter(t => selectedRowKeys.includes(t.id)) || [];

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

  const handleAvatarFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !artist) return;
    if (!isAudioDockSource) {
      messageApi.warning("仅 AudioDock 源支持修改封面");
      return;
    }
    try {
      setUploadingAvatar(true);
      const res = await uploadArtistAvatar(artist.id, file);
      if (res.code === 200) {
        setArtist(res.data);
        messageApi.success("封面已更新");
      } else {
        messageApi.error(res.message || "封面上传失败");
      }
    } catch (error) {
      console.error("Failed to upload artist cover:", error);
      messageApi.error("封面上传失败");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const avatarMenuItems: MenuProps["items"] = [
    {
      key: "upload",
      label: "修改封面",
      onClick: () => avatarInputRef.current?.click(),
      disabled: uploadingAvatar || !isAudioDockSource,
    },
  ];



  if (loading) {
    return (
      <Flex vertical gap={24} className={styles.container}>
        <Flex vertical align="center" gap={34}>
          <Skeleton.Avatar active size={200} />
          <Skeleton.Input active />
        </Flex>
        <Skeleton.Input active />
        <Flex gap={24}>
          <Flex vertical gap={24}>
            <Skeleton.Node style={{ width: 170, height: 170 }} active />
            <Skeleton.Input active />
            <Skeleton.Input active />
          </Flex>
          <Flex vertical gap={24}>
            <Skeleton.Node style={{ width: 170, height: 170 }} active />
            <Skeleton.Input active />
            <Skeleton.Input active />
          </Flex>
          <Flex vertical gap={24}>
            <Skeleton.Node style={{ width: 170, height: 170 }} active />
            <Skeleton.Input active />
            <Skeleton.Input active />
          </Flex>
          <Flex vertical gap={24}>
            <Skeleton.Node style={{ width: 170, height: 170 }} active />
            <Skeleton.Input active />
            <Skeleton.Input active />
          </Flex>
        </Flex>
      </Flex>
    );
  }

  if (!artist) {
    return (
      <div className={styles.container}>
        <Empty description="Artist not found" />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        {contextHolder}
        <div className={styles.avatarWrapper}>
          <Avatar
            src={
              artist?.avatar
                ? artist.avatar.startsWith("http")
                  ? artist.avatar
                  : `${getBaseURL()}${artist.avatar}`
                : undefined
            }
            size={200}
            shape="circle"
            className={styles.avatar}
            icon={!artist.avatar && artist.name[0]}
          />
          <Dropdown menu={{ items: avatarMenuItems }} trigger={["click"]}>
            <div className={styles.avatarMenuButton}>
              <EllipsisOutlined />
            </div>
          </Dropdown>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleAvatarFileChange}
          />
        </div>
        <Title level={2} className={styles.artistName}>
          {artist.name}
        </Title>
      </div>

      {albums.length > 0 && (
        <div className={styles.content}>
          <Title level={4} className={styles.sectionTitle}>
            所有专辑 ({albums.length})
          </Title>
          <Row gutter={[24, 24]}>
            {albums.map((album) => (
              <Col key={album.id}>
                <Cover item={album} />
              </Col>
            ))}
          </Row>
        </div>
      )}

      {collaborativeAlbums.length > 0 && (
        <div className={styles.content} style={{ marginTop: "48px" }}>
          <Title level={4} className={styles.sectionTitle}>
            合作专辑 ({collaborativeAlbums.length})
          </Title>
          <Row gutter={[24, 24]}>
            {collaborativeAlbums.map((album) => (
              <Col key={album.id}>
                <Cover item={album} />
              </Col>
            ))}
          </Row>
        </div>
      )}

      {mode === TrackType.AUDIOBOOK && relatedCollections.length > 0 && (
        <div className={styles.content} style={{ marginTop: "48px" }}>
          <Title level={4} className={styles.sectionTitle}>
            相关合集 ({relatedCollections.length})
          </Title>
          <Row gutter={[24, 24]}>
            {relatedCollections.map((col) => {
              const cover =
                col.cover || col.items?.[0]?.album?.cover || undefined;
              const count = col._count?.items ?? col.items?.length ?? 0;
              return (
                <Col key={col.id}>
                  <div
                    className={styles.collectionCard}
                    onClick={() => navigate(`/collection/${col.id}`)}
                  >
                    <div className={styles.collectionCoverWrap}>
                      <img
                        className={styles.collectionCover}
                        src={
                          resolveArtworkUri(cover) ||
                          `https://picsum.photos/seed/${col.id}/300/300`
                        }
                        alt={col.name}
                      />
                    </div>
                    <div className={styles.collectionName}>{col.name}</div>
                    <div className={styles.collectionCount}>
                      {count} 张专辑
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>
        </div>
      )}

      {mode === TrackType.MUSIC && (
        <div style={{ marginTop: "48px" }}>
          <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
            <Title level={4} className={styles.sectionTitle} style={{ marginBottom: 0 }}>
              所有单曲 ({tracks.length})
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
                <Button
                  icon={<CheckSquareOutlined />}
                  onClick={handleToggleSelectionMode}
                >
                  批量操作
                </Button>
            )}
          </Flex>
          <TrackList
            tracks={tracks}
            type={artist?.type}
            showAlbum={false}
            showArtist={false}
            rowSelection={isSelectionMode ? {
                selectedRowKeys,
                onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
            } : undefined}
          />
        </div>
      )}

      <AddToPlaylistModal
        open={isBatchAddModalOpen}
        onCancel={() => setIsBatchAddModalOpen(false)}
        tracks={selectedTracks}
        onSuccess={() => {
            setIsSelectionMode(false);
            setSelectedRowKeys([]);
        }}
      />
    </div>
  );
};

export default ArtistDetail;
