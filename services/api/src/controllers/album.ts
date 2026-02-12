import {
    Body,
    Controller,
    Delete,
    Get,
    Logger,
    Param,
    Post,
    Put,
    Query,
    Req,
} from '@nestjs/common';
import { Album, TrackType } from '@soundx/db';
import { Request } from 'express';
import {
    IErrorResponse,
    ILoadMoreData,
    ISuccessResponse,
    ITableData,
} from 'src/common/const';
import { LogMethod } from '../common/log-method.decorator';
import { AlbumService } from '../services/album';
import { TrackService } from '../services/track';

@Controller()
export class AlbumController {
  private readonly logger = new Logger(AlbumController.name);
  constructor(
    private readonly albumService: AlbumService,
    private readonly trackService: TrackService,
  ) { }

  @Get('/album/list')
  @LogMethod()
  async getAlbumList(): Promise<ISuccessResponse<Album[]> | IErrorResponse> {
    try {
      const albumList = await this.albumService.getAlbumList();
      return {
        code: 200,
        message: 'success',
        data: albumList,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }




  @Get('/album/collaborative/:artist')
  @LogMethod()
  async getCollaborativeAlbumsByArtist(
    @Req() req: Request,
    @Param('artist') artist: string,
  ): Promise<ISuccessResponse<Album[]> | IErrorResponse> {
    try {
      const userId = (req.user as any)?.userId;
      const albumList = await this.albumService.getCollaborativeAlbumsByArtist(artist, Number(userId));
      return {
        code: 200,
        message: 'success',
        data: albumList,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Get('/album/artist/:artist')
  @LogMethod()
  async getAlbumsByArtist(
    @Req() req: Request,
    @Param('artist') artist: string,
  ): Promise<ISuccessResponse<Album[]> | IErrorResponse> {
    try {
      const userId = (req.user as any)?.userId;
      const albumList = await this.albumService.getAlbumsByArtist(artist, Number(userId));
      return {
        code: 200,
        message: 'success',
        data: albumList,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Get('/album/table-list')
  @LogMethod()
  async getAlbumTableList(
    @Param('pageSize') pageSize: number,
    @Param('current') current: number,
  ): Promise<ISuccessResponse<ITableData<Album[]>> | IErrorResponse> {
    try {
      const albumList = await this.albumService.getAlbumTableList(
        pageSize,
        current,
      );
      const total = await this.albumService.albumCount();
      return {
        code: 200,
        message: 'success',
        data: {
          pageSize,
          current,
          list: albumList,
          total,
        },
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Get('/album/load-more')
  @LogMethod()
  async loadMoreAlbum(
    @Req() req: Request,
    @Query('pageSize') pageSize: number,
    @Query('loadCount') loadCount: number,
    @Query('type') type: TrackType,
  ): Promise<ISuccessResponse<ILoadMoreData<Album[]>> | IErrorResponse> {
    try {
      const userId = (req.user as any)?.userId;
      const albumList = await this.albumService.loadMoreAlbum(
        Number(pageSize),
        Number(loadCount),
        type,
        Number(userId),
      );
      const total = await this.albumService.albumCount(type);
      return {
        code: 200,
        message: 'success',
        data: {
          pageSize: Number(pageSize),
          loadCount: Number(loadCount),
          list: albumList,
          total,
        },
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Post('/')
  @LogMethod()
  async createAlbum(
    @Body() album: Omit<Album, 'id'>,
  ): Promise<ISuccessResponse<Album> | IErrorResponse> {
    try {
      const albumInfo = await this.albumService.createAlbum(album);
      return {
        code: 200,
        message: 'success',
        data: albumInfo,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Post('/album/batch-create')
  @LogMethod()
  async createAlbums(
    @Body() albums: Omit<Album, 'id'>[],
  ): Promise<ISuccessResponse<boolean> | IErrorResponse> {
    try {
      const albumInfo = await this.albumService.createAlbums(albums);
      if (albumInfo) {
        return {
          code: 200,
          message: 'success',
          data: albumInfo,
        };
      } else {
        return {
          code: 500,
          message: '批量新增失败',
        };
      }
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Delete('/album/batch-delete')
  @LogMethod()
  async deleteAlbums(
    @Body() ids: number[],
  ): Promise<ISuccessResponse<boolean> | IErrorResponse> {
    try {
      const result = await this.albumService.deleteAlbums(ids);
      if (result) {
        return {
          code: 200,
          message: 'success',
          data: result,
        };
      } else {
        return {
          code: 500,
          message: '批量删除失败',
        };
      }
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Put('/album/:id')
  @LogMethod()
  async updateAlbum(
    @Param('id') id: string,
    @Body() album: Partial<Album>,
  ): Promise<ISuccessResponse<Album> | IErrorResponse> {
    try {
      const albumInfo = await this.albumService.updateAlbum(
        parseInt(id),
        album,
      );
      return {
        code: 200,
        message: 'success',
        data: albumInfo,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Delete('/album/:id')
  @LogMethod()
  async deleteAlbum(
    @Param('id') id: string,
  ): Promise<ISuccessResponse<boolean> | IErrorResponse> {
    try {
      const isSuccess = await this.albumService.deleteAlbum(parseInt(id));
      return {
        code: 200,
        message: 'success',
        data: isSuccess,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }


  // 新增：最近 8 个专辑
  @Get('/album/latest')
  @LogMethod()
  async getLatestAlbums(
    @Req() req: Request,
    @Query('type') type: TrackType,
    @Query('random') random?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ISuccessResponse<Album[]> | IErrorResponse> {
    try {
      const userId = (req.user as any)?.userId;
      const isRandom = random === 'true';
      const limit = pageSize ? parseInt(pageSize, 10) : 8;
      const list = isRandom 
        ? await this.albumService.getRandomAlbums(limit, type, Number(userId))
        : await this.albumService.getLatestAlbums(limit, type, Number(userId));
      return { code: 200, message: 'success', data: list };
    } catch (error) {
      return { code: 500, message: String(error) };
    }
  }

  // 新增：随机推荐 8 条未听过的专辑
  @Get('/album/recommend')
  @LogMethod()
  async getRandomUnlistenedAlbums(
    @Req() req: Request,
    @Query('type') type: TrackType,
    @Query('pageSize') pageSize?: string,
  ): Promise<ISuccessResponse<Album[]> | IErrorResponse> {
    try {
      const userId = (req.user as any)?.userId;
      const limit = pageSize ? parseInt(pageSize, 10) : 8;
      
      let list: Album[] = [];
      if (userId) {
        list = await this.albumService.getRandomUnlistenedAlbums(
          Number(userId),
          limit,
          type,
        );
      } else {
        // Guest user: just return random albums
        list = await this.albumService.getRandomAlbums(limit, type, 0);
      }
      
      return { code: 200, message: 'success', data: list };
    } catch (error) {
      return { code: 500, message: String(error) };
    }
  }

  @Get('/album/search')
  @LogMethod()
  async searchAlbums(
    @Req() req: Request,
    @Query('keyword') keyword: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ): Promise<ISuccessResponse<Album[]> | IErrorResponse> {
    try {
      const userId = (req.user as any)?.userId;
      const limitNum = limit ? parseInt(limit, 10) : 10;
      const albums = await this.albumService.searchAlbums(keyword, type, limitNum, Number(userId));
      return {
        code: 200,
        message: 'success',
        data: albums,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Get('/album/:id')
  @LogMethod()
  async getAlbumById(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<ISuccessResponse<Album> | IErrorResponse> {
    try {
      const userId = (req.user as any)?.userId;
      if (isNaN(Number(id))) {
        return { code: 500, message: 'Invalid ID' };
      }
      const album = await this.albumService.getAlbumById(parseInt(id), userId ? parseInt(userId) : undefined);
      if (!album) {
        return { code: 500, message: 'Album not found' };
      }
      return {
        code: 200,
        message: 'success',
        data: album,
      };
    } catch (error) {
      return {
        code: 500,
        message: String(error),
      };
    }
  }

  @Get('/album/:id/tracks')
  @LogMethod()
  async getAlbumTracks(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('pageSize') pageSize: number,
    @Query('skip') skip: number,
    @Query('sort') sort: 'asc' | 'desc',
    @Query('sortBy') sortBy: 'id' | 'index' | 'episodeNumber',
    @Query('keyword') keyword: string,
  ): Promise<ISuccessResponse<any> | IErrorResponse> {
    try {
      const userId = (req.user as any)?.userId;
      if (isNaN(Number(id))) {
        return { code: 500, message: 'Invalid ID' };
      }
      const album = await this.albumService.getAlbumById(parseInt(id));
      if (!album) {
        return { code: 500, message: 'Album not found' };
      }
      const tracks = await this.trackService.getTracksByAlbum(
        album.name,
        album.artist,
        Number(pageSize) || 20,
        Number(skip) || 0,
        sort,
        keyword,
        Number(userId),
        sortBy || 'episodeNumber'
      );
      const total = await this.trackService.getTrackCountByAlbum(
        album.name,
        album.artist,
        keyword,
      );
      return {
        code: 200,
        message: 'success',
        data: {
          list: tracks,
          total,
        },
      };
    } catch (error) {
      return {
        code: 500,
        message: String(error),
      };
    }
  }
}
