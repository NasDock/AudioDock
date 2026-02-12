import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

import { createProxyMiddleware } from 'http-proxy-middleware';
import { Logger } from 'nestjs-pino';
import * as path from 'path';
import { ImportService } from './services/import';
import { TrackService } from './services/track';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Enable CORS
  app.enableCors();


  const cacheDir = path.resolve(process.env.CACHE_DIR || './');
  const musicBaseDir = path.resolve(process.env.MUSIC_BASE_DIR || './');
  const audioBookDir = path.resolve(process.env.AUDIO_BOOK_DIR || './');


  // Serve static files from cache directory
  // This allows accessing covers via http://localhost:3000/covers/filename.jpg
  // Default to packages/test/music/cover for development
  console.log(`Serving static files from: ${cacheDir}`);
  app.useStaticAssets(cacheDir, {
    prefix: '/covers/',
  });

  // Serve music files
  console.log(`Serving music files from: ${musicBaseDir}`);
  app.useStaticAssets(musicBaseDir, {
    prefix: '/music/',
  });

  // Serve audiobook files
  console.log(`Serving audiobook files from: ${audioBookDir}`);
  app.useStaticAssets(audioBookDir, {
    prefix: '/audio/',
  });
  
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

  const config = new DocumentBuilder()
    .setTitle('AudioDock API')
    .setDescription('AudioDock API documentation')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);


  // 启动完成后调用 service
  const trackService = app.get(TrackService);
  const count = await trackService.trackCount();

  if (count === 0) {
    console.log('Database is empty, starting initial import...');
    const myService = app.get(ImportService);
    await myService.createTask(musicBaseDir, audioBookDir, cacheDir);
  } else {
    console.log(`Database has ${count} tracks, skipping initial import. Starting watcher...`);
    const myService = app.get(ImportService);
    myService.setupWatcher(musicBaseDir, audioBookDir, cacheDir);
  }

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap()
  .then(() => console.log('success'))
  .catch((err) => console.log(err));
