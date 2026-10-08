// Serves dist/ with the cross-origin isolation headers, completes setup in headless Chrome, reloads,
// (with the network off for the setup itself) and checks the stored profile survives (the app opens straight to Targets). Run `npx expo export --platform web` first.
// Needs a local Chrome/Chromium (set CHROME_PATH if not found).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from 'puppeteer-core';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((p) => p && existsSync(p));
if (!chrome) {
  console.error('No Chrome/Chromium found. Set CHROME_PATH.');
  process.exit(2);
}

const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
  let body;
  let type;
  try {
    const file = p === '/' ? '/index.html' : p;
    body = await readFile(join(root, file));
    type = types[extname(file)] ?? 'application/octet-stream';
  } catch {
    body = await readFile(join(root, 'index.html')); // single-page fallback, as Cloudflare Pages does
    type = types['.html'];
  }
  res.writeHead(200, { ...headers, 'content-type': type }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
let ok = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 800 });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  const sel = (l) => `[aria-label="${l}"]`;
  const click = async (l) => {
    const el = await page.waitForSelector(sel(l), { timeout: 20000 });
    await el.evaluate((e) => e.click());
  };
  const type = async (l, v) => {
    const el = await page.waitForSelector(sel(l), { timeout: 20000 });
    await el.type(v);
  };
  page.on('console', (m) => m.type() === 'error' && console.log('console.error:', m.text().slice(0, 300)));
  let offlineNavFailed = false;
  page.on('requestfailed', (r) => {
    if (r.isNavigationRequest() && r.failure()?.errorText === 'net::ERR_INTERNET_DISCONNECTED') offlineNavFailed = true;
  });
  // The app redirects to /setup while loading, which Chrome reports as an aborted first navigation.
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForSelector('[aria-label="Continue"]', { timeout: 30000 });
  console.log('crossOriginIsolated:', await page.evaluate(() => crossOriginIsolated));
  // Offline first: after the first load the whole setup flow runs with the network off.
  await page.setOfflineMode(true);
  await click('I understand and agree to my data being stored as described');
  await click('Continue');
  await click('Male');
  await type('Age', '30');
  await click('Use cm');
  await type('Height in cm', '165');
  await type('Weight in kg', '82');
  await click('Continue');
  await click('Mostly sitting. Desk job, little walking (under ~5,000 steps)');
  await click('Continue');
  await click('6');
  await click('At a gym. Machines, cables, barbells and dumbbells');
  await click('Some experience. 6 months to 2 years of regular training');
  await click('60 min');
  await click('Continue');
  await click('Lose fat. Steady fat loss while keeping muscle');
  for (const el of await page.$$('[role="radiogroup"]')) {
    const no = await el.$('[aria-label="No"]');
    if (no) await no.evaluate((e) => e.click());
  }
  await click('See my targets');
  await click('Use these targets');
  await page.waitForSelector(sel('1,990 kcal'), { timeout: 20000 });
  console.log('offline: setup completed and Targets shows 1,990 kcal with the network off');
  // The static export has no service worker or other offline cache for the app shell, so a reload while
  // offline cannot fetch index.html; that is expected and only logged. Persistence is asserted online below.
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  console.log('reload while offline:', offlineNavFailed ? 'page request failed (no offline cache), as expected' : 'page loaded');
  await page.setOfflineMode(false);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector(sel('1,990 kcal'), { timeout: 20000 });
  console.log('after reload: targets screen shows 1,990 kcal without setup (profile read back from SQLite)');
  ok = true;
} catch (e) {
  console.error('FAILED:', e.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(ok ? 0 : 1);
