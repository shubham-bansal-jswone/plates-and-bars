import { addDays } from './dates';
import { e1rmHistory, setE1rm, type E1rmSet } from './e1rm';
import { noLoad, type ExType } from './progression';
import { sessionScore } from './stalls';

/**
 * Personal records, the tick-time PR check and the main lifts (#1351 C3). New rules, not prototype ports;
 * the 0.5% threshold and the "needs an earlier session" guard are `checkBest` (stalls.ts) unchanged, but
 * the comparison is now against the all-time best, not the last 8 sessions (spec section 0, 2026-10-29).
 * All weights are kg; display conversion is the app's job.
 *
 * The PR score depends on the lift's type (`metric`): loaded lifts use the estimated 1RM (`e1rm.ts`);
 * bodyweight and timed lifts use total reps and assisted lifts use the bodyweight-minus-assist score, both
 * as prototype `sessionScore` (so they keep today's toast). Callers must pass `types` built with
 * `exInfo(name, catalog, override).type` for every lift in `sets`, overrides included: a lift missing from
 * `types` is read as loaded, and an assisted lift read as loaded would show more assistance as a PR.
 */

/** A PR must beat the best before the day by more than this factor (0.5%). Mirrors the `1.005` in prototype `checkBest`. */
export const PR_THRESHOLD = 1.005;

/**
 * Earlier sessions (days) with a score a lift needs before a PR can count: 1. Mirrors `checkBest`'s `hist.length < 2`
 * (today plus one); the owner note's "at least 2 prior sessions" is read this way (coordinator, 2026-10-29).
 */
export const PR_MIN_PRIOR_SESSIONS = 1;

/** `mainLifts` looks back this many weeks up to its `end` date. */
export const MAIN_LIFT_WEEKS = 12;
/** `mainLifts` needs at least this many days with an estimate in the window. */
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

/** The set that set a record: weight (kg) and reps (seconds for timed lifts). */
export interface PrSetRef {
  w: number;
  r: number;
}

/** What the score is, so the app can word the toast: kg estimated 1RM, total reps (or seconds), or assisted effective load x reps. */
export type PrMetric = 'e1rm' | 'reps' | 'assisted';

/** What improved at a PR. `delta` is `score - previousBest`, rounded to 0.1. */
export interface PrImprovement {
  metric: PrMetric;
  /** The day's score: e1RM in kg (0.1), total reps, or the assisted score (0.1). */
  score: number;
  /** The set that scored best on the day. */
  set: PrSetRef;
  /** The best score before the day (same unit). */
  previousBest: number;
  /** `score - previousBest`, 0.1 */
  delta: number;
}

/** One personal record: the day a lift's running best score was first beaten. */
export interface PersonalRecord extends PrImprovement {
  lift: string;
  /** `YYYY-MM-DD` */
  date: string;
}

/** The all-time best before a day, for `isPrToday`. `sessions` is how many earlier days had a score. */
export interface PriorBest {
  /** Same unit as the score; 0 when there is none. */
  best: number;
  sessions: number;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * True when `cur` beats `best` by MORE than 0.5%: the exact boundary is not a PR. Compared as whole tenths
 * (`round(cur*10) * 1000 > round(best*10) * 1005`) so float error in `best * 1.005` cannot let 100.5 beat 100
 * (prototype `checkBest` has that float quirk; it is not kept). One place for the threshold, shared by the list and the toast.
 */
function beats(cur: number, best: number): boolean {
  return best > 0 && Math.round(cur * 10) * 1000 > Math.round(best * 10) * Math.round(PR_THRESHOLD * 1000);
}

const metricOf = (type: ExType | undefined): PrMetric => (type && noLoad(type) ? 'reps' : type === 'assisted' ? 'assisted' : 'e1rm');

/** A day's score and the set that scored best, or null when no set counts. */
function dayScore(sets: readonly PrSet[], type: ExType | undefined, bodyweight: number | null | undefined): { score: number; set: PrSetRef } | null {
  const live = sets.filter((s) => !s.deleted_at);
  if (metricOf(type) === 'e1rm') {
    let best: { score: number; set: PrSetRef } | null = null;
    for (const s of live) {
      const v = setE1rm(s, type);
      if (v === null) continue;
      const ref = { w: s.weight_kg as number, r: s.reps as number };
      if (!best || v > best.score || (v === best.score && ref.w > best.set.w)) best = { score: v, set: ref };
    }
    return best;
  }
  // As `updateLift`: done sets with a weight or reps count (fail is not excluded); ramp sets are not work.
  const rows = live.filter((s) => s.kind === 'work' && s.done && ((s.weight_kg ?? 0) || (s.reps ?? 0))).map((s) => ({ w: s.weight_kg ?? 0, r: s.reps ?? 0 }));
  if (!rows.length || !type) return null;
  let top = rows[0] as PrSetRef;
  for (const r of rows) {
    const a = sessionScore([r], type, bodyweight);
    const b = sessionScore([top], type, bodyweight);
    if (a > b || (a === b && r.w > top.w)) top = r;
  }
  return { score: round1(sessionScore(rows, type, bodyweight)), set: top };
}

/**
 * The all-time best score before `date` for one lift, from its stored sets (any order; only sets dated
 * before `date` count), and how many earlier days had one. The app feeds this to `isPrToday`; `bodyweight` is
 * for assisted lifts, as for `isPrToday`.
 *
 * New rule (#1351).
 */
export function priorBestOf(sets: readonly PrSet[], type: ExType | undefined, date: string, bodyweight?: number | null): PriorBest {
  const byDay = new Map<string, PrSet[]>();
  for (const s of sets) if (s.date < date) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  let best = 0;
  let sessions = 0;
  for (const day of byDay.values()) {
    const d = dayScore(day, type, bodyweight);
    if (!d) continue;
    sessions++;
    if (d.score > best) best = d.score;
  }
  return { best, sessions };
}

/**
 * Tick-time PR check: does today's score beat the all-time `prior` best by more than 0.5%, with at least
 * `PR_MIN_PRIOR_SESSIONS` earlier sessions? Returns what improved, or null. The score is chosen by `type`
 * (see `PrMetric`): loaded lifts use the best countable set's e1RM (done work sets, not fail, 1 to 12 reps,
 * not deleted; a single scores its weight); bodyweight and timed lifts use total reps; assisted lifts use
 * `sessionScore` with `bodyweight` (the latest logged weight, else the profile's, as `updateLift` gets it).
 * Unticking a set can turn a PR back into null. Once-per-lift-per-day stays the caller's `pbToast` guard.
 * Same rule as `personalRecords`, so the toast and the list agree.
 *
 * New rule (#1351); replaces the last-8 `beforeBest` of prototype `updateLift` + `checkBest`.
 */
export function isPrToday(prior: PriorBest, todaySets: readonly PrSet[], type?: ExType, bodyweight?: number | null): PrImprovement | null {
  if (prior.sessions < PR_MIN_PRIOR_SESSIONS) return null;
  const today = dayScore(todaySets, type, bodyweight);
  if (!today || !beats(today.score, prior.best)) return null;
  return { metric: metricOf(type), score: today.score, set: today.set, previousBest: prior.best, delta: round1(today.score - prior.best) };
}

/**
 * Every personal record, newest first (ties by lift name). Per lift (`types` maps name to type, see the
 * note at the top; `bodyweight` is for assisted lifts), the days are walked oldest first with a running
 * all-time best; a day is a record when its score beats the best of all earlier days by more than 0.5%
 * (`isPrToday`'s rule). The first day never counts, an equal value does not repeat a record, and the
 * running best only rises. Days are dates: two workouts on one date are one day.
 *
 * New rule (#1351).
 */
export function personalRecords(sets: readonly PrSet[], types: Readonly<Record<string, ExType>>, bodyweight?: number | null): PersonalRecord[] {
  const byLift = new Map<string, Map<string, PrSet[]>>();
  for (const s of sets) {
    const days = byLift.get(s.exercise) ?? new Map<string, PrSet[]>();
    days.set(s.date, [...(days.get(s.date) ?? []), s]);
    byLift.set(s.exercise, days);
  }
  const out: PersonalRecord[] = [];
  for (const [lift, days] of byLift) {
    const type = types[lift];
    let prior: PriorBest = { best: 0, sessions: 0 };
    for (const date of [...days.keys()].sort()) {
      const day = days.get(date) as PrSet[];
      const today = dayScore(day, type, bodyweight);
      if (!today) continue;
      const hit = isPrToday(prior, day, type, bodyweight);
      if (hit) out.push({ lift, date, ...hit });
      prior = { best: Math.max(prior.best, today.score), sessions: prior.sessions + 1 };
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.lift < b.lift ? -1 : a.lift > b.lift ? 1 : 0));
}

/** A lift picked by `mainLifts`. */
export interface MainLift {
  lift: string;
  /** Days with an estimate in the window. */
  sessions: number;
  /** Date of the latest of them. */
  last: string;
}

/**
 * The lifts the Progress charts show by default: the top `MAIN_LIFT_COUNT` loaded lifts by number of
 * DAYS with an estimate in the 12 weeks up to and including `end` (the viewed date; today when viewing
 * today), each with at least `MAIN_LIFT_MIN_POINTS`; ties go to the most recent day, then the name. Counting
 * days, as `personalRecords` does (two workouts on one date are one). Deleted sets are ignored; bodyweight,
 * timed and assisted types are excluded. `types` as in the note at the top (a missing name is read as loaded).
 *
 * New rule (#1351).
 */
export function mainLifts(sets: readonly PrSet[], types: Readonly<Record<string, ExType>>, end: string): MainLift[] {
  const from = addDays(end, -7 * MAIN_LIFT_WEEKS);
  const byLift = new Map<string, PrSet[]>();
  for (const s of sets) {
    if (s.deleted_at || s.date < from || s.date > end) continue;
    const { session: _session, ...day } = s; // days, not sessions
    byLift.set(s.exercise, [...(byLift.get(s.exercise) ?? []), day]);
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
