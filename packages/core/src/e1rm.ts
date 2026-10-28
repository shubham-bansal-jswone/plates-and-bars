import { noLoad, type ExType } from './progression';

/**
 * Estimated one-rep max (#1178) and elapsed session time. New rules, not prototype ports (the prototype
 * only has the Epley estimate inside `sessionScore`); `epley` is that estimate extracted unchanged.
 * All weights are kg; display conversion is the app's job.
 */

/** Highest rep count that still gets an estimate; Epley drifts above about 12 reps. */
export const E1RM_MAX_REPS = 12;

/** A gap between two set ticks longer than this (ms) splits a session into separate bouts: 3 hours. */
export const SESSION_GAP_MS = 3 * 60 * 60 * 1000;

/**
 * Epley estimate `w × (1 + r/30)`, unrounded and uncapped. Used by `sessionScore` (stalls.ts) so stall
 * detection and the trend share one formula.
 *
 * Mirrors the Epley step of prototype `sessionScore`.
 */
export function epley(w: number, r: number): number {
  return w * (1 + r / 30);
}

/**
 * Estimated one-rep max in kg, rounded to 0.1, or null when there is no sensible estimate: weight not
 * a positive finite number, reps not a whole number from 1 to `E1RM_MAX_REPS`. One rep is the weight
 * itself; otherwise Epley. Epley is chosen over Brzycki for one formula across the range (Brzycki
 * blows up near 37 reps and agrees with Epley below about 10) and because stall detection already uses it.
 *
 * New rule (#1178); formula from prototype `sessionScore`.
 */
export function e1rm(weightKg: number | null | undefined, reps: number | null | undefined): number | null {
  if (typeof weightKg !== 'number' || typeof reps !== 'number') return null;
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (!Number.isInteger(reps) || reps < 1 || reps > E1RM_MAX_REPS) return null;
  const v = reps === 1 ? weightKg : epley(weightKg, reps);
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 10) / 10;
}

/** The fields of a contract `WorkoutSet` the estimate reads, plus the session `date` (`YYYY-MM-DD`). */
export interface E1rmSet {
  date: string;
  /** Session (workout) id; when present, `e1rmHistory` groups by it, so two sessions on one date are two points. */
  session?: string;
  kind: 'work' | 'ramp';
  weight_kg: number | null;
  reps: number | null;
  done: boolean;
  rate: 'easy' | 'right' | 'hard' | 'fail' | null;
}

/**
 * Estimate for one set, or null. Counts only done `work` sets not rated `fail`, and only for loaded
 * exercise types: bodyweight, time and assisted exercises have no external load to estimate from.
 * An unknown `type` is treated as loaded.
 */
export function setE1rm(s: Omit<E1rmSet, 'date'>, type?: ExType): number | null {
  if (s.kind !== 'work' || !s.done || s.rate === 'fail') return null;
  if (type && (noLoad(type) || type === 'assisted')) return null;
  return e1rm(s.weight_kg, s.reps);
}

/** One point of an exercise's trend: the best estimate of that day. */
export interface E1rmPoint {
  date: string;
  /** kg */
  e1rm: number;
}

/**
 * Per-exercise trend: the best `setE1rm` per session (`session` when present, else `date`), oldest first (ties by session key). `sets` are one exercise's sets
 * across sessions in any order; days with no countable set are left out.
 */
export function e1rmHistory(sets: readonly E1rmSet[], type?: ExType): E1rmPoint[] {
  const best = new Map<string, E1rmPoint>();
  for (const s of sets) {
    const v = setE1rm(s, type);
    if (v === null) continue;
    const key = s.session ?? s.date;
    const cur = best.get(key);
    if (!cur || v > cur.e1rm) best.set(key, { date: s.date, e1rm: v });
  }
  return [...best.entries()]
    .sort((a, b) => (a[1].date < b[1].date ? -1 : a[1].date > b[1].date ? 1 : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, p]) => p);
}

/** A contract `Timestamp`: ISO date-time ending in `Z` or a `±hh:mm` offset. */
const TICK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Elapsed session time, from set ticks. */
export interface SessionElapsed {
  /** Whole seconds from the first to the last tick, minus gaps over `SESSION_GAP_MS`. Always above 0. */
  seconds: number;
  /** ISO of the first and last tick. */
  from: string;
  to: string;
  /** True when every done set has a usable `t`; the issue shows a duration only then. */
  complete: boolean;
  /** True when a gap over `SESSION_GAP_MS` was cut out, so the app can label the duration. */
  split: boolean;
}

/**
 * Elapsed time of a session from set ticks `t` (contract `WorkoutSet.t`, UTC, so midnight needs no
 * special case). Rule: take the done sets' usable timestamps (contract style, ending in `Z` or `+-hh:mm`;
 * missing, null, zone-less or unparseable ones are skipped, never guessed, and make `complete` false),
 * sort them (entry order does not matter) and measure first to last minus every gap over 3 hours
 * (the sum of the bouts). Null when the measured span is zero (under 2 usable ticks, all ticks in the
 * same second, or every bout a single tick). Time before the first tick is not counted, as `t` is when
 * a set was ticked done.
 */
export function sessionElapsed(sets: readonly { done: boolean; t: string | null | undefined }[]): SessionElapsed | null {
  const done = sets.filter((s) => s.done);
  const ts: number[] = [];
  for (const s of done) {
    const ms = typeof s.t === 'string' && TICK.test(s.t) ? Date.parse(s.t) : NaN;
    if (Number.isFinite(ms)) ts.push(ms);
  }
  if (ts.length < 2) return null;
  ts.sort((a, b) => a - b);
  let total = 0;
  let split = false;
  for (let i = 1; i < ts.length; i++) {
    const gap = (ts[i] as number) - (ts[i - 1] as number);
    if (gap > SESSION_GAP_MS) split = true;
    else total += gap;
  }
  const seconds = Math.floor(total / 1000);
  if (seconds < 1) return null;
  return {
    seconds,
    from: new Date(ts[0] as number).toISOString(),
    to: new Date(ts[ts.length - 1] as number).toISOString(),
    complete: ts.length === done.length,
    split,
  };
}
