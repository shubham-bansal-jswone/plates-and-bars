import { completeSetup, expect, label, test } from '../support/app.mjs';

// #718: a cold reload with no network starts the app from the service worker's cache (and the local database).
test('after one online visit the app reloads and starts with the network off', async ({ page, context }) => {
  await completeSetup(page);
  // The worker caches the shell, bundles and the SQLite wasm on install: wait for it.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!navigator.serviceWorker.controller) return false;
          for (const k of await caches.keys()) {
            const keys = (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname);
            if (keys.includes('/') && keys.some((p) => p.endsWith('.wasm'))) return true;
          }
          return false;
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await expect(label(page, 'Calories (kcal)')).toHaveValue('1,990', { timeout: 40_000 });
  await context.setOffline(false);
});
