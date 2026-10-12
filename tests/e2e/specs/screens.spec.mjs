import { completeSetup, expect, label, tab, test } from '../support/app.mjs';

const heading = (page, name) => page.getByRole('heading', { name, exact: true });

test.beforeEach(async ({ page }) => {
  await completeSetup(page);
});

test('exercise library: search narrows the list and an exercise opens with its notes', async ({ page }) => {
  await label(page, 'Exercise library').click();
  await expect(heading(page, 'Exercise library')).toBeVisible();
  const rows = page.getByRole('button').filter({ hasText: ' · ' });
  await expect(rows.first()).toBeVisible();
  const all = await rows.count();
  await label(page, 'Search exercises').fill('chest press');
  await expect(rows.first()).toContainText(/chest press/i);
  expect(await rows.count()).toBeLessThan(all);
  const name = (await rows.first().innerText()).split('\n')[0];
  await rows.first().click();
  await expect(heading(page, name)).toBeVisible();
  await expect(page.getByText(/Main muscles: /)).toBeVisible();
  await label(page, 'Back to library').click();
  await expect(heading(page, 'Exercise library')).toBeVisible();
});

test('about: lists the data sources with their licences', async ({ page }) => {
  await label(page, 'About and sources').click();
  await expect(page.getByRole('heading', { name: /about/i })).toBeVisible();
  await expect(page.getByText(/licen[cs]e/i).first()).toBeVisible();
  await label(page, 'Back').click();
  await expect(label(page, 'Redo setup')).toBeVisible();
});

test('kitchen and recipe builder open from Food and return', async ({ page }) => {
  await tab(page, 'Food');
  await page.locator('[aria-label^="Recipes for breakfast"]').click();
  await expect(heading(page, 'Recipes')).toBeVisible();
  await label(page, 'Blank').click();
  await expect(label(page, 'Recipe name')).toBeVisible();
  await label(page, 'Recipe name').fill('E2E dal');
  await label(page, 'Kitchen tests').click();
  await expect(heading(page, 'Kitchen tests')).toBeVisible();
  await label(page, 'New kitchen test').click();
  await expect(label(page, 'Dish')).toBeVisible();
  // With no kitchen tests yet the how-to is open; the link toggles it.
  await expect(page.getByText('Weigh the empty pot before you start.', { exact: false })).toBeVisible();
  await label(page, 'How to do a kitchen test').click();
  await expect(page.getByText('Weigh the empty pot before you start.', { exact: false })).toBeHidden();
  await label(page, 'Cancel').click();
  await label(page, 'Back').click();
  await expect(heading(page, 'Recipes')).toBeVisible();
});
