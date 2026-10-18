import { completeSetup, expect, label, tab, test } from '../support/app.mjs';

// 360 px is a common Android width. The Workout screen once scrolled sideways there (#900): the ramp buttons ("Start the ramp for
// <exercise>", "I know my weight for <exercise>") put the exercise name in their visible text and forced the page column wider than the screen. Layout is not computed under jest, so this measures the real boxes on the web build.
test.use({ viewport: { width: 360, height: 640 } });

test('the Workout screen fits 360 px with a started session and a ticked set', async ({ page }) => {
  await completeSetup(page);
  await tab(page, 'Workout');
  await page.locator('[aria-label^="Start "]:not([aria-label^="Start a rest"])').first().click();
  const mark = page.locator('[aria-label^="Mark "][aria-label$=" set 1 done"]').first();
  const markLabel = await mark.getAttribute('aria-label');
  const exercise = markLabel.slice('Mark '.length, -' set 1 done'.length);
  const inputs = page.locator(`input[aria-label^=${JSON.stringify(`${exercise} set 1 `)}]`);
  await inputs.nth(0).fill('40');
  await inputs.nth(1).fill('9');
  await label(page, markLabel).click();
  // The effort chips ("How did that feel?") are on screen for the ticked set.
  await expect(page.getByText('How did that feel?').first()).toBeVisible();

  const column = page.locator('[role="main"]').filter({ has: page.locator(`[aria-label=${JSON.stringify(markLabel)}]`) });
  const width = await column.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(width.scroll, `column scrollWidth ${width.scroll} vs clientWidth ${width.client}`).toBeLessThanOrEqual(width.client);
  const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(doc.scroll, `page scrollWidth ${doc.scroll} vs clientWidth ${doc.client}`).toBeLessThanOrEqual(doc.client);
  // No control of the column reaches past the screen's right edge.
  const wide = await column.evaluate((el, vw) => [...el.querySelectorAll('input, [role="button"], [role="checkbox"]')]
    .filter((e) => e.getBoundingClientRect().right > vw + 0.5)
    .map((e) => `${e.getAttribute('aria-label')} right=${Math.round(e.getBoundingClientRect().right)}`), 360);
  expect(wide, 'controls past the 360 px edge').toEqual([]);
});
