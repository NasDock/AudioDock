/**
 * copy-harmony-assets.js
 * 将 Vite web 构建产物复制到 harmony-desktop 的 rawfile 目录
 */
import { promises as fs } from 'fs';
import path from 'path';

const srcDir = path.join(process.cwd(), 'dist-web');
const destDir = path.join(process.cwd(), '../harmony-desktop/entry/src/main/resources/rawfile');

async function copyDir(src, dest) {
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
}

async function main() {
  console.log('📦 复制 Web 资源到 HarmonyOS 项目...\n');
  console.log(`源: ${srcDir}`);
  console.log(`目标: ${destDir}\n`);

  try {
    // 检查源目录是否存在
    await fs.access(srcDir);
  } catch {
    console.error(`❌ 错误: 源目录不存在 "${srcDir}"`);
    console.error('请先运行: pnpm build:harmony\n');
    process.exit(1);
  }

  // 清理目标目录
  try {
    await fs.rm(destDir, { recursive: true, force: true });
    console.log('✓ 已清理旧的资源目录\n');
  } catch {
    // 目录不存在，忽略
  }

  // 复制文件
  console.log('📁 复制文件:');
  await copyDir(srcDir, destDir);
  console.log('\n✅ 完成! Web 资源已复制到 harmony-desktop\n');
  console.log('下一步: 在 DevEco Studio 中打开 harmony-desktop 项目并运行。');
}

main().catch((err) => {
  console.error('❌ 复制失败:', err);
  process.exit(1);
});
