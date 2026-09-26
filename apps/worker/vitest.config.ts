import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    // 第一次重播要先用 webpack 打包 workflow，需要一點時間。
    testTimeout: 120_000,
  },
});
