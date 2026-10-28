import { completeSetup, expect, label, openApp, tab, test } from '../support/app.mjs';

/**
 * Inactive tab screens stay mounted (typed values survive) but must not take keyboard focus (#1191): Tab from the tab bar
 * may only land on the active screen's controls, never on something hidden inside an aria-hidden screen.
 */
test('Tab from the tab bar reaches only visible controls of the active screen', async ({ page }) => {
  await openApp(page);
  await completeSetup(page);
  for (const name of ['Workout', 'Progress']) {
    await tab(page, name);
    await label(page, name).focus();
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        return {
          hiddenAncestor: !!el.closest('[aria-hidden="true"]'),
          visible: r.width > 0 && r.height > 0,
          name: el.getAttribute('aria-label') ?? el.textContent?.slice(0, 40),
        };
      });
      if (stop) expect(stop, `Tab stop ${i + 1} after ${name}`).toMatchObject({ hiddenAncestor: false, visible: true });
    }
  }
});
