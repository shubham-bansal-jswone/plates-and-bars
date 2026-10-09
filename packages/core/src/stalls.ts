import { addDays, daysBetween, mondayOf } from './dates';
import { num } from './num';
import { noLoad, type ExInfo, type ExType, type ExerciseOverride, type LiftRecord, type LiftSet, type ScoreEntry, type SetEntry, type SettingsExerciseOverride } from './progression';

/**
 * Session score: total reps for bodyweight and timed exercises; for assisted, the best effective
 * load `reps × max(0, bodyweight − assistance)` (#122), or `reps × 2 − assistance` when `bodyweight`
 * is unknown (absent, null or 0). Callers pass the latest logged weight if any, else contract
 * `Profile.weight_kg` (as prototype `workoutBurn` does); otherwise the best Epley estimate
 * `w × (1 + r/30)`. Empty `sets` gives 0 for bodyweight and timed, `-Infinity` otherwise (never
 * scored: `updateLift` removes today's record instead).
 *
 * Mirrors prototype `sessionScore(sets, type, bw)`.
 */
export function sessionScore(sets: readonly Pick<LiftSet, 'w' | 'r'>[], type: ExType, bodyweight?: number | null): number {
  if (noLoad(type)) return sets.reduce((n, s) => n + s.r, 0);
  const bw = bodyweight || 0;
  if (type === 'assisted') return Math.max(...sets.map((s) => (bw ? s.r * Math.max(0, bw - s.w) : s.r * 2 - s.w)));
  return Math.max(...sets.map((s) => s.w * (1 + s.r / 30)));
}

/**
 * Stalled: at least 4 scored sessions, and none of the last 3 beats the best before them by more
 * than 1%.
 *
 * Mirrors prototype `stalled(name)` (`S.lifts` passed in).
 */
export function stalled(name: string, lifts: Readonly<Record<string, LiftRecord>>): boolean {
  const h = (lifts[name] || {}).hist || [];
  if (h.length < 4) return false;
  const prior = Math.max(...h.slice(0, -3).map((x) => x.e));
  return h.slice(-3).every((x) => x.e <= prior * 1.01);
}

/**
 * Stalled lifts last done within 21 days of `date`, in `lifts` key order. Callers must keep the
 * prototype's order, the order each lift was first trained (insertion order of `S.lifts`): it decides
 * which 3 names the recovery card shows.
 *
 * Mirrors prototype `stalledList()` (`S.lifts`, `S.date` passed in).
 */
export function stalledList(lifts: Readonly<Record<string, LiftRecord>>, date: string): string[] {
  return Object.keys(lifts).filter((n) => stalled(n, lifts) && daysBetween((lifts[n] as LiftRecord).date, date) <= 21);
}

/** A dated adjustment such as a recovery week (prototype `adj.deload`, `adj.reentry`). */
export interface AdjRange {
  from?: string;
  until: string;
}

/**
 * Plan adjustment state (prototype `S.settings.adj`; contract `Settings.adjustments`). Only the
 * fields read here are typed.
 */
export interface AdjState {
  /** Card types the user turned off (`adj-mute`). */
  muted?: Readonly<Record<string, boolean>>;
  /** Card keys already answered. */
  dismissed?: Readonly<Record<string, boolean>>;
  /** The current or last recovery week. */
  deload?: AdjRange | null;
}

/** `r` covers `date`. Mirrors prototype `inRange(r)` (`S.date` passed in). */
export function inRange(r: AdjRange | null | undefined, date: string): boolean {
  return !!r && r.until >= date && (!r.from || r.from <= date);
}

/** The "Several lifts have stalled" card: what it names and the key that dismisses it. */
export interface RecoveryCard {
  /** Dismissal key, `deload:<Monday of date>`. */
  key: string;
  /** Up to 3 stalled lifts, named in the card. */
  names: string[];
  /** How many more stalled lifts there are ("and N more"); 0 for none. */
  more: number;
}

/**
 * The recovery-week card: 3 or more stalled lifts (see `stalledList`), no recovery week covering
 * `date`, the `deload` card not muted and this week's key not dismissed. Null when not shown.
 *
 * Mirrors the "several stalls → recovery week" step of prototype `renderStart()` and its `adjCard`.
 */
export function recoveryCard(lifts: Readonly<Record<string, LiftRecord>>, date: string, adj: AdjState = {}): RecoveryCard | null {
  const st = stalledList(lifts, date);
  if (st.length < 3 || inRange(adj.deload, date)) return null;
  const key = `deload:${mondayOf(date)}`;
  if ((adj.muted || {}).deload || (adj.dismissed || {})[key]) return null;
  return { key, names: st.slice(0, 3), more: st.length - 3 };
}

/**
 * "Start recovery week": 7 days from `date`. Store it as `adj.deload` and dismiss the card's key.
 *
 * Mirrors prototype `adjAction('adj-deload')`.
 */
export function recoveryWeek(date: string): Required<AdjRange> {
  return { from: date, until: addDays(date, 6) };
}

/** The per-exercise "No progress in 3 sessions" card. */
export interface StallCard {
  /** Dismissal key, `stall:<name>:<date of the last record>`. */
  key: string;
  /** True when the range bottom is 8 or more: suggest a heavier (lower-rep) range. */
  heavy: boolean;
  /** Suggested rep range: 6–8 when `heavy`, else 10–12. */
  range: [number, number];
}

/**
 * The stall card for an exercise in today's session: stalled, no set ticked yet, the `stall` card not
 * muted and its key not dismissed. `info` is the exercise's `exInfo` (where-aware). Null when not
 * shown. The prototype's "Or switch to …" button shows when `sidewaysOf` finds an exercise; save it with
 * `ladderSwap('side', ...)`.
 *
 * Mirrors prototype `stallCard(ex)` (state passed in).
 */
export function stallCard(
  ex: { name: string; sets: readonly Pick<SetEntry, 'done'>[] },
  lifts: Readonly<Record<string, LiftRecord>>,
  info: ExInfo,
  adj: AdjState = {},
): StallCard | null {
  if ((adj.muted || {}).stall || !stalled(ex.name, lifts) || ex.sets.some((s) => s.done)) return null;
  const key = `stall:${ex.name}:${(lifts[ex.name] as LiftRecord).date}`;
  if ((adj.dismissed || {})[key]) return null;
  const heavy = info.lo >= 8;
  return { key, heavy, range: heavy ? [6, 8] : [10, 12] };
}

/**
 * "Switch to lo–hi" on the stall card: the exercise's new setting, keeping other fields and fixing
 * type and step from `info`. Store it in `overrides[name]` and dismiss the card's key.
 *
 * Mirrors prototype `adjAction('adj-range')`.
 */
export function stallRange(override: ExerciseOverride | null | undefined, info: ExInfo, range: readonly [number, number]): ExerciseOverride {
  return { ...(override || {}), type: info.type, step: info.step, lo: range[0], hi: range[1] };
}

/**
 * `stallRange` in the contract's shape: the contract `Settings.exercise_overrides[name]` entry to save
 * for "Switch to lo–hi", merged as the prototype merges it (other fields of `existing` kept; `type` and
 * `step_kg` from `info`, the new range). Also dismiss the card's key.
 *
 * Mirrors prototype `adjAction('adj-range')` on contract settings (#128).
 */
export function stallRangeOverride(existing: SettingsExerciseOverride | null | undefined, info: ExInfo, range: readonly [number, number]): SettingsExerciseOverride {
  return { ...(existing || {}), type: info.type, step_kg: info.step, rep_low: range[0], rep_high: range[1] };
}

/**
 * Personal best: the lift has at least 2 scores, `beforeBest` (the best before today) is non-zero,
 * and today's score beats it by more than 0.5%; and no toast for this lift today yet. When true,
 * show the toast and set the record's `pbToast` to `date`.
 *
 * Mirrors prototype `checkBest(name, beforeBest)` (record and `S.date` passed in).
 */
export function checkBest(record: Pick<LiftRecord, 'hist' | 'pbToast'> | undefined, beforeBest: number, date: string): boolean {
  const h = (record || {}).hist || [];
  if (h.length < 2) return false;
  const cur = (h[h.length - 1] as ScoreEntry).e;
  if (!(beforeBest && cur > beforeBest * 1.005)) return false;
  return (record as LiftRecord).pbToast !== date;
}

/** Result of `updateLift`: the new record (`null`: delete the lift's record), and whether to show the personal-best toast. */
export interface LiftUpdate {
  record: LiftRecord | null;
  toast: boolean;
}

/**
 * Rebuilds an exercise's record from today's ticked sets (a set counts when weight or reps is
 * non-zero) and adds today's score (`sessionScore`, with `bodyweight` for assisted machines: the
 * latest logged weight if any, else contract `Profile.weight_kg`) to its history (rounded to 0.1, last 8 kept, today's earlier score replaced). A record from an earlier day becomes `prev`, carrying its own `prev` (one level, without
 * a further `prev`) so the weight guidance can still see two sessions before today (#101).
 *
 * With no counted sets left and a record from `date` (#122): today's record is removed and the session
 * before restored from its `prev` (date, sets, form, its own `prev`; `n` one less, at least 1; `first`
 * and `pbToast` kept; today's score dropped from the history), toast false; with no `prev`, `record`
 * is `null`: delete the lift's record. Null when nothing changes: no counted sets and no record from
 * `date`, or the record is newer than `date`. A record from the same day, or one whose `pbToast` is
 * `date` (restored after unticking), keeps its `pbToast`, so the best toast shows at most once a day
 * (#121, contract `pb_toast_date`).
 * Then runs `checkBest` against the best score before today; when it toasts, the new record's
 * `pbToast` is `date`.
 *
 * Mirrors prototype `updateLift(ex)` (record, `S.date`, `exInfo(name).type` and the profile's weight
 * passed in).
 */
export function updateLift(
  L: LiftRecord | null | undefined,
  ex: { sets: readonly SetEntry[]; form?: 'yes' | 'no' | null },
  date: string,
  type: ExType,
  bodyweight?: number | null,
): LiftUpdate | null {
  const sets: LiftSet[] = ex.sets.filter((s) => s.done && (num(s.w) || num(s.r))).map((s) => ({ w: num(s.w), r: num(s.r), rate: s.rate || null }));
  if (!sets.length) {
    if (!L || L.date !== date) return null;
    const P = L.prev;
    if (!P) return { record: null, toast: false };
    const back: LiftRecord = { date: P.date, sets: P.sets, form: P.form || null, n: Math.max(1, (L.n || 1) - 1), first: L.first || P.date, prev: P.prev || null, hist: (L.hist || []).filter((x) => x.date !== date) };
    if (L.pbToast !== undefined) back.pbToast = L.pbToast;
    return { record: back, toast: false };
  }
  const form = ex.form || null;
  let record: LiftRecord;
  if (!L || L.date === date) record = { date, sets, form, n: L ? L.n || 1 : 1, first: L ? L.first || L.date : date, prev: L ? L.prev || null : null };
  else if (L.date < date)
    record = { date, sets, form, n: (L.n || (L.prev ? 2 : 1)) + 1, first: L.first || (L.prev ? L.prev.date : L.date), prev: { date: L.date, sets: L.sets, form: L.form || null, prev: L.prev ? { date: L.prev.date, sets: L.prev.sets, form: L.prev.form || null } : null } };
  else return null;
  if (L && L.pbToast !== undefined && (L.date === date || L.pbToast === date)) record.pbToast = L.pbToast; // #121, #122
  const hist = (L && L.hist ? L.hist : []).filter((x) => x.date !== date);
  const beforeBest = hist.length ? Math.max(...hist.map((x) => x.e)) : 0;
  hist.push({ date, e: Math.round(sessionScore(sets, type, bodyweight) * 10) / 10 });
  record.hist = hist.slice(-8);
  const toast = checkBest(record, beforeBest, date);
  if (toast) record.pbToast = date;
  return { record, toast };
}
