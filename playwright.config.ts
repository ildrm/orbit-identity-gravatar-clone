import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    channel:
      process.env.PLAYWRIGHT_CHANNEL ??
      (process.platform === 'win32' &&
      existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
        ? 'chrome'
        : undefined),
    baseURL: process.env.TEST_WEB_ORIGIN ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'reports/e2e.json' }]],
});
