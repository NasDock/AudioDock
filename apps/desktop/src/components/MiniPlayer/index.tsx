import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
import { Button, Drawer, Empty, Slider, Tooltip, Typography, theme } from "antd";
import React, { useEffect, useState } from "react";
import LazyImage from "../LazyImage";
import { useTranslation } from "react-i18next";
import type { Track } from "../../models";
import { resolveArtworkUri } from "../../services/trackResolver";
import { isMac, isTauri } from "../../utils/platform";
import { useAuthStore } from "../../store/auth";
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

  // 播放列表抽屉：数据在主窗口 store，mini 通过事件请求/接收
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueList, setQueueList] = useState<Track[]>([]);

  useEffect(() => {
    if (!isTauri()) return;

    // 注意：不要再调 get_player_state 初始化 —— Rust 侧 AppState.player_state
    // 从未被写入（update_player_state 只写托盘静态量），恒为默认值
    // （isPlaying=false、track=null），异步返回时还可能把 request-state
    // 回推的正确状态覆盖掉。初始状态完全由 player:request-state 回推提供。

    let unlistenUpdate: (() => void) | undefined;
    let unlistenLyric: (() => void) | undefined;
    let unlistenTheme: (() => void) | undefined;
    let unlistenQueue: (() => void) | undefined;

    const updateReady = listen("player:update", (event: any) => {
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

    const lyricReady = listen("lyric:update", (event: any) => {
      const payload = event.payload;
      if (payload.currentLyric) setCurrentLyric(payload.currentLyric);
    }).then((fn) => { unlistenLyric = fn; });

    // 主窗口切换主题时同步（settings 只在加载时从 localStorage 读一次，
    // 运行中不跨窗口自动同步）
    const themeReady = listen("theme:update", (event: any) => {
      const nextTheme = event.payload?.theme;
      if (nextTheme) {
        useSettingsStore.getState().updateGeneral("theme", nextTheme);
      }
    }).then((fn) => { unlistenTheme = fn; });

    // 主窗口回推的播放队列（打开列表抽屉时请求一次）
    const queueReady = listen("player:queue", (event: any) => {
      const payload = event.payload;
      if (Array.isArray(payload?.list)) setQueueList(payload.list);
    }).then((fn) => { unlistenQueue = fn; });

    // 主窗口暂停时不会推 timeupdate，主动请求一次全量状态（含进度）。
    // 必须等上面的 listen 全部注册完成再发请求 —— listen() 的 Promise  resolve
    // 才代表事件已在 Rust 侧注册；否则 main 回推的 player:update 会在监听器
    // 就绪前到达并被直接丢弃，mini 一直停留在默认封面/歌名/暂停态。
    Promise.all([updateReady, lyricReady, themeReady, queueReady]).then(() => {
      emitTo("main", "player:request-state").catch(() => {});
    });

    return () => {
      if (unlistenUpdate) unlistenUpdate();
      if (unlistenLyric) unlistenLyric();
      if (unlistenTheme) unlistenTheme();
      if (unlistenQueue) unlistenQueue();
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

  // macOS 拖动：less 里的 -webkit-app-region: drag 是 Chromium/WebView2 私有行为，
  // WKWebView 不支持，需在 mousedown 时显式调 startDragging。
  // Windows 仍走 CSS app-region，不重复触发避免双重拖动。
  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (!isTauri() || !isMac() || e.button !== 0) return;
    const target = e.target as HTMLElement;
    // 落在按钮/链接/输入/滑杆/抽屉等交互控件上时不触发窗口拖动
    if (target.closest("button, a, input, textarea, .ant-slider, .ant-drawer")) return;
    getCurrentWindow()
      .startDragging()
      .catch((err) => console.error("startDragging failed:", err));
  };

  const handleRestore = () => {
    if (isTauri()) {
      invoke("show_main_window").catch(console.error);
    }
    if (onRestore) onRestore();
  };

  // 当前用户 id：localStorage 里从来没有 "userId" 这个裸 key（旧写法恒为 0，
  // 导致 isLiked 恒 false —— 收藏不变实心、取消收藏发不出去）。
  // 用户实际存在 `user_<serverAddress>`（JSON），auth store 模块加载时已解析好，
  // 优先取 store，store 未初始化时按同样规则兜底解析 localStorage。
  const getUserId = (): number => {
    const fromStore = useAuthStore.getState().user?.id;
    if (fromStore) return fromStore;
    try {
      const addr =
        localStorage.getItem("serverAddress") || "http://localhost:3000";
      const raw = localStorage.getItem(`user_${addr}`);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.id ?? parsed?.user?.id ?? 0;
    } catch {
      return 0;
    }
  };
  const userId = getUserId();
  const isLiked = !!currentTrack?.likedByUsers?.some((n) => n.userId === userId);

  // 收藏状态在主窗口 store，mini 只发指令；主窗口 toggleLike 后
  // 会通过 player:update 把最新的 likedByUsers 回推过来刷新图标。
  const handleToggleLike = () => {
    if (!currentTrack || !isTauri()) return;
    emitTo("main", "player:toggle-like", {
      id: currentTrack.id,
      type: isLiked ? "unlike" : "like",
    }).catch(console.error);
  };

  const handleOpenQueue = () => {
    setQueueOpen(true);
    if (isTauri()) {
      emitTo("main", "player:request-queue").catch(() => {});
    }
  };

  const handlePlayQueueItem = (track: Track) => {
    if (track.id === currentTrack?.id || !isTauri()) return;
    emitTo("main", "player:play-track", { id: track.id }).catch(console.error);
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
      onMouseDown={handleDragMouseDown}
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
          // 队列抽屉底色：mac 毛玻璃窗用半透明透出 vibrancy，Win 不透明窗用实色
          "--mini-bg": isMac()
            ? withAlpha(token.colorBgContainer, 0.72)
            : token.colorBgContainer,
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
            disabled={!currentTrack}
            icon={isLiked ? <HeartFilled /> : <HeartOutlined />}
            onClick={handleToggleLike}
            className={`${styles.secondaryBtn} ${isLiked ? styles.liked : ""}`}
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
            onClick={handleOpenQueue}
            className={styles.secondaryBtn}
          />
        </div>
      </div>

      {/* 播放队列抽屉：盖满整个小窗，点歌曲切换播放 */}
      <Drawer
        title={t("player.playlistCount", { count: queueList.length })}
        placement="bottom"
        height="100%"
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        getContainer={false}
        className={styles.queueDrawer}
      >
        {queueList.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className={styles.queueList}>
            {queueList.map((track) => {
              const active = track.id === currentTrack?.id;
              return (
                <div
                  key={track.id}
                  className={`${styles.queueItem} ${active ? styles.queueItemActive : ""}`}
                  onClick={() => handlePlayQueueItem(track)}
                >
                  <LazyImage
                    src={getCoverUrl(track, 96)}
                    alt={track.name}
                    width={32}
                    height={32}
                    className={styles.queueCover}
                  />
                  <div className={styles.queueItemText}>
                    <Text ellipsis className={styles.queueItemName}>
                      {track.name}
                    </Text>
                    <Text ellipsis type="secondary" className={styles.queueItemArtist}>
                      {track.artist}
                    </Text>
                  </div>
                  {active && isPlaying && (
                    <CaretRightFilled className={styles.queuePlayingIcon} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default MiniPlayer;
