-- AlterTable: 新增设备平台相关字段
ALTER TABLE "Device" ADD COLUMN "deviceId" TEXT;
ALTER TABLE "Device" ADD COLUMN "platform" TEXT;
ALTER TABLE "Device" ADD COLUMN "lastSeen" DATETIME;

-- CreateIndex: (userId, deviceId) 唯一索引（deviceId 为 NULL 的旧数据不冲突，SQLite 允许多个 NULL）
CREATE UNIQUE INDEX "Device_userId_deviceId_key" ON "Device"("userId", "deviceId");
