import { fileURLToPath } from 'node:url';
import { getInstalledBrowsers } from '@puppeteer/browsers';
import { defineConfig } from '@playwright/test';

// Open-source Chromium only: Playwright's own browser download is never used. CI installs Chromium with
// @puppeteer/browsers and sets CHROME_PATH (it must, CI fails without it). Locally CHROME_PATH wins, then the Chromium
// that `npm run install:chromium` put in .chromium; Google Chrome (proprietary) is not used.
async function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.CI) throw new Error('CHROME_PATH is not set: the CI step that installs Chromium failed or was skipped.');
  const [installed] = await getInstalledBrowsers({ cacheDir: fileURLToPath(new URL('./.chromium/', import.meta.url)) });
  if (installed) return installed.executablePath;
  throw new Error('No Chromium found. Run `npm run install:chromium` or set CHROME_PATH (see tests/e2e/README.md).');
}
const chrome = await findChromium();

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
    // The app formats numbers by locale (1,990 kcal) and picks the day by time zone: do not take them from the host.
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
    acceptDownloads: true,
    launchOptions: { executablePath: chrome },
    trace: 'retain-on-failure',
  },
});
