/** @jest-environment node */
import { buildLocalExport } from '../src/account/exportLocal';
import { applyRestore, parseRestore, previewRestore } from '../src/account/restoreLocal';
import { ROUTINE_EXERCISES_MAX, ROUTINE_MAX_LIVE, ROUTINE_NAME_MAX, ROUTINE_SETS_MAX } from '@plate-and-bar/core';
import { RoutineError, createRoutine, deleteRoutine, loadRoutines, renameRoutine, undoDeleteRoutine, type RoutineExercise } from '../src/db/routines';
import { pendingChanges } from '../src/db/outbox';
import { wipeLocalStore } from '../src/sync/guard';
import { RESTORE_COPY } from '../src/account/copy';
import { exclusive } from '../src/db/exclusive';
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
    for (let i = 0; i < ROUTINE_MAX_LIVE; i++) last = (await createRoutine(db, `R${i}`, squat, T(1))).id as string;
    await expect(createRoutine(db, 'one more', squat)).rejects.toMatchObject({ code: 'too_many' });
    expect(await db.getAllAsync('SELECT key FROM routines')).toHaveLength(100);
    await deleteRoutine(db, last, T(2));
    await expect(createRoutine(db, 'one more', squat)).resolves.toBeTruthy();
    await expect(undoDeleteRoutine(db, last)).rejects.toMatchObject({ code: 'too_many' }); // the revive counts as a new one
  });

  it('a row that is not JSON does not break create or undo (the count ignores it)', async () => {
    const db = await openDb();
    await db.runAsync("INSERT INTO routines (key, data) VALUES ('bad', 'not json')");
    const r = await createRoutine(db, 'A', squat, T(1));
    await deleteRoutine(db, r.id as string, T(2));
    await expect(undoDeleteRoutine(db, r.id as string, T(3))).resolves.toBeUndefined();
    expect((await loadRoutines(db)).map((x) => x.name)).toEqual(['A']);
  });

  it('two creates at 99 end at 100, never 101', async () => {
    const db = await openDb();
    for (let i = 0; i < 99; i++) await createRoutine(db, `R${i}`, squat, T(1));
    const res = await Promise.allSettled([createRoutine(db, 'X', squat), createRoutine(db, 'Y', squat)]);
    expect(res.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await loadRoutines(db)).toHaveLength(100);
  });

  it('two undos at 99 end at 100, never 101', async () => {
    const db = await openDb();
    for (let i = 0; i < 99; i++) await createRoutine(db, `R${i}`, squat, T(1));
    const ids: string[] = [];
    for (const n of ['A', 'B']) {
      const r = await createRoutine(db, n, squat, T(1));
      await deleteRoutine(db, r.id as string, T(2));
      ids.push(r.id as string);
    }
    const res = await Promise.allSettled(ids.map((id) => undoDeleteRoutine(db, id, T(3))));
    expect(res.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await loadRoutines(db)).toHaveLength(100);
  });

  it('a rename and a pull landing together both survive (no stale overwrite)', async () => {
    const db = await openDb();
    const r = await createRoutine(db, 'A', squat, T(1));
    const pull = exclusive(db, async (d) => {
      const row = await (d as typeof db).getFirstAsync<{ data: string }>('SELECT data FROM routines WHERE key = ?', r.id as string);
      await d.runAsync('INSERT OR REPLACE INTO routines (key, data) VALUES (?, ?)', r.id as string, JSON.stringify({ ...JSON.parse(row!.data), version: 5 }));
    });
    await Promise.all([renameRoutine(db, r.id as string, 'B', T(2)), pull]);
    expect((await loadRoutines(db))[0]).toMatchObject({ name: 'B', version: 5 });
  });

  it('renaming a deleted routine is refused and queues nothing', async () => {
    const db = await openDb();
    const r = await createRoutine(db, 'A', squat, T(1));
    await deleteRoutine(db, r.id as string, T(2));
    await clear(db);
    await expect(renameRoutine(db, r.id as string, 'B', T(3))).rejects.toMatchObject({ code: 'missing' });
    expect(await queue(db)).toEqual([]);
  });

  it('an exercise key whose value is undefined is dropped, as JSON does', async () => {
    const db = await openDb();
    const r = await createRoutine(db, 'A', [{ name: 'Squat', sets: 3, part: undefined } as unknown as RoutineExercise]);
    expect(r.exercises).toEqual([{ name: 'Squat', sets: 3 }]);
    expect('part' in r.exercises[0]!).toBe(false);
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

  it('restore does not take the live routines past 100: the first that fit are kept, the rest counted as over', async () => {
    const src = await openDb();
    for (let i = 0; i < 5; i++) await createRoutine(src, `S${i}`, squat, T(1));
    const file = JSON.parse(JSON.stringify((await buildLocalExport(src)).file)) as { tables: { routines: { version: number }[] } };
    const parsed = await parseRestore(JSON.stringify(file));
    const dst = await openDb();
    for (let i = 0; i < 98; i++) await createRoutine(dst, `D${i}`, squat, T(1));
    const preview = await previewRestore(dst, parsed, null);
    expect(preview.tables.routines).toMatchObject({ added: 2, overCap: 3 });
    const summary = await applyRestore(dst, parsed, null);
    expect(summary.tables.routines).toMatchObject({ added: 2, overCap: 3 });
    expect(await loadRoutines(dst)).toHaveLength(100);
    expect(RESTORE_COPY.table('Routines', summary.tables.routines!)).toContain(`3 skipped (over the limit of ${ROUTINE_MAX_LIVE})`);
  });

  it('restore still takes tombstones when the device is at 100', async () => {
    const src = await openDb();
    const a = await createRoutine(src, 'A', squat, T(1));
    await deleteRoutine(src, a.id as string, T(2));
    const parsed = await parseRestore(JSON.stringify((await buildLocalExport(src)).file));
    const dst = await openDb();
    for (let i = 0; i < 100; i++) await createRoutine(dst, `D${i}`, squat, T(1));
    expect((await applyRestore(dst, parsed, null)).tables.routines).toMatchObject({ added: 1 });
    expect(await loadRoutines(dst)).toHaveLength(100);
  });

  // A device at 100 and a file holding a newer tombstone of a live routine plus one new routine, in either file order.
  const atCapWith = async (order: 'new-first' | 'tombstone-first') => {
    const dst = await openDb();
    for (let i = 0; i < 100; i++) await createRoutine(dst, `D${i}`, squat, T(1));
    await clear(dst); // as if synced: no unsynced edit to conflict with
    const file = JSON.parse(JSON.stringify((await buildLocalExport(dst)).file)) as { tables: { routines: Record<string, unknown>[] } };
    const [first] = file.tables.routines as { id: string }[];
    const tomb = { ...first, version: 5, deleted_at: T(9).toISOString(), updated_at: T(9).toISOString() };
    const fresh = { ...first, id: '00000000-0000-4000-8000-00000000abcd', name: 'New', version: 0 };
    file.tables.routines = order === 'new-first' ? [fresh, tomb] : [tomb, fresh];
    const parsed = await parseRestore(JSON.stringify(file));
    return { dst, parsed };
  };

  it.each(['new-first', 'tombstone-first'] as const)('a tombstone frees a slot at 100 whatever the file order (%s)', async (order) => {
    const { dst, parsed } = await atCapWith(order);
    const summary = await applyRestore(dst, parsed, null);
    expect(summary.tables.routines).toMatchObject({ added: 1, newer: 1 });
    expect(summary.tables.routines!.overCap).toBeUndefined();
    expect(await loadRoutines(dst)).toHaveLength(100);
  });

  it('a routine already live on the device at 100 is applied as newer, not counted as new or skipped', async () => {
    const dst = await openDb();
    for (let i = 0; i < 100; i++) await createRoutine(dst, `D${i}`, squat, T(1));
    await clear(dst); // as if synced: no unsynced edit to conflict with
    const file = JSON.parse(JSON.stringify((await buildLocalExport(dst)).file)) as { tables: { routines: Record<string, unknown>[] } };
    file.tables.routines = [{ ...file.tables.routines[0], version: 5, name: 'Renamed', updated_at: T(9).toISOString() }];
    const summary = await applyRestore(dst, await parseRestore(JSON.stringify(file)), null);
    expect(summary.tables.routines).toMatchObject({ added: 0, newer: 1 });
    expect(summary.tables.routines!.overCap).toBeUndefined();
    expect((await loadRoutines(dst)).map((x) => x.name)).toContain('Renamed');
  });

  it('enforces the limits exported by core', async () => {
    const db = await openDb();
    await expect(createRoutine(db, 'n'.repeat(ROUTINE_NAME_MAX), squat)).resolves.toBeDefined();
    await expect(createRoutine(db, 'n'.repeat(ROUTINE_NAME_MAX + 1), squat)).rejects.toMatchObject({ code: 'name' });
    const many = Array.from({ length: ROUTINE_EXERCISES_MAX + 1 }, (_, i) => ({ name: `Lift ${i}`, sets: 3 }));
    await expect(createRoutine(db, 'Many', many)).rejects.toMatchObject({ code: 'exercises' });
    await expect(createRoutine(db, 'Sets', [{ name: 'Squat', sets: ROUTINE_SETS_MAX + 1 }])).rejects.toMatchObject({ code: 'sets' });
  });

  it('the over-limit copy takes its number from the routine limit', () => {
    expect(RESTORE_COPY.table('Routines', { added: 0, newer: 0, older: 0, conflicts: 0, overCap: 1 })).toContain(`(over the limit of ${ROUTINE_MAX_LIVE})`);
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
