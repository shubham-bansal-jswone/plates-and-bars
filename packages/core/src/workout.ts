import { planList, type PlanProfile } from './plan';
import { noLoad, snap, type ExInfo } from './progression';
import { COMPOUND, type ExerciseCatalog } from './session';

/** Rest after a set of a compound lift, in seconds (prototype `restFor`). */
export const REST_COMPOUND_SEC = 150;
/** Rest after a set of any other exercise, in seconds (prototype `restFor`). */
export const REST_OTHER_SEC = 75;
/** Seconds the rest timer's "+30 s" button adds (prototype `rest-add`). */
export const REST_EXTEND_SEC = 30;

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

/** Work weight (kg) at and above which `warmupRamp` uses three steps instead of the prototype's two (#1240). */
export const WARMUP_RAMP_HEAVY_KG = 60;
/** Light ramp (work weight below `WARMUP_RAMP_HEAVY_KG`): the prototype's 50% x 8, 75% x 4. */
export const WARMUP_RAMP_LIGHT: readonly { readonly pct: number; readonly reps: number }[] = [
  { pct: 0.5, reps: 8 },
  { pct: 0.75, reps: 4 },
];
/** Heavy ramp (work weight at or above `WARMUP_RAMP_HEAVY_KG`): 40% x 8, 60% x 5, 80% x 3. */
export const WARMUP_RAMP_HEAVY: readonly { readonly pct: number; readonly reps: number }[] = [
  { pct: 0.4, reps: 8 },
  { pct: 0.6, reps: 5 },
  { pct: 0.8, reps: 3 },
];

/**
 * Graduated warm-up ramp (decisions 2 and 3 of #1240). Same arguments as `warmupSets`.
 *
 * Steps: below 60 kg work weight, 50% x 8 then 75% x 4 (identical to `warmupSets`); at 60 kg and above,
 * 40% x 8, 60% x 5, 80% x 3. Each step snaps to the exercise step (2.5 kg when 0); a step is dropped when
 * it snaps to 0, equals the previous kept step, or is at or above the work weight.
 *
 * Shown for a loaded, non-assisted compound with no set ticked and a suggested weight above 0 that is either
 * the first compound of the session (as `warmupSets`) or a later compound none of whose primary muscles
 * (catalogue `tags[name].primary`) is a primary muscle of an earlier exercise in `exercises`. Never for
 * isolation, no-load or assisted exercises. Null when not shown, or when every step is dropped.
 *
 * Extends `warmupSets` (prototype `warmupHtml`); `warmupSets` is unchanged and stays the prototype port.
 */
export function warmupRamp(
  ex: { name: string; sets: readonly { done?: boolean | null }[] },
  i: number,
  sug: { w?: number | '' | null },
  exercises: readonly { name: string }[],
  info: ExInfo,
  tags: ExerciseCatalog['tags'],
): readonly WarmupSet[] | null {
  const isCompound = (n: string): boolean => {
    const t = tags[n];
    return !!t && COMPOUND.has(t.pattern);
  };
  if (noLoad(info.type) || info.type === 'assisted' || !isCompound(ex.name) || ex.sets.some((s) => s.done)) return null;
  const w = sug.w;
  if (!(typeof w === 'number' && w > 0)) return null;
  if (exercises.findIndex((e) => isCompound(e.name)) !== i) {
    // a later compound: only when its primary muscles are not already warm from an earlier exercise
    const mine = tags[ex.name]?.primary ?? [];
    const warm = new Set<string>();
    for (const e of exercises.slice(0, Math.max(0, i))) for (const m of tags[e.name]?.primary ?? []) warm.add(m);
    if (i < 0 || mine.some((m) => warm.has(m))) return null;
  }
  const step = info.step || 2.5;
  const out: WarmupSet[] = [];
  for (const { pct, reps } of w >= WARMUP_RAMP_HEAVY_KG ? WARMUP_RAMP_HEAVY : WARMUP_RAMP_LIGHT) {
    const sw = snap(w * pct, step);
    if (sw <= 0 || sw >= w || sw === out[out.length - 1]?.w) continue;
    out.push({ w: sw, reps });
  }
  return out.length ? out : null;
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
