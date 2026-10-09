import type { Measurement, Weight } from '../progress/types';
import type { StoreDb } from './records';
import type { WorkoutDb } from './workouts';

// Weights and measurements are natural-key tables (key = date). Deleted entries stay as tombstones (deleted_at in the
// document), never a hard DELETE, so sync can push the delete.

/** All weigh-ins, tombstones included (core's functions skip them). */
export async function loadWeights(db: WorkoutDb): Promise<Weight[]> {
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM weights');
  return rows.map((r) => JSON.parse(r.data) as Weight);
}

export async function saveWeight(db: StoreDb, w: Weight): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO weights (key, data) VALUES (?, ?)', w.date, JSON.stringify(w));
}

/** All tape measurements, tombstones included. */
export async function loadMeasurements(db: WorkoutDb): Promise<Measurement[]> {
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM measurements');
  return rows.map((r) => JSON.parse(r.data) as Measurement);
}

export async function saveMeasurement(db: StoreDb, m: Measurement): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO measurements (key, data) VALUES (?, ?)', m.date, JSON.stringify(m));
}
