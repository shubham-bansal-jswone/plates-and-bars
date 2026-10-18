import { answerSetup, expect, label, test } from '../support/app.mjs';
import { BARCODE } from '../support/ean13-video.mjs';

// #944: the web barcode scanner (dev screen /barcode-dev), under the real Content-Security-Policy (support/server.mjs reads
// apps/mobile/public/_headers), with a fake camera showing one EAN-13. The build has EXPO_PUBLIC_BARCODE_SCAN=1. The scanner reads the
// digits and shows them; nothing is looked up, saved or sent. The shared test fixture already fails a test on any Content-Security-Policy
// console message, any uncaught page error and any request to a host other than 127.0.0.1; the tests below also record every request
// themselves, so "no third party" is asserted here and not only left to the fixture.

const READ = `${BARCODE} (EAN-13, EAN_13)`;

/** Consent and setup first (the app shows nothing else before them), landing on Food; then the scanner's dev screen. */
async function openScanner(page) {
  await answerSetup(page, { days: 'None yet' });
  await label(page, 'Use these targets').click();
  await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible();
  await page.goto('/barcode-dev');
  await expect(page.getByRole('heading', { name: 'Scan barcode' })).toBeVisible();
}

/** Every request the page makes, from the first navigation: url, method and, once it answers, the content type. */
function record(page) {
  const seen = [];
  page.on('request', (r) => seen.push({ url: new URL(r.url()), method: r.method(), type: null }));
  page.on('response', (res) => {
    const hit = seen.find((x) => x.url.href === res.url() && x.type === null);
    if (hit) hit.type = res.headers()['content-type'] ?? '';
  });
  return seen;
}

const chunks = (seen) => seen.map((r) => r.url.pathname).filter((p) => /\/zxing-decoder-[^/]*\.js$/.test(p));
const wasm = (seen) => seen.filter((r) => r.url.pathname.endsWith('.wasm') && r.url.pathname.startsWith('/zxing/'));

function expectOwnOriginOnly(seen, page) {
  const origin = new URL(page.url()).origin;
  for (const r of seen) expect(r.url.origin, `request to ${r.url}`).toBe(origin);
  // nothing but GET: no frame, no code, no reading is sent anywhere
  expect(seen.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url.pathname}`)).toEqual([]);
}

test('with no native BarcodeDetector it reads the code with zxing-wasm from our own origin, lazily, under the CSP', async ({ page }) => {
  // A browser whose own detector cannot read EAN-13 (Safari, Firefox, desktop Chrome on most systems): the ponyfill path.
  await page.addInitScript(() => {
    delete window.BarcodeDetector;
  });
  const seen = record(page);
  await answerSetup(page, { days: 'None yet' });
  await label(page, 'Use these targets').click();
  await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible();
  // The lazy-loading guard: the decoder chunk and the .wasm are not part of the app's first load or of any other screen.
  expect(chunks(seen)).toEqual([]);
  expect(wasm(seen)).toEqual([]);
  await page.goto('/barcode-dev');
  await expect(page.getByRole('heading', { name: 'Scan barcode' })).toBeVisible();
  await expect(page.locator('video[aria-label="Camera view for reading a barcode"]')).toBeVisible();
  await expect(page.getByText(READ)).toBeVisible({ timeout: 60_000 });
  // the chunk and the .wasm came from our origin, and the wasm was served as application/wasm
  expect(chunks(seen).length).toBeGreaterThan(0);
  const w = wasm(seen);
  expect(w.map((r) => r.url.pathname)).toContain('/zxing/3.1.3/zxing_reader.wasm');
  expect(w.find((r) => r.url.pathname === '/zxing/3.1.3/zxing_reader.wasm').type).toContain('application/wasm');
  expectOwnOriginOnly(seen, page);
  // nothing of the reader is in the service worker cache (on demand only)
  const cached = await page.evaluate(async () => {
    const out = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
  expect(cached.filter((p) => p.startsWith('/zxing/') || /\/zxing-decoder-[^/]*\.js$/.test(p))).toEqual([]);
});

test('with a native BarcodeDetector that lists ean_13 it uses it, and never loads the ponyfill or the wasm', async ({ page }) => {
  const seen = record(page);
  await openScanner(page);
  const formats = await page.evaluate(async () => (window.BarcodeDetector ? await window.BarcodeDetector.getSupportedFormats() : []));
  test.skip(!formats.includes('ean_13'), 'this Chromium has no native BarcodeDetector for EAN-13 (the other test covers the ponyfill)');
  await expect(page.getByText(READ)).toBeVisible({ timeout: 60_000 });
  expect(chunks(seen)).toEqual([]);
  expect(wasm(seen)).toEqual([]);
  expectOwnOriginOnly(seen, page);
});

test('the camera is released when the scanner closes, and "Scan again" reads again', async ({ page }) => {
  await page.addInitScript(() => {
    delete window.BarcodeDetector;
    // count the live camera tracks, to see the camera go off
    window.__live = 0;
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await real(c);
      for (const t of s.getTracks()) {
        window.__live++;
        const stop = t.stop.bind(t);
        t.stop = () => {
          window.__live--;
          stop();
        };
      }
      return s;
    };
  });
  await openScanner(page);
  await expect(page.getByText(READ)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Scan again' }).click();
  await expect(page.getByText(READ)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => page.evaluate(() => window.__live)).toBe(0);
});

test('a refused camera says so and the typed number path works, with a bad check digit refused', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  });
  const seen = record(page);
  await openScanner(page);
  await expect(page.getByText('Camera is off for Plate & Bar. Type the barcode instead.')).toBeVisible();
  const field = page.getByLabel('Barcode number');
  await field.fill('5000112637923');
  await page.getByRole('button', { name: 'Use this number' }).click();
  await expect(page.getByText('That number does not look right. Check the digits on the pack.')).toBeVisible();
  await field.fill(BARCODE);
  await page.getByRole('button', { name: 'Use this number' }).click();
  await expect(page.getByText(`${BARCODE} (EAN-13, typed)`)).toBeVisible();
  expect(chunks(seen)).toEqual([]);
  expectOwnOriginOnly(seen, page);
});

test('from the Add sheet: the Scan barcode button reads the code, and with no server the lookup says offline and offers Enter by hand (no request leaves the page)', async ({ page }) => {
  await page.addInitScript(() => {
    delete window.BarcodeDetector;
  });
  const seen = record(page);
  await answerSetup(page, { days: 'None yet' });
  await label(page, 'Use these targets').click();
  await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible();
  await label(page, '+ Add to breakfast').click();
  await label(page, 'Scan a barcode to add a packaged food').click();
  // this build has no server (no sign-in, no API address): the lookup is not even tried, and the way out is the Custom form with the code
  await expect(page.getByText('No connection. Try again when you are online, or enter it by hand.')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Enter by hand' }).click();
  await expect(page.getByText(`Barcode saved with this food: ${BARCODE}`)).toBeVisible();
  expect(seen.filter((r) => r.url.pathname.includes('/foods/barcode/'))).toEqual([]);
  expectOwnOriginOnly(seen, page);
});
