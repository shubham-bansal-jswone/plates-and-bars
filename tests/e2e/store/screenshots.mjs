// On-demand generator for the Google Play phone screenshots (#833). Not a Playwright spec and not part of CI.
//   cd tests/e2e && npm ci && npm run install:chromium
//   (cd ../../apps/mobile && EXPO_NO_TELEMETRY=1 npx expo export --platform web)
//   npm run store:screenshots            # writes docs/store/phone-*.png
// It serves the web export on a free port, opens it at a 360x640 phone viewport at 3x (1080x1920), light theme, with the
// clock pinned, answers setup, then logs the made-up demo data in store/demo-seed.json through the UI. Nothing leaves 127.0.0.1.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { getInstalledBrowsers } from '@puppeteer/browsers';
import { answerSetup, label, tab, trackDbWrites, saved } from '../support/app.mjs';
import { freePort } from '../support/port.mjs';

const seed = JSON.parse(readFileSync(new URL('./demo-seed.json', import.meta.url), 'utf8'));
const outDir = process.env.STORE_OUT ?? fileURLToPath(new URL('../../../docs/store/', import.meta.url));
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

async function chromiumPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const [installed] = await getInstalledBrowsers({ cacheDir: here('../.chromium/') });
  if (installed) return installed.executablePath;
  throw new Error('No Chromium found. Run `npm run install:chromium` or set CHROME_PATH.');
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [here('../support/server.mjs')], { env: { ...process.env, E2E_PORT: String(port), E2E_PORT_RESOLVED: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`web server exited with ${code}; is apps/mobile/dist exported?`)));
    child.stdout.on('data', (d) => /serving/.test(String(d)) && resolve());
  });
  return { child, url: `http://127.0.0.1:${port}/` };
}

// Every scroll container back to the top (a screen keeps its scroll position after the logging above).
const top = (page) =>
  page.evaluate(() => {
    document.activeElement?.blur?.();
    for (const e of document.querySelectorAll('*')) if (e.scrollTop || e.scrollLeft) (e.scrollTop = 0), (e.scrollLeft = 0); // overflow:hidden wrappers ignore scrollTo()
  });
// Puts a heading or label at the top of the viewport (the screen's own scroll container moves).
const showText = (page, text, margin = 24) =>
  page.getByText(text, { exact: true }).first().evaluate((el, margin) => { el.style.scrollMarginTop = `${margin}px`; el.scrollIntoView({ block: 'start' }); }, margin);

// Food, Workout and Progress each keep a date bar mounted, so the label repeats. The role query skips the hidden screens;
// the click is dispatched because the stack's inert wrapper makes Playwright's hit test see another screen on top.
const step = (page, name) => page.getByRole('button', { name, exact: true }).dispatchEvent('click');

const MEALS = ['breakfast', 'lunch', 'snacks', 'dinner'];

async function logDay(page, day) {
  for (const meal of MEALS) {
    const foods = day.meals[meal] ?? [];
    if (!foods.length) continue;
    await label(page, `+ Add to ${meal}`).click();
    await saved(page, async () => {
      for (const food of foods) await page.locator(`[aria-label^=${JSON.stringify(`${food} `)}]`).first().click();
      await label(page, 'Done').click();
    });
  }
  for (let i = 0; i < day.glasses; i++) await saved(page, () => label(page, 'Add a glass, 250 millilitres').click());
}

async function weigh(page, kg) {
  await tab(page, 'Progress');
  await label(page, 'Weight in kg').fill(kg);
  await saved(page, () => label(page, 'Save weight').click());
  await tab(page, 'Food');
  await top(page);
}

// The server starts inside the try, so a failed browser launch (or anything after) still stops it.
let server;
let browser;
try {
  browser = await chromium.launch({ executablePath: await chromiumPath() });
  server = await startServer();
  const context = await browser.newContext({
    baseURL: server.url,
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 3, // 360x640 css px at 3x is 1080x1920
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
  });
  // Like the e2e suite: only 127.0.0.1 is reachable.
  await context.route((url) => url.host !== new URL(server.url).host && url.protocol.startsWith('http'), (route) => route.abort());
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(seed.clock));
  await page.addInitScript(trackDbWrites);

  await answerSetup(page, { age: seed.setup.age, days: seed.setup.days });
  await label(page, 'Use these targets').click();
  await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible();

  // Earlier days, newest last, so the Seven days chart and the weight trend have something to show.
  for (let i = 0; i < seed.history.length; i++) await step(page, 'Previous day');
  for (const day of seed.history) {
    await logDay(page, day);
    await weigh(page, day.weightKg);
    await step(page, 'Next day');
  }
  await logDay(page, seed.today);
  await weigh(page, seed.today.weightKg);

  mkdirSync(outDir, { recursive: true });
  const shot = async (name, heading, margin) => {
    await top(page);
    if (heading) await showText(page, heading, margin);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log(`wrote ${name}.png`);
  };

  await tab(page, 'Food');
  await page.evaluate(() => document.activeElement?.blur?.());
  // Starts at the big number so the macro bars, the next-meal card and the whole Estimated burn card (with Details) fit.
  await shot('phone-1-food', 'kcal left', 125);

  await tab(page, 'Workout');
  await page.locator('[aria-label^="Start "]:not([aria-label^="Start a rest"])').first().click();
  const marks = page.locator('[aria-label^="Mark "][aria-label$=" done"]');
  const first = await marks.first().getAttribute('aria-label');
  const exercise = first.slice('Mark '.length).replace(/ set \d+ done$/, '');
  for (let n = 1; n <= seed.workout.setsToTick; n++) {
    const inputs = page.locator(`input[aria-label^=${JSON.stringify(`${exercise} set ${n} `)}]`);
    await inputs.nth(0).fill(seed.workout.weightKg);
    await inputs.nth(1).fill(seed.workout.reps);
    await saved(page, () => label(page, `Mark ${exercise} set ${n} done`).click());
  }
  await page.getByText('Skip', { exact: true }).click(); // dismiss the rest timer the last tick started
  await expect(page.getByText('Skip', { exact: true })).toBeHidden();
  await shot('phone-2-workout', exercise);

  await tab(page, 'Progress');
  await expect(page.getByText('Weight saved')).toBeHidden(); // the toast from the last weigh-in
  await shot('phone-3-progress', 'Body weight');

  await tab(page, 'Targets');
  await shot('phone-4-targets');
} catch (e) {
  // A picture of where it failed, outside the repo (docs/store holds only the final images).
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: `${tmpdir()}/store-screenshots-debug.png` }).catch(() => {});
  throw e;
} finally {
  await browser?.close();
  server?.child.kill();
}
