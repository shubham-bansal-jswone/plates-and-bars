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
export type { HealthProfile, ScreenAnswer } from './health';
