import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { createCoverUploadOptions, toCoverUrl } from '../common/cover-upload';
import { Device, User } from '@soundx/db';
import {
  IAuthFaildResponse,
  IErrorResponse,
  ILoadMoreData,
  IParamsErrorResponse,
  ISuccessResponse,
  ITableData,
} from 'src/common/const';
import { Public } from 'src/common/public.decorator';
import { UserService } from '../services/user';
import { SyncGateway } from '../gateways/sync.gateway';

@Controller()
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly syncGateway: SyncGateway,
  ) { }

  @Public()
  @Get("/hello")
  async hello(): Promise<ISuccessResponse<string> | IErrorResponse> {
    return {
      code: 200,
      message: 'success',
      data: 'hello',
    };
  }

  @Get('/user/list')
  async getUserList(): Promise<ISuccessResponse<User[]> | IErrorResponse> {
    try {
      const useList = await this.userService.getUserList();

      return {
        code: 200,
        message: 'success',
        data: useList,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Get('/user/table-list')
  async getUserTableList(
    @Param('page') page: string = '1',
    @Param('pageSize') pageSize: string = '10',
  ): Promise<ISuccessResponse<ITableData<User[]>> | IErrorResponse> {
    try {
      const list = await this.userService.getUserTableList(
        Number(page),
        Number(pageSize),
      );
      const total = await this.userService.userCount();
      return {
        code: 200,
        message: 'success',
        data: {
          pageSize: Number(pageSize),
          current: Number(page),
          list,
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

  @Get('/user/load-more')
  async loadMoreUser(
    @Param('lastId') lastId: string,
    @Param('pageSize') pageSize: string = '10',
  ): Promise<ISuccessResponse<ILoadMoreData<User[]>> | IErrorResponse> {
    try {
      const list = await this.userService.loadMoreUser(
        Number(lastId),
        Number(pageSize),
      );
      const total = await this.userService.userCount();
      return {
        code: 200,
        message: 'success',
        data: {
          pageSize: Number(pageSize),
          loadCount: Number(lastId),
          list,
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

  @Get('/user/count')
  async userCount(): Promise<ISuccessResponse<number> | IErrorResponse> {
    try {
      const count = await this.userService.userCount();
      return {
        code: 200,
        message: 'success',
        data: count,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  /**
   * 当前登录用户的设备列表（含在线状态、平台、最后活跃时间）
   */
  @Get('/user/devices')
  async getUserDevices(@Req() req: Request): Promise<ISuccessResponse<Device[]> | IErrorResponse | IAuthFaildResponse> {
    try {
      const userId = Number((req.user as any)?.userId);
      if (!userId) {
        return { code: 401, message: '未登录' };
      }
      const devices = await this.userService.getUserDevices(userId);
      return {
        code: 200,
        message: 'success',
        data: devices,
      };
    } catch (error) {
      return {
        code: 500,
        message: (error as Error).message,
      };
    }
  }

  /**
   * 播放流转（HTTP 版，供无常驻 WS 的端：小程序/TV/手表发起）。
   * 由后端代为通过 WS 转发给目标在线设备。
   */
  @Post('/user/devices/transfer')
  async transferToDevice(
    @Req() req: Request,
    @Body() body: { targetDeviceId: string; currentTrack?: any; playlist?: any; progress?: number; fromDeviceName?: string },
  ): Promise<ISuccessResponse<{ delivered: boolean }> | IErrorResponse | IAuthFaildResponse> {
    try {
      const userId = Number((req.user as any)?.userId);
      if (!userId) {
        return { code: 401, message: '未登录' };
      }
      if (!body.targetDeviceId) {
        return { code: 500, message: '缺少 targetDeviceId' };
      }
      const delivered = await this.syncGateway.forwardTransfer(userId, body);
      return {
        code: 200,
        message: delivered ? 'success' : 'target device offline',
        data: { delivered },
      };
    } catch (error) {
      return {
        code: 500,
        message: (error as Error).message,
      };
    }
  }

  @Public()
  @Post('/user')
  async createUser(
    @Body() user: Omit<User, 'id'>,
  ): Promise<ISuccessResponse<User> | IErrorResponse> {
    try {
      const userInfo = await this.userService.createUser(user);
      return {
        code: 200,
        message: 'success',
        data: userInfo,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Put('/user/:id')
  async updateUser(
    @Param('id') id: string,
    @Body() user: Partial<User>,
  ): Promise<ISuccessResponse<User> | IErrorResponse> {
    try {
      const userInfo = await this.userService.updateUser(parseInt(id), user);
      return {
        code: 200,
        message: 'success',
        data: userInfo,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }

  @Delete('/user/:id')
  async deleteUser(
    @Param('id') id: string,
  ): Promise<ISuccessResponse<boolean> | IErrorResponse> {
    try {
      const isSuccess = await this.userService.deleteUser(parseInt(id));
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

  @Post('/user/:id/avatar')
  @UseInterceptors(FileInterceptor('file', createCoverUploadOptions('user')))
  async uploadUserAvatar(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ISuccessResponse<User> | IErrorResponse | IParamsErrorResponse> {
    try {
      if (!file) {
        return { code: 400, message: 'No file uploaded' };
      }
      const avatarUrl = toCoverUrl(file.filename);
      const userInfo = await this.userService.updateUser(parseInt(id), { avatar: avatarUrl });
      return {
        code: 200,
        message: 'success',
        data: userInfo,
      };
    } catch (error) {
      return {
        code: 500,
        message: error,
      };
    }
  }
}
