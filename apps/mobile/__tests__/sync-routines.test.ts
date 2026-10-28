/** @jest-environment node */
import { createClient } from '@plate-and-bar/api';
import { pendingCount } from '../src/db/outbox';
import { createRoutine, deleteRoutine, loadRoutines, renameRoutine } from '../src/db/routines';
import { forgetHeldRetry, syncOnce } from '../src/sync/engine';
import { listQuarantined } from '../src/sync/quarantine';
import { KEY_CURSOR, getCursor, getKv, setKv, KEY_USER } from '../src/sync/store';
import { saveWeightDoc } from './sync-fixtures';
import { failInTxn, fakeServer, memoryTokens, openDb, seedConsent } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
type Server = ReturnType<typeof fakeServer>;
const squat = [{ name: 'Squat', sets: 3 }];
const names = async (db: Awaited<ReturnType<typeof openDb>>) => (await loadRoutines(db)).map((r) => r.name).sort();

// The client keeps the fetch that exists when it is created: install a stable one and swap its target.
const net: { fetch: (r: Request) => Promise<Response> } = { fetch: async () => { throw new TypeError('no server'); } };
(globalThis as { fetch: unknown }).fetch = (r: Request) => net.fetch(r);

/** A device: its own store, signed in as USER, talking to `server` through its own client. */
async function device(server: Server, now?: () => number) {
  const db = await openDb();
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  await setKv(db, KEY_USER, USER);
  await seedConsent(db);
  const api = createClient('http://fake/api/v1', async () => (await tokens.load())?.access ?? null);
  const sync = () => {
    net.fetch = server.fetch;
    return syncOnce({ db, api, tokens, ...(now ? { now } : {}) });
  };
  return { db, sync };
}

beforeEach(() => forgetHeldRetry());

describe('routines sync (#1184)', () => {
  it('push and pull round trip: a routine saved, renamed and deleted on one device reaches the other', async () => {
    const server = fakeServer(USER);
    server.relay = true;
    const a = await device(server);
    const b = await device(server);
    const r = await createRoutine(a.db, 'Upper A', squat);
    expect(await a.sync()).toMatchObject({ status: 'ok', pushed: 1 });
    expect(server.pushed().map((p) => p.table)).toEqual(['routines']);
    expect(await pendingCount(a.db)).toBe(0);
    await b.sync();
    expect(await names(b.db)).toEqual(['Upper A']);
    expect(await pendingCount(b.db)).toBe(0); // pulled, not queued
    await renameRoutine(a.db, r.id as string, 'Upper B');
    await a.sync();
    await b.sync();
    expect(await names(b.db)).toEqual(['Upper B']);
    await deleteRoutine(a.db, r.id as string);
    await a.sync();
    await b.sync();
    expect(await names(b.db)).toEqual([]);
    expect(await b.db.getFirstAsync("SELECT 1 AS x FROM routines WHERE json_extract(data, '$.deleted_at') IS NOT NULL")).not.toBeNull(); // kept as a tombstone
  });

  it('two devices editing different routines never conflict', async () => {
    const server = fakeServer(USER);
    server.relay = true;
    server.byUpdatedAt = true;
    const a = await device(server);
    const b = await device(server);
    const r1 = await createRoutine(a.db, 'One', squat);
    const r2 = await createRoutine(a.db, 'Two', squat);
    await a.sync();
    await b.sync();
    await renameRoutine(a.db, r1.id as string, 'One (a)');
    await renameRoutine(b.db, r2.id as string, 'Two (b)');
    const ra = await a.sync();
    const rb = await b.sync();
    await a.sync();
    expect(ra.conflicts + rb.conflicts).toBe(0);
    expect(await names(a.db)).toEqual(['One (a)', 'Two (b)']);
    expect(await names(b.db)).toEqual(['One (a)', 'Two (b)']);
  });

  it('a push is refused 400 too_many_routines: only that routine is set aside, the rest syncs', async () => {
    const server = fakeServer(USER);
    server.maxLiveRoutines = 1;
    let t = Date.parse('2026-10-29T10:00:00Z');
    const a = await device(server, () => t);
    await createRoutine(a.db, 'Fits', squat);
    await a.sync();
    await createRoutine(a.db, 'Over', squat);
    await saveWeightDoc(a.db, { id: null, version: 0, updated_at: '2026-10-09T06:00:00Z', deleted_at: null, date: '2026-10-08', weight_kg: 80 });
    expect(await a.sync()).toMatchObject({ status: 'ok', quarantined: 1 });
    expect(await listQuarantined(a.db)).toEqual([expect.objectContaining({ tbl: 'routines', field: 'changes.routines[0]' })]);
    expect(server.log.filter((l) => l.table === 'weights')).toHaveLength(1); // applied once, in the second request
    expect(server.log.filter((l) => l.table === 'routines')).toHaveLength(1); // only the one that fits
    // Not retried by the unsupported-table rule, even a day later: the server would refuse it again.
    t += 2 * 86_400_000;
    server.maxLiveRoutines = 5;
    await a.sync();
    expect(await listQuarantined(a.db)).toHaveLength(1);
  });

  it('records set aside as unsupported_table are tried again once the server accepts routines (once a day)', async () => {
    const server = fakeServer(USER);
    server.unsupported = ['routines'];
    let t = Date.parse('2026-10-29T10:00:00Z');
    const a = await device(server, () => t);
    await createRoutine(a.db, 'Upper A', squat);
    expect(await a.sync()).toMatchObject({ status: 'ok', quarantined: 1 });
    expect(await pendingCount(a.db)).toBe(1);

    server.unsupported = []; // the server is upgraded
    t += 3_600_000; // within the day: not retried yet
    expect(await a.sync()).toMatchObject({ status: 'ok' });
    expect(await listQuarantined(a.db)).toHaveLength(1);

    t += 86_400_000;
    expect(await a.sync()).toMatchObject({ status: 'ok', pushed: 1 });
    expect(await listQuarantined(a.db)).toEqual([]);
    expect(await pendingCount(a.db)).toBe(0);
    expect(server.pushed().filter((p) => p.table === 'routines')).toHaveLength(2); // refused once, accepted once
  });

  it('a record still refused as unsupported_table is set aside again, not sent every run', async () => {
    const server = fakeServer(USER);
    server.unsupported = ['routines'];
    let t = Date.parse('2026-10-29T10:00:00Z');
    const a = await device(server, () => t);
    await createRoutine(a.db, 'Upper A', squat);
    await a.sync();
    t += 2 * 86_400_000;
    expect(await a.sync()).toMatchObject({ status: 'ok', quarantined: 1 });
    expect(await listQuarantined(a.db)).toHaveLength(1);
  });

  it('after the upgrade the first run pulls routines from the beginning, once', async () => {
    const server = fakeServer(USER);
    const a = await device(server);
    // An old build left a cursor past routines it ignored; the upgrade has not synced yet.
    await a.db.runAsync("DELETE FROM settings WHERE key = 'sync.routines_pulled'");
    await setKv(a.db, KEY_CURSOR, 'c_old');
    server.put('routines', { id: '11111111-1111-4111-8111-111111111111', version: 1, updated_at: '2026-10-20T00:00:00Z', deleted_at: null, name: 'From server', exercises: squat, created_at: '2026-10-20T00:00:00Z' });
    await a.sync();
    expect(server.calls.find((c) => c.path === '/sync')!.body.cursor ?? null).toBeNull();
    expect(await names(a.db)).toEqual(['From server']);
    expect(await getKv(a.db, 'sync.routines_pulled')).toBe('1');
    const cursor = await getCursor(a.db);
    await a.sync();
    expect(server.calls.filter((c) => c.path === '/sync').at(-1)!.body.cursor).toBe(cursor); // not reset again
  });
  it('only the unsupported_table record is retried; one set aside for another reason stays, and no marker is left behind', async () => {
    const server = fakeServer(USER);
    server.unsupported = ['weights'];
    server.maxLiveRoutines = 1;
    let t = Date.parse('2026-10-29T10:00:00Z');
    const a = await device(server, () => t);
    await createRoutine(a.db, 'Fits', squat);
    await a.sync();
    await createRoutine(a.db, 'Over', squat);
    await saveWeightDoc(a.db, { id: null, version: 0, updated_at: '2026-10-09T06:00:00Z', deleted_at: null, date: '2026-10-08', weight_kg: 80 });
    expect(await a.sync()).toMatchObject({ status: 'ok', quarantined: 2 });
    server.unsupported = []; // the server is upgraded; the cap still holds
    t += 2 * 86_400_000;
    const routinePushes = server.pushed().filter((p) => p.table === 'routines').length;
    await a.sync();
    expect(server.pushed().filter((p) => p.table === 'routines')).toHaveLength(routinePushes); // not sent again
    expect((await listQuarantined(a.db)).map((q) => q.tbl)).toEqual(['routines']);
    expect(server.log.filter((l) => l.table === 'weights')).toHaveLength(1);
    expect(await a.db.getAllAsync("SELECT key FROM settings WHERE key LIKE 'sync.unsupported.%'")).toEqual([]);
  });

  it('the one-time re-pull resets the cursor and sets its marker in one transaction', async () => {
    const server = fakeServer(USER);
    const a = await device(server);
    await a.db.runAsync("DELETE FROM settings WHERE key = 'sync.routines_pulled'");
    await setKv(a.db, KEY_CURSOR, 'c_old');
    const f = failInTxn(a.db, 'INSERT OR REPLACE INTO settings'); // the marker write
    await a.sync().catch(() => undefined);
    f.restore();
    expect(await getKv(a.db, KEY_CURSOR)).toBe('c_old'); // rolled back with the marker
    expect(await getKv(a.db, 'sync.routines_pulled')).toBeNull();
  });
});
