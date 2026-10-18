import { fileURLToPath } from 'node:url';
import { getInstalledBrowsers } from '@puppeteer/browsers';
import { defineConfig } from '@playwright/test';
import { BARCODE, writeBarcodeClip } from './support/ean13-video.mjs';
import { reuseRequested, resolvePort } from './support/port.mjs';

// The web barcode scanner spec (#944): a web build with the feature flag on (EXPO_PUBLIC_BARCODE_SCAN=1, compiled in) served under the
// real CSP, and Chromium with a fake camera that shows one EAN-13 barcode. Separate from playwright.config.mjs because the default build
// has the flag off. Run with `npm run test:barcode` (README.md, "Barcode scanner test").
async function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.CI) throw new Error('CHROME_PATH is not set: the CI step that installs Chromium failed or was skipped.');
  const [installed] = await getInstalledBrowsers({ cacheDir: fileURLToPath(new URL('./.chromium/', import.meta.url)) });
  if (installed) return installed.executablePath;
  throw new Error('No Chromium found. Run `npm run install:chromium` or set CHROME_PATH (see tests/e2e/README.md).');
}
const chrome = await findChromium();
const port = await resolvePort({ fallback: process.env.CI ? 4176 : undefined });
const clip = writeBarcodeClip(BARCODE);

export default defineConfig({
  testDir: './barcode-specs',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1, // the fake camera and the wasm decoder: one at a time
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  webServer: {
    command: 'node support/server.mjs',
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: reuseRequested(),
    env: { E2E_PORT: String(port), E2E_DIST: '.barcode-dist' },
  },
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    viewport: { width: 390, height: 800 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
    permissions: ['camera'],
    launchOptions: {
      executablePath: chrome,
      // The clip instead of a real camera, and no permission prompt.
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${clip}`],
    },
    trace: 'retain-on-failure',
  },
});
