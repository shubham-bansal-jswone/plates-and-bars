import { completeSetup, expect, label, tab, test } from '../support/app.mjs';

// The rest bar is a dock over the bottom of the Workout screen. At 1200 px it once sat bottom-left (#147); it belongs under the
// content column. Layout is not computed under jest, so this measures the real boxes on the web build (#630).
test('the rest bar sits under the content column on wide web and fits the screen on a phone', async ({ page }) => {
  await completeSetup(page);
  await tab(page, 'Workout');
  // Today's planned session, or the first other template on a rest day.
  await page.locator('[aria-label^="Start "]:not([aria-label^="Start a rest"])').first().click();
  const mark = page.locator('[aria-label^="Mark "][aria-label$=" set 1 done"]').first();
  const markLabel = await mark.getAttribute('aria-label');
  const exercise = markLabel.slice('Mark '.length, -' set 1 done'.length);
  // A set with no numbers is not ticked. Assisted lifts name the weight field differently, so take the set's two inputs by position.
  const inputs = page.locator(`input[aria-label^=${JSON.stringify(`${exercise} set 1 `)}]`);
  await inputs.nth(0).fill('40');
  await inputs.nth(1).fill('9');
  await label(page, markLabel).click();

  const panel = label(page, 'Rest timer');
  // Other tabs stay mounted and visible, so take the page column that holds the set just ticked.
  const column = page.locator('[role="main"]').filter({ has: page.locator(`[aria-label=${JSON.stringify(markLabel)}]`) });
  await expect(panel).toBeVisible();

  // Phone first, the app's default viewport: the panel is the width of the screen less the dock's 8 px padding.
  const phone = page.viewportSize();
  expect(phone.width).toBe(390);
  let box = await panel.boundingBox();
  expect(box.x, 'panel left edge at 390 px').toBeGreaterThanOrEqual(0);
  expect(box.x, 'panel is at most 8 px from the left edge at 390 px').toBeLessThanOrEqual(8);
  expect(phone.width - (box.x + box.width), 'panel is at most 8 px from the right edge at 390 px').toBeLessThanOrEqual(8);
  expect(phone.width - (box.x + box.width), 'panel stays inside the right edge at 390 px').toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, 'panel bottom is inside the viewport at 390 px').toBeLessThanOrEqual(phone.height);

  // Wide windows: the panel has the column's left edge and width. The literal numbers are the reviewer's measurements; they also
  // catch the column itself collapsing, which a comparison between the two boxes alone would not.
  for (const { width, left, right } of [{ width: 1200, left: 320, right: 880 }, { width: 800, left: 120, right: 680 }]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(async () => (await column.boundingBox()).x, { message: `column left edge at ${width} px` }).toBe(left);
    const col = await column.boundingBox();
    box = await panel.boundingBox();
    expect(col.x + col.width, `column right edge at ${width} px`).toBe(right);
    expect(box.x, `panel left edge at ${width} px`).toBe(col.x);
    expect(box.x + box.width, `panel right edge at ${width} px`).toBe(col.x + col.width);
    expect(box.y + box.height, `panel bottom is inside the viewport at ${width} px`).toBeLessThanOrEqual(800);
  }
});
