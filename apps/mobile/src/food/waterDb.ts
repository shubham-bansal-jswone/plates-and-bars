import type { WeighIn } from '@plate-and-bar/core';
import type { StoreDb } from '../db/records';
import type { WorkoutDb } from '../db/workouts';
import type { WaterLog } from './water';

/** The day's drinks in the order they were logged, tombstones left out. */
export async function loadWaterLogs(db: WorkoutDb, date: string): Promise<WaterLog[]> {
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM water_logs WHERE log_date = ? ORDER BY rowid', date);
  return rows.map((r) => JSON.parse(r.data) as WaterLog).filter((l) => !l.deleted_at);
}

/** Writes a drink; an undo is the same row with `deleted_at` set (never a DELETE, so sync sees it). */
export async function saveWaterLog(db: StoreDb, l: WaterLog): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO water_logs (key, log_date, data) VALUES (?, ?, ?)', l.id, l.date, JSON.stringify(l));
}

/** Weigh-ins for core's `waterTarget` (the weights table is owned by the progress tab; this only reads it). */
export async function loadWeighIns(db: WorkoutDb): Promise<WeighIn[]> {
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM weights');
  return rows.map((r) => JSON.parse(r.data) as WeighIn);
}
