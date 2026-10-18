import { answerSetup, expect, label, saved, tab, test } from '../support/app.mjs';

// #947: live pose tracking on the web, under the real Content-Security-Policy (support/server.mjs reads apps/mobile/public/_headers),
// with a fake camera. The build has EXPO_PUBLIC_POSE_TRACKING=1. The fake stream shows no person, so the model runs on real frames
// and finds nobody: the screen says "Not tracked" and no rep is counted. The count, depth, tempo and apply flow with a person in
// view are covered by the jest tests (a scripted model); this spec is about the browser: the CSP, the origins, the files, the cache.
// The shared test fixture already fails a test on any Content-Security-Policy console message, any uncaught page error and any
// request to a host other than 127.0.0.1.

async function openTracker(page, requests) {
  await answerSetup(page, { days: 'None yet' });
  await label(page, 'Use these targets').click();
  await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible();
  await tab(page, 'Workout');
  // the service worker caches the shell on the first visit: wait for it, so "not cached" below means something
  await expect
    .poll(() =>
      page.evaluate(async () => {
        for (const k of await caches.keys()) if ((await (await caches.open(k)).keys()).length > 3) return true;
        return false;
      }),
    )
    .toBe(true);
  await label(page, 'Pick exercises').click();
  await saved(page, () => label(page, 'Add Goblet Squat').click());
  // The lazy-loading guard: the requests are recorded from the first navigation, so a static import (which would put TF.js in the
  // main bundle) shows up here as a chunk fetched too early.
  const chunks = () => requests.map((r) => r.url.pathname).filter((p) => /\/pose-(session|detector)-[^/]*\.js$/.test(p));
  expect(chunks()).toEqual([]);
  await label(page, 'Track this set of Goblet Squat').click();
  await expect(page.locator('[role="dialog"][aria-label="Track this set"]')).toBeVisible();
  await expect(label(page, 'Start camera')).toBeVisible();
  // the sheet loads the camera view chunk, and only that: the model chunk waits for "Start camera"
  expect(chunks().some((p) => /\/pose-session-/.test(p))).toBe(true);
  expect(chunks().some((p) => /\/pose-detector-/.test(p))).toBe(false);
}

/** Every same-origin request the page makes, with its method. */
function recordRequests(page) {
  const seen = [];
  page.on('request', (r) => seen.push({ url: new URL(r.url()), method: r.method() }));
  return seen;
}

async function cachedPaths(page) {
  return page.evaluate(async () => {
    const out = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
}

async function runSet(page, requests) {
  await expect(page.getByText('The camera view stays on this phone. Nothing is recorded or sent.')).toBeVisible();
  // Nothing of the model (weights, .wasm files, its chunk) has been requested before the user starts the camera.
  const before = requests.map((r) => r.url.pathname);
  expect(before.filter((p) => /\/pose\//.test(p) || /pose-detector/.test(p))).toEqual([]);
  requests.startedAt = requests.length;
  await label(page, 'Start camera').click();
  await expect(page.getByText(/Get in position\. Starting in \d\./)).toBeVisible();
  // 5 s countdown, then tracking runs on the fake frames
  await expect(label(page, 'Finish set')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('No reps yet')).toBeVisible();
  // the model ran on real frames: with nobody in them the screen says so
  await expect(page.getByText(/Not tracked: your hips and legs were out of view/)).toBeVisible({ timeout: 60_000 });
  const video = page.locator('video[aria-label="Camera view"]');
  await expect(video).toBeVisible();
  expect(await video.evaluate((v) => v.videoWidth > 0 && !v.paused)).toBe(true);
  await label(page, 'Finish set').click();
  await expect(page.getByText('No reps counted.')).toBeVisible();
  // the camera is off as soon as the set ends
  await expect(video).toHaveCount(0);
  await label(page, 'Close').click();
  await expect(page.locator('[role="dialog"][aria-label="Track this set"]')).toHaveCount(0);
}

function expectOwnOriginOnly(all, page) {
  const requests = all.slice(all.startedAt); // from the moment the camera started
  const origin = new URL(page.url()).origin;
  for (const r of requests) expect(r.url.origin, `request to ${r.url}`).toBe(origin);
  const pose = requests.filter((r) => r.url.pathname.startsWith('/pose/'));
  const paths = pose.map((r) => r.url.pathname);
  expect(paths).toContain('/pose/movenet-lightning/model.json');
  expect(paths).toContain('/pose/movenet-lightning/group1-shard1of2.bin');
  expect(paths).toContain('/pose/movenet-lightning/group1-shard2of2.bin');
  // no frame or reading is sent anywhere: nothing but GET after the camera started
  expect(requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url.pathname}`)).toEqual([]);
  return paths;
}

test('the pose screen loads under the real CSP, uses only our own origin, and caches nothing of it', async ({ page }) => {
  const requests = recordRequests(page);
  await openTracker(page, requests);
  await runSet(page, requests);
  expectOwnOriginOnly(requests, page);
  // not precached, not stored by the service worker: neither the weights, the .wasm files nor the pose chunks
  const cached = await cachedPaths(page);
  expect(cached.filter((p) => p.startsWith('/pose/') || /\/pose-[^/]*\.js$/.test(p))).toEqual([]);
  expect(cached.length).toBeGreaterThan(3); // the shell is cached, so the check above is not vacuous
});

test('with WebGL unavailable it falls back to single-thread WASM from our origin, with no blob: script', async ({ page }) => {
  await page.addInitScript(() => {
    // TensorFlow.js asks a canvas or an OffscreenCanvas for a WebGL context: refuse both
    for (const C of [HTMLCanvasElement, window.OffscreenCanvas]) {
      if (!C) continue;
      const real = C.prototype.getContext;
      C.prototype.getContext = function (type, ...rest) {
        return /webgl/i.test(String(type)) ? null : real.call(this, type, ...rest);
      };
    }
    // a multi-threaded WASM start-up would create workers from a blob: script, which the CSP blocks: count them
    // (the app's own SQLite worker is one, and starts before the camera does)
    window.__blobWorkers = 0;
    const W = window.Worker;
    window.Worker = class extends W {
      constructor(url, ...rest) {
        if (String(url).startsWith('blob:')) window.__blobWorkers++;
        super(url, ...rest);
      }
    };
  });
  const requests = recordRequests(page);
  await openTracker(page, requests);
  const workersBefore = await page.evaluate(() => window.__blobWorkers);
  await runSet(page, requests);
  const paths = expectOwnOriginOnly(requests, page);
  // Do not "simplify" the next two lines away: they are the real guard against the multi-threaded WASM backend. The console CSP check
  // in the shared fixture does not catch it (checked by mutation: with the threaded build and these lines removed, the spec passes).
  expect(paths.filter((p) => p.startsWith('/pose/wasm/') && p.endsWith('.wasm')).length).toBeGreaterThan(0);
  expect(paths.some((p) => p.includes('threaded'))).toBe(false);
  expect(await page.evaluate(() => window.__blobWorkers)).toBe(workersBefore);
});
