import type { ApiClient, Schemas } from '@plate-and-bar/api';
import { inTransaction, type PullDb } from '../db/outbox';
import type { StoreDb } from '../db/records';
import { withTimeout, REQUEST_TIMEOUT_MS } from '../sync/timeout';
import { refreshSession } from '../sync/engine';
import { OwnerChanged, wipeLocalStore, withSyncPaused } from '../sync/guard';
import { KEY_SERVER_DELETED, getKv, getUserId, setKv } from '../sync/store';
import type { Tokens } from '../secure/tokens';
import type { TokenStore } from '../sync/tokens';

type Db = StoreDb & PullDb;

export type Authed<T> =
  /** The server answered; `response.status` may still be a 4xx or 5xx. */
  | { kind: 'response'; response: Response; data: T | undefined; /** The token pair the answered request was sent with. */ used: Tokens | null }
  /** The access token was refused and the refresh did not give a new one: the session is over (tokens cleared). */
  | { kind: 'session_ended' }
  | { kind: 'offline' }
  | { kind: 'unavailable' };

/**
 * Runs an authenticated call; on 401 refreshes the tokens once (the sync engine's own refresh) and retries once.
 * Callers must hold the account lock (`withSyncPaused`): two refreshes at once would reuse a rotated refresh token and
 * revoke the session, and a sign-in must not change the tokens or the owner under the request.
 */
export async function authedCall<T>(d: { db: Db; api: ApiClient; tokens: TokenStore; timeoutMs?: number }, call: (signal: AbortSignal) => Promise<{ data?: T; response: Response }>): Promise<Authed<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: { data?: T; response: Response };
    const used = await d.tokens.load();
    try {
      const t = await withTimeout(d.timeoutMs ?? REQUEST_TIMEOUT_MS, call);
      if (t.timedOut) return { kind: 'unavailable' };
      res = t.value;
    } catch (e) {
      return e instanceof SyntaxError ? { kind: 'unavailable' } : { kind: 'offline' };
    }
    if (res.response.status !== 401 || attempt === 1) return { kind: 'response', response: res.response, data: res.data, used };
    const r = await refreshSession(d);
    if (r === 'ended') return { kind: 'session_ended' };
    if (r !== 'ok') return { kind: r };
  }
  return { kind: 'unavailable' };
}

export type ServerExportResult =
  | { kind: 'ok'; json: string; filename: string }
  | { kind: 'not_signed_in' | 'session_ended' | 'offline' | 'unavailable' }
  | { kind: 'rate_limited'; retryAfterSec: number };

/** `GET /me/export` (limited to 5 an hour). Not stored anywhere by the app; the caller hands the text to the file saver. */
export async function exportFromServer(db: Db, api: ApiClient | null, tokens: TokenStore, timeoutMs?: number): Promise<ServerExportResult> {
  return withSyncPaused(async () => {
    if (!api || !(await tokens.load())) return { kind: 'not_signed_in' };
    const r = await authedCall<Schemas['MeExport']>({ db, api, tokens, timeoutMs }, (signal) => api.GET('/me/export', { signal }));
    if (r.kind === 'response') {
      if (r.data) return { kind: 'ok', json: JSON.stringify(r.data, null, 1), filename: `plate-and-bar-export-${r.data.exported_at.slice(0, 10)}.json` };
      if (r.response.status === 401) return { kind: 'session_ended' };
      if (r.response.status === 429) return { kind: 'rate_limited', retryAfterSec: Number(r.response.headers.get('Retry-After')) || 60 };
      return { kind: 'unavailable' };
    }
    return r;
  });
}

export type DeleteResult =
  /** Everything is gone: the account (`server` true) and this device's store. `server` false: this device only. */
  | { kind: 'deleted'; server: boolean }
  /** Nothing was deleted: no connection, the server failed (5xx), or it refused. Local data is untouched. */
  | { kind: 'offline' | 'unavailable' }
  | { kind: 'rate_limited'; retryAfterSec: number }
  /** The server may or may not have deleted the account: the session ended without a 204. Never reported as deleted. */
  | { kind: 'unconfirmed' }
  /** This device's store could not be read, so nothing was deleted. */
  | { kind: 'error' }
  /** The device is linked to an account but has no session: sign in to delete the account, or delete only this device. */
  | { kind: 'needs_sign_in' }
  /** The server deleted the account, but clearing this device failed; run it again (the server is not called again). */
  | { kind: 'local_failed' }
  /** Another account was signed in on this device meanwhile, so this device was not cleared. `server`: the account itself was deleted first. */
  | { kind: 'owner_changed'; server: boolean };

/**
 * True when the server already deleted this store's account and only the device wipe is left. Kept in the store (a
 * device-only key), so it survives a restart. A marker for another user than the current owner is stale and removed.
 */
export async function wipePending(db: Db): Promise<boolean> {
  const marked = await getKv(db, KEY_SERVER_DELETED);
  if (marked === null) return false;
  if (marked === ((await getUserId(db)) ?? '')) return true;
  await inTransaction(db, (txn) => txn.runAsync('DELETE FROM settings WHERE key = ?', KEY_SERVER_DELETED).then(() => undefined));
  return false;
}

const samePair = (a: Tokens | null, b: Tokens | null) => a !== null && b !== null && a.access === b.access && a.refresh === b.refresh;

/**
 * Clears the tokens only if they are still the deleted account's: the store still has the same owner and the stored pair
 * is the one the request used (null `used`: whatever is stored now, read just before). Defence behind the account lock.
 */
async function clearDeletedAccountTokens(db: Db, tokens: TokenStore, owner: string | null, used: Tokens | null): Promise<void> {
  const now = await tokens.load();
  if (!now || (await getUserId(db)) !== owner || (used && !samePair(used, now))) return;
  await tokens.clear();
}

/**
 * Delete everything (#27), as one account operation (`withSyncPaused`: no sign-in, sign-out or export interleaves).
 * With a session: `DELETE /me` first and the local store only after its 204, so a failure never leaves the user thinking
 * the server copy is gone. After the 204, in this order: the pending-wipe marker is stored (in a transaction that checks
 * the owner), the deleted account's tokens are cleared (only if still its tokens), then the store is wiped (only if still
 * its owner). The marker lets a failed wipe be retried, also after a restart, without calling the server again; that
 * retry clears the same tokens. Without a session on a device linked to an account, nothing is deleted unless
 * `deviceOnly` (the account stays on the server). The outbox is wiped with the store, so nothing is queued or pushed.
 */
export async function deleteEverything(d: { db: Db; api: ApiClient | null; tokens: TokenStore; timeoutMs?: number }, opts: { deviceOnly?: boolean } = {}): Promise<DeleteResult> {
  return withSyncPaused(async () => {
    const { api, tokens, db } = d;
    let userId: string | null = null;
    let server = false;
    try {
      userId = await getUserId(db);
      server = await wipePending(db);
    } catch {
      return { kind: 'error' }; // the store could not be read: nothing was done
    }
    try {
      if (!server && api && (await tokens.load())) {
        const r = await authedCall<never>({ db, api, tokens, timeoutMs: d.timeoutMs }, (signal) => api.DELETE('/me', { signal }));
        if (r.kind === 'session_ended') return { kind: 'unconfirmed' };
        if (r.kind === 'offline' || r.kind === 'unavailable') return { kind: r.kind };
        const s = r.response.status;
        if (s === 401) return { kind: 'unconfirmed' };
        if (s === 429) return { kind: 'rate_limited', retryAfterSec: Number(r.response.headers.get('Retry-After')) || 60 };
        if (s !== 204) return { kind: 'unavailable' };
        server = true;
        await inTransaction(db, async (txn) => {
          if ((await getUserId(txn)) !== userId) throw new OwnerChanged();
          await setKv(txn, KEY_SERVER_DELETED, userId ?? '');
        });
        await clearDeletedAccountTokens(db, tokens, userId, r.used);
      } else if (server) {
        await clearDeletedAccountTokens(db, tokens, userId, null);
      } else if (userId && !opts.deviceOnly) {
        return { kind: 'needs_sign_in' };
      }
    } catch (e) {
      if (e instanceof OwnerChanged) return { kind: 'owner_changed', server };
      return { kind: server ? 'local_failed' : 'unavailable' };
    }
    try {
      // The marker and the tokens are already handled, so nothing is cleared after the wipe: a new sign-in's tokens must stay.
      // TODO(#251): the photo vault is wiped inside wipeLocalStore once it exists.
      await wipeLocalStore(db, { force: true, expectUser: userId });
    } catch (e) {
      return e instanceof OwnerChanged ? { kind: 'owner_changed', server } : { kind: 'local_failed' };
    }
    return { kind: 'deleted', server };
  });
}
