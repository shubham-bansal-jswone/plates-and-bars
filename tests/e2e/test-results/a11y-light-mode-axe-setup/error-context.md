# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: a11y.spec.mjs >> light mode >> axe: setup
- Location: specs/a11y.spec.mjs:74:7

# Error details

```
Error: setup: the known failure no longer happens, remove it from KNOWN

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "aria-required-attr",
+ ]
```

# Page snapshot

```yaml
- main [ref=e10]:
  - generic [ref=e11]:
    - generic [ref=e12]: Step 1 of 4
    - button "Skip for now" [ref=e13] [cursor=pointer]
  - heading "Let’s work out your targets" [level=1] [ref=e15]
  - generic [ref=e16]: Four quick steps. You can change any answer later.
  - generic [ref=e17]:
    - generic [ref=e18]: Sex
    - radiogroup "Sex" [ref=e19]:
      - radio "Male" [ref=e20] [cursor=pointer]
      - radio "Female" [ref=e22] [cursor=pointer]
    - generic [ref=e24]: Used only for the calorie formula, which differs by sex.
  - generic [ref=e25]:
    - generic [ref=e26]: Age
    - textbox "Age" [ref=e28]:
      - /placeholder: Years
  - generic [ref=e29]:
    - generic [ref=e30]: Height
    - generic [ref=e31]:
      - textbox "Height feet" [ref=e32]:
        - /placeholder: ft
      - textbox "Height inches" [ref=e33]:
        - /placeholder: in
      - button "Use cm" [ref=e34] [cursor=pointer]
  - generic [ref=e36]:
    - generic [ref=e37]: Weight (kg)
    - textbox "Weight in kg" [ref=e39]:
      - /placeholder: kg
  - button "Continue" [ref=e40] [cursor=pointer]
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
     |                                                                                       ^ Error: setup: the known failure no longer happens, remove it from KNOWN
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