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
import { isMac, isTauri } from "../../utils/platform";
import { useSettingsStore } from "../../store/settings";
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
          // 注意：Rust 侧 AppState.player_state 从未被写入，currentTime/duration
          // 恒为 null，不能用（还会覆盖 request-state 回推的正确进度）。
          // 进度由下方的 player:request-state 回推 + timeupdate 推送提供。
        }
      } catch (e) {
        console.error("Failed to get player state:", e);
      }
    };

    fetchState();

    let unlistenUpdate: (() => void) | undefined;
    let unlistenLyric: (() => void) | undefined;
    let unlistenTheme: (() => void) | undefined;

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

    // 主窗口切换主题时同步（settings 只在加载时从 localStorage 读一次，
    // 运行中不跨窗口自动同步）
    listen("theme:update", (event: any) => {
      const nextTheme = event.payload?.theme;
      if (nextTheme) {
        useSettingsStore.getState().updateGeneral("theme", nextTheme);
      }
    }).then((fn) => { unlistenTheme = fn; });

    // 主窗口暂停时不会推 timeupdate，主动请求一次全量状态（含进度）
    emitTo("main", "player:request-state").catch(() => {});

    return () => {
      if (unlistenUpdate) unlistenUpdate();
      if (unlistenLyric) unlistenLyric();
      if (unlistenTheme) unlistenTheme();
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

  // 解析 #rgb/#rrggbb/#rrggbbaa 与 rgb()/rgba() 为 [r, g, b]。
  const parseColor = (bg: string): [number, number, number] | null => {
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
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return [r, g, b];
    }
    const m = s.match(/(\d+(\.\d+)?)/g);
    if (m && m.length >= 3) {
      return [Number(m[0]), Number(m[1]), Number(m[2])];
    }
    return null;
  };

  // 播放按钮 icon 用反差色：主题色偏浅时用深色 icon，否则白色。
  const getContrastColor = (bg: string): string => {
    const rgb = parseColor(bg);
    if (!rgb || rgb.some((n) => Number.isNaN(n))) return "#fff";
    const [r, g, b] = rgb;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? "rgba(0, 0, 0, 0.88)" : "#fff";
  };

  // 主题色加透明度（播放按钮阴影用），解析失败时退回中性阴影。
  const withAlpha = (bg: string, alpha: number): string => {
    const rgb = parseColor(bg);
    if (!rgb || rgb.some((n) => Number.isNaN(n))) return `rgba(0, 0, 0, ${alpha})`;
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  };

  const playIconColor = getContrastColor(token.colorPrimary);

  return (
    <div
      className={styles.container}
      // macOS 窗口带 popover 材质（毛玻璃），容器背景必须透明才能透出；
      // Windows/Linux 为不透明窗口，用主题容器色填充（与主窗口背景一致）。
      //
      // 主题未启用 antd cssVar，less 里无法直接引用 --ant-* 变量，
      // 这里把组件需要的主题 token 以 --mini-* CSS 变量注入，明暗主题自动适配。
      style={
        {
          backgroundColor: isMac() ? "transparent" : token.colorBgContainer,
          "--mini-text": token.colorText,
          "--mini-text-tertiary": token.colorTextTertiary,
          "--mini-primary": token.colorPrimary,
          "--mini-primary-shadow": withAlpha(token.colorPrimary, 0.3),
          "--mini-rail": token.colorFillSecondary,
        } as React.CSSProperties
      }
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
