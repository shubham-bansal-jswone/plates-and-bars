// Screenshots of Setup, Targets, Workout and Food at 390 px, light and dark, from the web export in dist/.
// Usage: node scripts/screenshots.mjs <out-dir> <prefix>   (run `npx expo export --platform web` first; needs local Chrome, CHROME_PATH to override)
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from 'puppeteer-core';

const [outDir = 'screenshots', prefix = 'shot'] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf' };
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p));
if (!chrome) { console.error('No Chrome/Chromium found. Set CHROME_PATH.'); process.exit(2); }
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
  let body; let type;
  try { const f = p === '/' ? '/index.html' : p; body = await readFile(join(root, f)); type = types[extname(f)] ?? 'application/octet-stream'; }
  catch { body = await readFile(join(root, 'index.html')); type = types['.html']; }
  res.writeHead(200, { ...headers, 'content-type': type }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
let ok = false;
try {
  for (const mode of ['light', 'dark']) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 390, height: 844 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: mode }]);
    const sel = (l) => `[aria-label="${l}"]`;
    const click = async (l) => (await page.waitForSelector(sel(l), { timeout: 30000 })).evaluate((e) => e.click());
    const type = async (l, v) => (await page.waitForSelector(sel(l), { timeout: 30000 })).type(v);
    const shot = async (name) => {
      await page.evaluate(() => document.fonts.ready);
      await new Promise((r) => setTimeout(r, 600));
      await page.screenshot({ path: join(outDir, `${prefix}-${name}-${mode}.png`), fullPage: true });
    };
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForSelector('[aria-label="Continue"]', { timeout: 30000 });
    await click('I understand and agree to my data being stored as described');
    await shot('setup');
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
    for (const el of await page.$$('[role="radiogroup"]')) { const no = await el.$('[aria-label="No"]'); if (no) await no.evaluate((e) => e.click()); }
    await click('See my targets');
    await click('Use these targets');
    await page.waitForSelector(sel('Redo setup'), { timeout: 30000 });
    await shot('targets');
    await click('Workout');
    const start = await page.waitForSelector('[aria-label^="Start "]:not([aria-label^="Start a rest"])', { timeout: 30000 }).then((e) => e.evaluate((x) => x.getAttribute('aria-label')));
    await click(start);
    const mark = await page.waitForSelector('[aria-label^="Mark "][aria-label$=" set 1 done"]', { timeout: 30000 }).then((e) => e.evaluate((x) => x.getAttribute('aria-label')));
    const ex = mark.slice(5, -' set 1 done'.length);
    const [wIn, rIn] = await page.$$(`input[aria-label^="${ex} set 1 "]`);
    await wIn.type('40');
    await rIn.type('9');
    await click(mark);
    await shot('workout');
    await click('Food');
    await click('+ Add to breakfast');
    await (await page.waitForSelector('[aria-label^="Add Roti / chapati"]', { timeout: 30000 })).evaluate((e) => e.click());
    await click('Done');
    await page.waitForSelector(sel('102 of 1,990 kcal eaten'), { timeout: 30000 });
    await shot('food');
    await ctx.close();
  }
  ok = true;
} catch (e) { console.error('FAILED:', e.message); for (const pg of await browser.pages()) await pg.screenshot({ path: join(outDir, 'debug.png') }).catch(() => {}); }
finally { await browser.close(); server.close(); }
process.exit(ok ? 0 : 1);
