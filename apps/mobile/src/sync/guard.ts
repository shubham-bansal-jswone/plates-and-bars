import type { Schemas } from '@plate-and-bar/api';
import { SYNC_TABLES, pendingCount, type PullDb } from '../db/outbox';
import type { StoreDb } from '../db/records';
import { KEY_USER, getUserId, setKv } from './store';
import type { TokenStore } from './tokens';

// Device ownership rules of ADR 004 (#31): the local store belongs to one user; unsynced changes are never pushed under
// another user's token and never dropped without an explicit choice.

type Db = StoreDb & PullDb;

/**
 * Deletes the previous user's local store: every synced table, the outbox and the sync bookkeeping, in one transaction.
 * Device-only flags in `settings` stay.
 * TODO(photo vault): the encrypted progress-photo vault must be wiped here too once it exists.
 */
export async function wipeLocalStore(db: Db): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const local of Object.values(SYNC_TABLES)) await txn.runAsync(`DELETE FROM ${local}`);
    await txn.runAsync('DELETE FROM sync_outbox');
    await txn.runAsync("DELETE FROM settings WHERE key LIKE 'sync.%'");
  });
}

export type SignInOutcome =
  /** Tokens saved; the store belongs to this user. `wiped` when a previous user's empty store was cleared first. */
  | { kind: 'signed_in'; wiped: boolean }
  /** A different user than the store's, with unsynced changes: the new tokens were discarded. */
  | { kind: 'refused'; pending: number };

/**
 * Runs after every token exchange, before any push and before the new tokens are stored.
 * Same user or an unbound store: bind and keep the tokens. Different user: refuse while changes are queued, otherwise
 * wipe the previous user's store first.
 */
export async function acceptTokenPair(db: Db, tokens: TokenStore, pair: Pick<Schemas['TokenPair'], 'access_token' | 'refresh_token' | 'user'>): Promise<SignInOutcome> {
  const bound = await getUserId(db);
  let wiped = false;
  if (bound && bound !== pair.user.id) {
    const pending = await pendingCount(db);
    if (pending > 0) return { kind: 'refused', pending };
    await wipeLocalStore(db);
    wiped = true;
  }
  await setKv(db, KEY_USER, pair.user.id);
  await tokens.save({ access: pair.access_token, refresh: pair.refresh_token });
  return { kind: 'signed_in', wiped };
}

/** What sign-out has to ask: how many unsynced changes would be lost (0: sign out freely). */
export const unsyncedCount = (db: StoreDb): Promise<number> => pendingCount(db);

/**
 * Signs out. With unsynced changes it refuses unless `discard` is set (the "Discard and sign out" choice, confirmed by the
 * caller with the count); discarding wipes the store. Without changes it only forgets the tokens and keeps the data, bound
 * to the same user. Returns the number of changes that blocked it, or 0 when signed out.
 */
export async function signOut(db: Db, tokens: TokenStore, opts: { discard?: boolean } = {}): Promise<number> {
  const pending = await pendingCount(db);
  if (pending > 0 && !opts.discard) return pending;
  if (opts.discard) await wipeLocalStore(db);
  await tokens.clear();
  return 0;
}
