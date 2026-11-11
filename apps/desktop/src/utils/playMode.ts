import { useEffect, useState } from "react";
import { TrackType } from "../models";

export type PlayMode = TrackType;

const PLAY_MODE_KEY = "playMode";
const EVENT_NAME = "soundx:play-mode-change";

export const getPlayMode = (): PlayMode => {
  if (typeof localStorage === "undefined") return TrackType.MUSIC;
  const stored = localStorage.getItem(PLAY_MODE_KEY);
  if (stored === "audiobook" || stored === "AUDIOBOOK") return TrackType.AUDIOBOOK;
  return TrackType.MUSIC;
};

export const setPlayMode = (mode: PlayMode) => {
  localStorage.setItem(PLAY_MODE_KEY, mode);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: mode }));
};

/**
 * 按数据源校正播放模式。
 *
 * 飞牛音乐（fnOS trim.music）只有音乐：曲目 type 恒为 MUSIC、没有有声书分类。
 * 若本地残留 `playMode=audiobook`（上次在官方源听的），进飞牛后列表会按
 * AUDIOBOOK 过滤成空 —— 所以进入该源时强制切回音乐模式。
 *
 * 传 `sourceType` 表示「刚刚切到这个源」，不传则读当前已选的源（启动时用）。
 */
export const enforceSourcePlayMode = (sourceType?: string | null) => {
  if (typeof localStorage === "undefined") return;
  const type =
    sourceType !== undefined
      ? sourceType
      : localStorage.getItem("selectedSourceType");
  if (type !== "Feiniu") return;
  if (getPlayMode() === TrackType.MUSIC) return;
  setPlayMode(TrackType.MUSIC);
};

export const usePlayMode = () => {  const [mode, setMode] = useState<PlayMode>(getPlayMode());

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === PLAY_MODE_KEY) {
        const newValue = e.newValue;
        if (newValue === "audiobook" || newValue === "AUDIOBOOK") {
          setMode(TrackType.AUDIOBOOK);
        } else {
          setMode(TrackType.MUSIC);
        }
      }
    };

    const handleCustomChange = (e: Event) => {
      const customEvent = e as CustomEvent<PlayMode>;
      setMode(customEvent.detail);
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(EVENT_NAME, handleCustomChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(EVENT_NAME, handleCustomChange);
    };
  }, []);

  return { mode, setMode: setPlayMode };
};

