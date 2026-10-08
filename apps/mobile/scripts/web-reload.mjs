// Serves dist/ with the cross-origin isolation headers, completes setup in headless Chrome, reloads,
// (with the network off for the setup itself) and checks the stored profile survives (the app opens straight to Targets).
// Then starts today's workout, ticks a set, reloads and checks the ticked set came back from SQLite. Run `npx expo export --platform web` first.
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
  await page.waitForSelector(sel('Redo setup'), { timeout: 20000 }); // only Targets has it (the setup results also show 1,990 kcal)
  await page.waitForSelector(sel('1,990 kcal'), { timeout: 20000 });
  console.log('offline: setup completed and Targets shows 1,990 kcal with the network off');
  // The static export has no service worker or other offline cache for the app shell, so a reload while
  // offline cannot fetch index.html; that is expected and only logged. Persistence is asserted online below.
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  console.log('reload while offline:', offlineNavFailed ? 'page request failed (no offline cache), as expected' : 'page loaded');
  await page.setOfflineMode(false);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector(sel('Redo setup'), { timeout: 20000 });
  await page.waitForSelector(sel('1,990 kcal'), { timeout: 20000 });
  console.log('after reload: targets screen shows 1,990 kcal without setup (profile read back from SQLite)');
  // Workout: start today's session (the planned one, or the first other template on a rest day), tick a set.
  await click('Workout');
  const startLabel = await page.waitForSelector('[aria-label^="Start "]', { timeout: 20000 }).then((e) => e.evaluate((x) => x.getAttribute('aria-label')));
  await click(startLabel);
  const markLabel = await page.waitForSelector('[aria-label^="Mark "][aria-label$=" set 1 done"]', { timeout: 20000 }).then((e) => e.evaluate((x) => x.getAttribute('aria-label')));
  const exName = markLabel.slice('Mark '.length, -' set 1 done'.length);
  await type(`${exName} set 1 kg`, '40');
  await type(`${exName} set 1 reps`, '9');
  await click(markLabel);
  await page.waitForSelector(`${sel(markLabel)}[aria-checked="true"]`, { timeout: 20000 });
  console.log(`workout: started "${startLabel}", ticked ${exName} set 1 (40 kg x 9)`);
  await new Promise((r) => setTimeout(r, 3000)); // each edit is its own SQLite commit; let them all finish before the page goes away
  await page.reload({ waitUntil: 'load' });
  // A reload keeps the route, so the Workout tab is already open; open it only if the app landed elsewhere.
  const back = await page.waitForSelector(sel(markLabel), { timeout: 8000 }).catch(() => null);
  if (!back) await click('Workout');
  await page.waitForSelector(`${sel(markLabel)}[aria-checked="true"]`, { timeout: 20000 });
  const [kg, reps] = await Promise.all([`${exName} set 1 kg`, `${exName} set 1 reps`].map((l) => page.$eval(sel(l), (e) => e.value)));
  if (kg !== '40' || reps !== '9') throw new Error(`ticked set came back as ${kg} x ${reps}`);
  console.log('after reload: the ticked set persisted (40 kg x 9, done) and the session is still open');
  ok = true;
} catch (e) {
  console.error('FAILED:', e.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(ok ? 0 : 1);
