/** @jest-environment node */
import { buildRecord, storeRecord, type Doc } from '../src/sync/records';
import { naturalId } from '../src/sync/ids';
import { loadSets, loadWorkout } from '../src/db/workouts';
import { loadDayNote } from '../src/db/food';
import { openDb } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const USER = '6f1c1f0e-5f0a-4c53-9a3e-0d3a0a2b9c11';
const at = '2026-10-08T08:00:00.000Z';
const entry = (tbl: 'day_notes' | 'workouts' | 'workout_sets' | 'weights' | 'settings' | 'profiles', key: string) => ({ tbl, key, seq: 1, queued_at: at });

describe('pulled rows keep their server ids (#939)', () => {
  it('a pulled day note and workout keep the server id and round-trip through buildRecord unchanged', async () => {
    const db = await openDb();
    const note: Doc = { id: await naturalId(USER, 'day_notes', '2026-10-08'), version: 3, updated_at: at, deleted_at: null, date: '2026-10-08', complete: null, steps: 4000, sleep: null, fast: false };
    const workout: Doc = {
      id: await naturalId(USER, 'workouts', '2026-10-08'), version: 2, updated_at: at, deleted_at: null, date: '2026-10-08', template: 'Upper A', base: 'Upper A',
      where: null, cardio_min: null, mods: { deload: false, light: false, reentry: 0, short: false, where: 'gym' }, exercises: [], ci_choice: null,
    };
    await storeRecord(db, 'day_notes', note, null);
    await storeRecord(db, 'workouts', workout, null);

    expect((await loadDayNote(db, '2026-10-08'))?.id).toBe(note.id);
    expect((await loadWorkout(db, '2026-10-08'))?.id).toBe(workout.id);
    expect(await buildRecord(db, USER, entry('day_notes', '2026-10-08'))).toEqual(note);
    expect(await buildRecord(db, USER, entry('workouts', '2026-10-08'))).toEqual(workout);
  });

  it('a pulled set keeps its workout_id, and a set made on the device gets the same one at push', async () => {
    const db = await openDb();
    const workoutId = await naturalId(USER, 'workouts', '2026-10-08');
    const set: Doc = { id: '0b8f7a1e-3c52-4d0e-8a57-5f2f6d1f6a10', version: 1, updated_at: at, deleted_at: null, workout_id: workoutId, exercise: 'Bench', kind: 'work', done: true };
    await storeRecord(db, 'workout_sets', set, '2026-10-08');
    expect((await loadSets(db, '2026-10-08'))[0]?.workout_id).toBe(workoutId);
    expect(await buildRecord(db, USER, entry('workout_sets', set.id as string))).toEqual(set);

    const local = { ...set, id: '1c9a8b2f-4d63-4e1f-9b68-6a3a7e2a7b21', workout_id: null };
    await storeRecord(db, 'workout_sets', local, '2026-10-08');
    expect(await buildRecord(db, USER, entry('workout_sets', local.id))).toEqual({ ...local, workout_id: workoutId });
  });

  it.each([
    ['weights', '2026-10-08', { date: '2026-10-08', weight_kg: 80 }],
    ['settings', 'me', { focus: [] }],
    ['profiles', 'me', { name: 'A' }],
  ] as const)('%s: the id is the natural-key id whether the local id is null or already the server id', async (tbl, key, fields) => {
    const db = await openDb();
    const id = await naturalId(USER, tbl, key);
    const base = { version: 1, updated_at: at, deleted_at: null, ...fields };
    await storeRecord(db, tbl, { ...base, id: null }, null);
    const fromNull = await buildRecord(db, USER, entry(tbl, key));
    await storeRecord(db, tbl, { ...base, id }, null);
    const fromServer = await buildRecord(db, USER, entry(tbl, key));
    expect(fromNull).toEqual({ ...base, id });
    expect(fromServer).toEqual(fromNull);
  });
});
