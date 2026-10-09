import type { DayNote, FoodLog, UserFood } from '../food/types';
import type { StoreDb } from './records';
import type { WorkoutDb } from './workouts';

export async function loadLogs(db: WorkoutDb, date: string): Promise<FoodLog[]> {
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM food_logs WHERE log_date = ?', date);
  return rows.map((r) => JSON.parse(r.data) as FoodLog).filter((l) => !l.deleted_at);
}

export async function saveLog(db: StoreDb, l: FoodLog): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO food_logs (key, log_date, data) VALUES (?, ?, ?)', l.id, l.date, JSON.stringify(l));
}

export async function loadDayNote(db: StoreDb, date: string): Promise<DayNote | null> {
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM day_notes WHERE key = ?', date);
  return row ? (JSON.parse(row.data) as DayNote) : null;
}

export async function saveDayNote(db: StoreDb, n: DayNote): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO day_notes (key, data) VALUES (?, ?)', n.date, JSON.stringify(n));
}

const blankNote = (date: string): DayNote => ({ id: null, version: 0, deleted_at: null, updated_at: '', date, complete: null, steps: null, sleep: null, fast: false });

/**
 * Changes some fields of a day's note. It reads the stored note at write time and merges only `patch`, so two screens
 * saving different fields of the same day (Food's "logged everything", Progress's steps and sleep) never overwrite each other.
 * Call it from inside the write queue.
 */
export async function patchDayNote(db: StoreDb, date: string, patch: Partial<Pick<DayNote, 'complete' | 'steps' | 'steps_source' | 'sleep' | 'fast'>>, updatedAt: string): Promise<void> {
  const cur = (await loadDayNote(db, date)) ?? blankNote(date);
  await saveDayNote(db, { ...cur, ...patch, deleted_at: null, updated_at: updatedAt });
}

/** The user's foods, newest first (by `updated_at`), tombstones left out. */
export async function loadUserFoods(db: WorkoutDb): Promise<UserFood[]> {
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM user_foods');
  return rows
    .map((r) => JSON.parse(r.data) as UserFood)
    .filter((f) => !f.deleted_at)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.name.localeCompare(b.name));
}

export async function saveUserFood(db: StoreDb, f: UserFood): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO user_foods (key, data) VALUES (?, ?)', f.id, JSON.stringify(f));
}
