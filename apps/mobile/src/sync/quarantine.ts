import { clearPushed, inTransaction, type OutboxEntry, type PullDb, type SyncTableName } from '../db/outbox';
import type { StoreDb } from '../db/records';
import type { WorkoutDb } from '../db/workouts';

// A record the server refuses (400) is set aside, not retried every run, so the rest keeps syncing. It stays in the outbox
// (still "not synced"); a marker row in the device-local key/value table (`sync.` prefix, so wipes remove it) hides that
// outbox entry from `pendingChanges`. The marker names the entry's `seq`: editing the record again queues a new `seq`,
// which is not hidden, so a fixed record goes out on its own. The marker holds only the field path the server named
// (for example `changes.food_logs[0].kcal`), never a value.

const PREFIX = 'sync.quarantine.';
export const QUARANTINE_PREFIX = PREFIX;
export const quarantineKey = (e: Pick<OutboxEntry, 'seq' | 'tbl' | 'key'>) => `${PREFIX}${e.seq}.${e.tbl}.${e.key}`;

export interface Quarantined {
  tbl: SyncTableName;
  key: string;
  seq: number;
  /** The server's field path, e.g. `changes.food_logs[0].kcal`. */
  field: string;
}

/**
 * Sets the entry aside. It does nothing when the record was edited since it was sent (its `seq` moved on): the newer
 * edit is a different change and goes out on the next run. Returns whether it was set aside.
 */
export async function quarantine(db: PullDb, e: OutboxEntry, field: string, guard: (txn: StoreDb) => Promise<void>, unsupported = false): Promise<boolean> {
  let done = false;
  await inTransaction(db, async (txn) => {
    await guard(txn);
    const row = await txn.getFirstAsync<{ seq: number }>('SELECT seq FROM sync_outbox WHERE tbl = ? AND key = ?', e.tbl, e.key);
    if (row?.seq !== e.seq) return;
    await txn.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', quarantineKey(e), field);
    // The server did not implement the table (400 `unsupported_table`, #1281): remember it, so a later upgrade of the server can be tried (see `retryUnsupported`).
    if (unsupported) await txn.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')", `${UNSUPPORTED_PREFIX}${e.seq}.${e.tbl}.${e.key}`);
    done = true;
  });
  return done;
}

/** The records set aside now (a marker whose entry was edited or removed since is ignored). */
export async function listQuarantined(db: WorkoutDb): Promise<Quarantined[]> {
  return db.getAllAsync<Quarantined>(
    `SELECT o.tbl AS tbl, o.key AS key, o.seq AS seq, s.value AS field FROM sync_outbox o JOIN settings s ON s.key = '${PREFIX}' || o.seq || '.' || o.tbl || '.' || o.key ORDER BY o.seq`,
  );
}

export async function quarantineCount(db: WorkoutDb): Promise<number> {
  return (await listQuarantined(db)).length;
}

const UNSUPPORTED_PREFIX = 'sync.unsupported.';

/**
 * Puts the records set aside for `unsupported_table` back in line (ADR 011): the server may have been upgraded since. Records set
 * aside for another reason stay aside. A record the server still refuses is set aside again by the same run. Returns how many.
 */
export async function retryUnsupported(db: PullDb, guard: (txn: StoreDb) => Promise<void>): Promise<number> {
  let n = 0;
  if (!(await (db as unknown as WorkoutDb).getFirstAsync(`SELECT 1 AS x FROM settings WHERE key LIKE '${UNSUPPORTED_PREFIX}%' LIMIT 1`))) return 0; // the usual case: no transaction
  await inTransaction(db, async (txn) => {
    await guard(txn);
    const rows = await (txn as WorkoutDb).getAllAsync<{ key: string }>(`SELECT key FROM settings WHERE key LIKE '${UNSUPPORTED_PREFIX}%'`);
    for (const r of rows) {
      await txn.runAsync('DELETE FROM settings WHERE key = ?', PREFIX + r.key.slice(UNSUPPORTED_PREFIX.length));
      await txn.runAsync('DELETE FROM settings WHERE key = ?', r.key);
    }
    n = rows.length;
  });
  return n;
}

/** Puts every set-aside record back in line for the next run. */
export async function retryQuarantined(db: PullDb): Promise<void> {
  await inTransaction(db, async (txn) => void (await txn.runAsync(`DELETE FROM settings WHERE key LIKE '${PREFIX}%'`)));
}

/**
 * Stops trying to send the set-aside records: their outbox entries are removed (only while unchanged, so a newer edit
 * stays queued). The records themselves stay on this device.
 */
export async function discardQuarantined(db: PullDb): Promise<number> {
  let n = 0;
  await inTransaction(db, async (txn) => {
    const rows = await listQuarantined(txn as WorkoutDb);
    for (const r of rows) await clearPushed(txn, r);
    for (const r of rows) await txn.runAsync('DELETE FROM settings WHERE key = ?', `sync.sent.${r.tbl}.${r.key}`); // held.ts: nothing is sent for them now
    await txn.runAsync(`DELETE FROM settings WHERE key LIKE '${PREFIX}%'`);
    n = rows.length;
  });
  return n;
}
