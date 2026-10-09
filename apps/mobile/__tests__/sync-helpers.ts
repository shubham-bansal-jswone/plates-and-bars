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
    online: true,
    /** Next responses to force for /sync: status, optional Retry-After. */
    forceStatus: [] as { status: number; retryAfter?: string }[],
    /** When set, every request waits for it before the server answers (a slow network). */
    hold: null as null | Promise<void>,
    /** Limits `hold` to one path (e.g. '/auth/refresh'). */
    holdPath: null as null | string,
    accessValid: 'access-1',
    refreshes: 0,
    refreshOk: true,
    /** The next /sync answers 400 `invalid_request` with these `details` (the field paths exactly as given; none when undefined). */
    force400: [] as ({ field?: unknown; issue: string }[] | undefined)[],
    /** Answers 400 `invalid_request` naming every pushed record this returns a field for (the request applies nothing). */
    rejectIf: null as null | ((table: string, rec: Rec) => string | null),
    /** Resolution to apply to every version mismatch. */
    conflictResolution: null as null | 'server_won',
    put(table: string, rec: Rec) {
      store.set(`${table}:${rec.id}`, rec);
      (pending[table] ??= []).push(rec);
    },
    get: (table: string, id: string) => store.get(`${table}:${id}`),
    pushed: (): (Rec & { table: string })[] => s.calls.filter((c) => c.path === '/sync').flatMap((c) => Object.entries(c.body.changes ?? {}).flatMap(([t, rs]) => rs.map((r) => ({ table: t, ...r })))),
    userId,
    fetch: async (input: Request | string | URL): Promise<Response> => {
      if (!s.online) throw new TypeError('network down');
      const req = input as Request;
      const path = new URL(req.url).pathname.replace('/api/v1', '');
      const body = (await req.clone().json()) as Call['body'];
      const auth = req.headers.get('Authorization');
      s.calls.push({ path, auth, body });
      const json = (status: number, b: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...headers } });
      if (s.hold && (!s.holdPath || s.holdPath === path)) await s.hold;
      if (path === '/auth/email/verify') {
        s.accessValid = 'access-verified';
        return json(200, { token_type: 'Bearer', access_token: 'access-verified', access_token_expires_at: '2026-10-09T00:00:00Z', refresh_token: 'refresh-verified', refresh_token_expires_at: '2027-01-01T00:00:00Z', user: { id: userId, email: null, created_at: '2026-10-01T00:00:00Z' }, new_user: false });
      }
      if (path === '/auth/refresh') {
        if (!s.refreshOk) return json(401, { code: 'unauthorized', message: 'x' });
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
      const applied: unknown[] = [];
      const conflicts: unknown[] = [];
      for (const [table, recs] of Object.entries(body.changes ?? {})) {
        for (const r of recs) {
          const cur = store.get(`${table}:${r.id}`);
          if (!cur || cur.version === r.version) {
            const next = { ...r, version: (cur?.version ?? 0) + 1 };
            store.set(`${table}:${r.id}`, next);
            applied.push({ table, id: r.id, version: next.version });
          } else {
            conflicts.push({ table, id: r.id, client_version: r.version, server_version: cur.version, resolution: s.conflictResolution ?? 'server_won', server_record: cur });
          }
        }
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
