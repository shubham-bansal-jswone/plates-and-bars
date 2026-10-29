import { HAND_PICKED } from '@plate-and-bar/core';
import type { LiftRecord, PrSet, SessionLog } from '@plate-and-bar/core';
import type { StoreDb } from './records';
import type { Workout, WorkoutSet } from '../workout/types';

/** The statements the training store needs, on top of the record store's. */
export interface WorkoutDb extends StoreDb {
  getAllAsync<T>(sql: string, ...params: (string | number)[]): Promise<T[]>;
}

export async function loadWorkout(db: StoreDb, date: string): Promise<Workout | null> {
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM workouts WHERE key = ?', date);
  return row ? (JSON.parse(row.data) as Workout) : null;
}

export async function saveWorkout(db: StoreDb, w: Workout): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO workouts (key, data) VALUES (?, ?)', w.date, JSON.stringify(w));
}

export async function loadSets(db: WorkoutDb, date: string): Promise<WorkoutSet[]> {
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM workout_sets WHERE workout_date = ?', date);
  return rows.map((r) => JSON.parse(r.data) as WorkoutSet);
}

/** One exercise's done, live work sets on days that have a live workout (as the history counts them), for the e1RM trend. Read on the device, nothing leaves it. */
export async function loadExerciseSets(db: WorkoutDb, exercise: string): Promise<(WorkoutSet & { date: string })[]> {
  const rows = await db.getAllAsync<{ workout_date: string; data: string }>(
    "SELECT workout_date, data FROM workout_sets WHERE kind = 'work' AND done = 1 AND deleted = 0 AND json_extract(data, '$.exercise') = ? AND workout_date IN (SELECT key FROM workouts WHERE json_extract(data, '$.deleted_at') IS NULL)",
    exercise,
  );
  return rows.map((r) => ({ ...(JSON.parse(r.data) as WorkoutSet), date: r.workout_date }));
}

/** The `loadDoneSets` statement; `?1` and `?2` are the inclusive date bounds (`''` and `'9999-12-31'` when open). The plan is SCAN workouts (live ones) with an index lookup on `workout_sets_by_date` per workout key; the bounds are filters on that lookup, not an index range. */
export const DONE_SETS_SQL =
  "SELECT workout_date, data FROM workout_sets WHERE kind = 'work' AND done = 1 AND deleted = 0 AND workout_date >= ? AND workout_date <= ? AND workout_date IN (SELECT key FROM workouts WHERE json_extract(data, '$.deleted_at') IS NULL) ORDER BY workout_date";

/**
 * Every done, live WORK set on days that have a live workout, oldest day first, in the shape core's records and e1RM
 * functions read (ramp sets never). `from` and `to` (`YYYY-MM-DD`) are inclusive and optional (the progress hook reads everything; the bounds are kept for other callers and tests). One query, so Progress
 * needs no read per day. The plan is a scan of `workouts` (live ones) with a `workout_sets_by_date` key lookup per
 * workout day, so the cost follows the whole history, not the bounds. Read on the device, nothing leaves it.
 */
export async function loadDoneSets(db: WorkoutDb, from = '', to = '9999-12-31'): Promise<PrSet[]> {
  const rows = await db.getAllAsync<{ workout_date: string; data: string }>(DONE_SETS_SQL, from, to);
  return rows.map((r) => {
    const s = JSON.parse(r.data) as WorkoutSet;
    return { date: r.workout_date, exercise: s.exercise, kind: 'work', weight_kg: s.weight_kg, reps: s.reps, done: s.done, rate: s.rate, deleted_at: s.deleted_at ?? null };
  });
}

export async function saveSet(db: StoreDb, date: string, s: WorkoutSet): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO workout_sets (key, workout_date, kind, done, deleted, data) VALUES (?, ?, ?, ?, ?, ?)',
    s.id,
    date,
    s.kind,
    s.done ? 1 : 0,
    s.deleted_at ? 1 : 0,
    JSON.stringify(s),
  );
}

// lift_stats holds core's own lift record (`LiftRecord`: sets {w, r, rate}, hist, pbToast, ...) as is, one row per
// exercise, so the weight guidance and `updateLift` read and write it with no field mapping in the app.
// It is mapped to the contract's LiftStat (weight_kg, reps, sessions, history, pb_toast_date, ...) at sync time
// by core's mapper (#135).

export async function loadLifts(db: WorkoutDb): Promise<Record<string, LiftRecord>> {
  const rows = await db.getAllAsync<{ key: string; data: string }>('SELECT key, data FROM lift_stats');
  const live = rows.map((r) => [r.key, JSON.parse(r.data) as LiftRecord & { deleted_at?: string }] as const).filter(([, l]) => !l.deleted_at);
  return Object.fromEntries(live);
}

export async function saveLift(db: StoreDb, exercise: string, record: LiftRecord): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO lift_stats (key, data) VALUES (?, ?)', exercise, JSON.stringify(record));
}

/** Deletes an exercise's lift record: a tombstone row (`deleted_at`) that `loadLifts` skips and sync can push. */
export async function deleteLift(db: StoreDb, exercise: string, at: string): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO lift_stats (key, data) VALUES (?, ?)', exercise, JSON.stringify({ deleted_at: at }));
}

/**
 * The prototype's `sessions` store, rebuilt from the records (contract `Workout`): an entry per
 * workout that is not deleted and has at least one done work set; `t` is `base`, else `template`, else core's `HAND_PICKED` ("Session").
 */
export async function loadSessionLog(db: WorkoutDb): Promise<SessionLog> {
  const counts = await db.getAllAsync<{ workout_date: string; n: number }>(
    "SELECT workout_date, COUNT(*) AS n FROM workout_sets WHERE kind = 'work' AND done = 1 AND deleted = 0 GROUP BY workout_date",
  );
  const log: Record<string, { t: string; n: number }> = {};
  for (const c of counts) {
    const w = await loadWorkout(db, c.workout_date);
    if (w && !w.deleted_at) log[c.workout_date] = { t: w.base || w.template || HAND_PICKED, n: c.n };
  }
  return log;
}
