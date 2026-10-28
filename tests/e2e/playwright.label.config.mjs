import { fileURLToPath } from 'node:url';
import { getInstalledBrowsers } from '@puppeteer/browsers';
import { defineConfig } from '@playwright/test';
import { reuseRequested, resolvePort } from './support/port.mjs';

// The web label-scan OCR spec (#1078): a web build with the feature flag on (EXPO_PUBLIC_LABEL_SCAN=1, compiled in) served under the real
// CSP and COEP. Separate from playwright.config.mjs because the default build has the flag off. Run with `npm run test:label`
// (README.md, "Label scan test").
async function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.CI) throw new Error('CHROME_PATH is not set: the CI step that installs Chromium failed or was skipped.');
  const [installed] = await getInstalledBrowsers({ cacheDir: fileURLToPath(new URL('./.chromium/', import.meta.url)) });
  if (installed) return installed.executablePath;
  throw new Error('No Chromium found. Run `npm run install:chromium` or set CHROME_PATH (see tests/e2e/README.md).');
}
const chrome = await findChromium();
const port = await resolvePort({ fallback: process.env.CI ? 4177 : undefined });

export default defineConfig({
  testDir: './label-specs',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1, // one wasm engine at a time
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  webServer: {
    command: 'node support/server.mjs',
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: reuseRequested(),
    env: { E2E_PORT: String(port), E2E_DIST: '.label-dist' },
  },
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    viewport: { width: 390, height: 800 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
    launchOptions: { executablePath: chrome },
    trace: 'retain-on-failure',
  },
});
