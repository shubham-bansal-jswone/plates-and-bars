/** @jest-environment node */
import { buildLocalExport } from '../src/account/exportLocal';
import { MAX_RESTORE_BYTES, RestoreError, applyRestore, parseRestore, previewRestore } from '../src/account/restoreLocal';
import { saveCycle, loadCycle } from '../src/db/cycle';
import { loadReports, saveReport } from '../src/db/labs';
import { pendingCount } from '../src/db/outbox';
import { openDb } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

type Db = Awaited<ReturnType<typeof openDb>>;
const meta = { version: 2, updated_at: '2026-10-08T06:00:00.000Z', deleted_at: null };
const food = (id: string, over: object = {}) => ({ ...meta, id, date: '2026-10-08', meal: 'Lunch', name: 'Dal', qty: 1, kcal: 150, protein_g: 8, carbs_g: 20, fat_g: 3, food_id: null, ...over });
const putFood = (db: Db, d: ReturnType<typeof food>) => db.runAsync('INSERT OR REPLACE INTO food_logs (key, log_date, data) VALUES (?, ?, ?)', d.id, d.date, JSON.stringify(d));
const rows = async (db: Db, table: string) => db.getAllAsync<{ key: string; data: string }>(`SELECT key, data FROM ${table} ORDER BY key`);
const clearQueue = (db: Db) => db.runAsync('DELETE FROM sync_outbox');

async function seed(db: Db) {
  await putFood(db, food('f1'));
  await putFood(db, food('f2', { name: 'Rice' }));
  await putFood(db, food('f3', { deleted_at: '2026-10-09T01:00:00.000Z', name: 'gone' }));
  await db.runAsync('INSERT INTO weights (key, data) VALUES (?, ?)', '2026-10-08', JSON.stringify({ ...meta, id: null, date: '2026-10-08', weight_kg: 80 }));
  await db.runAsync('INSERT INTO workouts (key, data) VALUES (?, ?)', '2026-10-08', JSON.stringify({ ...meta, id: null, date: '2026-10-08' }));
  await db.runAsync('INSERT INTO workout_sets (key, workout_date, kind, done, deleted, data) VALUES (?, ?, ?, ?, ?, ?)', 's1', '2026-10-08', 'work', 0, 0, JSON.stringify({ ...meta, id: 's1', workout_id: null, kind: 'work' }));
  await db.runAsync('INSERT INTO lift_stats (key, data) VALUES (?, ?)', 'Squat', JSON.stringify({ deleted_at: '2026-10-09T02:00:00.000Z' }));
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
    expect(before.tables.lift_stats[0]).toMatchObject({ deleted_at: '2026-10-09T02:00:00.000Z' });
    await wipe(db);
    expect((await snapshot(db)).tables.food_logs).toHaveLength(0);
    const parsed = await parseRestore(text);
    await applyRestore(db, parsed, null);
    expect(await snapshot(db)).toEqual(before);
    expect(await pendingCount(db)).toBeGreaterThan(0); // rows go through the sync queue
  });

  it('on a non-empty device keeps newer local rows, applies newer file rows, adds missing ones and counts them', async () => {
    const db = await openDb();
    await putFood(db, food('f1', { version: 5, name: 'local newer' }));
    await putFood(db, food('f2', { version: 1, name: 'local older' }));
    await clearQueue(db);
    const other = await openDb();
    await putFood(other, food('f1', { version: 3, name: 'file older' }));
    await putFood(other, food('f2', { version: 4, name: 'file newer' }));
    await putFood(other, food('f9', { name: 'file only' }));
    const parsed = await parseRestore(await exportText(other));
    const preview = await previewRestore(db, parsed, null);
    expect(preview.tables.food_logs).toEqual({ added: 1, newer: 1, older: 1, conflicts: 0, same: 0 });
    expect(await rows(db, 'food_logs')).toHaveLength(2); // preview wrote nothing
    await applyRestore(db, parsed, null);
    const names = Object.fromEntries((await rows(db, 'food_logs')).map((r) => [r.key, (JSON.parse(r.data) as { name: string }).name]));
    expect(names).toEqual({ f1: 'local newer', f2: 'file newer', f9: 'file only' });
  });

  it('keeps a local row with an unsynced edit, and a newer tombstone in the file deletes', async () => {
    const db = await openDb();
    await putFood(db, food('f1', { version: 1, name: 'edited here' })); // queued by the trigger
    await putFood(db, food('f2'));
    await clearQueue(db);
    await putFood(db, food('f1', { version: 1, name: 'edited here' }));
    const other = await openDb();
    await putFood(other, food('f1', { version: 9, name: 'file' }));
    await putFood(other, food('f2', { version: 3, deleted_at: '2026-10-10T00:00:00.000Z' }));
    const s = await applyRestore(db, await parseRestore(await exportText(other)), null);
    expect(s.tables.food_logs).toMatchObject({ conflicts: 1, newer: 1 });
    const byKey = Object.fromEntries((await rows(db, 'food_logs')).map((r) => [r.key, JSON.parse(r.data) as Record<string, unknown>]));
    expect(byKey.f1?.name).toBe('edited here');
    expect(byKey.f2?.deleted_at).toBe('2026-10-10T00:00:00.000Z');
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
