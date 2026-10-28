import { completeSetup, expect, label, openApp, tab, test } from '../support/app.mjs';

// Switches and chips (#1192): one named tab stop per switch with the lime 2px ring, and every visible interactive control at
// least 44x44 (the 40x20 switch track and the 32px Add-sheet pills stay as designed; their hit areas are 44).
// The theme's focus colour: lime on dark, blue on light (apps/mobile/src/theme/tokens.ts).
const FOCUS = { dark: 'rgb(183, 255, 0)', light: 'rgb(36, 87, 230)' };
const CONTROLS = 'button,[role=button],[role=radio],[role=tab],[role=switch],[role=checkbox],input,a[href],[tabindex="0"]';

// Visible interactive controls under 44x44 inside `root` (a CSS selector; the whole page by default).
const tooSmall = (page, root = 'body') =>
  page.evaluate(([sel, controls]) => [...document.querySelector(sel).querySelectorAll(controls)]
    .filter((e) => !e.closest('[aria-hidden="true"],[inert]') && e.getClientRects().length)
    .map((e) => ({ name: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) }))
    .filter((r) => r.w < 44 || r.h < 44), [root, CONTROLS]);

// Tabs `n` times and describes each stop.
async function stops(page, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    out.push(await page.evaluate(() => {
      const e = document.activeElement;
      const ring = (x) => { const s = getComputedStyle(x); return `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`; };
      return { role: e.getAttribute('role'), name: e.getAttribute('aria-label') || e.textContent.trim(), ring: ring(e), parentRing: (e.parentElement?.parentElement ? ring(e.parentElement.parentElement) : '') };
    }));
  }
  return out;
}

for (const scheme of ['light', 'dark']) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 360, height: 800 } });

    test('consent: the switch is one named tab stop with the lime ring, and nothing is under 44px', async ({ page }) => {
      await openApp(page);
      await expect(label(page, 'Continue')).toBeVisible({ timeout: 40_000 });
      expect(await tooSmall(page)).toEqual([]);
      const seen = await stops(page, 2); // the switch, then Continue: the hit-area div and the label text are not tab stops
      for (const s of seen) expect(s.name, 'every tab stop is named').not.toBe('');
      expect(seen.map((s) => s.name)).toEqual(['I understand and agree to my data being stored as described', 'Continue']);
      expect(seen[0].role).toBe('switch');
      expect(seen[0].parentRing).toBe(`2px solid ${FOCUS[scheme]}`);
      expect(seen[0].ring).toContain('none'); // no browser-default outline on the checkbox itself
      // Mouse click, then Space: the ring shows on keyboard use even though focus did not move.
      await label(page, 'I understand and agree to my data being stored as described').click();
      await page.keyboard.press('Space');
      await expect(label(page, 'I understand and agree to my data being stored as described')).not.toBeChecked();
      expect(await label(page, 'I understand and agree to my data being stored as described').evaluate((e) => getComputedStyle(e.parentElement.parentElement).outlineWidth)).toBe('2px');
      // One click toggles once (#1134): on, not on-then-off.
      await label(page, 'I understand and agree to my data being stored as described').click();
      await expect(label(page, 'I understand and agree to my data being stored as described')).toBeChecked();
    });

    test('setup: the days-a-week chips are 44 wide', async ({ page }) => {
      await openApp(page);
      await expect(label(page, 'Continue')).toBeVisible({ timeout: 40_000 });
      await label(page, 'I understand and agree to my data being stored as described').click();
      await label(page, 'Continue').click();
      await label(page, 'Male').click();
      await label(page, 'Age').fill('30');
      await label(page, 'Use cm').click();
      await label(page, 'Height in cm').fill('165');
      await label(page, 'Weight in kg').fill('82');
      await label(page, 'Continue').click();
      await label(page, 'Mostly sitting. Desk job, little walking (under ~5,000 steps)').click();
      await label(page, 'Continue').click();
      await expect(label(page, '6')).toBeVisible();
      expect(await tooSmall(page)).toEqual([]);
    });

    test('targets, food add sheet and library', async ({ page }) => {
      await completeSetup(page);
      expect(await tooSmall(page, '[aria-label="Start a rest timer after each set"]')).toEqual([]);

      await tab(page, 'Food');
      await label(page, '+ Add to breakfast').click();
      const dialog = page.locator('[role="dialog"][aria-label="Add to breakfast"]');
      await expect(dialog).toBeVisible();
      expect(await tooSmall(page, '[role="dialog"]')).toEqual([]);
      await label(page, 'Custom').click();
      expect(await tooSmall(page, '[role="dialog"]')).toEqual([]);
      await expect(label(page, 'Save to my foods for next time')).toHaveCount(1);
      await page.keyboard.press('Escape');

      await tab(page, 'Targets');
      await label(page, 'Exercise library').click();
      const search = label(page, 'Search exercises');
      await search.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const ring = await search.evaluate((e) => { const s = getComputedStyle(e); return { outline: s.outlineWidth, border: s.borderTopColor, width: s.borderTopWidth }; });
      expect(ring.outline).toBe('0px'); // the border is the ring, not the browser default
      expect(ring.width).toBe('2px');
      expect(ring.border).toBe(FOCUS[scheme]);
    });
  });
}
