import { addDays } from './dates';
import { e1rmHistory, setE1rm, type E1rmSet } from './e1rm';
import type { ExType } from './progression';

/**
 * Personal records, the tick-time PR check and the main lifts (#1351 C3). New rules, not prototype ports;
 * the 0.5% threshold and the "needs an earlier session" guard are `checkBest` (stalls.ts) unchanged, but
 * the comparison is now against the all-time best, not the last 8 sessions (spec section 0, 2026-10-29).
 * All weights are kg; display conversion is the app's job.
 */

/** A PR must beat the best before the day by more than this factor (0.5%). Mirrors the `1.005` in prototype `checkBest`. */
export const PR_THRESHOLD = 1.005;

/** Earlier sessions (days) with an estimate a lift needs before a PR can count. Mirrors `checkBest`'s `hist.length < 2` (today plus one). */
export const PR_MIN_PRIOR_SESSIONS = 1;

/** `mainLifts` looks back this many weeks from today. */
export const MAIN_LIFT_WEEKS = 12;
/** `mainLifts` needs at least this many sessions with an estimate in the window. */
export const MAIN_LIFT_MIN_POINTS = 3;
/** `mainLifts` returns at most this many lifts. */
export const MAIN_LIFT_COUNT = 3;

/** A stored set as the PR rules read it: an `E1rmSet` plus the lift name and the tombstone. */
export interface PrSet extends E1rmSet {
  /** Exercise name (contract `WorkoutSet.exercise`). */
  exercise: string;
  /** A non-null value means the set was deleted; it is ignored. */
  deleted_at?: string | null;
}

/** The set that set a record: weight (kg) and reps. */
export interface PrSetRef {
  w: number;
  r: number;
}

/** What improved at a PR. `delta` is `e1rm - previousBest`, rounded to 0.1. */
export interface PrImprovement {
  /** kg, 0.1 */
  e1rm: number;
  set: PrSetRef;
  /** kg, the best estimate before the day. */
  previousBest: number;
  /** kg, 0.1 */
  delta: number;
}

/** One personal record: the day a lift's running best estimate was first beaten. */
export interface PersonalRecord extends PrImprovement {
  lift: string;
  /** `YYYY-MM-DD` */
  date: string;
}

/** The all-time best before a day, for `isPrToday`. `sessions` is how many earlier days had an estimate. */
export interface PriorBest {
  /** kg, 0.1; 0 when there is none. */
  best: number;
  sessions: number;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** True when `cur` beats `best` by more than 0.5%. One place for the threshold, shared by the list and the toast. */
function beats(cur: number, best: number): boolean {
  return best > 0 && cur > best * PR_THRESHOLD;
}

/** A set that counts for a lift's PRs: not deleted, and `setE1rm` accepts it. */
function counted(s: PrSet, type: ExType | undefined): number | null {
  return s.deleted_at ? null : setE1rm(s, type);
}

/** Best countable set of a day: highest estimate, ties to the heavier then the lower-rep set. */
function dayBest(sets: readonly PrSet[], type: ExType | undefined): { e1rm: number; set: PrSetRef } | null {
  let best: { e1rm: number; set: PrSetRef } | null = null;
  for (const s of sets) {
    const v = counted(s, type);
    if (v === null) continue;
    const ref = { w: s.weight_kg as number, r: s.reps as number };
    if (!best || v > best.e1rm || (v === best.e1rm && (ref.w > best.set.w || (ref.w === best.set.w && ref.r < best.set.r)))) best = { e1rm: v, set: ref };
  }
  return best;
}

/**
 * The all-time best estimate before `date` for one lift, from its stored sets (any order; only sets dated
 * before `date` count), and how many earlier days had one. The app feeds this to `isPrToday`.
 *
 * New rule (#1351).
 */
export function priorBestOf(sets: readonly PrSet[], type: ExType | undefined, date: string): PriorBest {
  const days = new Set<string>();
  let best = 0;
  for (const s of sets) {
    if (s.date >= date) continue;
    const v = counted(s, type);
    if (v === null) continue;
    days.add(s.date);
    if (v > best) best = v;
  }
  return { best, sessions: days.size };
}

/**
 * Tick-time PR check: does today's best countable set beat the all-time `prior` best by more than 0.5%,
 * with at least `PR_MIN_PRIOR_SESSIONS` earlier sessions? Returns what improved, or null. `todaySets` are
 * the lift's sets of the day being checked (any not-done, failed, ramp or deleted set is ignored, so
 * unticking a set can turn a PR back into null). Once-per-lift-per-day stays the caller's `pbToast` guard.
 * Same rule as `personalRecords`, so the toast and the Recent PRs list agree.
 *
 * New rule (#1351); replaces the last-8 `beforeBest` of prototype `updateLift` + `checkBest`.
 */
export function isPrToday(prior: PriorBest, todaySets: readonly PrSet[], type?: ExType): PrImprovement | null {
  if (prior.sessions < PR_MIN_PRIOR_SESSIONS) return null;
  const today = dayBest(todaySets, type);
  if (!today || !beats(today.e1rm, prior.best)) return null;
  return { e1rm: today.e1rm, set: today.set, previousBest: prior.best, delta: round1(today.e1rm - prior.best) };
}

/**
 * Every personal record, newest first (ties by lift name). Per lift (`types` maps name to type; a name not
 * in `types` is treated as loaded, as `setE1rm` does for an unknown type), the days are walked oldest first
 * with a running all-time best; a day is a record when its best beats the best of all earlier days by more
 * than 0.5% (`isPrToday`'s rule). The first day never counts, an equal value does not repeat a record, and
 * the running best only rises. Fail, ramp, undone, deleted and bodyweight/timed/assisted sets are ignored.
 *
 * New rule (#1351).
 */
export function personalRecords(sets: readonly PrSet[], types: Readonly<Record<string, ExType>>): PersonalRecord[] {
  const byLift = new Map<string, Map<string, PrSet[]>>();
  for (const s of sets) {
    const days = byLift.get(s.exercise) ?? new Map<string, PrSet[]>();
    const day = days.get(s.date) ?? [];
    day.push(s);
    days.set(s.date, day);
    byLift.set(s.exercise, days);
  }
  const out: PersonalRecord[] = [];
  for (const [lift, days] of byLift) {
    const type = types[lift];
    let prior: PriorBest = { best: 0, sessions: 0 };
    for (const date of [...days.keys()].sort()) {
      const today = dayBest(days.get(date) as PrSet[], type);
      if (!today) continue;
      const hit = isPrToday(prior, days.get(date) as PrSet[], type);
      if (hit) out.push({ lift, date, ...hit });
      prior = { best: Math.max(prior.best, today.e1rm), sessions: prior.sessions + 1 };
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.lift < b.lift ? -1 : a.lift > b.lift ? 1 : 0));
}

/** A lift picked by `mainLifts`. */
export interface MainLift {
  lift: string;
  /** Sessions with an estimate in the window. */
  sessions: number;
  /** Date of the latest of them. */
  last: string;
}

/**
 * The lifts the Progress charts show by default: the top `MAIN_LIFT_COUNT` loaded lifts by number of
 * sessions with an estimate (`e1rmHistory` points) in the 12 weeks up to and including `today`, each with
 * at least `MAIN_LIFT_MIN_POINTS`; ties go to the most recent session, then the name. Deleted sets are
 * ignored; bodyweight, timed and assisted types are excluded (a name not in `types` is treated as loaded).
 *
 * New rule (#1351).
 */
export function mainLifts(sets: readonly PrSet[], types: Readonly<Record<string, ExType>>, today: string): MainLift[] {
  const from = addDays(today, -7 * MAIN_LIFT_WEEKS);
  const byLift = new Map<string, PrSet[]>();
  for (const s of sets) {
    if (s.deleted_at || s.date < from || s.date > today) continue;
    byLift.set(s.exercise, [...(byLift.get(s.exercise) ?? []), s]);
  }
  const picked: MainLift[] = [];
  for (const [lift, rows] of byLift) {
    const pts = e1rmHistory(rows, types[lift]);
    if (pts.length < MAIN_LIFT_MIN_POINTS) continue;
    picked.push({ lift, sessions: pts.length, last: (pts[pts.length - 1] as { date: string }).date });
  }
  return picked
    .sort((a, b) => b.sessions - a.sessions || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) || (a.lift < b.lift ? -1 : a.lift > b.lift ? 1 : 0))
    .slice(0, MAIN_LIFT_COUNT);
}
