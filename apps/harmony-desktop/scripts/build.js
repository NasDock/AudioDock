#!/usr/bin/env node
/**
 * build-harmony.js
 * 一键构建鸿蒙桌面版
 * 1. 构建 Web 资源
 * 2. 复制到 rawfile 目录
 */
import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.join(__dirname, '../desktop');
const rawfileDir = path.join(__dirname, '../entry/src/main/resources/rawfile');

console.log('🔨 开始构建 AudioDock 鸿蒙桌面版\n');

try {
  // Step 1: Build web assets
  console.log('📦 Step 1: 构建 Web 资源...');
  execSync('pnpm build:harmony', { cwd: desktopDir, stdio: 'inherit' });

  // Step 2: Copy to rawfile
  console.log('\n📁 Step 2: 复制资源到 rawfile...');
  await fs.rm(rawfileDir, { recursive: true, force: true });
  await fs.mkdir(rawfileDir, { recursive: true });

  const copyDir = async (src, dest) => {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
        console.log(`  ✓ ${entry.name}`);
      }
    }
  };

  await copyDir(path.join(desktopDir, 'dist-web'), rawfileDir);
  console.log('\n✅ 构建完成!\n');
  console.log('下一步: 在 DevEco Studio 中打开 apps/harmony-desktop 并运行。');
} catch (err) {
  console.error('❌ 构建失败:', err.message);
  process.exit(1);
}
