import type { WorkoutDb } from './workouts';
import type { StoreDb } from './records';

/** The 16 contract sync tables (`SyncTable`) and the local table each one is stored in. */
export const SYNC_TABLES = {
  profiles: 'profiles',
  consents: 'consents',
  food_logs: 'food_logs',
  water_logs: 'water_logs',
  day_notes: 'day_notes',
  workouts: 'workouts',
  workout_sets: 'workout_sets',
  lift_stats: 'lift_stats',
  weights: 'weights',
  measurements: 'measurements',
  user_foods: 'user_foods',
  recipes: 'recipes',
  kitchen_tests: 'kitchen_tests',
  exclusions: 'exclusions',
  swaps: 'swaps',
  settings: 'user_settings',
} as const;

export type SyncTableName = keyof typeof SYNC_TABLES;

/** One changed record waiting to be pushed. `seq` grows with every new edit of the record. */
export interface OutboxEntry {
  seq: number;
  tbl: SyncTableName;
  key: string;
  queued_at: string;
}

/** Changed records, oldest edit first, at most `limit` (the contract allows 500 per request). */
export async function pendingChanges(db: WorkoutDb, limit = 500): Promise<OutboxEntry[]> {
  return db.getAllAsync<OutboxEntry>('SELECT seq, tbl, key, queued_at FROM sync_outbox ORDER BY seq LIMIT ?', limit);
}

/** How many local changes are not pushed yet (what #31 shows before sign-out). */
export async function pendingCount(db: StoreDb): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox');
  return row?.n ?? 0;
}

/**
 * Clears an entry after the server applied it (or a conflict replaced the local copy). It only clears when `seq` is
 * unchanged, so an edit made while the request was in flight stays queued.
 */
export async function clearPushed(db: StoreDb, e: Pick<OutboxEntry, 'tbl' | 'key' | 'seq'>): Promise<void> {
  await db.runAsync('DELETE FROM sync_outbox WHERE tbl = ? AND key = ? AND seq = ?', e.tbl, e.key, e.seq);
}

/** The subset of expo-sqlite's database that runs a block in one exclusive transaction. */
export interface PullDb {
  withExclusiveTransactionAsync(task: (txn: StoreDb) => Promise<void>): Promise<void>;
}

/** True when the record has a local change not pushed yet. */
export async function isQueued(db: StoreDb, tbl: SyncTableName, key: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ seq: number }>('SELECT seq FROM sync_outbox WHERE tbl = ? AND key = ?', tbl, key);
  return row !== null;
}

/**
 * Applies a pulled record without queuing it for push. The triggers queue every write, so this writes the row inside an
 * exclusive transaction, reads the seq the write produced, and clears it with the seq-guarded `clearPushed`; a local edit
 * that lands after the write has a newer seq and stays queued.
 *
 * Dirtiness must be checked BEFORE calling: for a record that is still queued locally (`isQueued`), do not call this.
 * That record is a conflict to resolve, and writing it would replace the local edit and drop it from the queue.
 */
export async function applyPulled(db: PullDb, tbl: SyncTableName, key: string, write: (txn: StoreDb) => Promise<void>): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await write(txn);
    const row = await txn.getFirstAsync<{ seq: number }>('SELECT seq FROM sync_outbox WHERE tbl = ? AND key = ?', tbl, key);
    if (row) await clearPushed(txn, { tbl, key, seq: row.seq });
  });
}
