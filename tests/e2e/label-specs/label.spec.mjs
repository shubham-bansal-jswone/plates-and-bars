import { fileURLToPath } from 'node:url';
import { answerSetup, expect, label, test } from '../support/app.mjs';

// #1078: the web label-scan OCR engine (tesseract.js 7, self-hosted under /tesseract/) in a real browser, under the real
// Content-Security-Policy and COEP (support/server.mjs reads apps/mobile/public/_headers). The build has EXPO_PUBLIC_LABEL_SCAN=1. The
// test walks the user's path: Food, Add, Scan a nutrition label, Choose a photo (a committed synthetic label, see
// scripts/make-label-image.mjs), Read the label, and checks the review screen holds what was printed. The shared test fixture already fails
// a test on any Content-Security-Policy console message, any uncaught page error and any request to a host other than 127.0.0.1; this test
// also records every request itself, so "no third party" is asserted here and not only left to the fixture.

const IMAGE = fileURLToPath(new URL('../fixtures/nutrition-label.png', import.meta.url));

test('reading a label photo runs the self-hosted engine under the CSP and COEP, stays on our origin and caches nothing of it', async ({ page }) => {
  const seen = [];
  page.on('request', (r) => seen.push({ url: new URL(r.url()), method: r.method() }));
  // The worker is a Web Worker: its own requests (core, language data) are reported on the context too.
  page.context().on('request', (r) => seen.push({ url: new URL(r.url()), method: r.method(), worker: true }));

  await answerSetup(page, { days: 'None yet' });
  await label(page, 'Use these targets').click();
  await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible();
  // The lazy-loading guard: nothing of the engine is part of the first load.
  expect(seen.filter((r) => r.url.pathname.startsWith('/tesseract/') || /\/tesseract-engine-[^/]*\.js$/.test(r.url.pathname))).toEqual([]);

  await label(page, '+ Add to breakfast').click();
  await label(page, 'Scan the nutrition label on a pack to add a packaged food').click();
  await expect(page.getByRole('heading', { name: 'Scan a nutrition label' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await label(page, 'Choose a photo').click();
  await (await chooser).setFiles(IMAGE);
  await label(page, 'Read the label').click();

  // Recognised lines went through the parser: the review screen holds the numbers printed on the image (a per 100 g table).
  await expect(page.getByRole('heading', { name: 'Check the label' })).toBeVisible({ timeout: 90_000 });
  await expect(label(page, 'Calories (kcal)')).toHaveValue('389');
  await expect(label(page, 'Protein (g)')).toHaveValue('12.5');
  await expect(label(page, 'Carbs (g)')).toHaveValue('66');
  await expect(label(page, 'Fat (g)')).toHaveValue('7');

  // The engine's files came from /tesseract/ on our origin: worker, core and language data.
  const paths = [...new Set(seen.map((r) => r.url.pathname))];
  expect(paths.some((p) => /^\/tesseract\/js-[^/]+\/worker\.min\.js$/.test(p))).toBe(true);
  expect(paths.some((p) => /^\/tesseract\/core-[^/]+\/tesseract-core[^/]*\.wasm(\.js)?$/.test(p))).toBe(true);
  expect(paths.some((p) => /^\/tesseract\/tessdata-fast-[^/]+\/eng\.traineddata/.test(p))).toBe(true);
  // No request left the origin, and nothing but GET was made: the image and the text are never sent.
  const origin = new URL(page.url()).origin;
  for (const r of seen) if (r.url.protocol.startsWith('http')) expect(r.url.origin, `request to ${r.url}`).toBe(origin);
  expect(seen.filter((r) => r.url.protocol.startsWith('http') && r.method !== 'GET').map((r) => `${r.method} ${r.url.pathname}`)).toEqual([]);

  // Nothing of the engine is in the service worker cache (on demand only).
  const cached = await page.evaluate(async () => {
    const out = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
  expect(cached.filter((p) => p.startsWith('/tesseract/') || /\/tesseract-engine-[^/]*\.js$/.test(p))).toEqual([]);
});
