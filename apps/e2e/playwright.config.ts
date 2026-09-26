import { defineConfig, devices } from '@playwright/test';

// 與 api、seed:admin 讀同一份 .env：Administrator 的帳號（SEED_ADMIN_*）用來建立 smoke 用的 Participant。
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // 沒有 .env 時改用環境變數（見 tests/support/env.ts）。
}

/**
 * Playwright smoke：對已經啟動的完整環境（Docker Compose + api、worker、web）執行，不自行啟動任何服務。
 * 預設是 Caddy 的 http://localhost:8000；E2E_BASE_URL 可以指向其他網址。啟動方式見 docs/testing.md。
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8000',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
