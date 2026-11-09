import { defineConfig, devices } from '@playwright/test';
import { E2E, WEB_URL } from './env.js';

/**
 * E2E: настоящий сервер, настоящий клиент (Vite) и отдельная база. Сценарии гоняют два браузера
 * одновременно — требование «работает при двух одновременно открытых клиентах».
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'report' }]] : 'list',
  use: { baseURL: WEB_URL, trace: 'off', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node --experimental-strip-types --no-warnings e2e/prepare-db.ts && pnpm --filter @se/server start',
      cwd: '..',
      url: `http://localhost:${String(E2E.apiPort)}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(E2E.apiPort),
        DATABASE_URL: E2E.databaseUrl,
        WEB_ORIGIN: WEB_URL,
        UPLOAD_DIR: '/tmp/shared-expenses-e2e-uploads',
      },
    },
    {
      command: 'pnpm --filter @se/web dev',
      cwd: '..',
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { WEB_PORT: String(E2E.webPort), API_TARGET: `http://localhost:${String(E2E.apiPort)}` },
    },
  ],
});
