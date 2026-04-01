import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import {
  IErrorResponse,
  IParamsErrorResponse,
  ISuccessResponse,
} from '../common/const';
import {
  ScanLoginClaimPayload,
  ScanLoginService,
} from '../services/scan-login.service';

@Controller('/scan-login')
export class ScanLoginController {
  constructor(private readonly scanLoginService: ScanLoginService) {}

  @Public()
  @Post('/session')
  createSession(
    @Body()
    body: {
      role?: 'scanner' | 'target';
      deviceKind?: 'mobile' | 'desktop';
    },
  ): ISuccessResponse<any> | IParamsErrorResponse {
    const role = body?.role;
    const deviceKind = body?.deviceKind;

    if (!role || !deviceKind) {
      return { code: 400, message: '缺少角色或设备类型' };
    }

    return {
      code: 200,
      message: 'success',
      data: this.scanLoginService.createSession(role, deviceKind),
    };
  }

  @Public()
  @Get('/session/:id')
  getSession(
    @Param('id') id: string,
    @Query('secret') secret: string,
  ): ISuccessResponse<any> | IErrorResponse {
    try {
      return {
        code: 200,
        message: 'success',
        data: this.scanLoginService.getSessionStatus(id, secret),
      };
    } catch (error: any) {
      return { code: 500, message: error.message || '获取扫码状态失败' };
    }
  }

  @Post('/session/:id/claim')
  claimSession(
    @Param('id') id: string,
    @Body() body: { secret?: string; payload?: ScanLoginClaimPayload },
    @Req() req: any,
  ): ISuccessResponse<any> | IParamsErrorResponse | IErrorResponse {
    if (!body?.secret || !body?.payload) {
      return { code: 400, message: '缺少扫码会话信息' };
    }

    try {
      return {
        code: 200,
        message: 'success',
        data: this.scanLoginService.claimSession(
          id,
          body.secret,
          Number(req.user?.userId),
          body.payload,
        ),
      };
    } catch (error: any) {
      return { code: 500, message: error.message || '扫码认领失败' };
    }
  }

  @Public()
  @Post('/session/:id/confirm')
  confirmSession(
    @Param('id') id: string,
    @Body()
    body: {
      secret?: string;
      selections?: { type: string; configIds: string[] }[];
    },
  ): ISuccessResponse<any> | IParamsErrorResponse | IErrorResponse {
    if (!body?.secret) {
      return { code: 400, message: '缺少扫码会话密钥' };
    }

    try {
      return {
        code: 200,
        message: 'success',
        data: this.scanLoginService.confirmSession(
          id,
          body.secret,
          body.selections,
        ),
      };
    } catch (error: any) {
      return { code: 500, message: error.message || '确认扫码登录失败' };
    }
  }
}
