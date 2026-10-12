import { completeSetup, expect, label, reloadTo, saved, tab, test } from '../support/app.mjs';

// All logging runs with the network off, then the page is reloaded online: what comes back was read from SQLite.
test.beforeEach(async ({ page }) => {
  await completeSetup(page);
  await page.context().setOffline(true);
});

test('log a food: it counts toward the day and is still there after a reload', async ({ page }) => {
  await tab(page, 'Food');
  await label(page, '+ Add to breakfast').click();
  await page.locator('[aria-label^="Add Roti / chapati"]').first().click();
  await label(page, 'Done').click();
  await expect(label(page, '102 of 1,990 kcal eaten')).toBeVisible();
  await saved(page, () => label(page, 'I’ve logged everything I ate today').click());
  await expect(label(page, 'I’ve logged everything I ate today')).toHaveAttribute('aria-checked', 'true');

  await page.context().setOffline(false);
  await reloadTo(page, 'Food');
  await expect(label(page, '102 of 1,990 kcal eaten')).toBeVisible();
  await expect(label(page, 'I’ve logged everything I ate today')).toHaveAttribute('aria-checked', 'true');
});

test('log a glass of water: it is counted and survives a reload', async ({ page }) => {
  await tab(page, 'Food');
  await saved(page, () => label(page, 'Add a glass, 250 millilitres').click());
  await expect(page.locator('[aria-label^="0.3 of about "]')).toBeVisible();

  await page.context().setOffline(false);
  await reloadTo(page, 'Food');
  await expect(page.locator('[aria-label^="0.3 of about "]')).toBeVisible();
});

test('add a weigh-in: it shows as the latest and survives a reload', async ({ page }) => {
  await tab(page, 'Progress');
  await label(page, 'Weight in kg').fill('81.6');
  await saved(page, () => label(page, 'Save weight').click());
  await expect(label(page, 'Latest weigh-in 81.6 kg')).toBeVisible();

  await page.context().setOffline(false);
  await reloadTo(page, 'Progress');
  await expect(label(page, 'Latest weigh-in 81.6 kg')).toBeVisible();
});

test('start a workout and tick a set: the set and its numbers survive a reload', async ({ page }) => {
  await tab(page, 'Workout');
  // Today's planned session, or the first other template on a rest day.
  await page.locator('[aria-label^="Start "]:not([aria-label^="Start a rest"])').first().click();
  const mark = page.locator('[aria-label^="Mark "][aria-label$=" set 1 done"]').first();
  const markLabel = await mark.getAttribute('aria-label');
  const exercise = markLabel.slice('Mark '.length, -' set 1 done'.length);
  // Assisted lifts name the weight field differently, so take the set's two inputs by position.
  const inputs = page.locator(`input[aria-label^=${JSON.stringify(`${exercise} set 1 `)}]`);
  await inputs.nth(0).fill('40');
  await inputs.nth(1).fill('9');
  await saved(page, () => label(page, markLabel).click());
  await expect(label(page, markLabel)).toHaveAttribute('aria-checked', 'true');

  await page.context().setOffline(false);
  await reloadTo(page, 'Workout');
  await expect(label(page, markLabel)).toHaveAttribute('aria-checked', 'true');
  await expect(inputs.nth(0)).toHaveValue('40');
  await expect(inputs.nth(1)).toHaveValue('9');
});
