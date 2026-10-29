/** @jest-environment node */
import { buildLocalExport } from '../src/account/exportLocal';
import { readFileSync } from 'fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { resolve } from 'path';
import { CI_CHOICE, MODS_VALUE_MAX, SET_EXERCISE_MAX, SET_KIND, SET_RATE, TEXT_MAX, WHERE, applyRestore, parseRestore, previewRestore } from '../src/account/restoreLocal';
import { normalizeGroups, ROUTINE_EXERCISES_MAX, ROUTINE_MAX_LIVE, EXERCISE_NAME_MAX, ROUTINE_NAME_MAX, ROUTINE_SETS_MAX, ROUTINE_SETS_MIN } from '@plate-and-bar/core';
import { RoutineError, createRoutine, deleteRoutine, loadRoutines, renameRoutine, undoDeleteRoutine, type RoutineExercise } from '../src/db/routines';
import { pendingChanges } from '../src/db/outbox';
import { wipeLocalStore } from '../src/sync/guard';
import { RESTORE_COPY } from '../src/account/copy';
import { KEY_MAX, MAX_KEYS, VALUE_MAX, exerciseProblem, routineNameOk } from '../src/db/routineRules';
import { exclusive } from '../src/db/exclusive';
import { openDb } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
jest.mock('../src/photos/vault', () => ({ deleteKitchenPhoto: async () => undefined, wipePhotos: async () => undefined, announceWipe: () => undefined }));
jest.mock('../src/reminders/sync', () => ({ cancelReminders: async () => undefined }));

// The contract's vectors (packages/api/test-vectors/routines.json), read directly so they cannot drift.
type Rec = { name: string; exercises: RoutineExercise[] };
 
const groupVectors = require('../../../packages/api/test-vectors/exercise-group.json') as { valid: (string | null)[]; invalid: unknown[] };
 
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
    const r = await createRoutine(db, 'A', [{ name: 'Squat', sets: 3, group: 'ss1', note: null, tempo: 'slow' }, { name: 'Row', sets: 3, group: 'ss1' }], T(1));
    await renameRoutine(db, r.id as string, 'B', T(2));
    await deleteRoutine(db, r.id as string, T(3));
    await undoDeleteRoutine(db, r.id as string, T(4));
    expect((await loadRoutines(db))[0]).toMatchObject({ name: 'B', exercises: [{ name: 'Squat', sets: 3, group: 'ss1', note: null, tempo: 'slow' }, { name: 'Row', sets: 3, group: 'ss1' }] });
  });

  it.each(groupVectors.valid.map((g) => [JSON.stringify(g), g] as const))('exercise-group.json valid id %s is stored as given', async (_n, g) => {
    const db = await openDb();
    const r = await createRoutine(db, 'A', [{ name: 'Squat', sets: 3, group: g }, { name: 'Row', sets: 3, group: g }]);
    expect(r.exercises.map((e) => e.group)).toEqual([g, g]);
  });

  it.each(groupVectors.invalid.map((g) => [JSON.stringify(g), g] as const))('exercise-group.json invalid id %s is refused and nothing is written', async (_n, g) => {
    const db = await openDb();
    await expect(createRoutine(db, 'A', [{ name: 'Squat', sets: 3, group: g as string }, { name: 'Row', sets: 3, group: g as string }])).rejects.toMatchObject({ code: 'exercises' });
    expect(await loadRoutines(db)).toEqual([]);
  });

  it('a group that is not a valid run is dissolved to an explicit null; a valid one is kept', async () => {
    const db = await openDb();
    const one = await createRoutine(db, 'A', [{ name: 'Squat', sets: 3, group: 'ss1' }, { name: 'Row', sets: 3 }]);
    expect(one.exercises.map((e) => e.group)).toEqual([null, undefined]);
    const split = await createRoutine(db, 'B', [{ name: 'A', sets: 3, group: 'x' }, { name: 'B', sets: 3 }, { name: 'C', sets: 3, group: 'x' }]);
    expect(split.exercises.map((e) => e.group)).toEqual([null, undefined, null]);
    const deduped = await createRoutine(db, 'C', [{ name: 'A', sets: 3, group: 'x' }, { name: 'A', sets: 3, group: 'x' }, { name: 'B', sets: 3 }]);
    expect(deduped.exercises.map((e) => e.group)).toEqual([null, undefined]);
    const ok = await createRoutine(db, 'D', [{ name: 'A', sets: 3, group: 'x' }, { name: 'B', sets: 3, group: 'x' }]);
    expect(ok.exercises.map((e) => e.group)).toEqual(['x', 'x']);
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

  describe('restore validates routine and workout rows like the app does (#1336)', () => {
    type Ex = Record<string, unknown>;
    type Row = Record<string, unknown>;
    const G = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `E${i}`, sets: 3, group: 'big' }));
    const W = (e: Ex) => ({ name: 'Squat', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false, ...e });
    const DAYS = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
    /** A file built from a real export so every field not under test is valid. Row i of `routinesIn` overrides routine i; `workoutsIn` are the exercise lists of workouts, each with one set. */
    async function fileWith(routinesIn: Row[], workoutsIn: Ex[][] = [], top: Row = {}) {
      const src = await openDb();
      for (let i = 0; i < routinesIn.length; i++) await createRoutine(src, `r${i}`, squat, T(1));
      for (const [i, ex] of workoutsIn.entries()) {
        const day = DAYS[i] as string;
        await src.runAsync('INSERT INTO workouts (key, data) VALUES (?, ?)', day, JSON.stringify({ id: null, date: day, version: 1, updated_at: '2026-10-08T06:00:00.000Z', deleted_at: null, template: 'Upper A', base: 'Upper A', where: null, cardio_min: null, mods: {}, ci_choice: null, ...top, exercises: ex }));
        const sid = `5555555${i}-5555-4555-8555-555555555555`;
        await src.runAsync('INSERT INTO workout_sets (key, workout_date, kind, done, deleted, data) VALUES (?, ?, ?, ?, ?, ?)', sid, day, 'work', 0, 0, JSON.stringify({ id: sid, workout_id: null, version: 1, updated_at: '2026-10-08T06:00:00.000Z', deleted_at: null, exercise: 'Squat', kind: 'work', set_index: 0, weight_kg: null, reps: null, done: false, rate: null, t: null }));
      }
      const file = JSON.parse(JSON.stringify((await buildLocalExport(src)).file)) as { tables: { routines: Row[] } };
      for (const r of file.tables.routines) Object.assign(r, routinesIn[Number(String(r.name).slice(1))]);
      return JSON.stringify(file);
    }
    const restored = async (text: string) => {
      const dst = await openDb();
      const summary = await applyRestore(dst, await parseRestore(text), null);
      return { summary, dst, list: await loadRoutines(dst) };
    };
    const workoutExercises = async (db: Db, day: string) => (JSON.parse((await db.getFirstAsync<{ data: string }>('SELECT data FROM workouts WHERE key = ?', day))!.data) as { exercises: Ex[] }).exercises;

    // Rows are stored raw, so read them all, tombstones included: nothing invalid may be kept under any status.
    const storedRoutines = async (db: Db) => (await db.getAllAsync<{ data: string }>('SELECT data FROM routines')).map((r) => JSON.parse(r.data) as Row);
    const contractOk = (r: Row) => {
      const list = r.exercises as Ex[];
      return routineNameOk(r.name) && typeof r.created_at === 'string' && list.length >= 1 && list.length <= ROUTINE_EXERCISES_MAX
        && list.every((e) => exerciseProblem(e, false) === null) && normalizeGroups(list as never).every((e, i) => e.group === (list[i] as Ex).group || (e.group == null && (list[i] as Ex).group === undefined));
    };

    it.each(vectors.invalid.map((v) => [v.note, v.record] as const))('contract vector %s is skipped or repaired, never kept invalid', async (_n, rec) => {
      const { dst, summary } = await restored(await fileWith([rec as Row]));
      const kept = await storedRoutines(dst);
      expect(kept.every(contractOk)).toBe(true);
      const c = summary.tables.routines!;
      expect(kept.length + (c.invalid ?? 0)).toBe(1); // stored or counted as skipped
    });

    it.each(vectors.invalid.map((v) => [v.note, v.record] as const))('contract vector %s as a tombstone is skipped or repaired too', async (_n, rec) => {
      const { dst } = await restored(await fileWith([{ ...(rec as Row), deleted_at: '2026-10-09T01:00:00.000Z' }]));
      expect((await storedRoutines(dst)).every(contractOk)).toBe(true);
    });

    it.each<[string, Row]>([['exercises is a string', { exercises: 'x' }], ['exercises is missing', { exercises: undefined }], ['name is a number', { name: 5 }], ['name is missing', { name: undefined }]])(
      'a routine whose %s is skipped and counted, and the rest of the file restores',
      async (_n, bad) => {
        const { list, summary } = await restored(await fileWith([bad, {}]));
        expect(list.map((r) => r.name)).toEqual(['r1']);
        expect(summary.tables.routines).toMatchObject({ added: 1, invalid: 1 });
      },
    );

    it('a routine without created_at is skipped', async () => {
      const { list, summary } = await restored(await fileWith([{ created_at: undefined }]));
      expect(list).toHaveLength(0);
      expect(summary.tables.routines).toMatchObject({ added: 0, invalid: 1 });
    });

    it.each(['2026-10-29', 'Oct 29 2026', '2026', '2026-10-29T10:00:00', '2026-02-30T10:00:00Z'])('a routine with created_at %s is skipped (not an RFC 3339 date-time)', async (at) => {
      const { list, summary } = await restored(await fileWith([{ created_at: at }]));
      expect(list).toHaveLength(0);
      expect(summary.tables.routines).toMatchObject({ added: 0, invalid: 1 });
    });

    it('an exercise key name of 51 characters is refused by createRoutine and skips the restored row; 50 passes', async () => {
      await expect(createRoutine(await openDb(), 'R', [{ name: 'Squat', sets: 3, ['k'.repeat(51)]: 1 }], T(1))).rejects.toMatchObject({ code: 'exercises' });
      await expect(createRoutine(await openDb(), 'R', [{ name: 'Squat', sets: 3, ['k'.repeat(50)]: 1 }], T(1))).resolves.toBeTruthy();
      const { list, summary } = await restored(await fileWith([{ exercises: [{ name: 'Squat', sets: 3, ['k'.repeat(51)]: 1 }] }, { exercises: [{ name: 'Squat', sets: 3, ['k'.repeat(50)]: 1 }] }]));
      expect(list).toHaveLength(1);
      expect(summary.tables.routines).toMatchObject({ added: 1, invalid: 1 });
    });

    it('the unlisted-value limit that bounds an exercise name is the exercise name limit', () => {
      expect(VALUE_MAX).toBe(EXERCISE_NAME_MAX);
    });

    it('an exercise name of 201 code points is skipped; 200 passes', async () => {
      const { list, summary } = await restored(await fileWith([{ exercises: [{ name: '🏋'.repeat(201), sets: 3 }] }, { exercises: [{ name: '🏋'.repeat(200), sets: 3 }] }]));
      expect(list).toHaveLength(1);
      expect(summary.tables.routines).toMatchObject({ added: 1, invalid: 1 });
    });

    it('a bad group id is dropped to null, the row is kept and counted as repaired', async () => {
      const { list, summary } = await restored(await fileWith([{ exercises: [{ name: 'Squat', sets: 3, group: 'bad id!' }, { name: 'Bench press', sets: 3, group: 'bad id!' }] }]));
      expect(list[0]!.exercises.map((e) => e.group)).toEqual([null, null]);
      expect(summary.tables.routines).toMatchObject({ added: 1, repaired: 1 });
      expect(summary.tables.routines!.invalid).toBeUndefined();
    });

    it('an oversize group keeps the first members and dissolves the rest', async () => {
      const { list, summary } = await restored(await fileWith([{ exercises: G(8) }]));
      expect(list[0]!.exercises.map((e) => e.group ?? null)).toEqual(['big', 'big', 'big', 'big', 'big', 'big', null, null]);
      expect(summary.tables.routines!.repaired).toBe(1);
    });

    it('an out-of-range set count is clamped and counted as repaired; one that is not an integer skips the row', async () => {
      const { list, summary } = await restored(await fileWith([{ exercises: [{ name: 'Squat', sets: 99 }, { name: 'Bench press', sets: 0 }] }, { exercises: [{ name: 'Squat', sets: 2.5 }] }, { exercises: [{ name: 'Squat', sets: '3' }] }]));
      expect(list).toHaveLength(1);
      expect(list[0]!.exercises.map((e) => e.sets)).toEqual([ROUTINE_SETS_MAX, ROUTINE_SETS_MIN]);
      expect(summary.tables.routines).toMatchObject({ added: 1, invalid: 2, repaired: 1 });
    });

    it('a valid row is stored unchanged and is not counted as repaired', async () => {
      const ex = [{ name: 'Squat', sets: 3, group: 'ss-1' }, { name: 'Bench press', sets: 4, group: 'ss-1' }, { name: 'Row', sets: 3, group: null }, { name: 'Curl', sets: 2, note: 'x' }];
      const { list, summary } = await restored(await fileWith([{ exercises: ex }]));
      expect(list[0]!.exercises).toEqual(ex);
      expect(summary.tables.routines).toMatchObject({ added: 1 });
      expect(summary.tables.routines!.invalid).toBeUndefined();
      expect(summary.tables.routines!.repaired).toBeUndefined();
    });

    it('duplicate exercise names are kept: the server accepts them', async () => {
      const { list } = await restored(await fileWith([{ exercises: [{ name: 'Squat', sets: 3 }, { name: 'Squat', sets: 3 }] }]));
      expect(list[0]!.exercises).toHaveLength(2);
    });

    it('a mix of good and bad rows stores the good, repairs the fixable and reports both counts', async () => {
      const text = await fileWith([
        { exercises: [{ name: 'Squat', sets: 3 }] },
        { exercises: [{ name: 'Squat', sets: 3, group: '??' }, { name: 'Bench press', sets: 3 }] },
        { exercises: [] },
        { exercises: Array.from({ length: ROUTINE_EXERCISES_MAX + 1 }, (_, i) => ({ name: `E${i}`, sets: 3 })) },
        { exercises: [{ name: '  ', sets: 3 }] },
      ]);
      const preview = await previewRestore(await openDb(), await parseRestore(text), null);
      expect(preview.tables.routines).toMatchObject({ added: 2, invalid: 3, repaired: 1 });
      const { list, summary } = await restored(text);
      expect(list.map((r) => r.name).sort()).toEqual(['r0', 'r1']);
      expect(summary.tables.routines).toMatchObject({ added: 2, invalid: 3, repaired: 1 });
      const line = RESTORE_COPY.table('Routines', summary.tables.routines!);
      expect(line).toContain('3 skipped (not valid)');
      expect(line).toContain('1 repaired');
    });

    it('a workout with bad exercise fields is repaired to the contract and counted; a valid one is untouched', async () => {
      const { dst, summary } = await restored(await fileWith([], [[W({ part: 3 }), W({ name: 'Bench', bridge: undefined, form: 'maybe', found_kg: 'x', skip_ramp: 1, feel: 'huh' })], [W({ name: 'Row', part: 2, form: 'yes', feel: '3' })]]));
      expect(await workoutExercises(dst, DAYS[0] as string)).toEqual([W({ part: 1 }), W({ name: 'Bench', feel: null })]);
      expect(await workoutExercises(dst, DAYS[1] as string)).toEqual([W({ name: 'Row', part: 2, form: 'yes', feel: '3' })]);
      expect(summary.tables.workouts).toMatchObject({ added: 2, repaired: 1 });
    });

    it('a workout group that is invalid or oversize is repaired, not refused', async () => {
      const { dst } = await restored(await fileWith([], [[...G(8).map(W), W({ name: 'Z', group: 'bad id!' })]]));
      expect((await workoutExercises(dst, DAYS[0] as string)).map((e) => e.group ?? null)).toEqual(['big', 'big', 'big', 'big', 'big', 'big', null, null, null]);
    });

    it('an unrepairable workout is skipped with its sets, reported, and the rest of the file is restored', async () => {
      const text = await fileWith([{ exercises: [{ name: 'Squat', sets: 3 }] }], [[W({ name: 'x'.repeat(201) })], Array.from({ length: 51 }, (_, i) => W({ name: `E${i}` })), [W({ name: 'ok' })], [W({ extra: { a: 1 } })]]);
      const { dst, summary, list } = await restored(text);
      expect(summary.tables.workouts).toMatchObject({ added: 1, invalid: 3 });
      expect(summary.tables.workout_sets).toMatchObject({ added: 1, invalid: 3 });
      expect((await dst.getAllAsync('SELECT key FROM workouts')).length).toBe(1);
      expect(list).toHaveLength(1);
    });

    it('a workout exercise that would pass 20 keys once its missing required keys are added is skipped', async () => {
      const extras = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, 1]));
      const { dst, summary } = await restored(await fileWith([], [[{ name: 'Squat', part: 1, ...extras }]]));
      expect(await dst.getAllAsync('SELECT key FROM workouts')).toHaveLength(0);
      expect(summary.tables.workouts).toMatchObject({ invalid: 1 });
    });

    it('workout fields outside the contract are set to null and counted; valid ones stay', async () => {
      const bad = { template: 't'.repeat(201), base: 5, where: 'home', cardio_min: -1, ci_choice: 'x' };
      const { dst, summary } = await restored(await fileWith([], [[W({})], [W({})]], bad));
      const row = JSON.parse((await dst.getFirstAsync<{ data: string }>('SELECT data FROM workouts WHERE key = ?', DAYS[0] as string))!.data) as Row;
      expect(row).toMatchObject({ template: null, base: null, where: null, cardio_min: null, ci_choice: null });
      expect(summary.tables.workouts).toMatchObject({ added: 2, repaired: 2 });
      const ok = await restored(await fileWith([], [[W({})]], { template: 'Push', base: null, where: 'gym', cardio_min: 20, ci_choice: 'swap', mods: { light: true, reentry: 0.3 } }));
      expect(ok.summary.tables.workouts!.repaired).toBeUndefined();
      expect(JSON.parse((await ok.dst.getFirstAsync<{ data: string }>('SELECT data FROM workouts'))!.data)).toMatchObject({ template: 'Push', where: 'gym', cardio_min: 20, ci_choice: 'swap', mods: { light: true, reentry: 0.3 } });
    });

    it('workout fields at their limits stay: 200 code point text, 20 mods keys, a 50 character mods string; a non-numeric cardio_min and 201 code points are nulled', async () => {
      const mods = { ...Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`k${i}`, 1])), note: 'n'.repeat(50) };
      const ok = await restored(await fileWith([], [[W({})]], { template: '🏋'.repeat(200), mods }));
      expect(ok.summary.tables.workouts).toMatchObject({ added: 1 });
      expect(ok.summary.tables.workouts!.repaired).toBeUndefined();
      const bad = await restored(await fileWith([], [[W({})]], { template: '🏋'.repeat(201), cardio_min: '20' }));
      expect(JSON.parse((await bad.dst.getFirstAsync<{ data: string }>('SELECT data FROM workouts'))!.data)).toMatchObject({ template: null, cardio_min: null });
    });

    it('a fractional cardio_min is rounded, not lost, and counted as repaired', async () => {
      const { dst, summary } = await restored(await fileWith([], [[W({})]], { cardio_min: 12.5 }));
      expect(JSON.parse((await dst.getFirstAsync<{ data: string }>('SELECT data FROM workouts'))!.data)).toMatchObject({ cardio_min: 13 });
      expect(summary.tables.workouts).toMatchObject({ added: 1, repaired: 1 });
    });

    it('a mods key of 50 emoji is within the limit (code points, as the contract counts) and the workout is kept', async () => {
      const { dst, summary } = await restored(await fileWith([], [[W({})]], { mods: { ['🏋'.repeat(50)]: 1 } }));
      expect(await dst.getAllAsync('SELECT key FROM workouts')).toHaveLength(1);
      expect(summary.tables.workouts!.invalid).toBeUndefined();
    });

    it('the limits typed in the app match openapi.yaml', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { load } = require('js-yaml') as { load: (s: string) => { components: { schemas: Record<string, Record<string, unknown>> } } };
      const schemas = load(readFileSync(resolve(__dirname, '../../../packages/api/openapi.yaml'), 'utf8')).components.schemas;
      type Obj = Record<string, any>;
      const workout = (schemas.Workout as Obj).allOf[1].properties as Obj;
      const wex = schemas.WorkoutExercise as Obj;
      const rex = schemas.RoutineExercise as Obj;
      for (const s of [wex, rex]) {
        expect(s.maxProperties).toBe(MAX_KEYS);
        expect(s.propertyNames.maxLength).toBe(KEY_MAX);
        expect(s.additionalProperties.maxLength).toBe(VALUE_MAX);
      }
      expect(workout.mods.maxProperties).toBe(MAX_KEYS);
      expect(workout.mods.propertyNames.maxLength).toBe(KEY_MAX);
      expect(workout.mods.additionalProperties.maxLength).toBe(MODS_VALUE_MAX);
      expect(workout.mods.properties.where.enum).toEqual(WHERE);
      expect(workout.where.enum.filter((x: unknown) => x !== null)).toEqual(WHERE);
      expect(workout.ci_choice.enum.filter((x: unknown) => x !== null)).toEqual(CI_CHOICE);
      expect(workout.template.maxLength).toBe(TEXT_MAX);
      expect(workout.base.maxLength).toBe(TEXT_MAX);
      expect(workout.mods.properties.reentry).toMatchObject({ minimum: 0, maximum: 1 });
      expect((wex.properties as Obj).group.maxLength).toBe(36);
      expect(workout.exercises.maxItems).toBe(ROUTINE_EXERCISES_MAX);
      const set = (schemas.WorkoutSet as Obj).allOf[1].properties as Obj;
      expect(set.exercise.maxLength).toBe(SET_EXERCISE_MAX);
      expect(set.kind.enum).toEqual(SET_KIND);
      expect(set.rate.enum.filter((x: unknown) => x !== null)).toEqual(SET_RATE);
      expect(set.rate.enum).toContain(null);
      expect(set.set_index).toMatchObject({ type: 'integer', minimum: 0 });
      expect(set.weight_kg).toMatchObject({ type: ['number', 'null'], minimum: 0 });
      expect(set.reps).toMatchObject({ type: ['integer', 'null'], minimum: 0 });
      expect(set.weight_kg.maximum).toBeUndefined(); // no upper bound to clamp to
      expect(set.reps.maximum).toBeUndefined();
      expect(set.done.type).toBe('boolean');
    });

    describe('workout sets (#1360)', () => {
      const SID = (n: number) => `6666666${n}-6666-4666-8666-666666666666`;
      /** A file with workout 0 and `sets` as its sets: each is a good set with these fields overridden (undefined removes a field). */
      async function setsFile(sets: Row[], tombstone = false) {
        const file = JSON.parse(await fileWith([], [[W({})]])) as { tables: { workout_sets: Row[] } };
        const base = file.tables.workout_sets[0] as Row;
        file.tables.workout_sets = sets.map((o, i) => {
          const r: Row = { ...base, id: SID(i), set_index: i, ...(tombstone ? { deleted_at: '2026-10-09T01:00:00.000Z' } : {}), ...o };
          for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
          return r;
        });
        return JSON.stringify(file);
      }
      const keptSets = async (db: Db) => (await db.getAllAsync<{ data: string }>('SELECT data FROM workout_sets ORDER BY key')).map((r) => JSON.parse(r.data) as Row);
      const good = { weight_kg: 60, reps: 5, done: true, rate: 'right', t: '2026-10-08T06:30:00.000Z' };

      it('a valid set is kept untouched and not counted as repaired', async () => {
        const { dst, summary } = await restored(await setsFile([good]));
        expect((await keptSets(dst))[0]).toMatchObject(good);
        expect(summary.tables.workout_sets).toMatchObject({ added: 1 });
        expect(summary.tables.workout_sets!.repaired).toBeUndefined();
        expect(summary.tables.workout_sets!.invalid).toBeUndefined();
      });

      it.each([
        ['missing rate and t become null', { ...good, rate: undefined, t: undefined }, { rate: null, t: null }],
        ['an unknown rate becomes null', { ...good, rate: 'medium' }, { rate: null }],
        ['a rate of the wrong type becomes null', { ...good, rate: 3 }, { rate: null }],
        ['a t that is not a string becomes null', { ...good, t: 5 }, { t: null }],
        ['missing weight_kg and reps become null', { ...good, weight_kg: undefined, reps: undefined }, { weight_kg: null, reps: null }],
        ['weight_kg and reps of the wrong type become null', { ...good, weight_kg: '60', reps: '5' }, { weight_kg: null, reps: null }],
        ['a negative weight_kg becomes null', { ...good, weight_kg: -2.5 }, { weight_kg: null }],
        ['a negative reps becomes null', { ...good, reps: -1 }, { reps: null }],
        ['a fractional reps is rounded', { ...good, reps: 7.6 }, { reps: 8 }],
        ['a missing deleted_at becomes null', { ...good, deleted_at: undefined }, { deleted_at: null }],
      ])('%s, counted as repaired', async (_n, over, expected) => {
        const { dst, summary } = await restored(await setsFile([over]));
        expect((await keptSets(dst))[0]).toMatchObject(expected);
        expect(summary.tables.workout_sets).toMatchObject({ added: 1, repaired: 1 });
        expect(summary.tables.workout_sets!.invalid).toBeUndefined();
      });

      it.each([
        ['no exercise', { exercise: undefined }],
        ['an empty exercise', { exercise: '' }],
        ['a numeric exercise', { exercise: 4 }],
        ['an exercise of 201 code points', { exercise: '🏋'.repeat(201) }],
        ['an unknown kind', { kind: 'warmup' }],
        ['a kind that is not a string', { kind: 3 }],
        ['no kind', { kind: undefined }],
        ['a done that is not a boolean', { done: 'yes' }],
        ['no done', { done: undefined }],
        ['no set_index', { set_index: undefined }],
        ['a negative set_index', { set_index: -1 }],
        ['a fractional set_index', { set_index: 1.5 }],
        ['a string set_index', { set_index: '1' }],
      ])('skipped and counted: %s', async (_n, over) => {
        const { dst, summary } = await restored(await setsFile([good, { ...good, ...over }]));
        expect(await keptSets(dst)).toHaveLength(1);
        expect(summary.tables.workout_sets).toMatchObject({ added: 1, invalid: 1 });
      });

      it('an exercise of 200 code points and set_index 0 are at the limits and stay', async () => {
        const { dst, summary } = await restored(await setsFile([{ ...good, exercise: '🏋'.repeat(SET_EXERCISE_MAX), set_index: 0 }]));
        expect(await keptSets(dst)).toHaveLength(1);
        expect(summary.tables.workout_sets!.invalid).toBeUndefined();
      });

      it('a mix of good and bad sets: good kept, repairable repaired, the rest skipped, with counts in the summary line', async () => {
        const text = await setsFile([good, { ...good, rate: 'x' }, { ...good, kind: 'nope' }, { ...good, weight_kg: -1, reps: 2.2 }, { ...good, exercise: '' }]);
        const preview = await previewRestore(await openDb(), await parseRestore(text), null);
        expect(preview.tables.workout_sets).toMatchObject({ added: 3, invalid: 2, repaired: 2 });
        const { dst, summary } = await restored(text);
        expect(summary.tables.workout_sets).toMatchObject({ added: 3, invalid: 2, repaired: 2 });
        expect(await keptSets(dst)).toHaveLength(3);
        const line = RESTORE_COPY.table('Sets', summary.tables.workout_sets!);
        expect(line).toContain('2 skipped (not valid)');
        expect(line).toContain('2 repaired');
      });

      it('tombstones follow the same rules', async () => {
        const { dst, summary } = await restored(await setsFile([{ ...good, rate: undefined }, { ...good, kind: 'nope' }, good], true));
        expect(summary.tables.workout_sets).toMatchObject({ added: 2, invalid: 1, repaired: 1 });
        expect((await keptSets(dst)).every((r) => typeof r.deleted_at === 'string')).toBe(true);
      });

      it('sets of a skipped workout are still dropped and counted once', async () => {
        const text = JSON.parse(await fileWith([], [[W({ name: 'x'.repeat(201) })]])) as { tables: { workout_sets: Row[] } };
        text.tables.workout_sets[0]!.kind = 'nope'; // would be skipped on its own too
        const { summary } = await restored(JSON.stringify(text));
        expect(summary.tables.workout_sets).toMatchObject({ added: 0, invalid: 1 });
      });

      // Every kept set is checked against the real contract schema.
      it('every kept set (repaired ones too, tombstones too) validates against WorkoutSet in openapi.yaml', async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { load } = require('js-yaml') as { load: (s: string) => object };
        const ajv = new Ajv2020({ strict: false, allErrors: true });
        addFormats(ajv);
        ajv.addSchema(load(readFileSync(resolve(__dirname, '../../../packages/api/openapi.yaml'), 'utf8')), 'openapi.json');
        const validate = ajv.getSchema('openapi.json#/components/schemas/WorkoutSet')!;
        const bad = [{ ...good, rate: undefined, t: undefined }, { ...good, weight_kg: -3, reps: -4.5 }, { ...good, weight_kg: 'x', reps: 'y', rate: 'z' }, { ...good, deleted_at: undefined }, { ...good, kind: 'ramp', t: null }];
        for (const tomb of [false, true]) {
          const { dst } = await restored(await setsFile([good, ...bad], tomb));
          const kept = await keptSets(dst);
          expect(kept).toHaveLength(bad.length + 1);
          for (const r of kept) {
            validate(r);
            expect(validate.errors ?? []).toEqual([]);
          }
        }
      });
    });

    it.each([['missing', undefined], ['not an object', 'x'], ['reentry 5', { reentry: 5 }], ['light not boolean', { light: 'yes' }], ['where not allowed', { where: 'home' }], ['key of 51 characters', { ['k'.repeat(51)]: 1 }], ['a nested object', { a: { b: 1 } }], ['21 keys', Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 1]))], ['a string value of 51 characters', { note: 'n'.repeat(51) }]])('a workout whose mods is %s is skipped with its sets and counted', async (_n, mods) => {
      const { dst, summary } = await restored(await fileWith([], [[W({})]], { mods }));
      expect(await dst.getAllAsync('SELECT key FROM workouts')).toHaveLength(0);
      expect(summary.tables.workouts).toMatchObject({ added: 0, invalid: 1 });
      expect(summary.tables.workout_sets).toMatchObject({ added: 0, invalid: 1 });
    });

    it('a workout tombstone with a bad exercise is repaired or skipped like a live row', async () => {
      const text = JSON.parse(await fileWith([], [[W({ part: 3 })]])) as { tables: { workouts: Row[] } };
      text.tables.workouts[0]!.deleted_at = '2026-10-09T01:00:00.000Z';
      const { dst } = await restored(JSON.stringify(text));
      expect((await workoutExercises(dst, DAYS[0] as string))[0]).toMatchObject({ part: 1 });
    });
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

  it('enforces the limits exported by core, at the boundary', async () => {
    const db = await openDb();
    const ex = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Lift ${i}`, sets: 3 }));
    await expect(createRoutine(db, 'n'.repeat(ROUTINE_NAME_MAX), squat)).resolves.toBeDefined();
    await expect(createRoutine(db, 'n'.repeat(ROUTINE_NAME_MAX + 1), squat)).rejects.toMatchObject({ code: 'name' });
    await expect(createRoutine(db, 'Many', ex(ROUTINE_EXERCISES_MAX))).resolves.toBeDefined();
    await expect(createRoutine(db, 'Many', ex(ROUTINE_EXERCISES_MAX + 1))).rejects.toMatchObject({ code: 'exercises' });
    await expect(createRoutine(db, 'Sets', [{ name: 'Squat', sets: ROUTINE_SETS_MIN }])).resolves.toBeDefined();
    await expect(createRoutine(db, 'Sets', [{ name: 'Squat', sets: ROUTINE_SETS_MIN - 1 }])).rejects.toMatchObject({ code: 'sets' });
    await expect(createRoutine(db, 'Sets', [{ name: 'Squat', sets: ROUTINE_SETS_MAX }])).resolves.toBeDefined();
    await expect(createRoutine(db, 'Sets', [{ name: 'Squat', sets: ROUTINE_SETS_MAX + 1 }])).rejects.toMatchObject({ code: 'sets' });
    await expect(createRoutine(db, 'Ex', [{ name: 'x'.repeat(EXERCISE_NAME_MAX), sets: 3 }])).resolves.toBeDefined();
    await expect(createRoutine(db, 'Ex', [{ name: 'x'.repeat(EXERCISE_NAME_MAX + 1), sets: 3 }])).rejects.toMatchObject({ code: 'exercises' });
  });

  it('caps live routines at ROUTINE_MAX_LIVE', async () => {
    const db = await openDb();
    for (let i = 0; i < ROUTINE_MAX_LIVE; i++) await createRoutine(db, `D${i}`, squat, T(1));
    await expect(createRoutine(db, 'One more', squat)).rejects.toMatchObject({ code: 'too_many' });
  });

  it('the over-limit copy states the contract limit of 100', () => {
    expect(RESTORE_COPY.table('Routines', { added: 0, newer: 0, older: 0, conflicts: 0, overCap: 1 })).toContain('(over the limit of 100)');
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
