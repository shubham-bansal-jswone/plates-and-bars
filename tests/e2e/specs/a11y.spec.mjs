import { triage } from '../support/axe.mjs';
import { axeSource, completeSetup, expect, label, openApp, tab, test } from '../support/app.mjs';

// axe-core on the main screens, in light and dark: the WCAG 2.0/2.1 A and AA rules (which include colour contrast) plus
// the landmark and heading best-practice rules. Every violation fails the test. A failure caused by a filed bug goes in
// KNOWN by screen, as `{ rule, issue, match }` (see support/axe.mjs): it matches the rule AND the element, so a new
// violation still fails, and once the bug is fixed the entry matches nothing, goes stale and fails the test.
// #382: every header is <h1 role=heading> without aria-level, so no screen has a level-one heading. The scan runs the rule
// with passForModal off, because react-native-web's full-screen layers would otherwise make it pass on every screen.
const noH1 = { rule: 'page-has-heading-one', issue: 382, match: (n) => n.html.startsWith('<html') };
const KNOWN = Object.fromEntries(['consent', 'setup', 'food', 'workout', 'progress', 'targets', 'data', 'library', 'about', 'recipes'].map((n) => [n, [noH1]]));
const RULES = ['region', 'landmark-one-main', 'landmark-no-duplicate-main', 'page-has-heading-one'];

async function scan(page, name, scheme) {
  await page.evaluate(axeSource);
  const { violations } = await page.evaluate((rules) => globalThis.axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, rules: Object.fromEntries(rules.map((r) => [r, { enabled: true }])), checks: { 'page-has-heading-one': { options: { passForModal: false } } } }), RULES);
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
    await expect(page.getByText('What should I eat next?', { exact: true })).toBeVisible();
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
