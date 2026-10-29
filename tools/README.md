# tools

Dependency-free content tooling (Node 20+). Run from this folder: `npm ci && npm run lint && npm test && node validate/cli.mjs && node validate/foods-cli.mjs && node check-no-ifct/cli.mjs`.

- `exercises-import/` regenerates `content/exercises.json` from `docs/spec/golden/exercises.json` plus `exerciseMeta` in `docs/spec/golden/progression.json` (`npm run import:exercises`). `meta` maps each exercise to `{type, rep_low, rep_high}` (names as in the contract's `exercise_overrides`; the golden table's `lo`/`hi`). Default step, the fallback for unknown exercises and the home-dumbbell raise are rules and stay in core. The validator requires meta for every exercise.
- `validate/` checks `content/exercises.json` (`npm run validate:exercises`) and `content/foods.json` (`npm run validate:foods`).
- `validate/exercise-images-cli.mjs` checks `content/exercise-images.json` (`npm run validate:exercise-images`; `node validate/cli.mjs` runs it too): own drawings only (`source` must be `own_drawing`; a third-party source needs an ADR first), licence allowlist CC-BY-4.0 or CC0-1.0, required fields, one or two frames of at most 8192 bytes each with a matching viewBox, an SVG allowlist parser in `validate/svg-allowlist.mjs` (exported, dependency-free, for the app to reuse; `validate/fixtures/svg-corpus.json` holds `{ name, svg, w, h, ok }` frames with the expected verdict, run by the tools test and by the app's port to prove parity: elements svg g line circle ellipse rect path title only, a fixed attribute list per element, double-quoted values, no `url(`, no `:` in names, no comments or entities beyond the basic five; colours only `none`, `currentColor` or `var(--fig-body|arm|hl|eq|bg)`), every key an exercise in `exercises.json`, no duplicate files, source ids or drawings. The JSON Schema is `validate/schemas/exercise-images.schema.json`. Each frame holds its SVG text inline (`svg`) so the bundle is one self-contained file; `file` is its unique logical name.
- `exercise-figures/` renders the SVG frames of every exercise the parametric rig has a pose for and writes them into `content/exercise-images.json` (`npm run import:figures`; `npm run check:figures` compares without writing). Most exercises get a start and an end frame; the timed isometric holds (`ISOMETRIC` in `generate.mjs`, each checked against the catalogue's `time` type) get one static frame. `rig.mjs` is the prototype's `AN` rig: its first 31 poses are ported unchanged and later poses are our own additions; a test compares every pose with the frozen output in `test/fixtures/an-poses.json` (see "Figure fixture" below); `generate.mjs` fixes the output style. Frames are 320 by 240, 1 to 2 KB each, drawn with `currentColor` for the body and `var(--fig-arm|hl|eq|bg)` for the rest, so the app supplies every colour from its theme. New poses go into `D` in `rig.mjs`, then rerun the importer. Deterministic: no clock, randomness or network.
- `exercise-motion/` turns MediaPipe 3D world landmarks into `content/exercise-motion.json` (own joint keyframes on our 19-joint skeleton; `npm run import:motion`, `npm run validate:exercise-motion`, `npm run fixture:motion`). The model run is an optional Python step; CI uses a committed synthetic landmark fixture and a golden output. `validate/exercise-motion.mjs` (also run by `node validate/cli.mjs`) enforces the schema in `validate/schemas/exercise-motion.schema.json`. See `exercise-motion/README.md` for the licence check, filming guide and pipeline parameters.
- `foods-import/` regenerates `content/foods.json` from `docs/spec/golden/foods.json` (`npm run import:foods`).
- `validate/labs-cli.mjs` checks `content/labs.json`, the lab-report wording (`npm run validate:labs`, #1070): the 14 marker tips, the notices and a required not-medical-advice line. It is hand-written, not imported; `content/labs.json` is the data of record; its tips were frozen from the prototype at tag `prototype-final` and no test pins their wording.
- `check-no-ifct/` exits non-zero if "IFCT" or "INDB" (IFCT in any case, INDB as `INDB` or `indb`/`Indb` not glued to a letter before it, so `findByText` passes) appears in a file name or file under `content/`, `apps/mobile/src/content/`, `apps/mobile/src/about/licences.json`, `apps/site/src/`, `tests/e2e/store/` or the backend's `src/main/resources/` and `src/test/resources/` (`npm run check:sources`; `SCAN_ROOTS` in `check.mjs`). Policy docs, agent prompts and its own fixtures are not scanned. CI runs it in the `tools` job, which the path filter in `infra/scripts/detect-changes.sh` starts for changes under those folders.

## Golden fixtures

`docs/spec/golden/*.json` is the data of record for `packages/core` tests. The prototype and the generator that produced them are retired (prototype frozen at tag `prototype-final`); golden fixtures are edited by hand only in a `spec-change` PR, together with the matching `packages/core` change. `content/*.json` is likewise the source of record for cards, measures, labels, eat-out, recipes, raw ingredients and meal planning; their importers are gone.

## Content id fixture

`test/fixtures/content-ids.json` pins every content id that saved user records point at: eat-out dishes, raw ingredients, library and preset recipes, foods (each `name -> id`) and card ids. The tools tests assert content equals it, so an id may not change or go; adding a row needs the fixture updated in the same PR. It was written once from `content/*.json` after checking each id against the retired importers' `dishId`, `idFor` and `foodId` (eat-out 32/32, raw 44/44, recipes 17/17, foods 42/42); the generator is not kept. Regenerate only to add rows: take the `name -> id` pairs from the content files.

## Figure fixture

`test/fixtures/an-poses.json` holds the rig output for all 69 poses at k = 0, 0.25, 0.5 and 1 with the colour map `{body:'B', arm:'A', hl:'H', eq:'E', bg:'G'}`. The first 31 poses were captured from the prototype's own `AN` and checked equal to the ported rig; the other 38 are a snapshot of our rig. It was written once from `docs/prototype/plate-and-bar.html` (sha256 `04e3585a6d96e6451d6c2596c45be483d4863aa5ee1864079febe3ac2f10d1f6`, git tag `prototype-final`); the generator is not kept. To change a pose on purpose, edit `rig.mjs`, then regenerate only the changed entries from the rig itself. One-time command, run in `tools/` with the HTML from the tag (`git show prototype-final:docs/prototype/plate-and-bar.html > /tmp/proto.html`, then use that path):

```
node --input-type=module -e "
import fs from 'node:fs'; import vm from 'node:vm';
import { AN } from './exercise-figures/rig.mjs';
const html = fs.readFileSync('/tmp/proto.html','utf8');
const s = html.indexOf('const AN = (() => {'), e = html.indexOf('\n})();', s) + 6;
const proto = vm.runInNewContext(html.slice(s,e)+'; AN', {});
const C = { body:'B', arm:'A', hl:'H', eq:'E', bg:'G' }, ks = [0,0.25,0.5,1], poses = {};
for (const n of AN.names) {
  const frames = ks.map(k => AN.frame(n,k,C));
  if (proto.names.includes(n)) ks.forEach((k,j) => { if (proto.frame(n,k,C) !== frames[j]) throw new Error(n); });
  poses[n] = frames;
}
fs.writeFileSync('test/fixtures/an-poses.json', JSON.stringify({ ks, colours: C, poses }, null, 1));"
```

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
`source` is the contract `FoodSource` object, so its `reference` is the source id (an FDC id and serving scaling for `usda_fdc` rows, null otherwise).

- `source`: packaged whey, Greek yogurt and makhana are `label_typical`; paneer, curd and toned milk are `fssai`
  (prototype note); single plain foods are `usda_fdc` and composed dishes are `own_recipe` (ADR 005). Chicken breast, cooked (raw value / cooking yield) and buttermilk (80 g curd) are `own_recipe`.
  The drinks (beer, whisky/rum/vodka, wine) are `usda_fdc` with their SR Legacy records (#824); `source.reference` says where the prototype's rounded values differ.
- `alcohol: true` marks the drinks (`ALCOHOLIC` in the importer), as on the eat-out drinks: their kcal include alcohol (7 kcal/g), so the validator lifts only the upper kcal bound. They have no prototype `FIB` row, so `fibre_g` and `added_sugar_g` are null (counted as without fibre data, as in the prototype).
- `HELD_BACK` in `foods-import/import.mjs` lists golden foods whose source the repo does not state (none at present); they are left out
  of `content/foods.json` rather than guessed. A golden food that is in neither `SOURCE_OF` nor `HELD_BACK` fails the import.
- `serving.grams` is the first "<n> g" in the serving label, as the prototype's `unitGrams` reads it, so `1 medium (30 g atta)`
  gives 30. Whether a bracketed ingredient weight should count (60 g of cooked rice logs 1.2 cups) is a spec question.
- `aliases` are the golden alias string split into words, except the phrases in `ALIAS_PHRASES` ("fox nut", "cottage cheese")
  which stay whole, so a client matching each alias on its own finds what the prototype's substring match finds.
- `name_hi` is null: the golden file has no Hindi script names. `id` is a name-based UUID (renaming a food changes its id);
  `updated_at` is one constant in the importer and must be bumped whenever a value changes.
- `fruit_veg_servings` comes from `PRODUCE` in the prototype (core `food.test.ts` compares the content rows with the prototype's `PRODUCE`).
- Validator macro rule: kcal within 15 kcal or 15 % of 4/4/9 (fibre counts as carbs, so high-fibre foods read a little low).

## Eat-out table

`content/eatout.json` holds the prototype's `EATOUT` table (cuisines with "smart picks" tips and dishes, including the Drinks group). It is a separate file from `foods.json` because it is a different shape: dishes are grouped by cuisine, carry tips, and are logged as one portion (`serving` is `1 serving`, `grams` null) rather than looked up by name.
Dishes are Food rows plus `cuisine` (and `alcohol: true` on the four alcoholic drinks). `fibre_g` and `added_sugar_g` come from the prototype's `FIB` by dish name, as its `fibOf` reads a logged name (only "Cola (330 ml)" has a row: 0 g fibre, 35 g added sugar); null otherwise.

- The eat-out importer is retired; `content/eatout.json` is now the data of record (frozen from the prototype at tag `prototype-final`); only Butter naan and Cola values are pinned by a test.
- `source` is `own_estimate` (ADR 005): our own rough estimates for a typical restaurant portion (the prototype calls them "rough restaurant estimates"; they are not weighed).
- Validation (`npm run validate:foods`, `validateEatOut`) applies the same Food checks, with names and ids unique across the file. Rows flagged `alcohol` skip the upper kcal bound (alcohol is about 7 kcal/g and is not in the macros) but kcal may not be below what the macros give.
- Beer, whisky/rum/vodka and wine are also in `foods.json` (searchable, with the prototype's "daru" aliases); the eat-out rows stay as the restaurant portions.

## Cards, measures and labels

Everything is derived from the prototype by running its own code with stub state; no text is hand-typed.

- `cards.json`: `learn_order` is the card's index in the prototype's `LEARN` list (null if absent). `bulky` has `audience: "female"` and `learn_insert_at` (the index the prototype splices it into the list for female profiles).
- `cards.json`: a held-back card (#212: `ramp`, `ladder`, `formfirst`) has `hidden: true` and a `hidden_reason`; absent means shown. This is the single list: the app and the site read it. Old copies without the field stay valid; the schema_version stays 1.
- Body syntax for the three cards built from the user's numbers (`targets`, `protein`, `split`). `placeholders` lists `{name}` values and `sections` lists the optional inline sections. The app fills values from `packages/core`; the cards carry no numbers.
  - `{name}` is replaced by a value (`{kcal}`, `{protein_g}`, `{tdee}`, `{bmr}`, `{movement}`, `{training}`, `{digestion}`, `{weight}`, `{protein_floor}`, supplied by `packages/core` in the app, not computed from 1.6 here, `{minutes}`, `{days}`, `{split_name}`).
  - `{?sec}text{/sec}` is shown only when the section applies; `{?sec}yes{:}no{/sec}` shows `no` otherwise. Sections do not nest.
  - Sections: `tdee` (profile present), `weight` (a weight is known), `minutes` (profile has session minutes), `new_lifter` (profile experience is new).
  - `split_names` (top level, keys "2" to "6") maps training days to `{split_name}`.
  - Tests check the structure of the placeholders and sections; `content/cards.json` is the data of record (frozen from the prototype at tag `prototype-final`) and no test pins card text.
- `measures.json`: `show: "always"`, or for hips `{ sex: "female", or_entered_that_day: true }` (shown for female profiles, or when a hips value is already entered for the selected day).
- `labels.json` replacement text, as in the prototype's `candidates()`: build the clauses in this order and join with ", ", then capitalise the first letter. (1) `works` with `{muscles}` = the shared primary muscles' labels joined "a, b and c" (two: "a and b"; one: "a"). (2) `same_movement` if the movement pattern matches. (3) `spares_joint` with `{joint}` when a joint was asked to be spared, otherwise `easier_on_joints` if pain was reported and the candidate loads fewer joints. (4) `easier_to_learn` if the form-learning flag is set and the candidate is easier. (5) `done_before` if the user has logged the lift.

## Recipes, raw ingredients and meal planning

Three files come from the prototype's recipe builder and meal-idea code (importer retired; `content/*.json` is the data of record, frozen from the prototype at tag `prototype-final`; no test compares them with the HTML). Validate with `npm run validate:recipes`.

- `content/raw-ingredients.json`: `RAW` and `RAW_FIB`, per 100 g raw, carbs include fibre, `fibre_g` 0 where `RAW_FIB` has no entry (the prototype counts it as 0). `fatty` marks `FATTY` (oil, ghee, butter, cream). Source per row: paneer, curd and toned milk are `fssai`; whey protein, Greek yogurt and makhana are `label_typical`; poha (approximated from rice) and the generic mixed-vegetable blend are `own_estimate`; fresh cream is `label_typical`; the rest are `usda_fdc` as the prototype's note says (the retired recipes importer's `SOURCE_OVERRIDE`). Rows that borrow another USDA entry (`USDA_PROXY`: chana dal, moong dal, whole moong, chicken curry cut) say so in `source.name`. Each `usda_fdc` row records its SR Legacy FDC id in `source.reference` (per 100 g, with a note where the record is a proxy or has an identical twin); `Oil` is left null because the generic 884 kcal / 100 g fits every refined cooking oil (`FDC_UNMATCHED`).
- `content/recipes.json`: `library` (the 9 recipes with steps, time, cost and tags) and `presets` (the 8 typical home-style versions). Ingredients use the contract's `Ingredient` shape (`ingredient`, `amount`, `unit`) and every name must be in `raw-ingredients.json`. Source is `own_recipe`. `katori_g` is the prototype's `KATORI_G`.
- `content/meal-planning.json`: meal and protein weights, per-food portion caps (`MAXQ`) and minimums (`MINQ`), and the grocery map (`GROC`). Every food named in the caps and grocery map must exist in `foods.json`.
- Every row carries `needs_dietitian_review: true` until a dietitian signs it off; the importer sets it, so clearing it is a deliberate content change.
- Validator rules: macros at most 100 g per 100 g, kcal within the 4/4/9 tolerance, fibre not above carbs, licence and source code present, unique names and ids, weights sum to 1, min portions not above max.
