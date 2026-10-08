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
 */
export { calcTargets, bmrOf, ACTIVITY_MULTIPLIER, PACE_ADJ, TRAIN_NET_MET } from './targets';
export type { TargetsProfile, TargetsResult, Sex, Activity, Goal, Pace, Special } from './targets';

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
