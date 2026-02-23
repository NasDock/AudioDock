import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { LoggerModule } from 'nestjs-pino';
import { AuthController } from './auth/auth.controller';
import { AuthModule } from './auth/auth.module';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import jwtConfig from './config/jwt.config';
import { AdminController } from './controllers/admin.controller';
import { AlbumController } from './controllers/album';
import { ArtistController } from './controllers/artist';
import { AudiobookController } from './controllers/audiobook';
import { FolderController } from './controllers/folder';
import { ImportController } from './controllers/import';
import { LlmController } from './controllers/llm.controller';
import { PlaylistController } from './controllers/playlist';
import { SearchRecordController } from './controllers/search-record';
import { TrackController } from './controllers/track';
import { UserController } from './controllers/user';
import { UserAlbumHistoryController } from './controllers/user-album-history';
import { UserAlbumLikeController } from './controllers/user-album-like';
import { UserAudiobookHistoryController } from './controllers/user-audiobook-history';
import { UserAudiobookLikeController } from './controllers/user-audiobook-like';
import { UserTrackHistoryController } from './controllers/user-track-history';
import { UserTrackLikeController } from './controllers/user-track-like';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { SyncGateway } from './gateways/sync.gateway';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { AlbumService } from './services/album';
import { ArtistService } from './services/artist';
import { AudiobookService } from './services/audiobook';
import { FolderService } from './services/folder';
import { ImportService } from './services/import';
import { LlmService } from './services/llm.service';
import { PlaylistService } from './services/playlist';
import { SearchRecordService } from './services/search-record';
import { TrackService } from './services/track';
import { UserService } from './services/user';
import { UserAlbumHistoryService } from './services/user-album-history';
import { UserAlbumLikeService } from './services/user-album-like';
import { UserAudiobookHistoryService } from './services/user-audiobook-history';
import { UserAudiobookLikeService } from './services/user-audiobook-like';
import { UserTrackHistoryService } from './services/user-track-history';
import { UserTrackLikeService } from './services/user-track-like';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [jwtConfig],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
              target: require.resolve('pino-pretty'),
              options: { singleLine: true },
            }
            : undefined,
      },
    }),
    AuthModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: { expiresIn: '100y' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    UserController,
    AdminController,
    AuthController,
    AlbumController,
    ArtistController,
    TrackController,
    UserAlbumHistoryController,
    UserAlbumLikeController,
    UserAudiobookHistoryController,
    UserAudiobookLikeController,
    UserTrackHistoryController,
    UserTrackLikeController,
    AudiobookController,
    ImportController,
    PlaylistController,
    FolderController,
    SearchRecordController,
    LlmController,
  ],
  providers: [
    UserService,
    AuthService,
    AlbumService,
    ArtistService,
    TrackService,
    UserAlbumHistoryService,
    UserAlbumLikeService,
    UserAudiobookHistoryService,
    UserAudiobookLikeService,
    UserTrackHistoryService,
    UserTrackLikeService,
    ImportService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    AudiobookService,
    PlaylistService,
    FolderService,
    SearchRecordService,
    LlmService,
    SyncGateway,
  ],
})
export class AppModule { }
