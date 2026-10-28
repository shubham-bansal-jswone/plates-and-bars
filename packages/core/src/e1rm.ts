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
  return Math.round(v * 10) / 10;
}

/** The fields of a contract `WorkoutSet` the estimate reads, plus the session `date` (`YYYY-MM-DD`). */
export interface E1rmSet {
  date: string;
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
 * Per-exercise trend: the best `setE1rm` per `date`, oldest first. `sets` are one exercise's sets
 * across sessions in any order; days with no countable set are left out.
 */
export function e1rmHistory(sets: readonly E1rmSet[], type?: ExType): E1rmPoint[] {
  const best = new Map<string, number>();
  for (const s of sets) {
    const v = setE1rm(s, type);
    if (v !== null && v > (best.get(s.date) ?? -Infinity)) best.set(s.date, v);
  }
  return [...best.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([date, e1rm]) => ({ date, e1rm }));
}

/** Elapsed session time, from set ticks. */
export interface SessionElapsed {
  /** Whole seconds from the first to the last tick of the longest bout. */
  seconds: number;
  /** ISO of the first and last tick counted. */
  from: string;
  to: string;
  /** True when every done set has a usable `t`; the issue shows a duration only then. */
  complete: boolean;
  /** True when a gap over `SESSION_GAP_MS` was cut out. */
  split: boolean;
}

/**
 * Elapsed time of a session from set ticks `t` (contract `WorkoutSet.t`, UTC, so midnight needs no
 * special case). Rule: take the done sets' valid ISO timestamps (missing, null or unparseable ones are
 * skipped, never guessed), sort them (order of entry does not matter), cut at gaps over 3 hours
 * (a set ticked much later, or two sessions in one day) and measure first to last of the longest bout
 * (earliest on a tie). Null with fewer than 2 usable ticks. Time before the first tick (warm-up not
 * ticked) is not counted, as `t` is when a set was ticked done.
 */
export function sessionElapsed(sets: readonly { done: boolean; t: string | null | undefined }[]): SessionElapsed | null {
  const done = sets.filter((s) => s.done);
  const ts: number[] = [];
  for (const s of done) {
    const ms = typeof s.t === 'string' ? Date.parse(s.t) : NaN;
    if (Number.isFinite(ms)) ts.push(ms);
  }
  if (ts.length < 2) return null;
  ts.sort((a, b) => a - b);
  const bouts: [number, number][] = [];
  let start = ts[0] as number;
  let prev = start;
  for (const x of ts.slice(1)) {
    if (x - prev > SESSION_GAP_MS) { bouts.push([start, prev]); start = x; }
    prev = x;
  }
  bouts.push([start, prev]);
  let best = bouts[0] as [number, number];
  for (const b of bouts) if (b[1] - b[0] > best[1] - best[0]) best = b;
  return {
    seconds: Math.floor((best[1] - best[0]) / 1000),
    from: new Date(best[0]).toISOString(),
    to: new Date(best[1]).toISOString(),
    complete: ts.length === done.length,
    split: bouts.length > 1,
  };
}
