import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

import { createProxyMiddleware } from 'http-proxy-middleware';
import { Logger } from 'nestjs-pino';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_AUDIOBOOK_DIR,
  DEFAULT_CACHE_DIR,
  DEFAULT_MUSIC_DIR,
  DEFAULT_MV_DIR,
} from './common/media-paths';
import { resolvePathList } from './common/path-list';
import { DatabaseSchemaService } from './services/database-schema.service';
import { ImportService } from './services/import';
import { TrackService } from './services/track';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Enable CORS
  app.enableCors();


  const musicDirs = resolvePathList(process.env.MUSIC_BASE_DIR, DEFAULT_MUSIC_DIR);
  const audiobookDirs = resolvePathList(process.env.AUDIO_BOOK_DIR, DEFAULT_AUDIOBOOK_DIR);
  const mvDirs = resolvePathList(process.env.MV_BASE_DIR, DEFAULT_MV_DIR);

  const cacheDir = path.resolve(process.env.CACHE_DIR || DEFAULT_CACHE_DIR);
  const transcodedAudioDir = path.join(cacheDir, 'transcoded-audio');
  const transcodedMvDir = path.join(cacheDir, 'transcoded-mv');

  fs.mkdirSync(transcodedAudioDir, { recursive: true });
  fs.mkdirSync(transcodedMvDir, { recursive: true });


  // Serve static files from cache directory
  // This allows accessing covers via http://localhost:3000/covers/filename.jpg
  // Default to packages/test/music/cover for development
  console.log(`Serving static files from: ${cacheDir}`);
  app.useStaticAssets(cacheDir, {
    prefix: '/covers/',
    setHeaders: (res, filePath) => {
      res.set('Accept-Ranges', 'bytes');
      if (filePath.endsWith('.mp3')) res.set('Content-Type', 'audio/mpeg');
    },
  });

  console.log(`Serving transcoded MV files from: ${transcodedMvDir}`);
  app.useStaticAssets(transcodedMvDir, {
    prefix: '/music/',
    setHeaders: (res, path) => {
      res.set('Accept-Ranges', 'bytes');
      if (path.endsWith('.mp4')) res.set('Content-Type', 'video/mp4');
    }
  });

  // Serve audiobook files directly (supports Range for seek).
  // Audiobook playback on mobile resolves track.path (/audio/...) to a bare URL
  // instead of the /track/stream/:id endpoint, so a static mount is required.
  // Multiple audiobook dirs are mounted in order; Express falls through on miss.
  for (const dir of audiobookDirs) {
    console.log(`Serving audiobook files from: ${dir}`);
    app.useStaticAssets(dir, {
      prefix: '/audio/',
      setHeaders: (res, filePath) => {
        res.set('Accept-Ranges', 'bytes');
        const ext = filePath.toLowerCase();
        if (ext.endsWith('.mp3')) res.set('Content-Type', 'audio/mpeg');
        else if (ext.endsWith('.flac')) res.set('Content-Type', 'audio/flac');
        else if (ext.endsWith('.wav')) res.set('Content-Type', 'audio/wav');
        else if (ext.endsWith('.m4a')) res.set('Content-Type', 'audio/mp4');
        else if (ext.endsWith('.aac')) res.set('Content-Type', 'audio/aac');
        else if (ext.endsWith('.ogg')) res.set('Content-Type', 'audio/ogg');
      },
    });
  }

  // TTS Service Proxy
  const ttsServiceUrl = process.env.TTS_SERVICE_URL || 'http://localhost:8000';
  console.log(`Proxying /tts requests to: ${ttsServiceUrl}`);
  app.use(
    ['/tts', '/api/tts'],
    createProxyMiddleware({
      target: ttsServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/tts': '', // Remove /api/tts prefix
        '^/tts': '',     // Remove /tts prefix
      },
    }),
  );

  // ASR Service Proxy
  const asrServiceUrl = process.env.ASR_SERVICE_URL || 'http://localhost:3300';
  console.log(`Proxying /asr requests to: ${asrServiceUrl}`);
  app.use(
    ['/asr', '/api/asr'],
    createProxyMiddleware({
      target: asrServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/asr': '', // Remove /api/asr prefix
        '^/asr': '',     // Remove /asr prefix
      },
    }),
  );

  // Mi Service Proxy (XiaoAi Speaker)
  const miServiceUrl = process.env.MI_SERVICE_URL || 'http://localhost:8080';
  console.log(`Proxying /mi requests to: ${miServiceUrl}`);
  app.use(
    ['/mi', '/api/mi'],
    createProxyMiddleware({
      target: miServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/mi': '', // Remove /api/mi prefix
        '^/mi': '',     // Remove /mi prefix
      },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('AudioDock API')
    .setDescription('AudioDock API documentation')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);


  // 启动完成后调用 service
  const databaseSchemaService = app.get(DatabaseSchemaService);
  await databaseSchemaService.ensureTrackSortColumns();

  const trackService = app.get(TrackService);
  const count = await trackService.trackCount();

  if (count === 0) {
    console.log('Database is empty, starting initial import...');
    const myService = app.get(ImportService);
    await myService.createTask(musicDirs, audiobookDirs, mvDirs, cacheDir);
  } else {
    console.log(`Database has ${count} tracks, skipping initial import. Starting watcher...`);
    const myService = app.get(ImportService);
    myService.setupWatcher(musicDirs, audiobookDirs, mvDirs, cacheDir);
  }

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap()
  .then(() => console.log('success'))
  .catch((err) => console.log(err));
