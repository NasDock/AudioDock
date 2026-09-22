import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeftOutlined,
  FolderOpenOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  Button,
  Col,
  Empty,
  message,
  Row,
  Tooltip,
  Typography,
} from "antd";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Cover from "../../components/Cover/index";
import TrackList from "../../components/TrackList";
import { type Album } from "../../models";
import { usePlayerStore } from "../../store/player";
import { useSettingsStore } from "../../store/settings";
import { usePlayMode } from "../../utils/playMode";
import { isTauri } from "../../utils/platform";
import { getSourceKey } from "../../https";
import styles from "./index.module.less";

const { Title } = Typography;

const Downloads: React.FC = () => {
  const { t } = useTranslation();
  const [localItems, setLocalItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<any | null>(null);
  const { play, setPlaylist } = usePlayerStore();
  const { mode } = usePlayMode();
  const downloadPath = useSettingsStore((state) => state.download.downloadPath);

  const fetchLocalItems = async () => {
    if (!isTauri()) return;
    setLoading(true);
    try {
      const results = await invoke<any[]>("cache_list", {
        downloadPath,
        trackType: mode,
        // 只列当前数据源的缓存，避免 A/B 源的已下载歌曲混排、点播串源
        sourceKey: getSourceKey(),
      });
      setLocalItems(results);
    } catch (error) {
      console.error("Failed to fetch local items:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLocalItems();
    setSelectedAlbum(null); // Reset selection on mode change
  }, [mode, downloadPath]);

  const handleOpenFolder = () => {
    if (!isTauri()) return;
    const subFolder = mode === "MUSIC" ? "music" : "audio";
    const fullPath = downloadPath + "/" + subFolder;
    invoke("open_directory", { path: fullPath }).catch((err: any) => {
      if (err && typeof err === "string" && err.includes("Could not")) {
        message.error(err);
      }
    });
  };

  // Group by album for Audiobook mode
  const albums: any[] = [];
  if (mode === "AUDIOBOOK") {
    const albumMap = new Map<string, any>();
    localItems.forEach((item) => {
      // Use album name as key if ID is missing or not unique enough in flat list?
      // Assuming album name is consistent.
      if (!albumMap.has(item.album)) {
        albumMap.set(item.album, {
          id: item.albumId || item.album, // Fallback if no ID
          name: item.album,
          artist: item.artist,
          cover: item.cover,
          type: mode,
          tracks: [],
        });
      }
      albumMap.get(item.album).tracks.push(item);
    });
    albumMap.forEach((val) => albums.push(val));
    // Sort albums by name or something if needed
  }

  const renderContent = () => {
    if (loading && localItems.length === 0) return null;

    if (localItems.length === 0) {
      return (
        <div className={styles.noData}>
          <Empty description="暂无下载内容" />
        </div>
      );
    }

    if (mode === "MUSIC") {
      return (
        <TrackList
          tracks={localItems}
          loading={loading}
          showIndex={false}
          showArtist={true}
          showAlbum={true}
          onPlay={(track, tracks) => {
            setPlaylist(tracks);
            play(track, -1);
          }}
          onRefresh={fetchLocalItems}
        />
      );
    } else {
      // AUDIOBOOK MODE
      if (selectedAlbum) {
        return (
          <TrackList
            tracks={selectedAlbum.tracks}
            loading={loading}
            type={selectedAlbum.type}
            showIndex={true}
            showArtist={true}
            showAlbum={false}
            showCover={false}
            onPlay={(track, tracks) => {
              setPlaylist(tracks);
              // For audiobooks, we might want to resume progress
              const shouldResume =
                (track as any).progress && (track as any).progress > 0;
              play(track, undefined, shouldResume ? (track as any).progress : 0);
            }}
            onRefresh={fetchLocalItems}
          />
        );
      }

      return (
        <Row gutter={[16, 16]}>
          {albums.map((album) => (
            <Col key={album.name}>
              <Cover
                item={album as Album}
                onClick={() => setSelectedAlbum(album)}
              />
            </Col>
          ))}
        </Row>
      );
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {selectedAlbum && (
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => setSelectedAlbum(null)}
              type="text"
            />
          )}
          <Title level={2} className={styles.title} style={{ margin: 0 }}>
            {selectedAlbum ? selectedAlbum.name : t("nav.downloads")}
          </Title>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <Tooltip title="打开下载文件夹">
            <Button
              type="text"
              icon={<FolderOpenOutlined />}
              onClick={handleOpenFolder}
            />
          </Tooltip>
          <Button
            type="text"
            icon={<SyncOutlined spin={loading} />}
            onClick={fetchLocalItems}
            loading={loading}
          >
            {t("favorites.refresh")}
          </Button>
        </div>
      </div>

      <div className={styles.content}>{renderContent()}</div>
    </div>
  );
};

export default Downloads;
