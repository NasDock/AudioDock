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
import { AccessTokenController } from './controllers/access-token.controller';
import { AdminController } from './controllers/admin.controller';
import { AlbumController } from './controllers/album';
import { ArtistController } from './controllers/artist';
import { AudiobookController } from './controllers/audiobook';
import { AudiobookCollectionController } from './controllers/audiobook-collection';
import { FolderController } from './controllers/folder';
import { ImportController } from './controllers/import';
import { LlmConfigController } from './controllers/llm-config.controller';
import { LlmController } from './controllers/llm.controller';
import { MvController } from './controllers/mv';
import { PlaylistController } from './controllers/playlist';
import { SearchRecordController } from './controllers/search-record';
import { ScanLoginController } from './controllers/scan-login.controller';
import { TrackController } from './controllers/track';
import { ImageOptimizeController } from './controllers/image-optimize.controller';
import { UserController } from './controllers/user';
import { UserAlbumHistoryController } from './controllers/user-album-history';
import { UserAlbumLikeController } from './controllers/user-album-like';
import { UserAudiobookHistoryController } from './controllers/user-audiobook-history';
import { UserAudiobookLikeController } from './controllers/user-audiobook-like';
import { UserTrackHistoryController } from './controllers/user-track-history';
import { UserTrackLikeController } from './controllers/user-track-like';
import { WebDavSourcesController } from './controllers/webdav-sources.controller';
import { MetadataPluginsController } from './controllers/metadata-plugins.controller';
import { WebDavSyncController } from './controllers/webdav-sync.controller';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { SyncGateway } from './gateways/sync.gateway';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { AccessTokenService } from './services/access-token.service';
import { AlbumService } from './services/album';
import { ArtistService } from './services/artist';
import { AudiobookService } from './services/audiobook';
import { AudiobookCollectionService } from './services/audiobook-collection';
import { FolderService } from './services/folder';
import { ImportService } from './services/import';
import { LlmConfigService } from './services/llm-config.service';
import { LlmService } from './services/llm.service';
import { MvService } from './services/mv';
import { PlaylistService } from './services/playlist';
import { SearchRecordService } from './services/search-record';
import { ScanLoginService } from './services/scan-login.service';
import { TrackService } from './services/track';
import { UserService } from './services/user';
import { UserAlbumHistoryService } from './services/user-album-history';
import { UserAlbumLikeService } from './services/user-album-like';
import { UserAudiobookHistoryService } from './services/user-audiobook-history';
import { UserAudiobookLikeService } from './services/user-audiobook-like';
import { DatabaseSchemaService } from './services/database-schema.service';
import { UserTrackHistoryService } from './services/user-track-history';
import { UserTrackLikeService } from './services/user-track-like';
import { WebDavConfigService } from './services/webdav-config.service';
import { MetadataPluginService } from './services/metadata-plugin.service';
import { ImageOptimizeService } from './services/image-optimize.service';

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
    AccessTokenController,
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
    AudiobookCollectionController,
    ImportController,
    PlaylistController,
    FolderController,
    SearchRecordController,
    ScanLoginController,
    LlmController,
    LlmConfigController,
    MvController,
    WebDavSourcesController,
    MetadataPluginsController,
    WebDavSyncController,
    ImageOptimizeController,
  ],
  providers: [
    UserService,
    AuthService,
    AccessTokenService,
    AlbumService,
    ArtistService,
    TrackService,
    UserAlbumHistoryService,
    UserAlbumLikeService,
    UserAudiobookHistoryService,
    UserAudiobookLikeService,
    DatabaseSchemaService,
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
    AudiobookCollectionService,
    PlaylistService,
    FolderService,
    SearchRecordService,
    ScanLoginService,
    LlmService,
    LlmConfigService,
    MvService,
    SyncGateway,
    WebDavConfigService,
    MetadataPluginService,
    ImageOptimizeService,
  ],
})
export class AppModule {}
