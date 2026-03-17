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
import { Artist, TrackType } from '@soundx/db';
import { Request } from 'express';
import {
  IErrorResponse,
  ILoadMoreData,
  INotFoundResponse,
  ISuccessResponse,
  ITableData,
} from 'src/common/const';
import { Public } from 'src/common/public.decorator';
import { LogMethod } from '../common/log-method.decorator';
import { ArtistService } from '../services/artist';

@Controller()
export class ArtistController {
  private readonly logger = new Logger(ArtistController.name);
  constructor(private readonly artistService: ArtistService) { }

  @Get('/artist/list')
  @LogMethod()
  async getArtistList(): Promise<ISuccessResponse<Artist[]> | IErrorResponse> {
    try {
      const artistList = await this.artistService.getArtistList();
      return {
        code: 200,
        message: 'success',
        data: artistList,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Get('/artist/table-list')
  @LogMethod()
  async getArtistTableList(
    @Param('pageSize') pageSize: number,
    @Param('current') current: number,
    @Query('type') type?: TrackType,
  ): Promise<ISuccessResponse<ITableData<Artist[]>> | IErrorResponse> {
    try {
      const artistList = await this.artistService.getArtistTableList(
        pageSize,
        current,
      );
      const total = await this.artistService.artistCount(type);
      return {
        code: 200,
        message: 'success',
        data: {
          pageSize,
          current,
          list: artistList,
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

  @Get('/artist/load-more')
  @LogMethod()
  async loadMoreArtist(
    @Req() req: Request,
    @Query('pageSize') pageSize: string,
    @Query('loadCount') loadCount: string,
    @Query('type') type?: TrackType,
    @Query('sortBy') sortBy?: string,
  ): Promise<ISuccessResponse<ILoadMoreData<Artist[]>> | IErrorResponse> {
    try {
      const userId = Number((req.user as any)?.userId);
      const size = parseInt(pageSize, 10);
      const count = parseInt(loadCount, 10);
      const artistList = await this.artistService.loadMoreArtist(
        size,
        count,
        type,
        userId,
        sortBy,
      );
      const total = await this.artistService.artistCount(type);
      return {
        code: 200,
        message: 'success',
        data: {
          pageSize: size,
          loadCount: count,
          list: artistList,
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

  @Public()
  @Post('/artist')
  @LogMethod()
  async createArtist(
    @Body() artist: Omit<Artist, 'id'>,
  ): Promise<ISuccessResponse<Artist> | IErrorResponse> {
    try {
      const artistInfo = await this.artistService.createArtist(artist);
      return {
        code: 200,
        message: 'success',
        data: artistInfo,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Put('/artist/:id')
  @LogMethod()
  async updateArtist(
    @Param('id') id: string,
    @Body() artist: Partial<Artist>,
  ): Promise<ISuccessResponse<Artist> | IErrorResponse> {
    try {
      const artistInfo = await this.artistService.updateArtist(
        parseInt(id),
        artist,
      );
      return {
        code: 200,
        message: 'success',
        data: artistInfo,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Delete('/artist/:id')
  @LogMethod()
  async deleteArtist(
    @Param('id') id: string,
  ): Promise<ISuccessResponse<boolean> | IErrorResponse> {
    try {
      const isSuccess = await this.artistService.deleteArtist(parseInt(id));
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

  @Post('/artist/batch-create')
  @LogMethod()
  async createArtists(
    @Body() artists: Omit<Artist, 'id'>[],
  ): Promise<ISuccessResponse<boolean> | IErrorResponse> {
    try {
      const artistInfo = await this.artistService.createArtists(artists);
      if (artistInfo) {
        return {
          code: 200,
          message: 'success',
          data: artistInfo,
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

  @Delete('/artist/batch-delete')
  @LogMethod()
  async deleteArtists(
    @Body() ids: number[],
  ): Promise<ISuccessResponse<boolean> | IErrorResponse> {
    try {
      const result = await this.artistService.deleteArtists(ids);
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

  @Get('/artist/search')
  @LogMethod()
  async searchArtists(
    @Query('keyword') keyword: string,
    @Query('type') type?: TrackType,
    @Query('limit') limit?: string,
  ): Promise<ISuccessResponse<Artist[]> | IErrorResponse> {
    try {
      const limitNum = limit ? parseInt(limit, 10) : 10;
      const artists = await this.artistService.searchArtists(keyword, type, limitNum);
      return {
        code: 200,
        message: 'success',
        data: artists,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Get('/artist/latest')
  @LogMethod()
  async getLatestArtists(
    @Query('type') type: TrackType,
    @Query('limit') limit?: string,
    @Query('pageSize') pageSize?: string,
    @Query('random') random?: string,
  ): Promise<ISuccessResponse<Artist[]> | IErrorResponse> {
    try {
      const limitNum = pageSize ? parseInt(pageSize, 10) : (limit ? parseInt(limit, 10) : 10);
      const isRandom = random === 'true';
      const artists = isRandom
        ? await this.artistService.getRandomArtists(limitNum, type)
        : await this.artistService.getLatestArtists(limitNum, type);
      return {
        code: 200,
        message: 'success',
        data: artists,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }


  @Get('/artist/:id')
  @LogMethod()
  async getArtistById(
    @Param('id') id: string,
  ): Promise<ISuccessResponse<Artist> | IErrorResponse | INotFoundResponse> {
    try {
      const artist = await this.artistService.getArtistById(parseInt(id));
      if (artist) {
        return {
          code: 200,
          message: 'success',
          data: artist,
        };
      } else {
        return {
          code: 404,
          message: 'Artist not found',
        };
      }
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }
}
