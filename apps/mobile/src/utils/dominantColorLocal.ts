/**
 * 封面主题色 / 磨砂底图「本地解析」兜底（纯 JS，无原生依赖 → 可走 OTA）。
 *
 * mobile 播放页主题色恒在本地计算（见 utils/dominantColor.ts 的调用点），
 * 不再请求服务端 /image/dominant-color。覆盖两类封面：
 *  - AudioDock 源封面（通过图片代理拿 96px PNG / 原图 / 96px JPEG）；
 *  - 外链封面（Emby / Subsonic，直接下载原图）。
 *
 * 下载候选按「精度优先、兼容兜底」排序：
 *  1. AudioDock 源：/image/optimize?w=96&fmt=png（新版服务端；96=32×3，
 *     3×3 块平均是无损整除降采样，和 desktop canvas 的 32×32 采样最接近）；
 *  2. AudioDock 源：原图（兼容还不支持 fmt=png 的老服务端；限体积/像素数防卡顿）；
 *  3. AudioDock 源：/image/optimize?w=96&fmt=jpeg（最后兜底，兼容原图是 webp
 *     或原图过大的场景；JPEG 压缩会轻微影响取色精度，但优于完全拿不到色）；
 *  4. 外链封面：直接取原图（Emby/Subsonic 通常是 JPEG/PNG）。
 *
 * 精度实测（60 张真实封面 vs desktop canvas 300→32 算法）：
 *  - 96px JPEG：平均 Δ1.68…3.93，最差 Δ83（JPEG 把「大面积浅底 + 小面积彩色」
 *    抹平，阈值过滤后无一像素通过而退化成全图平均 → 直接变白）；
 *  - 96px PNG：平均 Δ1.68，最差 Δ11，仅 1/60 超过 Δ8 —— 所以首选 PNG。
 *
 * 采样后的阈值平均算法与 apps/desktop/src/hooks/useCoverDominantColor.ts 逐行同源，
 * 改一处必须同步另一处。
 */
import * as FileSystem from "expo-file-system/legacy";
import * as jpeg from "jpeg-js";
import * as UPNG from "upng-js";
import { getBaseURL } from "../https";
import type { Rgb } from "./dominantColor";
import { getMediaHeaders } from "./mediaAuth";

/** 采样网格边长（与 desktop canvas 的 size 一致） */
const GRID = 32;
/** 首选取样宽度：必须是 GRID 的整数倍，块平均才能整除、不退化为插值 */
const SAMPLE_WIDTH = 96;
/** 本地生成磨砂底图的最大宽度（再放大由 expo-image contentFit=cover 处理） */
const BLUR_WIDTH = 96;
/** optimize 小图体积上限 */
const MAX_OPTIMIZED_BYTES = 1024 * 1024;
/** 原图体积上限：超过说明不是缩略图，纯 JS 解码会明显卡主线程 */
const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024;
/** 解码像素上限（RGBA 约 12MB，控制 Hermes 内存峰值与主线程解码耗时） */
const MAX_DECODE_PIXELS = 3_000_000;
/** 单个候选的下载 + 读取 + 解码超时 */
const TIMEOUT_MS = 10_000;

const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export interface LocalCoverVisual {
  color: Rgb;
  /** data:image/png;base64,...；供服务端不支持 blur 参数或外链封面时使用 */
  blurredCoverUri?: string;
}

interface DecodedImage {
  data: Uint8Array;
  width: number;
  height: number;
}

interface SourceCandidate {
  url: string;
  maxBytes: number;
}

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

/** base64 编码（同样不依赖 btoa；用于本地生成的磨砂 PNG data URI） */
function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64_CHARS[(n >> 18) & 63] +
      B64_CHARS[(n >> 12) & 63] +
      B64_CHARS[(n >> 6) & 63] +
      B64_CHARS[n & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i] << 16;
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + "==";
  } else if (remaining === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      B64_CHARS[(n >> 18) & 63] +
      B64_CHARS[(n >> 12) & 63] +
      B64_CHARS[(n >> 6) & 63] +
      "=";
  }
  return out;
}

/** 临时文件名用（双 hash + 长度，避免不同封面 32-bit 碰撞后并发写同一文件） */
function hashKey(s: string): string {
  let djb2 = 5381;
  let fnv = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    djb2 = ((djb2 << 5) + djb2 + code) | 0;
    fnv = Math.imul(fnv ^ code, 0x01000193);
  }
  return `${(djb2 >>> 0).toString(36)}-${(fnv >>> 0).toString(36)}-${s.length.toString(36)}`;
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
          // 对齐 canvas：完全透明像素按透明黑参与平均，避免 PNG 透明区残留白 RGB 稀释颜色
          const isTransparent = rgba[i + 3] === 0;
          r += isTransparent ? 0 : rgba[i];
          g += isTransparent ? 0 : rgba[i + 1];
          b += isTransparent ? 0 : rgba[i + 2];
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

/** 按魔数解码，只支持 PNG / JPEG（webp 等纯 JS 无解码器，交给下一个候选） */
function decodeImage(bytes: Uint8Array): DecodedImage | null {
  if (bytes.length < 24) return null;
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    // UPNG 没有像素数限制参数；先读 IHDR 尺寸，避免超大 PNG 撑爆内存
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (width * height > MAX_DECODE_PIXELS) return null;
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
    const decoded = jpeg.decode(bytes, {
      useTArray: true,
      maxResolutionInMP: MAX_DECODE_PIXELS / 1_000_000,
      maxMemoryUsageInMB: 48,
    });
    return { data: decoded.data, width: decoded.width, height: decoded.height };
  }
  return null;
}

/** 把封面解析成按精度排序的下载候选 */
function resolveSourceCandidates(cover: string): SourceCandidate[] {
  if (/^https?:\/\//i.test(cover)) {
    // 外链封面（Emby/Subsonic/飞牛）：服务端白名单不含这些域，只能取原图。
    // 飞牛的封面必须带鉴权头才能下（见 resolveCandidate 里的 getMediaHeaders）。
    return [{ url: cover, maxBytes: MAX_ORIGINAL_BYTES }];
  }
  const cleanPath = cover.startsWith("/") ? cover.substring(1) : cover;
  // 只处理服务端 optimize 能取到的 AudioDock 源封面（/music/ 下没有图片，服务端不代理）
  if (!cleanPath.startsWith("covers/")) {
    return [];
  }
  const baseURL = getBaseURL().replace(/\/$/, "");
  const src = encodeURIComponent(`/${cleanPath}`);
  const optimizeUrl = (format: "png" | "jpeg", quality: number) =>
    `${baseURL}/image/optimize?src=${src}&w=${SAMPLE_WIDTH}&q=${quality}&fmt=${format}`;
  const originalUrl = `${baseURL}/${cleanPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  return [
    // 新版服务端：PNG 无损小图，精度最高（q 对 PNG 无意义，仅为保持 URL 形态一致）
    { url: optimizeUrl("png", 72), maxBytes: MAX_OPTIMIZED_BYTES },
    // 老服务端：可能还没有 fmt=png，直接读 JPEG/PNG 原图
    { url: originalUrl, maxBytes: MAX_ORIGINAL_BYTES },
    // 原图是 webp / 原图过大时的最后兜底：老服务端也支持 jpeg
    { url: optimizeUrl("jpeg", 90), maxBytes: MAX_OPTIMIZED_BYTES },
  ];
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

/** RGBA 降采样到磨砂底图尺寸（保持宽高比，供背景 cover 裁切） */
function resizeRgbaForBlur(
  rgba: Uint8Array,
  width: number,
  height: number,
): DecodedImage {
  const targetWidth = Math.min(BLUR_WIDTH, width);
  const targetHeight = Math.max(1, Math.round((height * targetWidth) / width));
  if (targetWidth === width && targetHeight === height) {
    return { data: rgba, width, height };
  }

  const out = new Uint8Array(targetWidth * targetHeight * 4);
  for (let ty = 0; ty < targetHeight; ty++) {
    const y0 = Math.floor((ty * height) / targetHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / targetHeight));
    for (let tx = 0; tx < targetWidth; tx++) {
      const x0 = Math.floor((tx * width) / targetWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / targetWidth));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const rowOffset = y * width;
        for (let x = x0; x < x1; x++) {
          const i = (rowOffset + x) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          a += rgba[i + 3];
          count++;
        }
      }
      const o = (ty * targetWidth + tx) * 4;
      out[o] = Math.round(r / count);
      out[o + 1] = Math.round(g / count);
      out[o + 2] = Math.round(b / count);
      out[o + 3] = Math.round(a / count);
    }
  }
  return { data: out, width: targetWidth, height: targetHeight };
}

/** 透明像素先合成到黑底（对齐 desktop 模糊层随后还要叠黑色压暗层） */
function rgbaToOpaqueRgb(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
    const alpha = rgba[i + 3] / 255;
    out[o] = Math.round(rgba[i] * alpha);
    out[o + 1] = Math.round(rgba[i + 1] * alpha);
    out[o + 2] = Math.round(rgba[i + 2] * alpha);
  }
  return out;
}

/** 可分离 box blur；96px 图上 3 次近似高斯，成本可忽略 */
function boxBlurRgbOnce(
  input: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const horizontal = new Uint8Array(input.length);
  const output = new Uint8Array(input.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sx = x0; sx <= x1; sx++) {
        const i = (y * width + sx) * 3;
        r += input[i];
        g += input[i + 1];
        b += input[i + 2];
      }
      const count = x1 - x0 + 1;
      const o = (y * width + x) * 3;
      horizontal[o] = Math.round(r / count);
      horizontal[o + 1] = Math.round(g / count);
      horizontal[o + 2] = Math.round(b / count);
    }
  }

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = y0; sy <= y1; sy++) {
        const i = (sy * width + x) * 3;
        r += horizontal[i];
        g += horizontal[i + 1];
        b += horizontal[i + 2];
      }
      const count = y1 - y0 + 1;
      const o = (y * width + x) * 3;
      output[o] = Math.round(r / count);
      output[o + 1] = Math.round(g / count);
      output[o + 2] = Math.round(b / count);
    }
  }
  return output;
}

/** 生成本地磨砂底图：96px 降采样 + 近似高斯模糊 + PNG data URI */
function buildBlurredCoverUri(image: DecodedImage): string | undefined {
  try {
    const resized = resizeRgbaForBlur(image.data, image.width, image.height);
    let rgb = rgbaToOpaqueRgb(resized.data);
    // 服务端 192px/sigma12 的一半尺度 → 96px 下 radius≈5，三次 box blur 近似高斯
    for (let i = 0; i < 3; i++) {
      rgb = boxBlurRgbOnce(rgb, resized.width, resized.height, 5);
    }

    const rgba = new Uint8Array(resized.width * resized.height * 4);
    for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
      rgba[o] = rgb[i];
      rgba[o + 1] = rgb[i + 1];
      rgba[o + 2] = rgb[i + 2];
      rgba[o + 3] = 255;
    }
    const png = UPNG.encode([rgba.buffer], resized.width, resized.height, 0);
    return `data:image/png;base64,${bytesToBase64(new Uint8Array(png))}`;
  } catch {
    // 磨砂图只是增强项：编码失败不能影响主题色主链路
    return undefined;
  }
}

function buildCoverVisual(image: DecodedImage): LocalCoverVisual {
  return {
    color: pickColor(sampleGrid(image.data, image.width, image.height)),
    blurredCoverUri: buildBlurredCoverUri(image),
  };
}

/** 下载并解析单个候选。任何失败都返回 null，由调用方尝试下一个候选。 */
async function resolveCandidate(
  candidate: SourceCandidate,
  target: string,
): Promise<LocalCoverVisual | null> {
  try {
    // 必须带鉴权头：飞牛的 `/static/cover` 只认 `Authorization`（中继还要
    // `Cookie: mode=relay`），裸下载必然 401 → 主题色/磨砂图整条链路失效。
    // 其它数据源 `getMediaHeaders()` 返回空对象，不受影响。
    const headers = getMediaHeaders();
    const download = await FileSystem.downloadAsync(candidate.url, target, {
      headers,
    });
    if (download.status < 200 || download.status >= 300) return null;

    // 中继缺 `Cookie: mode=relay` 时网关会 302 到 FN Connect 登录页，
    // 跟随后拿到的是一段 HTML（200）—— 按 content-type 提前判掉，
    // 免得把登录页当图片解码（还白占一次 IO）。
    const contentType = String(
      download.headers?.["content-type"] || download.headers?.["Content-Type"] || "",
    ).toLowerCase();
    if (contentType && !contentType.startsWith("image/")) return null;

    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists) return null;
    if ((info.size ?? 0) > candidate.maxBytes) return null;

    const b64 = await FileSystem.readAsStringAsync(target, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const decoded = decodeImage(base64ToBytes(b64));
    return decoded ? buildCoverVisual(decoded) : null;
  } catch {
    return null;
  } finally {
    void FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
  }
}

/**
 * 本地解析封面主题色和磨砂底图。失败（格式不支持 / 下载失败 / 体积过大）返回 null。
 *
 * 注意：解码在主线程（Hermes 没有 worker），首选 96px 图实测 2~4ms 可忽略；
 * 原图候选已用体积 + 像素上限兜住，避免个别超大图解码卡顿。
 */
export async function resolveLocalCoverVisual(
  cover?: string | null,
): Promise<LocalCoverVisual | null> {
  if (!cover) return null;
  const candidates = resolveSourceCandidates(cover);
  if (!candidates.length) return null;

  const dir = FileSystem.cacheDirectory ?? "";
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const target = `${dir}dominant-${hashKey(candidate.url)}-${i}.img`;
    const result = await withTimeout(
      resolveCandidate(candidate, target),
      TIMEOUT_MS,
      null,
    );
    if (result) return result;
  }
  return null;
}

/** 兼容旧调用方：只需要主题色时使用 */
export async function resolveLocalDominantColor(
  cover?: string | null,
): Promise<Rgb | null> {
  const visual = await resolveLocalCoverVisual(cover);
  return visual?.color ?? null;
}
