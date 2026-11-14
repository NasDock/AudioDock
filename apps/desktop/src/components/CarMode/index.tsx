import Icon, {
  HeartFilled,
  HeartOutlined,
  OrderedListOutlined,
  PauseCircleFilled,
  PlayCircleFilled,
  SoundOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
} from "@ant-design/icons";
import { Drawer, Popover, Slider, theme, Tooltip, Typography } from "antd";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import LoopOutlined from "../../assets/loop.svg?react";
import MusiclistOutlined from "../../assets/musiclist.svg?react";
import RandomOutlined from "../../assets/random.svg?react";
import SinglecycleOutlined from "../../assets/singlecycle.svg?react";
import { TrackType, type Track } from "../../models";
import { resolveArtworkUri } from "../../services/trackResolver";
import LazyImage from "../LazyImage";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import {
  useSettingsStore,
  type CarModeColumn,
  type CarModeMergedView,
} from "../../store/settings";
import { formatDuration } from "../../utils/formatDuration";
import Lyrics from "../Player/Lyrics";
import { QueueList } from "../Player/QueueList";
import styles from "./index.module.less";

const { Text, Title } = Typography;

const DEFAULT_MEDIA_WIDTH = 360;
const MIN_MEDIA_WIDTH = 240;
const MAX_MEDIA_WIDTH = 640;

export interface CarModeSeekBridge {
  current: ((value: number) => void) | null;
}

interface CarModeProps {
  /** 车机模式的内容栏，由 App 注入现有的 Header + 业务 Routes 布局 */
  children: React.ReactNode;
  /** Player 注入的 seek 桥，进度条拖动时真正控制 audio 元素 */
  seekBridge: CarModeSeekBridge;
}

const CarMode: React.FC<CarModeProps> = ({ children, seekBridge }) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    playlist,
    playMode,
    isRadioMode,
    playlistSource,
    isLoadingMore,
    play,
    pause,
    next,
    prev,
    setVolume,
    setMode,
    toggleLike,
    loadMoreSourceTracks,
  } = usePlayerStore();
  const { user } = useAuthStore();
  const { carMode, updateCarMode } = useSettingsStore();

  const [isPlaylistOpen, setIsPlaylistOpen] = useState(false);

  // 媒体栏宽度：拖动期间用本地 state 实时更新，松手后持久化到 settings
  // 注意：旧版本 persist 缓存里可能缺 columnWidths / 整个 carMode 分组，这里全部防御性兜底
  const [dragWidths, setDragWidths] = useState<
    Partial<Record<CarModeColumn, number>> | null
  >(null);
  const widths = dragWidths ?? carMode?.columnWidths ?? {};
  const getWidth = (column: CarModeColumn) =>
    widths[column] ?? DEFAULT_MEDIA_WIDTH;

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    column: CarModeColumn;
    startX: number;
    startWidth: number;
    /** 栏位在把手左侧为 1，右侧为 -1（向右拖变宽/向左拖变宽） */
    direction: 1 | -1;
  } | null>(null);

  const handleDragStart = useCallback(
    (column: CarModeColumn, direction: 1 | -1) =>
      (e: React.PointerEvent<HTMLElement>) => {
        e.preventDefault();
        dragStateRef.current = {
          column,
          startX: e.clientX,
          startWidth: getWidth(column),
          direction,
        };

        // Pointer Events 同时覆盖鼠标与触屏；pointer capture 保证移出元素/窗口仍能收到事件
        const handlePointerMove = (ev: PointerEvent) => {
          const drag = dragStateRef.current;
          if (!drag) return;
          const delta = (ev.clientX - drag.startX) * drag.direction;
          const next = Math.min(
            MAX_MEDIA_WIDTH,
            Math.max(MIN_MEDIA_WIDTH, drag.startWidth + delta),
          );
          setDragWidths((prev) => ({ ...(prev ?? widths), [drag.column]: next }));
        };

        const handlePointerUp = (ev: PointerEvent) => {
          const drag = dragStateRef.current;
          if (drag) {
            const delta = (ev.clientX - drag.startX) * drag.direction;
            const next = Math.min(
              MAX_MEDIA_WIDTH,
              Math.max(MIN_MEDIA_WIDTH, drag.startWidth + delta),
            );
            updateCarMode("columnWidths", {
              ...useSettingsStore.getState().carMode?.columnWidths,
              [drag.column]: next,
            });
          }
          dragStateRef.current = null;
          setDragWidths(null);
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerup", handlePointerUp);
          window.removeEventListener("pointercancel", handlePointerUp);
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        // 触屏下系统可能中断手势（如来电/手势接管），按结束处理
        window.addEventListener("pointercancel", handlePointerUp);
      },
    // widths 在拖动期间会随 dragWidths 变化，但拖动开始时已快照 startWidth，无需依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateCarMode],
  );

  // 卸载时兜底清理（理论上 mouseup 一定会触发，防万一）
  useEffect(() => {
    return () => {
      dragStateRef.current = null;
    };
  }, []);

  // 合并模式下封面/歌词的当前展示面，初始跟随设置的默认视图
  const [mergedViewOverride, setMergedViewOverride] =
    useState<CarModeMergedView | null>(null);
  const mergedView: CarModeMergedView =
    mergedViewOverride ?? carMode?.mergedDefaultView ?? "cover";

  const cycleMergedView = () => {
    setMergedViewOverride((prev) => {
      const current = prev ?? mergedView;
      if (current === "cover") return "lyrics";
      if (current === "lyrics") return "both";
      return "cover";
    });
  };

  const coverUrl = currentTrack
    ? resolveArtworkUri(currentTrack, { width: 300, format: "webp", quality: 80 }) ||
      `https://picsum.photos/seed/${currentTrack.id}/600/600`
    : null;

  const handleTogglePlay = () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  const handleSeek = (value: number) => {
    seekBridge.current?.(value);
  };

  /** 歌词中心行「从这行播放」：走主窗口暴露的 seek 桥，暂停时一并恢复播放 */
  const handleLyricSeekPlay = (time: number) => {
    seekBridge.current?.(time);
    const state = usePlayerStore.getState();
    if (!state.isPlaying) state.play();
  };

  const isLiked = currentTrack?.likedByUsers?.some(
    (l) => l.userId === (user?.id || 0),
  );

  const handleToggleLike = () => {
    if (!currentTrack) return;
    toggleLike(currentTrack.id, isLiked ? "unlike" : "like");
  };

  const PLAY_MODES = [
    { key: "sequence", icon: MusiclistOutlined, labelKey: "player.sequencePlay" },
    { key: "shuffle", icon: RandomOutlined, labelKey: "player.shufflePlay" },
    { key: "loop", icon: LoopOutlined, labelKey: "player.loopList" },
    { key: "single", icon: SinglecycleOutlined, labelKey: "player.singleLoop" },
  ] as const;

  const playModeMeta =
    PLAY_MODES.find((m) => m.key === playMode) ?? PLAY_MODES[0];

  const renderPlayModeButton = () => {
    if (isRadioMode) return null;
    return (
      <Popover
        trigger="click"
        placement="top"
        content={
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {PLAY_MODES.map((mode) => (
              <div
                key={mode.key}
                className={`${styles.playModeMenuItem} ${
                  playMode === mode.key ? styles.playModeMenuItemActive : ""
                }`}
                onClick={() => setMode(mode.key)}
              >
                <Icon component={mode.icon} style={{ fontSize: 20 }} />
                <Text>{t(mode.labelKey)}</Text>
              </div>
            ))}
          </div>
        }
      >
        <Tooltip title={t("player.playOrder")}>
          <Icon component={playModeMeta.icon} className={styles.extraIcon} />
        </Tooltip>
      </Popover>
    );
  };

  // 喜欢/音量/播放列表等小图标按钮（不再单独成行，由 renderButtonRow 统一排列）
  const renderLikeButton = () =>
    currentTrack && currentTrack.type !== TrackType.AUDIOBOOK ? (
      <Tooltip title={t("player.like")}>
        {isLiked ? (
          <HeartFilled
            className={`${styles.extraIcon} ${styles.likeActive}`}
            onClick={handleToggleLike}
          />
        ) : (
          <HeartOutlined
            className={styles.extraIcon}
            onClick={handleToggleLike}
          />
        )}
      </Tooltip>
    ) : null;

  const renderVolumeButton = () => (
    <Popover
      trigger="click"
      placement="top"
      content={
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text style={{ fontSize: 12 }}>
            {t("player.volume")}: {volume}%
          </Text>
          <Slider
            style={{ width: 100 }}
            value={volume}
            max={100}
            onChange={setVolume}
          />
        </div>
      }
    >
      <Tooltip title={t("player.volume")}>
        <SoundOutlined className={styles.extraIcon} />
      </Tooltip>
    </Popover>
  );

  const renderPlaylistButton = () =>
    !isRadioMode ? (
      <Tooltip title={t("player.playlist")}>
        <OrderedListOutlined
          className={styles.extraIcon}
          onClick={() => setIsPlaylistOpen(true)}
        />
      </Tooltip>
    ) : null;

  // 所有控制按钮同一行：左 喜欢/播放模式，中 上一首/播放暂停/下一首，右 音量/播放列表
  const renderButtonRow = () => (
    <div className={styles.buttonRow}>
      {renderLikeButton()}
      {renderPlayModeButton()}
      <StepBackwardOutlined className={styles.controlButton} onClick={prev} />
      {isPlaying ? (
        <PauseCircleFilled
          className={styles.playButton}
          style={{ color: token.colorPrimary }}
          onClick={handleTogglePlay}
        />
      ) : (
        <PlayCircleFilled
          className={styles.playButton}
          style={{ color: token.colorPrimary }}
          onClick={handleTogglePlay}
        />
      )}
      <StepForwardOutlined className={styles.controlButton} onClick={next} />
      {renderVolumeButton()}
      {renderPlaylistButton()}
    </div>
  );

  const renderControls = () => (
    <div className={styles.controls}>
      <div className={styles.progressRow}>
        <Text className={styles.timeText}>{formatDuration(currentTime)}</Text>
        <Slider
          className={styles.progressSlider}
          min={0}
          max={duration || 0}
          value={Math.min(currentTime, duration || 0)}
          onChange={handleSeek}
          tooltip={{ formatter: (v) => formatDuration(v ?? 0) }}
        />
        <Text className={styles.timeText}>{formatDuration(duration)}</Text>
      </div>
      {renderButtonRow()}
    </div>
  );

  const renderTrackInfo = () => (
    <div className={styles.trackInfo}>
      <Title level={4} className={styles.trackTitle} ellipsis>
        {currentTrack?.name || t("player.noTrack")}
      </Title>
      <Text type="secondary" className={styles.trackArtist} ellipsis>
        {currentTrack?.artist || "-"}
      </Text>
    </div>
  );

  const renderCover = (clickToSwitch: boolean) => (
    <div
      className={`${styles.coverPane} ${clickToSwitch ? styles.switchable : ""}`}
      onClick={clickToSwitch ? cycleMergedView : undefined}
    >
      {coverUrl ? (
        <LazyImage
          src={coverUrl}
          alt="cover"
          width={"100%"}
          height={"100%"}
          className={styles.coverImage}
        />
      ) : (
        <div
          className={styles.coverPlaceholder}
          style={{ background: token.colorFillSecondary }}
        />
      )}
      {clickToSwitch && (
        <div className={styles.switchHint}>
          {mergedView === "cover"
            ? t("settings.carModeTapToLyrics")
            : t("settings.carModeTapToBoth")}
        </div>
      )}
    </div>
  );

  const renderLyrics = (clickToSwitch: boolean) => (
    <div
      className={`${styles.lyricsPane} ${clickToSwitch ? styles.switchable : ""}`}
      onClick={clickToSwitch ? cycleMergedView : undefined}
    >
      <Lyrics
        lyrics={currentTrack?.lyrics ?? null}
        currentTime={currentTime}
        hideScrollbar
        onSeekPlay={handleLyricSeekPlay}
        trackId={currentTrack?.id}
      />
      {clickToSwitch && (
        <div className={styles.switchHint}>
          {mergedView === "lyrics"
            ? t("settings.carModeTapToBoth")
            : t("settings.carModeTapToCover")}
        </div>
      )}
    </div>
  );

  // both：上面小封面，下面歌词滚动；点击封面区或歌词区都可继续循环切换
  const renderBoth = () => (
    <div className={styles.bothPane}>
      <div
        className={styles.bothCoverArea}
        onClick={cycleMergedView}
      >
        {coverUrl ? (
          <LazyImage
            src={coverUrl}
            alt="cover"
            width={"100%"}
            height={"100%"}
            className={styles.bothCoverImage}
          />
        ) : (
          <div
            className={styles.bothCoverPlaceholder}
            style={{ background: token.colorFillSecondary }}
          />
        )}
      </div>
      <div
        className={styles.bothLyricsArea}
        onClick={cycleMergedView}
      >
        <Lyrics
          lyrics={currentTrack?.lyrics ?? null}
          currentTime={currentTime}
          hideScrollbar
          onSeekPlay={handleLyricSeekPlay}
          trackId={currentTrack?.id}
        />
      </div>
      <div className={styles.switchHint}>{t("settings.carModeTapToCover")}</div>
    </div>
  );

  const renderMediaColumn = () => {
    if (carMode?.mergeCoverLyrics) {
      return (
        <div className={styles.mediaColumn} style={{ width: getWidth("cover") }}>
          {renderTrackInfo()}
          <div className={styles.mediaBody}>
            {mergedView === "cover"
              ? renderCover(true)
              : mergedView === "lyrics"
                ? renderLyrics(true)
                : renderBoth()}
          </div>
          {renderControls()}
        </div>
      );
    }
    return null;
  };

  const renderCoverColumn = () => (
    <div className={styles.mediaColumn} style={{ width: getWidth("cover") }}>
      {renderTrackInfo()}
      <div className={styles.mediaBody}>{renderCover(false)}</div>
      {renderControls()}
    </div>
  );

  const renderLyricsColumn = () => (
    <div className={styles.mediaColumn} style={{ width: getWidth("lyrics") }}>
      <div className={styles.mediaBody}>{renderLyrics(false)}</div>
    </div>
  );

  const renderColumn = (column: CarModeColumn) => {
    switch (column) {
      case "content":
        return (
          <div key="content" className={styles.contentColumn}>
            {children}
          </div>
        );
      case "cover":
        // 合并模式下封面/歌词合成一栏，由 mediaColumn 统一渲染
        return carMode?.mergeCoverLyrics ? (
          <React.Fragment key="cover">{renderMediaColumn()}</React.Fragment>
        ) : (
          <React.Fragment key="cover">{renderCoverColumn()}</React.Fragment>
        );
      case "lyrics":
        // 合并模式下歌词栏已被 mediaColumn 吸收，跳过
        if (carMode?.mergeCoverLyrics) return null;
        return (
          <React.Fragment key="lyrics">{renderLyricsColumn()}</React.Fragment>
        );
      default:
        return null;
    }
  };

  // 合并模式下，无论顺序如何，媒体栏只渲染一次（取 cover/lyrics 中先出现的那个位置）
  const mergeEnabled = carMode?.mergeCoverLyrics ?? false;
  const columnOrder = carMode?.columnOrder ?? ["cover", "lyrics", "content"];
  const orderedColumns: CarModeColumn[] = mergeEnabled
    ? (() => {
        const order = [...columnOrder];
        const coverIdx = order.indexOf("cover");
        const lyricsIdx = order.indexOf("lyrics");
        const removeIdx = Math.max(coverIdx, lyricsIdx);
        // 保留先出现的那个作为合并栏位置，移除后出现的
        order.splice(removeIdx, 1);
        return order;
      })()
    : columnOrder;

  // 拖拽把手：位于两个相邻栏之间。媒体栏为固定宽度、内容区 flex 自适应，
  // 因此把手拖动的是相邻的媒体栏宽度。返回 null 表示该间隔不可拖（两侧都不是媒体栏）。
  // 细线中央叠一个胶囊形拖动按钮，给触屏提供更大的可点按热区（Pointer Events 同时覆盖鼠标/触屏）。
  const renderHandle = (index: number) => {
    const left = orderedColumns[index - 1];
    const right = orderedColumns[index];
    // 拖动左栏（媒体栏在把手左侧，向右拖变宽）
    if (left && left !== "content") {
      return (
        <div
          key={`handle-${index}`}
          className={styles.resizeHandle}
          onPointerDown={handleDragStart(left, 1)}
        >
          <div className={styles.dragButton}>
            <span />
            <span />
          </div>
        </div>
      );
    }
    // 拖动右栏（媒体栏在把手右侧，向左拖变宽）
    if (right && right !== "content") {
      return (
        <div
          key={`handle-${index}`}
          className={styles.resizeHandle}
          onPointerDown={handleDragStart(right, -1)}
        >
          <div className={styles.dragButton}>
            <span />
            <span />
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={styles.carMode} ref={containerRef}>
      {orderedColumns.map((column, index) => (
        <React.Fragment key={column}>
          {index > 0 && renderHandle(index)}
          {renderColumn(column)}
        </React.Fragment>
      ))}

      <Drawer
        title={t("player.playlistTitle")}
        placement="right"
        width={420}
        open={isPlaylistOpen}
        onClose={() => setIsPlaylistOpen(false)}
      >
        <QueueList
          tracks={playlist}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          hasMore={playlistSource?.hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMoreSourceTracks}
          onPlay={(track: Track) => play(track)}
          onPuse={() => pause()}
          onToggleLike={(_, track, type) => toggleLike(track.id, type)}
          // 车机模式不开放队列编辑，传 no-op
          onAddToPlaylist={() => undefined}
          onDelete={() => undefined}
        />
      </Drawer>
    </div>
  );
};

export default CarMode;
