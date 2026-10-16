import { triage } from '../support/axe.mjs';
import { axeSource, completeSetup, expect, label, openApp, tab, test } from '../support/app.mjs';

// axe-core on the main screens, in light and dark: the WCAG 2.0/2.1 A and AA rules (which include colour contrast) plus
// the landmark and heading best-practice rules. Every violation fails the test. A failure caused by a filed bug goes in
// KNOWN by screen, as `{ rule, issue, match }` (see support/axe.mjs): it matches the rule AND the element, so a new
// violation still fails, and once the bug is fixed the entry matches nothing, goes stale and fails the test.
// The scan runs page-has-heading-one with passForModal off, because react-native-web's full-screen layers would otherwise make it pass on every screen.
const KNOWN = Object.fromEntries(['consent', 'setup', 'food', 'workout', 'progress', 'targets', 'data', 'library', 'about', 'recipes'].map((n) => [n, []]));
const RULES = ['region', 'landmark-one-main', 'landmark-no-duplicate-main', 'page-has-heading-one'];

// Exactly one level-one heading in the accessibility tree: the other tabs stay mounted but are aria-hidden, so they do not count.
const levelOnes = (page) => page.evaluate(() => [...document.querySelectorAll('[role=heading][aria-level="1"], h1:not([role])')].filter((h) => !h.closest('[aria-hidden="true"]')).map((h) => h.textContent));

async function scan(page, name, scheme) {
  // Auto-retrying: under Expo SDK 58 the incoming screen mounts one commit after the outgoing one is marked aria-hidden,
  // so a single read can land in the ~10–26 ms window with no non-aria-hidden level-one heading (#542). A screen that
  // genuinely has none still fails, once the retries run out.
  await expect(async () => {
    expect(await levelOnes(page), `${name} in ${scheme} mode: level-one headings`).toHaveLength(1);
  }).toPass({ timeout: 5_000 });
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
    // "Exercise 1: <name>" is on Workout's planned-session view only. The old waits were also satisfiable by Targets:
    // `[aria-label^="Start "]` matched its "Start a rest timer after each set" switch and `/day$/` matched its
    // "You burn about 2,493 kcal a day" level-one headline, so axe could run on Targets, or inside the empty window
    // after Targets was hidden and before Workout mounted (#542).
    await expect(page.locator('[aria-label^="Exercise 1: "]')).toBeVisible();
  },
  progress: async (page) => {
    await tab(page, 'Progress');
    await expect(label(page, 'Save weight')).toBeVisible();
  },
  targets: async (page) => {
    await tab(page, 'Targets');
    await expect(label(page, 'Redo setup')).toBeVisible(); // only Targets has it, so the scan cannot run on a tab still in transition
  },
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
    // Exact level-one name: Targets' own level-one headline "You burn about 2,493 kcal a day" matches /about/i, so the
    // loose heading match could be satisfied while still on Targets (#542).
    await expect(page.getByRole('heading', { level: 1, name: 'About and sources', exact: true })).toBeVisible();
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
