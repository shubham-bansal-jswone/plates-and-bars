# tools

Dependency-free content tooling (Node 20+). Run from this folder: `npm ci && npm run lint && npm test && node validate/cli.mjs && node validate/foods-cli.mjs && node check-no-ifct/cli.mjs`.

- `exercises-import/` regenerates `content/exercises.json` from `docs/spec/golden/exercises.json` plus `exerciseMeta` in `docs/spec/golden/progression.json` (`npm run import:exercises`). `meta` maps each exercise to `{type, rep_low, rep_high}` (names as in the contract's `exercise_overrides`; the golden table's `lo`/`hi`). Default step, the fallback for unknown exercises and the home-dumbbell raise are rules and stay in core. The validator requires meta for every exercise.
- `validate/` checks `content/exercises.json` (`npm run validate:exercises`) and `content/foods.json` (`npm run validate:foods`).
- `foods-import/` regenerates `content/foods.json` from `docs/spec/golden/foods.json` (`npm run import:foods`).
- `check-no-ifct/` exits non-zero if "IFCT" or "INDB" (any case) appears in a file name or file under `content/` (`npm run check:sources`). CI wiring lives in `.github/workflows/` (infra).

## Exercise card keys

The prototype's `CARDS` use one-letter keys. `content/exercises.json` uses these names, taken from how
`openHowTo`, `learnHtml` and `feelHtml` in `docs/prototype/plate-and-bar.html` render each field.
Values are unchanged. Tag keys are mapped separately (`TAG_KEYS` in `exercises-import/import.mjs`).

| Prototype | Content name | Type | Required | How the prototype uses it |
| --- | --- | --- | --- | --- |
| `f` | `where_to_feel` | string | yes | "Where you should feel it"; text before the first comma is the "felt it in the right place" button |
| `s` | `setup` | string[] | yes | "Setup" numbered steps |
| `c` | `key_cues` | string[] | yes | "3 key cues"; one cue is shown as "Focus this set" in learn mode |
| `m` | `common_mistakes` | string[] | yes | "Common mistakes" list |
| `w` | `misplaced_feel` | [label, fix][] | yes | Each pair is a "felt it in the wrong place" button: `label` is the button text, `fix` is shown as "Try this" |
| `b` | `breathing` | string | no | "Breathing"; the prototype falls back to a default sentence when absent |
| `e` | `easier_version` | string | no | "Easier version" hint |
| `h` | `harder_version` | string | no | "Harder version" hint |

The validator requires the five fields the prototype reads without a guard (`f s c m w`), type-checks the
optional ones, and rejects any other card key.

`misplaced_feel` must be non-empty. That is a content rule rather than a rendering requirement: every card
should offer at least one "felt it in the wrong place" fix.

## Food rows

`content/foods.json` rows follow `Food` in `packages/api/openapi.yaml` (per-serving values, carbs include fibre).
`source` is the contract `FoodSource` object, so its `reference` is the source id (null until a USDA FDC id is recorded).

- `source`: packaged whey, Greek yogurt and makhana are `label_typical`; paneer, curd and toned milk are `fssai`
  (prototype note); single plain foods are `usda_fdc` and composed dishes are `own_recipe` (ADR 005). Chicken breast, cooked (raw value / cooking yield) and buttermilk (80 g curd) are `own_recipe`.
- `HELD_BACK` in `foods-import/import.mjs` lists golden foods whose source the repo does not state; they are left out
  of `content/foods.json` rather than guessed. A golden food that is in neither `SOURCE_OF` nor `HELD_BACK` fails the import.
- `serving.grams` is the first "<n> g" in the serving label, as the prototype's `unitGrams` reads it, so `1 medium (30 g atta)`
  gives 30. Whether a bracketed ingredient weight should count (60 g of cooked rice logs 1.2 cups) is a spec question.
- `aliases` are the golden alias string split into words, except the phrases in `ALIAS_PHRASES` ("fox nut", "cottage cheese")
  which stay whole, so a client matching each alias on its own finds what the prototype's substring match finds.
- `name_hi` is null: the golden file has no Hindi script names. `id` is a name-based UUID (renaming a food changes its id);
  `updated_at` is one constant in the importer and must be bumped whenever a value changes.
- `fruit_veg_servings` comes from `PRODUCE` in the prototype (a test compares them).
- Validator macro rule: kcal within 15 kcal or 15 % of 4/4/9 (fibre counts as carbs, so high-fibre foods read a little low).

## Eat-out table

`content/eatout.json` holds the prototype's `EATOUT` table (cuisines with "smart picks" tips and dishes, including the Drinks group). It is a separate file from `foods.json` because it is a different shape: dishes are grouped by cuisine, carry tips, and are logged as one portion (`serving` is `1 serving`, `grams` null) rather than looked up by name.
Dishes are Food rows plus `cuisine` (and `alcohol: true` on the four alcoholic drinks).

- `npm run import:eatout` regenerates it from `docs/prototype/plate-and-bar.html`; a test fails if the file drifts from the prototype.
- `source` is `own_estimate` (ADR 005): our own rough estimates for a typical restaurant portion (the prototype calls them "rough restaurant estimates"; they are not weighed).
- Validation (`npm run validate:foods`, `validateEatOut`) applies the same Food checks, with names and ids unique across the file. Rows flagged `alcohol` skip the upper kcal bound (alcohol is about 7 kcal/g and is not in the macros) but kcal may not be below what the macros give.
- Beer, whisky/rum/vodka and wine are still held back from `foods.json` (see `HELD_BACK`); only their eat-out rows are in content.

## Recipes, raw ingredients and meal planning

Three files come from the prototype's recipe builder and meal-idea code (`npm run import:recipes`; a test fails if they drift from `docs/prototype/plate-and-bar.html`). Validate with `npm run validate:recipes`.

- `content/raw-ingredients.json`: `RAW` and `RAW_FIB`, per 100 g raw, carbs include fibre, `fibre_g` null where the prototype has none. `fatty` marks `FATTY` (oil, ghee, butter, cream). Source per row: paneer, curd and toned milk are `fssai`; whey protein, Greek yogurt and makhana are `label_typical`; poha (approximated from rice), the generic mixed-vegetable blend and fresh cream are `own_estimate`; the rest are `usda_fdc` as the prototype's note says (`SOURCE_OVERRIDE` in `recipes-import/import.mjs`). The USDA FDC ids are not recorded yet, so `source.reference` is null.
- `content/recipes.json`: `library` (the 9 recipes with steps, time, cost and tags) and `presets` (the 8 typical home-style versions). Ingredients use the contract's `Ingredient` shape (`ingredient`, `amount`, `unit`) and every name must be in `raw-ingredients.json`. Source is `own_recipe`. `katori_g` is the prototype's `KATORI_G`.
- `content/meal-planning.json`: meal and protein weights, per-food portion caps (`MAXQ`) and minimums (`MINQ`), and the grocery map (`GROC`). Every food named in the caps and grocery map must exist in `foods.json`.
- Every row carries `needs_dietitian_review: true` until a dietitian signs it off; the importer sets it, so clearing it is a deliberate content change.
- Validator rules: macros at most 100 g per 100 g, kcal within the 4/4/9 tolerance, fibre not above carbs, licence and source code present, unique names and ids, weights sum to 1, min portions not above max.
