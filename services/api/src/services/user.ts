import { Injectable } from '@nestjs/common';
import { Device, PrismaClient, User } from '@soundx/db';

@Injectable()
export class UserService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }
  getHello(): string {
    return 'Hello World!';
  }
  async getUserList(): Promise<User[]> {
    return await this.prisma.user.findMany();
  }

  async getUserTableList(page: number, pageSize: number) {
    return await this.prisma.user.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  async loadMoreUser(lastId: number, pageSize: number) {
    return await this.prisma.user.findMany({
      where: { id: { gt: lastId } },
      take: pageSize,
      orderBy: { id: 'asc' },
    });
  }

  async userCount(): Promise<number> {
    return await this.prisma.user.count();
  }
  async createUser(user: Omit<User, 'id'>): Promise<User> {
    const count = await this.prisma.user.count();
    if (count === 0) {
      user.is_admin = true;
    }
    return await this.prisma.user.create({
      data: user,
    });
  }

  async updateUser(id: number, user: Partial<User>): Promise<User> {
    return await this.prisma.user.update({
      where: { id },
      data: user,
    });
  }

  async deleteUser(id: number): Promise<boolean> {
    await this.prisma.user.delete({
      where: { id },
    });
    return true;
  }

  async getUser(username: string): Promise<User | null> {
    return await this.prisma.user.findFirst({
      where: { username },
    });
  }

  async getUserById(id: number): Promise<User | null> {
    return await this.prisma.user.findUnique({
      where: { id },
    });
  }

  async saveDevice(
    userId: number,
    deviceName: string,
    deviceId?: string,
    platform?: string,
  ): Promise<Device> {
    const now = new Date();
    // 优先按 deviceId 精确查找（稳定唯一标识）
    let device: Device | null = null;
    if (deviceId) {
      device = await this.prisma.device.findFirst({
        where: { userId, deviceId },
      });
    }
    // 兜底按 name + platform 查找（兼容旧端；必须带 platform 维度，
    // 否则同主机名/同设备名的 desktop 与 web 会互相误合并）。
    if (!device) {
      device = await this.prisma.device.findFirst({
        where: {
          userId,
          name: deviceName,
          ...(platform ? { platform } : {}),
        },
      });
    }

    if (device) {
      // 存在则更新在线状态 + 补录 deviceId/platform + 刷新 lastSeen
      const updated = await this.prisma.device.update({
        where: { id: device.id },
        data: {
          isOnline: true,
          lastSeen: now,
          ...(deviceId ? { deviceId } : {}),
          ...(platform ? { platform } : {}),
        },
      });
      // 仅当 deviceId 精确命中时，才清理同 deviceId 的重复记录（安全，不会误删同名异端设备）
      if (deviceId) {
        await this.mergeDuplicateDevices(userId, deviceId, device.id);
      }
      return updated;
    } else {
      // 不存在则创建新设备
      return await this.prisma.device.create({
        data: {
          userId,
          name: deviceName,
          deviceId: deviceId ?? null,
          platform: platform ?? null,
          isOnline: true,
          lastSeen: now,
        },
      });
    }
  }

  /**
   * 合并同 userId + 同 deviceId 下的重复记录。
   *
   * ⚠️ 只能按 deviceId 去重，绝不能按 name——同主机名/同设备名的 desktop 与 web
   * 是两台不同设备，按 name 删会把它们互相删掉（曾导致所有设备离线）。
   * 仅在确认 deviceId 命中后调用（同一 deviceId 不应有多条记录）。
   */
  private async mergeDuplicateDevices(userId: number, deviceId: string, keepId: number): Promise<void> {
    try {
      const dup = await this.prisma.device.findMany({
        where: { userId, deviceId, id: { not: keepId } },
        select: { id: true },
      });
      if (dup.length > 0) {
        await this.prisma.device.deleteMany({
          where: { userId, deviceId, id: { in: dup.map((d) => d.id) } },
        });
        console.log(`[Device] 合并重复设备: user=${userId} deviceId=${deviceId} 删除 ${dup.length} 条重复记录，保留 id=${keepId}`);
      }
    } catch (e) {
      // 去重失败不影响主流程
      console.warn('[Device] mergeDuplicateDevices failed:', e);
    }
  }

  /** 清理 deviceId 为 null 的脏数据（早期未传 deviceId 的端留下的 Unknown Device 记录） */
  async cleanNullDeviceIdRecords(userId: number): Promise<number> {
    const res = await this.prisma.device.deleteMany({
      where: { userId, deviceId: null },
    });
    return res.count;
  }

  async setDeviceOffline(userId: number, deviceName: string, deviceId?: string): Promise<void> {
    let device: Device | null = null;
    if (deviceId) {
      device = await this.prisma.device.findFirst({
        where: { userId, deviceId },
      });
    }
    if (!device) {
      device = await this.prisma.device.findFirst({
        where: { userId, name: deviceName },
      });
    }

    if (device) {
      await this.prisma.device.update({
        where: { id: device.id },
        data: { isOnline: false, lastSeen: new Date() },
      });
    }
  }

  async touchDevice(userId: number, deviceId: string): Promise<void> {
    await this.prisma.device.updateMany({
      where: { userId, deviceId },
      data: { lastSeen: new Date() },
    });
  }

  /** 服务启动时调用：清空所有设备的在线状态（服务重启后所有 socket 已断开，避免「僵尸在线」） */
  async markAllDevicesOffline(): Promise<void> {
    await this.prisma.device.updateMany({
      where: { isOnline: true },
      data: { isOnline: false },
    });
    // 顺带清理 deviceId 为 null 的脏数据（早期 Unknown Device 残留）
    try {
      const res = await this.prisma.device.deleteMany({ where: { deviceId: null } });
      if (res.count > 0) console.log(`[WS] 启动时清理 deviceId=null 脏设备记录 ${res.count} 条`);
    } catch (e) {
      console.warn('[WS] 清理 null deviceId 记录失败', e);
    }
  }

  async getUserDevices(userId: number): Promise<Device[]> {
    return await this.prisma.device.findMany({
      where: { userId },
      orderBy: [{ isOnline: 'desc' }, { lastSeen: 'desc' }],
    });
  }

  async getDevice(userId: number, deviceName: string): Promise<Device | null> {
    return await this.prisma.device.findFirst({
      where: {
        userId,
        name: deviceName,
      },
    });
  }

  // === 系统设置相关 ===
  async getSetting(key: string): Promise<string | null> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
    return setting ? setting.value : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async isRegistrationAllowed(): Promise<boolean> {
    const value = await this.getSetting('allow_registration');
    return value !== 'false'; // 默认为 true
  }

  // === 用户过期相关 ===
  async setUserExpiration(id: number, days: number | null): Promise<User> {
    let expiresAt: Date | null = null;
    if (days !== null) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + days);
    }
    return await this.prisma.user.update({
      where: { id },
      data: { expiresAt },
    });
  }
}
