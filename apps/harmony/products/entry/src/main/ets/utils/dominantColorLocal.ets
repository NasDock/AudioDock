/**
 * 封面主题色「本地解析」（hm）。
 *
 * 与 apps/mobile/src/utils/dominantColorLocal.ts 同源：播放详情页主题色**恒在端侧计算**，
 * 不再请求服务端 GET /image/dominant-color。hm 没有 canvas / 纯 JS 图片解码器，
 * 改用系统 ImageKit 把封面字节解成 RGBA 像素，但**采样与取色规则与 mobile 逐行一致**：
 *  - 下载候选按「精度优先、兼容兜底」排序：
 *    1. AudioDock 源：/image/optimize?w=96&q=72&fmt=png（96 = 32×3，3×3 块平均整除降采样，
 *       与 desktop canvas 300→32 最接近；PNG 无损，实测平均 Δ1.68）；
 *    2. AudioDock 源：原图（兼容没有 fmt=png 的老服务端；限体积/像素数）；
 *    3. AudioDock 源：/image/optimize?w=96&q=90&fmt=jpeg（原图 webp / 过大时的最后兜底）；
 *    4. 外链封面（Emby/Subsonic）：直接取原图；
 *  - 飞牛源（fnOS）封面只认 Cookie/Authorization，优先复用 fnosCover 已落盘的本地缓存，
 *    没缓存才带鉴权下载；
 *  - 解码后 sampleGrid 降到 32×32 网格（分块平均，透明像素按透明黑参与），
 *    pickColor 跳过死黑 / 死白 / 低饱和灰，全被过滤时退化为整体平均。
 *
 * ⚠️ sampleGrid / pickColor / 候选顺序 / 阈值常量改动时，必须同步
 *    apps/mobile/src/utils/dominantColorLocal.ts 与 apps/desktop/src/hooks/useCoverDominantColor.ts。
 *    hm 播放页的背景磨砂用 ArkUI backdropBlur，不需要 mobile 的 blurredCoverUri 产物。
 */
import http from '@ohos.net.http';
import fs from '@ohos.file.fs';
import { image } from '@kit.ImageKit';
import { Logger } from 'audiodock_common';
import {
  httpClient, isFnosSource, isFnosMediaUrl, fetchFnosMediaBytes,
} from 'features_network';
import { resolveFnosCover } from './fnosCover';
import type { Rgb } from './dominantColor';

const TAG = 'DominantColor';

/** 采样网格边长（与 desktop canvas 的 size、mobile 的 GRID 一致） */
const GRID = 32;
/** 首选取样宽度：必须是 GRID 的整数倍，块平均才能整除、不退化为插值 */
const SAMPLE_WIDTH = 96;
/** optimize 小图体积上限 */
const MAX_OPTIMIZED_BYTES = 1024 * 1024;
/** 原图体积上限：超过说明不是缩略图，解码会明显占内存 */
const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024;
/** 解码像素上限（RGBA 约 12MB） */
const MAX_DECODE_PIXELS = 3000000;
/** 单个候选的下载超时（ms），对齐 mobile 的 TIMEOUT_MS */
const TIMEOUT_MS = 10000;

interface DecodedImage {
  /** RGBA_8888，长度 = width * height * 4 */
  data: Uint8Array;
  width: number;
  height: number;
}

interface CoverCandidate {
  /** 远程地址；本地文件候选时为空串 */
  url: string;
  /** file:// 本地封面路径；非空时直接读文件，不再发网络请求 */
  localPath: string;
  /** 飞牛媒体：必须带 Cookie/Authorization 才能取到字节 */
  useFnosAuth: boolean;
  maxBytes: number;
}

function remoteCandidate(url: string, maxBytes: number): CoverCandidate {
  const c: CoverCandidate = {
    url: url,
    localPath: '',
    useFnosAuth: false,
    maxBytes: maxBytes,
  };
  return c;
}

function localCandidate(path: string): CoverCandidate {
  const c: CoverCandidate = {
    url: '',
    localPath: path,
    useFnosAuth: false,
    maxBytes: MAX_ORIGINAL_BYTES,
  };
  return c;
}

function fnosCandidate(url: string): CoverCandidate {
  const c: CoverCandidate = {
    url: url,
    localPath: '',
    useFnosAuth: true,
    maxBytes: MAX_ORIGINAL_BYTES,
  };
  return c;
}

/**
 * RGBA → GRID×GRID 的 RGB（按比例分块平均，不要求整除）。
 * 与 mobile sampleGrid 逐行同源：完全透明像素按透明黑参与平均，
 * 避免 PNG 透明区残留白 RGB 稀释颜色。
 */
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
 * 与 desktop useCoverDominantColor / mobile pickColor 完全同源的取色规则：
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
  const out: Rgb = {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
  };
  return out;
}

/**
 * 用系统 ImageKit 解出 RGBA 像素。
 * 显式指定 RGBA_8888，保证 readPixelsToBuffer 的字节序与 mobile sampleGrid 的
 * 「i=R, i+1=G, i+2=B, i+3=A」一致；解码失败/超大图返回 null 让调用方试下一个候选。
 */
async function decodeImage(bytes: ArrayBuffer): Promise<DecodedImage | null> {
  let source: image.ImageSource | null = null;
  let pm: image.PixelMap | null = null;
  try {
    source = image.createImageSource(bytes);
    const info: image.ImageInfo = await source.getImageInfo();
    const width: number = info.size.width;
    const height: number = info.size.height;
    if (width <= 0 || height <= 0 || width * height > MAX_DECODE_PIXELS) return null;
    const options: image.DecodingOptions = {
      desiredPixelFormat: image.PixelMapFormat.RGBA_8888,
    };
    pm = await source.createPixelMap(options);
    const dst = new ArrayBuffer(width * height * 4);
    await pm.readPixelsToBuffer(dst);
    const decoded: DecodedImage = {
      data: new Uint8Array(dst),
      width: width,
      height: height,
    };
    return decoded;
  } catch (e) {
    Logger.w(TAG, `本地解码封面失败: ${String(e)}`);
    return null;
  } finally {
    if (pm !== null) pm.release();
    if (source !== null) source.release();
  }
}

/** 读 file:// 封面（fnosCover 落盘的本地缓存）；文件缺失/读取失败返回 null */
function readLocalBytes(uri: string): ArrayBuffer | null {
  const path: string = uri.startsWith('file://') ? uri.substring(7) : uri;
  try {
    const fd = fs.openSync(path, fs.OpenMode.READ_ONLY);
    try {
      const stat = fs.statSync(path);
      const buf = new ArrayBuffer(stat.size);
      fs.readSync(fd.fd, buf);
      return buf;
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    Logger.w(TAG, `本地封面读取失败 ${path}: ${String(e)}`);
    return null;
  }
}

/** 下载 / 读取单个候选的字节；任何失败返回 null，由调用方尝试下一个候选 */
async function fetchCandidateBytes(c: CoverCandidate): Promise<ArrayBuffer | null> {
  try {
    if (c.localPath.length > 0) return readLocalBytes(c.localPath);
    if (c.useFnosAuth) return await fetchFnosMediaBytes(c.url);
    const req = http.createHttp();
    try {
      const resp = await req.request(c.url, {
        method: http.RequestMethod.GET,
        expectDataType: http.HttpDataType.ARRAY_BUFFER,
        connectTimeout: TIMEOUT_MS,
        readTimeout: TIMEOUT_MS,
      });
      if (resp.responseCode < 200 || resp.responseCode >= 300) return null;
      return resp.result as ArrayBuffer;
    } finally {
      req.destroy();
    }
  } catch (e) {
    Logger.w(TAG, `封面候选下载失败 ${c.url}: ${String(e)}`);
    return null;
  }
}

/**
 * 把封面解析成按精度排序的下载候选（与 mobile resolveSourceCandidates 同序）。
 * 飞牛源单独分流：NAS 上没有 /image/optimize，且封面必须带鉴权。
 */
async function resolveSourceCandidates(cover: string): Promise<CoverCandidate[]> {
  if (cover.length === 0) return [];
  if (cover.startsWith('file://')) {
    return [localCandidate(cover)];
  }
  if (isFnosSource() && isFnosMediaUrl(cover)) {
    // 播放页/列表已经把这张封面落过盘，直接复用零额外网络请求；失败再带鉴权下载
    try {
      const local: string = await resolveFnosCover(cover);
      return [localCandidate(local), fnosCandidate(cover)];
    } catch (e) {
      return [fnosCandidate(cover)];
    }
  }
  if (cover.startsWith('http://') || cover.startsWith('https://')) {
    // 外链封面（Emby/Subsonic）：服务端白名单不含这些域，只能取原图
    return [remoteCandidate(cover, MAX_ORIGINAL_BYTES)];
  }

  const cleanPath: string = cover.startsWith('/') ? cover.substring(1) : cover;
  // 只处理服务端 optimize 能取到的 AudioDock 源封面（与图片代理白名单一致）
  if (!cleanPath.startsWith('covers/')) return [];

  const base: string = httpClient.getBaseURL().replace(/\/+$/, '');
  if (base.length === 0) return [];
  const src: string = encodeURIComponent(`/${cleanPath}`);
  const optimizeUrl = (format: string, quality: number): string =>
    `${base}/image/optimize?src=${src}&w=${SAMPLE_WIDTH}&q=${quality}&fmt=${format}`;
  const originalUrl: string = `${base}/${cleanPath.split('/').map(encodeURIComponent).join('/')}`;

  const candidates: CoverCandidate[] = [
    // 新版服务端：PNG 无损小图，精度最高
    remoteCandidate(optimizeUrl('png', 72), MAX_OPTIMIZED_BYTES),
    // 老服务端：可能还没有 fmt=png，直接读 JPEG/PNG 原图
    remoteCandidate(originalUrl, MAX_ORIGINAL_BYTES),
    // 原图是 webp / 原图过大时的最后兜底：老服务端也支持 jpeg
    remoteCandidate(optimizeUrl('jpeg', 90), MAX_OPTIMIZED_BYTES),
  ];
  return candidates;
}

/**
 * 本地解析封面主题色。失败（格式不支持 / 下载失败 / 体积过大）返回 null，
 * 调用方回退默认主题色。网络超时由 http 的 connectTimeout/readTimeout 兜住。
 */
export async function resolveLocalDominantColor(
  cover?: string | null,
): Promise<Rgb | null> {
  if (!cover) return null;
  const candidates: CoverCandidate[] = await resolveSourceCandidates(cover);
  for (let i = 0; i < candidates.length; i++) {
    const c: CoverCandidate = candidates[i];
    const bytes: ArrayBuffer | null = await fetchCandidateBytes(c);
    if (bytes === null || bytes.byteLength > c.maxBytes) continue;
    const decoded: DecodedImage | null = await decodeImage(bytes);
    if (decoded === null) continue;
    const color: Rgb = pickColor(sampleGrid(decoded.data, decoded.width, decoded.height));
    Logger.i(TAG, `本地取色成功 candidate=${i} ${decoded.width}x${decoded.height} ` +
      `rgb(${color.r},${color.g},${color.b})`);
    return color;
  }
  Logger.i(TAG, `本地取色无可用候选 cover=${cover}`);
  return null;
}
