/** @jest-environment node */
import { pendingCount } from '../src/db/outbox';
import { saveWeightDoc, type WeightDoc } from './sync-fixtures';
import { syncOnce } from '../src/sync/engine';
import { createClient } from '@plate-and-bar/api';
import { naturalId, uuidv5 } from '../src/sync/ids';
import { getCursor, setKv, KEY_USER, getLiftVersion } from '../src/sync/store';
import { saveLift, deleteLift } from '../src/db/workouts';
import { openDb, fakeServer, memoryTokens } from './sync-helpers';
const vectors = require('../../../packages/api/test-vectors/sync-ids.json') as { rfc_example: { namespace: string; name: string; id: string }; cases: { user_id: string; table: string; key: string; id: string }[] };

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

async function setup() {
  const db = await openDb();
  const server = fakeServer(USER);
  server.accessValid = 'access-1';
  (globalThis as { fetch: unknown }).fetch = server.fetch;
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  await setKv(db, KEY_USER, USER);
  const deps = { db, api: createClient('http://fake/api/v1', async () => (await tokens.load())?.access ?? null), tokens };
  return { db, server, tokens, deps };
}

const weight = (date: string, kg: number, version = 0): WeightDoc => ({ id: null, version, updated_at: '2026-10-09T06:00:00Z', deleted_at: null, date, weight_kg: kg });

describe('UUIDv5 ids', () => {
  it('matches the RFC example and every shared test vector', () => {
    expect(uuidv5(vectors.rfc_example.namespace, vectors.rfc_example.name)).toBe(vectors.rfc_example.id);
    for (const c of vectors.cases) expect(naturalId(c.user_id, c.table as never, c.key)).toBe(c.id);
  });
});

describe('sync engine', () => {
  it('an offline edit is pushed once when back online, with its natural-key id', async () => {
    const { db, server, deps } = await setup();
    await saveWeightDoc(db, weight('2026-10-08', 81.4));
    server.online = false;
    expect((await syncOnce(deps)).status).toBe('offline');
    expect(await pendingCount(db)).toBe(1);

    server.online = true;
    expect((await syncOnce(deps)).status).toBe('ok');
    const id = naturalId(USER, 'weights', '2026-10-08');
    expect(id).toBe('640dee2b-d92d-5a00-bd03-568962bf90ea');
    expect(server.pushed()).toEqual([expect.objectContaining({ table: 'weights', id, version: 0, weight_kg: 81.4 })]);
    expect(await pendingCount(db)).toBe(0);
    const local = JSON.parse((await db.getFirstAsync<{ data: string }>("SELECT data FROM weights WHERE key = '2026-10-08'"))!.data) as WeightDoc;
    expect(local.version).toBe(1);
    expect(await getCursor(db)).not.toBeNull();

    await syncOnce(deps);
    expect(server.pushed()).toHaveLength(1);
  });

  it('applies a pulled record without queuing it, and settles a local edit of another record through the server', async () => {
    const { db, server, deps } = await setup();
    server.put('food_logs', { id: 'f1', version: 2, updated_at: '2026-10-09T05:00:00Z', deleted_at: null, date: '2026-10-09', meal: 'Lunch', name: 'Dal', qty: 1, kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 5, food_id: null });
    server.put('weights', { id: naturalId(USER, 'weights', '2026-10-07'), version: 1, updated_at: '2026-10-09T05:00:00Z', deleted_at: null, date: '2026-10-07', weight_kg: 80 });
    await saveWeightDoc(db, weight('2026-10-07', 79)); // local edit of the same day, still queued
    await syncOnce(deps);
    expect(await db.getFirstAsync("SELECT key FROM food_logs WHERE key = 'f1' AND log_date = '2026-10-09'")).not.toBeNull();
    expect(await pendingCount(db)).toBe(0); // the weight was pushed in this run and found in conflict; the pulled food log was not queued
    expect(server.pushed().map((p) => p.table)).toEqual(['weights']);
    expect(JSON.parse((await db.getFirstAsync<{ data: string }>("SELECT data FROM weights WHERE key = '2026-10-07'"))!.data)).toMatchObject({ weight_kg: 80, version: 1 });
  });

  it('a pulled record alone leaves the outbox empty and nothing is pushed', async () => {
    const { db, server, deps } = await setup();
    server.put('food_logs', { id: 'f1', version: 1, updated_at: '2026-10-09T05:00:00Z', deleted_at: null, date: '2026-10-09', meal: 'Lunch', name: 'Dal', qty: 1, kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 5, food_id: null });
    await syncOnce(deps);
    await syncOnce(deps);
    expect(await pendingCount(db)).toBe(0);
    expect(server.pushed()).toHaveLength(0);
  });

  it('a real conflict replaces the local copy with the server record and is counted', async () => {
    const { db, server, deps } = await setup();
    const id = naturalId(USER, 'weights', '2026-10-08');
    server.put('weights', { id, version: 4, updated_at: '2026-10-09T09:00:00Z', deleted_at: null, date: '2026-10-08', weight_kg: 82 });
    await syncOnce(deps); // pulls it
    await saveWeightDoc(db, { ...weight('2026-10-08', 81, 3) });
    const r = await syncOnce(deps);
    expect(r.conflicts).toBe(1);
    const local = JSON.parse((await db.getFirstAsync<{ data: string }>("SELECT data FROM weights WHERE key = '2026-10-08'"))!.data) as WeightDoc;
    expect(local).toMatchObject({ weight_kg: 82, version: 4 });
    expect(await pendingCount(db)).toBe(0);
  });

  it('an idempotent retry (same content, older version) adopts the stored version without counting a conflict', async () => {
    const { db, server, deps } = await setup();
    const id = naturalId(USER, 'weights', '2026-10-08');
    server.put('weights', { id, version: 2, updated_at: '2026-10-09T06:00:05Z', deleted_at: null, date: '2026-10-08', weight_kg: 81.4 });
    await saveWeightDoc(db, weight('2026-10-08', 81.4, 1));
    const r = await syncOnce(deps);
    expect(r.conflicts).toBe(0);
    const local = JSON.parse((await db.getFirstAsync<{ data: string }>("SELECT data FROM weights WHERE key = '2026-10-08'"))!.data) as WeightDoc;
    expect(local.version).toBe(2);
    expect(await pendingCount(db)).toBe(0);
  });

  it('refreshes an expired access token once and retries; a dead refresh token ends the session but keeps the data', async () => {
    const { db, server, tokens, deps } = await setup();
    server.accessValid = 'newer';
    await saveWeightDoc(db, weight('2026-10-08', 81));
    expect((await syncOnce(deps)).status).toBe('ok');
    expect(server.refreshes).toBe(1);
    expect(tokens.current?.refresh).toBe('refresh-2');

    server.accessValid = 'rotated-again';
    server.refreshOk = false;
    await saveWeightDoc(db, weight('2026-10-09', 80));
    expect((await syncOnce(deps)).status).toBe('signed_out');
    expect(tokens.current).toBeNull();
    expect(await pendingCount(db)).toBe(1);
  });

  it('503 means retry later and never signs out; 429 carries Retry-After', async () => {
    const { db, server, tokens, deps } = await setup();
    await saveWeightDoc(db, weight('2026-10-08', 81));
    server.forceStatus.push({ status: 503 });
    expect((await syncOnce(deps)).status).toBe('unavailable');
    expect(tokens.current).not.toBeNull();
    server.forceStatus.push({ status: 429, retryAfter: '17' });
    expect(await syncOnce(deps)).toMatchObject({ status: 'rate_limited', retryAfterSec: 17 });
    expect(await pendingCount(db)).toBe(1);
    expect((await syncOnce(deps)).status).toBe('ok');
  });

  it('pushes lift records mapped to the contract (no prev.prev.prev key) and a deleted lift as a tombstone', async () => {
    const { db, server, deps } = await setup();
    await saveLift(db, 'Barbell Bench Press', {
      date: '2026-10-08', sets: [{ w: 60, r: 8, rate: 'right' }], form: null, n: 3, first: '2026-10-01',
      prev: { date: '2026-10-05', sets: [{ w: 60, r: 7, rate: 'hard' }], form: 'yes', prev: { date: '2026-10-01', sets: [{ w: 60, r: 6, rate: 'fail' }], form: null } },
      hist: [{ date: '2026-10-08', e: 76 }], pbToast: null,
    });
    await deleteLift(db, 'Old lift', '2026-10-08T10:00:00Z');
    await syncOnce(deps);
    const lifts = server.pushed().filter((p) => p.table === 'lift_stats');
    const bench = lifts.find((l) => l.exercise === 'Barbell Bench Press') as Record<string, unknown>;
    expect(bench.id).toBe('d03da8fc-3a9f-5d42-830a-f841270004ef');
    expect(bench).toMatchObject({ sessions: 3, sets: [{ weight_kg: 60, reps: 8, rate: 'right' }], history: [{ date: '2026-10-08', score: 76 }], pb_toast_date: null });
    expect((bench.prev as { prev: Record<string, unknown> }).prev).not.toHaveProperty('prev');
    expect(lifts.find((l) => l.exercise === 'Old lift')).toMatchObject({ deleted_at: '2026-10-08T10:00:00Z' });
    expect(await getLiftVersion(db, 'Barbell Bench Press')).toBe(1);
    expect(await pendingCount(db)).toBe(0);
  });

  it('a set carries its workout id, and a pulled set finds its workout date', async () => {
    const { db, server, deps } = await setup();
    const wid = naturalId(USER, 'workouts', '2026-10-08');
    server.put('workouts', { id: wid, version: 1, updated_at: '2026-10-09T05:00:00Z', deleted_at: null, date: '2026-10-08', template: null, base: null, where: null, cardio_min: null, mods: {}, exercises: [], ci_choice: null });
    server.put('workout_sets', { id: 's1', version: 1, updated_at: '2026-10-09T05:00:00Z', deleted_at: null, workout_id: wid, exercise: 'Squat', kind: 'work', set_index: 0, weight_kg: 50, reps: 5, done: true, rate: null, t: null });
    await syncOnce(deps);
    expect(await db.getFirstAsync("SELECT key FROM workout_sets WHERE key = 's1' AND workout_date = '2026-10-08'")).not.toBeNull();
    expect(await pendingCount(db)).toBe(0);

    await db.runAsync('INSERT OR REPLACE INTO workout_sets (key, workout_date, kind, done, deleted, data) VALUES (?, ?, ?, ?, ?, ?)', 's2', '2026-10-08', 'work', 1, 0, JSON.stringify({ id: 's2', version: 0, updated_at: '2026-10-09T06:00:00Z', deleted_at: null, workout_id: null, exercise: 'Squat', kind: 'work', set_index: 1, weight_kg: 50, reps: 5, done: true, rate: null, t: null }));
    await syncOnce(deps);
    expect(server.pushed().find((p) => p.id === 's2')).toMatchObject({ workout_id: wid });
  });
});
