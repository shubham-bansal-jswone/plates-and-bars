// Serves dist/ with the cross-origin isolation headers, completes setup in headless Chrome, reloads,
// (with the network off for the setup itself) and checks the stored profile survives (the app opens straight to Targets).
// Then starts today's workout, ticks a set, reloads and checks the ticked set came back from SQLite; logs food and a +300 flex the same way. Run `npx expo export --platform web` first.
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

// The app's SQLite file lives in the origin's private file system; its size and modified time change when a write lands.
const opfsStamp = (page) =>
  page.evaluate(async () => {
    const out = [];
    const walk = async (dir, path) => {
      for await (const [name, h] of dir.entries()) {
        if (h.kind === 'directory') await walk(h, `${path}${name}/`);
        else {
          const f = await h.getFile();
          out.push(`${path}${name}:${f.size}:${f.lastModified}`);
        }
      }
    };
    await walk(await navigator.storage.getDirectory(), '/');
    return out.sort().join('|');
  });
// Resolves once storage differs from `before` and has stayed the same for 500 ms (the write queue is idle).
async function savedSince(page, before, timeout = 15000) {
  const end = Date.now() + timeout;
  let last = before;
  let since = Date.now();
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 100));
    const now = await opfsStamp(page);
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (now !== before && Date.now() - since >= 500) return;
  }
  throw new Error('the write never reached storage');
}

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
  const startLabel = await page.waitForSelector('[aria-label^="Start "]:not([aria-label^="Start a rest"])', { timeout: 20000 }).then((e) => e.evaluate((x) => x.getAttribute('aria-label')));
  await click(startLabel);
  const markLabel = await page.waitForSelector('[aria-label^="Mark "][aria-label$=" set 1 done"]', { timeout: 20000 }).then((e) => e.evaluate((x) => x.getAttribute('aria-label')));
  const exName = markLabel.slice('Mark '.length, -' set 1 done'.length);
  // Assisted lifts label the weight field differently (e.g. "assist kg"), so take the set's two inputs by position.
  const setInputs = () => page.$$(`input[aria-label^="${exName} set 1 "]`);
  const [wIn, rIn] = await setInputs();
  await wIn.type('40');
  await rIn.type('9');
  await click(markLabel);
  await page.waitForSelector(`${sel(markLabel)}[aria-checked="true"]`, { timeout: 20000 });
  console.log(`workout: started "${startLabel}", ticked ${exName} set 1 (40 kg x 9)`);
  await new Promise((r) => setTimeout(r, 3000)); // each edit is its own SQLite commit; let them all finish before the page goes away
  await page.reload({ waitUntil: 'load' });
  // A reload keeps the route, so the Workout tab is already open; open it only if the app landed elsewhere.
  const back = await page.waitForSelector(sel(markLabel), { timeout: 8000 }).catch(() => null);
  if (!back) await click('Workout');
  await page.waitForSelector(`${sel(markLabel)}[aria-checked="true"]`, { timeout: 20000 });
  const [kg, reps] = await Promise.all((await setInputs()).slice(0, 2).map((e) => e.evaluate((x) => x.value)));
  if (kg !== '40' || reps !== '9') throw new Error(`ticked set came back as ${kg} x ${reps}`);
  console.log('after reload: the ticked set persisted (40 kg x 9, done) and the session is still open');
  // Food: log a roti under breakfast and tick "logged everything", reload, check both came back from SQLite.
  await click('Food');
  await click('+ Add to breakfast');
  await (await page.waitForSelector('[aria-label^="Add Roti / chapati"]', { timeout: 20000 })).evaluate((e) => e.click());
  await page.waitForSelector(sel('Done'), { timeout: 20000 });
  await click('Done');
  await page.waitForSelector(sel('102 of 1,990 kcal eaten'), { timeout: 20000 });
  await click('I’ve logged everything I ate today');
  await page.waitForSelector(`${sel('I’ve logged everything I ate today')}[aria-checked="true"]`, { timeout: 20000 });
  console.log('food: logged Roti / chapati (102 kcal) and ticked "logged everything"');
  await new Promise((r) => setTimeout(r, 3000));
  await page.reload({ waitUntil: 'load' });
  const food = await page.waitForSelector(sel('102 of 1,990 kcal eaten'), { timeout: 8000 }).catch(() => null);
  if (!food) {
    await click('Food');
    await page.waitForSelector(sel('102 of 1,990 kcal eaten'), { timeout: 20000 });
  }
  await page.waitForSelector(`${sel('I’ve logged everything I ate today')}[aria-checked="true"]`, { timeout: 20000 });
  console.log('after reload: the food log and the "logged everything" tick persisted');
  // Flex: plan a bigger day (+300), reload, the target still includes it.
  const before = await opfsStamp(page);
  await click('Plan a bigger day');
  await click('+300 kcal today');
  await page.waitForSelector(sel('102 of 2,290 kcal eaten'), { timeout: 20000 });
  console.log('flex: +300 kcal today raised the target to 2,290');
  await savedSince(page, before); // wait for the write to reach storage instead of sleeping
  await page.reload({ waitUntil: 'load' });
  const flexed = await page.waitForSelector(sel('102 of 2,290 kcal eaten'), { timeout: 8000 }).catch(() => null);
  if (!flexed) {
    await click('Food');
    await page.waitForSelector(sel('102 of 2,290 kcal eaten'), { timeout: 20000 });
  }
  console.log('after reload: today\u2019s target still includes the +300 flex (2,290 kcal)');
  // Progress: log a weight, reload, it is still there.
  await click('Progress');
  await type('Weight in kg', '81.6');
  const wBefore = await opfsStamp(page);
  await click('Save weight');
  await page.waitForSelector(sel('Latest weigh-in 81.6 kg'), { timeout: 20000 });
  console.log('progress: logged a 81.6 kg weigh-in');
  await savedSince(page, wBefore);
  await page.reload({ waitUntil: 'load' });
  const weighed = await page.waitForSelector(sel('Latest weigh-in 81.6 kg'), { timeout: 8000 }).catch(() => null);
  if (!weighed) {
    await click('Progress');
    await page.waitForSelector(sel('Latest weigh-in 81.6 kg'), { timeout: 20000 });
  }
  console.log('after reload: the 81.6 kg weigh-in persisted');
  ok = true;
} catch (e) {
  console.error('FAILED:', e.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(ok ? 0 : 1);
