import type { SessionLog } from '@plate-and-bar/core';
import type { StoreDb } from './records';
import type { LiftStat, Workout, WorkoutSet } from '../workout/types';

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

export async function saveSet(db: StoreDb, date: string, s: WorkoutSet): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO workout_sets (key, workout_date, kind, done, data) VALUES (?, ?, ?, ?, ?)',
    s.id,
    date,
    s.kind,
    s.done ? 1 : 0,
    JSON.stringify(s),
  );
}

export async function loadLifts(db: WorkoutDb): Promise<LiftStat[]> {
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM lift_stats');
  return rows.map((r) => JSON.parse(r.data) as LiftStat);
}

export async function saveLift(db: StoreDb, l: LiftStat): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO lift_stats (key, data) VALUES (?, ?)', l.exercise, JSON.stringify(l));
}

/**
 * The prototype's `sessions` store, rebuilt from the records (contract `Workout`): an entry per
 * workout that is not deleted and has at least one done work set; `t` is `base`, else `template`, else "Session".
 */
export async function loadSessionLog(db: WorkoutDb): Promise<SessionLog> {
  const counts = await db.getAllAsync<{ workout_date: string; n: number }>(
    "SELECT workout_date, COUNT(*) AS n FROM workout_sets WHERE kind = 'work' AND done = 1 GROUP BY workout_date",
  );
  const log: Record<string, { t: string; n: number }> = {};
  for (const c of counts) {
    const w = await loadWorkout(db, c.workout_date);
    if (w && !w.deleted_at) log[c.workout_date] = { t: w.base || w.template || 'Session', n: c.n };
  }
  return log;
}
