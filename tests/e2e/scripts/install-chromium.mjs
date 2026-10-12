// Installs open-source Chromium (BSD-3-Clause) into tests/e2e/.chromium with @puppeteer/browsers (Apache-2.0),
// so the suite never needs Playwright's own browser download. playwright.config.mjs finds it there.
import { fileURLToPath } from 'node:url';
import { Browser, detectBrowserPlatform, install, resolveBuildId } from '@puppeteer/browsers';

const cacheDir = fileURLToPath(new URL('../.chromium/', import.meta.url));
const platform = detectBrowserPlatform();
const buildId = await resolveBuildId(Browser.CHROMIUM, platform, 'latest');
const { executablePath } = await install({ browser: Browser.CHROMIUM, buildId, cacheDir });
console.log(executablePath);
