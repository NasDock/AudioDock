/**
 * 封面主题色「本地解析」兜底（纯 JS，无原生依赖 → 可走 OTA）。
 *
 * 只在服务端取色不可用时启用（见 utils/dominantColor.ts 的调用点）：
 *  - 老版本服务端没有 /image/dominant-color（404）；
 *  - 外链封面（Emby / Subsonic）不在服务端白名单内，本来取不到色。
 *
 * 为什么不直接对原图取色：
 *  - 原图动辄 1000px+ / 数百 KB，纯 JS 解码在 Hermes 上要 100ms 量级且内存峰值大；
 *  - 取样宽度取 96（= 32 × 3），按 3×3 块平均正好是无损整除的降采样，
 *    结果与 desktop canvas 的 32×32 采样高度一致。
 *
 * 精度实测（60 张真实封面 vs desktop canvas 算法）：
 *  - 96px JPEG：平均 Δ1.68…3.93，最差 Δ83（JPEG 把「大面积浅底 + 小面积彩色」
 *    抹平，阈值过滤后无一像素通过而退化成全图平均 → 直接变白）；
 *  - 96px PNG：平均 Δ1.68，最差 Δ11，仅 1/60 超过 Δ8 —— 因此**必须用 PNG**，
 *    18KB 的体积换掉那个灾难样本，且服务端有磁盘缓存。
 *
 * 采样后的阈值平均算法与 apps/desktop/src/hooks/useCoverDominantColor.ts 逐行同源，
 * 改一处必须同步另一处。
 */
import * as FileSystem from "expo-file-system/legacy";
import * as jpeg from "jpeg-js";
import * as UPNG from "upng-js";
import { getBaseURL } from "../https";
import type { Rgb } from "./dominantColor";

/** 采样网格边长（与 desktop canvas 的 size 一致） */
const GRID = 32;
/** 取样宽度：必须是 GRID 的整数倍，块平均才能整除、不退化为插值 */
const SAMPLE_WIDTH = 96;
/** 外链原图体积上限：超过说明不是缩略图，解码会明显卡主线程 */
const MAX_REMOTE_BYTES = 3 * 1024 * 1024;
/** 整条链路（下载 + 读取 + 解码）超时 */
const TIMEOUT_MS = 10_000;

const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** 极简 base64 解码（不引第 3 个依赖；RN 的 atob 在部分旧版本不可靠） */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  // 每 4 个 base64 字符解出 3 字节；尾部不足 4 个时按 floor(n*3/4) 对齐
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_CHARS.indexOf(clean[i]);
    const c1 = B64_CHARS.indexOf(clean[i + 1]);
    const c2 = B64_CHARS.indexOf(clean[i + 2]);
    const c3 = B64_CHARS.indexOf(clean[i + 3]);
    const n = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
    if (p < out.length) out[p++] = (n >> 16) & 0xff;
    if (p < out.length) out[p++] = (n >> 8) & 0xff;
    if (p < out.length) out[p++] = n & 0xff;
  }
  return out;
}

/** 临时文件名用（避免引入 crypto） */
function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** RGBA → GRID×GRID 的 RGB（按比例分块平均，不要求整除） */
function sampleGrid(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(GRID * GRID * 3);
  for (let gy = 0; gy < GRID; gy++) {
    const y0 = Math.floor((gy * height) / GRID);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / GRID));
    for (let gx = 0; gx < GRID; gx++) {
      const x0 = Math.floor((gx * width) / GRID);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / GRID));
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const rowOffset = y * width;
        for (let x = x0; x < x1; x++) {
          const i = (rowOffset + x) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          count++;
        }
      }
      const o = (gy * GRID + gx) * 3;
      out[o] = Math.round(r / count);
      out[o + 1] = Math.round(g / count);
      out[o + 2] = Math.round(b / count);
    }
  }
  return out;
}

/**
 * 与 desktop useCoverDominantColor 完全同源的取色规则：
 * 跳过死黑 / 死白 / 低饱和灰，让结果贴近「主色调」而非灰扑扑的全局平均；
 * 全被过滤（灰阶封面）时退化为整体平均。
 */
function pickColor(rgb: Uint8Array): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    const pr = rgb[i];
    const pg = rgb[i + 1];
    const pb = rgb[i + 2];
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    if (max < 40 || min > 215) continue; // 跳过死黑/死白
    if (max - min < 20) continue; // 跳过低饱和灰
    r += pr;
    g += pg;
    b += pb;
    n++;
  }
  if (n === 0) {
    for (let i = 0; i < rgb.length; i += 3) {
      r += rgb[i];
      g += rgb[i + 1];
      b += rgb[i + 2];
      n++;
    }
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/** 按魔数解码，只支持 PNG / JPEG（webp 等纯 JS 无解码器，返回 null 由调用方回退） */
function decodeImage(bytes: Uint8Array): {
  data: Uint8Array;
  width: number;
  height: number;
} | null {
  if (bytes.length < 12) return null;
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const img = UPNG.decode(ab);
    const frames = UPNG.toRGBA8(img);
    if (!frames.length) return null;
    return { data: new Uint8Array(frames[0]), width: img.width, height: img.height };
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const decoded = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 64 });
    return { data: decoded.data, width: decoded.width, height: decoded.height };
  }
  return null;
}

/** 把封面解析成「要下载的图片地址」 */
function resolveSourceUrl(cover: string): string | null {
  if (/^https?:\/\//i.test(cover)) {
    // 外链封面（Emby/Subsonic）：服务端白名单不含这些域，只能取原图
    return cover;
  }
  const cleanPath = cover.startsWith("/") ? cover.substring(1) : cover;
  // 只处理服务端 optimize 能取到的 AudioDock 源封面（/music/ 下没有图片，服务端不代理）
  if (!cleanPath.startsWith("covers/")) {
    return null;
  }
  const baseURL = getBaseURL().replace(/\/$/, "");
  const src = encodeURIComponent(`/${cleanPath}`);
  // 服务端 optimize 支持任意老版本；96px 取 PNG 无损，正是本地取色需要的
  return `${baseURL}/image/optimize?src=${src}&w=${SAMPLE_WIDTH}&q=72&fmt=png`;
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 本地解析封面主题色。失败（格式不支持 / 下载失败 / 体积过大）返回 null。
 *
 * 注意：解码在主线程（Hermes 没有 worker），96px 图实测 2~4ms 可忽略；
 * 外链原图已用体积上限兜住，避免个别超大图解码卡顿。
 */
export async function resolveLocalDominantColor(
  cover?: string | null,
): Promise<Rgb | null> {
  if (!cover) return null;
  const url = resolveSourceUrl(cover);
  if (!url) return null;

  const dir = FileSystem.cacheDirectory ?? "";
  const target = `${dir}dominant-${hashKey(url)}.img`;

  try {
    return await withTimeout(
      (async (): Promise<Rgb | null> => {
        await FileSystem.downloadAsync(url, target);
        const info = await FileSystem.getInfoAsync(target);
        if (!info.exists) return null;
        if ((info.size ?? 0) > MAX_REMOTE_BYTES) return null;

        const b64 = await FileSystem.readAsStringAsync(target, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const bytes = base64ToBytes(b64);
        const decoded = decodeImage(bytes);
        if (!decoded) return null;
        return pickColor(sampleGrid(decoded.data, decoded.width, decoded.height));
      })(),
      TIMEOUT_MS,
      null,
    );
  } catch {
    return null;
  } finally {
    // 图片只用来取色，读完即删（内存缓存已在调用方，重复取色不会二次下载）
    void FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
  }
}
