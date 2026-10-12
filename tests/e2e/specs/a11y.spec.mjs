import { axeSource, completeSetup, expect, label, openApp, tab, test } from '../support/app.mjs';

// axe-core on the main screens, in light and dark (WCAG 2.0/2.1 A and AA rules, which include colour contrast).
// Every violation fails the test. A rule that fails because of a filed bug is listed in KNOWN with the issue number, so
// the test still guards everything else on that screen; once the bug is fixed the stale entry fails the test, so remove it.
const KNOWN = {
  setup: ['aria-required-attr'], // #366: role=radio without aria-checked
  library: ['aria-required-attr', 'label-content-name-mismatch'], // #366, #367
};
// Real defects that axe reports only some of the time (its name check is heuristic): ignored, present or not.
const FLAKY = {
  food: ['label-content-name-mismatch'], // #371: "What should I eat next?" card name omits "Show"
};

async function scan(page, name, scheme) {
  await page.evaluate(axeSource);
  const { violations } = await page.evaluate(() => globalThis.axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  const known = KNOWN[`${name}/${scheme}`] ?? KNOWN[name] ?? [];
  const flaky = FLAKY[name] ?? [];
  const found = violations.filter((v) => !known.includes(v.id) && !flaky.includes(v.id));
  const stale = known.filter((id) => !violations.some((v) => v.id === id));
  expect(stale, `${name}: the known failure no longer happens, remove it from KNOWN`).toEqual([]);
  const summary = found.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 5).map((n) => `    ${n.target.join(' ')}  ${n.failureSummary?.split('\n')[1] ?? ''}`).join('\n')}`);
  expect(summary, `${name} in ${scheme} mode`).toEqual([]);
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
  food: async (page) => tab(page, 'Food'),
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
