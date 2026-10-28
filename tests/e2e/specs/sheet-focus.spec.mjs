import { answerSetup, expect, label, test } from '../support/app.mjs';

/**
 * Sheets are named dialogs that start with focus on their title and give focus back to the opener on close (#661).
 * Real browser only: react-native-web switches the dialog role and focus trap on at the end of the slide animation, and the
 * trap focuses the first button (Close) after that, so a unit test with a hand-made DOM cannot catch the ordering.
 */
test('a sheet opens with focus on its title and returns focus to the opener on Escape', async ({ page }) => {
  await answerSetup(page, { stop: 'screening' });
  const title = 'Why a health check before training?';
  const opener = page.getByRole('button', { name: title });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator(`[role="dialog"][aria-label=${JSON.stringify(title)}]`);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[role="heading"]').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

/** A sheet plays no slide animation under prefers-reduced-motion: reduce, and still does without it (#1199). */
for (const [motion, animated] of [['reduce', false], ['no-preference', true]]) {
  test(`a sheet ${animated ? 'slides' : 'does not animate'} with reduced motion ${motion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    await answerSetup(page, { stop: 'screening' });
    // The slide lasts 0.25 s, so record the start event instead of sampling styles after it has ended.
    await page.evaluate(() => {
      window.__animations = [];
      document.addEventListener('animationstart', (e) => window.__animations.push(e.target), true);
    });
    const title = 'Why a health check before training?';
    await page.getByRole('button', { name: title }).click();
    const dialog = page.locator(`[role="dialog"][aria-label=${JSON.stringify(title)}]`);
    await expect(dialog).toBeVisible();
    // Only animations on the dialog (or its container, which carries the slide), not any other on the page.
    const own = await dialog.evaluate((d) => window.__animations.filter((t) => t.contains(d) || d.contains(t)).length);
    expect(own > 0).toBe(animated);
  });
}
