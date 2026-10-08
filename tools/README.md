# tools

Dependency-free content tooling (Node 20+). Run from this folder: `npm ci && npm run lint && npm test && node validate/cli.mjs && node validate/foods-cli.mjs && node check-no-ifct/cli.mjs`.

- `exercises-import/` regenerates `content/exercises.json` from `docs/spec/golden/exercises.json` (`npm run import:exercises`).
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
  (prototype note); single plain foods are `usda_fdc` and composed dishes are `own_recipe` (ADR 002). Chicken breast, cooked (raw value / cooking yield) and buttermilk (80 g curd) are `own_recipe`.
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
