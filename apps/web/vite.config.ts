import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // 直接吃 workspace package 的 TypeScript 原始碼，不需要先 build。
    conditions: ['source', ...defaultClientConditions],
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Caddy 在容器裡，要透過 host.docker.internal 連到這個 dev server。
    host: true,
    // 與 Caddy 相同：/api 轉給 api，其餘由 web 提供，瀏覽器看到的是同一個 origin。
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
});
