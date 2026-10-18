import { completeSetup, expect, label, reloadTo, saved, tab, test } from '../support/app.mjs';

// A planned meal: "Plan my week" -> "Use this plan" puts "From your plan" on a meal, and "Log it" logs its items.
// The "skips" case (a plan item no longer in the food list is named in the toast and not logged) cannot be reached from
// the UI: the plan is built from the bundled food list and nothing removes a food from it. It is covered by the app's
// unit tests (food/copy `plannedLogged`); an e2e for it needs a plan seeded into SQLite.
test('planned meal: Log it logs the whole planned breakfast, once, and it survives a reload', async ({ page }) => {
  await completeSetup(page);
  await tab(page, 'Food');
  await page.getByRole('button', { name: /What should I eat next/ }).click();
  await label(page, 'Plan my week').click();
  await expect(page.getByRole('heading', { name: 'Your week of meals' })).toBeVisible();
  await saved(page, () => label(page, 'Use this plan').click());
  await label(page, 'Back').click();

  const line = page.getByText(/^From your plan: /);
  await expect(line.first()).toBeVisible();
  await expect(page.getByText('(no longer in the food list)')).toHaveCount(0);
  const items = (await line.first().innerText()).slice('From your plan: '.length).split(' + ');

  await page.context().setOffline(true);
  // The toast lasts about two seconds, so it is awaited while the write settles, not after it.
  const toast = expect(page.getByText('Logged your planned breakfast', { exact: true })).toBeVisible();
  await saved(page, () => label(page, 'Log your planned breakfast').click());
  await toast;
  // Every planned item is now a logged row (a row can be removed by its own button), and the plan line is gone.
  for (const item of items) {
    const name = item.replace(/ ×[\d.]+$/, '');
    await expect(label(page, `Remove ${name}`)).toBeVisible();
  }
  await expect(label(page, 'Log your planned breakfast')).toHaveCount(0);

  await page.context().setOffline(false);
  await reloadTo(page, 'Food');
  for (const item of items) await expect(label(page, `Remove ${item.replace(/ ×[\d.]+$/, '')}`)).toBeVisible();
  await expect(label(page, 'Log your planned breakfast')).toHaveCount(0);

  // The plan and the log belong to the day shown: the day before the plan starts has neither, and Today still has the log.
  await label(page, 'Previous day').click();
  await expect(label(page, 'Yesterday, Sunday, 11 Oct')).toBeVisible();
  // Likely cause of the flake in #986 (see #1032): the date bar is also drawn by the Loading… view while the new day is read, and the loaded
  // screen then replaces it. Wait for the loaded empty day first: a press that starts on the Loading… bar and ends on its replacement is
  // not a click, and "Remove" counts 0 while loading.
  await expect(page.getByText(/^Nothing logged for this day yet/)).toBeVisible();
  await expect(label(page, `Remove ${items[0].replace(/ ×[\d.]+$/, '')}`)).toHaveCount(0);
  await expect(page.getByText(/^From your plan: /)).toHaveCount(0);
  await label(page, 'Next day').click();
  await expect(label(page, 'Today, Monday, 12 Oct')).toBeVisible();
  await expect(label(page, `Remove ${items[0].replace(/ ×[\d.]+$/, '')}`)).toBeVisible();
});
