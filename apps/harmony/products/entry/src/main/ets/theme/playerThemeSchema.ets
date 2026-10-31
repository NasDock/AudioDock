/**
 * hm 播放器主题插件（JSON）标准 v1 —— 与 apps/mobile/src/config/playerThemeSchema.ts 完全对齐。
 *
 * 对齐点：
 * - 同一套 meta（schemaVersion=1）+ light/dark 双段 + player 命名空间 + 同一份键表与类型约束；
 * - 部分覆盖：缺省键回退应用默认；unknown 键不报错（保留在 rawJson 里，编辑时回填不丢失）；
 * - meta.platform 接受 "mobile" / "hm" / "harmony"：mobile 的主题 JSON 可直接导入 hm 使用。
 *
 * ArkTS 版差异：键表用 Map（不用 Record 索引签名）；token 用显式 interface 字段，
 * unknown 键不进 token、仅通过 rawJson 保留。
 */

export const SCHEMA_VERSION = 1;

/** 接受的平台标记：mobile（跨端共用）或 hm/harmony（本端专属） */
function isAcceptablePlatform(p: string): boolean {
  return p === 'mobile' || p === 'hm' || p === 'harmony';
}

/** player 命名空间可调键（与 mobile PLAYER_KEYS 一一对应） */
type KeyType = 'color' | 'px' | 'align' | 'coverStyle' | 'tonearm';

const PLAYER_KEYS: Map<string, KeyType> = new Map<string, KeyType>([
  ['background', 'color'],
  ['headerIconColor', 'color'],
  ['titleColor', 'color'],
  ['artistColor', 'color'],
  ['coverRadius', 'px'],
  ['coverStyle', 'coverStyle'],
  ['tonearm', 'tonearm'],
  ['lyricsColor', 'color'],
  ['lyricsActiveColor', 'color'],
  ['lyricsFontSize', 'px'],
  ['lyricsAlign', 'align'],
  ['progressColor', 'color'],
  ['controlColor', 'color'],
]);

export interface PlayerThemeTokens {
  background?: string;
  headerIconColor?: string;
  titleColor?: string;
  artistColor?: string;
  coverRadius?: number;
  coverStyle?: string;
  tonearm?: string;
  lyricsColor?: string;
  lyricsActiveColor?: string;
  lyricsFontSize?: number;
  lyricsAlign?: string;
  progressColor?: string;
  controlColor?: string;
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

export interface PlayerThemePlugin {
  meta: ThemeMeta;
  light?: PlayerThemeTokens;
  dark?: PlayerThemeTokens;
  /** 校验前的原始 JSON 文本：编辑回填 + unknown 键零丢失（对齐 mobile store 的零剥离原则） */
  rawJson: string;
}

export interface ValidationOk {
  ok: true;
  plugin: PlayerThemePlugin;
  warnings: string[];
}

export interface ValidationErr {
  ok: false;
  error: string;
}

export type ValidationResult = ValidationOk | ValidationErr;

// ---------- 校验 ----------

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR = /^rgba?\s*\(/i;
const HSL_COLOR = /^hsla?\s*\(/i;
const NAMED_COLOR =
  /^(transparent|black|white|red|blue|green|yellow|orange|purple|pink|gray|grey|silver|gold|cyan|magenta|brown|lime|navy|teal|maroon|olive|aqua|fuchsia)$/i;

function isColorLike(v: Object): boolean {
  if (typeof v !== 'string') return false;
  const s = (v as string).trim();
  return HEX_COLOR.test(s) || RGB_COLOR.test(s) || HSL_COLOR.test(s) || NAMED_COLOR.test(s);
}

function isPxLike(v: Object): boolean {
  return typeof v === 'number' && Number.isFinite(v as number) && (v as number) >= 0 && (v as number) <= 10000;
}

function isRecord(v: Object | undefined | null): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 把校验通过的键值写进 token（ArkTS 禁接口索引签名，逐键赋值） */
function assignToken(tokens: PlayerThemeTokens, key: string, v: Object): void {
  if (key === 'background') tokens.background = v as string;
  else if (key === 'headerIconColor') tokens.headerIconColor = v as string;
  else if (key === 'titleColor') tokens.titleColor = v as string;
  else if (key === 'artistColor') tokens.artistColor = v as string;
  else if (key === 'coverRadius') tokens.coverRadius = v as number;
  else if (key === 'coverStyle') tokens.coverStyle = v as string;
  else if (key === 'tonearm') tokens.tonearm = v as string;
  else if (key === 'lyricsColor') tokens.lyricsColor = v as string;
  else if (key === 'lyricsActiveColor') tokens.lyricsActiveColor = v as string;
  else if (key === 'lyricsFontSize') tokens.lyricsFontSize = v as number;
  else if (key === 'lyricsAlign') tokens.lyricsAlign = v as string;
  else if (key === 'progressColor') tokens.progressColor = v as string;
  else if (key === 'controlColor') tokens.controlColor = v as string;
}

function validateEnum(keyType: KeyType, v: Object): boolean {
  if (typeof v !== 'string') return false;
  const s = v as string;
  if (keyType === 'align') return s === 'left' || s === 'center' || s === 'right';
  if (keyType === 'coverStyle') return s === 'square' || s === 'vinyl';
  if (keyType === 'tonearm') return s === 'none' || s === 'basic';
  return false;
}

function validateMode(raw: Object | undefined, mode: string, warnings: string[]): PlayerThemeTokens | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    warnings.push(`${mode} 段不是对象，已忽略`);
    return undefined;
  }
  const modeRec = raw as Record<string, Object>;
  const player = modeRec['player'];
  if (player === undefined) return undefined;
  if (!isRecord(player)) {
    warnings.push(`${mode}.player 不是对象，已忽略`);
    return undefined;
  }
  const tokens: PlayerThemeTokens = {};
  const playerRec = player as Record<string, Object>;
  const keys = Object.keys(playerRec);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = playerRec[k];
    if (v === undefined || v === null) continue;
    const spec = PLAYER_KEYS.get(k);
    if (spec === undefined) {
      // 未知键：不进 token，但 rawJson 里保留（升级后自动生效）
      warnings.push(`${mode}.player.${k} 是未知键，已保留在原始 JSON`);
      continue;
    }
    if (spec === 'color' && !isColorLike(v)) {
      warnings.push(`${mode}.player.${k} 不是合法颜色，已忽略`);
      continue;
    }
    if (spec === 'px' && !isPxLike(v)) {
      warnings.push(`${mode}.player.${k} 不是非负数字，已忽略`);
      continue;
    }
    if ((spec === 'align' || spec === 'coverStyle' || spec === 'tonearm') && !validateEnum(spec, v)) {
      warnings.push(`${mode}.player.${k} 取值 ${JSON.stringify(v)} 不在允许范围，已忽略`);
      continue;
    }
    assignToken(tokens, k, v);
  }
  return tokens;
}

export function validatePlayerTheme(jsonText: string): ValidationResult {
  const warnings: string[] = [];

  let parsed: Object;
  try {
    parsed = JSON.parse(jsonText) as Object;
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${(e as Error).message}` };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: '主题文件根必须是对象' };
  }
  const root = parsed as Record<string, Object>;

  const metaRaw = root['meta'];
  if (!isRecord(metaRaw)) {
    return { ok: false, error: '缺少 meta 段或格式错误' };
  }
  const meta = metaRaw as Record<string, Object>;
  const name = meta['name'];
  if (typeof name !== 'string' || (name as string).trim().length === 0) {
    return { ok: false, error: 'meta.name 必填且非空' };
  }
  if (meta['schemaVersion'] !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: `schemaVersion 不匹配：期望 ${SCHEMA_VERSION}，收到 ${JSON.stringify(meta['schemaVersion'])}`,
    };
  }
  const platform = meta['platform'];
  if (typeof platform !== 'string' || !isAcceptablePlatform(platform as string)) {
    return {
      ok: false,
      error: `meta.platform 不匹配：期望 "mobile"/"hm"，收到 ${JSON.stringify(meta['platform'])}`,
    };
  }

  const themeMeta: ThemeMeta = {
    name: (name as string).trim(),
    schemaVersion: SCHEMA_VERSION,
    platform: platform as string,
  };
  if (typeof meta['author'] === 'string') themeMeta.author = meta['author'] as string;
  if (typeof meta['version'] === 'string') themeMeta.version = meta['version'] as string;
  if (typeof meta['description'] === 'string') themeMeta.description = meta['description'] as string;
  if (typeof meta['homepage'] === 'string') themeMeta.homepage = meta['homepage'] as string;

  const plugin: PlayerThemePlugin = { meta: themeMeta, rawJson: jsonText };
  const light = validateMode(root['light'], 'light', warnings);
  const dark = validateMode(root['dark'], 'dark', warnings);
  if (light !== undefined) plugin.light = light;
  if (dark !== undefined) plugin.dark = dark;

  if (plugin.light === undefined && plugin.dark === undefined) {
    warnings.push('light.player 与 dark.player 均为空，主题不会改变任何样式');
  }

  return { ok: true, plugin, warnings };
}
