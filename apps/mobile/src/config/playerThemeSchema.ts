/**
 * Mobile 播放器主题插件（JSON）标准 v1。
 *
 * 与 desktop 的 uiPluginSchema 的关系：
 * - 机制同源（JSON + schemaVersion + 部分覆盖 + 未知键保留），但键表完全独立。
 * - desktop 的键贴着桌面端布局语义（header/home/detail 双栏等），直接套到 mobile 会对不上，
 *   因此本 schema 只覆盖 mobile 播放详情页（player 一个命名空间）。
 * - 通过 meta.platform === "mobile" 与 desktop 插件互相隔离，两端文件不通用、各自演进。
 *
 * 设计原则（与 desktop v1 保持一致）：
 * 1. 部分覆盖：缺省键回退应用默认，未来扩展只增不改，旧主题永远可用。
 * 2. unknown keys 不剥离、不报错，保留在存储里以便升级后自动生效。
 * 3. 通过 meta.schemaVersion 处理未来可能的破坏性升级。
 */

export const SCHEMA_VERSION = 1;
export const PLATFORM = "mobile";

/** 每键的类型约束。color 用于颜色粗检；px 为非负数字；enum 受 values 列表约束 */
type KeySpec =
  | { type: "color" }
  | { type: "px" }
  | { type: "enum"; values: readonly string[] };

/**
 * player 命名空间可调键（仅作用于播放详情页 app/player.tsx）。
 * 扩展点：以后加新键只在这里登记 + player.tsx 消费。
 */
export const PLAYER_KEYS: Record<string, KeySpec> = {
  /** 整页背景（竖屏/横屏通用） */
  background: { type: "color" },
  /** 顶部收起/更多按钮图标 */
  headerIconColor: { type: "color" },
  /** 曲名 */
  titleColor: { type: "color" },
  /** 歌手/作者 */
  artistColor: { type: "color" },
  /** 封面圆角（px，0=直角，size/2=圆形） */
  coverRadius: { type: "px" },
  /** 普通行歌词 */
  lyricsColor: { type: "color" },
  /** 当前行歌词 */
  lyricsActiveColor: { type: "color" },
  /** 歌词字号（px）；主题激活时生效，用户在「更多」里手动调整则覆盖主题 */
  lyricsFontSize: { type: "px" },
  /** 歌词对齐 */
  lyricsAlign: { type: "enum", values: ["left", "center", "right"] },
  /** 进度条已播段 + 滑块 */
  progressColor: { type: "color" },
  /** 播放控制图标（上一首/下一首/播放模式/列表） */
  controlColor: { type: "color" },
};

/** 校验后的 player token（宽松索引签名，保留未来键） */
export interface PlayerThemeTokens {
  background?: string;
  headerIconColor?: string;
  titleColor?: string;
  artistColor?: string;
  coverRadius?: number;
  lyricsColor?: string;
  lyricsActiveColor?: string;
  lyricsFontSize?: number;
  lyricsAlign?: "left" | "center" | "right";
  progressColor?: string;
  controlColor?: string;
  [k: string]: unknown;
}

export interface ThemeMeta {
  name: string;
  author?: string;
  version?: string;
  schemaVersion: number;
  platform: string;
  description?: string;
  homepage?: string;
}

export interface ModeTokens {
  player?: PlayerThemeTokens & Record<string, unknown>;
  [k: string]: unknown;
}

export interface PlayerThemePlugin {
  meta: ThemeMeta;
  light?: ModeTokens;
  dark?: ModeTokens;
  [k: string]: unknown;
}

export type ValidationResult =
  | { ok: true; plugin: PlayerThemePlugin; warnings: string[] }
  | { ok: false; error: string };

// ---------- 校验 ----------

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR = /^rgba?\s*\(/i;
const HSL_COLOR = /^hsla?\s*\(/i;
const NAMED_COLOR =
  /^(transparent|black|white|red|blue|green|yellow|orange|purple|pink|gray|grey|silver|gold|cyan|magenta|brown|lime|navy|teal|maroon|olive|aqua|fuchsia)$/i;

function isColorLike(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return (
    HEX_COLOR.test(s) || RGB_COLOR.test(s) || HSL_COLOR.test(s) || NAMED_COLOR.test(s)
  );
}

function isPxLike(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10000;
}

export function validatePlayerTheme(json: unknown): ValidationResult {
  const warnings: string[] = [];

  if (!isObject(json)) {
    return { ok: false, error: "主题文件根必须是对象" };
  }

  const { meta, light, dark } = json;
  if (!isObject(meta)) {
    return { ok: false, error: "缺少 meta 段或格式错误" };
  }
  if (typeof meta.name !== "string" || !meta.name.trim()) {
    return { ok: false, error: "meta.name 必填且非空" };
  }
  if (meta.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: `schemaVersion 不匹配：期望 ${SCHEMA_VERSION}，收到 ${meta.schemaVersion}`,
    };
  }
  // 与 desktop 插件隔离：无 platform:"mobile" 标记的插件（含 desktop 主题）一律拒绝
  if (meta.platform !== PLATFORM) {
    return {
      ok: false,
      error: `meta.platform 不匹配：期望 "${PLATFORM}"，收到 ${JSON.stringify(meta.platform)}`,
    };
  }

  const validateMode = (tokens: unknown, mode: "light" | "dark"): ModeTokens | undefined => {
    if (tokens === undefined) return undefined;
    if (!isObject(tokens)) {
      warnings.push(`${mode} 段不是对象，已忽略`);
      return undefined;
    }
    const out: ModeTokens = {};
    for (const [ns, kvs] of Object.entries(tokens)) {
      if (ns !== "player") {
        // 未注册命名空间：保留但不消费（未来扩展页面时自动生效）
        if (isObject(kvs)) {
          warnings.push(`${mode}.${ns} 命名空间未注册，已保留`);
          out[ns] = kvs;
        } else {
          warnings.push(`${mode}.${ns} 不是对象，已忽略`);
        }
        continue;
      }
      if (!isObject(kvs)) {
        warnings.push(`${mode}.player 不是对象，已忽略`);
        continue;
      }
      const entry: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(kvs)) {
        const spec = PLAYER_KEYS[k];
        if (!spec) {
          warnings.push(`${mode}.player.${k} 是未知键，已保留`);
          entry[k] = v;
          continue;
        }
        if (spec.type === "color" && !isColorLike(v)) {
          warnings.push(`${mode}.player.${k} 不是合法颜色，已忽略`);
          continue;
        }
        if (spec.type === "px" && !isPxLike(v)) {
          warnings.push(`${mode}.player.${k} 不是非负数字，已忽略`);
          continue;
        }
        if (spec.type === "enum") {
          if (typeof v !== "string" || !spec.values.includes(v)) {
            warnings.push(
              `${mode}.player.${k} 取值 ${JSON.stringify(v)} 不在允许范围 ${JSON.stringify(spec.values)}，已忽略`,
            );
            continue;
          }
        }
        entry[k] = v;
      }
      out.player = entry as ModeTokens["player"];
    }
    return out;
  };

  const plugin: PlayerThemePlugin = {
    meta: {
      name: meta.name.trim(),
      author: typeof meta.author === "string" ? meta.author : undefined,
      version: typeof meta.version === "string" ? meta.version : undefined,
      schemaVersion: meta.schemaVersion,
      platform: meta.platform,
      description: typeof meta.description === "string" ? meta.description : undefined,
      homepage: typeof meta.homepage === "string" ? meta.homepage : undefined,
    },
    light: validateMode(light, "light"),
    dark: validateMode(dark, "dark"),
  };

  if (!plugin.light?.player && !plugin.dark?.player) {
    warnings.push("light.player 与 dark.player 均为空，主题不会改变任何样式");
  }

  return { ok: true, plugin, warnings };
}
