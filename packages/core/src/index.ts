/**
 * Public API of @plate-and-bar/core. Every export mirrors a function or table in
 * docs/prototype/plate-and-bar.html; the prototype name is given beside it.
 */

/** Mirrors prototype `num`. */
export { num } from './num';

/**
 * Setup targets.
 * - `calcTargets` mirrors prototype `calcTargets(p)`.
 * - `bmrOf` mirrors prototype `bmrOf(p, w)`.
 * - `ACTIVITY_MULTIPLIER` mirrors prototype `ACTIVITY[k].m`.
 * - `PACE_ADJ` mirrors prototype `PACE[k].adj`.
 * - `TRAIN_NET_MET` mirrors prototype `TRAIN_NET_MET`.
 * - `DEFICIT_CAP_KCAL` mirrors the 750 kcal deficit cap in prototype `calcTargets`.
 */
export { calcTargets, bmrOf, ACTIVITY_MULTIPLIER, PACE_ADJ, TRAIN_NET_MET, DEFICIT_CAP_KCAL } from './targets';
export type { TargetsProfile, TargetsResult, Sex, Activity, Goal, Pace, Special } from './targets';

/**
 * Setup flow: validation, the saved profile, and the results screen's values.
 * - `validateSetupStep` mirrors prototype `validateStep()` (step passed in), returning a `SetupError` code, not copy.
 * - `validateSetup` runs `validateSetupStep` over steps 0–3, as "Continue" does one step at a time.
 * - `normaliseSetup` mirrors the cleaning in `validateStep()` plus the `su-apply` step of `setupAction`, in contract `Profile` names.
 * - `toTargetsProfile` maps contract `Profile` names to the prototype names `calcTargets` reads.
 * - `ftInToCm` mirrors the ft/in → cm step of `validateStep()`; `cmToFtIn` mirrors `heightText(cm)` and `startSetup`.
 * - `setupSummary` mirrors the values in prototype `setupResultHtml()`: burn range, pace, deficit percent, notes.
 * - `AGE_MIN`/`AGE_MAX`, `HEIGHT_MIN_CM`/`HEIGHT_MAX_CM`, `WEIGHT_MIN_KG`/`WEIGHT_MAX_KG` mirror the limits in `validateStep()`.
 * - `SESSION_MINUTES`, `DAY_CHOICES` mirror the chips in `renderSetup()`; `SETUP_STEPS` its "of 4"; `SCREEN_QUESTIONS` is `SCREEN_Q.length`.
 * - `BURN_RANGE`, `PACE_STEADY_KCAL` mirror the 0.9/1.1 range and ±20 kcal pace bands in `setupResultHtml()`.
 */
export {
  validateSetupStep,
  validateSetup,
  normaliseSetup,
  toTargetsProfile,
  ftInToCm,
  cmToFtIn,
  setupSummary,
  AGE_MIN,
  AGE_MAX,
  HEIGHT_MIN_CM,
  HEIGHT_MAX_CM,
  WEIGHT_MIN_KG,
  WEIGHT_MAX_KG,
  SESSION_MINUTES,
  DAY_CHOICES,
  SETUP_STEPS,
  SCREEN_QUESTIONS,
  BURN_RANGE,
  PACE_STEADY_KCAL,
} from './setup';
export type { SetupAnswers, SetupError, SetupProfile, SetupTargets, PreviousProfile, HeightUnit, SetupSummary, SetupPace, SetupNote } from './setup';

/**
 * Health check.
 * - `needsClearance` mirrors prototype `needsClearance()` (profile passed in instead of read from state).
 * - `screenFlag` mirrors prototype `screenFlag(p)`.
 */
export { needsClearance, screenFlag } from './health';
export type { HealthProfile, ScreenAnswer, ScreenAnswers } from './health';

/**
 * Plan engine: which template a day gets.
 * - `planned` mirrors prototype `planned(date)` (state passed in).
 * - `splitFor`, `planList`, `dayTemplate`, `exerciseCap`, `older` mirror the prototype functions of the same name.
 * - `beginnerRamp` mirrors the beginner check inline in prototype `setsFor`.
 * - `TEMPLATES`, `ORDER`, `SPLITS` mirror the prototype tables of the same name.
 * - `mondayOf`, `daysBetween` mirror the prototype date helpers; `weekdayOf` mirrors `parseYmd(date).getDay()`.
 */
export { planned, splitFor, planList, dayTemplate, exerciseCap, beginnerRamp, older, TEMPLATES, ORDER, SPLITS } from './plan';
export type { PlanProfile, PlanState, SessionEntry, SessionLog, Split, WeekPlan, Where, Experience } from './plan';
export { mondayOf, daysBetween, weekdayOf } from './dates';

/**
 * Session building: home mapping, trim, focus, sets. `ExerciseCatalog` is content/exercises.json as is
 * (prototype `TAGS`, `CARDS`, `AWAY` under content's names: see `ExerciseTag`).
 * - `mapForWhere` mirrors prototype `mapForWhere(names, where)` (the home mapping; `AWAY` read from the catalogue's `away_map.dumbbells_bodyweight`).
 * - `trimSession` mirrors prototype `trimSession(items, t)`.
 * - `applyFocus`, `focusPick`, `isFocus`, `muscleAllowed` mirror the prototype functions of the same name.
 * - `shortSession` mirrors the check-in short-session cut inline in prototype `buildSession`.
 * - `setsFor` mirrors prototype `setsFor(name, base)`.
 * - `sessionSets` mirrors the set-count steps of prototype `buildSession(t)` and `newExercise(name)`.
 * - `COMPOUND` mirrors prototype `COMPOUND`; `BALANCE_EXERCISE` is the 60+ exercise `buildSession` appends.
 */
export {
  mapForWhere,
  trimSession,
  applyFocus,
  focusPick,
  isFocus,
  muscleAllowed,
  shortSession,
  setsFor,
  sessionSets,
  COMPOUND,
  BALANCE_EXERCISE,
} from './session';
export type {
  ExerciseTag,
  ExerciseCatalog,
  AwayMap,
  SessionItem,
  ReplaceRules,
  TrimState,
  FocusState,
  SessionSetsOptions,
  SessionExercise,
} from './session';

/**
 * Exclusions and swaps. Exclusions and swaps come in the contract's `Exclusion` and `Swap` shapes
 * (prototype `settings.excl`, `settings.repl`); tags from the catalogue.
 * - `resolveSession` mirrors prototype `resolveSession(names, where)` (state passed in); `resolveSessionWithLost`
 *   mirrors `resolveSession(names, where, lost)`, returning the slots left empty (#110).
 * - `resolveName` mirrors prototype `resolveName(name, where, depth, taken)`.
 * - `homeName` mirrors prototype `homeName(n, where)` (swap targets and stored picks where you train, #109);
 *   `SCOPE_RANK` mirrors prototype `SCOPE_RANK` (most specific rule's pick, #109).
 * - `candidates` mirrors prototype `candidates(name, o)`; `why` is returned as facts, not text.
 * - `ruleMatches`, `activeRules`, `isExcluded` mirror the prototype functions of the same name.
 * - `replFromSwaps` builds prototype `settings.repl` from contract swaps (for `trimSession`'s `repl`).
 */
export { resolveSession, resolveSessionWithLost, resolveName, homeName, SCOPE_RANK, candidates, ruleMatches, activeRules, isExcluded, replFromSwaps } from './exclusions';
export type { Exclusion, ExclusionScope, ExclusionReason, RuleMatch, Swap, ReplEntry, CandidateOptions, Candidate, CandidateWhy, ResolveState, ResolvedSession } from './exclusions';

/**
 * Weight guidance. Prototype `EX_META` is the catalogue's `meta` (`ExerciseMeta`: content/exercises.json
 * `meta`, `name → { type, rep_low, rep_high }`), read through `ProgressionContext.catalog`.
 * - `suggestBase` mirrors prototype `suggestBase(ex)`; `applyMods` mirrors `applyMods(sug, ex)` (state passed in).
 *   Prototype `suggestFor(ex)` is `applyMods(suggestBase(ex, c), ex, c)`.
 * - `exInfo` mirrors prototype `exInfo(name)`; `metaFor` mirrors its `EX_META[name] || ['other',8,12]` step.
 * - `applyCustomTags` mirrors prototype `applyCustomTags()` (custom tags merged, meta added when missing);
 *   `customExerciseMeta` mirrors its type-from-equipment, 8–12 step.
 * - `overridesFromSettings` turns contract `Settings.exercise_overrides` into prototype `S.settings.ex` (what `exInfo` reads).
 * - `lastFor`, `snap`, `harder`, `easier`, `kgLabel`, `noLoad`, `repWord` mirror the prototype functions of the same name.
 * - `DEFAULT_STEP` mirrors prototype `DEFAULT_STEP`.
 * - `setTarget` mirrors prototype `setTarget(ex, j, sug)` (in-session rating adjustments).
 * - `tickFill`, `rampRate`, `rampTickFill` mirror the `tick`, ramp `rate`/`rerate` and `ramp-tick` steps of prototype `workoutAction`.
 */
export {
  suggestBase,
  applyMods,
  exInfo,
  metaFor,
  customExerciseMeta,
  applyCustomTags,
  overridesFromSettings,
  lastFor,
  snap,
  harder,
  easier,
  kgLabel,
  noLoad,
  repWord,
  DEFAULT_STEP,
  setTarget,
  tickFill,
  rampRate,
  rampTickFill,
} from './progression';
export type {
  ExType,
  ExerciseMeta,
  ExerciseOverride,
  SettingsExerciseOverride,
  ExInfo,
  Rate,
  LiftSet,
  LiftSession,
  LiftRecord,
  ProgressionContext,
  Suggestion,
  WorkoutMods,
  ModsContext,
  SetEntry,
  SetTarget,
  ScoreEntry,
} from './progression';

/**
 * Stalls, the recovery-week card and personal bests. Records are prototype `S.lifts[name]` with
 * `hist` and `pbToast` (contract `LiftStat.history`, `pb_toast_date`).
 * - `sessionScore`, `stalled`, `stalledList`, `inRange`, `checkBest`, `stallCard` mirror the prototype functions of the same name (state passed in).
 * - `updateLift` mirrors prototype `updateLift(ex)`: the new record, its history and whether to toast a personal best;
 *   unticking every set today restores the session before, or gives a null record (delete it) (#122).
 *   `sessionScore` and `updateLift` take the profile's weight for assisted scores (#122).
 * - `recoveryCard` mirrors the "several stalls → recovery week" card in prototype `renderStart()`.
 * - `recoveryWeek` mirrors prototype `adjAction('adj-deload')`; `stallRange` mirrors `adjAction('adj-range')`.
 * - `addDays` mirrors prototype `addDays(s, n)`.
 */
export { sessionScore, stalled, stalledList, inRange, recoveryCard, recoveryWeek, stallCard, stallRange, checkBest, updateLift } from './stalls';
export type { AdjRange, AdjState, RecoveryCard, StallCard, LiftUpdate } from './stalls';
export { addDays } from './dates';

/**
 * Workout screen: rest timer, warm-up line, next template and the check-in.
 * - `restFor`, `restLabel` mirror the prototype functions of the same name (`TAGS` passed in);
 *   `REST_COMPOUND_SEC`, `REST_OTHER_SEC` are its 150 and 75 seconds.
 * - `warmupSets` mirrors the numbers and conditions of prototype `warmupHtml(ex, i, sug)`.
 * - `nextInList` mirrors prototype `nextInList(t)` (profile passed in).
 * - `checkinFlags` mirrors the `flagged`, `why`, swap and "Good to go" steps of the check-in in prototype `renderStart()`.
 */
export { restFor, restLabel, nextInList, warmupSets, checkinFlags, REST_COMPOUND_SEC, REST_OTHER_SEC } from './workout';
export type { WarmupSet, Checkin, CheckinReason, CheckinResult } from './workout';

/**
 * Workout day: session modifiers, display name, volume and the second session. Results that are
 * stored come in contract shapes (`Workout.mods`, `Workout.template`, `Workout.base`, `Workout.ci_choice`).
 * - `sessionMods` mirrors the `short`, `deload`, `reentry`, `light` and `w.mods` steps of prototype `buildSession(t)` (state passed in).
 * - `modsNote` mirrors prototype `modsNote(m)`, returning `ModsNotePart` codes instead of copy.
 * - `templateName` mirrors the `w.template` step of prototype `buildSession(t)`.
 * - `sessionVolume` mirrors the `vol` sum in prototype `renderWorkout()`.
 * - `secondSessionChoices` mirrors prototype `secondSessionHtml()` (the offer rule and its chips).
 * - `mergeSecondSession` mirrors prototype `addSecondSession(t)` (the built session passed in).
 */
export { sessionMods, modsNote, templateName, sessionVolume, secondSessionChoices, mergeSecondSession } from './day';
export type { CiChoice, ReentryRange, SessionMods, ModsNotePart, SessionModsInput, VolumeSet, SecondSessionDay } from './day';

/**
 * Food screen maths. Foods in content/foods.json's `Food` shape (user foods as `FoodFacts`), logs in the
 * contract's `FoodLog` shape; logs with `deleted_at` set are left out.
 * - `searchFoods` mirrors the query and `foodMatch(f, q)` filter of prototype `foodListHtml()` (list order kept).
 * - `unitGrams` mirrors prototype `unitGrams(f)` (label passed in; content carries it as `serving.grams`).
 * - `quantityFromGrams` mirrors the grams steps of prototype `case 'pick'` (`serving.grams`, #97), plus `too-small` (#150).
 * - `logTotals` mirrors prototype `totals(meals)` plus the fibre, added sugar and unknown parts of `fibreTotals(meals)`.
 * - `fibreTarget` mirrors prototype `fibreTarget()` (today's calorie target passed in).
 * - `fruitVegServings` mirrors the `veg` part of prototype `fibreTotals(meals)` (`produceOf`); `FRUIT_VEG_TARGET` its "of 5".
 * - `showAddedSugar` mirrors the `t.sug >= 10` check in prototype `fibreHtml()`.
 * - `dayComplete` mirrors prototype `dayComplete(d)` (settings calorie target passed in).
 */
export { searchFoods, unitGrams, quantityFromGrams, logTotals, fibreTarget, fruitVegServings, showAddedSugar, dayComplete, FRUIT_VEG_TARGET } from './food';
export type { SearchableFood, GramsFood, FoodFacts, FoodLogFacts, DayTotals, CompleteFlag, GramsQuantity } from './food';

/**
 * Food screen support.
 * - `kcalTarget` mirrors prototype `kcalTarget(date)` (flex days, lab-hold override; settings and profile passed in);
 *   `DEFAULT_KCAL_TARGET` mirrors `DEFAULT_SETTINGS.kcal`.
 * - `planFlex` mirrors prototype `planFlex(extra)` (state and plan id passed in; never below the floor, #167);
 *   `FLEX_FLOOR_DEFAULT` its 1200; `flexToast` its toast.
 * - `undoFlex` mirrors prototype `undoFlex(id)` (`case 'flex-undo'`; trims cuts so no day is below the floor, #176);
 *   `flexPlanFor` mirrors prototype `flexPlanFor(date)`, the plan the note shows and Undo removes (#178).
 * - `stepServings` mirrors prototype `case 'serv'`; `SERVINGS_MIN`, `SERVINGS_MAX`, `SERVINGS_STEP` its limits.
 * - `highProtein` mirrors the "high protein" badge check in prototype `foodListHtml()`.
 * - `customFood` mirrors prototype `case 'addcustom'`, plus `name-too-long` (names over `FOOD_NAME_MAX`, 200, the
 *   contract limit) and `invalid` (#150); `saveMyFood` its save step, `MY_FOODS_MAX` its 60 (the my-foods list only;
 *   recipe and kitchen-test saves keep the prototype's 80).
 * - `userFoodFacts` mirrors the `myFoods` mapping of prototype `allFoods()`, `fibOf` and `produceOf` (contract `UserFood` in).
 */
export {
  kcalTarget,
  DEFAULT_KCAL_TARGET,
  planFlex,
  flexToast,
  undoFlex,
  flexPlanFor,
  FLEX_FLOOR_DEFAULT,
  stepServings,
  SERVINGS_MIN,
  SERVINGS_MAX,
  SERVINGS_STEP,
  highProtein,
  customFood,
  saveMyFood,
  MY_FOODS_MAX,
  FOOD_NAME_MAX,
  userFoodFacts,
} from './food';
export type { FlexEntry, PlanFlexInput, PlanFlexResult, UndoFlexFloor, KcalTargetSettings, KcalTargetProfile, CustomFoodInput, CustomFoodResult, UserFoodFields, UserFoodFacts } from './food';

/**
 * Macro targets before setup (no profile), for the Food tab's ring and legend.
 * - `DEFAULT_PROTEIN_TARGET`, `DEFAULT_CARBS_TARGET`, `DEFAULT_FAT_TARGET` mirror prototype `DEFAULT_SETTINGS.protein`,
 *   `.carbs` and `.fat` (150, 190 and 60 g). They are fixed numbers in the prototype, not worked out from
 *   `DEFAULT_KCAL_TARGET`, though they add up to it (150 × 4 + 190 × 4 + 60 × 9 = 1900 kcal).
 */
export { DEFAULT_PROTEIN_TARGET, DEFAULT_CARBS_TARGET, DEFAULT_FAT_TARGET } from './food';

/**
 * Targets screen: weekly muscle coverage, planned vs done, and the focus-muscle picker. Workouts and
 * sets come in contract shapes (`Workout`, `WorkoutSet`); focus is contract `Settings.focus`.
 * - `plannedCoverage` mirrors prototype `weeklyCoverage()` (state passed in); `coverageTemplates` its week's template list.
 * - `doneCoverage` mirrors prototype `actualCoverage()` (the 7 days ending on `date`, one `CoverageDay` per date as prototype `loadDays` gives them).
 * - `coverageRows` mirrors the rows of prototype `coverageHtml()` and `fillActualCoverage()`.
 * - `weeklyCoverage` returns both meters' rows (planned and done).
 * - `focusPicker` mirrors prototype `focusHtml()`; `toggleFocus` mirrors prototype `focusAction(a, b)`.
 * - `COVER_SHOW` mirrors prototype `COVER_SHOW`; `COVER_LOW`, `COVER_FULL`, `FOCUS_MAX` are its 6, 12 and 3.
 */
export { plannedCoverage, coverageTemplates, doneCoverage, coverageRows, weeklyCoverage, focusPicker, toggleFocus, COVER_SHOW, COVER_LOW, COVER_FULL, FOCUS_MAX } from './coverage';
export type { MuscleSets, PlannedCoverageInput, CoverageWorkout, CoverageSet, CoverageDay, CoverageRow, WeeklyCoverageInput, FocusPicker, FocusToggleResult } from './coverage';

/**
 * Progress: body measures and day targets. Weigh-ins, measurements, day notes and sets come in
 * contract shapes (`Weight`, `Measurement`, `DayNote`, `WorkoutSet`).
 * - `latestWeight` mirrors prototype `latestWeight(upTo)`; `measureAt` mirrors `measureAt(key, upTo)`.
 * - `navyBodyFat` mirrors prototype `navyBF(upTo)`.
 * - `waterTarget` mirrors prototype `waterTarget()` (state passed in); `WATER_DEFAULT_ML`, `WATER_ML_PER_KG`,
 *   `WATER_TRAINING_ML` are its 2500, 33 and 600.
 * - `workoutBurn` mirrors prototype `workoutBurn(w, kg)`.
 * - `stepsTarget` mirrors prototype `stepsTarget()` (days passed in); `STEPS_DEFAULT`, `STEPS_MIN`, `STEPS_MAX` are its 7000, 5000 and 12000.
 * - `weightDrift` mirrors the `drift` check in prototype `setupSummaryHtml()` (#161); `WEIGHT_DRIFT_KG` is its 2.
 */
export {
  latestWeight,
  measureAt,
  navyBodyFat,
  waterTarget,
  workoutBurn,
  stepsTarget,
  weightDrift,
  WATER_DEFAULT_ML,
  WATER_ML_PER_KG,
  WATER_TRAINING_ML,
  STEPS_DEFAULT,
  STEPS_MIN,
  STEPS_MAX,
  WEIGHT_DRIFT_KG,
} from './progress';
export type { WeighIn, MeasurementFacts, MeasureKey, StepsDay, BurnSet, NavyProfile, WaterInput, WorkoutBurn, WeightDrift } from './progress';

/**
 * Recipe builder and kitchen tests. The data is passed in: raw ingredients (prototype `RAW`, `RAW_FIB`, `FATTY`)
 * as content/raw-ingredients.json `ingredients`, the katori size (prototype `KATORI_G`) as content/recipes.json
 * `katori_g`. Ingredients, recipes and kitchen tests come in contract `Ingredient`, `Recipe` and `KitchenTest`
 * fields; saved foods are contract `UserFood` fields.
 * - `recipeTotals` mirrors prototype `rbTotals()` (whole pot, katoris made, per katori; grams mode is cooked g ÷ `katori_g`).
 * - `presetIngredients` mirrors the rows step of prototype `rbFromPreset(k)` (oil level applied to `fatty` ingredients).
 * - `stepRecipeLog` mirrors prototype `case 'rb-log'`; `RECIPE_LOG_MIN`, `RECIPE_LOG_MAX`, `RECIPE_LOG_STEP` its limits.
 * - `recipeFood` mirrors prototype `case 'rb-save'` (checks, kept rows, saved food), plus `name-too-long` and `invalid` (contract limits, as #150).
 * - `kitchenTest` mirrors prototype `ktCalc(d)` (cooked weight from pot weights, per 100 g, per serving; 0 g empty pot pinned, #214).
 * - `kitchenTestFood` mirrors prototype `ktSave(true)` ("Save and use for my logging"), plus `name-too-long` and `invalid`.
 * - `saveBuiltFood` mirrors the `myFoods` step of `case 'rb-save'` and `ktSave`; `BUILT_FOODS_MAX` its 80.
 * - `ingredientGrams` mirrors the grams step of `rbTotals` and `ktCalc`; `UNIT_GRAMS` mirrors `UNIT_G`.
 * - `OIL_LEVEL` mirrors `OIL_LEVEL`; `RECIPE_VEG_INGREDIENTS`,
 *   `FRUIT_VEG_SERVING_G`, `SUGAR_INGREDIENT` mirror the vegetable list, `/80` and `'Sugar'` in `case 'rb-save'`.
 */
export {
  recipeTotals,
  presetIngredients,
  stepRecipeLog,
  recipeFood,
  kitchenTest,
  kitchenTestFood,
  saveBuiltFood,
  ingredientGrams,
  UNIT_GRAMS,
  OIL_LEVEL,
  RECIPE_VEG_INGREDIENTS,
  FRUIT_VEG_SERVING_G,
  SUGAR_INGREDIENT,
  BUILT_FOODS_MAX,
  RECIPE_LOG_MIN,
  RECIPE_LOG_MAX,
  RECIPE_LOG_STEP,
} from './recipes';
export type {
  RawIngredient,
  Per100g,
  IngredientRow,
  OilLevel,
  RecipeYield,
  RecipeTotals,
  PerKatori,
  RecipeTotalsResult,
  RecipeInput,
  RecipeFoodResult,
  KitchenTestInput,
  KitchenTotals,
  KitchenAmount,
  KitchenServing,
  KitchenTestResult,
  KitchenTestFoodInput,
  KitchenTestFoodResult,
} from './recipes';

/**
 * Progress: real burn, rapid loss, habits and the weekly check-in. Days come as `ProgressDay` facts
 * (contract `FoodLog`, `DayNote`, `Workout.cardio_min`, any done `WorkoutSet`), one per date.
 * - `weeklyAvg` mirrors prototype `weeklyAvg(end)`; `rapidLoss` mirrors `calorieCard()`; `RAPID_LOSS_KCAL` is its 150.
 * - `addKcal` mirrors the `adj-kcal` step of prototype `adjAction`.
 * - `weightSlope`, `adaptiveBurn`, `targetFromBurn` mirror the prototype functions of the same name (state passed in);
 *   `KCAL_PER_KG` mirrors prototype `KCAL_PER_KG`; `nextAdaptive` mirrors the `settings.adaptive` update in `renderCheckin()`.
 * - `weeklyCheckin` mirrors prototype `renderCheckin()` (facts and choice of suggestion, not HTML); `CHECKIN_KCAL_STEP`
 *   and `CARDIO_WEEK_MIN` are its 100 kcal and WHO 150 min.
 * - `habits` mirrors prototype `consistencyHtml()` (numbers and choice of line, not HTML).
 */
export {
  weeklyAvg,
  rapidLoss,
  addKcal,
  weightSlope,
  adaptiveBurn,
  nextAdaptive,
  targetFromBurn,
  weeklyCheckin,
  habits,
  KCAL_PER_KG,
  RAPID_LOSS_KCAL,
  CHECKIN_KCAL_STEP,
  CARDIO_WEEK_MIN,
} from './progress';
export type { ProgressDay, RapidLoss, AdaptiveState, AdaptiveBurn, BurnProfile, CheckinInput, CheckinSuggestion, WeeklyCheckin, Habits } from './progress';
