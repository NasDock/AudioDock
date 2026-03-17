import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

export type PlayMode = "MUSIC" | "AUDIOBOOK";
const CONTENT_MODE_KEY = "contentMode";
const LEGACY_PLAY_MODE_KEY = "playMode";

interface PlayModeContextType {
  mode: PlayMode;
  setMode: (mode: PlayMode) => void;
}

const PlayModeContext = createContext<PlayModeContextType>({
  mode: "MUSIC",
  setMode: () => {},
});

export const usePlayMode = () => useContext(PlayModeContext);

export const PlayModeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [mode, setModeState] = useState<PlayMode>("MUSIC");
  const { sourceType } = useAuth();

  useEffect(() => {
    if (sourceType === "Subsonic") {
      setModeState("MUSIC");
    } else {
      loadMode();
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
    <PlayModeContext.Provider value={{ mode, setMode }}>
      {children}
    </PlayModeContext.Provider>
  );
};
