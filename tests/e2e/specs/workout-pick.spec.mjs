import { answerSetup, expect, label, saved, tab, test } from '../support/app.mjs';

// #819: a user with no training days has no template to start, so "Pick exercises" on the Workout start screen is how a session begins.
test('a 0-day user picks an exercise from the start screen and logs a set, offline', async ({ page }) => {
  await answerSetup(page, { days: 'None yet' });
  await label(page, 'Use these targets').click();
  await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible(); // setup ends on Food
  await tab(page, 'Workout');
  await expect(page.getByText('Rest day', { exact: true })).toBeVisible();
  await page.context().setOffline(true);
  await label(page, 'Pick exercises').click();
  const sheet = page.locator('[role="dialog"][aria-label="Add exercise"]');
  await expect(sheet).toBeVisible();
  const name = 'Barbell Bench Press';
  const chip = label(page, `Add ${name}`);
  await chip.click(); // a pick is only a preview (#1005): nothing is stored until Start
  await saved(page, () => label(page, 'Start this exercise').click());
  await expect(page.getByText('Session', { exact: true })).toBeVisible();
  await label(page, `${name} set 1 kg`).fill('40');
  await label(page, `${name} set 1 reps`).fill('8');
  await saved(page, () => label(page, `Mark ${name} set 1 done`).click());
  await expect(label(page, `Mark ${name} set 1 done`)).toBeVisible();
  await page.context().setOffline(false);
});
