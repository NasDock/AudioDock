import { Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import React, { useEffect, useRef, useState } from "react";
import styles from "./index.module.less";

const { Text } = Typography;

interface LyricsProps {
  lyrics: string | null;
  currentTime: number;
  /** 完全隐藏滚动条（保留滚动能力）。车机模式使用：自动滚动与手动滚动条交替出现会导致滚动条抽搐 */
  hideScrollbar?: boolean;
}

interface LyricLine {
  time: number;
  text: string;
}

const Lyrics: React.FC<LyricsProps> = ({ lyrics, currentTime, hideScrollbar }) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [parsedLyrics, setParsedLyrics] = useState<LyricLine[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showManualScrollbar, setShowManualScrollbar] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const autoScrollingRef = useRef(false);
  const autoScrollResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const manualScrollHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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

    // Sort by time
    parsed.sort((a, b) => a.time - b.time);

    setParsedLyrics(parsed);
  }, [lyrics]);

  // Find active line
  useEffect(() => {
    if (parsedLyrics.length === 0) {
      setActiveIndex(-1);
      return;
    }

    let index = parsedLyrics.findIndex((line) => line.time > currentTime) - 1;
    if (index === -2) {
      // currentTime is smaller than first line time
      index = -1;
    } else if (index === -1) {
      // currentTime is larger than last line time
      index = parsedLyrics.length - 1;
    }

    setActiveIndex(index);
  }, [currentTime, parsedLyrics]);

  // Auto scroll
  useEffect(() => {
    if (
      activeIndex >= 0 &&
      lineRefs.current[activeIndex] &&
      containerRef.current
    ) {
      const container = containerRef.current;
      const line = lineRefs.current[activeIndex];

      if (line) {
        // Removed IPC sync from here to support global sync in Player component
        // 用 getBoundingClientRect 换算行在滚动内容中的位置：
        // 容器自身没有 position，offsetTop 会锚到更上层的 .fullPlayerContent，
        // 导致 active 行偏上、垂直不居中
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
          top: offset,
          behavior: "smooth",
        });
        autoScrollResetTimerRef.current = setTimeout(() => {
          autoScrollingRef.current = false;
        }, 500);
      }
    }
  }, [activeIndex]);

  useEffect(() => {
    return () => {
      if (autoScrollResetTimerRef.current) {
        clearTimeout(autoScrollResetTimerRef.current);
      }
      if (manualScrollHideTimerRef.current) {
        clearTimeout(manualScrollHideTimerRef.current);
      }
    };
  }, []);

  const handleScroll = () => {
    if (autoScrollingRef.current) {
      return;
    }

    setShowManualScrollbar(true);
    if (manualScrollHideTimerRef.current) {
      clearTimeout(manualScrollHideTimerRef.current);
    }
    manualScrollHideTimerRef.current = setTimeout(() => {
      setShowManualScrollbar(false);
    }, 1200);
  };

  if (!lyrics || parsedLyrics.length === 0) {
    return (
      <div className={styles.noLyrics}>
        <Text type="secondary" style={{ fontSize: "16px" }}>
          {t("player.noLyrics")}
        </Text>
      </div>
    );
  }

  return (
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
  );
};

export default Lyrics;
