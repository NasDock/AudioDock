import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../common/public.decorator';
import { ImageOptimizeService, OptimizedImage, OutputFormat } from '../services/image-optimize.service';

/**
 * 缩略图代理：将原图（/covers/ 下的封面、专辑封面、艺术家头像等）按需 resize + 压缩，
 * 落盘到磁盘二次缓存，前端任意页面统一通过 /image/optimize 拉取适合显示尺寸的图片。
 *
 * 安全：
 *  - src 仅允许 /covers/ 或 /music/ 前缀（白名单），避免 SSRF 与 path traversal
 *  - w 上限 1500，q 1-100，避免 RAM DoS
 *
 * 性能：
 *  - 首次按 (src, w, q, fmt) 生成后落盘到 ${CACHE_DIR}/.optimized/<sha256>.<fmt>，
 *  - Cache-Control: public, max-age=31536000, immutable + ETag，浏览器强缓存
 */
@Controller('image')
export class ImageOptimizeController {
  private readonly logger = new Logger(ImageOptimizeController.name);
  constructor(private readonly service: ImageOptimizeService) {}

  @Public()
  @Get('optimize')
  async optimize(
    @Query('src') src: string,
    @Query('w') w: string,
    @Query('q') q: string | undefined,
    @Query('fmt') fmt: string | undefined,
    @Query('blur') blurRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!src || typeof src !== 'string') {
      throw new BadRequestException('src is required');
    }
    if (!w || !/^\d+$/.test(String(w))) {
      throw new BadRequestException('w is required (positive integer)');
    }
    const width = Number(w);
    if (!Number.isFinite(width) || width < 16 || width > 1500) {
      throw new BadRequestException('w must be in [16, 1500]');
    }

    let quality: number | undefined;
    if (q !== undefined) {
      if (!/^\d+$/.test(String(q))) {
        throw new BadRequestException('q must be an integer');
      }
      quality = Number(q);
      if (quality < 1 || quality > 100) {
        throw new BadRequestException('q must be in [1, 100]');
      }
    }

    let format: OutputFormat = 'webp';
    if (fmt !== undefined) {
      if (fmt !== 'webp' && fmt !== 'jpeg') {
        throw new BadRequestException('fmt must be webp or jpeg');
      }
      format = fmt;
    }

    // 高斯模糊 sigma（像素）。供移动端播放页磨砂底图使用：
    // 服务端出图可保证四端观感一致，且绕开 expo-image Android 端
    // `BlurTransformation(min(r,25), 4)` 把 96px 小图糊成纯色块的问题。
    let blur = 0;
    if (blurRaw !== undefined && blurRaw !== '') {
      if (!/^\d+(\.\d+)?$/.test(String(blurRaw))) {
        throw new BadRequestException('blur must be a positive number');
      }
      blur = Number(blurRaw);
      if (!Number.isFinite(blur) || blur <= 0 || blur > 100) {
        throw new BadRequestException('blur must be in (0, 100]');
      }
    }

    let result: OptimizedImage;
    try {
      result = await this.service.optimize(src, width, quality, format, blur);
    } catch (err: any) {
      if (err?.code === 'OUT_OF_ALLOWLIST' || err?.code === 'NOT_FOUND' || err?.code === 'INVALID_SRC') {
        this.logger.warn(`reject image/optimize: src=${src} err=${err.message}`);
        throw new NotFoundException('source image not found');
      }
      this.logger.error(`image/optimize failed: src=${src} err=${(err as Error).stack || err}`);
      throw new BadRequestException('failed to process image');
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', String(result.buffer.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', `"${result.etag}"`);
    res.setHeader('X-Image-Optimize-Cache', result.cacheHit ? 'HIT' : 'MISS');
    res.status(200).end(result.buffer);
  }

  /**
   * 封面主题色提取：GET /image/dominant-color?src=/covers/xxx.jpg → { r, g, b }
   * 供 mobile/hm 播放页背景渐变与进度条着色（desktop 用 canvas 本地提取，
   * 移动端无 canvas，统一走服务端 sharp）。结果磁盘缓存 + 长缓存头。
   */
  @Public()
  @Get('dominant-color')
  async dominantColor(@Query('src') src: string, @Res() res: Response): Promise<void> {
    if (!src || typeof src !== 'string') {
      throw new BadRequestException('src is required');
    }
    try {
      const color = await this.service.dominantColor(src);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.status(200).json(color);
    } catch (err: any) {
      if (err?.code === 'OUT_OF_ALLOWLIST' || err?.code === 'NOT_FOUND' || err?.code === 'INVALID_SRC') {
        this.logger.warn(`reject image/dominant-color: src=${src} err=${err.message}`);
        throw new NotFoundException('source image not found');
      }
      this.logger.error(`image/dominant-color failed: src=${src} err=${(err as Error).stack || err}`);
      throw new BadRequestException('failed to process image');
    }
  }
}
