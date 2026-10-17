import { triage } from '../support/axe.mjs';
import { answerSetup, axeSource, completeSetup, expect, label, openApp, reloadTo, saved, tab, test } from '../support/app.mjs';

// axe-core on the main screens, in light and dark: the WCAG 2.0/2.1 A and AA rules (which include colour contrast) plus
// the landmark and heading best-practice rules. Every violation fails the test. A failure caused by a filed bug goes in
// KNOWN by screen, as `{ rule, issue, match }` (see support/axe.mjs): it matches the rule AND the element, so a new
// violation still fails, and once the bug is fixed the entry matches nothing, goes stale and fails the test.
// The scan runs page-has-heading-one with passForModal off, because react-native-web's full-screen layers would otherwise make it pass on every screen.
const KNOWN = Object.fromEntries(['consent', 'setup', 'setup-screening', 'setup-results', 'food', 'workout', 'workout-session', 'progress', 'targets', 'data', 'library', 'about', 'recipes', 'sheet-food-add', 'sheet-workout-settings', 'sheet-workout-cant', 'sheet-workout-howto', 'sheet-workout-add', 'sheet-workout-custom', 'sheet-progress-checkin', 'sheet-targets-avoid', 'sheet-targets-cant'].map((n) => [n, []]));
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

// A Why link by its card title: the accessible name is "<link text> <card title>[, <exercise>]" (apps/mobile/src/why/WhyLink.tsx).
// By role, so the other tabs (mounted but aria-hidden, e.g. the Why library on Targets) do not count.
const why = (page, title) => page.getByRole('button', { name: title });

// Today's planned session, or the first other template on a rest day.
const startSession = (page) => page.locator('[aria-label^="Start "]:not([aria-label^="Start a rest"])').first().click();

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
  // The goal step, which carries the "Quick health check" Why link (screening).
  'setup-screening': async (page) => {
    await answerSetup(page, { stop: 'screening' });
    await expect(why(page, 'Why a health check before training?')).toHaveCount(1);
  },
  // The results with both note links (home, older): a 62-year-old training at home with dumbbells.
  'setup-results': async (page) => {
    await answerSetup(page, { age: '62', where: 'At home with dumbbells. Adjustable dumbbells or a few pairs' });
    await expect(why(page, 'Building muscle at home')).toHaveCount(1);
    await expect(why(page, 'Training and eating after 60')).toHaveCount(1);
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
  // A started session: the split link on the page header, then the rest and warm-up links on the exercise cards.
  'workout-session': async (page) => {
    // The warm-up line (and its Why link) needs a suggested weight, so the first lift must have been logged on an earlier
    // day: log it one week before the pinned Monday, then come back to the pinned day (the same template is planned).
    await page.clock.setFixedTime(new Date('2026-10-05T09:00:00+05:30'));
    await reloadTo(page, 'Workout');
    await startSession(page);
    const mark = page.locator('[aria-label^="Mark "][aria-label$=" set 1 done"]').first();
    const markLabel = await mark.getAttribute('aria-label');
    const exercise = markLabel.slice('Mark '.length, -' set 1 done'.length);
    await page.locator(`[aria-label=${JSON.stringify(`I know my weight for ${exercise}`)}]`).click();
    const inputs = page.locator(`input[aria-label^=${JSON.stringify(`${exercise} set 1 `)}]`);
    await inputs.nth(0).fill('40');
    await inputs.nth(1).fill('9');
    await saved(page, () => label(page, markLabel).click());
    await expect(label(page, markLabel)).toHaveAttribute('aria-checked', 'true');
    await page.clock.setFixedTime(new Date('2026-10-12T09:00:00+05:30'));
    await reloadTo(page, 'Workout');
    await startSession(page);
    await expect(page.locator('[aria-label^="Mark "][aria-label$=" set 1 done"]').first()).toBeVisible();
    await expect(why(page, 'How your sessions are built')).toHaveCount(1);
    await expect(why(page, 'Why rest 2–3 minutes on big lifts?').first()).toBeVisible();
    await expect(why(page, 'Why warm up before the first big lift?').first()).toBeVisible();
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

// Screens with a sheet open (#661). Each opens the sheet through its real opener and waits for the named dialog; scan() then
// runs its usual auto-retrying level-one precondition and the same axe rules on the page with the sheet on top.
const dialog = (page, name) => page.locator(`[role="dialog"][aria-label=${JSON.stringify(name)}]`);
const sheets = {
  'sheet-food-add': async (page) => {
    await tab(page, 'Food');
    await label(page, '+ Add to breakfast').click();
    await expect(dialog(page, 'Add to breakfast')).toBeVisible();
  },
  // The exercise settings sheet (the gear on an exercise card), titled by the exercise.
  'sheet-workout-settings': async (page) => {
    await tab(page, 'Workout');
    await expect(page.locator('[aria-label^="Exercise 1: "]')).toBeVisible();
    const gear = page.getByRole('button', { name: / settings$/ }).first();
    const name = (await gear.getAttribute('aria-label')).slice(0, -' settings'.length);
    await gear.click();
    await expect(dialog(page, name)).toBeVisible();
  },
  'sheet-workout-cant': async (page) => {
    await tab(page, 'Workout');
    const opener = page.getByRole('button', { name: /^Can’t do / }).first();
    const name = (await opener.getAttribute('aria-label')).slice('Can’t do '.length);
    await opener.click();
    await expect(dialog(page, `Can’t do ${name}?`)).toBeVisible();
  },
  'sheet-workout-howto': async (page) => {
    await tab(page, 'Workout');
    const opener = page.getByRole('button', { name: /^How to do / }).first();
    const name = (await opener.getAttribute('aria-label')).slice('How to do '.length);
    await opener.click();
    await expect(dialog(page, name)).toBeVisible();
  },
  'sheet-workout-add': async (page) => {
    await tab(page, 'Workout');
    await label(page, 'Add exercise').click();
    await expect(dialog(page, 'Add exercise')).toBeVisible();
  },
  // The custom exercise sheet: a typed name the library does not know asks for its muscles first.
  'sheet-workout-custom': async (page) => {
    await tab(page, 'Workout');
    await label(page, 'Add exercise').click();
    await page.getByRole('textbox', { name: 'Your own exercise' }).fill('Zercher carry');
    await label(page, 'Add the exercise you typed').click();
    await expect(dialog(page, 'Zercher carry')).toBeVisible();
  },
  'sheet-progress-checkin': async (page) => {
    await tab(page, 'Progress');
    await label(page, 'New photo check-in').click();
    await expect(dialog(page, 'Weekly check-in')).toBeVisible();
  },
  'sheet-targets-avoid': async (page) => {
    await tab(page, 'Targets');
    await label(page, 'Add an exercise to avoid').click();
    await expect(dialog(page, 'Exercise to avoid')).toBeVisible();
  },
  'sheet-targets-cant': async (page) => {
    await tab(page, 'Targets');
    await label(page, 'Add an exercise to avoid').click();
    const pick = dialog(page, 'Exercise to avoid').getByRole('button').nth(1);
    const name = await pick.getAttribute('aria-label');
    await pick.click();
    await expect(dialog(page, `Can’t do ${name}?`)).toBeVisible();
  },
};

for (const scheme of ['light', 'dark']) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });
    for (const [name, open] of Object.entries({ ...screens, ...sheets })) {
      test(`axe: ${name}`, async ({ page }) => {
        if (name === 'consent' || name.startsWith('setup')) await open(page);
        else {
          await completeSetup(page);
          await open(page);
        }
        await scan(page, name, scheme);
      });
    }
  });
}
