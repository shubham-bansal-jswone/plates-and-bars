import type { Schemas } from '@plate-and-bar/api';
import type { StoreDb } from './records';
import type { WorkoutDb } from './workouts';

export type ExclusionRecord = Schemas['Exclusion'];
export type SwapRecord = Schemas['Swap'];

// Exclusions are keyed by their random id; swaps by the source exercise (one per `from`). Removing either is a
// tombstone (`deleted_at`), never a DELETE, so the change is queued for sync (see migration v6).

async function loadAll<T extends { deleted_at: string | null }>(db: WorkoutDb, table: 'exclusions' | 'swaps'): Promise<T[]> {
  const rows = await db.getAllAsync<{ key: string; data: string }>(`SELECT key, data FROM ${table}`);
  return rows.map((r) => JSON.parse(r.data) as T).filter((r) => !r.deleted_at);
}

export const loadExclusions = (db: WorkoutDb): Promise<ExclusionRecord[]> => loadAll<ExclusionRecord>(db, 'exclusions');
export const loadSwaps = (db: WorkoutDb): Promise<SwapRecord[]> => loadAll<SwapRecord>(db, 'swaps');

export async function saveExclusion(db: StoreDb, r: ExclusionRecord): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO exclusions (key, data) VALUES (?, ?)', r.id, JSON.stringify(r));
}

export async function saveSwap(db: StoreDb, r: SwapRecord): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO swaps (key, data) VALUES (?, ?)', r.from, JSON.stringify(r));
}

/** Removes a rule: its record kept with `deleted_at` set. */
export const deleteExclusion = (db: StoreDb, r: ExclusionRecord, at: string): Promise<void> => saveExclusion(db, { ...r, deleted_at: at, updated_at: at });

/** Undoes a swap: its record kept with `deleted_at` set. */
export const deleteSwap = (db: StoreDb, r: SwapRecord, at: string): Promise<void> => saveSwap(db, { ...r, deleted_at: at, updated_at: at });
