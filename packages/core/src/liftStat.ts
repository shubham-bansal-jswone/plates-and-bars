// Mapping between core's lift record (prototype `S.lifts[name]`) and the contract's `LiftStat` (#135).
import type { LiftRecord, LiftSession, LiftSet, Rate } from './progression';

/** Contract `LiftSet`: prototype `{w, r, rate}` as `{weight_kg, reps, rate}`, rate null when not rated. */
export interface LiftStatSet {
  weight_kg: number;
  reps: number;
  rate: Rate | null;
}

/** Contract `LiftSession`: an earlier session, without a `prev` key of its own. */
export interface LiftStatSession {
  date: string;
  sets: LiftStatSet[];
  form: 'yes' | 'no' | null;
}

/** Contract `LiftStat.prev`: the session before the latest, with the session before it one level deep (#101). */
export interface LiftStatPrev extends LiftStatSession {
  prev?: LiftStatSession | null;
}

/** Contract `LiftStat` without the sync metadata (`id`, `version`, `updated_at`, `deleted_at`). */
export interface LiftStatBody {
  exercise: string;
  date: string;
  sets: LiftStatSet[];
  form: 'yes' | 'no' | null;
  sessions: number;
  first: string;
  prev: LiftStatPrev | null;
  history: { date: string; score: number }[];
  pb_toast_date: string | null;
}

/** A lift_stats tombstone body: every field the `LiftStat` schema requires, plus `deleted_at` (no `id`, `version`, `updated_at`). */
export interface LiftStatTombstone extends LiftStatBody {
  deleted_at: string;
}

const toStatSets = (sets: readonly LiftSet[]): LiftStatSet[] => sets.map((s) => ({ weight_kg: s.w, reps: s.r, rate: s.rate ?? null }));
const toRecordSets = (sets: readonly LiftStatSet[]): LiftSet[] => sets.map((s) => ({ w: s.weight_kg, r: s.reps, rate: s.rate ?? null }));
const toStatSession = (s: LiftSession): LiftStatSession => ({ date: s.date, sets: toStatSets(s.sets), form: s.form ?? null });
const toRecordSession = (s: LiftStatSession): LiftSession => ({ date: s.date, sets: toRecordSets(s.sets), form: s.form ?? null });

/**
 * Core's lift record for `exercise` as the contract's `LiftStat` body; the caller adds the sync
 * metadata. Renames `w`/`r`/`e`/`n`/`hist`/`pbToast`, turns missing values into null and applies the
 * fallbacks for older records: `sessions` = `n || (prev ? 2 : 1)` (as prototype `updateLift`),
 * `first` = `first || prev.date || date`. `prev` keeps its own `prev` one level deep: the inner
 * session never carries a `prev` key (contract 0.1.2 rejects one, even null); the outer `prev.prev`
 * key is written only when the record has it. `history` keeps the last 8 entries (contract maxItems).
 */
export function recordToLiftStat(exercise: string, l: LiftRecord): LiftStatBody {
  let prev: LiftStatPrev | null = null;
  if (l.prev) {
    prev = toStatSession(l.prev);
    if (l.prev.prev !== undefined) prev.prev = l.prev.prev ? toStatSession(l.prev.prev) : null;
  }
  return {
    exercise,
    date: l.date,
    sets: toStatSets(l.sets),
    form: l.form ?? null,
    sessions: l.n || (l.prev ? 2 : 1),
    first: l.first || l.prev?.date || l.date,
    prev,
    history: (l.hist ?? []).slice(-8).map((h) => ({ date: h.date, score: h.e })),
    pb_toast_date: l.pbToast ?? null,
  };
}

/**
 * The contract's `LiftStat` (sync metadata, if present, is ignored) as core's lift record. Sets keep
 * `rate: null` when not rated, as prototype `updateLift` writes them. `prev.prev` is kept one level
 * deep (any deeper `prev` is dropped) and its key is present only when the stat has it. Check
 * `deleted_at` before calling: a tombstone is not a record.
 */
export function liftStatToRecord(s: LiftStatBody): LiftRecord {
  let prev: LiftSession | null = null;
  if (s.prev) {
    prev = toRecordSession(s.prev);
    if (s.prev.prev !== undefined) prev.prev = s.prev.prev ? toRecordSession(s.prev.prev) : null;
  }
  return {
    date: s.date,
    sets: toRecordSets(s.sets),
    form: s.form ?? null,
    n: s.sessions,
    first: s.first,
    prev,
    hist: s.history.map((h) => ({ date: h.date, e: h.score })),
    pbToast: s.pb_toast_date ?? null,
  };
}

/**
 * The `LiftStat` tombstone for a deleted lift record (`updateLift` gave `record: null`, #122), deleted at
 * the UTC timestamp `deletedAt`. The schema still requires every field, so they are filled with
 * placeholders: `date` and `first` are the day of `deletedAt`, no sets, one session, no history. The
 * caller adds `id` (UUIDv5 of `lift_stats:<exercise>`), `version` and `updated_at`.
 */
export function liftStatTombstone(exercise: string, deletedAt: string): LiftStatTombstone {
  const day = deletedAt.slice(0, 10);
  return { exercise, date: day, sets: [], form: null, sessions: 1, first: day, prev: null, history: [], pb_toast_date: null, deleted_at: deletedAt };
}
