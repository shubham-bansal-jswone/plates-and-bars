import { planList, type PlanProfile } from './plan';
import { noLoad, snap, type ExInfo } from './progression';
import { COMPOUND, type ExerciseCatalog } from './session';

/** Rest after a set of a compound lift, in seconds (prototype `restFor`). */
export const REST_COMPOUND_SEC = 150;
/** Rest after a set of any other exercise, in seconds (prototype `restFor`). */
export const REST_OTHER_SEC = 75;

/**
 * Rest between sets in seconds: 150 for a compound lift (its tag's pattern is in `COMPOUND`), 75 for
 * anything else, untagged names included.
 *
 * Mirrors prototype `restFor(name)` (`TAGS` read from `tags`).
 */
export function restFor(name: string, tags: ExerciseCatalog['tags']): number {
  const t = tags[name];
  return t && COMPOUND.has(t.pattern) ? REST_COMPOUND_SEC : REST_OTHER_SEC;
}

/** Mirrors prototype `restLabel(name)`: '2–3 min' for compound rest, else '60–90 sec'. */
export function restLabel(name: string, tags: ExerciseCatalog['tags']): string {
  return restFor(name, tags) >= REST_COMPOUND_SEC ? '2–3 min' : '60–90 sec';
}

/**
 * The template after `t` in the plan, wrapping to the first. A name not in the plan gives the first
 * template; no plan (0 days) gives `null`.
 *
 * Mirrors prototype `nextInList(t)` (profile passed in for `planList()`).
 */
export function nextInList(t: string, profile: PlanProfile | null | undefined): string | null {
  const L = planList(profile);
  if (!L.length) return null;
  const i = L.indexOf(t);
  return L[(i + 1) % L.length] as string;
}

/** One warm-up set: `reps` at weight `w` (kg; format with `kgLabel`). Warm-up sets are not logged. */
export interface WarmupSet {
  w: number;
  reps: number;
}

/**
 * The warm-up line before an exercise: 8 reps at 50% and then 4 reps at 75% of the suggested work
 * weight, each snapped to the exercise's step (2.5 kg when the step is 0), not below 0. Shown only
 * for a loaded, non-assisted compound lift that is the first compound in today's session (`i` is its
 * index in `exercises`), with no set ticked yet and a suggested weight above 0. `info` is the
 * exercise's `exInfo` (where-aware). Null when not shown.
 *
 * Mirrors the numbers and conditions of prototype `warmupHtml(ex, i, sug)` (`S.day.workout.exercises`
 * passed in as `exercises`, `TAGS` as `tags`).
 */
export function warmupSets(
  ex: { name: string; sets: readonly { done?: boolean | null }[] },
  i: number,
  sug: { w?: number | '' | null },
  exercises: readonly { name: string }[],
  info: ExInfo,
  tags: ExerciseCatalog['tags'],
): [WarmupSet, WarmupSet] | null {
  const isCompound = (n: string): boolean => {
    const t = tags[n];
    return !!t && COMPOUND.has(t.pattern);
  };
  if (noLoad(info.type) || info.type === 'assisted' || !isCompound(ex.name) || ex.sets.some((s) => s.done)) return null;
  const firstCompound = exercises.findIndex((e) => isCompound(e.name));
  const w = sug.w;
  if (firstCompound !== i || !(typeof w === 'number' && w > 0)) return null;
  const step = info.step || 2.5;
  return [
    { w: Math.max(0, snap(w * 0.5, step)), reps: 8 },
    { w: Math.max(0, snap(w * 0.75, step)), reps: 4 },
  ];
}

/** Today's check-in answers (prototype `S.day.workout.checkin`); unanswered questions are absent or null. */
export interface Checkin {
  sleep?: 'good' | 'ok' | 'poor' | null;
  sore?: 'none' | 'some' | 'very' | null;
  energy?: 'good' | 'ok' | 'low' | null;
  time?: 'usual' | '45' | '30' | null;
}

/** Why a lighter session is suggested: poor sleep, low energy, very sore muscles (in that order). */
export type CheckinReason = 'sleep' | 'energy' | 'sore';

/** What the check-in shows. */
export interface CheckinResult {
  /** A lighter session is suggested (sleep poor, energy low or very sore). */
  flagged: boolean;
  /** The flagged answers, in the prototype's order; empty when not flagged. */
  reasons: CheckinReason[];
  /** The template to offer as a swap (very sore and a next template exists), else null. */
  swapTo: string | null;
  /** "Good to go": not flagged and sleep, soreness and energy all answered. */
  good: boolean;
}

/**
 * The check-in's lighter-session rule. `nextT` is `nextInList(plan)` (null without a plan).
 *
 * Mirrors the `flagged` and `why` steps of prototype `renderStart()`, its "Swap with …" condition
 * (`ci.sore === 'very' && nextT`) and its "Good to go" branch. The `ci` action clears the choice when
 * `flagged` is false.
 */
export function checkinFlags(ci: Checkin | null | undefined, nextT: string | null | undefined): CheckinResult {
  const c = ci || {};
  const reasons: CheckinReason[] = [];
  if (c.sleep === 'poor') reasons.push('sleep');
  if (c.energy === 'low') reasons.push('energy');
  if (c.sore === 'very') reasons.push('sore');
  const flagged = reasons.length > 0;
  return {
    flagged,
    reasons,
    swapTo: flagged && c.sore === 'very' && nextT ? nextT : null,
    good: !flagged && !!(c.sleep && c.energy && c.sore),
  };
}
