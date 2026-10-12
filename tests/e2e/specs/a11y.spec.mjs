import { htmlHas, triage } from '../support/axe.mjs';
import { axeSource, completeSetup, expect, label, openApp, tab, test } from '../support/app.mjs';

// axe-core on the main screens, in light and dark (WCAG 2.0/2.1 A and AA rules, which include colour contrast).
// Every violation fails the test. A failure caused by a filed bug is listed in KNOWN by rule and element with the issue
// number (support/axe.mjs), so a new violation, even of the same rule, still fails; when the bug is fixed the entry
// matches nothing, goes stale and fails the test, so remove it.
const radio = () => ({ rule: 'aria-required-attr', issue: 366, match: htmlHas('role="radio"') }); // role=radio without aria-checked
const KNOWN = {
  setup: [radio()],
  library: [
    radio(),
    { rule: 'label-content-name-mismatch', issue: 367, match: (n) => /aria-label="[^"]+\. [^"]* · /.test(n.html) }, // rows
  ],
  food: [{ rule: 'label-content-name-mismatch', issue: 371, match: htmlHas('aria-label="What should I eat next?') }],
};

async function scan(page, name, scheme) {
  await page.evaluate(axeSource);
  const { violations } = await page.evaluate(() => globalThis.axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  const { unexpected, stale } = triage(violations, KNOWN[name]);
  expect(stale, `${name} in ${scheme} mode`).toEqual([]);
  expect(unexpected, `${name} in ${scheme} mode`).toEqual([]);
}

const screens = {
  consent: async (page) => {
    await openApp(page);
    await expect(label(page, 'Continue')).toBeVisible({ timeout: 40_000 });
  },
  setup: async (page) => {
    await openApp(page);
    await label(page, 'I understand and agree to my data being stored as described').click();
    await label(page, 'Continue').click();
    await expect(label(page, 'Male')).toBeVisible();
  },
  food: async (page) => {
    await tab(page, 'Food');
    // axe's name check reads the card's text; scan only once the card shows its "Show" action (it appears after first render).
    await expect(page.locator('[aria-label^="What should I eat next?"]')).toContainText('Show');
  },
  workout: async (page) => {
    await tab(page, 'Workout');
    await expect(page.locator('[aria-label^="Start "]').first()).toBeVisible();
  },
  progress: async (page) => {
    await tab(page, 'Progress');
    await expect(label(page, 'Save weight')).toBeVisible();
  },
  targets: async (page) => tab(page, 'Targets'),
  data: async (page) => {
    await tab(page, 'Targets');
    await label(page, 'Download or delete my data').click();
    await expect(label(page, 'Download my data')).toBeVisible();
  },
  library: async (page) => {
    await tab(page, 'Targets');
    await label(page, 'Exercise library').click();
    await expect(label(page, 'Search exercises')).toBeVisible();
  },
  about: async (page) => {
    await tab(page, 'Targets');
    await label(page, 'About and sources').click();
    await expect(page.getByRole('heading', { name: /about/i })).toBeVisible();
  },
  recipes: async (page) => {
    await tab(page, 'Food');
    await page.locator('[aria-label^="Recipes for breakfast"]').click();
    await expect(label(page, 'Blank')).toBeVisible();
  },
};

for (const scheme of ['light', 'dark']) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });
    for (const [name, open] of Object.entries(screens)) {
      test(`axe: ${name}`, async ({ page }) => {
        if (name === 'consent' || name === 'setup') await open(page);
        else {
          await completeSetup(page);
          await open(page);
        }
        await scan(page, name, scheme);
      });
    }
  });
}
