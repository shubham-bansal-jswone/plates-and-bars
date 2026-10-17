/** @jest-environment node */
import { createClient } from '@plate-and-bar/api';
import { pendingChanges, pendingCount } from '../src/db/outbox';
import { forgetHeldRetry, syncOnce } from '../src/sync/engine';
import { KEY_ACCOUNT_FULL, isAccountFull } from '../src/sync/held';
import { naturalId } from '../src/sync/ids';
import { listQuarantined } from '../src/sync/quarantine';
import { KEY_USER, getKv, setKv } from '../src/sync/store';
import { saveWeightDoc, type WeightDoc } from './sync-fixtures';
import { fakeServer, memoryTokens, openDb, seedConsent } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const DAY = 86_400_000;
const date = (i: number) => `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
const weight = (d: string, kg: number, over: Partial<WeightDoc> = {}): WeightDoc => ({ id: null, version: 0, updated_at: '2026-10-09T06:00:00Z', deleted_at: null, date: d, weight_kg: kg, ...over });

async function setup() {
  forgetHeldRetry(); // each test is a fresh app launch
  const db = await openDb();
  const server = fakeServer(USER);
  (globalThis as { fetch: unknown }).fetch = server.fetch;
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  await setKv(db, KEY_USER, USER);
  await seedConsent(db);
  const clock = { t: Date.UTC(2026, 9, 17, 8) };
  const deps = { db, api: createClient('http://fake/api/v1', async () => (await tokens.load())?.access ?? null), tokens, now: () => clock.t };
  server.accessValid = 'access-1';
  return { db, server, deps, clock };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

/** A weigh-in the server stores and this device has synced (version 1, nothing queued). */
async function synced(c: Ctx, d: string, kg: number, over: Partial<WeightDoc> = {}) {
  const id = await naturalId(USER, 'weights', d);
  const doc = weight(d, kg, { id, version: 1, ...over });
  c.server.seed('weights', doc as never);
  await saveWeightDoc(c.db, doc);
  await c.db.runAsync('DELETE FROM sync_outbox WHERE key = ?', d);
}
/** A water log (random id, so not a natural-key table), as a live entry or a tombstone. */
const saveWater = (c: Ctx, id: string, deleted: boolean) =>
  c.db.runAsync('INSERT OR REPLACE INTO water_logs (key, log_date, data) VALUES (?, ?, ?)', id, '2026-10-08', JSON.stringify({ id, version: 0, updated_at: '2026-10-09T06:00:00Z', deleted_at: deleted ? '2026-10-10T06:00:00Z' : null, date: '2026-10-08', ml: 250 }));
const syncCalls = (c: Ctx) => c.server.calls.filter((x) => x.path === '/sync');
const recordsIn = (c: Ctx) => syncCalls(c).map((x) => Object.values(x.body.changes ?? {}).flat().length);
const pendingKeys = async (c: Ctx) => (await pendingChanges(c.db)).map((e) => e.key);
const outboxKeys = async (c: Ctx) => (await c.db.getAllAsync<{ key: string }>('SELECT key FROM sync_outbox ORDER BY seq')).map((r) => r.key);
const localVersion = async (c: Ctx, d: string) => JSON.parse((await c.db.getFirstAsync<{ data: string }>('SELECT data FROM weights WHERE key = ?', d))!.data).version as number;

describe('413 account_full', () => {
  it('is not a too-large body: the batch is not split, nothing is quarantined and no record is dropped', async () => {
    const c = await setup();
    await synced(c, date(0), 80);
    c.server.recordCap = 1;
    for (let i = 1; i <= 4; i++) await saveWeightDoc(c.db, weight(date(i), 80 + i));
    const r = await syncOnce(c.deps);
    expect(r).toMatchObject({ status: 'ok', accountFull: true });
    expect(r.quarantined).toBeUndefined();
    expect(await listQuarantined(c.db)).toEqual([]);
    // The refused request carried all 4; nothing was halved, so every request carries 0 or all 4 records.
    expect(recordsIn(c).every((n) => n === 0 || n === 4)).toBe(true);
    expect(recordsIn(c)[0]).toBe(4);
    expect(syncCalls(c).length).toBeLessThanOrEqual(6);
    expect(c.server.pushed().filter((p) => p.version === 0).length).toBeGreaterThan(0); // they were tried
    expect(await pendingCount(c.db)).toBe(4);
    for (let i = 1; i <= 4; i++) expect(await localVersion(c, date(i))).toBe(0);
    expect(await isAccountFull(c.db)).toBe(true);
  });

  it('does not retry in a loop: the next runs pull only, until a day passes or the app is launched again', async () => {
    const c = await setup();
    await synced(c, date(0), 80);
    c.server.recordCap = 1;
    await saveWeightDoc(c.db, weight(date(1), 81));
    await syncOnce(c.deps);
    const after = syncCalls(c).length;
    for (let i = 0; i < 3; i++) expect(await syncOnce(c.deps)).toMatchObject({ status: 'ok', accountFull: true });
    expect(syncCalls(c).length).toBe(after + 3); // one pull-only request per run
    expect(recordsIn(c).slice(after)).toEqual([0, 0, 0]);
    // Less than a day later: still pull only.
    c.clock.t += DAY - 1000;
    const before = syncCalls(c).length;
    await syncOnce(c.deps);
    expect(recordsIn(c).slice(before)).toEqual([0]);
    // A day later: the held record is tried again (and refused again).
    c.clock.t += 2000;
    await syncOnce(c.deps);
    expect(recordsIn(c).at(-2)).toBe(1);
    // And not again the same day.
    const n = syncCalls(c).length;
    await syncOnce(c.deps);
    expect(syncCalls(c).length).toBe(n + 1);
    expect(recordsIn(c).at(-1)).toBe(0);
    // A new launch tries once more, at once: pull, the held record, pull.
    c.clock.t += 60_000;
    forgetHeldRetry();
    await syncOnce(c.deps);
    expect(recordsIn(c).slice(-3)).toEqual([0, 1, 0]);
    expect(await pendingCount(c.db)).toBe(1);
  });

  it('a 413 with an empty body (a proxy such as Caddy) still takes the too-large path: halved, set aside alone, not full', async () => {
    const c = await setup();
    c.server.tooLargeStatus = 413;
    c.server.proxyText = '';
    c.server.maxBytes = 3_000;
    const big = (i: number, pad: number) => c.db.runAsync('INSERT OR REPLACE INTO day_notes (key, data) VALUES (?, ?)', date(i), JSON.stringify({ id: null, version: 0, deleted_at: null, updated_at: '2026-10-09T06:00:00Z', date: date(i), complete: null, steps: null, sleep: null, fast: false, pad: 'x'.repeat(pad) }));
    await big(0, 500);
    await big(1, 5_000);
    await big(2, 500);
    await big(3, 500);
    const r = await syncOnce(c.deps);
    expect(r).toMatchObject({ status: 'ok', quarantined: 1 });
    expect(r.accountFull).toBeUndefined();
    expect(await isAccountFull(c.db)).toBe(false);
    expect(await listQuarantined(c.db)).toEqual([expect.objectContaining({ key: date(1) })]);
    expect(recordsIn(c)[0]).toBe(4);
    expect(recordsIn(c).some((n) => n > 0 && n < 4)).toBe(true); // the batch was halved
  });

  it.each([
    ['plain text', 'Request Entity Too Large'],
    ['JSON that is not an Error', '{"error":"too big"}'],
    ['an Error with another code', '{"code":"too_large","message":"x"}'],
  ])('a 413 with %s is not account_full either', async (_n, text) => {
    const c = await setup();
    c.server.tooLargeStatus = 413;
    c.server.proxyText = text;
    c.server.maxBytes = 3_000;
    await c.db.runAsync('INSERT INTO day_notes (key, data) VALUES (?, ?)', date(0), JSON.stringify({ id: null, version: 0, deleted_at: null, updated_at: '2026-10-09T06:00:00Z', date: date(0), complete: null, steps: null, sleep: null, fast: false, pad: 'x'.repeat(5_000) }));
    const r = await syncOnce(c.deps);
    expect(r).toMatchObject({ status: 'ok', quarantined: 1 });
    expect(await isAccountFull(c.db)).toBe(false);
  });

  it('an account_full 413 without record_cap is still account_full', async () => {
    const c = await setup();
    await saveWeightDoc(c.db, weight(date(0), 80));
    c.server.recordCap = 0;
    c.server.bareAccountFull = true;
    expect(await syncOnce(c.deps)).toMatchObject({ status: 'ok', accountFull: true });
    expect(await pendingCount(c.db)).toBe(1);
  });
});

describe('while the account is full', () => {
  it('edits and deletes of synced records still sync, pulls continue, and new records are held', async () => {
    const c = await setup();
    await synced(c, date(0), 80);
    await synced(c, date(1), 81);
    await synced(c, date(2), 82);
    c.server.recordCap = 3;
    // An edit, a delete (a synced record gets a tombstone) and a new record.
    await saveWeightDoc(c.db, weight(date(0), 79, { id: await naturalId(USER, 'weights', date(0)), version: 1 }));
    await saveWeightDoc(c.db, weight(date(1), 81, { id: await naturalId(USER, 'weights', date(1)), version: 1, deleted_at: '2026-10-10T06:00:00Z' }));
    await saveWeightDoc(c.db, weight(date(5), 90));
    c.server.put('weights', { id: await naturalId(USER, 'weights', date(9)), version: 1, updated_at: '2026-10-09T05:00:00Z', deleted_at: null, date: date(9), weight_kg: 70 } as never);
    const r = await syncOnce(c.deps);
    expect(r).toMatchObject({ status: 'ok', accountFull: true, pulled: 1 });
    expect(c.server.get('weights', await naturalId(USER, 'weights', date(0)))).toMatchObject({ version: 2, weight_kg: 79 });
    expect(c.server.get('weights', await naturalId(USER, 'weights', date(1)))).toMatchObject({ version: 2, deleted_at: '2026-10-10T06:00:00Z' });
    expect(await localVersion(c, date(0))).toBe(2);
    expect(await localVersion(c, date(9))).toBe(1); // pulled
    // The new record was held, never dropped; it is the only thing left in the queue.
    expect(await outboxKeys(c)).toEqual([date(5)]);
    expect(await localVersion(c, date(5))).toBe(0);
    expect(await pendingKeys(c)).toEqual([]); // hidden from the normal push
  });

  it('keeps syncing edits made after the account was found full, in later runs', async () => {
    const c = await setup();
    c.server.recordCap = 0;
    await saveWeightDoc(c.db, weight(date(5), 90));
    await syncOnce(c.deps);
    await synced(c, date(0), 80);
    await saveWeightDoc(c.db, weight(date(0), 78, { id: await naturalId(USER, 'weights', date(0)), version: 1 }));
    await saveWeightDoc(c.db, weight(date(6), 91));
    await syncOnce(c.deps);
    expect(c.server.get('weights', await naturalId(USER, 'weights', date(0)))).toMatchObject({ version: 2, weight_kg: 78 });
    expect(await outboxKeys(c)).toEqual([date(5), date(6)]);
  });

  it('an edit of a held record stays held (one queue entry, nothing sent)', async () => {
    const c = await setup();
    c.server.recordCap = 0;
    await saveWeightDoc(c.db, weight(date(5), 90));
    await syncOnce(c.deps);
    await saveWeightDoc(c.db, weight(date(5), 89));
    const n = recordsIn(c).length;
    await syncOnce(c.deps);
    expect(recordsIn(c).slice(n)).toEqual([0]);
    expect(await outboxKeys(c)).toEqual([date(5)]);
    expect(JSON.parse((await c.db.getFirstAsync<{ data: string }>("SELECT data FROM weights WHERE key = ?", date(5)))!.data).weight_kg).toBe(89);
  });

  it('a full account that refuses records the server lost (they have a version) still pulls, and does not loop', async () => {
    const c = await setup();
    c.server.recordCap = 0;
    await saveWeightDoc(c.db, weight(date(5), 90));
    await syncOnce(c.deps); // full
    await saveWeightDoc(c.db, weight(date(6), 91, { version: 3 })); // the server lost it
    c.server.put('weights', { id: await naturalId(USER, 'weights', date(9)), version: 1, updated_at: '2026-10-09T05:00:00Z', deleted_at: null, date: date(9), weight_kg: 70 } as never);
    const n = syncCalls(c).length;
    expect(await syncOnce(c.deps)).toMatchObject({ status: 'ok', accountFull: true, pulled: 1 });
    expect(recordsIn(c).slice(n)).toEqual([1, 0]); // the refused request, then a pull-only one
    expect(await localVersion(c, date(9))).toBe(1);
    expect(await pendingCount(c.db)).toBe(2);
  });

  it('with the full flag set and nothing held, a run ends after the pull: the held phase does not loop', async () => {
    const c = await setup();
    await setKv(c.db, KEY_ACCOUNT_FULL, '1');
    await syncOnce(c.deps);
    expect(syncCalls(c).length).toBeLessThanOrEqual(2);
  });

  it('the full flag survives a restart: the first run after launch holds new records without sending them first', async () => {
    const c = await setup();
    c.server.recordCap = 0;
    await saveWeightDoc(c.db, weight(date(5), 90));
    await syncOnce(c.deps);
    await saveWeightDoc(c.db, weight(date(6), 91));
    c.clock.t += 60_000;
    forgetHeldRetry();
    const n = syncCalls(c).length;
    await syncOnce(c.deps);
    // No mixed request with the new record first: pull-only, then the held retry (both records), then pull-only.
    expect(recordsIn(c).slice(n)).toEqual([0, 2, 0]);
  });
});

describe('the retry of held records', () => {
  /** Weigh-ins whose push the server stored but whose answer was lost: still version 0 here. */
  async function lose(c: Ctx, ds: string[], over: Partial<WeightDoc> = {}) {
    for (const d of ds) await saveWeightDoc(c.db, weight(d, 70, over));
    c.server.loseResponses = 1;
    expect((await syncOnce(c.deps)).status).toBe('offline');
    expect(await pendingCount(c.db)).toBe(ds.length);
  }

  it('records whose earlier answer was lost come back as idempotent retries and leave the queue, even behind really new ones', async () => {
    const c = await setup();
    await lose(c, [date(0), date(1), date(2)]);
    // 30 really new records, with one of the lost ones edited back in the middle of them (a newer queue position).
    for (let i = 10; i < 25; i++) await saveWeightDoc(c.db, weight(date(i), 80));
    await saveWeightDoc(c.db, weight(date(1), 70));
    for (let i = 25; i < 40; i++) await saveWeightDoc(c.db, weight(date(i), 80));
    c.server.recordCap = 3; // the server stores the 3 lost ones: full
    const before = syncCalls(c).length;
    const r = await syncOnce(c.deps);
    expect(r).toMatchObject({ status: 'ok', accountFull: true });
    // The retry was in batches of at most 20 (the first request, which discovered the full account, was the big one).
    const sizes = recordsIn(c).slice(before);
    expect(sizes[0]).toBe(33);
    expect(Math.max(...sizes.slice(1))).toBeLessThanOrEqual(20);
    // The lost ones left the queue as the server's own records; the really new ones are all still queued, none dropped.
    const left = await outboxKeys(c);
    expect(left.sort()).toEqual([...Array(30).keys()].map((i) => date(i + 10)).sort());
    for (const d of [date(0), date(1), date(2)]) expect(await localVersion(c, d)).toBe(1);
    for (const k of left) expect(await localVersion(c, k)).toBe(0);
    // Freed records say nothing about room: still full, and the notice stays.
    expect(await isAccountFull(c.db)).toBe(true);
  });

  it('a version-0 tombstone that was sent before is retried and leaves the queue', async () => {
    const c = await setup();
    await lose(c, [date(0)], { deleted_at: '2026-10-10T06:00:00Z' }); // created and deleted offline; the push went through, the answer was lost
    await saveWeightDoc(c.db, weight(date(5), 90));
    c.server.recordCap = 1;
    await syncOnce(c.deps);
    expect(await outboxKeys(c)).toEqual([date(5)]);
    expect(await localVersion(c, date(0))).toBe(1);
    expect(c.server.pushed().filter((p) => p.date === date(0)).length).toBeGreaterThanOrEqual(3); // first push, the refused request, the retry
  });

  it('a version-0 tombstone that no request ever carried is dropped, not held', async () => {
    const c = await setup();
    c.server.recordCap = 0;
    await saveWeightDoc(c.db, weight(date(5), 90));
    await syncOnce(c.deps); // full
    await saveWater(c, 'w-never', true);
    await syncOnce(c.deps);
    expect(await outboxKeys(c)).toEqual([date(5)]);
    expect(c.server.pushed().some((p) => p.id === 'w-never')).toBe(false); // it never left this device
    // The record stays on the device (it holds no data); only the queue entry is gone.
    expect(await c.db.getFirstAsync("SELECT key FROM water_logs WHERE key = 'w-never'")).not.toBeNull();
  });

  it('a tombstone carried only by the request that found the account full is dropped too (the server stored nothing)', async () => {
    const c = await setup();
    c.server.recordCap = 0;
    await saveWeightDoc(c.db, weight(date(5), 90));
    await saveWater(c, 'w-refused', true);
    await syncOnce(c.deps);
    expect(await outboxKeys(c)).toEqual([date(5)]);
  });

  it('a never-sent tombstone of a natural-key record is held, not dropped: the server may hold that id from another device', async () => {
    const c = await setup();
    const id = await naturalId(USER, 'weights', date(0));
    c.server.seed('weights', weight(date(0), 60, { id, version: 1 }) as never); // another device made it
    await saveWeightDoc(c.db, weight(date(0), 75)); // this device, the same date
    await saveWeightDoc(c.db, weight(date(1), 80));
    c.server.recordCap = 1;
    await syncOnce(c.deps); // full
    await saveWeightDoc(c.db, weight(date(0), 75, { deleted_at: '2026-10-10T06:00:00Z' })); // the user deletes it
    expect(await outboxKeys(c)).toContain(date(0));
    c.clock.t += 60_000;
    forgetHeldRetry();
    await syncOnce(c.deps);
    // The held push came back server_won: this device takes the server's 60 kg, as before the cap existed.
    const row = JSON.parse((await c.db.getFirstAsync<{ data: string }>('SELECT data FROM weights WHERE key = ?', date(0)))!.data);
    expect(row).toMatchObject({ weight_kg: 60, deleted_at: null, version: 1 });
    expect(await outboxKeys(c)).toEqual([date(1)]);
  });

  it('marks of a refused batch of only new records are cleared: a random-id tombstone behind a lost request is dropped', async () => {
    const c = await setup();
    await saveWater(c, 'w-offline', true);
    c.server.online = false;
    expect((await syncOnce(c.deps)).status).toBe('offline'); // the request never reached the server, the mark stays
    c.server.online = true;
    c.server.recordCap = 0;
    await saveWeightDoc(c.db, weight(date(5), 90));
    await syncOnce(c.deps);
    expect(await outboxKeys(c)).toEqual([date(5)]);
  });

  it('a batch cut short by the byte budget is judged and tried by what was sent: 14 then 6, not 14, 10, 10', async () => {
    const c = await setup();
    c.server.recordCap = 0;
    for (let i = 0; i < 20; i++) {
      await c.db.runAsync('INSERT INTO day_notes (key, data) VALUES (?, ?)', date(i), JSON.stringify({ id: null, version: 0, deleted_at: null, updated_at: '2026-10-09T06:00:00Z', date: date(i), complete: null, steps: null, sleep: null, fast: false, pad: 'x'.repeat(110_000) }));
    }
    await syncOnce(c.deps);
    expect(recordsIn(c).slice(1).filter((n) => n > 0)).toEqual([14, 6]);
    expect(await pendingCount(c.db)).toBe(20);
  });

  it('a record that was sent, then deleted offline, is kept as a tombstone: its first push may have been stored', async () => {
    const c = await setup();
    await lose(c, [date(0)]);
    await saveWeightDoc(c.db, weight(date(0), 70, { deleted_at: '2026-10-10T06:00:00Z' }));
    await saveWeightDoc(c.db, weight(date(5), 90));
    c.server.recordCap = 1;
    await syncOnce(c.deps);
    // Not dropped unsent: it went out again after the account was found full (the first push, the refused request, the retry).
    expect(c.server.pushed().filter((p) => p.date === date(0) && p.deleted_at).length).toBeGreaterThanOrEqual(2);
    expect(await outboxKeys(c)).toEqual([date(5)]);
  });

  it('the notice clears, and held records are pushed, when the cap is raised and a new record goes through', async () => {
    const c = await setup();
    c.server.recordCap = 0;
    for (let i = 0; i < 3; i++) await saveWeightDoc(c.db, weight(date(i), 80));
    await syncOnce(c.deps);
    expect(await isAccountFull(c.db)).toBe(true);
    c.server.recordCap = null;
    // Within the day nothing is tried: the account stays marked full.
    await syncOnce(c.deps);
    expect(await isAccountFull(c.db)).toBe(true);
    c.clock.t += DAY;
    const r = await syncOnce(c.deps);
    expect(r.accountFull).toBeUndefined();
    expect(r.pushed).toBe(3);
    expect(await isAccountFull(c.db)).toBe(false);
    expect(await getKv(c.db, 'sync.account_full')).toBeNull();
    expect(await pendingCount(c.db)).toBe(0);
    for (let i = 0; i < 3; i++) expect(await localVersion(c, date(i))).toBe(1);
    // Records made afterwards go out at once.
    await saveWeightDoc(c.db, weight(date(7), 77));
    await syncOnce(c.deps);
    expect(await pendingCount(c.db)).toBe(0);
  });

  it('a retry of only records the server already stores does not clear the notice (it proves nothing about room)', async () => {
    const c = await setup();
    await saveWeightDoc(c.db, weight(date(0), 70));
    c.server.loseResponses = 1;
    await syncOnce(c.deps);
    c.server.recordCap = 1;
    await saveWeightDoc(c.db, weight(date(1), 71));
    await syncOnce(c.deps);
    expect(await outboxKeys(c)).toEqual([date(1)]);
    expect(await isAccountFull(c.db)).toBe(true);
  });

  it('tries at most 1000 records per session, least recently tried first, so no record is starved', async () => {
    const c = await setup();
    c.server.recordCap = 0;
    const keys = Array.from({ length: 1100 }, (_, i) => `k${String(i).padStart(4, '0')}`);
    for (const k of keys) await saveWeightDoc(c.db, weight(k, 70));
    await syncOnce(c.deps);
    const datesIn = (from: number, to?: number) => new Set(syncCalls(c).slice(from, to).flatMap((x) => (x.body.changes?.weights ?? []).map((w) => w.date as string)));
    const first = syncCalls(c).length;
    const tried = datesIn(1); // everything after the request that found the account full
    expect(tried.size).toBe(1000);
    c.clock.t += DAY;
    await syncOnce(c.deps);
    const second = datesIn(first);
    for (const k of keys.filter((k) => !tried.has(k))) expect(second.has(k)).toBe(true); // the 100 not reached come first
    expect(await pendingCount(c.db)).toBe(1100);
  }, 120_000);
});
