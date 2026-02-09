import { Body, Controller, Get, Post } from '@nestjs/common';
import { Device, User } from '@soundx/db';
import { IErrorResponse, IForbiddenResponse, IParamsErrorResponse, ISuccessResponse } from 'src/common/const';
import { Public } from '../common/public.decorator';
import { AuthService } from './auth.service';

import { UserService } from '../services/user';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) { }

  @Public()
  @Post('/auth/login')
  async login(
    @Body() body: User & { deviceName?: string },
  ): Promise<ISuccessResponse<User & { token: string; device?: Device }> | IErrorResponse> {
    const userInfo = await this.authService.validateUser(
      body.username,
      body.password,
    );
    let device: Device | undefined;
    if (userInfo) {
      // 如果提供了设备名称，保存设备信息
      if (body.deviceName) {
        device = await this.userService.saveDevice(userInfo.id, body.deviceName);
      }

      // 生成token
      const token = this.authService.login(userInfo);
      return {
        code: 200,
        message: 'success',
        data: { ...userInfo, token, device },
      };
    } else {
      return {
        code: 500,
        message: '用户名或密码错误',
      };
    }
  }

  @Public()
  @Post('/auth/register')
  async register(
    @Body() user: { username: string; password: string, deviceName?: string },
  ): Promise<ISuccessResponse<User & { token: string, device?: Device }> | IErrorResponse | IParamsErrorResponse | IForbiddenResponse> {
    try {
      // Check if user already exists
      const existingUser = await this.authService.findUserByUsername(user.username);
      if (existingUser) {
        return {
          code: 400,
          message: '用户名已存在',
        };
      }

      // Check if registration is allowed
      const isAllowed = await this.userService.isRegistrationAllowed();
      // First user is always allowed (will be admin)
      const userCount = await this.userService.userCount();
      if (!isAllowed && userCount > 0) {
        return {
          code: 403,
          message: '注册功能已关闭',
        };
      }

      // Create new user
      const newUser = await this.authService.register(user.username, user.password);

      let device: Device | undefined;
      if (user.deviceName) {
        device = await this.userService.saveDevice(newUser.id, user.deviceName);
      }

      // Generate token
      const token = this.authService.login(newUser);

      return {
        code: 200,
        message: 'success',
        data: { ...newUser, token, device },
      };
    } catch (error) {
      return {
        code: 500,
        message: error.message || '注册失败',
      };
    }
  }

  @Get('/auth/check')
  async check(): Promise<ISuccessResponse<boolean>> {
    return {
      code: 200,
      message: 'success',
      data: true,
    };
  }

  @Public()
  @Post('/auth/verify-device')
  async verifyDevice(
    @Body() body: { username: string; deviceName: string },
  ): Promise<ISuccessResponse<boolean> | IErrorResponse> {
    const user = await this.userService.getUser(body.username);
    if (!user) {
      return {
        code: 500,
        message: '用户不存在',
      };
    }

    const device = await this.userService.getDevice(user.id, body.deviceName);
    if (!device) {
      return {
        code: 500,
        message: '设备验证失败，请在常用设备上操作',
      };
    }

    return {
      code: 200,
      message: 'success',
      data: true,
    };
  }

  @Public()
  @Post('/auth/reset-password')
  async resetPassword(
    @Body() body: { username: string; deviceName: string; newPassword: string },
  ): Promise<ISuccessResponse<User & { token: string; device?: Device }> | IErrorResponse> {
    const user = await this.userService.getUser(body.username);
    if (!user) {
      return {
        code: 500,
        message: '用户不存在',
      };
    }

    const device = await this.userService.getDevice(user.id, body.deviceName);
    if (!device) {
      return {
        code: 500,
        message: '设备验证失败，无法重置密码',
      };
    }

    const updatedUser = await this.userService.updateUser(user.id, { password: body.newPassword });
    const token = this.authService.login(updatedUser);

    return {
      code: 200,
      message: 'success',
      data: { ...updatedUser, token, device },
    };
  }
}
