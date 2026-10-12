import { completeSetup, expect, label, openApp, test } from '../support/app.mjs';

test('first run asks for consent, then setup ends on Targets with the stored profile', async ({ page, blocked }) => {
  await openApp(page);
  // Consent comes first and blocks the flow until it is given.
  await expect(label(page, 'I understand and agree to my data being stored as described')).toBeVisible({ timeout: 40_000 });
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await completeSetup(page);
  expect(blocked, 'requests to anything but localhost').toEqual([]);
});

test('the profile survives a reload and the app opens straight to Targets', async ({ page }) => {
  await completeSetup(page);
  await page.reload({ waitUntil: 'load' });
  await expect(label(page, 'Redo setup')).toBeVisible({ timeout: 40_000 });
  await expect(label(page, '1,990 kcal')).toBeVisible();
});
