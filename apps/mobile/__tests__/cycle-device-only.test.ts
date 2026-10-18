/** @jest-environment node */
import { addCycleStart, emptyCycle } from '@plate-and-bar/core';
import { buildLocalExport } from '../src/account/exportLocal';
import { deleteEverything } from '../src/account/server';
import { deleteCycle, loadCycle, saveCycle } from '../src/db/cycle';
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

const logged = addCycleStart({ ...emptyCycle(), on: true }, '2026-10-01');
const rows = async (db: Awaited<ReturnType<typeof openDb>>) => (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM cycle_log'))?.n;

describe('cycle log is device only (#625)', () => {
  it('lives in its own table, outside the contract sync tables, with no outbox trigger', async () => {
    const db = await openDb();
    expect(Object.values(SYNC_TABLES)).not.toContain('cycle_log');
    expect(Object.keys(SYNC_TABLES).join()).not.toMatch(/cycle/);
    const triggers = await db.getAllAsync<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'trigger'");
    expect(triggers.some((t) => /cycle_log/.test(t.sql))).toBe(false);
    expect(MIGRATIONS.join('\n')).not.toMatch(/sync_outbox[^;]*cycle_log|cycle_log[^;]*sync_outbox/);
  });

  it('saving, changing and deleting the log never queues anything', async () => {
    const db = await openDb();
    await saveCycle(db, logged);
    await saveCycle(db, addCycleStart(logged, '2026-10-29'));
    expect(await loadCycle(db)).toEqual({ on: true, starts: ['2026-10-01', '2026-10-29'], len: 28 });
    expect(await pendingCount(db)).toBe(0);
    await deleteCycle(db);
    expect(await pendingCount(db)).toBe(0);
    expect(await loadCycle(db)).toEqual(emptyCycle());
  });

  it('a sync run sends and stores no cycle data, even with other changes queued', async () => {
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
    await saveCycle(db, logged);
    await saveWeightDoc(db, { id: null, version: 0, updated_at: '2026-10-09T06:00:00Z', deleted_at: null, date: '2026-10-08', weight_kg: 80 });
    expect(await pendingCount(db)).toBe(1);
    const deps = { db, api: createClient('http://fake/api/v1', async () => (await tokens.load())?.access ?? null), tokens };
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok' });
    const sent = bodies.join('\n');
    expect(sent).toContain('2026-10-08'); // the weigh-in did go
    expect(sent).not.toContain('2026-10-01');
    expect(sent).not.toMatch(/cycle|starts/i);
    expect(await loadCycle(db)).toEqual(logged);
  });

  it('the device export includes the cycle log, and has none when there is none', async () => {
    const db = await openDb();
    expect((await buildLocalExport(db)).file.device_only).toEqual({});
    await saveCycle(db, logged);
    const { file } = await buildLocalExport(db);
    expect(file.device_only).toEqual({ cycle: { on: true, starts: ['2026-10-01'], len: 28 } });
    expect(Object.keys(file.tables).sort()).toEqual(Object.keys(SYNC_TABLES).sort());
  });

  it('a store wipe deletes it, in the same step as the synced tables', async () => {
    const db = await openDb();
    await saveCycle(db, logged);
    expect(await rows(db)).toBe(1);
    expect(await wipeLocalStore(db)).toBe(0);
    expect(await rows(db)).toBe(0);
  });

  it('delete everything on this device deletes it', async () => {
    const db = await openDb();
    await saveCycle(db, logged);
    const tokens = memoryTokens(null);
    const api = makeApi(BASE, tokens);
    expect(await deleteEverything({ db, api, tokens })).toMatchObject({ kind: 'deleted' });
    expect(await rows(db)).toBe(0);
  });

  it('reads a damaged row as an empty log', async () => {
    const db = await openDb();
    await db.runAsync("INSERT INTO cycle_log (key, data) VALUES ('me', 'not json')");
    expect(await loadCycle(db)).toEqual(emptyCycle());
    await db.runAsync("INSERT OR REPLACE INTO cycle_log (key, data) VALUES ('me', ?)", JSON.stringify({ on: true, starts: ['2026-10-01', 5, 'x'], len: -3 }));
    expect(await loadCycle(db)).toEqual({ on: true, starts: ['2026-10-01'], len: 28 });
  });
});
