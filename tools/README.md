# tools

Dependency-free content tooling (Node 20+). Run from this folder: `npm ci && npm run lint && npm test && node validate/cli.mjs && node validate/foods-cli.mjs && node check-no-ifct/cli.mjs`.

- `exercises-import/` regenerates `content/exercises.json` from `docs/spec/golden/exercises.json` plus `exerciseMeta` in `docs/spec/golden/progression.json` (`npm run import:exercises`). `meta` maps each exercise to `{type, rep_low, rep_high}` (names as in the contract's `exercise_overrides`; the golden table's `lo`/`hi`). Default step, the fallback for unknown exercises and the home-dumbbell raise are rules and stay in core. The validator requires meta for every exercise.
- `validate/` checks `content/exercises.json` (`npm run validate:exercises`) and `content/foods.json` (`npm run validate:foods`).
- `foods-import/` regenerates `content/foods.json` from `docs/spec/golden/foods.json` (`npm run import:foods`).
- `cards-import/` regenerates `content/cards.json` (KB and LEARN), `content/measures.json` (MEASURES) and `content/labels.json` (MUSCLE, JOINT, replacement-reason phrases) from the prototype (`npm run import:cards`); `validate/cards-cli.mjs` checks them (`npm run validate:cards`) and rejects a card without a source. See "Cards, measures and labels" below.
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

## Cards, measures and labels

Everything is derived from the prototype by running its own code with stub state; no text is hand-typed.

- `cards.json`: `learn_order` is the card's index in the prototype's `LEARN` list (null if absent). `bulky` has `audience: "female"` and `learn_insert_at` (the index the prototype splices it into the list for female profiles).
- Body syntax for the three cards built from the user's numbers (`targets`, `protein`, `split`). `placeholders` lists `{name}` values and `sections` lists the optional inline sections. The app fills values from `packages/core`; the cards carry no numbers.
  - `{name}` is replaced by a value (`{kcal}`, `{protein_g}`, `{tdee}`, `{bmr}`, `{movement}`, `{training}`, `{digestion}`, `{weight}`, `{protein_floor}` = round(weight x 1.6), `{minutes}`, `{days}`, `{split_name}`).
  - `{?sec}text{/sec}` is shown only when the section applies; `{?sec}yes{:}no{/sec}` shows `no` otherwise. Sections do not nest.
  - Sections: `tdee` (profile present), `weight` (a weight is known), `minutes` (profile has session minutes), `new_lifter` (profile experience is new).
  - `split_names` (top level, keys "2" to "6") maps training days to `{split_name}`.
  - Tests render the body with all sections off (equals the prototype with no profile) and on (equals it with a stub profile).
- `measures.json`: `show: "always"`, or for hips `{ sex: "female", or_entered_that_day: true }` (shown for female profiles, or when a hips value is already entered for the selected day).
- `labels.json` replacement text, as in the prototype's `candidates()`: build the clauses in this order and join with ", ", then capitalise the first letter. (1) `works` with `{muscles}` = the shared primary muscles' labels joined "a, b and c" (two: "a and b"; one: "a"). (2) `same_movement` if the movement pattern matches. (3) `spares_joint` with `{joint}` when a joint was asked to be spared, otherwise `easier_on_joints` if pain was reported and the candidate loads fewer joints. (4) `easier_to_learn` if the form-learning flag is set and the candidate is easier. (5) `done_before` if the user has logged the lift.
