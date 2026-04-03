import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';
import path from 'path';

// Web-only build for HarmonyOS Desktop WebView
// Outputs to dist-web/ directory
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    // 生成单文件 HTML + 内联 CSS/JS，减少文件数量
    rollupOptions: {
      output: {
        // 资源输出到 assets 目录
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
    // 目标浏览器
    target: 'es2020',
    // 禁用 CSS 代码分割，减少文件数量
    cssCodeSplit: false,
    // 小于 4KB 的资源内联
    assetsInlineLimit: 4096,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // 平台标识
    'import.meta.env.VITE_PLATFORM': JSON.stringify('harmony'),
  },
  plugins: [
    react(),
    svgr(),
  ],
  server: {
    port: 5174, // 使用不同端口避免与 desktop dev 冲突
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/tts': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tts/, ''),
      },
    },
  },
});
