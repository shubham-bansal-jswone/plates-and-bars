/** @jest-environment node */
import { buildLocalExport } from '../src/account/exportLocal';
import { deleteEverything } from '../src/account/server';
import { deleteReports, loadHold, loadReports, saveHold, saveReport } from '../src/db/labs';
import { MIGRATIONS } from '../src/db/migrations';
import { SYNC_TABLES, pendingCount } from '../src/db/outbox';
import { createClient } from '@plate-and-bar/api';
import { makeApi } from '../src/sync/auth';
import { syncOnce } from '../src/sync/engine';
import { wipeLocalStore } from '../src/sync/guard';
import { KEY_USER, setKv } from '../src/sync/store';
import { saveWeightDoc } from './sync-fixtures';
import { fakeServer, memoryTokens, openDb, seedConsent } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const BASE = 'http://fake/api/v1';
type Fetch = (r: Request) => Promise<Response>;
const net: { fetch: Fetch } = { fetch: async () => { throw new TypeError('no server'); } };
(globalThis as { fetch: unknown }).fetch = (r: Request) => net.fetch(r);

const report = { id: 'r1', date: '2026-10-01', tests: [{ name: 'Fasting glucose SECRETMARK', value: '250', unit: 'mg/dL', low: '70', high: '100' }] };
type Db = Awaited<ReturnType<typeof openDb>>;
const rows = async (db: Db) => (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM lab_store'))?.n;

describe('lab reports and the lab hold are device only (#1070)', () => {
  it('live in their own table, outside the contract sync tables, with no outbox trigger', async () => {
    const db = await openDb();
    expect(Object.values(SYNC_TABLES)).not.toContain('lab_store');
    expect(Object.keys(SYNC_TABLES).join()).not.toMatch(/lab/);
    const triggers = await db.getAllAsync<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'trigger'");
    expect(triggers.some((t) => /lab_store/.test(t.sql))).toBe(false);
    expect(MIGRATIONS.join('\n')).not.toMatch(/sync_outbox[^;]*lab_store|lab_store[^;]*sync_outbox/);
  });

  it('saving, changing and deleting reports and the hold never queues anything', async () => {
    const db = await openDb();
    await saveReport(db, report);
    await saveHold(db, { on: true, since: '2026-10-01' });
    expect(await loadReports(db)).toEqual([report]);
    expect(await loadHold(db)).toEqual({ on: true, since: '2026-10-01' });
    expect(await pendingCount(db)).toBe(0);
    await deleteReports(db);
    expect(await loadReports(db)).toEqual([]);
    expect(await loadHold(db)).toEqual({ on: true, since: '2026-10-01' }); // only "I've seen my doctor" clears it
    expect(await pendingCount(db)).toBe(0);
  });

  it('a sync run sends and stores no lab data, even with other changes queued', async () => {
    const db = await openDb();
    const server = fakeServer(USER);
    server.accessValid = 'access-1';
    const bodies: string[] = [];
    (globalThis as { fetch: unknown }).fetch = async (r: Request) => {
      bodies.push(await r.clone().text());
      return server.fetch(r);
    };
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    await setKv(db, KEY_USER, USER);
    await seedConsent(db);
    await saveReport(db, report);
    await saveHold(db, { on: true, since: '2026-10-01' });
    await saveWeightDoc(db, { id: null, version: 0, updated_at: '2026-10-09T06:00:00Z', deleted_at: null, date: '2026-10-08', weight_kg: 80 });
    expect(await pendingCount(db)).toBe(1);
    const deps = { db, api: createClient(BASE, async () => (await tokens.load())?.access ?? null), tokens };
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok' });
    const sent = bodies.join('\n');
    expect(sent).toContain('2026-10-08'); // the weigh-in did go
    expect(sent).not.toMatch(/SECRETMARK|glucose|2026-10-01|labHold|lab_hold|"hold"/i);
    expect(await loadReports(db)).toEqual([report]);
  });

  it('the device export includes them, and has none when there are none', async () => {
    const db = await openDb();
    expect((await buildLocalExport(db)).file.device_only).toEqual({});
    await saveReport(db, report);
    await saveHold(db, { on: true, since: '2026-10-01' });
    const { file } = await buildLocalExport(db);
    expect(file.device_only).toEqual({ labs: { reports: [report], hold: { on: true, since: '2026-10-01' } } });
    expect(Object.keys(file.tables).sort()).toEqual(Object.keys(SYNC_TABLES).sort());
  });

  it('a store wipe deletes the reports and the hold, in the same step as the synced tables', async () => {
    const db = await openDb();
    await saveReport(db, report);
    await saveHold(db, { on: true });
    expect(await rows(db)).toBe(2);
    expect(await wipeLocalStore(db)).toBe(0);
    expect(await rows(db)).toBe(0);
  });

  it('delete everything on this device deletes them', async () => {
    const db = await openDb();
    await saveReport(db, report);
    await saveHold(db, { on: true });
    const tokens = memoryTokens(null);
    const api = makeApi(BASE, tokens);
    expect(await deleteEverything({ db, api, tokens })).toMatchObject({ kind: 'deleted' });
    expect(await rows(db)).toBe(0);
  });

  it('reads damaged rows as nothing', async () => {
    const db = await openDb();
    await db.runAsync("INSERT INTO lab_store (key, data) VALUES ('hold', 'not json')");
    await db.runAsync("INSERT INTO lab_store (key, data) VALUES ('lab|2026-10-01|a', 'not json')");
    await db.runAsync("INSERT INTO lab_store (key, data) VALUES ('lab|2026-10-02|b', ?)", JSON.stringify({ date: '2026-10-02', tests: [{ name: 1 }] }));
    expect(await loadHold(db)).toBeNull();
    expect(await loadReports(db)).toEqual([]);
  });
});
