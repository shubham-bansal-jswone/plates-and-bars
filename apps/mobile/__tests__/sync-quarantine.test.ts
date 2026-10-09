/** @jest-environment node */
import { createClient } from '@plate-and-bar/api';
import { pendingCount } from '../src/db/outbox';
import { syncOnce } from '../src/sync/engine';
import { discardQuarantined, listQuarantined, quarantineCount, retryQuarantined } from '../src/sync/quarantine';
import { KEY_USER, setKv } from '../src/sync/store';
import { saveWeightDoc, type WeightDoc } from './sync-fixtures';
import { fakeServer, memoryTokens, openDb, seedConsent } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const weight = (date: string, kg: number): WeightDoc => ({ id: null, version: 0, updated_at: '2026-10-09T06:00:00Z', deleted_at: null, date, weight_kg: kg });

async function setup() {
  const db = await openDb();
  const server = fakeServer(USER);
  (globalThis as { fetch: unknown }).fetch = server.fetch;
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  await setKv(db, KEY_USER, USER);
  await seedConsent(db);
  const deps = { db, api: createClient('http://fake/api/v1', async () => (await tokens.load())?.access ?? null), tokens };
  server.accessValid = 'access-1';
  // The server refuses a weigh-in of 0 kg or less, as it would any out-of-range value.
  server.rejectIf = (table, r) => (table === 'weights' && (r.weight_kg as number) <= 0 ? 'weight_kg' : null);
  return { db, server, deps };
}

describe('a 400 from /sync', () => {
  it('sets aside only the record it names; the others sync and the run is ok with a count', async () => {
    const { db, server, deps } = await setup();
    await saveWeightDoc(db, weight('2026-10-07', 80));
    await saveWeightDoc(db, weight('2026-10-08', -1));
    await saveWeightDoc(db, weight('2026-10-09', 81));
    const r = await syncOnce(deps);
    expect(r).toMatchObject({ status: 'ok', quarantined: 1 });
    const last = server.calls.filter((c) => c.path === '/sync').at(-1)!;
    expect((last.body.changes?.weights ?? []).map((w) => w.date).sort()).toEqual(['2026-10-07', '2026-10-09']);
    expect(server.calls.filter((c) => c.path === '/sync')).toHaveLength(2); // the refused request, then the rest
    expect(await listQuarantined(db)).toEqual([expect.objectContaining({ tbl: 'weights', key: '2026-10-08', field: 'changes.weights[1].weight_kg' })]);
    // Still "not synced": the record stays queued, so sign-out keeps its guard and nothing is lost.
    expect(await pendingCount(db)).toBe(1);
    expect(await db.getFirstAsync("SELECT key FROM weights WHERE key = '2026-10-08'")).not.toBeNull();
  });

  it('does not send the set-aside record again on the next run', async () => {
    const { db, server, deps } = await setup();
    await saveWeightDoc(db, weight('2026-10-08', -1));
    await syncOnce(deps);
    const before = server.calls.length;
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok' });
    expect(server.calls.length).toBe(before + 1);
    expect(server.calls.at(-1)!.body.changes?.weights ?? []).toHaveLength(0);
  });

  it('retry sends it again (and it is refused again); editing it sends the fix', async () => {
    const { db, server, deps } = await setup();
    await saveWeightDoc(db, weight('2026-10-08', -1));
    await syncOnce(deps);
    await retryQuarantined(db);
    expect(await quarantineCount(db)).toBe(0);
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok', quarantined: 1 });
    // the user corrects the value: a new edit is not hidden by the old marker
    await saveWeightDoc(db, weight('2026-10-08', 79));
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok' });
    expect(server.get('weights', (await listPushedId(server))!)).toBeDefined();
    expect(await pendingCount(db)).toBe(0);
    expect(await quarantineCount(db)).toBe(0);
  });

  it('discard drops the queue entry but keeps the record on the device', async () => {
    const { db, deps } = await setup();
    await saveWeightDoc(db, weight('2026-10-08', -1));
    await syncOnce(deps);
    expect(await discardQuarantined(db)).toBe(1);
    expect(await pendingCount(db)).toBe(0);
    expect(await quarantineCount(db)).toBe(0);
    expect(await db.getFirstAsync("SELECT key FROM weights WHERE key = '2026-10-08'")).not.toBeNull();
  });

  it('a 400 that names no record is still a rejected run, and nothing is set aside', async () => {
    const { db, server, deps } = await setup();
    server.rejectIf = null;
    await saveWeightDoc(db, weight('2026-10-08', 80));
    server.forceStatus.push({ status: 404 });
    expect((await syncOnce(deps)).status).toBe('rejected');
    expect(await quarantineCount(db)).toBe(0);
    expect(await pendingCount(db)).toBe(1);
  });
});

function listPushedId(server: ReturnType<typeof fakeServer>) {
  return Promise.resolve(server.pushed().find((p) => p.date === '2026-10-08')?.id);
}
