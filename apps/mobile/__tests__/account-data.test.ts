/** @jest-environment node */
import { buildLocalExport, foodCsv } from '../src/account/exportLocal';
import { deleteEverything, exportFromServer } from '../src/account/server';
import { SYNC_TABLES } from '../src/db/outbox';
import { makeApi } from '../src/sync/auth';
import { KEY_USER, getUserId, setKv } from '../src/sync/store';
import { fakeServer, memoryTokens, openDb } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const BASE = 'http://fake/api/v1';
const meta = { version: 1, updated_at: '2026-10-08T06:00:00.000Z', deleted_at: null };
type Db = Awaited<ReturnType<typeof openDb>>;
type Fetch = (r: Request) => Promise<Response>;
/** The client keeps the fetch that exists when it is created, so a stable one is installed first and its target swapped. */
const net: { fetch: Fetch } = { fetch: async () => { throw new TypeError('no server'); } };
(globalThis as { fetch: unknown }).fetch = (r: Request) => net.fetch(r);

const put = (db: Db, table: string, key: string, doc: object, extra: (string | number)[] = []) => {
  const cols: Record<string, string> = {
    workout_sets: '(key, workout_date, kind, done, deleted, data) VALUES (?, ?, ?, ?, ?, ?)',
    food_logs: '(key, log_date, data) VALUES (?, ?, ?)',
    water_logs: '(key, log_date, data) VALUES (?, ?, ?)',
  };
  const sql = `INSERT INTO ${table} ${cols[table] ?? '(key, data) VALUES (?, ?)'}`;
  const args = table === 'workout_sets' ? [key, ...extra, JSON.stringify(doc)] : extra.length ? [key, ...extra, JSON.stringify(doc)] : [key, JSON.stringify(doc)];
  return db.runAsync(sql, ...args);
};

/** One row in each of the 16 synced tables; one of them is a tombstone. */
async function seedAll(db: Db) {
  await put(db, 'profiles', 'me', { ...meta, id: null, weight_kg: 80 });
  await put(db, 'consents', 'c1', { ...meta, id: 'c1', kind: 'data_storage', given_at: meta.updated_at, text_version: '1' });
  await put(db, 'food_logs', 'f1', { ...meta, id: 'f1', date: '2026-10-08', meal: 'Lunch', name: 'Dal, "thick"', qty: 2, kcal: 150, protein_g: 8.2, carbs_g: 20, fat_g: 3, food_id: null }, ['2026-10-08']);
  await put(db, 'food_logs', 'f2', { ...meta, id: 'f2', date: '2026-10-09', meal: 'Snacks', name: '=HYPERLINK("x")', qty: 1, kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1, food_id: null }, ['2026-10-09']);
  await put(db, 'food_logs', 'f3', { ...meta, id: 'f3', deleted_at: '2026-10-09T01:00:00.000Z', date: '2026-10-09', meal: 'Snacks', name: 'gone', qty: 1, kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1, food_id: null }, ['2026-10-09']);
  await put(db, 'water_logs', 'w1', { ...meta, id: 'w1', date: '2026-10-08', ml: 250 }, ['2026-10-08']);
  await put(db, 'day_notes', '2026-10-08', { ...meta, id: null, date: '2026-10-08', text: 'x' });
  await put(db, 'workouts', '2026-10-08', { ...meta, id: null, date: '2026-10-08' });
  await put(db, 'workout_sets', 's1', { ...meta, id: 's1', workout_id: null, kind: 'work' }, ['2026-10-08', 'work', 1, 0]);
  await put(db, 'lift_stats', 'Squat', { deleted_at: '2026-10-09T02:00:00.000Z' });
  await put(db, 'weights', '2026-10-08', { ...meta, id: null, date: '2026-10-08', weight_kg: 80 });
  await put(db, 'measurements', '2026-10-08', { ...meta, id: null, date: '2026-10-08' });
  await put(db, 'user_foods', 'u1', { ...meta, id: 'u1', name: 'mine' });
  await put(db, 'recipes', 'r1', { ...meta, id: 'r1', name: 'r' });
  await put(db, 'kitchen_tests', 'k1', { ...meta, id: 'k1' });
  await put(db, 'exclusions', 'e1', { ...meta, id: 'e1' });
  await put(db, 'swaps', 'Squat', { ...meta, id: null, from: 'Squat' });
  await put(db, 'user_settings', 'me', { ...meta, id: null });
}

describe('export from the local store (#27)', () => {
  it('has every contract sync table, tombstones included, with contract ids, and works with no account', async () => {
    const db = await openDb();
    await seedAll(db);
    const { file } = await buildLocalExport(db, new Date('2026-10-09T08:00:00Z'));
    expect(Object.keys(file.tables).sort()).toEqual(Object.keys(SYNC_TABLES).sort());
    for (const rows of Object.values(file.tables)) expect(rows.length).toBeGreaterThan(0);
    expect(file.tables.food_logs).toHaveLength(3);
    expect(file.tables.lift_stats[0]).toMatchObject({ deleted_at: '2026-10-09T02:00:00.000Z', updated_at: '2026-10-09T02:00:00.000Z' });
    expect(file.tables.weights[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(file.note).toMatch(/ids were made on this device/);
    expect(file).toMatchObject({ format_version: 1, source: 'device', user_id: null, exported_at: '2026-10-09T08:00:00.000Z' });
  });

  it('uses the bound account\'s ids, matching what sync sends (weights:2026-10-08 for the example user)', async () => {
    const db = await openDb();
    await setKv(db, KEY_USER, USER);
    await seedAll(db);
    const { file } = await buildLocalExport(db);
    expect(file.user_id).toBe(USER);
    expect(file.note).toBeUndefined();
    expect(file.tables.weights[0]?.id).toBe('640dee2b-d92d-5a00-bd03-568962bf90ea');
  });

  it('writes the food-log CSV like the prototype: quantity applied, quotes escaped, formulas neutralised, deleted rows left out', async () => {
    const db = await openDb();
    await seedAll(db);
    const { csv } = await buildLocalExport(db);
    expect(csv.split('\n')).toEqual([
      'date,meal,food,servings,kcal,protein_g,carbs_g,fat_g',
      '2026-10-08,Lunch,"Dal, ""thick""",2,300,16.4,40,6',
      '2026-10-09,Snacks,"\'=HYPERLINK(""x"")",1,100,1,1,1',
    ]);
    expect(foodCsv([])).toBe('date,meal,food,servings,kcal,protein_g,carbs_g,fat_g');
  });
});

describe('food CSV', () => {
  const row = (name: string, meal = 'Lunch', date = '2026-10-08') => ({ date, meal, name, qty: 1, kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1 });
  it('neutralises every formula starter: = + - @ tab and carriage return', () => {
    const lines = foodCsv(['=a', '+a', '-a', '@a', '\ta', '\ra', 'ok'].map((n) => row(n))).split('\n');
    expect(lines.slice(1).map((l) => l.split(',')[2])).toEqual(['"\'=a"', '"\'+a"', '"\'-a"', '"\'@a"', '"\'\ta"', '"\'\ra"', '"ok"']);
  });
  it('orders a day breakfast, lunch, snacks, dinner like the prototype, days ascending', () => {
    const meals = foodCsv([row('d', 'Dinner'), row('s', 'Snacks'), row('n', 'Lunch', '2026-10-07'), row('b', 'Breakfast'), row('l')]).split('\n').slice(1).map((l) => l.split(',').slice(0, 2).join(' '));
    expect(meals).toEqual(['2026-10-07 Lunch', '2026-10-08 Breakfast', '2026-10-08 Lunch', '2026-10-08 Snacks', '2026-10-08 Dinner']);
  });
});

describe('export from the server', () => {
  const setup = () => {
    const server = fakeServer(USER);
    net.fetch = server.fetch;
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    return { server, tokens, api: makeApi(BASE, tokens) };
  };
  const route = (server: ReturnType<typeof fakeServer>, handler: (req: Request) => Response | Promise<Response>) => {
    const inner = server.fetch;
    net.fetch = async (input: Request) => {
      const path = new URL(input.url).pathname.replace('/api/v1', '');
      return path === '/me/export' || path === '/me' ? handler(input) : inner(input);
    };
  };
  const ok = new Response(JSON.stringify({ format_version: 1, exported_at: '2026-10-09T08:00:00Z', user: { id: USER, email: null, created_at: '2026-10-01T00:00:00Z' }, tables: {}, conflict_log: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it('downloads, named by the export date', async () => {
    const { server, tokens, api } = setup();
    route(server, () => ok.clone());
    expect(await exportFromServer(await openDb(), api, tokens)).toMatchObject({ kind: 'ok', filename: 'plate-and-bar-export-2026-10-09.json' });
  });

  it('says not signed in without tokens, offline when the network is down, and rate limited with the wait', async () => {
    const { server, tokens, api } = setup();
    expect(await exportFromServer(await openDb(), api, memoryTokens())).toEqual({ kind: 'not_signed_in' });
    expect(await exportFromServer(await openDb(), null, tokens)).toEqual({ kind: 'not_signed_in' });
    server.online = false;
    expect(await exportFromServer(await openDb(), api, tokens)).toEqual({ kind: 'offline' });
    route(server, () => new Response('{"code":"rate_limited","message":"x"}', { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '1800' } }));
    server.online = true;
    expect(await exportFromServer(await openDb(), api, tokens)).toEqual({ kind: 'rate_limited', retryAfterSec: 1800 });
  });
});

describe('delete everything (#27)', () => {
  const noContent = () => new Response(null, { status: 204 });
  const err = (status: number, headers: Record<string, string> = {}) => new Response(JSON.stringify({ code: 'x', message: 'x' }), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  async function signedIn() {
    const db = await openDb();
    const server = fakeServer(USER);
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    await setKv(db, KEY_USER, USER);
    await seedAll(db);
    await db.runAsync("INSERT OR REPLACE INTO weights (key, data) VALUES ('2026-10-10', ?)", JSON.stringify({ ...meta, id: null, date: '2026-10-10', weight_kg: 81 })); // queued
    const calls: string[] = [];
    const handler = { current: noContent as (req: Request) => Response };
    const inner = server.fetch;
    net.fetch = async (input: Request) => {
      const path = new URL(input.url).pathname.replace('/api/v1', '');
      calls.push(`${input.method} ${path}`);
      return path === '/me' ? handler.current(input) : inner(input);
    };
    return { db, server, tokens, api: makeApi(BASE, tokens), calls, handler };
  }
  const count = async (db: Db) => (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM weights'))?.n;
  const outbox = async (db: Db) => (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox'))?.n;

  it('signed in, 204: the server is called first, then every table, the outbox, sync keys and tokens are cleared', async () => {
    const { db, tokens, api, calls } = await signedIn();
    expect(await deleteEverything({ db, api, tokens })).toEqual({ kind: 'deleted', server: true });
    expect(calls).toEqual(['DELETE /me']);
    for (const local of Object.values(SYNC_TABLES)) expect((await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${local}`))?.n).toBe(0);
    expect(await outbox(db)).toBe(0);
    expect(await getUserId(db)).toBeNull();
    expect(tokens.current).toBeNull();
  });

  it('server unavailable (503): nothing local is touched and it says so; same for 500 and 429 (with the wait)', async () => {
    const { db, tokens, api, handler } = await signedIn();
    const queued = await outbox(db);
    handler.current = () => err(503);
    expect(await deleteEverything({ db, api, tokens })).toEqual({ kind: 'unavailable' });
    handler.current = () => err(500);
    expect(await deleteEverything({ db, api, tokens })).toEqual({ kind: 'unavailable' });
    handler.current = () => err(429, { 'Retry-After': '120' });
    expect(await deleteEverything({ db, api, tokens })).toEqual({ kind: 'rate_limited', retryAfterSec: 120 });
    expect(await count(db)).toBe(2);
    expect(await outbox(db)).toBe(queued);
    expect(await getUserId(db)).toBe(USER);
    expect(tokens.current).not.toBeNull();
  });

  it('offline: nothing is deleted and nothing is queued', async () => {
    const { db, tokens, api } = await signedIn();
    net.fetch = async () => { throw new TypeError('network down'); };
    const queued = await outbox(db);
    expect(await deleteEverything({ db, api, tokens })).toEqual({ kind: 'offline' });
    expect(await count(db)).toBe(2);
    expect(await outbox(db)).toBe(queued);
  });

  it('401 then a refresh: retries with the new token and deletes on 204', async () => {
    const { db, tokens, api, handler, calls } = await signedIn();
    let first = true;
    handler.current = () => (first ? ((first = false), err(401)) : noContent());
    expect(await deleteEverything({ db, api, tokens })).toEqual({ kind: 'deleted', server: true });
    expect(calls).toEqual(['DELETE /me', 'POST /auth/refresh', 'DELETE /me']);
  });

  it('401 and the refresh fails with 401: not reported as deleted, the local store is kept, the user is asked to sign in', async () => {
    const { db, server, tokens, api, handler } = await signedIn();
    handler.current = () => err(401);
    server.refreshOk = false;
    expect(await deleteEverything({ db, api, tokens })).toEqual({ kind: 'unconfirmed' });
    expect(await count(db)).toBe(2);
    expect(await getUserId(db)).toBe(USER);
  });

  it('401 and the refresh hits a server error: nothing deleted, tokens kept for a retry', async () => {
    const { db, tokens, api, handler } = await signedIn();
    handler.current = () => err(401);
    const inner = net.fetch;
    net.fetch = async (input: Request) => (new URL(input.url).pathname.endsWith('/auth/refresh') ? err(503) : inner(input));
    expect(await deleteEverything({ db, api, tokens })).toEqual({ kind: 'unavailable' });
    expect(tokens.current).not.toBeNull();
    expect(await count(db)).toBe(2);
  });

  it('a failing wipe after the 204 clears the tokens, and the retry wipes without calling DELETE /me again', async () => {
    const { db, tokens, api, calls } = await signedIn();
    await db.execAsync('ALTER TABLE food_logs RENAME TO food_logs_x');
    expect(await deleteEverything({ db, api, tokens })).toEqual({ kind: 'local_failed' });
    expect(tokens.current).toBeNull();
    await db.execAsync('ALTER TABLE food_logs_x RENAME TO food_logs');
    expect(await deleteEverything({ db, api, tokens })).toEqual({ kind: 'deleted', server: true });
    expect(calls).toEqual(['DELETE /me']);
    expect(await count(db)).toBe(0);
  });

  it('linked to an account but no tokens: nothing is deleted until the user picks to delete only this device', async () => {
    const { db, api, calls } = await signedIn();
    const tokens = memoryTokens();
    expect(await deleteEverything({ db, api, tokens })).toEqual({ kind: 'needs_sign_in' });
    expect(await count(db)).toBe(2);
    expect(await getUserId(db)).toBe(USER);
    expect(await deleteEverything({ db, api, tokens }, { deviceOnly: true })).toEqual({ kind: 'deleted', server: false });
    expect(calls).toEqual([]);
    expect(await count(db)).toBe(0);
  });

  it('never signed in: wipes the local store only and makes no request', async () => {
    const { db, calls } = await signedIn();
    await db.runAsync("DELETE FROM settings WHERE key = 'sync.user_id'");
    const tokens = memoryTokens();
    expect(await deleteEverything({ db, api: null, tokens })).toEqual({ kind: 'deleted', server: false });
    expect(calls).toEqual([]);
    expect(await count(db)).toBe(0);
  });

  it('logs nothing: no console output during export or delete', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    const { db, tokens, api } = await signedIn();
    await buildLocalExport(db);
    await deleteEverything({ db, api, tokens });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
});
