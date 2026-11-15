import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';
import { fnosProxyPlugin } from './vite-plugin-fnos-proxy';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  server: {
    // Tauri devUrl 写死 5173，vite 不能悄悄跳到 5174，否则 webview 加载错地址导致白屏。
    // strictPort=true：5173 被占就直接报错，提醒去杀僵尸进程，比静默白屏友好。
    port: 5173,
    strictPort: true,
    proxy: {
      // 用 127.0.0.1 而不是 localhost：macOS 上 localhost 会优先解析到 ::1，
      // 而后端默认只监听 IPv4（*:3000），代理会直接 Connection refused。
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // ⚠️ 播放流转 / 在线设备列表全靠这条 WS 长连接。
      // 之前只代理了 /api，dev 模式下 socket.io 请求 /socket.io/ 会落到 Vite 的
      // SPA fallback（或 404）→ WS 永远连不上 → 设备不注册、transfer_session 必然失败。
      // 必须显式代理并开 ws:true，否则 WebSocket 升级握手不会转发。
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  plugins: [
    react(),
    svgr(),
    // 飞牛网关没有 CORS，web 端由 dev server 代转并补 Cookie: mode=relay
    fnosProxyPlugin(),
  ],
})
