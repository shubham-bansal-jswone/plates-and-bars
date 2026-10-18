import { completeSetup, expect, label, openApp, test } from '../support/app.mjs';

test('first run asks for consent, then setup ends on Food with the toast, and Targets holds the stored profile', async ({ page }) => {
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

test('a redo from Targets also ends on Food with the toast', async ({ page }) => {
  await completeSetup(page);
  await label(page, 'Redo setup').click();
  const results = label(page, 'Use these targets');
  // The form starts with the stored answers: step on until the results.
  for (let i = 0; i < 8 && !(await results.isVisible()); i += 1) {
    for (const no of await page.locator('[role="radiogroup"] [aria-label="No"]').all()) await no.click();
    await label(page, 'See my targets').or(label(page, 'Continue')).first().click();
  }
  await results.click();
  await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible();
  await expect(page.getByText('Targets updated', { exact: true })).toBeVisible();
});
