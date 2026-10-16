import { completeSetup, expect, label, openApp, test } from '../support/app.mjs';

test('first run asks for consent, then setup ends on Targets with the stored profile', async ({ page }) => {
  await openApp(page);
  // Consent comes first and blocks the flow until it is given.
  await expect(label(page, 'I understand and agree to my data being stored as described')).toBeVisible({ timeout: 40_000 });
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await completeSetup(page);
});

test('the profile survives a reload and the app opens straight to Targets', async ({ page }) => {
  await completeSetup(page);
  await page.reload({ waitUntil: 'load' });
  await expect(label(page, 'Redo setup')).toBeVisible({ timeout: 40_000 });
  // The targets are the editable "Daily targets" fields now (#483), so read the calories field's value.
  await expect(label(page, 'Calories (kcal)')).toHaveValue('1990');
});
