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
 * - Editing targets (prototype `renderTargets`): `macroKcal` is `macroK`, `macrosOff` is `off` (`MACRO_MISMATCH_KCAL` its 50),
 *   `cleanTarget` is the `data-t` input handler's rounding, `fitCarbs` is the `fitcarbs` action.
 */
export { calcTargets, bmrOf, ACTIVITY_MULTIPLIER, PACE_ADJ, TRAIN_NET_MET, DEFICIT_CAP_KCAL, MACRO_MISMATCH_KCAL, macroKcal, macrosOff, cleanTarget, fitCarbs } from './targets';
export type { TargetSet, TargetsProfile, TargetsResult, Sex, Activity, Goal, Pace, Special } from './targets';

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
 * - `planned` mirrors prototype `planned(date)` (state passed in); `missed` mirrors `missed(date)` the same way.
 * - `CONDENSED` mirrors the prototype table of the same name.
 * - `splitFor`, `planList`, `dayTemplate`, `exerciseCap`, `older` mirror the prototype functions of the same name.
 * - `beginnerRamp` mirrors the beginner check inline in prototype `setsFor`.
 * - `TEMPLATES`, `ORDER`, `SPLITS` mirror the prototype tables of the same name.
 * - `mondayOf`, `daysBetween` mirror the prototype date helpers; `weekdayOf` mirrors `parseYmd(date).getDay()`.
 */
export { planned, missed, CONDENSED, splitFor, planList, dayTemplate, exerciseCap, beginnerRamp, older, TEMPLATES, ORDER, SPLITS, HAND_PICKED } from './plan';
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
 * Re-check cards and the "can't do" sheet (#111).
 * - `recheckDue` mirrors the filter in prototype `recheckCards()`: timed rules whose `until` has come, still applying until answered.
 * - `recheckBack`, `recheckLater`, `recheckKeep` mirror the `rule-back`, `rule-later` and `rule-keep` steps of prototype `exAction`.
 * - `cantRule` mirrors the rule built in prototype `applyCant(choice)`; `widerRuleReplacements` mirrors its "caught by a wider rule" loop.
 * - `cantDefaultScope` mirrors prototype `defaultScope()`; `cantScopeOptions` mirrors the scope step's `opts` in prototype `renderCant()`; `cantAfterDuration` mirrors the `dur` branch of the `cx` action in prototype `exAction`.
 */
export { recheckDue, recheckBack, recheckLater, recheckKeep, cantRule, cantDefaultScope, cantScopeOptions, cantAfterDuration, widerRuleReplacements } from './exclusions';
export type { RecheckBack, CantDuration, CantDraft, CantRule, CantReplacement, CantScope, CantScopeOption, CantAfterDuration } from './exclusions';

/**
 * The "can't do" answer applied to today's workout (#265), over contract `Workout.exercises` and `WorkoutSet`s.
 * - `replaceAt` mirrors the `replaceAt(idx, pick)` step of prototype `applyCant(choice)` (the pick's sets as prototype `newExercise(name)`).
 * - `newExercise` mirrors prototype `newExercise(name)`: a library exercise added to the session.
 * - `cantSession` mirrors the workout steps of prototype `applyCant(choice)`: the tapped exercise, then `widerRuleReplacements`.
 */
export { replaceAt, cantSession, newExercise } from './cant';
export type { CantExercise, CantSet, NewCantSet, CantResult, CantLifts } from './cant';

/**
 * Ladders (#111). Prototype `LADDERS` is content/exercises.json `ladders`, passed in `LadderCatalog`.
 * - `ladderOf`, `nextStep`, `prevStep`, `sidewaysOf`, `estimateFor` mirror the prototype functions of the same name (state passed in).
 * - `ladderCard` mirrors prototype `ladderCard(ex)`, returning facts, not HTML.
 * - `ESTIMATE_PAIRS` mirrors prototype `PAIR`.
 * - `ladderSwap` mirrors the `ladder-up`, `ladder-down` and `swap-side` steps of prototype `exAction`; `ladderStayUntil` its `ladder-stay` step.
 */
export { ladderOf, nextStep, prevStep, sidewaysOf, estimateFor, ladderCard, ladderSwap, ladderStayUntil, ESTIMATE_PAIRS } from './ladders';
export type { Ladder, Ladders, LadderPosition, LadderCatalog, LadderState, LadderCard, Estimate } from './ladders';

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
  infoForUnit,
  snapForUnit,
  snapToLbStep,
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
 * - `reentryCard` mirrors the "back after a break" ("Welcome back") card in prototype `renderStart()`;
 *   `reentryRange` mirrors prototype `adjAction('adj-reentry')`.
 * - `steadyCard` mirrors the "N steady weeks of training" card in prototype `renderStart()`.
 * - `recoveryWeek` mirrors prototype `adjAction('adj-deload')`; `stallRange` mirrors `adjAction('adj-range')`;
 *   `stallRangeOverride` is `stallRange` in contract `Settings.exercise_overrides` shape (#128).
 * - `addDays` mirrors prototype `addDays(s, n)`.
 */
export { sessionScore, stalled, stalledList, inRange, recoveryCard, recoveryWeek, reentryCard, reentryRange, steadyCard, stallCard, stallRange, stallRangeOverride, checkBest, updateLift } from './stalls';
export type { AdjRange, AdjState, RecoveryCard, ReentryCard, SteadyCard, StallCard, LiftUpdate } from './stalls';

/**
 * Answered adjustment cards (`adj.dismissed`), kept within the contract's size cap (#721). Not in the prototype, which never prunes.
 * - `dismissKey` mirrors the `A.dismissed[key] = true` step of prototype `adjAction`, `exAction` and `checkinAction`, then prunes.
 * - `pruneDismissed` drops keys dated over `DISMISSED_MAX_AGE_DAYS` (90) days ago (the newest of each group stays),
 *   then keeps at most `DISMISSED_MAX_KEYS` (300) keys and `DISMISSED_MAX_BYTES` (32 KB).
 */
export { dismissKey, pruneDismissed, DISMISSED_MAX_AGE_DAYS, DISMISSED_MAX_KEYS, DISMISSED_MAX_BYTES } from './dismissed';
export { addDays } from './dates';

/**
 * Lift records on the wire (#135): core's record (prototype `S.lifts[name]`) and the contract's `LiftStat`.
 * The prototype has no counterpart (it kept records in `localStorage`); the fallbacks for older records are its rules.
 * - `recordToLiftStat` renames to contract fields, fills required fields (null where unknown, `sessions` = prototype
 *   `updateLift`'s `n || (prev ? 2 : 1)`, `first` = `first || prev.date || date`) and keeps nested `prev` one level deep.
 * - `liftStatToRecord` is its inverse.
 * - `liftStatTombstone` is the schema-valid tombstone for a deleted record (`updateLift` gave `record: null`).
 */
export { recordToLiftStat, liftStatToRecord, liftStatTombstone } from './liftStat';
export type { LiftStatSet, LiftStatSession, LiftStatPrev, LiftStatBody, LiftStatTombstone } from './liftStat';

/**
 * Workout screen: rest timer, warm-up line, next template and the check-in.
 * - `restFor`, `restLabel` mirror the prototype functions of the same name (`TAGS` passed in);
 *   `REST_COMPOUND_SEC`, `REST_OTHER_SEC` are its 150 and 75 seconds.
 * - `warmupRamp` extends `warmupSets` with the #1240 graduated ramp and later-compound rule (no prototype counterpart).
 * - `warmupSets` mirrors the numbers and conditions of prototype `warmupHtml(ex, i, sug)`.
 * - `nextInList` mirrors prototype `nextInList(t)` (profile passed in).
 * - `checkinFlags` mirrors the `flagged`, `why`, swap and "Good to go" steps of the check-in in prototype `renderStart()`.
 */
export { restFor, restLabel, nextInList, warmupSets, warmupRamp, WARMUP_RAMP_HEAVY_KG, WARMUP_RAMP_LIGHT, WARMUP_RAMP_HEAVY, checkinFlags, REST_COMPOUND_SEC, REST_OTHER_SEC, REST_EXTEND_SEC } from './workout';
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
 * - `unitGrams` mirrors prototype `unitGrams(f)` (label passed in; content carries it as `serving.grams`; reads "1,250 g", #213).
 * - `quantityFromGrams` mirrors the grams steps of prototype `case 'pick'` (`serving.grams`, #97), `too-small` included (#150).
 * - `logTotals` mirrors prototype `totals(meals)` plus the fibre, added sugar and unknown parts of `fibreTotals(meals)`.
 * - `fibreTarget` mirrors prototype `fibreTarget()` (today's calorie target passed in).
 * - `fruitVegServings` mirrors the `veg` part of prototype `fibreTotals(meals)` (`produceOf`); `FRUIT_VEG_TARGET` its "of 5".
 * - `showAddedSugar` mirrors the `t.sug >= 10` check in prototype `fibreHtml()`.
 * - `dayComplete` mirrors prototype `dayComplete(d, date)` (settings calorie target and today passed in): today counts only when ticked (#150).
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
 * - `customFood` mirrors prototype `case 'addcustom'`, `name-too-long` (names over `FOOD_NAME_MAX`, 200, the
 *   contract limit) and `invalid` included (#150); `saveMyFood` its save step, `MY_FOODS_MAX` its 60 (the my-foods list only;
 *   recipe and kitchen-test saves keep the prototype's 80). From #944, `saveMyFood` never drops a food that has a
 *   barcode by name.
 * - `myFoodReplaced` is the saved food a save replaces (same rule as both saves); `saveScannedFood`, `scannedFood`, `normaliseBarcode` and `sameBarcode` are new #944 rules, not prototype ports: a barcode-keyed
 *   save (only the same product is replaced; UPC-A and its leading-0 EAN-13 are one), the scanned-food form check that
 *   accepts genuine zeros, and the shared barcode comparison.
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
  saveScannedFood,
  myFoodReplaced,
  scannedFood,
  normaliseBarcode,
  sameBarcode,
  MY_FOODS_MAX,
  FOOD_NAME_MAX,
  userFoodFacts,
} from './food';
export type { FlexEntry, PlanFlexInput, PlanFlexResult, UndoFlexFloor, KcalTargetSettings, KcalTargetProfile, CustomFoodInput, CustomFoodResult, UserFoodFields, UserFoodFacts, BarcodedFood, ScannedFoodResult, ScannedMissingField, ScannedFoodInput, ScannedNumber } from './food';

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
 * - `DEFAULT_WATER_SIZES` is the prototype's `settings.water` fallback `{ glass:250, bottle:1000 }`
 *   (`renderTargets`, the Settings water sizes, the `data-wt` handler), as contract `Settings.water_sizes`.
 * - `waterSizeEntry` mirrors the `data-wt` step (round, keep 50 to 3000 ml, else null); `WATER_SIZE_MIN_ML`, `WATER_SIZE_MAX_ML` are its bounds.
 * - `workoutBurn` mirrors prototype `workoutBurn(w, kg)`; `burnToday` mirrors `burnToday()` (state passed in).
 * - `stepsTarget` mirrors prototype `stepsTarget()` (days passed in); `STEPS_DEFAULT`, `STEPS_MIN`, `STEPS_MAX` are its 7000, 5000 and 12000.
 * - `weightDrift` mirrors the `drift` check in prototype `setupSummaryHtml()` (#161); `WEIGHT_DRIFT_KG` is its 2.
 */
export {
  latestWeight,
  measureAt,
  navyBodyFat,
  waterTarget,
  workoutBurn,
  burnToday,
  stepsTarget,
  weightDrift,
  WATER_DEFAULT_ML,
  WATER_ML_PER_KG,
  WATER_TRAINING_ML,
  DEFAULT_WATER_SIZES,
  waterSizeEntry,
  WATER_SIZE_MIN_ML,
  WATER_SIZE_MAX_ML,
  STEPS_DEFAULT,
  STEPS_MIN,
  STEPS_MAX,
  WEIGHT_DRIFT_KG,
} from './progress';
export type { WeighIn, MeasurementFacts, MeasureKey, StepsDay, BurnSet, NavyProfile, WaterInput, WaterSizes, WorkoutBurn, BurnToday, WeightDrift } from './progress';

/**
 * Recipe builder and kitchen tests. The data is passed in: raw ingredients (prototype `RAW`, `RAW_FIB`, `FATTY`)
 * as content/raw-ingredients.json `ingredients`, the katori size (prototype `KATORI_G`) as content/recipes.json
 * `katori_g`. Ingredients, recipes and kitchen tests come in contract `Ingredient`, `Recipe` and `KitchenTest`
 * fields; saved foods are contract `UserFood` fields.
 * - `recipeTotals` mirrors prototype `rbTotals()` (whole pot, katoris made, per katori; grams mode is cooked g ÷ `katori_g`).
 * - `presetIngredients` mirrors the rows step of prototype `rbFromPreset(k)` (oil level applied to `fatty` ingredients).
 * - `stepRecipeLog` mirrors prototype `case 'rb-log'`; `RECIPE_LOG_MIN`, `RECIPE_LOG_MAX`, `RECIPE_LOG_STEP` its limits.
 * - `recipeFood` mirrors prototype `case 'rb-save'` (checks, kept rows, saved food), `name-too-long` and `invalid` included (contract limits, #150).
 * - `kitchenTest` mirrors prototype `ktCalc(d)` (cooked weight from pot weights, per 100 g, per serving; a 0 g empty pot counts, #214).
 * - `kitchenTestFood` mirrors prototype `ktSave(true)` ("Save and use for my logging"), `name-too-long` and `invalid` included (#150).
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
  SOYA_INGREDIENT,
  FIT_SOYA_G,
  FIT_SOYA_PROTEIN_G,
  FIT_OIL_MIN_SAVE_KCAL,
  FIT_PROTEIN_MIN_G,
  fitSuggestions,
  applyFit,
  kitchenTable,
  kitchenCompare,
  stepMinutes,
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
  FitSuggestion,
  KitchenTestRecord,
  KitchenCompareFood,
  KitchenComparison,
} from './recipes';

/**
 * Progress: real burn, rapid loss, habits and the weekly check-in. Days come as `ProgressDay` facts
 * (contract `FoodLog`, `DayNote`, `Workout.cardio_min`, any done `WorkoutSet`), one per date.
 * - `weeklyAvg` mirrors prototype `weeklyAvg(end)`; `rapidLoss` mirrors `calorieCard()`; `RAPID_LOSS_KCAL` is its 150.
 * - `addKcal` mirrors the `adj-kcal` step of prototype `adjAction`.
 * - `weightSlope`, `adaptiveBurn`, `targetFromBurn` mirror the prototype functions of the same name (state passed in);
 *   `KCAL_PER_KG` mirrors prototype `KCAL_PER_KG`; `nextAdaptive` mirrors the `settings.adaptive` update in `renderCheckin()`.
 * - `weeklyCheckin` mirrors prototype `renderCheckin()` (facts and choice of suggestion, not HTML), including its
 *   sleep-under-7 h rule, week-on-week weight change and weight trend per week (#264); `CHECKIN_KCAL_STEP`
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

/**
 * Progress: weight and waist trend, the scale-jump note and entry limits (#233).
 * - `weightSeries` mirrors the series in prototype `weightChart()`; `waistSeries` mirrors `waistPts` in `measuresHtml()`;
 *   `WEIGHT_CHART_POINTS` and `WAIST_CHART_POINTS` are their 30 and 20.
 * - `trendChange` mirrors `diff` in `weightChart()` ("Down/Up X kg since …", "No change since …") and `change` in `measuresHtml()`.
 * - `chartLayout` mirrors the geometry of `weightChart()` and `lineChart()`; `WEIGHT_CHART_BOX`, `WAIST_CHART_BOX` are their boxes.
 * - `scaleJump` mirrors the `S.ui.scaleJump` step of the prototype's `case 'saveW'`; `SCALE_JUMP_KG`, `SCALE_JUMP_DAYS` are its 0.8 and 3.
 * - `weightEntry` mirrors the checks in `case 'saveW'`, `measurementRow` mirrors `saveMeasures()`, `sleepEntry` the `enSleep`
 *   input (0–24 h); `round1` mirrors `r1`. `WEIGHT_ABOVE_KG`, `WEIGHT_BELOW_KG`, `TAPE_MIN_CM`,
 *   `TAPE_MAX_CM`, `SLEEP_MAX_H` are the contract's `Weight`, `TapeCm` and `DayNote.sleep` bounds.
 * - `weekSummary` mirrors the "Seven days to <date>" block of `renderProgress()`: bar sizes, averages, sessions.
 */
export {
  round1,
  weightSeries,
  waistSeries,
  trendChange,
  chartLayout,
  scaleJump,
  weightEntry,
  measurementRow,
  sleepEntry,
  WEIGHT_CHART_POINTS,
  WAIST_CHART_POINTS,
  WEIGHT_CHART_BOX,
  WAIST_CHART_BOX,
  SCALE_JUMP_KG,
  SCALE_JUMP_DAYS,
  WEIGHT_ABOVE_KG,
  WEIGHT_BELOW_KG,
  TAPE_MIN_CM,
  TAPE_MAX_CM,
  SLEEP_MAX_H,
  weekSummary,
} from './progress';
export type { TrendPoint, TrendChange, ChartBox, ChartLayout, ScaleJump, WeightEntry, SleepEntry, WeekDay, WeekSummary } from './progress';

/**
 * Science cards (#488). The protein card's 1.6 g/kg floor, `Math.round(w * 1.6)` where
 * `w = latestWeight() || profile.weight`:
 * - `proteinFloor` mirrors prototype `KB.protein.b`'s `Math.round(w*1.6)` (docs/prototype/plate-and-bar.html line 2792).
 * - `PROTEIN_PER_KG` mirrors its 1.6. The card shows the weight with `round1`; the floor multiplies the raw weight.
 */
export { proteinFloor, PROTEIN_PER_KG } from './protein';

/**
 * Meal ideas. Content is passed in: content/meal-planning.json (`MEAL_W`, `PROT_W`, `MAXQ`, `MINQ`,
 * `ROLE` as `roles`) and content/foods.json `foods`.
 * - `nextMealInfo` mirrors prototype `nextMealInfo()` (date, hour, logs and targets passed in); `mealByTime` mirrors
 *   `mealByTime()` (hour passed in); `OLDER_MEAL_PROTEIN_G` is its 25 g for 60+ users.
 * - `combos` mirrors prototype `combos(info)`; `combosFast` mirrors `combosFast(info)`; `round05` mirrors `round05`.
 * - `ideasPage` mirrors the paging and protein note in `guidanceHtml()`; `IDEAS_PER_PAGE` and
 *   `IDEAS_KCAL_LEFT_MIN` are its 3 and 120.
 * - `MEAL_ORDER` mirrors prototype `MEALS`.
 * - `proteinUpgrade` mirrors prototype `upgradeHtml(meal, items)` (the "Low on protein" add-on); `UPGRADE_PROTEIN_BELOW_G` and
 *   `UPGRADE_KCAL_SLACK` are its 20 and 50.
 */
export {
  nextMealInfo,
  mealByTime,
  combos,
  combosFast,
  round05,
  ideasPage,
  OLDER_MEAL_PROTEIN_G,
  IDEAS_PER_PAGE,
  IDEAS_KCAL_LEFT_MIN,
  MEAL_ORDER,
  proteinUpgrade,
  UPGRADE_PROTEIN_BELOW_G,
  UPGRADE_KCAL_SLACK,
} from './meals';
export type { Meal, MealDiet, MealRole, MealPlanningContent, MealFood, MealIdea, MealIdeaItem, MealTarget, MealIdeasInput, NextMealInput, NextMeal, ProteinUpgradeInput, ProteinUpgrade } from './meals';

/**
 * Weekly meal plan and grocery list. The plan is contract `Settings.meal_plan` in the prototype's
 * `mealPlan` shape; the grocery map is content/meal-planning.json `grocery` (prototype `GROC`).
 * - `buildPlan` mirrors prototype `buildPlan()` (targets, profile age, start and diet passed in); `PLAN_DAYS`, `PLAN_OPTIONS`
 *   and `PLAN_ROTATION` are its 7, 4 and 3.
 * - `planItems` mirrors `planItems`; `swapPlanMeal` mirrors `case 'mp-swap'`; `planForMeal` mirrors `planForMeal(meal)` (date passed in).
 * - `planIsCurrent` mirrors the saved-plan check and `planDayTotals` the "About … kcal" line of `planSheet()`.
 * - `groceryList` mirrors `grocerySheet()` (rows and copy text, not HTML); `groceryAmount` mirrors its `fmtAmt`.
 */
export { buildPlan, planItems, swapPlanMeal, planIsCurrent, planForMeal, planDayTotals, groceryList, groceryAmount, PLAN_DAYS, PLAN_OPTIONS, PLAN_ROTATION } from './mealplan';
export type { MealPlan, PlanItem, PlanTargets, GroceryEntry, GroceryRow } from './mealplan';

/**
 * Input length limits (contract 0.1.9, #377; the prototype has none, as `FOOD_NAME_MAX`):
 * - `servingUnitTooLong` is true for a trimmed custom-food unit over `UNIT_MAX` (100, `UserFood.unit`).
 * - `kitchenNoteTooLong` is true for a kitchen-test note over `NOTE_MAX` (2000, `KitchenTest.note`).
 * - `exerciseNameTooLong` is true for a trimmed custom exercise name over `EXERCISE_NAME_MAX` (200, `Settings.custom_tags` keys; #397).
 * - `CUSTOM_EXERCISES_MAX` (500) is the most custom exercises `Settings.custom_tags` holds (maxProperties).
 * - `EXERCISE_OVERRIDES_MAX` (500) is the most entries `Settings.exercise_overrides` holds (maxProperties);
 *   `exerciseOverridesWouldExceed` is true when saving a new name would go past it (#620).
 */
export {
  UNIT_MAX,
  NOTE_MAX,
  EXERCISE_NAME_MAX,
  CUSTOM_EXERCISES_MAX,
  EXERCISE_OVERRIDES_MAX,
  servingUnitTooLong,
  kitchenNoteTooLong,
  exerciseNameTooLong,
  exerciseOverridesWouldExceed,
} from './inputLimits';

/**
 * Exercise settings sheet (#620):
 * - `EXERCISE_SHEET_TYPES` mirrors the equipment list of prototype `renderExSettings()` (all `ExType` values but `other`).
 * - `EXERCISE_STEP_CHOICES` mirrors its `steps`; the sheet hides them for `noLoad` types.
 * - `exerciseOverrideEntry` mirrors the `es-save` step of prototype `workoutAction`, with the contract's range rule
 *   (a low below 1 is refused; the prototype saves it).
 */
export { EXERCISE_SHEET_TYPES, EXERCISE_STEP_CHOICES, LB_STEP_CHOICES, exerciseOverrideEntry } from './exerciseSettings';
export type { ExerciseSettingsDraft, ExerciseOverrideResult } from './exerciseSettings';

/**
 * The feel step after a set in learn mode (#485). `priorSessions`, `isLearning` and `showFeel` mirror prototype
 * `priorSessions`, `learning` and the gate of `feelHtml`; `feelResult` mirrors its answer branches (state passed in).
 */
export { priorSessions, isLearning, showFeel, feelResult } from './feel';
export type { FeelResult } from './feel';

/**
 * The "Why it works" daily read (#552). Cards are content/cards.json `cards`; `hidden` lists held-back card ids (#212).
 * - `learnList` mirrors prototype `LEARN` and the list `learnCardHtml` builds (`learn_order`, then audience cards set in at
 *   `learn_insert_at`), with hidden cards left out after the splice.
 * - `dailyRead` mirrors `learnCardHtml`'s due rule (`LEARN_DAYS_PER_CARD`: one more card every 3 days), next card and
 *   "N of M done" numbers (stored `learn` and today passed in).
 */
export { learnList, dailyRead, LEARN_DAYS_PER_CARD } from './learn';
export type { LearnCard, LearnState, DailyRead } from './learn';

/**
 * Meal prep (contract `Settings.prep`, shape owned here): `addPrep` mirrors the prep step of prototype `case 'rb-prep'`
 * (6-day expiry, portions = katoris), `prepFor` mirrors `prepLineHtml(meal)`, `logPrep` mirrors `case 'prep-log'`.
 */
export { addPrep, prepFor, logPrep, isPrepEntry, PREP_DAYS, PREP_MAX } from './prep';
export type { PrepEntry, AddPrepInput } from './prep';

/** `checkinBannerDue` mirrors prototype `checkinBanner()`: Food's "weekly check-in is ready" banner (Sunday or Monday, today, not yet seen this week). */
export { checkinBannerDue } from './progress';

/**
 * Device step count from the Android since-boot counter (#300), no prototype counterpart. `advanceSteps` turns a reading and the stored
 * baseline into the new baseline and the day totals to write (`msSinceMidnight` is the reading's local time; a gap across midnight is credited to the day before only within `MIDNIGHT_WINDOW_MS` of it, else dropped); `isReboot` is its reboot check.
 */
export { advanceSteps, isReboot, MIDNIGHT_WINDOW_MS } from './deviceSteps';
export type { StepReading, StepBaseline, StepCredit, StepAdvance } from './deviceSteps';

/**
 * Live pose tracking (#947 slice 1; new in v1.1, no prototype function): `analyseSquat` runs `squatSignal` (hip height above
 * the knee in shin lengths, from MoveNet's 17 keypoints) through the smoothed rep state machine (`initRepCounter`,
 * `stepRepCounter`, `repInProgress`) and returns rep count, depth against about parallel, tempo and card cue keys (`DEPTH_CUES`).
 */
export {
  analyseSquat,
  squatSignal,
  initRepCounter,
  stepRepCounter,
  repInProgress,
  DEPTH_CUES,
  MOVENET,
  MIN_SCORE,
  MIN_SHIN,
  SMOOTH_TAU_MS,
  TOP_H,
  DOWN_H,
  PARALLEL_H,
  BOTTOM_BAND,
  MAX_GAP_MS,
  JUMP_H,
  MAX_SPEED_H_PER_S,
  JUMP_DWELL_MS,
} from './pose';
export type { PoseKeypoint, PoseFrame, PoseCue, PoseExercise, SquatRep, SquatReport, RepCounterState } from './pose';

/**
 * Open Food Facts barcode lookup (v1.1, #944). New rules from the #944 spec, not prototype ports.
 * - `offToUserFood` maps a trimmed OFF product to a draft user food (per 100 g or per serving, nulls for missing
 *   fields with a `missing` list, plausibility and data-quality warnings); `OffProduct` is the input subset.
 * - `validateBarcode` checks the GS1 check digit of EAN-8, EAN-13 and UPC-A; with the scanner hint `upc_e` it expands
 *   the code to UPC-A. `expandUpcE` is that expansion (8-digit UPC-E to 12-digit UPC-A, or null).
 */
export { offToUserFood, validateBarcode, expandUpcE } from './off';
export type { OffProduct, OffNutriments, OffNumber, OffMapResult, OffUserFoodDraft, OffMissingField, OffWarning, BarcodeCheck, BarcodeFormat, ScannerFormat } from './off';

/**
 * Cycle log (device only, never synced; #625). `cycInfo` mirrors prototype `cycInfo(date)` (stored data passed in);
 * `waterRetentionPhase` its `luteal || period` test, `sameDayLastCycle` the "Same day last cycle" date, `addCycleStart` /
 * `removeLastCycleStart` the `cyc-log` / `cyc-undo` actions, `emptyCycle` the `cyc-off` value.
 */
export { cycInfo, waterRetentionPhase, sameDayLastCycle, addCycleStart, removeLastCycleStart, emptyCycle } from './cycle';
export type { CycleData, CycleInfo, CyclePhase } from './cycle';

/**
 * - `seededSession` is new (#1020), not a prototype port: a session from picks seeded from a previewed workout, keeping its
 *   `base` and the check-in, re-entry and deload adjustments of `buildSession(t)` (via `sessionMods` and `sessionSets`) on the
 *   exercises that remain. It deviates from prototype `exPick` on purpose.
 */
export { seededSession } from './seeded';
export type { SeededSession, SeededSessionInput } from './seeded';

/**
 * - `routineFromSession` and `startRoutine` are new (#1184, ADR 011), not prototype ports (no prototype behaviour, no golden
 *   fixture): the exercises to store for a saved routine, and a hand-picked session from one, with `seededSession`'s
 *   check-in, re-entry and deload adjustments on the stored set counts.
 */
export { routineFromSession, startRoutine, ROUTINE_EXERCISES_MAX, ROUTINE_SETS_MIN, ROUTINE_SETS_MAX } from './routines';
export type { RoutineExercise, StartRoutineInput, StartedRoutine } from './routines';

/**
 * Meal photo rules (#1011). `capPhotoItems` mirrors `raw.slice(0, 12)` and `clampPhotoServings` the 0.25 to 6 clamp in prototype
 * `analysePhoto`; `photoMacros` mirrors `phMacros`; `photoLogQty` and `photoEstimateLog` the `r1` / `Math.round` amounts in `ph-add`;
 * `stepPhotoAdj` the 0.5 to 2 step 0.25 portion slider; `photoAdjLabel` its `r1(it.adj)` label.
 */
export {
  PHOTO_ITEMS_MAX, PHOTO_SERVINGS_MIN, PHOTO_SERVINGS_MAX, PHOTO_ADJ_MIN, PHOTO_ADJ_MAX, PHOTO_ADJ_STEP,
  capPhotoItems, clampPhotoServings, stepPhotoAdj, photoMacros, photoLogQty, photoEstimateLog, photoAdjLabel,
} from './photoMeal';
export type { PhotoMacros } from './photoMeal';

/** Recipe import (#1011): `importedGrams` mirrors `String(Math.round(num(i.grams)))` in prototype `importRecipe`. */
export { importedGrams } from './recipeImport';

/**
 * Form check frame positions (#1011): `framePositions` mirrors `at` and `frameDuration` mirrors `dur` in prototype `videoFrames`
 * (12% to 88% of the clip, 5 s when the length is unknown); `frameTimesMs` is the same rounded to whole ms.
 */
export { FRAME_DEFAULT_DURATION_MS, FRAME_START, FRAME_SPAN, FRAME_COUNT, frameDuration, framePositions, frameTimesMs } from './formFrames';

/**
 * Lab reports (#1070, device only). No copy here: tips and notices are content, picked by `tipFor` and `LabResult.unitStatus`.
 * - `MARKERS` mirrors prototype `MARKERS` (names, regexes, tip sides); the tip text is content. `markerOfPrototype` is prototype `markerOf(name)`
 *   exactly; `markerOf` deviates with word boundaries (#1075).
 * - `labFlagRaw` mirrors prototype `labFlag(t)` exactly, with no unit handling; `labResult` and `labFlag` are new: one canonical unit per
 *   marker, standard conversions, no red flag on an unrecognised unit, and a blank or non-numeric value is `none`, a blank or junk bound
 *   is no range (both deviate from the prototype, #1075).
 * - `tipFor` and `isFlagged` mirror the tip and `flagged` steps of `renderLabs()`; `labHistory` its trend step.
 * - `reportIsRed`, `holdAfterSave`, `clearHold` and `labHoldOn` mirror the `lab-save` and `lab-cleared` steps and `labHoldOn()`.
 *   The hold itself already reaches `kcalTarget`, `planFlex`, `undoFlex` (`labHold`) and `sessionMods` (`labHold`).
 * - `validateLabReport` mirrors the cleaning in `onLabFile` (name, numeric value, 80 tests, date) and is stricter on numbers.
 */
export {
  MARKERS, LAB_TESTS_MAX, markerOf, markerOfPrototype, labFlagRaw, labResult, labFlag, normaliseUnit, tipFor, isFlagged,
  reportIsRed, holdAfterSave, clearHold, labHoldOn, labHistory, validateLabReport,
} from './labs';
export type { Marker, MarkerKey, TipSide, TipKind, LabFlag, UnitStatus, LabResult, LabTest, LabReport, LabHold, LabReportError } from './labs';

/**
 * Nutrition-label parser (#1067, slice 1): new rules from the #1067 spike, not prototype ports (the prototype has no label scan).
 * - `parseNutritionLabel` reads OCR text (plain, or lines with per-word confidence) into a `LabelDraft`: per 100 g or per serving, kcal (kJ / 4.184 rounded, as `offToUserFood`), protein, carbs, fat, fibre and added sugar, each with a confidence and an empty value below 0.5; plausibility reuses `looksOff` from off.ts.
 * - `labelToScannedInput` and `labelFood` end a draft in `scannedFood` (the same validator and save path as the barcode review); `labelFood` adds fibre and added sugar.
 */
export { parseNutritionLabel, labelToScannedInput, labelFood } from './labelScan';
export type { LabelOcrInput, LabelOcrLine, LabelOcrWord, LabelKey, LabelLevel, LabelNote, LabelField, LabelWarning, LabelAlternate, LabelValues, LabelDraft } from './labelScan';

/**
 * Weight unit (#1185; new, no prototype counterpart): a device-local kg or lb setting; storage stays kg.
 * `kgToLb`, `lbToKg`, `fromKg`, `toKg` convert exactly (0.45359237); `formatWeight` and `kgLabel(w, info, unit)`
 * display one decimal; `parseWeightInput` reads a typed value to kg; `LB_STEP`, `lbStepFor`, `infoForUnit` and
 * `snapForUnit` round load suggestions to lb steps.
 */
export {
  DEFAULT_WEIGHT_UNIT,
  KG_PER_LB,
  LB_STEP,
  kgToLb,
  lbToKg,
  fromKg,
  toKg,
  unitLabel,
  formatWeight,
  parseWeightInput,
  lbStepFor,
} from './weightUnit';
export type { WeightUnit } from './weightUnit';

/**
 * Plate calculator (#1176): new, no prototype counterpart. `platesFor` gives the per-side plates for a barbell target (exact for any
 * plate set; nearest at or below by default), `nearestLoadable` the nearest loadable kg (for warm-up rounding, #1241),
 * `loadableNeighbours` the loads either side, `describePlates` the screen-reader line.
 */
export { platesFor, nearestLoadable, loadableNeighbours, describePlates, DEFAULT_BAR, DEFAULT_PLATES } from './plates';
export type { PlateOptions, PlateLoad, PlateCount } from './plates';

/**
 * Estimated one-rep max and session time (#1178): new rules, not prototype ports. `epley` is the estimate inside prototype `sessionScore`
 * (now shared with stalls.ts). `e1rm` is Epley in kg to 0.1, one rep = the weight, null above `E1RM_MAX_REPS` (12). `setE1rm` counts only done
 * `work` sets not rated `fail` on loaded (not bodyweight, time or assisted) exercises. `e1rmHistory` is the best estimate per session (optional `session` key, else date), oldest first.
 * `sessionElapsed` is first to last contract-style set tick minus gaps over `SESSION_GAP_MS` (`split` flags it), null when the span is zero, `complete` false when a done set lacks `t`.
 */
export { E1RM_MAX_REPS, SESSION_GAP_MS, epley, e1rm, setE1rm, e1rmHistory, sessionElapsed } from './e1rm';
export type { E1rmSet, E1rmPoint, SessionElapsed } from './e1rm';

/**
 * Workout import from a Strong or Hevy CSV (#1179, new, no prototype counterpart).
 * - `parseWorkoutCsv` reads the export into work sets by day (warm-up, distance/time-only and unreadable rows counted, not stored; weights to kg with `lbToKg`; a Strong file needs the unit, a Hevy header gives it); `parseCsv` is its CSV reader.
 * - `matchExercise`, `matchAll` sort the imported names into catalogue matches (exact, then case and form insensitive) and unmatched.
 * - `planImport` applies the user's mapping (skip or a name), leaves out days the app already has, and numbers the sets.
 * - `IMPORT_MAX_CHARS`, `IMPORT_MAX_ROWS`, `IMPORT_MAX_DAYS` are the caps; `importDate` reads a file date.
 */
export { parseWorkoutCsv, parseCsv, importDate, exerciseKey, matchExercise, matchAll, planImport, IMPORT_MAX_CHARS, IMPORT_MAX_ROWS, IMPORT_MAX_DAYS, IMPORT_MAX_EXERCISES } from './workoutImport';
export type { ImportSource, ImportError, ImportSet, ImportDay, ImportSkipped, ImportParsed, ImportResult, ImportMatches, ImportWorkoutDay, ImportPlan } from './workoutImport';
