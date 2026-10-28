/** @jest-environment node */
import { buildLocalExport } from '../src/account/exportLocal';
import { applyRestore, parseRestore } from '../src/account/restoreLocal';
import { ROUTINE_LIMITS, RoutineError, createRoutine, deleteRoutine, loadRoutines, renameRoutine, undoDeleteRoutine, type RoutineExercise } from '../src/db/routines';
import { pendingChanges } from '../src/db/outbox';
import { wipeLocalStore } from '../src/sync/guard';
import { openDb } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
jest.mock('../src/photos/vault', () => ({ deleteKitchenPhoto: async () => undefined, wipePhotos: async () => undefined, announceWipe: () => undefined }));
jest.mock('../src/reminders/sync', () => ({ cancelReminders: async () => undefined }));

// The contract's vectors (packages/api/test-vectors/routines.json), read directly so they cannot drift.
type Rec = { name: string; exercises: RoutineExercise[] };
const vectors = require('../../../packages/api/test-vectors/routines.json') as { valid: { note: string; record: Rec }[]; invalid: { note: string; record: Rec }[] };

type Db = Awaited<ReturnType<typeof openDb>>;
const squat: RoutineExercise[] = [{ name: 'Squat', sets: 3 }, { name: 'Bench press', sets: 4 }];
const queue = async (db: Db) => (await pendingChanges(db)).filter((e) => e.tbl === 'routines');
const clear = (db: Db) => db.runAsync('DELETE FROM sync_outbox');
const T = (n: number) => new Date(`2026-10-29T10:00:${String(n).padStart(2, '0')}.000Z`);

describe('routines store (#1184)', () => {
  it('save, edit and delete each queue one entry for the routine', async () => {
    const db = await openDb();
    const r = await createRoutine(db, 'Upper A', squat, T(1));
    expect(await queue(db)).toEqual([expect.objectContaining({ tbl: 'routines', key: r.id })]);
    await clear(db);
    await renameRoutine(db, r.id as string, 'Upper B', T(2));
    expect(await queue(db)).toEqual([expect.objectContaining({ tbl: 'routines', key: r.id })]);
    await clear(db);
    await deleteRoutine(db, r.id as string, T(3));
    expect(await queue(db)).toHaveLength(1);
    expect(await loadRoutines(db)).toEqual([]);
    await clear(db);
    await undoDeleteRoutine(db, r.id as string, T(4));
    expect(await queue(db)).toHaveLength(1);
    expect((await loadRoutines(db)).map((x) => [x.id, x.name])).toEqual([[r.id, 'Upper B']]);
  });

  it('a new routine has a UUID, version 0, no deletion and equal created_at and updated_at', async () => {
    const db = await openDb();
    const r = await createRoutine(db, '  Legs ', squat, T(1));
    expect(r).toMatchObject({ name: 'Legs', version: 0, deleted_at: null, created_at: T(1).toISOString(), updated_at: T(1).toISOString() });
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(vectors.valid.map((v) => [v.note, v.record] as const))('accepts the contract vector: %s', async (_n, rec) => {
    const db = await openDb();
    await expect(createRoutine(db, rec.name, rec.exercises)).resolves.toMatchObject({ name: rec.name });
  });

  it.each(vectors.invalid.map((v) => [v.note, v.record] as const))('refuses the contract vector before writing: %s', async (_n, rec) => {
    const db = await openDb();
    await expect(createRoutine(db, rec.name, rec.exercises)).rejects.toBeInstanceOf(RoutineError);
    expect(await db.getAllAsync('SELECT key FROM routines')).toEqual([]);
    expect(await queue(db)).toEqual([]);
  });

  it('refuses the 101st live routine locally, writes nothing, and allows one after a delete', async () => {
    const db = await openDb();
    let last = '';
    for (let i = 0; i < ROUTINE_LIMITS.maxLive; i++) last = (await createRoutine(db, `R${i}`, squat, T(1))).id as string;
    await expect(createRoutine(db, 'one more', squat)).rejects.toMatchObject({ code: 'too_many' });
    expect(await db.getAllAsync('SELECT key FROM routines')).toHaveLength(100);
    await deleteRoutine(db, last, T(2));
    await expect(createRoutine(db, 'one more', squat)).resolves.toBeTruthy();
    await expect(undoDeleteRoutine(db, last)).rejects.toMatchObject({ code: 'too_many' }); // the revive counts as a new one
  });

  it('a rename keeps the exercises, including keys this app does not know', async () => {
    const db = await openDb();
    const r = await createRoutine(db, 'A', [{ name: 'Squat', sets: 3, group: 'ss1', note: null }], T(1));
    await renameRoutine(db, r.id as string, 'B', T(2));
    await deleteRoutine(db, r.id as string, T(3));
    await undoDeleteRoutine(db, r.id as string, T(4));
    expect((await loadRoutines(db))[0]).toMatchObject({ name: 'B', exercises: [{ name: 'Squat', sets: 3, group: 'ss1', note: null }] });
  });

  it('a repeated exercise name is dropped, the first stays', async () => {
    const db = await openDb();
    const r = await createRoutine(db, 'A', [{ name: 'Squat', sets: 3 }, { name: 'Squat', sets: 5 }]);
    expect(r.exercises).toEqual([{ name: 'Squat', sets: 3 }]);
  });

  it('a bad rename and a missing id write nothing', async () => {
    const db = await openDb();
    const r = await createRoutine(db, 'A', squat, T(1));
    await clear(db);
    await expect(renameRoutine(db, r.id as string, ' ​')).rejects.toMatchObject({ code: 'name' });
    await expect(renameRoutine(db, 'nope', 'X')).rejects.toMatchObject({ code: 'missing' });
    expect(await queue(db)).toEqual([]);
  });
});

describe('routines in the device export and restore', () => {
  it('the export holds live routines and tombstones in contract shape', async () => {
    const db = await openDb();
    const a = await createRoutine(db, 'A', squat, T(1));
    const b = await createRoutine(db, 'B', squat, T(2));
    await deleteRoutine(db, b.id as string, T(3));
    const { file } = await buildLocalExport(db);
    expect(file.tables.routines).toHaveLength(2);
    expect(file.tables.routines.find((x) => x.id === a.id)).toMatchObject({ name: 'A', deleted_at: null, exercises: squat });
    expect(file.tables.routines.find((x) => x.id === b.id)).toMatchObject({ deleted_at: T(3).toISOString() });
  });

  it('restore re-imports routines and tombstones, last writer wins, and queues them for sync', async () => {
    const src = await openDb();
    const a = await createRoutine(src, 'A', squat, T(1));
    const b = await createRoutine(src, 'B', squat, T(2));
    await deleteRoutine(src, b.id as string, T(3));
    // The file's records carry the versions a synced device would hold.
    const file = JSON.parse(JSON.stringify((await buildLocalExport(src)).file)) as { tables: { routines: { id: string; version: number }[] } };
    file.tables.routines.forEach((x) => (x.version = 2));
    const parsed = await parseRestore(JSON.stringify(file));

    const dst = await openDb();
    // The device already has a newer copy of A (version 3) and an older live copy of B (version 1): A is kept, B becomes a tombstone.
    await dst.runAsync('INSERT INTO routines (key, data) VALUES (?, ?)', a.id as string, JSON.stringify({ ...a, version: 3, name: 'A here' }));
    await dst.runAsync('INSERT INTO routines (key, data) VALUES (?, ?)', b.id as string, JSON.stringify({ ...b, version: 1, deleted_at: null }));
    await clear(dst);
    const summary = await applyRestore(dst, parsed, null);
    expect(summary.tables.routines).toMatchObject({ older: 1, newer: 1 });
    expect((await loadRoutines(dst)).map((x) => x.name)).toEqual(['A here']);
    expect((await queue(dst)).map((e) => e.key)).toEqual([b.id]);
  });

  it('refuses a routine row that is not a routine', async () => {
    const src = await openDb();
    await createRoutine(src, 'A', squat);
    const file = JSON.parse(JSON.stringify((await buildLocalExport(src)).file)) as { tables: { routines: { exercises: unknown }[] } };
    file.tables.routines[0]!.exercises = 'x';
    await expect(parseRestore(JSON.stringify(file))).rejects.toMatchObject({ code: 'bad_rows' });
  });
});

describe('routines on a fresh install, an upgrade and a device reset', () => {
  it('fresh install: the table exists, empty, nothing queued', async () => {
    const db = await openDb();
    expect(await loadRoutines(db)).toEqual([]);
    expect(await queue(db)).toEqual([]);
  });

  it('device reset wipes routines and their queue entries', async () => {
    const db = await openDb();
    await createRoutine(db, 'A', squat);
    expect(await wipeLocalStore(db, { force: true })).toBe(0);
    expect(await db.getAllAsync('SELECT key FROM routines')).toEqual([]);
    expect(await queue(db)).toEqual([]);
  });
});
