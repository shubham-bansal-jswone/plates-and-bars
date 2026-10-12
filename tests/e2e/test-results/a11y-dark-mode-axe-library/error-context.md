# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: a11y.spec.mjs >> dark mode >> axe: library
- Location: specs/a11y.spec.mjs:74:7

# Error details

```
Error: library: the known failure no longer happens, remove it from KNOWN

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 4

- Array []
+ Array [
+   "aria-required-attr",
+   "label-content-name-mismatch",
+ ]
```

# Page snapshot

```yaml
- generic [ref=e9]:
  - generic [ref=e11]:
    - button "Back" [ref=e12] [cursor=pointer]
    - heading "Exercise library" [level=1] [ref=e14]
    - textbox "Search exercises" [ref=e15]
    - generic [ref=e16]:
      - generic [ref=e17]: Equipment
      - radiogroup "Equipment filter" [ref=e18]:
        - radio "All" [checked] [ref=e19] [cursor=pointer]
        - radio "Barbell" [ref=e21] [cursor=pointer]
        - radio "Dumbbell" [ref=e23] [cursor=pointer]
        - radio "Machine" [ref=e25] [cursor=pointer]
        - radio "Cable" [ref=e27] [cursor=pointer]
        - radio "Bodyweight" [ref=e29] [cursor=pointer]
    - generic [ref=e31]:
      - generic [ref=e32]: Muscle
      - radiogroup "Muscle filter" [ref=e33]:
        - radio "All" [checked] [ref=e34] [cursor=pointer]
        - radio "Chest" [ref=e36] [cursor=pointer]
        - radio "Front shoulders" [ref=e38] [cursor=pointer]
        - radio "Side shoulders" [ref=e40] [cursor=pointer]
        - radio "Rear shoulders" [ref=e42] [cursor=pointer]
        - radio "Triceps" [ref=e44] [cursor=pointer]
        - radio "Lats" [ref=e46] [cursor=pointer]
        - radio "Upper back" [ref=e48] [cursor=pointer]
        - radio "Biceps" [ref=e50] [cursor=pointer]
        - radio "Quads" [ref=e52] [cursor=pointer]
        - radio "Hamstrings" [ref=e54] [cursor=pointer]
        - radio "Glutes" [ref=e56] [cursor=pointer]
        - radio "Calves" [ref=e58] [cursor=pointer]
        - radio "Abs" [ref=e60] [cursor=pointer]
        - radio "Lower back" [ref=e62] [cursor=pointer]
    - generic [ref=e64]:
      - generic [ref=e65]: Type
      - radiogroup "Type filter" [ref=e66]:
        - radio "All" [checked] [ref=e67] [cursor=pointer]
        - radio "Barbell" [ref=e69] [cursor=pointer]
        - radio "Dumbbells" [ref=e71] [cursor=pointer]
        - radio "Machine" [ref=e73] [cursor=pointer]
        - radio "Cable" [ref=e75] [cursor=pointer]
        - radio "Assisted machine" [ref=e77] [cursor=pointer]
        - radio "Bodyweight" [ref=e79] [cursor=pointer]
        - radio "Other" [ref=e81] [cursor=pointer]
        - radio "Timed hold" [ref=e83] [cursor=pointer]
    - generic [ref=e85]: 71 of 71 exercises
  - button "Archer Push-ups Bodyweight · Chest" [ref=e87] [cursor=pointer]:
    - generic [ref=e88]: Archer Push-ups
    - generic [ref=e89]: Bodyweight · Chest
  - button "Assisted Dips Machine · Triceps, Chest" [ref=e91] [cursor=pointer]:
    - generic [ref=e92]: Assisted Dips
    - generic [ref=e93]: Machine · Triceps, Chest
  - button "Assisted Pull-up Machine · Lats" [ref=e95] [cursor=pointer]:
    - generic [ref=e96]: Assisted Pull-up
    - generic [ref=e97]: Machine · Lats
  - button "Backpack Row Bodyweight · Lats, Upper back" [ref=e99] [cursor=pointer]:
    - generic [ref=e100]: Backpack Row
    - generic [ref=e101]: Bodyweight · Lats, Upper back
  - button "Barbell Back Squat Barbell · Quads, Glutes" [ref=e103] [cursor=pointer]:
    - generic [ref=e104]: Barbell Back Squat
    - generic [ref=e105]: Barbell · Quads, Glutes
  - button "Barbell Bench Press Barbell · Chest" [ref=e107] [cursor=pointer]:
    - generic [ref=e108]: Barbell Bench Press
    - generic [ref=e109]: Barbell · Chest
  - button "Barbell Romanian Deadlift Barbell · Hamstrings, Glutes" [ref=e111] [cursor=pointer]:
    - generic [ref=e112]: Barbell Romanian Deadlift
    - generic [ref=e113]: Barbell · Hamstrings, Glutes
  - button "Barbell Row Barbell · Upper back, Lats" [ref=e115] [cursor=pointer]:
    - generic [ref=e116]: Barbell Row
    - generic [ref=e117]: Barbell · Upper back, Lats
  - button "Bench Dips Bodyweight · Triceps" [ref=e119] [cursor=pointer]:
    - generic [ref=e120]: Bench Dips
    - generic [ref=e121]: Bodyweight · Triceps
  - button "Bodyweight Pull-up Bodyweight · Lats" [ref=e123] [cursor=pointer]:
    - generic [ref=e124]: Bodyweight Pull-up
    - generic [ref=e125]: Bodyweight · Lats
  - button "Bodyweight Squat Bodyweight · Quads, Glutes" [ref=e127] [cursor=pointer]:
    - generic [ref=e128]: Bodyweight Squat
    - generic [ref=e129]: Bodyweight · Quads, Glutes
  - button "Bulgarian Split Squat Bodyweight · Quads, Glutes" [ref=e131] [cursor=pointer]:
    - generic [ref=e132]: Bulgarian Split Squat
    - generic [ref=e133]: Bodyweight · Quads, Glutes
  - button "Cable Crossover Cable · Chest" [ref=e135] [cursor=pointer]:
    - generic [ref=e136]: Cable Crossover
    - generic [ref=e137]: Cable · Chest
  - button "Cable Crunch Cable · Abs" [ref=e139] [cursor=pointer]:
    - generic [ref=e140]: Cable Crunch
    - generic [ref=e141]: Cable · Abs
  - button "Cable Curl Cable · Biceps" [ref=e143] [cursor=pointer]:
    - generic [ref=e144]: Cable Curl
    - generic [ref=e145]: Cable · Biceps
```

# Test source

```ts
  1  | import { axeSource, completeSetup, expect, label, openApp, tab, test } from '../support/app.mjs';
  2  | 
  3  | // axe-core on the main screens, in light and dark (WCAG 2.0/2.1 A and AA rules, which include colour contrast).
  4  | // Every violation fails the test. A rule that fails because of a filed bug is listed in KNOWN with the issue number, so
  5  | // the test still guards everything else on that screen; once the bug is fixed the stale entry fails the test, so remove it.
  6  | const KNOWN = {
  7  |   setup: ['aria-required-attr'], // #366: role=radio without aria-checked
  8  |   library: ['aria-required-attr', 'label-content-name-mismatch'], // #366, #367
  9  | };
  10 | // Real defects that axe reports only some of the time (its name check is heuristic): ignored, present or not.
  11 | const FLAKY = {
  12 |   food: ['label-content-name-mismatch'], // #371: "What should I eat next?" card name omits "Show"
  13 | };
  14 | 
  15 | async function scan(page, name, scheme) {
  16 |   await page.evaluate(axeSource);
  17 |   const { violations } = await page.evaluate(() => globalThis.axe.run({ runOnly: { type: 'rule', values: ['region', 'landmark-one-main', 'page-has-heading-one'] } }));// , 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  18 |   const known = KNOWN[`${name}/${scheme}`] ?? KNOWN[name] ?? [];
  19 |   const flaky = FLAKY[name] ?? [];
  20 |   const found = violations.filter((v) => !known.includes(v.id) && !flaky.includes(v.id));
  21 |   const stale = known.filter((id) => !violations.some((v) => v.id === id));
> 22 |   expect(stale, `${name}: the known failure no longer happens, remove it from KNOWN`).toEqual([]);
     |                                                                                       ^ Error: library: the known failure no longer happens, remove it from KNOWN
  23 |   const summary = found.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 5).map((n) => `    ${n.target.join(' ')}  ${n.failureSummary?.split('\n')[1] ?? ''}`).join('\n')}`);
  24 |   expect(summary, `${name} in ${scheme} mode`).toEqual([]);
  25 | }
  26 | 
  27 | const screens = {
  28 |   consent: async (page) => {
  29 |     await openApp(page);
  30 |     await expect(label(page, 'Continue')).toBeVisible({ timeout: 40_000 });
  31 |   },
  32 |   setup: async (page) => {
  33 |     await openApp(page);
  34 |     await label(page, 'I understand and agree to my data being stored as described').click();
  35 |     await label(page, 'Continue').click();
  36 |     await expect(label(page, 'Male')).toBeVisible();
  37 |   },
  38 |   food: async (page) => tab(page, 'Food'),
  39 |   workout: async (page) => {
  40 |     await tab(page, 'Workout');
  41 |     await expect(page.locator('[aria-label^="Start "]').first()).toBeVisible();
  42 |   },
  43 |   progress: async (page) => {
  44 |     await tab(page, 'Progress');
  45 |     await expect(label(page, 'Save weight')).toBeVisible();
  46 |   },
  47 |   targets: async (page) => tab(page, 'Targets'),
  48 |   data: async (page) => {
  49 |     await tab(page, 'Targets');
  50 |     await label(page, 'Download or delete my data').click();
  51 |     await expect(label(page, 'Download my data')).toBeVisible();
  52 |   },
  53 |   library: async (page) => {
  54 |     await tab(page, 'Targets');
  55 |     await label(page, 'Exercise library').click();
  56 |     await expect(label(page, 'Search exercises')).toBeVisible();
  57 |   },
  58 |   about: async (page) => {
  59 |     await tab(page, 'Targets');
  60 |     await label(page, 'About and sources').click();
  61 |     await expect(page.getByRole('heading', { name: /about/i })).toBeVisible();
  62 |   },
  63 |   recipes: async (page) => {
  64 |     await tab(page, 'Food');
  65 |     await page.locator('[aria-label^="Recipes for breakfast"]').click();
  66 |     await expect(label(page, 'Blank')).toBeVisible();
  67 |   },
  68 | };
  69 | 
  70 | for (const scheme of ['light', 'dark']) {
  71 |   test.describe(`${scheme} mode`, () => {
  72 |     test.use({ colorScheme: scheme });
  73 |     for (const [name, open] of Object.entries(screens)) {
  74 |       test(`axe: ${name}`, async ({ page }) => {
  75 |         if (name === 'consent' || name === 'setup') await open(page);
  76 |         else {
  77 |           await completeSetup(page);
  78 |           await open(page);
  79 |         }
  80 |         await scan(page, name, scheme);
  81 |       });
  82 |     }
  83 |   });
  84 | }
  85 | 
```