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
export async function openDb(): Promise<SyncDb & MigrationDb & StoreDb> {
  const raw = new DatabaseSync(':memory:');
  const db = {
    execAsync: async (sql: string) => void raw.exec(sql),
    getFirstAsync: async <T,>(sql: string, ...p: (string | number)[]) => (raw.prepare(sql).get(...p) as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string, ...p: (string | number)[]) => raw.prepare(sql).all(...p) as T[],
    runAsync: async (sql: string, ...p: (string | number)[]) => raw.prepare(sql).run(...p),
    withExclusiveTransactionAsync: async (task: (t: StoreDb) => Promise<void>) => {
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
    accessValid: 'access-1',
    refreshes: 0,
    refreshOk: true,
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
      if (path === '/auth/refresh') {
        if (!s.refreshOk) return json(401, { code: 'unauthorized', message: 'x' });
        s.refreshes++;
        s.accessValid = `access-${s.refreshes + 1}`;
        return json(200, { token_type: 'Bearer', access_token: s.accessValid, access_token_expires_at: '2026-10-09T00:00:00Z', refresh_token: `refresh-${s.refreshes + 1}`, refresh_token_expires_at: '2027-01-01T00:00:00Z', user: { id: userId, email: null, created_at: '2026-10-01T00:00:00Z' }, new_user: false });
      }
      const forced = s.forceStatus.shift();
      if (forced) return json(forced.status, { code: forced.status === 503 ? 'unavailable' : 'rate_limited', message: 'x' }, forced.retryAfter ? { 'Retry-After': forced.retryAfter } : {});
      if (auth !== `Bearer ${s.accessValid}`) return json(401, { code: 'token_expired', message: 'x' });
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
