# @plate-and-bar/core

The app's rules (targets, plan engine, progression, burn, food maths) ported from the prototype
(`docs/prototype/plate-and-bar.html`) into pure TypeScript. No DOM, no storage, no I/O, no clock:
anything that depends on the date takes `now` as an argument. The app and backend import rules from
here instead of re-typing numbers.

Each export in `src/index.ts` names the prototype function it mirrors. The port keeps the prototype's
behaviour exactly, rounding included. Where the prototype looks wrong, the behaviour is kept, pinned
by a test marked `PINNED QUIRK`, and raised as a `spec-question` issue.

## What's here

| Area | Exports | Prototype | Fixture |
| --- | --- | --- | --- |
| Setup targets | `calcTargets`, `bmrOf`, `ACTIVITY_MULTIPLIER`, `PACE_ADJ`, `TRAIN_NET_MET` | `calcTargets`, `bmrOf`, `ACTIVITY`, `PACE`, `TRAIN_NET_MET` | `targets.json` |
| Setup flow | `validateSetupStep`, `validateSetup`, `normaliseSetup`, `toTargetsProfile`, `ftInToCm`, `cmToFtIn`, `setupSummary`, `AGE_MIN`, `AGE_MAX`, `HEIGHT_MIN_CM`, `HEIGHT_MAX_CM`, `WEIGHT_MIN_KG`, `WEIGHT_MAX_KG`, `SESSION_MINUTES`, `DAY_CHOICES`, `SETUP_STEPS`, `SCREEN_QUESTIONS`, `BURN_RANGE`, `PACE_STEADY_KCAL`, `DEFICIT_CAP_KCAL` | `validateStep`, `setupAction('su-apply')`, `heightText`, `setupResultHtml`, the `renderSetup` chips | none (differential tests) |
| Health check | `needsClearance`, `screenFlag` | `needsClearance`, `screenFlag` | none (unit tests) |
| Plan engine | `planned`, `splitFor`, `planList`, `dayTemplate`, `exerciseCap`, `beginnerRamp`, `older`, `TEMPLATES`, `ORDER`, `SPLITS` | same names (`beginnerRamp` is inline in `setsFor`) | `plan.json` |
| Session building | `mapForWhere` (home mapping), `trimSession`, `applyFocus`, `focusPick`, `isFocus`, `muscleAllowed`, `shortSession`, `setsFor`, `sessionSets`, `COMPOUND`, `BALANCE_EXERCISE` | same names; `shortSession` and `sessionSets` are the inline steps of `buildSession` | `sessions.json` |
| Exclusions and swaps | `resolveSession`, `resolveName`, `candidates`, `ruleMatches`, `activeRules`, `isExcluded`, `replFromSwaps` | same names; `replFromSwaps` builds `settings.repl` from contract swaps | `exercises.json` (catalogue only; differential tests) |
| Weight guidance | `suggestBase`, `applyMods`, `setTarget`, `tickFill`, `rampRate`, `rampTickFill`, `exInfo`, `metaFor`, `applyCustomTags`, `customExerciseMeta`, `overridesFromSettings`, `lastFor`, `snap`, `harder`, `easier`, `kgLabel`, `noLoad`, `repWord`, `DEFAULT_STEP` | same names; `tickFill`, `rampRate`, `rampTickFill` are the `tick`, ramp `rate` and `ramp-tick` steps of `workoutAction`; `metaFor` is the `['other',8,12]` fallback in `exInfo`, `customExerciseMeta` the meta step of `applyCustomTags`; `overridesFromSettings` renames contract `exercise_overrides` to `settings.ex` | `progression.json` |
| Stalls and personal bests | `sessionScore`, `stalled`, `stalledList`, `inRange`, `recoveryCard`, `recoveryWeek`, `stallCard`, `stallRange`, `checkBest`, `updateLift` | same names; `recoveryCard` is the stall step of `renderStart`, `recoveryWeek` and `stallRange` the `adj-deload` and `adj-range` steps of `adjAction` | none (differential tests) |
| Food screen | `searchFoods`, `unitGrams`, `quantityFromGrams`, `logTotals`, `fibreTarget`, `fruitVegServings`, `showAddedSugar`, `dayComplete`, `FRUIT_VEG_TARGET`, `kcalTarget`, `DEFAULT_KCAL_TARGET`, `stepServings`, `SERVINGS_MIN`, `SERVINGS_MAX`, `SERVINGS_STEP`, `highProtein`, `customFood`, `saveMyFood`, `MY_FOODS_MAX`, `FOOD_NAME_MAX`, `userFoodFacts` | `foodListHtml` query, `foodMatch` and badge, `unitGrams`, `case 'pick'` grams steps, `totals`, `fibreTotals` (`fibOf`, `produceOf`), `fibreTarget`, `fibreHtml`, `dayComplete`, `kcalTarget`, `case 'serv'`, `case 'addcustom'`, `allFoods` | `foods.json` (plus differential tests) |
| Helpers | `num`, `mondayOf`, `daysBetween`, `weekdayOf`, `addDays` | `num`, `mondayOf`, `daysBetween`, `parseYmd(d).getDay()`, `addDays` | none |

`calcTargets` returns the same fields as the prototype, unrounded where the prototype leaves them
unrounded (bmr, movement, training, digestion, tdee, weekly). Display them with `Math.round`, as the
prototype's `fmt` does. `kcal`, `protein`, `fat` and `carbs` come back already rounded.

The session rules read exercise content (prototype `TAGS`, `CARDS`, `AWAY`) through an
`ExerciseCatalog` argument instead of copying it: that data belongs to `content/` (spec item 4). Pass
`content/exercises.json` as is: tags use content's names (`pattern`, `family`, `equipment`,
`difficulty`, `primary`, `secondary`, `joints`) and the away map is read from
`away_map.dumbbells_bodyweight`; of `cards`, only whether a name has one is read. Tests build the
catalogue from `golden/exercises.json`, renaming the prototype's short tag names in
`test/prototype-plan.ts`, and a test checks that content/exercises.json matches it. `resolveSession` takes exclusions and swaps in the
contract's `Exclusion` and `Swap` shapes (records with `deleted_at` set are ignored; `until` is not read,
as in the prototype) and returns the items `trimSession` expects; pass `replFromSwaps(swaps)` as
`trimSession`'s `repl`. `candidates` returns the facts behind the prototype's `why` text, not the text. Merge custom-exercise
tags (contract `Settings.custom_tags`) into the catalogue first with `applyCustomTags`, as the prototype does. `candidates` leaves out only the
names passed in `inSession` (the prototype leaves out today's workout by default).

The weight guidance reads prototype `EX_META` from the catalogue's `meta` (content/exercises.json
`meta`: `name → { type, rep_low, rep_high }`, the prototype's `[type, lo, hi]`), passed as
`ProgressionContext.catalog` or to `exInfo`. Names the catalogue lacks get other, 8–12 (`metaFor`).
`applyCustomTags(catalog, settings.custom_tags)` adds custom exercises: their tags, and meta from their
equipment with 8–12 reps, never replacing meta a name already has. The user's per-exercise settings
are read in the prototype's shape (`type`, `lo`, `hi`, `step`); build them from contract
`Settings.exercise_overrides` with `overridesFromSettings`. Tests use content/exercises.json; a test
checks its `meta` equals golden/progression.json's `exerciseMeta`, and another that the fixture equals
the prototype's `EX_META`.

Setup validation returns a `SetupError` code per prototype message, not the copy; the app maps codes
to text. `normaliseSetup` returns the contract `Profile` fields (snake_case, targets included) that
"Use these targets" saves. It differs from the prototype's stored object in three ways the contract
asks for: at 0 days `exp` and `minutes` are `null` (the prototype stores `minutes: 0` and keeps any
earlier `exp`), a missing `where` is `gym` (what prototype `homeWhere` reads), and `screen` is an array.
`setupSummary` returns the results screen's numbers and which notes show, in the prototype's order.

Stalls and personal bests read each lift's `hist` (scores rounded to 0.1, last 8) and `pbToast`
(contract `LiftStat.history` with `score`, and `pb_toast_date`). `updateLift` writes both, as the
prototype does after every tick, rating or form change, except that a same-day record keeps its
`pbToast` so the best toast shows at most once a day (#121; the prototype follows in a spec-change PR). Cards come back as facts (key, names, rep
range), not HTML; the stall card's "Or switch to …" button (`sidewaysOf`) waits for the ladder port.

The food rules take foods in content/foods.json's `Food` shape and logs in the contract's `FoodLog`
shape (logs with `deleted_at` set are left out). Fibre, added sugar and fruit and veg are looked up by
the log's exact name, as the prototype does (`food_id` is not read): pass the shared foods, then the
user's foods as `FoodFacts`. Totals come back unrounded; show energy, fibre and sugar with `Math.round`
and fruit and veg to 0.1, as the prototype does. `dayComplete` takes the settings calorie target, not the
flexed one, and applies its fallback (3 or more logs, 75% of target) to every day, today included.
`quantityFromGrams` returns `too-small` where the prototype logs 0 servings (#150; the prototype
follows in the next spec-change batch), and `customFood` returns `name-too-long` for a trimmed name over
`FOOD_NAME_MAX` (200) characters, the contract limit, and `invalid` for a negative calorie or macro value or
a quantity at or below 0 (#150). `MY_FOODS_MAX` (60) caps the my-foods list only; recipe and kitchen-test
saves keep the prototype's 80. Turn a contract `UserFood` into the food-maths inputs with
`userFoodFacts`. A log takes fibre from the first food with its name *and* fibre data, where the
prototype takes the first user food with its name and then checks its fibre; the two differ only when
two user foods share a name, which the prototype's save prevents but the contract does not (#151,
revisit with `food_id` lookups).

## Running

Node 20 or later.

```sh
npm ci
npm run lint          # tsc --noEmit (no eslint yet)
npm run typecheck     # tsc --noEmit
npm test              # jest
npm run test:coverage # jest with a 90% line-coverage threshold
```

## How the golden tests work

`docs/spec/golden/<area>.json` holds input/output pairs generated from the prototype. Tests load them
from the repo root (`test/helpers.ts`, `loadGolden`) and check every case. Never edit or regenerate
these files here; a prototype change lands them in a `spec-change` PR, and this package follows.

The fixtures store display-rounded numbers, so the test projects the port's result onto the fixture
shape before comparing (`toGolden` in `test/targets.test.ts`): energy values with `Math.round`,
`weeklyKg` to 2 decimals, `refWeight` from `refW`.
The fixture does not say how `weeklyKg` was rounded. The test uses `Math.round(x * 100) / 100`.
`Number(x.toFixed(2))` gives the same result for every current fixture value, because none of them
sits at a half cent. The two would only differ on a future value at a half, such as -0.125.

Alongside the fixtures, differential tests slice the prototype's own functions out of the HTML, run
them, and compare them field by field with the port over a grid of inputs (20,160 profiles for
`calcTargets`, every combination for `needsClearance`). If the prototype changes shape, these tests
fail loudly at the slice step rather than passing silently.
