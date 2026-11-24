import { Spin, theme, Typography, Button, Drawer, List } from "antd";
import { OrderedListOutlined, PauseCircleFilled, PlayCircleFilled, StepBackwardFilled, StepForwardFilled } from "@ant-design/icons";
import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  getMvById,
  getMvByTrackId,
  TrackingEvent as TE,
  TrackingFeature as TF,
} from "@soundx/services";
import type { Mv } from "@soundx/services";
import styles from "./index.module.less";
import { usePlayerStore } from "../../store/player";
import { useMvPlaylistStore } from "../../store/mvPlaylist";
import { resolveArtworkUri } from "../../services/trackResolver";
import { trackEvent } from "../../services/tracking";
import { getBaseURL } from "../../https";

const { Title, Text } = Typography;

const MvDetail: React.FC = () => {
  const { token } = theme.useToken();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const trackId = queryParams.get('trackId');
  
  const [mv, setMv] = useState<Mv | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const { pause } = usePlayerStore();
  const { list, currentIndex, setPlaylist, next, prev, hasNext, hasPrev } = useMvPlaylistStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const openReportedRef = useRef(false);

  const inPlaylist = list.length > 1;

  useEffect(() => {
    if (!openReportedRef.current) {
      openReportedRef.current = true;
      trackEvent({
        feature: TF.CONTENT,
        eventName: TE.CONTENT_MV_OPEN,
        metadata: { mvId: id, page: "detail" },
      });
    }
    pause();
    
    const loadData = async () => {
      setLoading(true);
      try {
        const playlistItem = list[currentIndex];
        if (playlistItem && String(playlistItem.id) === id) {
          setMv(playlistItem);
        } else if (trackId) {
          const res = await getMvByTrackId(Number(trackId));
          if (res) setMv(res);
        } else if (id) {
          const res = await getMvById(Number(id));
          if (res) setMv(res);
        }
      } catch (error) {
        console.error("Failed to load mv detail", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [currentIndex, id, list, pause, trackId]);

  const handlePlayMv = (targetMv: Mv) => {
    if (targetMv.id === mv?.id) return;
    const targetIndex = list.findIndex((item) => item.id === targetMv.id);
    if (targetIndex >= 0 && targetIndex !== currentIndex) {
      setPlaylist(list, targetIndex);
    }
    navigate(`/mv/${targetMv.id}`, { replace: true });
  };

  const handlePrevMv = () => {
    const prevMv = prev();
    if (prevMv) {
      navigate(`/mv/${prevMv.id}`, { replace: true });
    }
  };

  const handleNextMv = () => {
    const nextMv = next();
    if (nextMv) {
      navigate(`/mv/${nextMv.id}`, { replace: true });
    }
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      await video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <Spin size="large" />
      </div>
    );
  }

  if (!mv) {
    return (
      <div className={styles.errorContainer} style={{ color: token.colorText }}>
        <Title level={4}>MV Not Found</Title>
        <Button onClick={() => navigate(-1)}>Go Back</Button>
      </div>
    );
  }

  const videoUrl = mv.path?.startsWith('http')
    ? mv.path
    : `${getBaseURL()}${mv.path.split('/').map(encodeURIComponent).join('/')}`;
  const posterUrl = mv.cover ? resolveArtworkUri(mv.cover, { width: 600 }) : undefined;

  return (
    <div className={styles.container}>
      <div className={styles.videoWrapper}>
        <video 
          ref={videoRef}
          className={styles.video} 
          src={videoUrl} 
          controls 
          autoPlay 
          poster={posterUrl}
          onEnded={() => {
            const nextMv = list[currentIndex + 1];
            if (nextMv) handlePlayMv(nextMv);
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      </div>

      <div className={styles.info}>
        <div className={styles.titleRow}>
          <div className={styles.infoMain}>
            <div className={styles.controlGroup}>
              <button
                type="button"
                className={`${styles.controlBtn} ${!hasPrev() ? styles.controlBtnDisabled : ""}`}
                style={{
                  background: hasPrev() ? token.colorFillSecondary : token.colorFillQuaternary,
                  color: hasPrev() ? token.colorText : token.colorTextQuaternary,
                }}
                onClick={handlePrevMv}
                disabled={!hasPrev()}
                aria-label="上一首"
              >
                <StepBackwardFilled />
              </button>
              <button
                type="button"
                className={`${styles.controlBtn} ${styles.controlBtnPrimary}`}
                style={{
                  background: token.colorFillSecondary,
                  color: token.colorText,
                }}
                onClick={togglePlayback}
                aria-label={isPlaying ? "暂停" : "播放"}
              >
                {isPlaying ? <PauseCircleFilled /> : <PlayCircleFilled />}
              </button>
              <button
                type="button"
                className={`${styles.controlBtn} ${!hasNext() ? styles.controlBtnDisabled : ""}`}
                style={{
                  background: hasNext() ? token.colorFillSecondary : token.colorFillQuaternary,
                  color: hasNext() ? token.colorText : token.colorTextQuaternary,
                }}
                onClick={handleNextMv}
                disabled={!hasNext()}
                aria-label="下一首"
              >
                <StepForwardFilled />
              </button>
            </div>
            <div className={styles.metaBlock}>
            <Title level={3} style={{ margin: '0 0 8px 0', color: token.colorText }}>
              {mv.name}
            </Title>
            {mv.artist && (
              <Text style={{ color: token.colorTextSecondary, fontSize: 16 }}>
                {mv.artist}
              </Text>
            )}
            </div>
          </div>
          {inPlaylist && (
            <Button
              icon={<OrderedListOutlined />}
              onClick={() => setDrawerOpen(true)}
            >
              播放列表 ({list.length})
            </Button>
          )}
        </div>
      </div>

      <Drawer
        title={`MV 播放列表 (${list.length})`}
        placement="right"
        width={400}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        <List
          dataSource={list}
          renderItem={(item, index) => (
            <List.Item
              style={{
                cursor: 'pointer',
                background: item.id === mv?.id ? token.colorFillTertiary : 'transparent',
                padding: '8px 12px',
                borderRadius: 8,
              }}
              onClick={() => {
                handlePlayMv(item);
                setDrawerOpen(false);
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                <div style={{ width: 28, textAlign: 'center', color: item.id === mv?.id ? token.colorPrimary : token.colorTextSecondary, fontWeight: item.id === mv?.id ? 'bold' : 'normal' }}>
                  {index + 1}
                </div>
                <img
                  src={
                    item.cover
                      ? resolveArtworkUri(item.cover, { width: 128 })
                      : undefined
                  }
                  alt={item.name}
                  style={{ width: 64, height: 36, objectFit: 'cover', borderRadius: 4 }}
                />
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <Text ellipsis style={{ color: item.id === mv?.id ? token.colorPrimary : token.colorText, fontWeight: item.id === mv?.id ? 'bold' : 'normal' }}>
                    {item.name}
                  </Text>
                  {item.artist && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>{item.artist}</Text>
                    </div>
                  )}
                </div>
              </div>
            </List.Item>
          )}
        />
      </Drawer>
    </div>
  );
};

export default MvDetail;
