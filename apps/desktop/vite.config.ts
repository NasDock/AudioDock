import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  server: {
    // Tauri devUrl 写死 5173，vite 不能悄悄跳到 5174，否则 webview 加载错地址导致白屏。
    // strictPort=true：5173 被占就直接报错，提醒去杀僵尸进程，比静默白屏友好。
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      }
    },
  },
  plugins: [
    react(),
    svgr(),
  ],
})
