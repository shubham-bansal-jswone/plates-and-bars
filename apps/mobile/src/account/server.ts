import type { ApiClient, Schemas } from '@plate-and-bar/api';
import { inTransaction, type PullDb } from '../db/outbox';
import type { StoreDb } from '../db/records';
import { refreshSession } from '../sync/engine';
import { OwnerChanged, wipeLocalStore, withSyncPaused } from '../sync/guard';
import { KEY_SERVER_DELETED, getKv, getUserId, setKv } from '../sync/store';
import type { TokenStore } from '../sync/tokens';

type Db = StoreDb & PullDb;

export type Authed<T> =
  /** The server answered; `response.status` may still be a 4xx or 5xx. */
  | { kind: 'response'; response: Response; data: T | undefined }
  /** The access token was refused and the refresh did not give a new one: the session is over (tokens cleared). */
  | { kind: 'session_ended' }
  | { kind: 'offline' }
  | { kind: 'unavailable' };

/**
 * Runs an authenticated call; on 401 refreshes the tokens once (the sync engine's own refresh) and retries once.
 * Callers must hold the sync engine paused: two refreshes at once would reuse a rotated refresh token and revoke the session.
 */
export async function authedCall<T>(d: { db: Db; api: ApiClient; tokens: TokenStore }, call: () => Promise<{ data?: T; response: Response }>): Promise<Authed<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: { data?: T; response: Response };
    try {
      res = await call();
    } catch (e) {
      return e instanceof SyntaxError ? { kind: 'unavailable' } : { kind: 'offline' };
    }
    if (res.response.status !== 401 || attempt === 1) return { kind: 'response', response: res.response, data: res.data };
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
export async function exportFromServer(db: Db, api: ApiClient | null, tokens: TokenStore): Promise<ServerExportResult> {
  if (!api || !(await tokens.load())) return { kind: 'not_signed_in' };
  return withSyncPaused(async () => {
    const r = await authedCall<Schemas['MeExport']>({ db, api, tokens }, () => api.GET('/me/export'));
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
  /** The device is linked to an account but has no session: sign in to delete the account, or delete only this device. */
  | { kind: 'needs_sign_in' }
  /** The server deleted the account, but clearing this device failed; run it again (the server is not called again). */
  | { kind: 'local_failed' }
  /** Another account was signed in on this device meanwhile; nothing on this device was deleted. */
  | { kind: 'owner_changed' };

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

/**
 * Delete everything (#27). With a session: `DELETE /me` first and the local store only after its 204, so a failure never
 * leaves the user thinking the server copy is gone. After the 204 the tokens are cleared before the wipe and the fact is
 * kept in memory, so a failed wipe is retried without calling the server again. Without a session on a device linked to
 * an account, nothing is deleted unless `deviceOnly` (the account stays on the server). Sync is paused throughout and the
 * outbox is wiped with the store, so nothing is queued or pushed.
 */
export async function deleteEverything(d: { db: Db; api: ApiClient | null; tokens: TokenStore }, opts: { deviceOnly?: boolean } = {}): Promise<DeleteResult> {
  return withSyncPaused(async () => {
    const { api, tokens, db } = d;
    const userId = await getUserId(db);
    let server = await wipePending(db);
    if (!server && api && (await tokens.load())) {
      const r = await authedCall<never>({ db, api, tokens }, () => api.DELETE('/me'));
      if (r.kind === 'session_ended') return { kind: 'unconfirmed' };
      if (r.kind === 'offline' || r.kind === 'unavailable') return { kind: r.kind };
      const s = r.response.status;
      if (s === 401) return { kind: 'unconfirmed' };
      if (s === 429) return { kind: 'rate_limited', retryAfterSec: Number(r.response.headers.get('Retry-After')) || 60 };
      if (s !== 204) return { kind: 'unavailable' };
      server = true;
      try {
        await inTransaction(db, (txn) => setKv(txn, KEY_SERVER_DELETED, userId ?? ''));
        await tokens.clear();
      } catch {
        return { kind: 'local_failed' };
      }
    } else if (!server && userId && !opts.deviceOnly) {
      return { kind: 'needs_sign_in' };
    }
    try {
      // wipeLocalStore covers the synced tables, the outbox and the sync keys (the only device flags there are).
      // TODO(#251): the photo vault is wiped inside wipeLocalStore once it exists.
      // No tokens are cleared here: they are gone already on every path that had a session, and a new sign-in's must stay.
      await wipeLocalStore(db, { force: true, expectUser: userId });
    } catch (e) {
      return { kind: e instanceof OwnerChanged ? 'owner_changed' : 'local_failed' };
    }
    return { kind: 'deleted', server };
  });
}
