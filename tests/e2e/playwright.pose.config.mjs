import { fileURLToPath } from 'node:url';
import { getInstalledBrowsers } from '@puppeteer/browsers';
import { defineConfig } from '@playwright/test';
import { reuseRequested, resolvePort } from './support/port.mjs';

// The live pose tracking spec (#947): a web build with the feature flag on (EXPO_PUBLIC_POSE_TRACKING=1, compiled in) served
// under the real CSP, and Chromium with a fake camera. Separate from playwright.config.mjs because the default build has the
// flag off. Run with `npm run test:pose` (README.md, "Pose tracking test").
async function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.CI) throw new Error('CHROME_PATH is not set: the CI step that installs Chromium failed or was skipped.');
  const [installed] = await getInstalledBrowsers({ cacheDir: fileURLToPath(new URL('./.chromium/', import.meta.url)) });
  if (installed) return installed.executablePath;
  throw new Error('No Chromium found. Run `npm run install:chromium` or set CHROME_PATH (see tests/e2e/README.md).');
}
const chrome = await findChromium();
const port = await resolvePort({ fallback: process.env.CI ? 4175 : undefined });

export default defineConfig({
  testDir: './pose-specs',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1, // the fake camera and the model are heavy: one at a time
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  webServer: {
    command: 'node support/server.mjs',
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: reuseRequested(),
    env: { E2E_PORT: String(port), E2E_DIST: '.pose-dist' },
  },
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    viewport: { width: 390, height: 800 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
    permissions: ['camera'],
    launchOptions: {
      executablePath: chrome,
      // A synthetic video stream instead of a real camera, and no permission prompt.
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
    trace: 'retain-on-failure',
  },
});
