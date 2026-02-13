import {
    CheckSquareOutlined,
    CloseOutlined,
    DownloadOutlined,
    PlusOutlined
} from "@ant-design/icons";
import {
    getAlbumsByArtist,
    getArtistById,
    getCollaborativeAlbumsByArtist,
    getTracksByArtist,
} from "@soundx/services";
import {
    Avatar,
    Button,
    Col,
    Empty,
    Flex,
    message,
    Row,
    Skeleton,
    Typography
} from "antd";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import AddToPlaylistModal from "../../components/AddToPlaylistModal";
import Cover from "../../components/Cover";
import TrackList from "../../components/TrackList";
import { getBaseURL } from "../../https";
import { type Album, type Artist, type Track, TrackType } from "../../models";
import { downloadTracks } from "../../services/downloadManager";
import { usePlayMode } from "../../utils/playMode";
import styles from "./index.module.less";

const { Title } = Typography;

const ArtistDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  // const message = useMessage(); // Use messageApi from antd 5
  const [messageApi, contextHolder] = message.useMessage();

  const [artist, setArtist] = useState<Artist | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [collaborativeAlbums, setCollaborativeAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const { mode } = usePlayMode();

  // Selection Mode
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isBatchAddModalOpen, setIsBatchAddModalOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const artistRes = await getArtistById(id as unknown as number);
        if (artistRes.code === 200 && artistRes.data) {
          setArtist(artistRes.data);
          // Fetch albums using artist name
          const [albumsRes, collaborativeRes, tracksRes] = await Promise.all([
            getAlbumsByArtist(artistRes.data.name),
            getCollaborativeAlbumsByArtist(artistRes.data.name),
            getTracksByArtist(artistRes.data.name),
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
