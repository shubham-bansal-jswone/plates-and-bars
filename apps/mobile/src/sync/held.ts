import { inTransaction, type OutboxEntry, type PullDb, type SyncTableName } from '../db/outbox';
import type { StoreDb } from '../db/records';
import type { WorkoutDb } from '../db/workouts';
import { QUARANTINE_PREFIX } from './quarantine';
import { getKv, setKv } from './store';

// The account is full (413 `account_full`, contract 0.1.16). The engine keeps every pending record, keeps pushing edits
// and deletes (version above 0) and keeps pulling, and holds the records that would be new (version 0). Like the
// quarantine, bookkeeping lives in the device-local `settings` table under `sync.` keys (so sign-out and wipes remove it):
//  - `sync.account_full`: set while the server says the account is full; the notice reads it.
//  - `sync.held.<seq>.<tbl>.<key>`: this outbox entry is held, so `pendingChanges` hides it. The value is when it was last
//    tried ('0' = not yet), so each retry session goes through the least recently tried records first. An edit queues a
//    new `seq`, which is not hidden: the engine looks at it again.
//  - `sync.sent.<tbl>.<key>`: a request carried this version-0 record, so the server may store it (the response can be
//    lost). A version-0 tombstone without this marker never left the device and is dropped instead of held.
// No marker holds a value from a record.

export const KEY_ACCOUNT_FULL = 'sync.account_full';
export const HELD_PREFIX = 'sync.held.';
const SENT_PREFIX = 'sync.sent.';
const heldKey = (e: Pick<OutboxEntry, 'seq' | 'tbl' | 'key'>) => `${HELD_PREFIX}${e.seq}.${e.tbl}.${e.key}`;
const sentKey = (e: Pick<OutboxEntry, 'tbl' | 'key'>) => `${SENT_PREFIX}${e.tbl}.${e.key}`;
type Guard = (db: StoreDb) => Promise<void>;
type Ref = { tbl: SyncTableName; key: string };

export async function isAccountFull(db: StoreDb): Promise<boolean> {
  return (await getKv(db, KEY_ACCOUNT_FULL)) !== null;
}

export async function setAccountFull(db: PullDb, guard: Guard): Promise<void> {
  await inTransaction(db, async (txn) => {
    await guard(txn);
    await setKv(txn, KEY_ACCOUNT_FULL, '1');
  });
}

/** A push with new records went through: the account has room again. The notice goes and every held record is pending again. */
export async function clearAccountFull(db: PullDb, guard: Guard): Promise<void> {
  await inTransaction(db, async (txn) => {
    await guard(txn);
    await txn.runAsync('DELETE FROM settings WHERE key = ?', KEY_ACCOUNT_FULL);
    await txn.runAsync(`DELETE FROM settings WHERE key LIKE '${HELD_PREFIX}%'`);
  });
}

/** Holds the entries (hides them from `pendingChanges`) and forgets the markers of entries that are gone or were edited since. */
export async function holdEntries(db: PullDb, entries: OutboxEntry[], guard: Guard): Promise<void> {
  await inTransaction(db, async (txn) => {
    await guard(txn);
    for (const e of entries) await setKv(txn, heldKey(e), '0');
    await txn.runAsync(`DELETE FROM settings WHERE key LIKE '${HELD_PREFIX}%' AND key NOT IN (SELECT '${HELD_PREFIX}' || seq || '.' || tbl || '.' || key FROM sync_outbox)`);
  });
}

/** Held entries tried before `before` (a stamp), least recently tried first; set-aside (quarantined) ones are left out. */
export async function heldEntries(db: WorkoutDb, limit: number, before: string): Promise<OutboxEntry[]> {
  return db.getAllAsync<OutboxEntry>(
    `SELECT o.seq, o.tbl, o.key, o.queued_at FROM sync_outbox o JOIN settings h ON h.key = '${HELD_PREFIX}' || o.seq || '.' || o.tbl || '.' || o.key
     WHERE h.value < ? AND NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = '${QUARANTINE_PREFIX}' || o.seq || '.' || o.tbl || '.' || o.key)
     ORDER BY h.value, o.seq LIMIT ?`,
    before,
    limit,
  );
}

/** Marks the entries as tried at `stamp`, so the rest of this session looks at other held records first. */
export async function touchHeld(db: PullDb, entries: OutboxEntry[], stamp: string, guard: Guard): Promise<void> {
  await inTransaction(db, async (txn) => {
    await guard(txn);
    for (const e of entries) await txn.runAsync('UPDATE settings SET value = ? WHERE key = ?', stamp, heldKey(e));
  });
}

/** True when a request ever carried this record (and the answer may have been lost). */
export async function wasSent(db: StoreDb, e: Ref): Promise<boolean> {
  return (await getKv(db, sentKey(e))) !== null;
}

/** Marks records as carried by a request about to go out; returns the ones that were not marked before. */
export async function markSent(db: PullDb, entries: Ref[], guard: Guard): Promise<Ref[]> {
  const fresh: Ref[] = [];
  await inTransaction(db, async (txn) => {
    await guard(txn);
    for (const e of entries) {
      if (await wasSent(txn, e)) continue;
      await setKv(txn, sentKey(e), '1');
      fresh.push({ tbl: e.tbl, key: e.key });
    }
  });
  return fresh;
}

/** The server refused the whole request and stored nothing: undo the marks that request made. */
export async function unmarkSent(db: PullDb, entries: Ref[], guard: Guard): Promise<void> {
  if (entries.length === 0) return;
  await inTransaction(db, async (txn) => {
    await guard(txn);
    for (const e of entries) await txn.runAsync('DELETE FROM settings WHERE key = ?', sentKey(e));
  });
}

/** The server now has the record with a version: the mark is no longer needed. */
export async function forgetSent(db: StoreDb, e: Ref): Promise<void> {
  await db.runAsync('DELETE FROM settings WHERE key = ?', sentKey(e));
}

/** The stamp for "tried at": sorts as text, and is always after the '0' of a record not tried yet. */
export const stampOf = (ms: number): string => String(ms).padStart(15, '0');
