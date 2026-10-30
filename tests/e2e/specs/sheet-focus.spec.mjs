import { answerSetup, completeSetup, expect, label, tab, test } from '../support/app.mjs';

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
  const heading = dialog.locator('[role="heading"]').first();
  await expect(heading).toBeFocused();
  // The app's focus ring (theme colour, 2px, 2px offset) on a keyboard open (#1302).
  expect(await heading.evaluate((h) => getComputedStyle(h).outline)).toBe('rgb(183, 255, 0) solid 2px');
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

/**
 * Tab and Shift+Tab cycle through a sheet's controls only (#1275). react-native-web's focus trap walks the dialog with
 * element.focus(), and Chromium lets script focus the page's scrolling container, so a wrap used to stop on that unlabelled
 * full-screen div (and Shift+Tab from the top X stayed on it). Real browser only: jsdom has no scrollers.
 */
test('Tab and Shift+Tab cycle through the how-to sheet controls only, and Escape returns focus to the opener', async ({ page }) => {
  await completeSetup(page);
  await tab(page, 'Workout');
  await page.locator('[aria-label^="Start "]:not([aria-label^="Start a rest"])').first().click();
  const opener = page.getByRole('button', { name: /^How to do / }).first();
  const name = (await opener.getAttribute('aria-label')).slice('How to do '.length);
  await opener.click();
  const dialog = page.locator(`[role="dialog"][aria-label=${JSON.stringify(name)}]`);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[role="heading"]').first()).toBeFocused(); // initial focus is still the title
  // What has focus: its accessible name, or an UNEXPECTED note when it is outside the dialog or unlabelled.
  const focused = () =>
    page.evaluate(() => {
      const a = document.activeElement;
      const d = document.querySelector('[role="dialog"]');
      const named = a.getAttribute('aria-label') || '';
      return d && d.contains(a) && a !== d && named ? named : `UNEXPECTED ${a.tagName} ${a.getAttribute('role')} ${(a.textContent || '').slice(0, 30)}`;
    });
  const walk = async (key, n) => {
    const seen = [];
    for (let i = 0; i < n; i++) {
      await page.keyboard.press(key);
      seen.push(await focused());
    }
    return seen;
  };
  const forward = await walk('Tab', 14);
  const backward = await walk('Shift+Tab', 14);
  expect(forward.filter((s) => s.startsWith('UNEXPECTED')), 'Tab stops outside the controls').toEqual([]);
  expect(backward.filter((s) => s.startsWith('UNEXPECTED')), 'Shift+Tab stops outside the controls').toEqual([]);
  const controls = new Set(forward);
  expect(controls.size, 'a cycle of several controls, not a dead end').toBeGreaterThan(2);
  expect(new Set(backward)).toEqual(controls); // backward reaches every control forward does, including the last
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

/**
 * The first Shift+Tab right after a sheet opens (focus on the title) wraps to the last control, Close, not forward to the
 * first (#1275 review): the title must still count as a stop while the focus trap handles the key.
 */
test('Shift+Tab straight after opening a sheet lands on its last control', async ({ page }) => {
  await completeSetup(page);
  await tab(page, 'Workout');
  await page.locator('[aria-label^="Start "]:not([aria-label^="Start a rest"])').first().click();
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  const dialog = page.locator('[role="dialog"][aria-label="Add exercise"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[role="heading"]').first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
});
