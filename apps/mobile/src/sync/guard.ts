import type { Schemas } from '@plate-and-bar/api';
import { SYNC_TABLES, inTransaction, type PullDb } from '../db/outbox';
import type { StoreDb } from '../db/records';
import { WriteLock } from '../db/writeLock';
import { pauseSync, resumeSync } from './engine';
import { KEY_PHOTOS_WIPE, KEY_SERVER_DELETED, KEY_USER, getKv, getUserId, setKv } from './store';
import type { TokenStore } from './tokens';
import { announceWipe, wipePhotos } from '../photos/vault';

// Device ownership rules of ADR 004 (#31): the local store belongs to one user; unsynced changes are never pushed under
// another user's token and never dropped without an explicit choice.

type Db = StoreDb & PullDb;

/** The one account-operation lock: sign-in, sign-out, discard, account switch, server export and delete everything run one at a time. */
const accountLock = new WriteLock();

/**
 * Runs `f` as the only account operation (queued behind any other) with the sync engine stopped and drained, so no sync
 * run can write into (or bring tokens back after) what `f` changes and no sign-in can interleave with an in-flight
 * `DELETE /me`, export or refresh. Not reentrant: `f` must not call another function that uses it.
 */
export async function withSyncPaused<T>(f: () => Promise<T>): Promise<T> {
  return accountLock.run(async () => {
    await pauseSync();
    try {
      return await f();
    } finally {
      resumeSync();
    }
  });
}

/**
 * Deletes the previous user's local store in one transaction under the write lock: every synced table, the outbox and the
 * sync bookkeeping. Other device-only flags in `settings` stay, except that a forced wipe also removes the pending-wipe
 * marker (`device.server_deleted`), since what it stands for is done. Unless `force`, it counts the unsynced changes in the same
 * transaction and wipes nothing when there are any; the count is returned (0 means wiped).
 * The progress-photo vault (files and key) is wiped right after, whenever the store was (ADR 004, #251). A marker written
 * in the same transaction keeps that wipe owed if it fails or the app dies first; `finishPhotoWipe` pays it.
 */
/** Thrown by `wipeLocalStore` when `expectUser` no longer owns the store: someone else signed in meanwhile, nothing was wiped. */
export class OwnerChanged extends Error {}

export async function wipeLocalStore(db: Db, opts: { force?: boolean; expectUser?: string | null } = {}): Promise<number> {
  let pending = 0;
  await inTransaction(db, async (txn) => {
    if (opts.expectUser !== undefined && (await getUserId(txn)) !== opts.expectUser) throw new OwnerChanged();
    pending = (await txn.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox'))?.n ?? 0;
    if (pending > 0 && !opts.force) return;
    for (const local of Object.values(SYNC_TABLES)) await txn.runAsync(`DELETE FROM ${local}`);
    await txn.runAsync('DELETE FROM sync_outbox');
    await txn.runAsync("DELETE FROM settings WHERE key LIKE 'sync.%'");
    if (opts.force) await txn.runAsync('DELETE FROM settings WHERE key = ?', KEY_SERVER_DELETED);
    await txn.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')", KEY_PHOTOS_WIPE);
    pending = 0;
  });
  if (pending === 0) await finishPhotoWipe(db);
  return pending;
}

/**
 * Wipes the photo vault if a store wipe left that owed (its marker is set). Runs after every store wipe and before a
 * sign-in binds a user, so photos never outlive the store they belonged to. Callers hold the account lock; from outside
 * an account operation use `completePhotoWipe`.
 */
async function finishPhotoWipe(db: Db): Promise<void> {
  try {
    if (!(await getKv(db, KEY_PHOTOS_WIPE))) return;
    await wipePhotos();
    await db.runAsync('DELETE FROM settings WHERE key = ?', KEY_PHOTOS_WIPE);
  } catch (e) {
    announceWipe(false);
    throw e;
  }
  // Success is told only once the marker is gone, so a screen that reloads on it finds nothing owed (no wipe loop).
  announceWipe(true);
}

/** `finishPhotoWipe` under the account lock: at launch, and before the photos screen reads the vault. */
export const completePhotoWipe = (db: Db): Promise<void> => withSyncPaused(() => finishPhotoWipe(db));

/** Runs a photo write with no wipe owed and the account lock held throughout, so no wipe can land between the two. */
export const withPhotosSettled = <T>(db: Db, write: () => Promise<T>): Promise<T> =>
  withSyncPaused(async () => {
    await finishPhotoWipe(db);
    return write();
  });

export type SignInOutcome =
  /** Tokens saved; the store belongs to this user. `wiped` when a previous user's empty store was cleared first. */
  | { kind: 'signed_in'; wiped: boolean }
  /** A different user than the store's, with unsynced changes: the new tokens were discarded. */
  | { kind: 'refused'; pending: number };

/**
 * Runs after every token exchange, before any push and before the new tokens are stored.
 * Same user or an unbound store: keep the tokens, then bind. Different user: refuse while changes are queued, otherwise
 * wipe the previous user's store first. Tokens are saved before the user id is bound, so a failed save cannot leave a
 * bound store without a session.
 */
export async function acceptTokenPair(db: Db, tokens: TokenStore, pair: Pick<Schemas['TokenPair'], 'access_token' | 'refresh_token' | 'user'>): Promise<SignInOutcome> {
  return withSyncPaused(async () => {
    await finishPhotoWipe(db); // a wipe that did not finish before is completed before anyone is bound
    const bound = await getUserId(db);
    let wiped = false;
    if (bound && bound !== pair.user.id) {
      const pending = await wipeLocalStore(db);
      if (pending > 0) return { kind: 'refused', pending };
      wiped = true;
    }
    await tokens.save({ access: pair.access_token, refresh: pair.refresh_token });
    await setKv(db, KEY_USER, pair.user.id);
    return { kind: 'signed_in', wiped };
  });
}

/**
 * Signs out. With unsynced changes it refuses unless `discard` is set (the "Discard and sign out" choice, confirmed by the
 * caller with the count); discarding wipes the store. Without changes it only forgets the tokens and keeps the data, bound
 * to the same user. Returns the number of changes that blocked it, or 0 when signed out. The sync engine is stopped first.
 */
export async function signOut(db: Db, tokens: TokenStore, opts: { discard?: boolean } = {}): Promise<number> {
  return withSyncPaused(async () => {
    const pending = await wipeLocalStoreIf(db, opts.discard === true);
    if (pending > 0) return pending;
    await tokens.clear();
    return 0;
  });
}

/** Counts unsynced changes; wipes in the same transaction when `discard`. Returns the count that blocked (0: fine). */
async function wipeLocalStoreIf(db: Db, discard: boolean): Promise<number> {
  if (discard) return wipeLocalStore(db, { force: true });
  let n = 0;
  await inTransaction(db, async (txn) => {
    n = (await txn.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox'))?.n ?? 0;
  });
  return n;
}

/** "Discard and sign out" after a refused account switch: wipes the store (and any session) with the engine stopped. */
export async function discardAll(db: Db, tokens: TokenStore): Promise<void> {
  await withSyncPaused(async () => {
    await wipeLocalStore(db, { force: true });
    await tokens.clear();
  });
}
