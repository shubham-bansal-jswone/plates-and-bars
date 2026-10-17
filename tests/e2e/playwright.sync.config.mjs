import { fileURLToPath } from 'node:url';
import { getInstalledBrowsers } from '@puppeteer/browsers';
import { defineConfig } from '@playwright/test';
import { API } from './support/sync.mjs';
import { reuseRequested, resolvePort } from './support/port.mjs';

// The sync tests: a real backend (tests/e2e/stack, docker compose) and a web build with its URL compiled in. Separate from
// playwright.config.mjs so the fast web suite never needs Docker. Run with `npm run test:sync` (README.md, "Sync tests").
async function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.CI) throw new Error('CHROME_PATH is not set: the CI step that installs Chromium failed or was skipped.');
  const [installed] = await getInstalledBrowsers({ cacheDir: fileURLToPath(new URL('./.chromium/', import.meta.url)) });
  if (installed) return installed.executablePath;
  throw new Error('No Chromium found. Run `npm run install:chromium` or set CHROME_PATH (see tests/e2e/README.md).');
}
const chrome = await findChromium();

// Not 4173: the API's CORS allow-list in stack/docker-compose.yml names this origin.
// E2E_SYNC_PORT=0 picks a free port, but then the API must be started with that origin in its CORS list.
const port = await resolvePort({ name: 'E2E_SYNC_PORT', fallback: 4174 });

export default defineConfig({
  testDir: './sync-specs',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1, // one account at a time; the specs share one backend
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  webServer: {
    command: 'node support/server.mjs',
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: reuseRequested(),
    // E2E_API_URL lets the static server allow this build's API origin in the CSP connect-src (the export is compiled
    // against it; apps/mobile/public/_headers names the production host instead).
    env: { E2E_PORT: String(port), E2E_DIST: '.sync-dist', E2E_API_URL: API },
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
