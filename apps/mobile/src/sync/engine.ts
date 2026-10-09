import type { ApiClient, Schemas } from '@plate-and-bar/api';
import { applyPulled, clearPushed, isQueued, pendingChanges, type OutboxEntry, type PullDb, type SyncTableName } from '../db/outbox';
import type { StoreDb } from '../db/records';
import type { WorkoutDb } from '../db/workouts';
import { buildRecord, patchMeta, resolveOrphanSets, sameContent, setWorkoutDate, storeRecord, localKey, type Doc, type PullCtx } from './records';
import { KEY_CURSOR, getCursor, getUserId, setKv } from './store';
import type { TokenStore } from './tokens';

export type SyncDb = WorkoutDb & PullDb;

export type SyncStatus =
  | 'ok'
  /** No account on this device, or the session ended: sign in again. Local data is untouched. */
  | 'signed_out'
  /** No connection. */
  | 'offline'
  /** 503 or a server error: try later; never signs out. */
  | 'unavailable'
  /** 429: wait `retryAfterSec`. */
  | 'rate_limited'
  /** 400: the server refused the request; retrying the same request will not help. */
  | 'rejected';

export interface SyncResult {
  status: SyncStatus;
  retryAfterSec?: number;
  /** Real conflicts the server resolved this run (idempotent retries are not counted). */
  conflicts: number;
}

export interface SyncDeps {
  db: SyncDb;
  api: ApiClient;
  tokens: TokenStore;
}

// Pulled records go in this order so a workout is stored before its sets.
const ORDER: SyncTableName[] = ['workouts', 'workout_sets', 'profiles', 'consents', 'food_logs', 'water_logs', 'day_notes', 'lift_stats', 'weights', 'measurements', 'user_foods', 'recipes', 'kitchen_tests', 'exclusions', 'swaps', 'settings'];
const MAX_ROUNDS = 40;
const DEFAULT_RETRY_SEC = 60;

type Failure = { ok: false; result: SyncResult };
type Outcome<T> = { ok: true; data: T } | Failure;
const fail = (status: SyncStatus, retryAfterSec?: number): Failure => ({ ok: false, result: { status, conflicts: 0, ...(retryAfterSec ? { retryAfterSec } : {}) } });

function failFrom(res: Response): Failure {
  if (res.status === 429) return fail('rate_limited', Math.max(1, Number(res.headers.get('Retry-After')) || DEFAULT_RETRY_SEC));
  if (res.status === 400) return fail('rejected');
  return fail('unavailable');
}

/** POSTs /sync; on 401 refreshes the tokens once and retries. Tokens are never logged. */
async function post(d: SyncDeps, body: Schemas['SyncRequest']): Promise<Outcome<Schemas['SyncResponse']>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, response } = await d.api.POST('/sync', { body });
    if (data) return { ok: true, data };
    if (response.status !== 401) return failFrom(response);
    if (attempt === 1 || !(await refresh(d))) return fail('signed_out');
  }
  return fail('signed_out');
}

/** Rotates the token pair. False means the session is over (tokens cleared); transient errors keep the tokens. */
async function refresh(d: SyncDeps): Promise<boolean> {
  const t = await d.tokens.load();
  if (!t) return false;
  const { data, response } = await d.api.POST('/auth/refresh', { body: { refresh_token: t.refresh } });
  if (data) {
    await d.tokens.save({ access: data.access_token, refresh: data.refresh_token });
    return true;
  }
  if (response.status === 401) await d.tokens.clear();
  else throw new TransientError(failFrom(response));
  return false;
}

class TransientError extends Error {
  constructor(readonly outcome: Failure) {
    super('transient');
  }
}

/**
 * Runs `write` for a pushed entry without queuing it again. `clean` is true when the record was not edited while the
 * request was in flight; if it was edited, the newer edit stays queued and the write must only touch sync fields.
 */
async function settle(db: PullDb, e: OutboxEntry, write: (txn: StoreDb, clean: boolean) => Promise<void>): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    const seqOf = async () => (await txn.getFirstAsync<{ seq: number }>('SELECT seq FROM sync_outbox WHERE tbl = ? AND key = ?', e.tbl, e.key))?.seq ?? null;
    const clean = (await seqOf()) === e.seq;
    await write(txn, clean);
    const after = await seqOf();
    if (clean && after !== null) await clearPushed(txn, { tbl: e.tbl, key: e.key, seq: after });
  });
}

let running: Promise<SyncResult> | null = null;

/** One sync run: push everything queued, pull until the server has no more. Serialised: a second call joins the first. */
export function syncOnce(d: SyncDeps): Promise<SyncResult> {
  running ??= run(d).finally(() => {
    running = null;
  });
  return running;
}

async function run(d: SyncDeps): Promise<SyncResult> {
  const userId = await getUserId(d.db);
  if (!userId || !(await d.tokens.load())) return { status: 'signed_out', conflicts: 0 };
  const ctx: PullCtx = { userId, dates: null };
  let conflicts = 0;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const entries = await pendingChanges(d.db, 500);
      const sent = new Map<string, { entry: OutboxEntry; record: Doc }>();
      const changes: Record<string, Doc[]> = {};
      for (const e of entries) {
        const record = await buildRecord(d.db, userId, e);
        if (!record) {
          await clearPushed(d.db, e);
          continue;
        }
        sent.set(`${e.tbl}:${record.id as string}`, { entry: e, record });
        (changes[e.tbl] ??= []).push(record);
      }
      const out = await post(d, { cursor: await getCursor(d.db), changes: changes as Schemas['SyncChanges'] });
      if (!out.ok) return { ...out.result, conflicts };
      const res = out.data;
      for (const a of res.applied) {
        const s = sent.get(`${a.table}:${a.id}`);
        if (s) await settle(d.db, s.entry, (txn) => patchMeta(txn, s.entry.tbl, s.entry.key, { version: a.version }));
      }
      for (const c of res.conflicts) {
        const s = sent.get(`${c.table}:${c.id}`);
        if (!s) continue;
        const server = c.server_record as unknown as Doc;
        if (sameContent(s.record, server)) {
          // An idempotent retry (see POST /sync): adopt the stored version and time, nothing else changes.
          await settle(d.db, s.entry, (txn) => patchMeta(txn, s.entry.tbl, s.entry.key, { version: server.version as number, updated_at: server.updated_at as string }));
          continue;
        }
        conflicts++;
        await settle(d.db, s.entry, async (txn, clean) => {
          if (clean) await storeRecord(txn, s.entry.tbl, server, s.entry.tbl === 'workout_sets' ? await setWorkoutDate(d.db, ctx, server) : null);
          else await patchMeta(txn, s.entry.tbl, s.entry.key, { version: c.server_version });
        });
      }
      await pull(d.db, res.changes as unknown as Record<string, Doc[]>, ctx);
      await setKv(d.db, KEY_CURSOR, res.cursor);
      if (!res.has_more && entries.length < 500) break;
    }
  } catch (e) {
    if (e instanceof TransientError) return { ...e.outcome.result, conflicts };
    // A thrown fetch is a lost connection; local data and the queue are untouched either way.
    return { status: 'offline', conflicts };
  }
  return { status: 'ok', conflicts };
}

async function pull(db: SyncDb, changes: Record<string, Doc[]>, ctx: PullCtx): Promise<void> {
  for (const tbl of ORDER) {
    for (const rec of changes[tbl] ?? []) {
      const key = localKey(tbl, rec);
      // A record with an unpushed local edit is not overwritten: the next push resolves it through the server.
      if (await isQueued(db, tbl, key)) continue;
      const setDate = tbl === 'workout_sets' ? await setWorkoutDate(db, ctx, rec) : null;
      await applyPulled(db, tbl, key, (txn) => storeRecord(txn, tbl, rec, setDate));
      if (tbl === 'workouts') ctx.dates?.set(String(rec.id), key);
    }
  }
  await resolveOrphanSets(db, ctx);
}

