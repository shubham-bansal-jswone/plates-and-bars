/** @jest-environment node */
import { buildRecord } from '../src/sync/records';
import { buildLocalExport } from '../src/account/exportLocal';
import { MAX_RESTORE_BYTES, RestoreError, applyRestore, parseRestore, previewRestore } from '../src/account/restoreLocal';
import { saveCycle, loadCycle } from '../src/db/cycle';
import { loadReports, saveReport } from '../src/db/labs';
import { pendingCount } from '../src/db/outbox';
import { setLiftVersion } from '../src/sync/store';
import { openDb } from './sync-helpers';

const mockDeletePhoto = jest.fn(async (_id: string) => undefined);
jest.mock('../src/photos/vault', () => ({ deleteKitchenPhoto: (id: string) => mockDeletePhoto(id) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

type Db = Awaited<ReturnType<typeof openDb>>;
const F1 = '11111111-1111-4111-8111-111111111111';
const F2 = '22222222-2222-4222-8222-222222222222';
const F9 = '99999999-9999-4999-8999-999999999999';
const meta = { version: 2, updated_at: '2026-10-08T06:00:00.000Z', deleted_at: null };
const food = (id: string, over: object = {}) => ({ ...meta, id, date: '2026-10-08', meal: 'Lunch', name: 'Dal', qty: 1, kcal: 150, protein_g: 8, carbs_g: 20, fat_g: 3, food_id: null, ...over });
const putFood = (db: Db, d: ReturnType<typeof food>) => db.runAsync('INSERT OR REPLACE INTO food_logs (key, log_date, data) VALUES (?, ?, ?)', d.id, d.date, JSON.stringify(d));
const rows = async (db: Db, table: string) => db.getAllAsync<{ key: string; data: string }>(`SELECT key, data FROM ${table} ORDER BY key`);
type Tables = Record<string, Record<string, unknown>[]>;
const clearQueue = (db: Db) => db.runAsync('DELETE FROM sync_outbox');

async function seed(db: Db) {
  await putFood(db, food('11111111-1111-4111-8111-111111111111'));
  await putFood(db, food('22222222-2222-4222-8222-222222222222', { name: 'Rice' }));
  await putFood(db, food('33333333-3333-4333-8333-333333333333', { deleted_at: '2026-10-09T01:00:00.000Z', name: 'gone' }));
  await db.runAsync('INSERT INTO weights (key, data) VALUES (?, ?)', '2026-10-08', JSON.stringify({ ...meta, id: null, date: '2026-10-08', weight_kg: 80 }));
  await db.runAsync('INSERT INTO workouts (key, data) VALUES (?, ?)', '2026-10-08', JSON.stringify({ ...meta, id: null, date: '2026-10-08', exercises: [] }));
  await db.runAsync('INSERT INTO workout_sets (key, workout_date, kind, done, deleted, data) VALUES (?, ?, ?, ?, ?, ?)', '55555555-5555-4555-8555-555555555555', '2026-10-08', 'work', 0, 0, JSON.stringify({ ...meta, id: '55555555-5555-4555-8555-555555555555', workout_id: null, kind: 'work', done: false }));
  await db.runAsync('INSERT INTO lift_stats (key, data) VALUES (?, ?)', 'Squat', JSON.stringify({ deleted_at: '2026-10-09T02:00:00.000Z' }));
  await db.runAsync('INSERT INTO lift_stats (key, data) VALUES (?, ?)', 'Bench', JSON.stringify({ date: '2026-10-05', sets: [{ w: 60, r: 5 }], form: null, n: 1, first: 60, prev: null, hist: [{ date: '2026-10-05', e: 70 }], pbToast: null }));
  await setLiftVersion(db, 'Bench', 2);
  await saveCycle(db, { on: true, starts: ['2026-10-01'], len: 28 });
  await saveReport(db, { id: 'r1', date: '2026-10-02', tests: [{ name: 'Iron', value: '12', unit: 'g', low: '10', high: '15' }] });
}
/** What a new export would contain: every table in contract shape (ids filled in), tombstones and device-only data. */
const snapshot = async (db: Db) => {
  const { file } = await buildLocalExport(db);
  return { tables: file.tables, device_only: file.device_only };
};
const exportText = async (db: Db) => JSON.stringify((await buildLocalExport(db)).file);
const wipe = async (db: Db) => {
  for (const t of ['food_logs', 'weights', 'workout_sets', 'workouts', 'lift_stats', 'cycle_log', 'lab_store']) await db.runAsync(`DELETE FROM ${t}`);
  await clearQueue(db);
};

describe('restore from an export file (#1177)', () => {
  it('round trip: export, wipe, restore gives the same data, tombstones and device-only data, and queues it', async () => {
    const db = await openDb();
    await seed(db);
    const text = await exportText(db);
    const before = await snapshot(db);
    expect(before.tables.lift_stats.find((r) => r.exercise === 'Squat')).toMatchObject({ deleted_at: '2026-10-09T02:00:00.000Z' });
    await wipe(db);
    expect((await snapshot(db)).tables.food_logs).toHaveLength(0);
    const parsed = await parseRestore(text);
    await applyRestore(db, parsed, null);
    expect(await snapshot(db)).toEqual(before);
    expect(await pendingCount(db)).toBeGreaterThan(0); // rows go through the sync queue
  });

  it('on a non-empty device keeps newer local rows, applies newer file rows, adds missing ones and counts them', async () => {
    const db = await openDb();
    await putFood(db, food('11111111-1111-4111-8111-111111111111', { version: 5, name: 'local newer' }));
    await putFood(db, food('22222222-2222-4222-8222-222222222222', { version: 1, name: 'local older' }));
    await clearQueue(db);
    const other = await openDb();
    await putFood(other, food('11111111-1111-4111-8111-111111111111', { version: 3, name: 'file older' }));
    await putFood(other, food('22222222-2222-4222-8222-222222222222', { version: 4, name: 'file newer' }));
    await putFood(other, food('99999999-9999-4999-8999-999999999999', { name: 'file only' }));
    const parsed = await parseRestore(await exportText(other));
    const preview = await previewRestore(db, parsed, null);
    expect(preview.tables.food_logs).toMatchObject({ added: 1, newer: 1, older: 1, conflicts: 0, same: 0 });
    expect(await rows(db, 'food_logs')).toHaveLength(2); // preview wrote nothing
    await applyRestore(db, parsed, null);
    const names = Object.fromEntries((await rows(db, 'food_logs')).map((r) => [r.key, (JSON.parse(r.data) as { name: string }).name]));
    expect(names).toEqual({ '11111111-1111-4111-8111-111111111111': 'local newer', '22222222-2222-4222-8222-222222222222': 'file newer', '99999999-9999-4999-8999-999999999999': 'file only' });
  });

  it('keeps a local row with an unsynced edit, and a newer tombstone in the file deletes', async () => {
    const db = await openDb();
    await putFood(db, food('11111111-1111-4111-8111-111111111111', { version: 1, name: 'edited here' })); // queued by the trigger
    await putFood(db, food('22222222-2222-4222-8222-222222222222'));
    await clearQueue(db);
    await putFood(db, food('11111111-1111-4111-8111-111111111111', { version: 1, name: 'edited here' }));
    const other = await openDb();
    await putFood(other, food('11111111-1111-4111-8111-111111111111', { version: 9, name: 'file' }));
    await putFood(other, food('22222222-2222-4222-8222-222222222222', { version: 3, deleted_at: '2026-10-10T00:00:00.000Z' }));
    const s = await applyRestore(db, await parseRestore(await exportText(other)), null);
    expect(s.tables.food_logs).toMatchObject({ conflicts: 1, newer: 1 });
    const byKey = Object.fromEntries((await rows(db, 'food_logs')).map((r) => [r.key, JSON.parse(r.data) as Record<string, unknown>]));
    expect(byKey['11111111-1111-4111-8111-111111111111']?.name).toBe('edited here');
    expect(byKey['22222222-2222-4222-8222-222222222222']?.deleted_at).toBe('2026-10-10T00:00:00.000Z');
  });

  it('device-only data is added only where this device has none', async () => {
    const db = await openDb();
    await saveCycle(db, { on: true, starts: ['2026-09-01'], len: 30 });
    const other = await openDb();
    await seed(other);
    await applyRestore(db, await parseRestore(await exportText(other)), null);
    expect((await loadCycle(db)).len).toBe(30);
    expect(await loadReports(db)).toHaveLength(1);
  });

  it('a restored lift stat keeps the file time in the queue, never the restore time', async () => {
    const other = await openDb();
    await seed(other);
    const text = await exportText(other);
    const file = JSON.parse(text) as { tables: { lift_stats: { exercise?: string; updated_at: string }[] } };
    const bench = file.tables.lift_stats.find((r) => r.exercise === 'Bench');
    expect(bench?.updated_at).toBe('2026-10-05T00:00:00.000Z'); // a live lift stat's time is its last session day
    const db = await openDb();
    await applyRestore(db, await parseRestore(text), null);
    const entries = await db.getAllAsync<{ tbl: 'lift_stats'; key: string; seq: number; queued_at: string }>("SELECT * FROM sync_outbox WHERE tbl = 'lift_stats' ORDER BY key");
    expect(entries.map((e) => e.queued_at)).toEqual(['2026-10-05T00:00:00.000Z', '2026-10-09T02:00:00.000Z']);
    const sent = await buildRecord(db, 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', entries[0] as never);
    expect(sent?.updated_at).toBe('2026-10-05T00:00:00.000Z');
  });

  it('restoring onto the same device reports nothing newer, lift stats included', async () => {
    const db = await openDb();
    await seed(db);
    await clearQueue(db);
    const s = await previewRestore(db, await parseRestore(await exportText(db)), null);
    for (const c of Object.values(s.tables)) expect(c.newer).toBe(0);
    expect(s.tables.lift_stats?.same).toBe(2);
  });

  it('a file from a different account only adds missing rows and never overwrites', async () => {
    const db = await openDb();
    await putFood(db, food(F1, { version: 1, name: 'mine' }));
    await clearQueue(db);
    const other = await openDb();
    await putFood(other, food(F1, { version: 9, name: 'theirs' }));
    await putFood(other, food(F9, { name: 'new' }));
    const file = JSON.parse(await exportText(other)) as Record<string, unknown>;
    const parsed = await parseRestore(JSON.stringify({ ...file, user_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }));
    const s = await applyRestore(db, parsed, 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d');
    expect(s.differentAccount).toBe(true);
    expect(s.tables.food_logs).toMatchObject({ added: 1, newer: 0, older: 1 });
    const names = (await rows(db, 'food_logs')).map((r) => (JSON.parse(r.data) as { name: string }).name).sort();
    expect(names).toEqual(['mine', 'new']);
  });

  it('a restored kitchen-test tombstone removes its photo; the preview gives the date range', async () => {
    const other = await openDb();
    const K = '44444444-4444-4444-8444-444444444444';
    await other.runAsync('INSERT INTO kitchen_tests (key, data) VALUES (?, ?)', K, JSON.stringify({ ...meta, id: K, deleted_at: '2026-10-09T01:00:00.000Z' }));
    await putFood(other, food(F1, { date: '2026-10-03' }));
    await putFood(other, food(F2, { date: '2026-10-07' }));
    const db = await openDb();
    const parsed = await parseRestore(await exportText(other));
    expect((await previewRestore(db, parsed, null)).tables.food_logs).toMatchObject({ from: '2026-10-03', to: '2026-10-07' });
    mockDeletePhoto.mockClear();
    await applyRestore(db, parsed, null);
    expect(mockDeletePhoto).toHaveBeenCalledWith(K);
  });

  describe('refused files write nothing', () => {
    const good = async () => JSON.parse(await exportText(await (async () => { const d = await openDb(); await seed(d); return d; })())) as Record<string, unknown> & { tables: Record<string, Record<string, unknown>[]> };
    const code = async (text: string) => (await parseRestore(text).then(() => null, (e: unknown) => e)) as RestoreError | null;

    it.each([
      ['not json', () => '{"format_version":', 'not_json'],
      ['a different shape', () => '[1,2]', 'bad_format'],
      ['the server export', () => JSON.stringify({ format_version: 1, user: {}, tables: {} }), 'bad_format'],
      ['oversized', () => 'x'.repeat(MAX_RESTORE_BYTES + 1), 'too_large'],
      ['a prototype key', () => '{"format_version":1,"source":"device","tables":{},"x":{"__proto__":{"a":1}}}', 'unsafe'],
    ])('%s', async (_n, text, expected) => {
      expect((await code(text()))?.code).toBe(expected);
    });

    it('unknown version, unknown table, malformed rows and bad timestamps', async () => {
      const g = await good();
      expect((await code(JSON.stringify({ ...g, format_version: 2 })))?.code).toBe('bad_version');
      expect((await code(JSON.stringify({ ...g, tables: { ...g.tables, evil: [] } })))?.code).toBe('bad_format');
      expect((await code(JSON.stringify({ ...g, tables: { ...g.tables, food_logs: [{ id: 5, version: 1, updated_at: 'x' }] } })))?.code).toBe('bad_rows');
      const badTime = { ...g.tables, food_logs: [{ ...g.tables.food_logs?.[0], updated_at: '2026-02-30T00:00:00.000Z' }] };
      expect((await code(JSON.stringify({ ...g, tables: badTime })))?.code).toBe('bad_rows');
      const orphan = { ...g.tables, workouts: [] };
      expect((await code(JSON.stringify({ ...g, tables: orphan })))?.code).toBe('bad_rows');
    });


    it.each([
      ['a workout key that is not a date', (t: Tables) => ({ ...t, workouts: [{ ...t.workouts?.[0], date: 'not-a-date' }] })],
      ['a food log without a date or a numeric qty', (t: Tables) => ({ ...t, food_logs: [{ ...t.food_logs?.[0], date: undefined, qty: 'lots' }] })],
      ['a food log id that is not a uuid', (t: Tables) => ({ ...t, food_logs: [{ ...t.food_logs?.[0], id: 'nope' }] })],
      ['a set without a boolean done', (t: Tables) => ({ ...t, workout_sets: [{ ...t.workout_sets?.[0], done: 'yes' }] })],
      ['a version past the server range', (t: Tables) => ({ ...t, food_logs: [{ ...t.food_logs?.[0], version: 2 ** 31 }] })],
      ['a lift stat without updated_at', (t: Tables) => ({ ...t, lift_stats: [{ ...t.lift_stats?.find((r) => r.exercise === 'Bench'), updated_at: undefined }] })],
      ['a live lift stat with sets that are not a list', (t: Tables) => ({ ...t, lift_stats: [{ ...t.lift_stats?.find((r) => r.exercise === 'Bench'), sets: 'x' }] })],
      ['a live lift stat with a bad date', (t: Tables) => ({ ...t, lift_stats: [{ ...t.lift_stats?.find((r) => r.exercise === 'Bench'), date: 'monday' }] })],
      ['an inherited table name', (t: Tables) => ({ ...t, toString: [] })],
    ])('%s', async (_n, bad) => {
      const g = await good();
      expect((await code(JSON.stringify({ ...g, tables: bad(g.tables) })))?.code).toBe('bad_rows'.replace('bad_rows', _n === 'an inherited table name' ? 'bad_format' : 'bad_rows'));
    });

    it('a failure part way rolls the whole restore back', async () => {
      const db = await openDb();
      const other = await openDb();
      await seed(other);
      const parsed = await parseRestore(await exportText(other));
      const real = db.runAsync;
      let n = 0;
      db.runAsync = async (sql: string, ...p: (string | number)[]) => {
        if (/INSERT OR REPLACE INTO (weights|lift_stats)/.test(sql) && ++n === 1) throw new Error('disk full');
        return real(sql, ...p);
      };
      await expect(applyRestore(db, parsed, null)).rejects.toThrow('disk full');
      db.runAsync = real;
      expect(await rows(db, 'food_logs')).toHaveLength(0);
      expect(await pendingCount(db)).toBe(0);
      expect(await loadReports(db)).toHaveLength(0);
    });
  });
});
