import type { ApiClient, Schemas } from '@plate-and-bar/api';
import { applyPulled, clearPushed, inTransaction, pendingChanges, type OutboxEntry, type PullDb, type SyncTableName } from '../db/outbox';
import type { WorkoutDb } from '../db/workouts';
import type { StoreDb } from '../db/records';
import { InvalidRecord, buildRecord, patchMeta, resolveOrphanSets, sameContent, setWorkoutDate, storeRecord, localKey, type Doc, type PullCtx } from './records';
import { BODY_BUDGET_BYTES, BodySize, MAX_BODY_BYTES, utf8Length } from './batch';
import { quarantine } from './quarantine';
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
  /** Pushed records the server applied this run. */
  pushed?: number;
  /** Pulled records skipped because a field was invalid. */
  skipped?: number;
  /** Records the server refused (400) this run and that were set aside so the rest could sync. */
  quarantined?: number;
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
/** Rounds per run that may be spent setting refused records aside without counting against MAX_ROUNDS (each costs one request). */
const MAX_ASIDE_ROUNDS = 40;
const DEFAULT_RETRY_SEC = 60;
/** Most records queued per request. The byte budget (`sync/batch.ts`) usually cuts a batch shorter. */
const MAX_PUSH = 500;
/** Rounds per run that may be spent on a push cut short by the byte budget, without counting against MAX_ROUNDS. */
const MAX_SPLIT_ROUNDS = 200;
/** Halvings of the batch per run after a `too_large`: enough to go from 500 records to 1 several times over. */
const MAX_HALVINGS = 30;

type Guard = (db: StoreDb) => Promise<void>;
type Failure = { ok: false; result: SyncResult; /** For a 400: the `details[].field` paths the server named. */ fields?: string[]; /** A 400 `too_large`: the body was over the size limit, and no record is named. */ tooLarge?: boolean };
type Outcome<T> = { ok: true; data: T } | Failure;
const fail = (status: SyncStatus, retryAfterSec?: number): Failure => ({ ok: false, result: { status, conflicts: 0, ...(retryAfterSec ? { retryAfterSec } : {}) } });

function failFrom(res: Response, error?: { code?: string; details?: { field?: unknown; issue?: unknown }[] }): Failure {
  if (res.status === 400 && error?.code === 'invalid_request' && Array.isArray(error.details)) {
    const fields = error.details.flatMap((d) => (typeof d?.field === 'string' ? [d.field] : []));
    const tooLarge = error.details.some((d) => (d as { issue?: unknown } | null)?.issue === 'too_large');
    return { ...fail('rejected'), fields, ...(tooLarge ? { tooLarge } : {}) };
  }
  // A proxy in front of the API may refuse a large body with 413 before the server sees it: the same as `too_large`.
  if (res.status === 413) return { ...fail('rejected'), tooLarge: true };
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
async function post(d: SyncDeps, body: Schemas['SyncRequest'], guard: Guard, owner: string): Promise<Outcome<Schemas['SyncResponse']>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error, response } = await net(() => d.api.POST('/sync', { body }));
    if (data) return { ok: true, data };
    if (response.ok) throw new Error('empty or malformed 2xx body'); // answered, but unusable: an error state
    if (response.status !== 401) return failFrom(response, error as Parameters<typeof failFrom>[1]);
    if (attempt === 1 || !(await refresh(d, owner))) return fail('signed_out');
    // The rotated pair is saved even when paused, but a paused run must not go on to push: the user may have chosen to discard.
    await guard(d.db);
  }
  return fail('signed_out');
}

let refreshing: { promise: Promise<boolean>; token: string; owner: string | null } | null = null;

/**
 * Rotates the token pair; single-flight: a call made while one is in flight for the same refresh token and owner joins it
 * (a second request with the same token would be reuse of a rotated token, and the server then revokes the whole
 * session). A joiner waits for the shared answer but gives up on its own `signal`; the leader's `signal` aborts the
 * request for everyone. False means the session is over (tokens cleared); transient errors keep the tokens. The response
 * is applied whenever it arrives, even while sync is paused for an account operation, because dropping a rotated pair
 * leaves only a dead refresh token (#287). The only reason to drop it is that the store belongs to another user now
 * (`owner` is who it belonged to at the start).
 */
async function refresh(d: SyncDeps, owner: string | null, signal?: AbortSignal): Promise<boolean> {
  const t = await d.tokens.load();
  if (!t) return false;
  const inflight = refreshing;
  if (inflight && inflight.token === t.refresh && inflight.owner === owner) return raceAbort(inflight.promise, signal);
  const promise = rotate(d, owner, t, signal);
  if (inflight) return promise; // another token or owner is in flight: do not share, do not replace
  const entry = { promise: promise.finally(() => void (refreshing === entry && (refreshing = null))), token: t.refresh, owner };
  refreshing = entry;
  return entry.promise;
}

/** Rejects when `signal` aborts before `p` settles (the shared request itself keeps going for its leader). */
function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new NetworkError());
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function rotate(d: SyncDeps, owner: string | null, t: { refresh: string }, signal?: AbortSignal): Promise<boolean> {
  const sameOwner = async () => {
    if ((await getUserId(d.db)) !== owner) throw new Aborted(); // a wipe and another sign-in happened meanwhile: do not touch their tokens
  };
  const { data, response } = await net(() => d.api.POST('/auth/refresh', { body: { refresh_token: t.refresh }, signal }));
  if (data) {
    await sameOwner();
    await d.tokens.save({ access: data.access_token, refresh: data.refresh_token });
    return true;
  }
  if (response.ok) throw new Error('empty or malformed 2xx body');
  if (response.status === 401) {
    await sameOwner();
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
  try {
    // A stalled request is given up after the timeout, so the account lock is never held for long.
    const r = await withTimeout(d.timeoutMs ?? REQUEST_TIMEOUT_MS, (signal) => refresh(d as SyncDeps, owner, signal));
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
/**
 * Resolves when no sync run is in flight, without pausing anything. A caller that is about to take the account lock waits
 * here first so the run finishes its request instead of ending 'paused'. Correctness does not depend on it: a rotated
 * pair is saved even while paused and refreshes are single-flight (#287).
 */
export async function syncIdle(): Promise<void> {
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
  let pushed = 0;
  let skipped = 0;
  let quarantined = 0;
  let asideRounds = 0;
  let splitRounds = 0;
  let halvings = 0;
  let cap = MAX_PUSH; // records per request; halved when the server says a request was too large
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const entries = await pendingChanges(d.db, MAX_PUSH);
      const cursor = await getCursor(d.db);
      const size = new BodySize(cursor);
      let consumed = 0; // entries handled this round: in the request, set aside as too big alone, or gone
      let tooBig = 0;
      const sent = new Map<string, { entry: OutboxEntry; record: Doc }>();
      const changes: Record<string, Doc[]> = {};
      const order: Record<string, OutboxEntry[]> = {}; // the entry behind changes[tbl][i], to find what a 400 names
      for (const e of entries) {
        const record = await buildRecord(d.db, userId, e);
        if (!record) {
          await clearPushed(d.db, e);
          consumed++;
          continue;
        }
        const bytes = utf8Length(JSON.stringify(record));
        // The request stops growing at the byte budget or the record cap; the rest goes in the next round.
        if (sent.size > 0 && (sent.size >= cap || size.with(e.tbl, bytes) > BODY_BUDGET_BYTES)) break;
        if (size.with(e.tbl, bytes) > MAX_BODY_BYTES) {
          // The request is empty here, so this record is too big even alone: no request could carry it. Set it aside
          // (it stays on the device and in the outbox).
          if (await quarantine(d.db, e, `changes.${e.tbl}[0]`, guard)) tooBig++;
          consumed++;
          continue;
        }
        size.add(e.tbl, bytes);
        consumed++;
        sent.set(`${e.tbl}:${record.id as string}`, { entry: e, record });
        (changes[e.tbl] ??= []).push(record);
        (order[e.tbl] ??= []).push(e);
      }
      quarantined += tooBig;
      if (sent.size === 0 && tooBig > 0) {
        // Only records that were too big alone were queued: they are set aside, so the next round sees what is behind them.
        if (splitRounds++ < MAX_SPLIT_ROUNDS) round--;
        continue;
      }
      const out = await post(d, { cursor, changes: changes as Schemas['SyncChanges'] }, guard, userId);
      if (!out.ok) {
        if (out.tooLarge && sent.size > 0) {
          // The 400 names no record. Send half as many; one record alone that is still too large is set aside.
          if (sent.size > 1) {
            // Bounded by a counter, not only by `cap` shrinking: a request that never gets smaller must still end the run.
            if (halvings++ >= MAX_HALVINGS) return { ...out.result, conflicts, pulled, pushed, skipped, ...(quarantined ? { quarantined } : {}) };
            cap = Math.max(1, Math.floor(sent.size / 2));
            round--;
            continue;
          }
          const only = [...sent.values()][0]!.entry;
          if (await quarantine(d.db, only, `changes.${only.tbl}[0]`, guard)) {
            quarantined++;
            cap = MAX_PUSH; // the culprit is found: the rest may go in full batches again
            if (asideRounds++ < MAX_ASIDE_ROUNDS) round--;
            continue;
          }
          // The record was edited while the request was in flight: the newer edit is a fresh change, try it.
          if (asideRounds++ < MAX_ASIDE_ROUNDS) round--;
          continue;
        }
        // A 400 names the records at fault (`changes.<table>[<i>]...`): set those aside and send the rest again.
        let aside = 0;
        const seen = new Set<number>(); // several fields can name one record: it is set aside once
        for (const f of out.fields ?? []) {
          const m = /^changes\.([a-z_]+)\[(\d+)\]/.exec(f);
          const bad = m ? order[m[1] as string]?.[Number(m[2])] : undefined;
          if (!bad || seen.has(bad.seq)) continue;
          seen.add(bad.seq);
          if (await quarantine(d.db, bad, f, guard)) aside++;
        }
        if (aside > 0) {
          quarantined += aside;
          if (asideRounds++ < MAX_ASIDE_ROUNDS) round--; // setting records aside is progress, not a round of syncing (bounded)
          continue;
        }
        return { ...out.result, conflicts, pulled, pushed, skipped, ...(quarantined ? { quarantined } : {}) };
      }
      const res = out.data;
      pushed += res.applied.length;
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
      // Done when nothing more is queued: every loaded entry was handled and fewer than a full load came back.
      if (!res.has_more && consumed === entries.length && entries.length < MAX_PUSH) break;
      if (consumed < entries.length && splitRounds++ < MAX_SPLIT_ROUNDS) round--; // cut short by the byte budget: progress, bounded
    }
  } catch (e) {
    if (e instanceof TransientError) return { ...e.outcome.result, conflicts, pulled, pushed, skipped, ...(quarantined ? { quarantined } : {}) };
    if (e instanceof Aborted) return { status: 'paused', conflicts, pulled, skipped };
    if (e instanceof NetworkError) return { status: 'offline', conflicts, pulled, skipped };
    // Anything else is a bug or a local failure, not the network: report it as an error state (class name only).
    return { status: 'error', conflicts, pulled, skipped, errorName: e instanceof Error ? e.constructor.name : 'Unknown' };
  }
  return { status: 'ok', conflicts, pulled, pushed, skipped, ...(quarantined ? { quarantined } : {}) };
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
