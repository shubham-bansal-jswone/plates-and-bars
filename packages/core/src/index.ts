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

/**
 * Exclusions and swaps. Exclusions and swaps come in the contract's `Exclusion` and `Swap` shapes
 * (prototype `settings.excl`, `settings.repl`); tags from the catalogue.
 * - `resolveSession` mirrors prototype `resolveSession(names, where)` (state passed in).
 * - `resolveName` mirrors prototype `resolveName(name, where, depth)`.
 * - `candidates` mirrors prototype `candidates(name, o)`; `why` is returned as facts, not text.
 * - `ruleMatches`, `activeRules`, `isExcluded` mirror the prototype functions of the same name.
 * - `replFromSwaps` builds prototype `settings.repl` from contract swaps (for `trimSession`'s `repl`).
 */
export { resolveSession, resolveName, candidates, ruleMatches, activeRules, isExcluded, replFromSwaps } from './exclusions';
export type { Exclusion, ExclusionScope, ExclusionReason, RuleMatch, Swap, ReplEntry, CandidateOptions, Candidate, CandidateWhy, ResolveState } from './exclusions';

/**
 * Weight guidance. `ExerciseMetaTable` is prototype `EX_META` (`name → [type, lo, hi]`), passed in.
 * - `suggestBase` mirrors prototype `suggestBase(ex)`; `applyMods` mirrors `applyMods(sug, ex)` (state passed in).
 *   Prototype `suggestFor(ex)` is `applyMods(suggestBase(ex, c), ex, c)`.
 * - `exInfo`, `lastFor`, `snap`, `harder`, `easier`, `kgLabel`, `noLoad`, `repWord` mirror the prototype functions of the same name.
 * - `DEFAULT_STEP` mirrors prototype `DEFAULT_STEP`.
 * - `setTarget` mirrors prototype `setTarget(ex, j, sug)` (in-session rating adjustments).
 * - `tickFill`, `rampRate`, `rampTickFill` mirror the `tick`, ramp `rate`/`rerate` and `ramp-tick` steps of prototype `workoutAction`.
 */
export { suggestBase, applyMods, exInfo, lastFor, snap, harder, easier, kgLabel, noLoad, repWord, DEFAULT_STEP, setTarget, tickFill, rampRate, rampTickFill } from './progression';
export type {
  ExType,
  ExerciseMetaTable,
  ExerciseOverride,
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
 * - `updateLift` mirrors prototype `updateLift(ex)`: the new record, its history and whether to toast a personal best.
 * - `recoveryCard` mirrors the "several stalls → recovery week" card in prototype `renderStart()`.
 * - `recoveryWeek` mirrors prototype `adjAction('adj-deload')`; `stallRange` mirrors `adjAction('adj-range')`.
 * - `addDays` mirrors prototype `addDays(s, n)`.
 */
export { sessionScore, stalled, stalledList, inRange, recoveryCard, recoveryWeek, stallCard, stallRange, checkBest, updateLift } from './stalls';
export type { AdjRange, AdjState, RecoveryCard, StallCard, LiftUpdate } from './stalls';
export { addDays } from './dates';
