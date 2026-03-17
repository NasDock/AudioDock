import { Body, Controller, Get, Logger, Param, Post } from '@nestjs/common';
import * as path from 'path';
import { LogMethod } from '../common/log-method.decorator';
import { resolvePathListFromBody } from '../common/path-list';
import { ImportService } from '../services/import';

@Controller('import')
export class ImportController {
  private readonly logger = new Logger(ImportController.name);
  constructor(private readonly importService: ImportService) { }

  @Post('task')
  @LogMethod()
  async createTask(@Body() body: any) {
    let { musicPath, audiobookPath, cachePath, mode } = body;

    // Use server-side defaults from environment variables checks
    const musicPaths = resolvePathListFromBody(
      musicPath,
      process.env.MUSIC_BASE_DIR || './'
    );
    const audiobookPaths = resolvePathListFromBody(
      audiobookPath,
      process.env.AUDIO_BOOK_DIR || './'
    );
    const resolvedCachePath = cachePath ? path.resolve(cachePath) : path.resolve(process.env.CACHE_DIR || './');

    console.log('Received import task with musicPaths:', musicPaths);

    const id = await this.importService.createTask(
      musicPaths,
      audiobookPaths,
      resolvedCachePath,
      mode || 'incremental'
    );
    return { code: 200, message: 'success', data: { id } };
  }

  @Get('task/:id')
  @LogMethod()
  async getTask(@Param('id') id: string) {
    const task = await this.importService.getTask(id);
    if (!task) {
      return { code: 404, message: 'Task not found' };
    }
    return { code: 200, message: 'success', data: task };
  }

  @Get('current-task')
  @LogMethod()
  async getRunningTask() {
    const task = await this.importService.getRunningTask();
    if (!task) {
      return { code: 404, message: 'No running task found' };
    }
    return { code: 200, message: 'success', data: task };
  }
}
