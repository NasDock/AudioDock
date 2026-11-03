import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CoverStyle = "square" | "vinyl";
export type LyricsAlign = "left" | "center" | "right";

/**
 * 播放详情页本地皮肤设置 —— 相当于「内置插件」：
 * 与 VIP 主题插件走同一套 --ad-detail-* CSS 变量和应用管线（useUiTheme），
 * 作为底层先写入，用户插件后写覆盖（用户插件优先级更高）。
 * 默认值与 CSS fallback 一致，未改动过时写入无副作用。
 */
interface PlayerSkinState {
  coverStyle: CoverStyle;
  lyricsAlign: LyricsAlign;
  lyricsFontSize: number;
  setCoverStyle: (v: CoverStyle) => void;
  setLyricsAlign: (v: LyricsAlign) => void;
  setLyricsFontSize: (v: number) => void;
}

export const PLAYER_SKIN_DEFAULTS = {
  coverStyle: "square" as CoverStyle,
  lyricsAlign: "center" as LyricsAlign,
  lyricsFontSize: 16,
};

export const usePlayerSkinStore = create<PlayerSkinState>()(
  persist(
    (set) => ({
      ...PLAYER_SKIN_DEFAULTS,
      setCoverStyle: (coverStyle) => set({ coverStyle }),
      setLyricsAlign: (lyricsAlign) => set({ lyricsAlign }),
      setLyricsFontSize: (lyricsFontSize) => set({ lyricsFontSize }),
    }),
    { name: "audiodock-player-skin" },
  ),
);
