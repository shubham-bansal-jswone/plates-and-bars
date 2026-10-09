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
| Re-check cards and "can't do" (#111) | `recheckDue`, `recheckBack`, `recheckLater`, `recheckKeep`, `cantRule`, `widerRuleReplacements` | the filter in `recheckCards`; the `rule-back`, `rule-later`, `rule-keep` steps of `exAction`; the rule and the "caught by a wider rule" loop of `applyCant` | none (differential tests) |
| Ladders (#111) | `ladderOf`, `nextStep`, `prevStep`, `sidewaysOf`, `estimateFor`, `ladderCard`, `ladderSwap`, `ladderStayUntil`, `ESTIMATE_PAIRS` | same names; `ladderSwap` and `ladderStayUntil` are the `ladder-up`, `ladder-down`, `swap-side` and `ladder-stay` steps of `exAction`; `ESTIMATE_PAIRS` is `PAIR` | `exercises.json` (`ladders`; differential tests) |
| Weight guidance | `suggestBase`, `applyMods`, `setTarget`, `tickFill`, `rampRate`, `rampTickFill`, `exInfo`, `metaFor`, `applyCustomTags`, `customExerciseMeta`, `overridesFromSettings`, `lastFor`, `snap`, `harder`, `easier`, `kgLabel`, `noLoad`, `repWord`, `DEFAULT_STEP` | same names; `tickFill`, `rampRate`, `rampTickFill` are the `tick`, ramp `rate` and `ramp-tick` steps of `workoutAction`; `metaFor` is the `['other',8,12]` fallback in `exInfo`, `customExerciseMeta` the meta step of `applyCustomTags`; `overridesFromSettings` renames contract `exercise_overrides` to `settings.ex` | `progression.json` |
| Stalls and personal bests | `sessionScore`, `stalled`, `stalledList`, `inRange`, `recoveryCard`, `recoveryWeek`, `stallCard`, `stallRange`, `stallRangeOverride`, `checkBest`, `updateLift` | same names; `recoveryCard` is the stall step of `renderStart`, `recoveryWeek` and `stallRange` the `adj-deload` and `adj-range` steps of `adjAction`; `stallRangeOverride` is `stallRange` in contract `exercise_overrides` shape (#128) | none (differential tests) |
| Food screen | `searchFoods`, `unitGrams`, `quantityFromGrams`, `logTotals`, `fibreTarget`, `fruitVegServings`, `showAddedSugar`, `dayComplete`, `FRUIT_VEG_TARGET`, `kcalTarget`, `DEFAULT_KCAL_TARGET`, `planFlex`, `undoFlex`, `flexPlanFor`, `FLEX_FLOOR_DEFAULT`, `flexToast`, `stepServings`, `SERVINGS_MIN`, `SERVINGS_MAX`, `SERVINGS_STEP`, `highProtein`, `customFood`, `saveMyFood`, `MY_FOODS_MAX`, `FOOD_NAME_MAX`, `userFoodFacts` | `foodListHtml` query, `foodMatch` and badge, `unitGrams`, `case 'pick'` grams steps, `totals`, `fibreTotals` (`fibOf`, `produceOf`), `fibreTarget`, `fibreHtml`, `dayComplete`, `kcalTarget`, `planFlex` (its 1200 and its toast), `undoFlex` (`case 'flex-undo'`), `flexPlanFor` (`flexNoteHtml`), `case 'serv'`, `case 'addcustom'`, `allFoods` | `foods.json` (plus differential tests) |
| Recipes and kitchen tests | `recipeTotals`, `presetIngredients`, `stepRecipeLog`, `recipeFood`, `kitchenTest`, `kitchenTestFood`, `saveBuiltFood`, `ingredientGrams`, `UNIT_GRAMS`, `OIL_LEVEL`, `RECIPE_VEG_INGREDIENTS`, `FRUIT_VEG_SERVING_G`, `SUGAR_INGREDIENT`, `BUILT_FOODS_MAX`, `RECIPE_LOG_MIN`, `RECIPE_LOG_MAX`, `RECIPE_LOG_STEP` | `rbTotals`, `rbFromPreset` rows, `case 'rb-log'`, `case 'rb-save'`, `ktCalc`, `ktSave(true)`, `UNIT_G`, `OIL_LEVEL` (`RAW`, `RAW_FIB`, `FATTY`, `KATORI_G`, `PRESETS` read from content) | `foods.json` (`raw100g`, `rawFibre100g`), content/raw-ingredients.json and recipes.json checked against them (plus differential tests) |
| Default macro targets | `DEFAULT_PROTEIN_TARGET`, `DEFAULT_CARBS_TARGET`, `DEFAULT_FAT_TARGET` | `DEFAULT_SETTINGS.protein`, `.carbs`, `.fat` | none (differential test) |
| Coverage and focus picker | `plannedCoverage`, `coverageTemplates`, `doneCoverage`, `coverageRows`, `weeklyCoverage`, `focusPicker`, `toggleFocus`, `COVER_SHOW`, `COVER_LOW`, `COVER_FULL`, `FOCUS_MAX` | `weeklyCoverage`, `actualCoverage`, `coverageHtml`/`fillActualCoverage` rows, `focusHtml`, `focusAction`, `COVER_SHOW` | none (differential tests) |
| Progress: body and day targets | `latestWeight`, `measureAt`, `navyBodyFat`, `waterTarget`, `workoutBurn`, `stepsTarget`, `weightDrift`, `WATER_DEFAULT_ML`, `WATER_ML_PER_KG`, `WATER_TRAINING_ML`, `STEPS_DEFAULT`, `STEPS_MIN`, `STEPS_MAX`, `WEIGHT_DRIFT_KG` | `latestWeight`, `measureAt`, `navyBF`, `waterTarget`, `workoutBurn`, `stepsTarget`, the `drift` check in `setupSummaryHtml` (#161) | `formulas.json` (plus differential tests) |
| Progress: real burn, check-in, habits | `weeklyAvg`, `rapidLoss`, `addKcal`, `weightSlope`, `adaptiveBurn`, `nextAdaptive`, `targetFromBurn`, `weeklyCheckin`, `habits`, `KCAL_PER_KG`, `RAPID_LOSS_KCAL`, `CHECKIN_KCAL_STEP`, `CARDIO_WEEK_MIN` | `weeklyAvg`, `calorieCard`, `adjAction` `adj-kcal`, `weightSlope`, `adaptiveBurn`, the `settings.adaptive` update and facts of `renderCheckin`, `targetFromBurn`, `consistencyHtml` | none (differential tests) |
| Progress: weight and waist trend, entry limits (#233) | `weightSeries`, `waistSeries`, `trendChange`, `chartLayout`, `scaleJump`, `weightEntry`, `measurementRow`, `sleepEntry`, `round1`, `WEIGHT_CHART_POINTS`, `WAIST_CHART_POINTS`, `WEIGHT_CHART_BOX`, `WAIST_CHART_BOX`, `SCALE_JUMP_KG`, `SCALE_JUMP_DAYS`, `WEIGHT_ABOVE_KG`, `WEIGHT_BELOW_KG`, `TAPE_MIN_CM`, `TAPE_MAX_CM`, `SLEEP_MAX_H` | `weightChart`, `waistPts` and `change` in `measuresHtml`, `lineChart`, `case 'saveW'` (value, `S.ui.scaleJump`), `scaleJumpHtml`, `saveMeasures`, `r1`; `sleepEntry` and the limits follow the contract (`Weight`, `TapeCm`, `DayNote.sleep`), `weightEntry` rejects values that round to 20.0 or 400.0, and `sleepEntry` rejects text that is not a number (#247) | none (differential tests) |
| Meal ideas | `nextMealInfo`, `mealByTime`, `combos`, `combosFast`, `round05`, `ideasPage`, `OLDER_MEAL_PROTEIN_G`, `IDEAS_PER_PAGE`, `IDEAS_KCAL_LEFT_MIN`, `MEAL_ORDER` | same names (`mealByTime` takes the hour); `ideasPage` is the paging and protein note of `guidanceHtml`; `MEAL_ORDER` is `MEALS` | none (differential tests) |
| Meal plan and grocery list | `buildPlan`, `planItems`, `swapPlanMeal`, `planIsCurrent`, `planForMeal`, `planDayTotals`, `groceryList`, `groceryAmount`, `PLAN_DAYS`, `PLAN_OPTIONS`, `PLAN_ROTATION` | `buildPlan`, `planItems`, `case 'mp-swap'`, the saved-plan check and day line of `planSheet`, `planForMeal`, `grocerySheet` and its `fmtAmt` | none (differential tests) |
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
range), not HTML. Save "Switch to lo–hi" with `stallRangeOverride`, which returns the contract
`Settings.exercise_overrides[name]` entry (#128). The stall card's "Or switch to …" button shows when
`sidewaysOf` returns a name; pass where the user trains today (the day's override, else the
profile's), so it only offers an exercise the equipment there can do (#262). After a
settings sync, call `applyCustomTags` again so re-tagged custom exercises update mid-session.

Ladders read prototype `LADDERS` from content/exercises.json `ladders`, passed in a `LadderCatalog`
(`tags` and `ladders`). `ladderCard` returns facts (`up` or `down`, the target, the dismissal key), not
HTML; save its buttons with `ladderSwap` (contract `Swap` fields; a step up keeps the old exercise as a
bridge for 14 days) and `ladderStayUntil` (contract `Settings.ladder_stay`). Timed exclusions keep
applying after `until` until the user answers the re-check card: `recheckDue` lists the rules to ask
about, and `recheckBack`, `recheckLater` and `recheckKeep` return the answered rule (and, for "Try it
again", the `Settings.returning` entries to add). The "can't do" sheet saves `cantRule(...)` (add an
`id`; for a saved rule, also tombstone any swap from that exercise). It then applies
`widerRuleReplacements` to today's session, in the order returned.

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

The recipe and kitchen-test rules read their data from content, passed in as is: raw ingredients
(prototype `RAW`, `RAW_FIB` and `FATTY`) as content/raw-ingredients.json `ingredients` (`name`, `fatty`,
`per_100g`), the katori size (prototype `KATORI_G`) as content/recipes.json `katori_g`, and presets
(`PRESETS`) as content/recipes.json `presets[].ingredients`. Content owns those values; core keeps no copy.
Ingredients are looked up by their own name only (`constructor` and the like are unknown ingredients).
Ingredients come in the contract's `Ingredient` shape, recipes and kitchen tests in `Recipe` and
`KitchenTest` fields; amounts and weights are read with `num`, as the prototype reads its text boxes.
`recipeFood` and `kitchenTestFood` return contract `UserFood` fields (origin `recipe` or `kitchen_test`)
and, like `customFood` (#150), `name-too-long` for a trimmed name over 200 characters and `invalid` for an
ingredient amount, pot, cooked or serving weight below 0, where the prototype saves. An empty pot weighed
as 0 g counts (a tared scale, #214); a blank empty pot does not. Tests
check content against golden `raw100g` and `rawFibre100g` and the prototype's `FATTY`, `KATORI_G` and
`PRESETS`, then run the port on content against the prototype.

The meal-idea rules read their data from content, passed in as is: meal and protein weights, portion
caps and minimums (prototype `MEAL_W`, `PROT_W`, `MAXQ`, `MINQ`) as content/meal-planning.json, and foods
as content/foods.json `foods`, in that order (it breaks ties between equal scores, as `FOODS` order does).
Food roles (prototype `ROLE`) are content/meal-planning.json `roles` (`{ food, role, diet }`, #230); a test
checks them against the prototype's table, fasting-day rows included, in order. The combo shapes (sides with a main,
breakfast extras, the fasting-day pools) are the prototype's inline lists and stay in core. A food the
combos need but `foods` lacks is skipped, where the prototype throws. Ideas return the food objects passed
in, with unrounded totals; show them with `Math.round`, as the prototype does.

The weekly plan is contract `Settings.meal_plan` in the prototype's `mealPlan` shape (`start`, `opts` per
meal, `days[i][meal].k`). The grocery map (prototype `GROC`) is content/meal-planning.json `grocery`, passed in.
`groceryList` returns the sheet's rows sorted by item and the "Copy as text" lines in first-seen order, as
the prototype does (#240). `buildPlan` applies no 60+ protein floor, also as the prototype does (#239).
`planDayTotals` finds foods by name ignoring case: pass the user's foods first, then the shared ones.

## Browser support

Core runs in the web bundle too, and a regex the browser cannot parse stops the whole bundle loading. Do
not use regex lookbehind (`(?<=`, `(?<!`) or other regex features that Safari/iOS before 16.4 lacks; Babel
cannot transpile them. A test in `test/food.test.ts` fails if `src/` or the prototype contains `(?<` (#213).

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
