import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
// sharp 0.35+ 是 ESM-first 包，类型用 `export default sharp`（dist/index.d.mts）。
// 在 commonjs 目标下走 default import 会被 TS 编译成 `sharp_1.default(...)`，但
// sharp 的 CJS 导出（dist/index.cjs）是函数本身、没有 `.default` 字段，运行时炸
// `(0 , sharp_1.default) is not a function`。TS 也不接受 namespace import（类型不可调用）。
// 项目 tsconfig 是 module=commonjs + moduleResolution=node，TS 不会按 package.json `exports`
// 的 require.types 路径去加载 dist/index.d.cts（CJS 端 `export = sharp`，可调用）。
// 这里直接 require 拿运行时函数、as any 绕开 TS 导入分析（sharp 的链式 API 仍正常用）。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp') as any;
import { DEFAULT_CACHE_DIR } from '../common/media-paths';

export type OutputFormat = 'webp' | 'jpeg' | 'png';

export interface OptimizedImage {
  buffer: Buffer;
  etag: string;
  contentType: string;
  cacheHit: boolean;
}

export interface DominantColor {
  r: number;
  g: number;
  b: number;
}

export class ImageOptimizeError extends Error {
  code: 'OUT_OF_ALLOWLIST' | 'NOT_FOUND' | 'INVALID_SRC';
  constructor(code: 'OUT_OF_ALLOWLIST' | 'NOT_FOUND' | 'INVALID_SRC', message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * 图片缩放服务（运行时按需生成 + disk cache）。
 *
 * 输入 src 仅允许 /covers/ 或 /music/ 前缀（白名单），避免代理任意远端资源（SSRF）。
 * 第一次请求：sharp() resize + toFormat + toBuffer + 落盘到 ${CACHE_DIR}/.optimized/<sha256>.<fmt>
 * 后续请求：直接从磁盘读，O(1) 返回。
 *
 * ETag = sha256(src|w|q|fmt)，与磁盘文件名一致，命中可直接 304 兼容未来 conditional GET。
 */
@Injectable()
export class ImageOptimizeService {
  private readonly cacheRoot: string;
  private static readonly SHARP_INPUT_LIMIT_PIXELS = 268_402_689; // ≈16384x16384 防 RAM DoS
  private readonly allowlistPrefixes: string[];

  constructor() {
    const cacheDir = path.resolve(process.env.CACHE_DIR || DEFAULT_CACHE_DIR);
    this.cacheRoot = path.join(cacheDir, '.optimized');
    fs.mkdirSync(this.cacheRoot, { recursive: true });
    // 与 main.ts 中 app.useStaticAssets(cacheDir, prefix:'/covers/') 一致：所有封面走 /covers/
    // music 目录下的内嵌封面（例如 import 时直接挂在专辑记录里的相对路径）走 /music/ 前缀
    this.allowlistPrefixes = ['/covers/', '/music/'];
  }

  /**
   * @param blur 可选高斯模糊 sigma（px）。>0 时在缩放到目标尺寸之后再模糊：
   *   先缩小再模糊 = 只对几万像素做卷积，成本可忽略，产物通常 <2KB。
   *   移动端播放页的磨砂底图必须走这里，不能依赖客户端 blurRadius ——
   *   expo-image Android 侧固定 `BlurTransformation(min(r,25), 4)`（先缩小 4 倍再模糊，
   *   等效半径 ×4），小图会被糊成纯色块，且 RenderScript 在部分机型不可用。
   */
  async optimize(
    rawSrc: string,
    width: number,
    quality: number | undefined,
    format: OutputFormat,
    blur = 0,
  ): Promise<OptimizedImage> {
    const src = this.normalizeSrc(rawSrc);
    const normalizedSrc = this.assertAllowlisted(src);
    const effBlur = Number.isFinite(blur) && blur > 0 ? Math.min(blur, 100) : 0;

    // PNG 无损不消费 quality；归一化为 0，避免 q=72/q=80 产出相同图片却占两份缓存
    const effQuality = format === 'png' ? 0 : quality ?? (format === 'webp' ? 75 : 80);
    const cacheKey = this.makeCacheKey(normalizedSrc, width, effQuality, format, effBlur);
    const cachePath = this.cachePathFor(cacheKey, format);

    if (fs.existsSync(cachePath)) {
      const buf = await fs.promises.readFile(cachePath);
      return { buffer: buf, etag: cacheKey, contentType: this.contentTypeFor(format), cacheHit: true };
    }

    const sourcePath = this.resolveLocalSource(normalizedSrc);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new ImageOptimizeError('NOT_FOUND', `source not found: ${normalizedSrc}`);
    }

    let pipeline = sharp(sourcePath, { limitInputPixels: ImageOptimizeService.SHARP_INPUT_LIMIT_PIXELS })
      .resize({ width, withoutEnlargement: true });

    // 必须在 resize 之后 blur：先模糊大图再缩小既慢又会被缩放重新锐化边缘
    if (effBlur > 0) {
      pipeline = pipeline.blur(effBlur);
    }

    if (format === 'webp') {
      pipeline = pipeline.webp({ quality: effQuality });
    } else if (format === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: effQuality, mozjpeg: true });
    } else {
      // mobile 本地取色兜底要求 PNG：JPEG 压缩会把「大面积浅底 + 小面积彩色」
      // 抹平，阈值过滤后退化成全图平均，个别封面 Δ 可到 80+。
      pipeline = pipeline.png({ compressionLevel: 9 });
    }

    const buffer = await pipeline.toBuffer();
    // 落盘用 atomic-ish 写：写到临时文件再 rename，避免并发同一 key 时写到一半
    const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmpPath, buffer);
    await fs.promises.rename(tmpPath, cachePath);

    return { buffer, etag: cacheKey, contentType: this.contentTypeFor(format), cacheHit: false };
  }

  /**
   * 归一化 src：
   *  - 去掉 query / hash
   *  - 解码
   *  - 防 path traversal（解析为绝对路径后校验前缀）
   */
  private normalizeSrc(raw: string): string {
    const noQuery = raw.split('?')[0].split('#')[0];
    let decoded: string;
    try {
      decoded = decodeURIComponent(noQuery);
    } catch {
      throw new ImageOptimizeError('INVALID_SRC', 'src is not a valid URI');
    }
    if (!decoded.startsWith('/')) {
      // 非绝对路径强制前缀
      decoded = `/${decoded.replace(/^\/+/, '')}`;
    }
    return decoded;
  }

  private assertAllowlisted(src: string): string {
    const ok = this.allowlistPrefixes.some((p) => src.startsWith(p));
    if (!ok) {
      throw new ImageOptimizeError(
        'OUT_OF_ALLOWLIST',
        `src must start with one of: ${this.allowlistPrefixes.join(', ')}`,
      );
    }
    // 解析相对部分，校验不越界
    const normalized = path.posix.normalize(src);
    if (normalized.includes('..')) {
      throw new ImageOptimizeError('OUT_OF_ALLOWLIST', 'path traversal detected');
    }
    return normalized;
  }

  /**
   * 把 /covers/foo.jpg 映射到本地磁盘：${CACHE_DIR}/foo.jpg
   * 把 /music/foo.jpg 映射到本地磁盘：${MUSIC_BASE_DIR}/foo.jpg（视部署而定）
   *
   * 当前实现只支持 /covers/（这是静态服务暴露的真实路径）。
   * /music/ 路径在原图可经 nginx 静态服务访问的情况下可后续扩展。
   */
  private resolveLocalSource(src: string): string | null {
    if (src.startsWith('/covers/')) {
      const cacheDir = path.resolve(process.env.CACHE_DIR || DEFAULT_CACHE_DIR);
      const abs = path.join(cacheDir, src.replace(/^\/covers\//, ''));
      return abs;
    }
    return null; // 暂不直接代理 /music/ 下的图片（可用 nginx 直接静态服务），后续按需扩展
  }

  private makeCacheKey(src: string, w: number, q: number, fmt: OutputFormat, blur = 0): string {
    // blur>0 的产物与同尺寸清晰图是两份不同文件，必须进 key，否则模糊图会命中清晰图缓存
    return crypto
      .createHash('sha256')
      .update(`${src}|${w}|${q}|${fmt}|${blur > 0 ? `b${blur}` : 'b0'}`)
      .digest('hex')
      .slice(0, 32);
  }

  private cachePathFor(key: string, fmt: OutputFormat): string {
    const ext = fmt === 'webp' ? 'webp' : fmt === 'jpeg' ? 'jpg' : 'png';
    return path.join(this.cacheRoot, `${key}.${ext}`);
  }

  private contentTypeFor(fmt: OutputFormat): string {
    if (fmt === 'webp') return 'image/webp';
    if (fmt === 'jpeg') return 'image/jpeg';
    return 'image/png';
  }

  /**
   * 封面主题色提取（供各端播放页背景渐变/进度条着色）。
   *
   * 算法与 desktop useCoverDominantColor 完全对齐（canvas 行为逐项复刻）：
   * - toColorspace('srgb')：浏览器解码统一转 sRGB；不转的话 CMYK JPEG 的 raw
   *   输出是 C/M/Y/K 四通道，会被误读为 R/G/B（油墨值高=色深 → 误读为浅色 → 偏淡偏色）
   * - flatten 黑底：canvas 透明区域合成到黑底（随后被 max<40 跳过）；
   *   不合成的话 PNG 透明区的 RGB 是未乘 alpha 的残留值（常为白）→ 稀释偏淡
   * - resize(32,32, fit:'fill') 强制拉伸正方形：对齐 canvas drawImage(img,0,0,32,32)
   *   （保持宽高比会让非正方形封面的采样区域与 desktop 不一致）
   * - 跳过死黑/死白/低饱和像素（让结果贴近"主色调"而非灰扑扑的全局平均）；
   *   全灰阶封面退化为整体平均。
   *
   * 结果落盘缓存（${CACHE_DIR}/.optimized/<sha256>.color.json），后续请求 O(1)。
   * 缓存 key 带算法版本号：算法变更必须 bump（v1 → v2：色彩空间/alpha/缩放修复）。
   */
  async dominantColor(rawSrc: string): Promise<DominantColor> {
    const src = this.normalizeSrc(rawSrc);
    const normalizedSrc = this.assertAllowlisted(src);

    const cacheKey = crypto
      .createHash('sha256')
      .update(`${normalizedSrc}|dominant-color-v2`)
      .digest('hex')
      .slice(0, 32);
    const cachePath = path.join(this.cacheRoot, `${cacheKey}.color.json`);
    if (fs.existsSync(cachePath)) {
      const raw = await fs.promises.readFile(cachePath, 'utf8');
      return JSON.parse(raw) as DominantColor;
    }

    const sourcePath = this.resolveLocalSource(normalizedSrc);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new ImageOptimizeError('NOT_FOUND', `source not found: ${normalizedSrc}`);
    }

    const { data, info } = await sharp(sourcePath, {
      limitInputPixels: ImageOptimizeService.SHARP_INPUT_LIMIT_PIXELS,
    })
      .toColorspace('srgb')
      .flatten({ background: '#000000' })
      // kernel cubic ≈ canvas drawImage 的平滑缩放（sharp 默认 lanczos3 有振铃过冲，
      // 强对比边缘会轻微提亮/压暗导致平均色偏差）
      .resize(32, 32, { fit: 'fill', kernel: 'cubic' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // flatten + toColorspace 后恒为 3 通道 RGB，与 canvas getImageData 的逐像素语义一致
    const channels: number = info.channels;
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let i = 0; i + 2 < data.length; i += channels) {
      const pr = data[i],
        pg = data[i + 1],
        pb = data[i + 2];
      const max = Math.max(pr, pg, pb),
        min = Math.min(pr, pg, pb);
      if (max < 40 || min > 215) continue; // 跳过死黑/死白
      if (max - min < 20) continue; // 跳过低饱和灰
      r += pr;
      g += pg;
      b += pb;
      n++;
    }
    if (n === 0) {
      // 灰阶封面：退化为整体平均色
      for (let i = 0; i + 2 < data.length; i += channels) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
    }
    const color: DominantColor = {
      r: Math.round(r / n),
      g: Math.round(g / n),
      b: Math.round(b / n),
    };

    const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(color));
    await fs.promises.rename(tmpPath, cachePath);
    return color;
  }

  /**
   * 预生成多尺寸缩略图到磁盘缓存。
   * - 设计意图：import / 扫描完成时调用一次，把常用尺寸（列表 300 / 卡片 600 / 全屏封面 900 / 大图 1200）一次性落盘
   *   避免前端首次访问触发 sharp 实时 resize。
   * - 静默失败：单张图或某个尺寸失败不影响其他尺寸继续生成，也不抛错给 import 流程
   *   （import 是后台任务，预生成只是 best-effort 加速）。
   * - 默认使用 webp 格式（质量 75），覆盖常见 web 场景。
   */
  async preGenerate(
    rawSrc: string,
    widths: number[] = [300, 600, 900, 1200],
    format: OutputFormat = 'webp',
    quality: number = 75,
  ): Promise<void> {
    let src: string;
    try {
      src = this.normalizeSrc(rawSrc);
      src = this.assertAllowlisted(src);
    } catch {
      return; // 白名单/格式不合法的 src 静默跳过
    }

    const sourcePath = this.resolveLocalSource(src);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return;
    }

    // 并行生成各尺寸；任一失败不影响其它尺寸
    await Promise.all(
      widths.map(async (w) => {
        try {
          const safeW = Math.min(Math.max(16, w | 0), 1500);
          const effQuality = format === 'png' ? 0 : quality;
          const cacheKey = this.makeCacheKey(src, safeW, effQuality, format);
          const cachePath = this.cachePathFor(cacheKey, format);
          if (fs.existsSync(cachePath)) return; // 已存在则跳过

          const pipeline = sharp(sourcePath, { limitInputPixels: ImageOptimizeService.SHARP_INPUT_LIMIT_PIXELS })
            .resize({ width: safeW, withoutEnlargement: true });

          if (format === 'webp') {
            pipeline.webp({ quality });
          } else if (format === 'jpeg') {
            pipeline.jpeg({ quality, mozjpeg: true });
          } else {
            pipeline.png({ compressionLevel: 9 });
          }
          const buf = await pipeline.toBuffer();

          const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
          await fs.promises.writeFile(tmpPath, buf);
          await fs.promises.rename(tmpPath, cachePath);
        } catch {
          // 静默忽略单尺寸失败
        }
      }),
    );
  }
}
