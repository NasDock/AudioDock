import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import {
    CloseOutlined,
    ExportOutlined,
    PauseCircleFilled,
    PlayCircleFilled,
    StepBackwardOutlined,
    StepForwardOutlined
} from "@ant-design/icons";
import {
  TrackingEvent as TE,
  TrackingFeature as TF,
} from "@soundx/services";
import { Button, Space } from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent } from "../../services/tracking";
import { useSettingsStore } from "../../store/settings";
import { isTauri } from "../../utils/platform";
import styles from "./index.module.less";

const LyricWindow: React.FC = () => {
  const { t } = useTranslation();
  const [currentLyric, setCurrentLyric] = useState(t('lyricWindow.waitingForPlayback'));
  const [isPlaying, setIsPlaying] = useState(false);
  
  const settings = useSettingsStore((state) => state.desktopLyric);
  const [config, setConfig] = useState(settings);

  const [trackInfo, setTrackInfo] = useState<{ name: string; artist: string } | null>(null);
  const openReportedRef = useRef(false);

  useEffect(() => {
    if (!openReportedRef.current) {
      openReportedRef.current = true;
      trackEvent({ feature: TF.LYRIC, eventName: TE.LYRIC_PAGE_OPEN });
    }

    if (!isTauri()) return;

    let unlistenSettings: (() => void) | undefined;
    let unlistenLyric: (() => void) | undefined;
    let unlistenPlayer: (() => void) | undefined;

    const handleSettingsUpdate = (event: any) => {
      const payload = event.payload;
      setConfig((prev) => ({ ...prev, ...payload }));
    };

    const handleLyricUpdate = (event: any) => {
      const payload = event.payload;
      setCurrentLyric(payload.currentLyric || t('lyricWindow.defaultLyric'));
    };

    const handlePlayerUpdate = (event: any) => {
      const payload = event.payload;
      setIsPlaying(payload.isPlaying);
      if (payload.track) {
         setTrackInfo(payload.track);
      }
    };

    const fetchInitialState = async () => {
      try {
        const state = await invoke<{
          isPlaying: boolean;
          track: { name: string; artist: string } | null;
        }>("get_player_state");
        if (state) {
          setIsPlaying(state.isPlaying);
          if (state.track) {
            setTrackInfo(state.track);
            setCurrentLyric(`${state.track.name} - ${state.track.artist}`);
          }
        }
      } catch (e) {
        console.error("Failed to get player state:", e);
      }
    };

    fetchInitialState();

    listen("lyric:update", handleLyricUpdate).then((fn) => { unlistenLyric = fn; });
    listen("player:update", handlePlayerUpdate).then((fn) => { unlistenPlayer = fn; });
    listen("lyric:settings-update", handleSettingsUpdate).then((fn) => { unlistenSettings = fn; });

    return () => {
      if (unlistenLyric) unlistenLyric();
      if (unlistenPlayer) unlistenPlayer();
      if (unlistenSettings) unlistenSettings();
    };
  }, []);

  const togglePlay = () => {
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

  return (
    <div
      className={styles.container}
      style={{
        "--font-color": config.fontColor,
        "--stroke-color": config.strokeColor,
        "--stroke-width": `${config.strokeWidth}px`
      } as any}
      data-tauri-drag-region
    >
      <div className={styles.header} data-tauri-drag-region>
         <div className={styles.trackInfo}>
            {trackInfo ? `${trackInfo.name} - ${trackInfo.artist}` : t('lyricWindow.appName')}
         </div>
      </div>

      <div className={styles.content} data-tauri-no-drag>
        <div
          className={styles.lyricText}
          style={{
            fontSize: `${config.fontSize}px`,
            fontWeight: config.fontWeight,
            textShadow: config.shadow ? "0 2px 4px rgba(0,0,0,0.5)" : "none"
          }}
        >
          {currentLyric}
        </div>
      </div>

      <div className={styles.controls} data-tauri-no-drag>
        <Space size="large">
          <Button 
            type="text" 
            icon={<CloseOutlined />} 
            onClick={() => useSettingsStore.getState().updateDesktopLyric('enable', false)}
            className={styles.controlBtn}
            title={t('lyricWindow.close')}
          />
          <Button 
            type="text" 
            icon={<StepBackwardOutlined />} 
            onClick={prev} 
            className={styles.controlBtn}
          />
          <Button 
            type="text" 
            icon={isPlaying ? <PauseCircleFilled /> : <PlayCircleFilled />} 
            onClick={togglePlay} 
            className={styles.controlBtn}
            style={{ fontSize: 24 }}
          />
          <Button 
            type="text" 
            icon={<StepForwardOutlined />} 
            onClick={next} 
            className={styles.controlBtn}
          />
          <Button 
            type="text" 
            icon={<ExportOutlined />} 
            onClick={() => {
              if (isTauri()) {
                invoke("show_main_window").catch(console.error);
              }
            }} 
            className={styles.controlBtn}
            title={t('lyricWindow.openPlayer')}
          />
        </Space>
      </div>
    </div>
  );
};

export default LyricWindow;
