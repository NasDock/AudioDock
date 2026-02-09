import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Track, TrackType } from '@soundx/db';
import { spawn } from 'child_process';
import { Request, Response } from 'express';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import {
  IErrorResponse,
  ILoadMoreData,
  ISuccessResponse,
  ITableData,
} from 'src/common/const';
import { Public } from 'src/common/public.decorator';
import { TrackService } from '../services/track';

@Controller()
export class TrackController {
  constructor(private readonly trackService: TrackService) { }

  @Get('/track/list')
  async getTrackList(): Promise<ISuccessResponse<Track[]> | IErrorResponse> {
    try {
      const trackList = await this.trackService.getTrackList();
      return {
        code: 200,
        message: 'success',
        data: trackList,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Get('/table-list')
  async getTrackTableList(
    @Query('pageSize') pageSize: any,
    @Query('current') current: any,
    @Query('type') type?: TrackType,
  ): Promise<ISuccessResponse<ITableData<Track[]>> | IErrorResponse> {
    try {
      const size = Number(pageSize);
      const cur = Number(current);
      const trackList = await this.trackService.getTrackTableList(
        size,
        cur,
      );
      const total = await this.trackService.trackCount(type);
      return {
        code: 200,
        message: 'success',
        data: {
          pageSize: size,
          current: cur,
          list: trackList,
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

  @Get('/load-more')
  async loadMoreTrack(
    @Query('pageSize') pageSize: any,
    @Query('loadCount') loadCount: any,
    @Query('type') type?: TrackType,
  ): Promise<ISuccessResponse<ILoadMoreData<Track[]>> | IErrorResponse> {
    try {
      const size = Number(pageSize);
      const count = Number(loadCount);
      const trackList = await this.trackService.loadMoreTrack(
        size,
        count,
        type,
      );
      const total = await this.trackService.trackCount(type);
      return {
        code: 200,
        message: 'success',
        data: {
          pageSize: size,
          loadCount: count,
          list: trackList,
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
  @Post('/track')
  async createTrack(
    @Body() track: Omit<Track, 'id'>,
  ): Promise<ISuccessResponse<Track> | IErrorResponse> {
    try {
      const trackInfo = await this.trackService.createTrack(track);
      return {
        code: 200,
        message: 'success',
        data: trackInfo,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Put('/track/:id')
  async updateTrack(
    @Param('id') id: string,
    @Body() track: Partial<Track>,
  ): Promise<ISuccessResponse<Track> | IErrorResponse> {
    try {
      const trackInfo = await this.trackService.updateTrack(
        parseInt(id),
        track,
      );
      return {
        code: 200,
        message: 'success',
        data: trackInfo,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Delete('/track/:id')
  async deleteTrack(
    @Param('id') id: string,
    @Query('deleteAlbum') deleteAlbum?: string,
  ): Promise<ISuccessResponse<boolean> | IErrorResponse> {
    try {
      const isSuccess = await this.trackService.deleteTrack(
        parseInt(id)
      );
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

  @Get('/track/:id/deletion-impact')
  async getDeletionImpact(
    @Param('id') id: string,
  ): Promise<ISuccessResponse<{ isLastTrackInAlbum: boolean; albumName: string | null }> | IErrorResponse> {
    try {
      const impact = await this.trackService.checkDeletionImpact(parseInt(id));
      return {
        code: 200,
        message: 'success',
        data: impact,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Post('/track/batch-create')
  async createTracks(
    @Body() tracks: Omit<Track, 'id'>[],
  ): Promise<ISuccessResponse<boolean> | IErrorResponse> {
    try {
      const trackInfo = await this.trackService.createTracks(tracks);
      if (trackInfo) {
        return {
          code: 200,
          message: 'success',
          data: trackInfo,
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

  @Delete('/track/batch-delete')
  async deleteTracks(
    @Body() ids: number[],
  ): Promise<ISuccessResponse<boolean> | IErrorResponse> {
    try {
      const result = await this.trackService.deleteTracks(ids);
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

  @Get('/track/search')
  async searchTracks(
    @Query('keyword') keyword: string,
    @Query('type') type?: TrackType,
    @Query('limit') limit?: string,
  ): Promise<ISuccessResponse<Track[]> | IErrorResponse> {
    try {
      const limitNum = limit ? parseInt(limit, 10) : 10;
      const tracks = await this.trackService.searchTracks(keyword, type, limitNum);
      return {
        code: 200,
        message: 'success',
        data: tracks,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }
  @Get('/track/latest')
  async getLatestTracks(
    @Query('type') type?: TrackType,
    @Query('random') random?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ISuccessResponse<Track[]> | IErrorResponse> {
    try {
      const isRandom = random === 'true';
      const limit = pageSize ? parseInt(pageSize, 10) : 8;
      const tracks = isRandom
        ? await this.trackService.getRandomTracks(type, limit)
        : await this.trackService.getLatestTracks(type, limit);
      return {
        code: 200,
        message: 'success',
        data: tracks,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Get('/track/artist')
  async getTracksByArtist(
    @Query('artist') artist: string,
  ): Promise<ISuccessResponse<Track[]> | IErrorResponse> {
    try {
      const tracks = await this.trackService.getTracksByArtist(artist);
      return {
        code: 200,
        message: 'success',
        data: tracks,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Public()
  @Get('/track/stream/:id')
  async streamTrack(@Param('id') id: string, @Res() res: Response, @Req() req: Request) {
    try {
      const track = await this.trackService.findById(parseInt(id));
      if (!track) {
        return res.status(HttpStatus.NOT_FOUND).send('Track not found');
      }

      // Handle .strm (URL) tracks - Proxy instead of Redirect to bypass CORS/ATS issues
      if (track.path.startsWith('http')) {
        return this.proxyStream(track.path, req, res);
      }

      let filePath = this.trackService.getFilePath(track.path);
      
      // Fallback for .strm files that were incorrectly saved as local paths
      if ((!filePath || !fs.existsSync(filePath)) && track.path.includes('.strm')) {
          // If the DB path is a local URL like /music/..., get the actual disk path
          filePath = this.trackService.getFilePath(track.path);
      }

      if (!filePath || !fs.existsSync(filePath)) {
        console.warn(`[Stream] File not found: ${track.path} (Resolved: ${filePath})`);
        return res.status(HttpStatus.NOT_FOUND).send('File not found');
      }

      const ext = path.extname(filePath).toLowerCase();

      // If it's a .strm file stored as a local path, read it and proxy
      if (ext === '.strm') {
          const url = fs.readFileSync(filePath, 'utf-8').trim();
          if (url.startsWith('http')) {
              console.log(`[Stream] Re-routing local .strm file to proxy: ${url}`);
              return this.proxyStream(url, req, res);
          } else if (url.startsWith('/')) {
              // Potential relative path or Alist path
              console.warn(`[Stream] .strm file contains relative path "${url}". .strm files should ideally contain full http(s) URLs.`);
              // If it's an Alist path, maybe it can be resolved if Alist is on same host
              // For now, return error as we don't know the base URL
              return res.status(HttpStatus.BAD_REQUEST).send('Invalid .strm content: full URL required');
          }
      }
      
      // If it's a video file or problematic format, use ffmpeg to extract audio
      if (ext === '.mp4' || ext === '.mkv' || ext === '.avi') {
         res.setHeader('Content-Type', 'audio/mpeg');
         const ffmpeg = spawn('ffmpeg', [
           '-i', filePath,
           '-vn',              // No video
           '-acodec', 'libmp3lame', // Transcode to mp3
           '-ab', '128k',      // 128kbps is enough for preview/audio
           '-f', 'mp3',
           'pipe:1'            // Output to stdout
         ]);

         ffmpeg.stdout.pipe(res);

         ffmpeg.on('error', (err) => {
           console.error('FFmpeg error:', err);
           if (!res.headersSent) res.status(500).send('Streaming failed');
         });

         res.on('close', () => {
           ffmpeg.kill();
         });
         return;
      }

      // Normal audio file: provide range support via express
      return res.sendFile(filePath);
      
    } catch (error) {
      console.error('Stream error:', error);
      if (!res.headersSent) res.status(500).send('Internal server error');
    }
  }

  private proxyStream(url: string, req: Request, res: Response, redirectCount = 0) {
    if (redirectCount > 5) {
        console.error('[Stream] Too many redirects for:', url);
        return res.status(500).send('Too many redirects');
    }

    const client = url.startsWith('https') ? https : http;
    
    const headers: any = {};
    if (req.headers.range) {
      headers['range'] = req.headers.range;
    }
    if (req.headers['user-agent']) {
      headers['user-agent'] = req.headers['user-agent'];
    }

    const proxyReq = client.get(url, { headers }, (proxyRes) => {
      // Handle Redirects
      if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
          let location = proxyRes.headers.location;
          if (!location.startsWith('http')) {
              const parsed = new URL(url);
              location = `${parsed.protocol}//${parsed.host}${location}`;
          }
          console.log(`[Stream] Following redirect: ${url} -> ${location}`);
          return this.proxyStream(location, req, res, redirectCount + 1);
      }

      // Pass back headers from target to client
      const headersToPass = [
        'content-type',
        'content-length',
        'accept-ranges',
        'content-range',
        'cache-control'
      ];

      let hasContentType = false;
      headersToPass.forEach(h => {
        if (proxyRes.headers[h]) {
          res.setHeader(h, proxyRes.headers[h] as string);
          if (h === 'content-type') hasContentType = true;
        }
      });

      // Force a content type if missing to help player
      if (!hasContentType) {
          res.setHeader('Content-Type', 'audio/mpeg');
      }

      res.writeHead(proxyRes.statusCode || 200);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('STRM Proxy error:', err);
      if (!res.headersSent) res.status(500).send('Streaming failed');
    });

    res.on('close', () => {
      proxyReq.destroy();
    });
  }
}
