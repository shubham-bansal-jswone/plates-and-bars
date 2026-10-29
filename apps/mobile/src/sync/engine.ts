import type { ApiClient, Schemas } from '@plate-and-bar/api';
import { applyPulled, clearPushed, hasPending, inTransaction, pendingChanges, type OutboxEntry, type PullDb, type SyncTableName } from '../db/outbox';
import { loadWorkout, saveWorkout, type WorkoutDb } from '../db/workouts';
import { mergeWorkout, unionWorkout } from '../workout/model';
import type { Workout } from '../workout/types';
import type { StoreDb } from '../db/records';
import { InvalidRecord, buildRecord, normalizeTimestamps, patchMeta, resolveOrphanSets, sameContent, setWorkoutDate, storeRecord, localKey, type Doc, type PullCtx } from './records';
import { BODY_BUDGET_BYTES, BodySize, MAX_BODY_BYTES, utf8Length } from './batch';
import { quarantine, retryUnsupported } from './quarantine';
import { forgetBase, restoreBases, setBase, takeBases } from './base';
import { clearAccountFull, forgetSent, heldEntries, holdEntries, isAccountFull, markSent, setAccountFull, stampOf, touchHeld, unmarkSent, wasSent } from './held';
import { withTimeout, REFRESH_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from './timeout';
import { KEY_CURSOR, KEY_ROUTINES_PULLED, getCursor, getKv, getUserId, setKv } from './store';
import type { TokenStore } from './tokens';
import { signInUnavailable, takeAttempt, trackCookieCall } from './cookieHealth';
import { authInit, cookieMode, refreshBody } from './transport';
import { markSignOutPending, postRevoke, signOutPending, withTabLock } from './webSession';
import { deleteKitchenPhoto } from '../photos/vault';
import { NATURAL_KEY_TABLES } from './ids';

export type SyncDb = WorkoutDb & PullDb;

export type SyncStatus =
  | 'ok'
  /** No account on this device, or the session ended: sign in again. Local data is untouched. */
  | 'signed_out'
  /** No connection. */
  | 'offline'
  /** 503 or a server error: try later; never signs out. */
  | 'unavailable'
  /** Web only (ADR 006): sign-in and session refresh cannot work from this site (cookie-mode calls fail while the API answers). No automatic retry; a reload tries again. */
  | 'sign_in_unavailable'
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
  /** The server said the account is full (413 `account_full`) and may still say so: new records are held on this device, edits and deletes sync. The run itself went fine. */
  accountFull?: boolean;
  /** For `error`: the exception's class name only. */
  errorName?: string;
  /**
   * The run failed (`offline` or `unavailable`) on the `/auth/refresh` request itself with an ambiguous outcome: no connection, a
   * timeout or a 5xx. The server may have rotated the token meanwhile, and a retry is only safe inside its 60 s grace window, so
   * the caller retries after `REFRESH_RETRY_MS` (20 s) instead of backing off (#762, #809). A definite refusal (a 4xx such as the
   * Origin 403 of ADR 006) is not tagged: nothing was rotated, so it follows the normal schedule.
   */
  viaRefresh?: boolean;
}

export interface SyncDeps {
  db: SyncDb;
  api: ApiClient;
  tokens: TokenStore;
  /** How long one refresh request may take before it is given up (default `REFRESH_TIMEOUT_MS`). Tests only. */
  refreshTimeoutMs?: number;
  /** The clock in ms (tests set it); the held-record retry is once a day by this clock. */
  now?: () => number;
}

// Pulled records go in this order so a workout is stored before its sets.
const ORDER: SyncTableName[] = ['workouts', 'workout_sets', 'profiles', 'consents', 'food_logs', 'water_logs', 'day_notes', 'lift_stats', 'weights', 'measurements', 'user_foods', 'recipes', 'kitchen_tests', 'exclusions', 'swaps', 'settings', 'routines'];
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
/** Held records per request in a retry while the account is full: small, so a batch with a really new record costs few. */
const HELD_BATCH = 20;
/** Requests per retry session (50 x 20 = 1000 records, least recently tried first); the rest wait for the next one. */
const MAX_HELD_BATCHES = 50;
const DAY_MS = 86_400_000;

type Guard = (db: StoreDb) => Promise<void>;
type Failure = { ok: false; result: SyncResult; /** A 400, or a 413 that is not `account_full`: the request was refused whole and nothing in it was stored. */ refused?: true; /** For a 400: the `details[].field` paths the server named. */ fields?: string[]; /** A 400 `too_large`: the body was over the size limit, and no record is named. */ tooLarge?: boolean; /** For a 400: the paths the server refused with `unsupported_table`. */ unsupported?: string[]; /** A 413 whose body is the `account_full` error (a 413 with any other body is a proxy refusing the size). */ accountFull?: { /** `record_cap.new_records`: how many records in the refused request the server does not store; unknown when absent. */ newRecords?: number } };
type Outcome<T> = { ok: true; data: T } | Failure;
const fail = (status: SyncStatus, retryAfterSec?: number): Failure => ({ ok: false, result: { status, conflicts: 0, ...(retryAfterSec ? { retryAfterSec } : {}) } });

type ErrorBody = { code?: string; details?: { field?: unknown; issue?: unknown }[]; record_cap?: { new_records?: unknown } };
function failFrom(res: Response, body?: unknown): Failure {
  // An empty or non-JSON error body (a proxy) comes through as a string or nothing: no code to read.
  const error = body && typeof body === 'object' ? (body as ErrorBody) : undefined;
  if (res.status === 413 && error?.code === 'account_full') {
    const n = error.record_cap?.new_records;
    return { ...fail('rejected'), accountFull: typeof n === 'number' ? { newRecords: n } : {} };
  }
  if (res.status === 400 && error?.code === 'invalid_request' && Array.isArray(error.details)) {
    const fields = error.details.flatMap((d) => (typeof d?.field === 'string' ? [d.field] : []));
    const tooLarge = error.details.some((d) => (d as { issue?: unknown } | null)?.issue === 'too_large');
    const unsupported = error.details.flatMap((d) => ((d as { issue?: unknown } | null)?.issue === 'unsupported_table' && typeof d?.field === 'string' ? [d.field] : []));
    return { ...fail('rejected'), refused: true, fields, ...(tooLarge ? { tooLarge } : {}), ...(unsupported.length ? { unsupported } : {}) };
  }
  // Any other 413: a proxy in front of the API refusing a large body before the server sees it, the same as `too_large`.
  if (res.status === 413) return { ...fail('rejected'), refused: true, tooLarge: true };
  if (res.status === 400) return { ...fail('rejected'), refused: true };
  if (res.status === 429) return fail('rate_limited', Math.max(1, Number(res.headers.get('Retry-After')) || DEFAULT_RETRY_SEC));
  return res.status >= 500 ? fail('unavailable') : fail('rejected');
}

/** A rejected fetch: no connection. Only this (not any exception) maps to `offline`. */
class NetworkError extends Error {
  /** The failed request was the token refresh (a lost response or a timeout): see `SyncResult.viaRefresh`. */
  viaRefresh = false;
}

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
    if (response.status !== 401) return failFrom(response, error);
    if (attempt === 1 || !(await refreshForRun(d, owner))) return fail('signed_out');
    // The rotated pair is saved even when paused, but a paused run must not go on to push: the user may have chosen to discard.
    await guard(d.db);
  }
  return fail('signed_out');
}

/**
 * Refreshes in flight, by owner and refresh token: each (owner, token) pair is presented to the server at most once.
 * Keying by owner as well is safe: an owner change always comes with a new token pair, so a token is never shared
 * between owners and the owner part only keeps a stale caller from joining another user's request.
 */
const refreshing = new Map<string, Promise<boolean>>();
let joins = 0;
/** How many refresh calls have joined one already in flight. Tests wait on it instead of a timer. */
export const refreshJoinCount = () => joins;

/**
 * Rotates the token pair; single-flight per (owner, refresh token): a call made while one is in flight for the same
 * token and owner joins it (a second request with the same token would be reuse of a rotated token, and the server then
 * revokes the whole session). A refresh for a different token or owner is tracked on its own, so callers that share
 * that pair join each other too. A joiner waits for the shared answer but gives up on its own `signal`; the leader's
 * `signal` aborts the request for everyone, and a joiner cut off that way reports a failed request (`unavailable`), not
 * a lost connection. False means the session is over (tokens cleared); transient errors keep the tokens. The response
 * is applied whenever it arrives, even while sync is paused for an account operation, because dropping a rotated pair
 * leaves only a dead refresh token (#287). The only reason to drop it is that the store belongs to another user now
 * (`owner` is who it belonged to at the start).
 */
async function refresh(d: SyncDeps, owner: string | null, signal?: AbortSignal): Promise<boolean> {
  const t = await d.tokens.load();
  // Web: the cookie is the session, so a refresh can run with no access token in memory (cold reload), unless a sign-out is pending.
  if (cookieMode() ? signOutPending() : !t) return false;
  const key = JSON.stringify([owner, t?.refresh ?? '']);
  const inflight = refreshing.get(key);
  if (inflight) {
    joins++;
    return raceAbort(inflight, signal);
  }
  // Web: the pending flag is re-checked under the lock, because another tab may have signed out while this one waited.
  const promise: Promise<boolean> = (cookieMode() ? withTabLock(async () => (signOutPending() ? false : rotate(d, owner, '', signal))) : rotate(d, owner, t?.refresh ?? '', signal)).catch((e: unknown) => Promise.reject(markViaRefresh(e))).finally(() => void (refreshing.get(key) === promise && refreshing.delete(key)));
  refreshing.set(key, promise);
  return promise;
}

/**
 * `refresh` for a sync run. While sign-in is known to be unavailable from this site (#744) it sends nothing: the run ends
 * `sign_in_unavailable` instead of trying a call that cannot work, so no retry loop runs behind the message. One attempt is let
 * through when something asked for it (`allowOneAttempt`).
 */
async function refreshForRun(d: SyncDeps, owner: string | null): Promise<boolean> {
  if (cookieMode() && signInUnavailable() && !takeAttempt()) throw new TransientError(fail('sign_in_unavailable'));
  return refresh(d, owner);
}

/** Tags a failure of the refresh request so the run's result can say so (`SyncResult.viaRefresh`). */
function markViaRefresh(e: unknown): unknown {
  if (e instanceof NetworkError) e.viaRefresh = true;
  else if (e instanceof TransientError && e.outcome.result.status === 'unavailable') e.outcome.result.viaRefresh = true;
  return e;
}

/**
 * A signal that aborts when either of the two does (AbortSignal.any is not in every runtime the app runs on). The listeners it
 * adds to `a` and `b` are not removed: both are short-lived signals of one request (a timer's controller and the caller's
 * timeout), dropped with it, so nothing accumulates.
 */
function either(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  const c = new AbortController();
  const fire = () => c.abort();
  if (a.aborted || b.aborted) c.abort();
  else {
    a.addEventListener('abort', fire, { once: true });
    b.addEventListener('abort', fire, { once: true });
  }
  return c.signal;
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

async function rotate(d: SyncDeps, owner: string | null, refreshToken: string, signal?: AbortSignal): Promise<boolean> {
  const sameOwner = async () => {
    if ((await getUserId(d.db)) !== owner) throw new Aborted(); // a wipe and another sign-in happened meanwhile: do not touch their tokens
  };
  let result;
  try {
    // Its own timeout, started here: inside the cross-tab lock, so the lock is held until this request settles or the timeout
    // fires (never longer), and a refresh made from a sync run is bounded too (#762).
    const timed = await withTimeout(d.refreshTimeoutMs ?? REFRESH_TIMEOUT_MS, (own) => net(() => trackCookieCall(d.api, () => d.api.POST('/auth/refresh', { body: refreshBody(refreshToken), signal: either(signal, own), ...authInit() }))));
    if (timed.timedOut) throw new TransientError(fail('unavailable'));
    result = timed.value;
  } catch (e) {
    // Aborted by the caller that started this request (its timeout): joiners must not read that as "offline".
    if (e instanceof NetworkError && signal?.aborted) throw new TransientError(fail('unavailable'));
    throw e;
  }
  const { data, response } = result;
  if (data) {
    await sameOwner();
    // Web: another tab ended the session while this request was in flight. Its revoke waits for the lock, so the new cookie is
    // cleared right after; this tab must not bring an access token back for it.
    if (cookieMode() && signOutPending()) {
      // The cookie this response set (and the session behind it) must end: clear this tab's tokens and revoke it, as for another account's cookie.
      await d.tokens.clear();
      await postRevoke(d.api); // already under the tab lock
      return false;
    }
    // A cookie that belongs to another account than this store's must not carry this store's records to it (ADR 004).
    if (cookieMode() && owner && data.user.id !== owner) {
      await d.tokens.clear();
      // That cookie has no legitimate session on this browser: end it rather than rotating it on every run.
      markSignOutPending();
      await postRevoke(d.api); // already under the tab lock
      return false;
    }
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
export async function refreshSession(d: Pick<SyncDeps, 'api' | 'tokens' | 'refreshTimeoutMs'> & { db: StoreDb; timeoutMs?: number }): Promise<RefreshOutcome> {
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
 * `after` runs last, only for a clean entry, and its writes stay queued (the merged workout day of #818).
 */
async function settle(db: PullDb, e: OutboxEntry, guard: Guard, write: (txn: WorkoutDb, clean: boolean) => Promise<void>, after?: (txn: WorkoutDb) => Promise<void>): Promise<void> {
  await inTransaction(db, async (txn) => {
    const seqOf = async () => (await txn.getFirstAsync<{ seq: number }>('SELECT seq FROM sync_outbox WHERE tbl = ? AND key = ?', e.tbl, e.key))?.seq ?? null;
    const clean = (await seqOf()) === e.seq;
    await guard(txn);
    await write(txn as WorkoutDb, clean);
    await forgetSent(txn, e);
    if (e.tbl === 'workouts') await forgetBase(txn, e.key);
    const left = await seqOf();
    if (clean && left !== null) await clearPushed(txn, { tbl: e.tbl, key: e.key, seq: left });
    // After the clear, so what it writes stays queued. Same transaction and owner guard as the write above (ADR 004).
    if (clean) await after?.(txn as WorkoutDb);
  });
}

/** Takes the kept bases of the days a request carries out of the store (see `takeBases`), under the owner guard. */
async function holdBases(db: PullDb, dates: string[], guard: Guard): Promise<Map<string, Workout>> {
  if (dates.length === 0) return new Map();
  let taken = new Map<string, Workout>();
  await inTransaction(db, async (txn) => {
    await guard(txn);
    taken = await takeBases(txn, dates);
  });
  return taken;
}

/** The server stored nothing of the request: its bases are good for the next one. */
async function putBackBases(db: PullDb, bases: Map<string, Workout>, guard: Guard): Promise<void> {
  if (bases.size === 0) return;
  await inTransaction(db, async (txn) => {
    await guard(txn);
    await restoreBases(txn, bases);
  });
}

let running: Promise<SyncResult> | null = null;
/** When held records were last retried in this app run, per user: due on launch (nothing yet), then at most once a day. */
let heldTried: { user: string; at: number } | null = null;
/** When records set aside for `unsupported_table` were last retried in this app run, per user: due on launch, then at most once a day. */
let unsupportedTried: { user: string; at: number } | null = null;
/** Makes the next run retry held records, as a fresh app launch does. */
export function forgetHeldRetry(): void {
  heldTried = null;
  unsupportedTried = null;
}
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
export async function hasConsent(db: WorkoutDb): Promise<boolean> {
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
  if (!userId || (!cookieMode() && !(await d.tokens.load()))) return { status: 'signed_out', conflicts: 0 };
  if (!(await hasConsent(d.db))) return { status: 'consent_required', conflicts: 0 };
  const ctx: PullCtx = { userId, dates: null };
  // Checked inside every write: stop when paused, or when the store belongs to someone else now (a wipe and new sign-in).
  const guard: Guard = async (db) => {
    if (pauses > 0 || (await getUserId(db)) !== userId) throw new Aborted();
  };
  const now = d.now ?? Date.now;
  let conflicts = 0;
  let pulled = 0;
  let pushed = 0;
  let skipped = 0;
  let quarantined = 0;
  let asideRounds = 0;
  let splitRounds = 0;
  let halvings = 0;
  let cap = MAX_PUSH; // records per request; halved when the server says a request was too large
  let full = await isAccountFull(d.db); // see sync/held.ts
  let phase: 'main' | 'held' = 'main'; // 'held': retrying held records in small batches, after everything else
  let sessionStamp = '';
  let heldBatches = 0;
  let heldPlan: OutboxEntry[][] = []; // halves of a refused batch that held some records the server already stores, still to send
  let heldDone = false; // the held phase runs at most once per run
  let pushBlocked = false; // a full account refused a request of records it should store: the rest of the run only pulls
  const heldDue = () => full && !heldDone && !pushBlocked && (!heldTried || heldTried.user !== userId || now() - heldTried.at >= DAY_MS);
  // A queued workout day is pulled before it is pushed (see `unionWorkout`): the push settles a stale one whole-record, which would
  // drop what another device stored for the day, and the server does not send the loser's copy back.
  let prePull = false;
  try {
    // ADR 011: an app build that predates the routines table moved its cursor past `routines` changes it ignored. Once, after the upgrade,
    // start the pull from the beginning. (A device with no cursor pulls everything already.) The marker is set in the same transaction.
    if ((await getKv(d.db, KEY_ROUTINES_PULLED)) === null) {
      await inTransaction(d.db, async (txn) => {
        await guard(txn);
        await txn.runAsync('DELETE FROM settings WHERE key = ?', KEY_CURSOR);
        await setKv(txn, KEY_ROUTINES_PULLED, '1');
      });
    }
    // ADR 011: records the server refused as `unsupported_table` are tried again, in case it was upgraded since.
    if (!unsupportedTried || unsupportedTried.user !== userId || now() - unsupportedTried.at >= DAY_MS) {
      await retryUnsupported(d.db, guard);
      unsupportedTried = { user: userId, at: now() };
    }
    prePull = await hasPending(d.db, 'workouts');
    // Web after a reload (or a refresh that could not finish): no access token in memory, so restore it from the cookie first.
    if (cookieMode() && !(await d.tokens.load()) && !(await refreshForRun(d, userId))) return { status: 'signed_out', conflicts: 0 };
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const entries = pushBlocked || prePull ? [] : phase === 'held' ? (heldPlan.shift() ?? (await heldEntries(d.db, HELD_BATCH, sessionStamp))) : await pendingChanges(d.db, MAX_PUSH);
      if (phase === 'held' && entries.length === 0) {
        // Every held record was tried this session: one more main round pulls what is left, then the run ends.
        heldTried = { user: userId, at: now() };
        phase = 'main';
        round--;
        continue;
      }
      const cursor = await getCursor(d.db);
      const size = new BodySize(cursor);
      let consumed = 0; // entries handled this round: in the request, set aside as too big alone, or gone
      let tooBig = 0;
      const hold: OutboxEntry[] = []; // version-0 records held back while the account is full
      const sent = new Map<string, { entry: OutboxEntry; record: Doc }>();
      const changes: Record<string, Doc[]> = {};
      const order: Record<string, OutboxEntry[]> = {}; // the entry behind changes[tbl][i], to find what a 400 names
      for (const e of entries) {
        const record = await buildRecord(d.db, userId, e);
        if (!record) {
          await clearPushed(d.db, e);
          await forgetSent(d.db, e);
          consumed++;
          continue;
        }
        if (full && phase === 'main' && !record.version) {
          // The account is full: a new record would be refused, and refusing the request would hold up the edits with it.
          // A tombstone no request ever carried never left this device and holds no data: it is dropped. Anything else stays held.
          // Not in a natural-key table: another device may have made the same id on the server, and the held push settles it (server_won).
          if (record.deleted_at && !NATURAL_KEY_TABLES.has(e.tbl) && !(await wasSent(d.db, e))) await clearPushed(d.db, e);
          else hold.push(e);
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
      if (hold.length > 0) await holdEntries(d.db, hold, guard);
      if (sent.size === 0 && (tooBig > 0 || hold.length > 0)) {
        // Only records that were too big alone were queued: they are set aside, so the next round sees what is behind them.
        if (splitRounds++ < MAX_SPLIT_ROUNDS) round--;
        continue;
      }
      // A version-0 record in a request may be stored even if the answer is lost: mark it, so a tombstone made of it is retried, not dropped.
      const unsent = [...sent.values()].filter((s) => !s.record.version).map((s) => s.entry);
      const fresh = unsent.length > 0 ? await markSent(d.db, unsent, guard) : [];
      // A base is only good for the first request that carries the day: if this one is stored and its answer lost, the base is stale.
      // It leaves the store for this request and comes back only when the server refused the request whole (#792).
      const bases = await holdBases(d.db, [...sent.values()].filter((s) => s.entry.tbl === 'workouts').map((s) => s.entry.key), guard);
      const out = await post(d, { cursor, changes: changes as Schemas['SyncChanges'] }, guard, userId);
      if (!out.ok && (out.refused || out.accountFull)) await putBackBases(d.db, bases, guard);
      // The server answered a batch with some records it stores and some it does not: the stored ones are behind the new ones. Halve it.
      const refused = out.ok ? undefined : out.accountFull;
      // Only the records actually sent count (the byte budget or a gone record can leave some of the loaded ones out).
      const sentEntries = [...sent.values()].map((s) => s.entry);
      const mixed = phase === 'held' && !!refused && sentEntries.length > 1 && (refused.newRecords ?? sentEntries.length) < sentEntries.length;
      if (phase === 'held' && (out.ok || refused)) {
        heldTried = { user: userId, at: now() };
        // This batch counts as tried, so the session moves on to other records even if these stay queued.
        if (!mixed) await touchHeld(d.db, sentEntries, sessionStamp, guard);
      }
      if (!out.ok) {
        if (out.accountFull) {
          // Refused whole: nothing was stored, so this request's marks are undone. Not a too-large body: the batch is not split.
          await unmarkSent(d.db, fresh, guard);
          // Nothing was sent (a pull-only request) or pushing is already off for this run: the server cannot be refusing records,
          // so this is a fault; end the run instead of asking again.
          if (sent.size === 0 || pushBlocked) return { ...out.result, conflicts, pulled, pushed, skipped, ...(quarantined ? { quarantined } : {}) };
          if (phase === 'held') {
            // Really new records in this batch: they stay held. A mixed batch is halved, so the ones the server stores are found.
            // (A mixed batch is judged and halved by the records sent, in order: the first half then the second.)
            if (mixed) heldPlan.unshift(sentEntries.slice(0, Math.ceil(sentEntries.length / 2)), sentEntries.slice(Math.ceil(sentEntries.length / 2)));
            else if (sentEntries.length > 0 && (refused?.newRecords ?? 0) === sentEntries.length) {
              // None of these is stored: their marks go, and a tombstone that is not in a natural-key table is dropped (it holds no data).
              // A natural-key one stays: another device may hold that id, and its held push settles it (server_won).
              for (const s of sent.values()) {
                if (s.record.version) continue;
                if (s.record.deleted_at && !NATURAL_KEY_TABLES.has(s.entry.tbl)) await clearPushed(d.db, s.entry);
                await forgetSent(d.db, s.entry);
              }
            }
            if (++heldBatches >= MAX_HELD_BATCHES) phase = 'main';
            round--;
            continue;
          }
          if (!full) {
            full = true;
            await setAccountFull(d.db, guard);
            round--; // the same records again, now holding the new ones back
            continue;
          }
          // Full already and still refused: the batch holds a record the server does not store although it has a version. Nothing to
          // split: stop pushing for this run and keep pulling.
          pushBlocked = true;
          round--;
          continue;
        }
        // A 400 (and a proxy's 413) stores nothing: this request's marks are undone, so a version-0 day it carried counts as never seen again (#792).
        if (out.refused) await unmarkSent(d.db, fresh, guard);
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
          if (await quarantine(d.db, bad, f, guard, out.unsupported?.includes(f))) aside++;
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
        // Only a day this request sent for the first time never saw a server copy; one an earlier lost answer may have stored did.
        const neverSeen = !!fresh.some((f) => f.tbl === 'workouts' && f.key === s.entry.key);
        // What the other device stored for the day. On `server_won` that is `server_record`. On `client_won` it is the copy this push
        // replaced, which the server sends back (contract 0.1.20) unless it is an older server; and a retry whose first answer was lost
        // is an idempotent `server_won` with no copy at all (the same content as this push): nothing to merge, the stored copy is adopted.
        const other = c.resolution === 'client_won' ? (c.replaced_record as unknown as Doc | undefined) : same ? undefined : server;
        let merged: Workout | null = null;
        // True when a stored row's content changed on this device (the server copy was adopted, or another device's edits were merged in).
        // Counted toward `pulled` so screens reload (`dataVersion`), like a pulled row.
        let changed = false;
        // Another device's day against this device's: keep what this one added (see `mergedWorkout`); written after the clear, so it is pushed again.
        const merge = async (txn: WorkoutDb, clean: boolean) => {
          if (clean && other && s.entry.tbl === 'workouts') merged = await mergedWorkout(txn, s.entry.key, other, server, c.server_version, neverSeen, bases.get(s.entry.key));
          if (merged) changed = true;
        };
        const requeue = async (txn: WorkoutDb) => {
          if (!merged) return;
          await saveWorkout(txn, merged);
          // Only on `server_won` is the stored copy the other device's day, so the merged day differs from it by this device's own edits alone:
          // it is the base for a second race (it is taken when the day is next sent). On `client_won` the stored copy is this device's own push and
          // the merged day differs from it by the other device's older `replaced_record`; as a base that would read the older copy as this device's
          // edit and overwrite the other device's later one. So no base is kept there: a second race falls back to whole-record.
          if (c.resolution === 'server_won') await setBase(txn, s.entry.key, normalizeTimestamps(server) as Workout);
        };
        if (same) {
          // The server's copy is this push as stored (an idempotent retry, or `client_won`): adopt the stored version and time, nothing else changes.
          await settle(
            d.db,
            s.entry,
            guard,
            async (txn, clean) => {
              await merge(txn, clean);
              await patchMeta(txn, s.entry.tbl, s.entry.key, { version: server.version as number, updated_at: server.updated_at as string });
            },
            requeue,
          );
          if (changed) pulled++;
          continue;
        }
        conflicts++;
        let adopted = false;
        await settle(
          d.db,
          s.entry,
          guard,
          async (txn, clean) => {
            if (clean) {
              await merge(txn, clean);
              await storeRecord(txn, s.entry.tbl, server, s.entry.tbl === 'workout_sets' ? await setWorkoutDate(txn, ctx, server) : null);
              adopted = true;
            } else await patchMeta(txn, s.entry.tbl, s.entry.key, { version: c.server_version });
          },
          requeue,
        );
        if (adopted) pulled++;
        // The server's copy of a kitchen test is a tombstone and now stands here: its vault photo goes too.
        if (adopted && s.entry.tbl === 'kitchen_tests' && server.deleted_at) await deleteKitchenPhoto(s.entry.key).catch(() => undefined);
      }
      // A new record was stored: there is room again. Held records are pending again and go out with the next rounds.
      if (full && [...sent.values()].some((s) => !s.record.version && res.applied.some((a) => a.table === s.entry.tbl && a.id === s.record.id))) {
        await clearAccountFull(d.db, guard);
        full = false;
      }
      const p = await pull(d.db, res.changes as unknown as Record<string, Doc[]>, ctx, guard);
      pulled += p.stored;
      skipped += p.skipped;
      await inTransaction(d.db, async (txn) => {
        await guard(txn);
        await setKv(txn, KEY_CURSOR, res.cursor);
      });
      if (prePull) {
        // Pulled what the server holds for the queued days; now the main rounds push them.
        // Only the last page gives its round back, so a server that always says has_more cannot keep the run going.
        if (!res.has_more) {
          prePull = false;
          round--;
        }
        continue;
      }
      if (phase === 'held') {
        // The next batch of held records; at the cap or when the account has room again, back to the main rounds.
        if (!full || ++heldBatches >= MAX_HELD_BATCHES) phase = 'main';
        round--;
        continue;
      }
      // Done when nothing more is queued: every loaded entry was handled and fewer than a full load came back.
      if (!res.has_more && consumed === entries.length && entries.length < MAX_PUSH) {
        if (heldDue()) {
          // Everything else is pushed and pulled: now the held records, once per launch and then once a day.
          phase = 'held';
          heldDone = true;
          sessionStamp = stampOf(now());
          heldBatches = 0;
          heldPlan = [];
          round--;
          continue;
        }
        break;
      }
      if (consumed < entries.length && splitRounds++ < MAX_SPLIT_ROUNDS) round--; // cut short by the byte budget: progress, bounded
    }
  } catch (e) {
    if (e instanceof TransientError) return { ...e.outcome.result, conflicts, pulled, pushed, skipped, ...(quarantined ? { quarantined } : {}) };
    if (e instanceof Aborted) return { status: 'paused', conflicts, pulled, skipped };
    if (e instanceof NetworkError) return { status: 'offline', conflicts, pulled, skipped, ...(e.viaRefresh ? { viaRefresh: true } : {}) };
    // Anything else is a bug or a local failure, not the network: report it as an error state (class name only).
    return { status: 'error', conflicts, pulled, skipped, errorName: e instanceof Error ? e.constructor.name : 'Unknown' };
  }
  return { status: 'ok', conflicts, pulled, pushed, skipped, ...(quarantined ? { quarantined } : {}), ...(full ? { accountFull: true } : {}) };
}

async function pull(db: SyncDb, changes: Record<string, Doc[]>, ctx: PullCtx, guard: Guard): Promise<{ stored: number; skipped: number }> {
  let stored = 0;
  let skipped = 0;
  for (const tbl of ORDER) {
    for (const rec of changes[tbl] ?? []) {
      try {
        const key = localKey(tbl, rec);
        const setDate = tbl === 'workout_sets' ? await setWorkoutDate(db, ctx, rec) : null;
        if (tbl === 'workouts' && (await unionPulled(db, key, rec, guard))) {
          stored++;
          ctx.dates?.set(String(rec.id), key);
          continue;
        }
        // A record with an unpushed local edit is skipped inside the transaction: the next push settles it through the server.
        if (await applyPulled(db, tbl, key, async (txn) => {
          await guard(txn);
          await storeRecord(txn, tbl, rec, setDate);
        })) {
          stored++;
          // A kitchen test deleted on another device: its serving photo (vault only) goes too, whatever the flag said here.
          // This runs after the record transaction commits: a local photo save on the same test in that gap would be deleted too (rare, and the vault lock keeps the file consistent).
          if (tbl === 'kitchen_tests' && rec.deleted_at) await deleteKitchenPhoto(key).catch(() => undefined);
        }
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

/**
 * This device's workout row for `date` merged with `other`, the same day as another device stored it, or null when there is
 * nothing to keep. The result carries `version` (the server's version of the day, so pushing it is an ordinary edit) and is
 * null when it adds nothing to `server`, the copy about to be stored. Only where no removal can come back:
 *  - the row never saw a server copy (`neverSeen`: version 0, and no earlier request carried it): `unionWorkout`;
 *  - the copy the row grew from is known (`base`, kept by the pre-pull and taken for this request, and the version it holds): a three-way `mergeWorkout`.
 * Otherwise both sides had a common base this merge does not have, and a removal would come back. A tombstone on either
 * side is never merged: a deletion is not resurrected.
 */
async function mergedWorkout(db: StoreDb, date: string, other: Doc, server: Doc, version: number, neverSeen: boolean, base: Workout | undefined): Promise<Workout | null> {
  const mine = await loadWorkout(db, date);
  const theirs = normalizeTimestamps(other) as Workout;
  if (!mine || mine.deleted_at || theirs.deleted_at) return null;
  let out: Workout;
  if (mine.version === 0) {
    if (!neverSeen) return null;
    out = unionWorkout(mine, theirs);
  } else {
    if (!base || base.deleted_at || base.version !== mine.version) return null;
    out = mergeWorkout(base, mine, theirs);
  }
  out = { ...out, version };
  return sameContent(out as unknown as Doc, server) ? null : out;
}

/**
 * A pulled workout row against an unpushed local one: the two are merged (see `unionWorkout`) and the result stays queued
 * at the pulled version, instead of the pull skipping it and the push conflicting. False when there is no such pair.
 */
async function unionPulled(db: SyncDb, date: string, rec: Doc, guard: Guard): Promise<boolean> {
  let done = false;
  await inTransaction(db, async (txn) => {
    if (!(await hasPending(txn, 'workouts', date))) return; // not queued, or set aside: left to the usual path
    await guard(txn);
    const mine = await loadWorkout(txn, date);
    const theirs = normalizeTimestamps(rec) as Workout;
    // Only a day that never saw a server copy: otherwise both sides had a common base this merge does not have, and a removal would come back.
    if (!mine || mine.version !== 0 || (await wasSent(txn, { tbl: 'workouts', key: date })) || mine.deleted_at || theirs.deleted_at) return;
    await saveWorkout(txn, unionWorkout(mine, theirs));
    await setBase(txn, date, theirs); // the copy this row grew from, for a merge if another device stores a later edit before the push (#818)
    done = true;
  });
  return done;
}
