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

  it.each([
    ['a path that is not a record', [{ field: 'changes', issue: 'too_many_records' }]],
    ['an index out of range', [{ field: 'changes.weights[9].weight_kg', issue: 'x' }]],
    ['an unknown table', [{ field: 'changes.nope[0].id', issue: 'x' }]],
    ['no details at all', undefined],
    ['an empty list', []],
    ['a field that is not text', [{ field: null, issue: 'x' }]],
  ])('a real 400 with %s is still a rejected run: nothing is set aside, nothing is lost', async (_name, details) => {
    const { db, server, deps } = await setup();
    server.rejectIf = null;
    await saveWeightDoc(db, weight('2026-10-07', 80));
    await saveWeightDoc(db, weight('2026-10-08', 81));
    server.force400.push(details as never);
    expect((await syncOnce(deps)).status).toBe('rejected');
    expect(await quarantineCount(db)).toBe(0);
    expect(await pendingCount(db)).toBe(2);
  });

  it('several fields naming one record set it aside once', async () => {
    const { db, server, deps } = await setup();
    server.rejectIf = null;
    await saveWeightDoc(db, weight('2026-10-07', 80));
    await saveWeightDoc(db, weight('2026-10-08', 81));
    server.force400.push([
      { field: 'changes.weights[1].weight_kg', issue: 'a' },
      { field: 'changes.weights[1].date', issue: 'b' },
      { field: 'changes.weights[1].updated_at', issue: 'c' },
    ]);
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok', quarantined: 1 });
    expect(await quarantineCount(db)).toBe(1);
  });

  it('a record edited after it was sent is not hidden by the refusal of the older edit', async () => {
    const { db, server, deps } = await setup();
    server.rejectIf = null;
    await saveWeightDoc(db, weight('2026-10-08', -1));
    // The refusal arrives while the user fixes the value: the edit made meanwhile must still go out.
    let release = () => {};
    server.hold = new Promise<void>((r) => (release = r));
    server.force400.push([{ field: 'changes.weights[0].weight_kg', issue: 'x' }]);
    const run = syncOnce(deps);
    await new Promise((r) => setTimeout(r, 20)); // the request is in flight
    await saveWeightDoc(db, weight('2026-10-08', 80));
    server.hold = null;
    release();
    await run;
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok' });
    expect(await pendingCount(db)).toBe(0);
  });
});

describe('a run with very many refused records', () => {
  it('spends a bounded number of requests setting them aside, and the rest wait for the next run', async () => {
    const { db, server, deps } = await setup();
    server.rejectIf = null;
    for (let i = 0; i < 100; i++) await saveWeightDoc(db, weight(`2026-01-${String(i + 1).padStart(3, '0')}`, 80));
    // The server names one record per request (the first), as its per-record checks do.
    for (let i = 0; i < 100; i++) server.force400.push([{ field: 'changes.weights[0].weight_kg', issue: 'x' }]);
    const r = await syncOnce(deps);
    expect(r.status).toBe('ok');
    // 40 set-aside rounds do not count against the 40-round limit, then each one does: 80 requests, not 100.
    expect(r.quarantined).toBe(80);
    expect(server.calls.filter((c) => c.path === '/sync')).toHaveLength(80);
    expect(await quarantineCount(db)).toBe(80);
  });
});

function listPushedId(server: ReturnType<typeof fakeServer>) {
  return Promise.resolve(server.pushed().find((p) => p.date === '2026-10-08')?.id);
}
