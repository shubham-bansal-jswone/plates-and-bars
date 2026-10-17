/** @jest-environment node */
import { createClient } from '@plate-and-bar/api';
import { pendingCount } from '../src/db/outbox';
import { BODY_BUDGET_BYTES, MAX_BODY_BYTES, utf8Length } from '../src/sync/batch';
import { syncOnce } from '../src/sync/engine';
import { listQuarantined, retryQuarantined } from '../src/sync/quarantine';
import { KEY_CURSOR, KEY_USER, getCursor, setKv } from '../src/sync/store';
import { fakeServer, memoryTokens, openDb, seedConsent, turns, until } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const date = (i: number) => `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;

async function setup() {
  const db = await openDb();
  const server = fakeServer(USER);
  (globalThis as { fetch: unknown }).fetch = server.fetch;
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  await setKv(db, KEY_USER, USER);
  await seedConsent(db);
  const deps = { db, api: createClient('http://fake/api/v1', async () => (await tokens.load())?.access ?? null), tokens };
  server.accessValid = 'access-1';
  return { db, server, deps };
}

/** A day note padded to about `bytes` bytes (the fake server checks sizes, not fields). */
async function saveBig(db: Awaited<ReturnType<typeof openDb>>, d: string, bytes: number) {
  const doc = { id: null, version: 0, deleted_at: null, updated_at: '2026-10-09T06:00:00Z', date: d, complete: null, steps: null, sleep: null, fast: false, pad: 'x'.repeat(bytes) };
  await db.runAsync('INSERT OR REPLACE INTO day_notes (key, data) VALUES (?, ?)', d, JSON.stringify(doc));
}
/** Dates in the requests the server accepted (the refused ones are not in its store). */
const accepted = (server: ReturnType<typeof fakeServer>) =>
  new Set(syncCalls(server).filter((_, i) => server.sizes[i]! <= server.maxBytes).flatMap((c) => (c.body.changes?.day_notes ?? []).map((r) => r.date as string)));
const syncCalls = (server: ReturnType<typeof fakeServer>) => server.calls.filter((c) => c.path === '/sync');

describe('utf8Length', () => {
  it('counts bytes, not characters', () => {
    for (const s of ['abc', 'é', '₹ 50', 'नमस्ते', '😀 ok', '"\\\n']) expect(utf8Length(s)).toBe(new TextEncoder().encode(s).length);
  });
});

describe('size-aware batching', () => {
  it('splits many large records so every request is under the budget, and all of them sync', async () => {
    const { db, server, deps } = await setup();
    for (let i = 0; i < 20; i++) await saveBig(db, date(i), 400_000); // 8 MB together
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok' });
    expect(server.sizes.every((n) => n <= BODY_BUDGET_BYTES)).toBe(true);
    expect(syncCalls(server).length).toBeGreaterThan(4);
    expect(accepted(server).size).toBe(20);
    expect(await pendingCount(db)).toBe(0);
    expect(await listQuarantined(db)).toEqual([]);
  });

  it('sends small records in one request, as before', async () => {
    const { db, server, deps } = await setup();
    for (let i = 0; i < 50; i++) await saveBig(db, date(i), 10);
    await syncOnce(deps);
    expect(syncCalls(server)).toHaveLength(1);
    expect(await pendingCount(db)).toBe(0);
  });

  it('a record over 2 MB is set aside without a request; the others sync', async () => {
    const { db, server, deps } = await setup();
    await saveBig(db, date(0), 100);
    await saveBig(db, date(1), MAX_BODY_BYTES + 10);
    await saveBig(db, date(2), 100);
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok', quarantined: 1 });
    expect([...accepted(server)].sort()).toEqual([date(0), date(2)]);
    expect(server.sizes.every((n) => n <= MAX_BODY_BYTES)).toBe(true);
    expect(await listQuarantined(db)).toEqual([expect.objectContaining({ tbl: 'day_notes', key: date(1) })]);
    // Nothing is dropped: the record and its queue entry stay.
    expect(await pendingCount(db)).toBe(1);
    expect(await db.getFirstAsync('SELECT key FROM day_notes WHERE key = ?', date(1))).not.toBeNull();
    // The next run does not try it again, and does not stall.
    const before = syncCalls(server).length;
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok' });
    expect(syncCalls(server).length).toBe(before + 1);
  });

  it('a record that fits alone is not set aside because of the records before it (1.0 MB then 1.2 MB)', async () => {
    const { db, server, deps } = await setup();
    await saveBig(db, date(0), 1_000_000);
    await saveBig(db, date(1), 1_200_000); // 2.2 MB together, 1.2 MB alone
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok' });
    expect(await listQuarantined(db)).toEqual([]);
    expect(accepted(server).size).toBe(2);
    expect(await pendingCount(db)).toBe(0);
  });

  it('needs more than 40 requests in one run and still syncs everything (60 records of 800 KB)', async () => {
    const { db, server, deps } = await setup();
    for (let i = 0; i < 60; i++) await saveBig(db, date(i), 800_000);
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok' });
    expect(syncCalls(server).length).toBeGreaterThan(40);
    expect(accepted(server).size).toBe(60);
    expect(await pendingCount(db)).toBe(0);
  });

  it('answers an over-limit body before auth and forced statuses, as the contract says', async () => {
    const { db, server, deps } = await setup();
    server.maxBytes = 3_000;
    server.accessValid = 'other'; // the token is refused and cannot be renewed, but the size check comes first
    server.refreshOk = false;
    await saveBig(db, date(0), 5_000);
    // The big request gets too_large (not 401) and the record is set aside; the next, small request then gets the 401.
    expect((await syncOnce(deps)).status).toBe('signed_out');
    expect(await listQuarantined(db)).toHaveLength(1);
  });

  it('a 413 from a proxy is treated like too_large: halved, then set aside alone', async () => {
    const { db, server, deps } = await setup();
    server.tooLargeStatus = 413;
    server.maxBytes = 3_000;
    await saveBig(db, date(0), 500);
    await saveBig(db, date(1), 5_000);
    await saveBig(db, date(2), 500);
    await saveBig(db, date(3), 500);
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok', quarantined: 1 });
    expect([...accepted(server)].sort()).toEqual([date(0), date(2), date(3)]);
    expect(await listQuarantined(db)).toEqual([expect.objectContaining({ key: date(1) })]);
  });

  it('a token refresh held in flight at the first batch: one refresh, and every later batch carries the new token', async () => {
    const { db, server, deps } = await setup();
    for (let i = 0; i < 4; i++) await saveBig(db, date(i), 800_000); // one record per request
    server.accessValid = 'expired'; // the first request is answered 401, so the run refreshes
    let release = () => {};
    server.hold = new Promise<void>((r) => (release = r));
    server.holdPath = '/auth/refresh';
    const run = syncOnce(deps);
    await until("the refresh in flight", () => server.calls.some((c) => c.path === "/auth/refresh")); // the refresh is in flight
    release();
    expect(await run).toMatchObject({ status: 'ok' });
    expect(server.refreshes).toBe(1);
    expect(accepted(server).size).toBe(4);
    expect(syncCalls(server).length).toBeGreaterThanOrEqual(5); // the 401, then one request per record
    expect(await pendingCount(db)).toBe(0);
  });

  it('a refused token refresh in a later round keeps the counts of what already synced (#401)', async () => {
    const { db, server, deps } = await setup();
    for (let i = 0; i < 4; i++) await saveBig(db, date(i), 600_000); // two requests: the body budget fits two per request
    let requests = 0;
    server.rejectIf = () => {
      if (++requests === 2) server.accessValid = 'rotated-elsewhere'; // after the first request the token stops working
      return null;
    };
    server.refreshFailStatus = 403; // and the refresh is refused (not a sign-out)
    const r = await syncOnce(deps);
    expect(r.status).toBe('rejected');
    expect(r.pushed).toBe(2);
  });

  it('halvings run out: the run ends, nothing is lost, the next run finishes', async () => {
    const { db, server, deps } = await setup();
    server.maxBytes = 3_000;
    let n = 0;
    for (let k = 0; k < 12; k++) {
      for (let j = 0; j < 6; j++) await saveBig(db, date(n++), 100);
      await saveBig(db, date(n++), 5_000); // refused alone
    }
    const first = await syncOnce(deps);
    expect(first.status).toBe('rejected'); // bounded: some set aside, the rest still queued
    expect(first.pushed).toBeGreaterThan(0); // #401: the counts survive the halvings return
    expect(first.quarantined).toBeGreaterThan(0);
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok' });
    expect(await pendingCount(db)).toBe(12);
    expect(await listQuarantined(db)).toHaveLength(12);
  });

  it('only oversized records queued: all are set aside, the run ends ok', async () => {
    const { db, deps } = await setup();
    await saveBig(db, date(0), MAX_BODY_BYTES + 1);
    await saveBig(db, date(1), MAX_BODY_BYTES + 1);
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok', quarantined: 2 });
    expect(await pendingCount(db)).toBe(2);
  });

  it('a too_large on the first batch halves it and retries until it fits', async () => {
    const { db, server, deps } = await setup();
    server.maxBytes = 5_000; // the server is stricter than the client's estimate
    for (let i = 0; i < 8; i++) await saveBig(db, date(i), 1_000);
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok' });
    const reqs = syncCalls(server);
    expect(reqs[0]!.body.changes?.day_notes).toHaveLength(8);
    expect(reqs[1]!.body.changes?.day_notes).toHaveLength(4); // halved
    expect(accepted(server).size).toBe(8);
    expect(await pendingCount(db)).toBe(0);
    expect(await listQuarantined(db)).toEqual([]);
  });

  it('halves down to one record per request, and nothing is set aside when one fits', async () => {
    const { db, server, deps } = await setup();
    server.maxBytes = 2_000; // one 1,500-byte record fits, two do not
    for (let i = 0; i < 5; i++) await saveBig(db, date(i), 1_400);
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok' });
    const sizes = syncCalls(server).map((c) => c.body.changes?.day_notes?.length ?? 0);
    expect(sizes.slice(0, 4)).toEqual([5, 2, 1, 1]);
    expect(sizes.filter((n) => n > 1)).toEqual([5, 2]);
    expect(await pendingCount(db)).toBe(0);
  });

  it('a record the server refuses alone is set aside after halving to 1; the rest keeps syncing', async () => {
    const { db, server, deps } = await setup();
    server.maxBytes = 3_000;
    await saveBig(db, date(0), 500);
    await saveBig(db, date(1), 5_000); // over the server's limit on its own, though under 2 MB
    await saveBig(db, date(2), 500);
    await saveBig(db, date(3), 500);
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok', quarantined: 1 });
    expect([...accepted(server)].sort()).toEqual([date(0), date(2), date(3)]);
    expect(await listQuarantined(db)).toEqual([expect.objectContaining({ key: date(1) })]);
    expect(await pendingCount(db)).toBe(1);
    // Retry sends it again (refused again), and the app never loops: a bounded number of requests.
    const before = syncCalls(server).length;
    await retryQuarantined(db);
    expect(await syncOnce(deps)).toMatchObject({ status: 'ok', quarantined: 1 });
    expect(syncCalls(server).length - before).toBeLessThanOrEqual(2);
  });

  it('a too_large with nothing named never loops: a server that always refuses ends the run', async () => {
    const { db, server, deps } = await setup();
    server.maxBytes = 10; // refuses every request, even an empty one
    for (let i = 0; i < 3; i++) await saveBig(db, date(i), 10);
    const r = await syncOnce(deps);
    expect(r.status).toBe('rejected');
    expect(syncCalls(server).length).toBeLessThan(50);
    expect(await pendingCount(db)).toBe(3); // nothing lost
  });

  it('keeps the cursor and the acknowledgement behaviour: each request carries the cursor the last one returned', async () => {
    const { db, server, deps } = await setup();
    for (let i = 0; i < 6; i++) await saveBig(db, date(i), 400_000);
    await setKv(db, KEY_CURSOR, 'c_start');
    await syncOnce(deps);
    const reqs = syncCalls(server);
    expect(reqs[0]!.body.cursor).toBe('c_start');
    expect(reqs[1]!.body.cursor).toBe('c_1');
    expect(await getCursor(db)).toBe(`c_${reqs.length}`);
  });
});
