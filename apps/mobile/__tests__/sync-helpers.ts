import { MIGRATIONS, migrate, type MigrationDb } from '../src/db/migrations';
import type { StoreDb } from '../src/db/records';
import type { SyncDb } from '../src/sync/engine';
import type { TokenStore } from '../src/sync/tokens';
import type { Tokens } from '../src/secure/tokens';

interface Raw {
  exec(sql: string): void;
  prepare(sql: string): { get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => Raw };

/** A real SQLite (node:sqlite) behind the app's db interfaces, so the outbox triggers run for real. */
export async function openDb(): Promise<SyncDb & MigrationDb & StoreDb & { beforeTxn?: () => Promise<void> }> {
  const raw = new DatabaseSync(':memory:');
  const db = {
    beforeTxn: undefined as undefined | (() => Promise<void>),
    execAsync: async (sql: string) => void raw.exec(sql),
    getFirstAsync: async <T,>(sql: string, ...p: (string | number)[]) => (raw.prepare(sql).get(...p) as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string, ...p: (string | number)[]) => raw.prepare(sql).all(...p) as T[],
    runAsync: async (sql: string, ...p: (string | number)[]) => raw.prepare(sql).run(...p),
    withExclusiveTransactionAsync: async (task: (t: StoreDb) => Promise<void>) => {
      // Hook to run a UI write exactly between a caller's decision and the transaction (these transactions do not isolate).
      await db.beforeTxn?.();
      raw.exec('BEGIN');
      try {
        await task(db);
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  expect(MIGRATIONS.length).toBeGreaterThan(5);
  await migrate(db);
  return db;
}

export function memoryTokens(initial: Tokens | null = null): TokenStore & { current: Tokens | null } {
  const s = {
    current: initial,
    load: async () => s.current,
    save: async (t: Tokens) => void (s.current = t),
    clear: async () => void (s.current = null),
  };
  return s;
}

type Rec = Record<string, unknown> & { id: string; version: number };
export interface Call { path: string; auth: string | null; body: { cursor?: string | null; changes?: Record<string, Rec[]>; refresh_token?: string } }

/** A fake server behind `fetch`: stores records per table, versions them, answers /sync and /auth/refresh. */
export function fakeServer(userId: string) {
  const store = new Map<string, Rec>();
  const pending: Record<string, Rec[]> = {};
  const s = {
    calls: [] as Call[],
    /** Body size in bytes of every request that reached the data checks. */
    sizes: [] as number[],
    online: true,
    /** Next responses to force for /sync: status, optional Retry-After. */
    forceStatus: [] as { status: number; retryAfter?: string }[],
    /** When set, every request waits for it before the server answers (a slow network). */
    hold: null as null | Promise<void>,
    /** Limits `hold` to one path (e.g. '/auth/refresh'). */
    holdPath: null as null | string,
    /** Holds requests (see `holdPath`) until the returned function is called, which lets every request already waiting go on (nulling `hold` would not: a waiting request keeps the promise it captured). */
    block(): () => void {
      let release!: () => void;
      s.hold = new Promise<void>((r) => (release = r));
      return () => {
        release();
        s.hold = null;
      };
    },
    accessValid: 'access-1',
    refreshes: 0,
    refreshOk: true,
    /** When set, /auth/refresh answers this status (a 4xx other than 401 is a refused refresh, not a sign-out). */
    refreshFailStatus: null as number | null,
    /** The next /sync answers 400 `invalid_request` with these `details` (the field paths exactly as given; none when undefined). */
    force400: [] as ({ field?: unknown; issue: string }[] | undefined)[],
    /** Answers 400 `invalid_request` naming every pushed record this returns a field for (the request applies nothing). */
    rejectIf: null as null | ((table: string, rec: Rec) => string | null),
    /** The request size limit in bytes (the contract's 2 MB); a larger body is refused with 400 `too_large` and no record named. */
    maxBytes: 2_097_152,
    /** What an over-limit body is answered with: the contract's 400, or 413 as a proxy in front of the API may. */
    tooLargeStatus: 400 as 400 | 413,
    /** When set, a body over the limit is answered with this text instead of JSON, as a proxy does (an empty string is an empty body). */
    proxyText: null as null | string,
    /** The per-account record cap (contract 0.1.16): a push with a new record that takes the stored count over it gets 413 `account_full`, and nothing is applied. */
    recordCap: null as null | number,
    /** Every /sync request is refused with 413 `account_full`, even a pull-only one (a faulty server or proxy). */
    refuseAll: false,
    /** The 413 `account_full` body leaves out `record_cap` (the contract makes it optional for clients to rely on). */
    bareAccountFull: false,
    /** The next /sync requests are applied and then the answer is lost (the client sees a network error). */
    loseResponses: 0,
    /** Like `loseResponses`, but only for the next requests that carry changes (a pull-only request is answered). */
    losePushResponses: 0,
    /** Resolution to apply to every version mismatch. */
    conflictResolution: null as null | 'server_won',
    /** Settles a version mismatch like the contract: the later `updated_at` wins the whole record (a tie goes to the server). */
    byUpdatedAt: false,
    /** A `client_won` conflict leaves out `replaced_record`, as a server built against contract 0.1.19 does. */
    omitReplaced: false,
    /** Several devices share this server: a stored record comes back as a change to every other request, by cursor (`s<n>`). */
    relay: false,
    /** Every /sync answer says `has_more` (a faulty server or proxy). */
    alwaysMore: false,
    log: [] as { n: number; table: string; rec: Rec }[],
    put(table: string, rec: Rec) {
      store.set(`${table}:${rec.id}`, rec);
      (pending[table] ??= []).push(rec);
    },
    /** Stores a record on the server without sending it as a pulled change (the client only meets it through a conflict). */
    seed(table: string, rec: Rec) {
      store.set(`${table}:${rec.id}`, rec);
    },
    get: (table: string, id: string) => store.get(`${table}:${id}`),
    pushed: (): (Rec & { table: string })[] => s.calls.filter((c) => c.path === '/sync').flatMap((c) => Object.entries(c.body.changes ?? {}).flatMap(([t, rs]) => rs.map((r) => ({ table: t, ...r })))),
    userId,
    fetch: async (input: Request | string | URL): Promise<Response> => {
      if (!s.online) throw new TypeError('network down');
      const req = input as Request;
      const path = new URL(req.url).pathname.replace('/api/v1', '');
      const text = await req.clone().text();
      const body = JSON.parse(text) as Call['body'];
      const bytes = new TextEncoder().encode(text).length;
      const auth = req.headers.get('Authorization');
      s.calls.push({ path, auth, body });
      const json = (status: number, b: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...headers } });
      // The size check runs before anything else (contract wire conventions): before forced statuses, auth and holds.
      if (path === '/sync') s.sizes.push(bytes);
      if (bytes > s.maxBytes && s.proxyText !== null) return new Response(s.proxyText || null, { status: 413, headers: s.proxyText ? { 'Content-Type': 'text/plain' } : {} });
      if (bytes > s.maxBytes) return json(s.tooLargeStatus, s.tooLargeStatus === 413 ? { code: 'too_large', message: 'x' } : { code: 'invalid_request', message: 'The request is too large.', details: [{ field: '', issue: 'too_large' }] });
      if (s.hold && (!s.holdPath || s.holdPath === path)) {
        // A held request ends with an AbortError when its signal fires, like a real fetch.
        const aborted = new Promise<never>((_, reject) => {
          const fire = () => reject(new DOMException('aborted', 'AbortError'));
          if (req.signal.aborted) fire();
          else req.signal.addEventListener('abort', fire, { once: true });
        });
        aborted.catch(() => undefined); // may reject after the hold settled: that must not be an unhandled rejection
        await Promise.race([s.hold, aborted]);
      }
      if (path === '/auth/email/verify') {
        s.accessValid = 'access-verified';
        return json(200, { token_type: 'Bearer', access_token: 'access-verified', access_token_expires_at: '2026-10-09T00:00:00Z', refresh_token: 'refresh-verified', refresh_token_expires_at: '2027-01-01T00:00:00Z', user: { id: userId, email: null, created_at: '2026-10-01T00:00:00Z' }, new_user: false });
      }
      if (path === '/auth/refresh') {
        if (!s.refreshOk) return json(401, { code: 'unauthorized', message: 'x' });
        if (s.refreshFailStatus) return json(s.refreshFailStatus, { code: 'invalid_request', message: 'x' });
        s.refreshes++;
        s.accessValid = `access-${s.refreshes + 1}`;
        return json(200, { token_type: 'Bearer', access_token: s.accessValid, access_token_expires_at: '2026-10-09T00:00:00Z', refresh_token: `refresh-${s.refreshes + 1}`, refresh_token_expires_at: '2027-01-01T00:00:00Z', user: { id: userId, email: null, created_at: '2026-10-01T00:00:00Z' }, new_user: false });
      }
      const forced = s.forceStatus.shift();
      if (forced) return json(forced.status, { code: forced.status === 503 ? 'unavailable' : 'rate_limited', message: 'x' }, forced.retryAfter ? { 'Retry-After': forced.retryAfter } : {});
      if (auth !== `Bearer ${s.accessValid}`) return json(401, { code: 'token_expired', message: 'x' });
      if (s.force400.length) {
        const details = s.force400.shift();
        return json(400, { code: 'invalid_request', message: 'Some fields are invalid.', ...(details ? { details } : {}) });
      }
      if (s.rejectIf) {
        const details = Object.entries(body.changes ?? {}).flatMap(([table, recs]) => recs.flatMap((r, i) => {
          const f = s.rejectIf?.(table, r);
          return f ? [{ field: `changes.${table}[${i}].${f}`, issue: 'is invalid' }] : [];
        }));
        if (details.length) return json(400, { code: 'invalid_request', message: 'Some fields are invalid.', details });
      }
      if (s.refuseAll) return json(413, { code: 'account_full', message: 'x', record_cap: { limit: 1, stored: 1, new_records: 1 } });
      if (s.recordCap !== null) {
        const fresh = Object.entries(body.changes ?? {}).flatMap(([table, recs]) => recs.filter((r) => !store.has(`${table}:${r.id}`)));
        if (fresh.length > 0 && store.size + fresh.length > s.recordCap) return json(413, { code: 'account_full', message: 'Your account is full. New entries stay on this device and are not backed up.', ...(s.bareAccountFull ? {} : { record_cap: { limit: s.recordCap, stored: store.size, new_records: fresh.length } }) });
      }
      const applied: unknown[] = [];
      const conflicts: unknown[] = [];
      for (const [table, recs] of Object.entries(body.changes ?? {})) {
        for (const r of recs) {
          const cur = store.get(`${table}:${r.id}`);
          if (!cur || cur.version === r.version) {
            const next = { ...r, version: (cur?.version ?? 0) + 1 };
            store.set(`${table}:${r.id}`, next);
            s.log.push({ n: s.log.length + 1, table, rec: next });
            applied.push({ table, id: r.id, version: next.version });
          } else if (s.byUpdatedAt && Date.parse(String(r.updated_at)) > Date.parse(String(cur.updated_at))) {
            const next = { ...r, version: cur.version + 1 };
            store.set(`${table}:${r.id}`, next);
            s.log.push({ n: s.log.length + 1, table, rec: next });
            conflicts.push({ table, id: r.id, client_version: r.version, server_version: next.version, resolution: 'client_won', server_record: next, ...(s.omitReplaced ? {} : { replaced_record: cur }) });
          } else {
            conflicts.push({ table, id: r.id, client_version: r.version, server_version: cur.version, resolution: s.conflictResolution ?? 'server_won', server_record: cur });
          }
        }
      }
      if (s.losePushResponses > 0 && Object.keys(body.changes ?? {}).length > 0) {
        s.losePushResponses--;
        throw new TypeError('network down');
      }
      if (s.loseResponses > 0) {
        s.loseResponses--;
        throw new TypeError('network down');
      }
      if (s.relay) {
        const from = Number(String(body.cursor ?? 's0').slice(1));
        const mine = new Set(Object.entries(body.changes ?? {}).flatMap(([t, rs]) => rs.map((r) => `${t}:${r.id}`)));
        const out: Record<string, Rec[]> = {};
        // Like the server: one change per record, its latest state.
        for (const e of s.log) if (e.n > from && !mine.has(`${e.table}:${e.rec.id}`) && s.log.every((l) => l.n <= e.n || l.table !== e.table || l.rec.id !== e.rec.id)) (out[e.table] ??= []).push(e.rec);
        return json(200, { cursor: `s${s.log.length}`, has_more: s.alwaysMore, applied, conflicts, changes: out });
      }
      const changes = { ...pending };
      for (const k of Object.keys(pending)) delete pending[k];
      return json(200, { cursor: `c_${s.calls.length}`, has_more: false, applied, conflicts, changes });
    },
  };
  return s;
}

/** A stored data_storage consent (sync refuses to run without one), already marked as synced. */
export async function seedConsent(db: StoreDb): Promise<void> {
  await db.runAsync("INSERT INTO consents (key, data) VALUES ('c1', ?)", JSON.stringify({ id: 'c1', version: 1, updated_at: '2026-10-01T00:00:00.000Z', deleted_at: null, kind: 'data_storage', given_at: '2026-10-01T00:00:00.000Z', text_version: '1' }));
  await db.runAsync('DELETE FROM sync_outbox');
}

/**
 * Gives transactions their own object, like a device's second connection: a write through `db` while one is open would hang
 * there, so it throws and sets `leaked()`. A write to `table` through the transaction throws "disk full".
 * `restore()` puts the db back.
 */
export function failInTxn(db: Awaited<ReturnType<typeof openDb>>, table: string) {
  const run = db.runAsync;
  const exclusive = db.withExclusiveTransactionAsync;
  let open = false;
  let leaked = false;
  db.runAsync = async (sql: string, ...p: (string | number)[]) => {
    if (open) {
      leaked = true;
      throw new Error('write outside the transaction');
    }
    return run(sql, ...p);
  };
  db.withExclusiveTransactionAsync = (task) => {
    open = true;
    const txn = {
      ...db,
      runAsync: async (sql: string, ...p: (string | number)[]) => {
        if (sql.includes(table)) throw new Error('disk full');
        return run(sql, ...p);
      },
    };
    return exclusive((raw) => task(txn as typeof raw)).finally(() => void (open = false));
  };
  return {
    leaked: () => leaked,
    restore: () => {
      db.runAsync = run;
      db.withExclusiveTransactionAsync = exclusive;
    },
  };
}
