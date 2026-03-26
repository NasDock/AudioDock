import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createCoverUploadOptions, toCoverUrl } from '../common/cover-upload';
import { User } from '@soundx/db';
import {
  IErrorResponse,
  ILoadMoreData,
  IParamsErrorResponse,
  ISuccessResponse,
  ITableData,
} from 'src/common/const';
import { Public } from 'src/common/public.decorator';
import { UserService } from '../services/user';

@Controller()
export class UserController {
  constructor(private readonly userService: UserService) { }

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
