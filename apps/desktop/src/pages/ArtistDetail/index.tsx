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
    toPagedResult,
    uploadArtistAvatar,
    getMvsByArtist,
    playMiDevicePlaylist,
} from "@soundx/services";
import type { Mv } from "@soundx/services";
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
    theme,
    Typography
} from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import AddToPlaylistModal from "../../components/AddToPlaylistModal";
import { MiDeviceSelector, XiaoAiIcon } from "../../components/MiDeviceSelector";
import Cover from "../../components/Cover";
import TrackList from "../../components/TrackList";
import { useLoadMore } from "../../hooks/useLoadMore";
import { type Album, type Artist, type Track, TrackType } from "../../models";
import { downloadTracks } from "../../services/downloadManager";
import { resolveArtworkUri } from "../../services/trackResolver";
import { useAuthStore } from "../../store/auth";
import { usePlayMode } from "../../utils/playMode";
import styles from "./index.module.less";

const { Title } = Typography;

const ArtistDetail: React.FC = () => {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // const message = useMessage(); // Use messageApi from antd 5
  const [messageApi, contextHolder] = message.useMessage();

  const [artist, setArtist] = useState<Artist | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [collaborativeAlbums, setCollaborativeAlbums] = useState<Album[]>([]);
  const [mvs, setMvs] = useState<Mv[]>([]);
  const [relatedCollections, setRelatedCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { mode } = usePlayMode();
  const { user } = useAuthStore();
  const isEmbySource = (localStorage.getItem("selectedSourceType") || "").toLowerCase() === "emby";

  // tracks 用 useLoadMore 分页加载；artistQueryKey 在 artist 加载完后才确定，
  // 此处先用一个 watcher：等 artist 就绪后 enable 拉取
  const artistQueryKey = artist ? (isEmbySource ? String(id) : artist.name) : "";

  const {
    list: tracks,
    hasMore: tracksHasMore,
    loadingMore: tracksLoadingMore,
    sentinelRef: tracksSentinelRef,
  } = useLoadMore<Track, { artistQueryKey: string }>({
    args: { artistQueryKey },
    deps: [artistQueryKey],
    immediate: !!artistQueryKey,
    pageSize: 100,
    fetcher: ({ artistQueryKey: key, skip, pageSize }) =>
      getTracksByArtist(key, { skip, pageSize }).then((res: { data?: unknown }) => {
        const data = (res as { data?: unknown }).data;
        if (Array.isArray(data)) {
          // 兼容老路径（不传 skip/pageSize 时 native 返回 Track[]）：只取第一页当作非分页
          // 实际不会走到这里——只要传了 skip/pageSize，native 会返回 ILoadMoreData<Track>
          const list = data as Track[];
          return { list, hasMore: list.length === pageSize, total: undefined };
        }
        return toPagedResult(data as never, pageSize);
      }),
  });

  // Selection Mode
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isBatchAddModalOpen, setIsBatchAddModalOpen] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const isAudioDockSource =
    (localStorage.getItem("selectedSourceType") || "AudioDock") === "AudioDock";

  // Mi Speaker cast state
  const [isMiDeviceSelectorOpen, setIsMiDeviceSelectorOpen] = useState(false);
  const [isCastingToMi, setIsCastingToMi] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const artistRes = await getArtistById(id as unknown as number);
        if (artistRes.code === 200 && artistRes.data) {
          setArtist(artistRes.data);
          const artistQueryKey = isEmbySource ? String(id) : artistRes.data.name;
          // tracks 已交给 useLoadMore 处理（分页），这里只拉 albums / collaborative / mvs
          const [albumsRes, collaborativeRes] = await Promise.all([
            getAlbumsByArtist(artistQueryKey),
            getCollaborativeAlbumsByArtist(artistQueryKey),
          ]);

          if (albumsRes.code === 200 && albumsRes.data) {
            setAlbums(albumsRes.data);
          }
          if (collaborativeRes.code === 200 && collaborativeRes.data) {
            setCollaborativeAlbums(collaborativeRes.data);
          }

          if (artistQueryKey) {
            getMvsByArtist(artistQueryKey).then((res: any[]) => {
              if (res?.length) {
                setMvs(res);
              }
            }).catch((e: any) => console.error(e));
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
    messageApi.info(t("playlistDetail.startDownload", { count: selectedTracks.length }));
    await downloadTracks(selectedTracks, (completed, total) => {
        if (completed === total) {
            messageApi.success(t("playlistDetail.downloadComplete", { count: total }));
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
      messageApi.warning(t("artistDetail.audioDockOnly"));
      return;
    }
    try {
      setUploadingAvatar(true);
      const res = await uploadArtistAvatar(artist.id, file);
      if (res.code === 200) {
        setArtist(res.data);
        messageApi.success(t("artistDetail.coverUpdated"));
      } else {
        messageApi.error(res.message || t("artistDetail.coverUploadFailed"));
      }
    } catch (error) {
      console.error("Failed to upload artist cover:", error);
      messageApi.error(t("artistDetail.coverUploadFailed"));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const avatarMenuItems: MenuProps["items"] = [
    {
      key: "upload",
      label: t("artistDetail.modifyCover"),
      onClick: () => avatarInputRef.current?.click(),
      disabled: uploadingAvatar || !isAudioDockSource,
    },
  ];

  const handleCastTracksToMi = async (deviceId: string, deviceName: string) => {
    if (tracks.length === 0) {
      messageApi.warning(t("player.miCastNoTrack"));
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

      messageApi.success(t("player.miCastPlaylistSuccess", { device: deviceName, count: trackPayloads.length }));
      setIsMiDeviceSelectorOpen(false);
    } catch (error) {
      console.error("Failed to cast tracks to Mi device:", error);
      messageApi.error(t("player.miCastPlaylistFailed"));
    } finally {
      setIsCastingToMi(false);
    }
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
        <div className={styles.avatarWrapper}>
          <Avatar
            src={
              artist?.avatar
                ? resolveArtworkUri(artist.avatar, { width: 600 })
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
            <div className={styles.section}>
              <Title level={4} className={styles.sectionTitle}>
                {t("artistDetail.allAlbums", { count: albums.length })}
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
            {t("artistDetail.collaborativeAlbums", { count: collaborativeAlbums.length })}
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

      {mvs.length > 0 && (
        <div className={styles.content} style={{ marginTop: "48px" }}>
          <Title level={4} className={styles.sectionTitle}>
            MV ({mvs.length})
          </Title>
          <Row gutter={[24, 24]}>
            {mvs.map((mv) => (
              <Col key={mv.id}>
                <Cover item={mv as any} type="mv" aspectRatio={16 / 9} />
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
                          resolveArtworkUri(cover, { width: 300 }) ||
                          `https://picsum.photos/seed/${col.id}/300/300`
                        }
                        alt={col.name}
                      />
                    </div>
                    <div className={styles.collectionName}>{col.name}</div>
                    <div className={styles.collectionCount}>
                      {t("collectionDetail.albumCount", { count })}
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
                <Flex gap={8} align="center">
                  <Button
                    icon={<XiaoAiIcon style={{ width: 14, height: 14 }} />}
                    onClick={() => setIsMiDeviceSelectorOpen(true)}
                  >
                    投放到音箱
                  </Button>
                  <Button
                    icon={<CheckSquareOutlined />}
                    onClick={handleToggleSelectionMode}
                  >
                    批量操作
                  </Button>
                </Flex>
            )}
          </Flex>
          <TrackList
            tracks={tracks}
            type={artist?.type}
            showAlbum={false}
            showArtist={false}
            showSource={true}
            rowSelection={isSelectionMode ? {
                selectedRowKeys,
                onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
            } : undefined}
          />
          {/* 分页 sentinel：进入视口自动 loadMore */}
          {(tracksHasMore || tracksLoadingMore) && (
            <div ref={tracksSentinelRef} style={{ padding: "12px 0", textAlign: "center", color: token.colorTextSecondary, fontSize: 12 }}>
              {tracksLoadingMore ? "加载中…" : "上拉/滚动加载更多"}
            </div>
          )}
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
      <MiDeviceSelector
        open={isMiDeviceSelectorOpen}
        onClose={() => setIsMiDeviceSelectorOpen(false)}
        onSelectDevice={(device) => handleCastTracksToMi(device.device_id, device.name)}
        loading={isCastingToMi}
      />
    </div>
  );
};

export default ArtistDetail;
