import { PlayCircleFilled } from "@ant-design/icons";
import { Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import React, { useCallback, useEffect, useRef, useState } from "react";
import styles from "./index.module.less";

const { Text } = Typography;

/** 手动滚动停止后，多久没点播放就回到当前播放行 */
const IDLE_TIMEOUT_MS = 2000;
/** 程序化滚动（自动跟随 / 回弹）的保护期，避免平滑动画被误判成用户滚动 */
const PROGRAMMATIC_SCROLL_GUARD_MS = 1000;

interface LyricsProps {
  lyrics: string | null;
  currentTime: number;
  /** 完全隐藏滚动条（保留滚动能力）。车机模式使用：自动滚动与手动滚动条交替出现会导致滚动条抽搐 */
  hideScrollbar?: boolean;
  /** 从指定秒数开始播放；由调用方负责 seek，并在暂停时恢复播放 */
  onSeekPlay?: (time: number) => void;
  /** 切歌时复位拖动接管状态 */
  trackId?: string | number;
}

interface LyricLine {
  time: number;
  text: string;
}

/** position 落在 [line[i].time, line[i+1].time) 即为当前行；早于首行兜底第 0 行 */
const resolveActiveIndex = (lines: LyricLine[], time: number): number => {
  if (lines.length === 0) return -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time <= time && (i === lines.length - 1 || lines[i + 1].time > time)) {
      return i;
    }
  }
  return 0;
};

const formatLyricTime = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
};

const Lyrics: React.FC<LyricsProps> = ({
  lyrics,
  currentTime,
  hideScrollbar,
  onSeekPlay,
  trackId,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [parsedLyrics, setParsedLyrics] = useState<LyricLine[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showManualScrollbar, setShowManualScrollbar] = useState(false);

  /** 手动滚动接管：ref 供自动滚动闸门/点击拦截同步读，state 只驱动中心操作条显隐 */
  const interactingRef = useRef(false);
  const [interacting, setInteracting] = useState(false);
  const [centeredIndex, setCenteredIndex] = useState(-1);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const autoScrollingRef = useRef(false);
  const autoScrollResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const manualScrollHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // 原生 scroll / 定时器回调里必须读最新值，不能用创建时的闭包快照
  const parsedLyricsRef = useRef(parsedLyrics);
  parsedLyricsRef.current = parsedLyrics;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const centeredIndexRef = useRef(centeredIndex);
  centeredIndexRef.current = centeredIndex;

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  /** 把某一行滚到容器垂直中心，并在平滑动画期间挂上「程序化滚动」保护 */
  const scrollToIndex = useCallback((index: number, smooth = true): boolean => {
    const container = containerRef.current;
    const line = lineRefs.current[index];
    if (!container || !line) return false;

    // 容器自身没有 position，offsetTop 会锚到更上层的 .fullPlayerContent，
    // 因此用 getBoundingClientRect 换算行在滚动内容中的位置
    const containerRect = container.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const lineTopInContent =
      lineRect.top - containerRect.top + container.scrollTop;
    const offset =
      lineTopInContent - container.clientHeight / 2 + lineRect.height / 2;

    autoScrollingRef.current = true;
    if (autoScrollResetTimerRef.current) {
      clearTimeout(autoScrollResetTimerRef.current);
    }
    container.scrollTo({
      top: Math.max(0, offset),
      behavior: smooth ? "smooth" : "auto",
    });
    // scrollend 事件（下方监听）会提前精确解除标记，定时器只是不支持时的兜底
    autoScrollResetTimerRef.current = setTimeout(() => {
      autoScrollingRef.current = false;
      autoScrollResetTimerRef.current = null;
    }, PROGRAMMATIC_SCROLL_GUARD_MS);
    return true;
  }, []);

  /** 视口垂直中心落在哪一行（用 DOM 实测，天然适配字号/行高/分栏宽度） */
  const findCenteredIndex = useCallback((): number => {
    const container = containerRef.current;
    if (!container) return -1;
    const rect = container.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    let nearest = -1;
    let nearestDistance = Infinity;
    const total = parsedLyricsRef.current.length;
    for (let i = 0; i < total; i += 1) {
      const line = lineRefs.current[i];
      if (!line) continue;
      const r = line.getBoundingClientRect();
      if (centerY >= r.top && centerY < r.bottom) return i;
      const distance = Math.abs(r.top + r.height / 2 - centerY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    }
    return nearest;
  }, []);

  // Parse lyrics
  useEffect(() => {
    if (!lyrics) {
      setParsedLyrics([]);
      return;
    }

    const lines = lyrics.split(/\r?\n/);
    const parsed: LyricLine[] = [];
    // Regex to match all timestamps in a line: [mm:ss.xx], [mm:ss:xx], or [mm:ss]
    // Group 1: Part 1 (mm or hh)
    // Group 2: Part 2 (ss or mm)
    // Group 3: Separator (. or :)
    // Group 4: Part 3 (xx or ss)
    const timeRegex = /\[(\d+):(\d+)(?:([\.:])(\d+))?\]/g;

    lines.forEach((line) => {
      const matches = [...line.matchAll(timeRegex)];
      if (matches.length > 0) {
        const text = line.replace(timeRegex, "").trim();
        if (text) {
          matches.forEach((match) => {
            const part1 = parseInt(match[1], 10);
            const part2 = parseInt(match[2], 10);
            const separator = match[3];
            const part3Str = match[4];

            let time = 0;
            // If separator is ':' and we have 3 parts, assume hh:mm:ss
            if (separator === ":" && part3Str) {
              const hours = part1;
              const minutes = part2;
              const seconds = parseInt(part3Str, 10);
              time = hours * 3600 + minutes * 60 + seconds;
            } else {
              // Assume mm:ss.xx or mm:ss
              const minutes = part1;
              const seconds = part2;
              const milliseconds = part3Str
                ? parseInt(part3Str.padEnd(3, "0"), 10)
                : 0;
              time = minutes * 60 + seconds + milliseconds / 1000;
            }

            parsed.push({ time, text });
          });
        }
      }
    });

    parsed.sort((a, b) => a.time - b.time);
    setParsedLyrics(parsed);
  }, [lyrics]);

  // Find active line
  useEffect(() => {
    setActiveIndex(resolveActiveIndex(parsedLyrics, currentTime));
  }, [currentTime, parsedLyrics]);

  // 自动跟随：只在换行的那一刻滚一次；用户接管期间完全让位
  useEffect(() => {
    if (interactingRef.current) return;
    if (activeIndex < 0) return;
    scrollToIndex(activeIndex);
  }, [activeIndex, scrollToIndex]);

  // 平滑滚动结束时精确解除「程序化滚动」标记
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScrollEnd = () => {
      autoScrollingRef.current = false;
      if (autoScrollResetTimerRef.current) {
        clearTimeout(autoScrollResetTimerRef.current);
        autoScrollResetTimerRef.current = null;
      }
    };
    container.addEventListener("scrollend", onScrollEnd);
    return () => container.removeEventListener("scrollend", onScrollEnd);
    // 歌词是异步解析的：首次挂载可能走「无歌词」占位分支，滚动容器尚未存在，
    // 解析完成后必须重跑一次才能挂上监听（否则只剩定时器兜底）
  }, [parsedLyrics.length]);

  useEffect(() => {
    return () => {
      clearIdleTimer();
      if (autoScrollResetTimerRef.current) {
        clearTimeout(autoScrollResetTimerRef.current);
      }
      if (manualScrollHideTimerRef.current) {
        clearTimeout(manualScrollHideTimerRef.current);
      }
    };
  }, [clearIdleTimer]);

  /** 切歌复位：清掉接管状态与倒计时，避免新歌沿用上一首的中心行 */
  useEffect(() => {
    clearIdleTimer();
    interactingRef.current = false;
    setInteracting(false);
    setCenteredIndex(-1);
  }, [trackId, clearIdleTimer]);

  /**
   * 所有滚动来源（滚轮 / 触屏 / 滚动条 / 键盘）最终都落到 scroll 事件，
   * 因此统一在这里接管并做 2s 防抖：最后一次滚动后 2s 没有点播放就回弹。
   */
  const handleScroll = useCallback(() => {
    // 自动跟随 / 超时回弹的程序化滚动不算用户操作
    if (autoScrollingRef.current) return;

    if (!interactingRef.current) {
      interactingRef.current = true;
      setInteracting(true);
    }
    const index = findCenteredIndex();
    if (index >= 0) {
      setCenteredIndex((prev) => (prev === index ? prev : index));
    }

    setShowManualScrollbar(true);
    if (manualScrollHideTimerRef.current) {
      clearTimeout(manualScrollHideTimerRef.current);
    }
    manualScrollHideTimerRef.current = setTimeout(() => {
      setShowManualScrollbar(false);
    }, 1200);

    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      interactingRef.current = false;
      setInteracting(false);
      setCenteredIndex(-1);
      // 显式回弹，不依赖 currentTime 变化 —— 暂停 / 停止播放时拖动同样生效
      const target = resolveActiveIndex(parsedLyricsRef.current, currentTimeRef.current);
      if (target >= 0) scrollToIndex(target);
    }, IDLE_TIMEOUT_MS);
  }, [clearIdleTimer, findCenteredIndex, scrollToIndex]);

  /** 点中心行右侧播放按钮：从该行时间开始播放 */
  const handleSeekPlay = useCallback(() => {
    const index =
      centeredIndexRef.current >= 0
        ? centeredIndexRef.current
        : findCenteredIndex();
    const line = parsedLyricsRef.current[index];
    if (!line) return;
    clearIdleTimer();
    interactingRef.current = false;
    setInteracting(false);
    setCenteredIndex(-1);
    scrollToIndex(index);
    onSeekPlay?.(line.time);
  }, [clearIdleTimer, findCenteredIndex, scrollToIndex, onSeekPlay]);

  /** 接管期间拦截点击冒泡：车机模式父层 onClick 会切换合并视图，拖动时不能误触 */
  const handleWrapperClick = useCallback((e: React.MouseEvent) => {
    if (interactingRef.current) e.stopPropagation();
  }, []);

  if (!lyrics || parsedLyrics.length === 0) {
    return (
      <div className={styles.lyricsWrapper} onClick={handleWrapperClick}>
        <div className={styles.noLyrics}>
          <Text type="secondary" style={{ fontSize: "16px" }}>
            {t("player.noLyrics")}
          </Text>
        </div>
      </div>
    );
  }

  const centeredLine = centeredIndex >= 0 ? parsedLyrics[centeredIndex] : null;

  return (
    <div className={styles.lyricsWrapper} onClick={handleWrapperClick}>
      <div
        className={`${styles.lyricsContainer} ${
          !hideScrollbar && showManualScrollbar ? styles.manualScrolling : ""
        }`}
        ref={containerRef}
        onScroll={handleScroll}
      >
        <div className={styles.lyricsContent}>
          {parsedLyrics.map((line, index) => (
            <div
              key={index}
              ref={(el) => {
                lineRefs.current[index] = el;
              }}
              className={`${styles.lyricLine} ${
                index === activeIndex ? styles.activeLyric : ""
              }`}
              style={{
                color:
                  index === activeIndex
                    ? token.colorPrimary
                    : token.colorTextSecondary,
                fontSize:
                  index === activeIndex
                    ? "var(--ad-detail-lyrics-active-font-size, 18px)"
                    : "var(--ad-detail-lyrics-font-size, 16px)",
                fontWeight: index === activeIndex ? "bold" : "normal",
              }}
            >
              {line.text}
            </div>
          ))}
        </div>
      </div>

      {interacting && centeredLine && (
        <div className={styles.lyricsSeekOverlay}>
          <div className={styles.lyricsSeekRow}>
            <div
              className={`${styles.lyricsSeekEdge} ${styles.lyricsSeekEdgeTop}`}
            />
            <div
              className={`${styles.lyricsSeekEdge} ${styles.lyricsSeekEdgeBottom}`}
            />
            <span className={styles.lyricsSeekTime}>
              {formatLyricTime(centeredLine.time)}
            </span>
            <button
              type="button"
              className={styles.lyricsSeekPlay}
              title={t("player.play")}
              onClick={(e) => {
                // 阻止冒泡到 CarMode 的切换视图，也避免被 wrapper 拦截逻辑影响
                e.stopPropagation();
                handleSeekPlay();
              }}
            >
              <PlayCircleFilled />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Lyrics;
