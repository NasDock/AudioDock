import { useEffect, useMemo, useState } from "react";
import { plusGetMe } from "@soundx/services";
import {
  COMPONENT_KEYS,
  type ComponentNamespace,
  type ThemeTokens,
  type UiThemePlugin,
} from "../config/uiPluginSchema";
import { useUiThemeStore } from "../store/uiTheme";
import { usePlayerSkinStore } from "../store/playerSkin";
import { useTheme } from "../context/ThemeContext";

/**
 * 读取本地 VIP 状态（同步读 + 异步校正）。
 * - 同步读 `plus_vip_status` 避免首屏应用一次非会员主题再撤掉的闪烁。
 * - 挂载时若 `plus_token` 存在则异步调一次 plusGetMe，确保缓存与服务器一致。
 * - 跨窗口同步靠 storage 事件；同窗口内的覆盖由轻量轮询兜底。
 */
const useLocalVipStatus = (): boolean => {
  const [vip, setVip] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("plus_vip_status") === "true";
  });
  useEffect(() => {
    let cancelled = false;

    const sync = () =>
      setVip(localStorage.getItem("plus_vip_status") === "true");

    const refreshFromServer = async () => {
      const plusToken = localStorage.getItem("plus_token");
      const plusUserId = localStorage.getItem("plus_user_id");
      if (!plusToken || !plusUserId) {
        if (!cancelled) setVip(false);
        return;
      }
      try {
        let id: any = plusUserId;
        try {
          id = JSON.parse(plusUserId);
        } catch {}
        const res = await plusGetMe(id);
        if (cancelled) return;
        const vipTier = res?.data?.data?.vipTier;
        const next = !!vipTier && vipTier !== "NONE";
        setVip(next);
        localStorage.setItem("plus_vip_status", String(next));
        if (res?.data?.data) {
          localStorage.setItem("plus_vip_data", JSON.stringify(res.data.data));
          localStorage.setItem("plus_vip_updated_at", Date.now().toString());
        }
      } catch (err) {
        console.warn("Failed to refresh plus VIP status", err);
      }
    };

    void refreshFromServer();

    const onStorage = (e: StorageEvent) => {
      if (e.key === "plus_vip_status") setVip(e.newValue === "true");
    };
    window.addEventListener("storage", onStorage);
    // 同窗口内调用方覆盖 localStorage 时不会触发 storage 事件，
    // 这里加个轻量轮询兜底（5s 一次够用，开销可忽略）。
    const id = window.setInterval(sync, 5000);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.clearInterval(id);
    };
  }, []);
  return vip;
};

/** 当前激活主题（按 mode 取 light/dark 段） */
const activePluginFor = (
  themes: Record<string, UiThemePlugin>,
  activeId: string | null,
): UiThemePlugin | null => (activeId ? themes[activeId] ?? null : null);

/**
 * 枚举型键的额外派生 CSS 变量 —— 一个 schema 值同时驱动多种 CSS 属性。
 * 例如 lyricsAlign: 'left' 同时要驱动 text-align 和 flex justify-content。
 */
const DERIVED_VARS: Array<{
  ns: ComponentNamespace;
  key: string;
  fromVar: string;
  toVar: string;
  map: Record<string, string>;
}> = [
  {
    ns: "detail",
    key: "lyricsAlign",
    fromVar: "--ad-detail-lyrics-align",
    toVar: "--ad-detail-lyrics-justify",
    map: { left: "flex-start", center: "center", right: "flex-end" },
  },
];

/**
 * 数值型键的额外派生 CSS 变量。函数式映射：取主变量值后计算得到派生变量值。
 * 例如 lyricsColumnRatio=0.6 → cover-flex=0.4, lyrics-flex=0.6；
 *      lyricsFontSize=18 → active-font-size=20（当前行始终大一些，固定 +2px）。
 */
const DERIVED_FN_VARS: Array<{
  ns: ComponentNamespace;
  key: string;
  fromVar: string;
  derived: Array<{ toVar: string; suffix?: string; fn: (n: number) => number }>;
}> = [
  {
    ns: "detail",
    key: "lyricsColumnRatio",
    fromVar: "--ad-detail-lyrics-column-ratio",
    derived: [
      { toVar: "--ad-detail-cover-flex", fn: (n) => +(1 - n).toFixed(4) },
      { toVar: "--ad-detail-lyrics-flex", fn: (n) => +n.toFixed(4) },
    ],
  },
  {
    ns: "detail",
    key: "lyricsFontSize",
    fromVar: "--ad-detail-lyrics-font-size",
    derived: [
      // 当前行始终比常规行大 2px；上限保护避免极小字号失真。
      {
        toVar: "--ad-detail-lyrics-active-font-size",
        fn: (n) => Math.round(n + 2),
      },
    ],
  },
];

/** 把 components 段写到 :root 的 CSS 变量（含派生变量） */
const writeComponentTokens = (components: ThemeTokens["components"]) => {
  const root = document.documentElement;
  if (!components) return;
  for (const [ns, kvs] of Object.entries(components)) {
    const table = (COMPONENT_KEYS as Record<string, Record<string, { cssVar: string; type?: string }>>)[ns];
    if (!table || !kvs) continue;
    for (const [k, v] of Object.entries(kvs)) {
      const spec = table[k];
      if (!spec) continue;
      // px 类变量需要带单位，否则 CSS 当非法值忽略、var() 走 fallback
      const value = `${v}${spec.type === "px" ? "px" : ""}`;
      root.style.setProperty(spec.cssVar, value);
      // 枚举派生
      const derived = DERIVED_VARS.find((d) => d.ns === ns && d.key === k);
      if (derived && typeof v === "string" && derived.map[v]) {
        root.style.setProperty(derived.toVar, derived.map[v]);
      }
      // 函数派生（数值）。fn 的产物如果是纯数字，约定派生变量也是 px 类型，自动加 px。
      const derivedFn = DERIVED_FN_VARS.find((d) => d.ns === ns && d.key === k);
      if (derivedFn && typeof v === "number") {
        for (const f of derivedFn.derived) {
          root.style.setProperty(f.toVar, `${f.fn(v)}px`);
        }
      }
    }
  }
};

/**
 * 把 components 段写到 :root 的 CSS 变量；mode/主题切换时自动重设。
 * base 为内置皮肤设置（相当于内置插件），先写；override 为用户插件 tokens，
 * 后写覆盖 —— 用户插件优先级高于内置皮肤。
 */
const applyComponentCssVars = (
  override: ThemeTokens | undefined,
  base?: ThemeTokens,
) => {
  const root = document.documentElement;
  // 先清除历史，避免主题被卸后残留旧值
  for (const ns of Object.keys(COMPONENT_KEYS) as ComponentNamespace[]) {
    const table = COMPONENT_KEYS[ns];
    for (const spec of Object.values(table)) {
      root.style.removeProperty(spec.cssVar);
    }
  }
  for (const d of DERIVED_VARS) root.style.removeProperty(d.toVar);
  for (const d of DERIVED_FN_VARS) {
    for (const f of d.derived) root.style.removeProperty(f.toVar);
  }

  // 底层：内置皮肤设置；上层：用户插件（覆盖同名键）
  writeComponentTokens(base?.components);
  writeComponentTokens(override?.components);
};

/**
 * 主题应用层。返回当前模式下的合并后 antd ThemeConfig + 副作用（注入 CSS 变量）。
 * 调用方只需把它给的 themeConfig 传给 antd ConfigProvider。
 */
export function useUiTheme() {
  const { mode } = useTheme();
  const themes = useUiThemeStore((s) => s.themes);
  const activeId = useUiThemeStore((s) => s.activeId);
  const isPlusVip = useLocalVipStatus();
  const skinCoverStyle = usePlayerSkinStore((s) => s.coverStyle);
  const skinLyricsAlign = usePlayerSkinStore((s) => s.lyricsAlign);
  const skinLyricsFontSize = usePlayerSkinStore((s) => s.lyricsFontSize);

  const plugin = useMemo(
    () => (isPlusVip ? activePluginFor(themes, activeId) : null),
    [themes, activeId, isPlusVip],
  );

  // 本地皮肤设置 → 与用户插件同构的 tokens（内置插件层，优先级低于用户插件）
  const skinTokens = useMemo<ThemeTokens>(
    () => ({
      components: {
        detail: {
          coverStyle: skinCoverStyle,
          // 黑胶样式带唱针装饰，方形无
          tonearm: skinCoverStyle === "vinyl" ? "basic" : "none",
          lyricsAlign: skinLyricsAlign,
          lyricsFontSize: skinLyricsFontSize,
        },
      },
    }),
    [skinCoverStyle, skinLyricsAlign, skinLyricsFontSize],
  );

  // CSS 变量注入：mode / 主题 / VIP 状态 / 本地皮肤任一变化都重新写
  useEffect(() => {
    const tokens = plugin?.[mode];
    applyComponentCssVars(tokens, skinTokens);
    return () => {
      // 卸载再清一次，防止主题删除时残留
      applyComponentCssVars(undefined);
    };
  }, [mode, plugin, skinTokens]);

  return { mode, plugin };
}