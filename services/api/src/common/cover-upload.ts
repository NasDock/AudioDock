import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export const getManualCoverDir = () => {
  const baseDir = path.resolve(process.env.CACHE_DIR || './');
  const coverDir = path.join(baseDir, 'manual-covers');
  fs.mkdirSync(coverDir, { recursive: true });
  return coverDir;
};

export const toCoverUrl = (filename: string) =>
  `/covers/manual-covers/${filename}`;

export const createCoverUploadOptions = (prefix: string) => ({
  storage: diskStorage({
    destination: (req, file, cb) => {
      cb(null, getManualCoverDir());
    },
    filename: (req, file, cb) => {
      const id = req?.params?.id || 'unknown';
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ALLOWED_EXTS.has(ext) ? ext : '.jpg';
      const filename = `${prefix}-${id}-${Date.now()}-${randomUUID()}${safeExt}`;
      cb(null, filename);
    },
  }),
  fileFilter: (req: any, file: any, cb: any) => {
    if (!file?.mimetype?.startsWith('image/')) {
      return cb(new BadRequestException('Only image uploads are allowed'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});
