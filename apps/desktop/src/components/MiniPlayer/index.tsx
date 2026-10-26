import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import {
    CaretRightFilled,
    HeartFilled,
    HeartOutlined,
    PauseOutlined,
    PushpinFilled,
    PushpinOutlined,
    SelectOutlined,
    StepBackwardFilled,
    StepForwardFilled,
    UnorderedListOutlined,
} from "@ant-design/icons";
import { Button, Slider, Tooltip, Typography, theme } from "antd";
import React, { useEffect, useState } from "react";
import LazyImage from "../LazyImage";
import { useTranslation } from "react-i18next";
import type { Track } from "../../models";
import { resolveArtworkUri } from "../../services/trackResolver";
import { isTauri } from "../../utils/platform";
import styles from "./index.module.less";

const { Text } = Typography;

interface MiniPlayerProps {
  onRestore?: () => void;
}

const MiniPlayer: React.FC<MiniPlayerProps> = ({ onRestore }) => {  const { token } = theme.useToken();
  const { t } = useTranslation();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(240);
  const [currentLyric, setCurrentLyric] = useState<string>("");

  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true);

  useEffect(() => {
    if (!isTauri()) return;

    const fetchState = async () => {
      try {
        const state = await invoke<{
          isPlaying: boolean;
          track: Track | null;
          currentTime: number;
          duration: number;
        }>("get_player_state");
        if (state) {
          setIsPlaying(state.isPlaying);
          setCurrentTrack(state.track);
          if (state.currentTime !== undefined) setCurrentTime(state.currentTime);
          if (state.duration !== undefined) setDuration(state.duration);
        }
      } catch (e) {
        console.error("Failed to get player state:", e);
      }
    };

    fetchState();

    let unlistenUpdate: (() => void) | undefined;
    let unlistenLyric: (() => void) | undefined;

    listen("player:update", (event: any) => {
      const payload = event.payload;
      if (payload.isPlaying !== undefined) setIsPlaying(payload.isPlaying);
      if (payload.track !== undefined) {
        setCurrentTrack(payload.track);
        setCurrentLyric("");
      }
      if (payload.currentTime !== undefined)
        setCurrentTime(payload.currentTime);
      if (payload.duration !== undefined) setDuration(payload.duration);
    }).then((fn) => { unlistenUpdate = fn; });

    listen("lyric:update", (event: any) => {
      const payload = event.payload;
      if (payload.currentLyric) setCurrentLyric(payload.currentLyric);
    }).then((fn) => { unlistenLyric = fn; });

    return () => {
      if (unlistenUpdate) unlistenUpdate();
      if (unlistenLyric) unlistenLyric();
    };
  }, []);

  const toggleAlwaysOnTop = () => {
    const newState = !isAlwaysOnTop;
    setIsAlwaysOnTop(newState);
    if (isTauri()) {
      invoke("set_always_on_top", { enable: newState }).catch(console.error);
    }
  };

  const play = () => {
    if (isTauri()) {
      emitTo("main", "player:toggle").catch(console.error);
    }
  };
  const pause = () => {
    if (isTauri()) {
      emitTo("main", "player:toggle").catch(console.error);
    }
  };
  const next = () => {
    if (isTauri()) {
      emitTo("main", "player:next").catch(console.error);
    }
  };
  const prev = () => {
    if (isTauri()) {
      emitTo("main", "player:prev").catch(console.error);
    }
  };

  const handleRestore = () => {
    if (isTauri()) {
      invoke("show_main_window").catch(console.error);
    }
    if (onRestore) onRestore();
  };

  const getCoverUrl = (item?: Track | null, width = 300) => {
    if (!item) return "https://picsum.photos/200/200";
    return resolveArtworkUri(item, { width }) || "https://picsum.photos/200/200";
  };

  const formatTime = (time: number) => {
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // 播放按钮 icon 用反差色：主题色偏浅时用深色 icon，否则白色。
  // 支持 #rgb/#rrggbb/#rrggbbaa 与 rgb()/rgba() 格式。
  const getContrastColor = (bg: string): string => {
    let r = 0;
    let g = 0;
    let b = 0;
    const s = bg.trim();
    if (s.startsWith("#")) {
      const h = s.slice(1);
      const full =
        h.length === 3
          ? h
              .split("")
              .map((c) => c + c)
              .join("")
          : h.slice(0, 6);
      r = parseInt(full.slice(0, 2), 16);
      g = parseInt(full.slice(2, 4), 16);
      b = parseInt(full.slice(4, 6), 16);
    } else {
      const m = s.match(/(\d+(\.\d+)?)/g);
      if (m && m.length >= 3) {
        r = Number(m[0]);
        g = Number(m[1]);
        b = Number(m[2]);
      }
    }
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return "#fff";
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? "rgba(0, 0, 0, 0.88)" : "#fff";
  };
  const playIconColor = getContrastColor(token.colorPrimary);

  return (
    <div
      className={styles.container}
      style={{ backgroundColor: token.colorBgContainer }}
    >
      {/* Top Bar: Window Actions */}
      <div className={styles.topBar}>
        <div></div>
        <div className={styles.windowActionsRight}>
          <Tooltip title={t('miniPlayer.backToMain')}>
            <Button
              type="text"
              size="small"
              icon={<SelectOutlined />}
              onClick={handleRestore}
              className={styles.iconBtn}
            />
          </Tooltip>
          <Tooltip title={isAlwaysOnTop ? t('miniPlayer.unpin') : t('miniPlayer.pin')}>
            <Button
              type="text"
              size="small"
              icon={isAlwaysOnTop ? <PushpinFilled /> : <PushpinOutlined />}
              onClick={toggleAlwaysOnTop}
              className={`${styles.iconBtn} ${
                isAlwaysOnTop ? styles.active : ""
              }`}
            />
          </Tooltip>
        </div>
      </div>

      {/* Info Section */}
      <div className={styles.infoSection}>
        <LazyImage
          src={getCoverUrl(currentTrack, 128)}
          alt={currentTrack?.name}
          width={48}
          height={48}
          className={styles.cover}
        />
        <div className={styles.infoText}>
          <div className={styles.titleRow}>
            <Text ellipsis className={styles.title}>
              {currentTrack?.name || "SoundX"}
            </Text>
          </div>
          <Text
            ellipsis
            type="secondary"
            className={styles.artist}
            style={{ color: currentLyric ? token.colorPrimary : undefined }}
          >
            {currentLyric || currentTrack?.artist || "AudioDock"}
          </Text>
        </div>
      </div>

      {/* Progress */}
      <div className={styles.progressSection}>
        <Text type="secondary">{formatTime(currentTime)}</Text>
        <Slider
          min={0}
          max={duration}
          value={currentTime}
          tooltip={{ formatter: null }}
          className={styles.slider}
          styles={{
            track: { background: token.colorPrimary },
            handle: { display: "none" },
          }}
        />
        <Text type="secondary">{formatTime(duration)}</Text>
      </div>

      {/* Controls */}
      <div className={styles.controlsSection}>
        <div className={styles.controlSide}>
          <Button
            type="text"
            size="small"
            icon={
              currentTrack?.likedByUsers?.find(
                (n) => n.userId === Number(localStorage.getItem("userId"))
              ) ? (
                <HeartFilled />
              ) : (
                <HeartOutlined />
              )
            }
            className={styles.secondaryBtn}
          />
        </div>
        <div className={styles.controlCenter}>
          <Button
            type="text"
            icon={<StepBackwardFilled />}
            onClick={prev}
            className={styles.prevNextBtn}
          />

          <div
            className={styles.playButtonWrapper}
            style={{ background: token.colorPrimary }}
            onClick={isPlaying ? pause : play}
          >
            {isPlaying ? (
              <PauseOutlined style={{ color: playIconColor }} />
            ) : (
              <CaretRightFilled style={{ color: playIconColor }} />
            )}
          </div>

          <Button
            type="text"
            icon={<StepForwardFilled />}
            onClick={next}
            className={styles.prevNextBtn}
          />
        </div>
        <div className={styles.controlSide}>
          <Button
            type="text"
            size="small"
            icon={<UnorderedListOutlined />}
            className={styles.secondaryBtn}
          />
        </div>
      </div>
    </div>
  );
};

export default MiniPlayer;
