import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Open-source Chromium only: Playwright's own browser download is never used. CI installs Chromium with
// @puppeteer/browsers and sets CHROME_PATH; locally any Chromium/Chrome works (see README.md).
const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!chrome) throw new Error('No Chromium found. Set CHROME_PATH (see tests/e2e/README.md).');

const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './specs',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: 0, // a retry would hide flakiness; fix the test instead
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  webServer: {
    command: 'node support/server.mjs',
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(port) },
  },
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    viewport: { width: 390, height: 800 },
    acceptDownloads: true,
    launchOptions: { executablePath: chrome },
    trace: 'retain-on-failure',
  },
});
