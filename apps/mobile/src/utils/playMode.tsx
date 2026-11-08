import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

export type PlayMode = "MUSIC" | "AUDIOBOOK";
const CONTENT_MODE_KEY = "contentMode";
const LEGACY_PLAY_MODE_KEY = "playMode";

interface PlayModeContextType {
  mode: PlayMode;
  setMode: (mode: PlayMode) => Promise<void>;
  /** 持久化的 contentMode 是否已从 AsyncStorage 读完（冷启动竞态闸门） */
  modeLoaded: boolean;
}

const PlayModeContext = createContext<PlayModeContextType>({
  mode: "MUSIC",
  setMode: async () => {},
  modeLoaded: false,
});

export const usePlayMode = () => useContext(PlayModeContext);

export const PlayModeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [mode, setModeState] = useState<PlayMode>("MUSIC");
  const [modeLoaded, setModeLoaded] = useState(false);
  const { sourceType } = useAuth();

  useEffect(() => {
    if (sourceType === "Subsonic") {
      setModeState("MUSIC");
      setModeLoaded(true);
    } else {
      // 等持久化的 contentMode 读完再放行，保证 PlayerContext 的初始恢复
      // 直接落在最终模式上，不会先按默认 MUSIC 恢复一轮再切换（双重恢复竞态）。
      loadMode().finally(() => setModeLoaded(true));
    }
  }, [sourceType]);

  const loadMode = async () => {
    try {
      const savedMode =
        (await AsyncStorage.getItem(CONTENT_MODE_KEY)) ??
        (await AsyncStorage.getItem(LEGACY_PLAY_MODE_KEY));
      if (savedMode === "MUSIC" || savedMode === "AUDIOBOOK") {
        setModeState(savedMode);
      }
    } catch (error) {
      console.error("Failed to load play mode:", error);
    }
  };

  const setMode = async (newMode: PlayMode) => {
    setModeState(newMode);
    try {
      await AsyncStorage.setItem(CONTENT_MODE_KEY, newMode);
    } catch (error) {
      console.error("Failed to save play mode:", error);
    }
  };

  return (
    <PlayModeContext.Provider value={{ mode, setMode, modeLoaded }}>
      {children}
    </PlayModeContext.Provider>
  );
};
