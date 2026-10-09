import type { ApiClient, Schemas } from '@plate-and-bar/api';
import { applyPulled, clearPushed, inTransaction, pendingChanges, type OutboxEntry, type PullDb, type SyncTableName } from '../db/outbox';
import type { WorkoutDb } from '../db/workouts';
import type { StoreDb } from '../db/records';
import { InvalidRecord, buildRecord, patchMeta, resolveOrphanSets, sameContent, setWorkoutDate, storeRecord, localKey, type Doc, type PullCtx } from './records';
import { withTimeout, REQUEST_TIMEOUT_MS } from './timeout';
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
  /** The server refused the request (400 or another 4xx); retrying the same request will not help. */
  | 'rejected'
  /** No data_storage consent is stored on this device: nothing is pushed or pulled until the user agrees. */
  | 'consent_required'
  /** Sync is paused (a wipe or sign-out is in progress) or the store changed owner under the run. Nothing was written. */
  | 'paused'
  /** A bug or a local failure (storage, mapping): not a network problem. Nothing about the data is attached. */
  | 'error';

export interface SyncResult {
  status: SyncStatus;
  retryAfterSec?: number;
  /** Real conflicts the server resolved this run (idempotent retries are not counted). */
  conflicts: number;
  /** Pulled records stored this run. */
  pulled?: number;
  /** Pulled records skipped because a field was invalid. */
  skipped?: number;
  /** For `error`: the exception's class name only. */
  errorName?: string;
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

type Guard = (db: StoreDb) => Promise<void>;
type Failure = { ok: false; result: SyncResult };
type Outcome<T> = { ok: true; data: T } | Failure;
const fail = (status: SyncStatus, retryAfterSec?: number): Failure => ({ ok: false, result: { status, conflicts: 0, ...(retryAfterSec ? { retryAfterSec } : {}) } });

function failFrom(res: Response): Failure {
  if (res.status === 429) return fail('rate_limited', Math.max(1, Number(res.headers.get('Retry-After')) || DEFAULT_RETRY_SEC));
  return res.status >= 500 ? fail('unavailable') : fail('rejected');
}

/** A rejected fetch: no connection. Only this (not any exception) maps to `offline`. */
class NetworkError extends Error {}

async function net<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    // A body that is not valid JSON came back from a server that answered: that is a fault, not a lost connection.
    if (e instanceof SyntaxError) throw e;
    throw new NetworkError('network');
  }
}

/** POSTs /sync; on 401 refreshes the tokens once and retries. Tokens are never logged. */
async function post(d: SyncDeps, body: Schemas['SyncRequest'], guard: Guard): Promise<Outcome<Schemas['SyncResponse']>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, response } = await net(() => d.api.POST('/sync', { body }));
    if (data) return { ok: true, data };
    if (response.ok) throw new Error('empty or malformed 2xx body'); // answered, but unusable: an error state
    if (response.status !== 401) return failFrom(response);
    if (attempt === 1 || !(await refresh(d, guard))) return fail('signed_out');
  }
  return fail('signed_out');
}

/** Rotates the token pair. False means the session is over (tokens cleared); transient errors keep the tokens. */
async function refresh(d: SyncDeps, guard: Guard, signal?: AbortSignal): Promise<boolean> {
  const t = await d.tokens.load();
  if (!t) return false;
  const { data, response } = await net(() => d.api.POST('/auth/refresh', { body: { refresh_token: t.refresh }, signal }));
  if (data) {
    await guard(d.db); // a wipe or sign-out may have happened while the request was in flight: do not bring the old tokens back
    await d.tokens.save({ access: data.access_token, refresh: data.refresh_token });
    return true;
  }
  if (response.ok) throw new Error('empty or malformed 2xx body');
  if (response.status === 401) {
    await guard(d.db);
    await d.tokens.clear();
  }
  else throw new TransientError(failFrom(response));
  return false;
}

export type RefreshOutcome = 'ok' | 'ended' | 'offline' | 'unavailable';

/**
 * The engine's token refresh for callers outside a sync run (export, delete). The caller must hold the account lock (`withSyncPaused`), which also pauses sync. It also
 * guards the store owner as defence in depth behind that lock: if the owner changed
 * while the request was in flight the answer is dropped and no tokens are saved or cleared: 'ended'. Otherwise 'ended'
 * means the session is over and the tokens are cleared; transient failures keep the tokens.
 */
export async function refreshSession(d: Pick<SyncDeps, 'api' | 'tokens'> & { db: StoreDb; timeoutMs?: number }): Promise<RefreshOutcome> {
  const owner = await getUserId(d.db);
  const guard: Guard = async (db) => {
    if ((await getUserId(db)) !== owner) throw new Aborted();
  };
  try {
    // A stalled request is given up after the timeout, so the account lock is never held for long.
    const r = await withTimeout(d.timeoutMs ?? REQUEST_TIMEOUT_MS, (signal) => refresh(d as SyncDeps, guard, signal));
    if (r.timedOut) return 'unavailable';
    return r.value ? 'ok' : 'ended';
  } catch (e) {
    if (e instanceof Aborted) return 'ended';
    return e instanceof NetworkError ? 'offline' : 'unavailable';
  }
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
async function settle(db: PullDb, e: OutboxEntry, guard: Guard, write: (txn: WorkoutDb, clean: boolean) => Promise<void>): Promise<void> {
  await inTransaction(db, async (txn) => {
    const seqOf = async () => (await txn.getFirstAsync<{ seq: number }>('SELECT seq FROM sync_outbox WHERE tbl = ? AND key = ?', e.tbl, e.key))?.seq ?? null;
    const clean = (await seqOf()) === e.seq;
    await guard(txn);
    await write(txn as WorkoutDb, clean);
    const after = await seqOf();
    if (clean && after !== null) await clearPushed(txn, { tbl: e.tbl, key: e.key, seq: after });
  });
}

let running: Promise<SyncResult> | null = null;
let pauses = 0; // a counter, so overlapping pauses nest: sync resumes only when the last one ends

/** Thrown inside a run when it must stop writing: paused, or the store is bound to a different user now. */
class Aborted extends Error {}

/**
 * Stops new runs and waits for the one in flight to finish. After it resolves nothing from the engine writes to the
 * store or the token storage until `resumeSync()`. Call it before every wipe and before clearing tokens.
 */
export async function pauseSync(): Promise<void> {
  pauses++;
  await running?.catch(() => undefined);
}
export function resumeSync(): void {
  pauses = Math.max(0, pauses - 1);
}

/** True when a data_storage consent record is stored. */
async function hasConsent(db: WorkoutDb): Promise<boolean> {
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM consents');
  return rows.some((r) => {
    const c = JSON.parse(r.data) as { kind?: string; deleted_at?: string | null };
    return c.kind === 'data_storage' && !c.deleted_at;
  });
}

/** One sync run: push everything queued, pull until the server has no more. Serialised: a second call joins the first. */
export function syncOnce(d: SyncDeps): Promise<SyncResult> {
  if (pauses > 0) return Promise.resolve({ status: 'paused', conflicts: 0 });
  running ??= run(d).finally(() => {
    running = null;
  });
  return running;
}

async function run(d: SyncDeps): Promise<SyncResult> {
  const userId = await getUserId(d.db);
  if (!userId || !(await d.tokens.load())) return { status: 'signed_out', conflicts: 0 };
  if (!(await hasConsent(d.db))) return { status: 'consent_required', conflicts: 0 };
  const ctx: PullCtx = { userId, dates: null };
  // Checked inside every write: stop when paused, or when the store belongs to someone else now (a wipe and new sign-in).
  const guard: Guard = async (db) => {
    if (pauses > 0 || (await getUserId(db)) !== userId) throw new Aborted();
  };
  let conflicts = 0;
  let pulled = 0;
  let skipped = 0;
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
      const out = await post(d, { cursor: await getCursor(d.db), changes: changes as Schemas['SyncChanges'] }, guard);
      if (!out.ok) return { ...out.result, conflicts, pulled, skipped };
      const res = out.data;
      for (const a of res.applied) {
        const s = sent.get(`${a.table}:${a.id}`);
        if (s) await settle(d.db, s.entry, guard, (txn) => patchMeta(txn, s.entry.tbl, s.entry.key, { version: a.version }));
      }
      for (const c of res.conflicts) {
        const s = sent.get(`${c.table}:${c.id}`);
        if (!s) continue;
        const server = c.server_record as unknown as Doc;
        let same: boolean;
        try {
          same = sameContent(s.record, server);
        } catch (err) {
          if (err instanceof InvalidRecord) continue; // stays queued; the server's copy cannot be stored
          throw err;
        }
        if (same) {
          // An idempotent retry (see POST /sync): adopt the stored version and time, nothing else changes.
          await settle(d.db, s.entry, guard, (txn) => patchMeta(txn, s.entry.tbl, s.entry.key, { version: server.version as number, updated_at: server.updated_at as string }));
          continue;
        }
        conflicts++;
        await settle(d.db, s.entry, guard, async (txn, clean) => {
          if (clean) await storeRecord(txn, s.entry.tbl, server, s.entry.tbl === 'workout_sets' ? await setWorkoutDate(txn, ctx, server) : null);
          else await patchMeta(txn, s.entry.tbl, s.entry.key, { version: c.server_version });
        });
      }
      const p = await pull(d.db, res.changes as unknown as Record<string, Doc[]>, ctx, guard);
      pulled += p.stored;
      skipped += p.skipped;
      await inTransaction(d.db, async (txn) => {
        await guard(txn);
        await setKv(txn, KEY_CURSOR, res.cursor);
      });
      if (!res.has_more && entries.length < 500) break;
    }
  } catch (e) {
    if (e instanceof TransientError) return { ...e.outcome.result, conflicts, pulled, skipped };
    if (e instanceof Aborted) return { status: 'paused', conflicts, pulled, skipped };
    if (e instanceof NetworkError) return { status: 'offline', conflicts, pulled, skipped };
    // Anything else is a bug or a local failure, not the network: report it as an error state (class name only).
    return { status: 'error', conflicts, pulled, skipped, errorName: e instanceof Error ? e.constructor.name : 'Unknown' };
  }
  return { status: 'ok', conflicts, pulled, skipped };
}

async function pull(db: SyncDb, changes: Record<string, Doc[]>, ctx: PullCtx, guard: Guard): Promise<{ stored: number; skipped: number }> {
  let stored = 0;
  let skipped = 0;
  for (const tbl of ORDER) {
    for (const rec of changes[tbl] ?? []) {
      try {
        const key = localKey(tbl, rec);
        const setDate = tbl === 'workout_sets' ? await setWorkoutDate(db, ctx, rec) : null;
        // A record with an unpushed local edit is skipped inside the transaction: the next push settles it through the server.
        if (await applyPulled(db, tbl, key, async (txn) => {
          await guard(txn);
          await storeRecord(txn, tbl, rec, setDate);
        })) stored++;
        if (tbl === 'workouts') ctx.dates?.set(String(rec.id), key);
      } catch (e) {
        if (!(e instanceof InvalidRecord)) throw e;
        skipped++;
      }
    }
  }
  await guard(db);
  await resolveOrphanSets(db, ctx);
  return { stored, skipped };
}
