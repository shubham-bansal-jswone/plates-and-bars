import type { ApiClient, Schemas } from '@plate-and-bar/api';
import type { PullDb } from '../db/outbox';
import type { StoreDb } from '../db/records';
import { wipeLocalStore, withSyncPaused } from '../sync/guard';
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
 * Runs an authenticated call; on 401 refreshes the tokens once and retries once. Callers must hold the sync engine
 * paused: two refreshes at once would reuse a rotated refresh token and revoke the session. Tokens are never logged.
 */
export async function authedCall<T>(api: ApiClient, tokens: TokenStore, call: () => Promise<{ data?: T; response: Response }>): Promise<Authed<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: { data?: T; response: Response };
    try {
      res = await call();
    } catch (e) {
      return e instanceof SyntaxError ? { kind: 'unavailable' } : { kind: 'offline' };
    }
    if (res.response.status !== 401 || attempt === 1) return { kind: 'response', response: res.response, data: res.data };
    const t = await tokens.load();
    if (!t) return { kind: 'session_ended' };
    try {
      const r = await api.POST('/auth/refresh', { body: { refresh_token: t.refresh } });
      if (r.data) {
        await tokens.save({ access: r.data.access_token, refresh: r.data.refresh_token });
        continue;
      }
      if (r.response.status === 401) {
        await tokens.clear();
        return { kind: 'session_ended' };
      }
      return { kind: 'unavailable' };
    } catch (e) {
      return e instanceof SyntaxError ? { kind: 'unavailable' } : { kind: 'offline' };
    }
  }
  return { kind: 'unavailable' };
}

export type ServerExportResult =
  | { kind: 'ok'; json: string; filename: string }
  | { kind: 'not_signed_in' | 'session_ended' | 'offline' | 'unavailable' }
  | { kind: 'rate_limited'; retryAfterSec: number };

/** `GET /me/export` (limited to 5 an hour). Not stored anywhere by the app; the caller hands the text to the file saver. */
export async function exportFromServer(api: ApiClient | null, tokens: TokenStore): Promise<ServerExportResult> {
  if (!api || !(await tokens.load())) return { kind: 'not_signed_in' };
  return withSyncPaused(async () => {
    const r = await authedCall<Schemas['MeExport']>(api, tokens, () => api.GET('/me/export'));
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
  /** Everything is gone: the account (`server` true when there was one) and this device's store. */
  | { kind: 'deleted'; server: boolean }
  /** Nothing was deleted: no connection, the server failed (5xx), or it refused. Local data is untouched. */
  | { kind: 'offline' | 'unavailable' }
  | { kind: 'rate_limited'; retryAfterSec: number }
  /** The server may or may not have deleted the account: the session ended without a 204. Never reported as deleted. */
  | { kind: 'unconfirmed' }
  /** The server deleted the account, but clearing this device failed; run it again (DELETE /me is idempotent). */
  | { kind: 'local_failed' };

/**
 * Delete everything (#27). Signed in: `DELETE /me` first and the local store only after its 204, so a failure never
 * leaves the user thinking the server copy is gone. Signed out: the local store only. Sync is paused throughout and the
 * outbox is wiped with the store, so nothing is queued or pushed.
 */
export async function deleteEverything(d: { db: Db; api: ApiClient | null; tokens: TokenStore }): Promise<DeleteResult> {
  return withSyncPaused(async () => {
    const { api, tokens, db } = d;
    const server = !!api && !!(await tokens.load());
    if (server && api) {
      const r = await authedCall<never>(api, tokens, () => api.DELETE('/me'));
      if (r.kind === 'session_ended') return { kind: 'unconfirmed' };
      if (r.kind === 'offline' || r.kind === 'unavailable') return { kind: r.kind };
      const s = r.response.status;
      if (s === 401) return { kind: 'unconfirmed' };
      if (s === 429) return { kind: 'rate_limited', retryAfterSec: Number(r.response.headers.get('Retry-After')) || 60 };
      if (s !== 204) return { kind: 'unavailable' };
    }
    try {
      // wipeLocalStore covers the synced tables, the outbox and the sync keys (the only device flags there are).
      // TODO(#251): the photo vault is wiped inside wipeLocalStore once it exists.
      await wipeLocalStore(db, { force: true });
      await tokens.clear();
    } catch {
      return { kind: 'local_failed' };
    }
    return { kind: 'deleted', server };
  });
}
