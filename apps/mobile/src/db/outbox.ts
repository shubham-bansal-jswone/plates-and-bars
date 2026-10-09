import type { WorkoutDb } from './workouts';
import type { StoreDb } from './records';
import { writeLock } from './writeLock';

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

/** Changed records not set aside, oldest edit first, at most `limit` (the contract allows 500 per request). */
export async function pendingChanges(db: WorkoutDb, limit = 500): Promise<OutboxEntry[]> {
  // Entries the server refused and the engine set aside (see sync/quarantine.ts) are not sent again until retried or edited.
  return db.getAllAsync<OutboxEntry>(
    "SELECT o.seq, o.tbl, o.key, o.queued_at FROM sync_outbox o WHERE NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = 'sync.quarantine.' || o.seq || '.' || o.tbl || '.' || o.key) ORDER BY o.seq LIMIT ?",
    limit,
  );
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

/** Runs `task` in a transaction, one at a time with every other write that takes the app's write lock. */
export function inTransaction(db: PullDb, task: (txn: StoreDb) => Promise<void>): Promise<void> {
  return writeLock.run(() => db.withExclusiveTransactionAsync(task));
}

/** True when the record has a local change not pushed yet. */
export async function isQueued(db: StoreDb, tbl: SyncTableName, key: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ seq: number }>('SELECT seq FROM sync_outbox WHERE tbl = ? AND key = ?', tbl, key);
  return row !== null;
}

/**
 * Applies a pulled record without queuing it. The triggers queue every write, so this writes the row inside one
 * transaction, reads the seq the write produced, and clears it with the seq-guarded `clearPushed`.
 *
 * The queued check happens inside that transaction: a record with an unpushed local edit is a conflict for the next
 * push to settle, so it is left as it is and this returns false. (Checking before the transaction would let an edit
 * land in between and be overwritten and un-queued.)
 */
export async function applyPulled(db: PullDb, tbl: SyncTableName, key: string, write: (txn: StoreDb) => Promise<void>): Promise<boolean> {
  let applied = false;
  await inTransaction(db, async (txn) => {
    if (await isQueued(txn, tbl, key)) return;
    await write(txn);
    applied = true;
    const row = await txn.getFirstAsync<{ seq: number }>('SELECT seq FROM sync_outbox WHERE tbl = ? AND key = ?', tbl, key);
    if (row) await clearPushed(txn, { tbl, key, seq: row.seq });
  });
  return applied;
}
