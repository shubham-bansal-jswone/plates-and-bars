import { act, renderHook, waitFor } from '@testing-library/react-native';
import { loadLifts, loadSets, loadWorkout, saveLift, saveSet, saveWorkout } from '../src/db/workouts';
import { dayQueue } from '../src/workout/dayQueue';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { openDb } from './sync-helpers';

// Add set and Remove last set on a working exercise (prototype `addset`, `rmset`; #147).
jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

async function started() {
  const db = await openDb();
  const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify: jest.fn(), startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
  const view = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
  await waitFor(() => expect(view.result.current.day.ready).toBe(true));
  await act(async () => void (await view.result.current.start('Upper A', {}, null)));
  await act(async () => void (await dayQueue.current));
  return { db, ...view };
}
const settle = () => act(async () => void (await dayQueue.current));
const live = async (db: Awaited<ReturnType<typeof openDb>>, name: string, kind = 'work') =>
  (await loadSets(db, DATE)).filter((s) => s.exercise === name && s.kind === kind && !s.deleted_at);

describe('add and remove sets (#147)', () => {
  it('Add set copies the last set\'s weight with empty reps, on screen and stored', async () => {
    const { db, result } = await started();
    const name = result.current.day.exs[0]!.name;
    const before = result.current.day.exs[0]!.sets.length;
    await act(async () => result.current.editSet(0, 'work', before - 1, 'w', '42.5'));
    await act(async () => result.current.addSet(0));
    await settle();
    const rows = result.current.day.exs[0]!.sets;
    expect(rows).toHaveLength(before + 1);
    expect(rows[before]).toMatchObject({ w: '42.5', r: '', done: false });
    const stored = await live(db, name);
    expect(stored).toHaveLength(before + 1);
    expect(stored.find((s) => s.id === rows[before]!.id)).toMatchObject({ weight_kg: 42.5, reps: null, set_index: before });
  });

  it('two quick taps store both new sets', async () => {
    const { db, result } = await started();
    const name = result.current.day.exs[0]!.name;
    const before = result.current.day.exs[0]!.sets.length;
    await act(async () => {
      result.current.addSet(0);
      result.current.addSet(0);
    });
    await settle();
    const ids = result.current.day.exs[0]!.sets.map((r) => r.id);
    expect(ids).toHaveLength(before + 2);
    const stored = new Set((await live(db, name)).map((s) => s.id));
    expect(ids.every((id) => stored.has(id))).toBe(true);
  });

  it('Remove last set stores a tombstone, and the only set is never removed', async () => {
    const { db, result } = await started();
    const name = result.current.day.exs[0]!.name;
    const n = result.current.day.exs[0]!.sets.length;
    const lastId = result.current.day.exs[0]!.sets[n - 1]!.id;
    await act(async () => result.current.removeSet(0));
    await settle();
    expect(result.current.day.exs[0]!.sets).toHaveLength(n - 1);
    const all = await loadSets(db, DATE);
    expect(all.find((s) => s.id === lastId)?.deleted_at).toBeTruthy();
    for (let k = n - 1; k > 1; k--) await act(async () => result.current.removeSet(0));
    await act(async () => result.current.removeSet(0)); // one set left: refused
    await settle();
    expect(result.current.day.exs[0]!.sets).toHaveLength(1);
    expect(await live(db, name)).toHaveLength(1);
  });

  it('removing a ticked set recomputes the lift record from what is left', async () => {
    const { db, result } = await started();
    const name = result.current.day.exs[0]!.name;
    for (const j of [0, 1]) {
      await act(async () => result.current.editSet(0, 'work', j, 'w', '40'));
      await act(async () => result.current.editSet(0, 'work', j, 'r', '10'));
      await act(async () => result.current.tick(0, j));
    }
    await settle();
    expect((await loadLifts(db))[name]?.sets).toHaveLength(2);
    const n = result.current.day.exs[0]!.sets.length;
    for (let k = n; k > 2; k--) await act(async () => result.current.removeSet(0)); // drop the empty sets first
    await act(async () => result.current.removeSet(0)); // then the second ticked one
    await settle();
    expect((await loadLifts(db))[name]?.sets).toHaveLength(1);
  });

  it('two quick taps on Add ramp set store both ramp rows', async () => {
    const { db, result } = await started();
    const name = result.current.day.exs[0]!.name;
    await act(async () => result.current.rampStart(0));
    await settle();
    await act(async () => {
      result.current.rampAdd(0);
      result.current.rampAdd(0);
    });
    await settle();
    const ids = result.current.day.exs[0]!.ramp.map((r) => r.id);
    const stored = new Set((await live(db, name, 'ramp')).map((s) => s.id));
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(ids.every((id) => stored.has(id))).toBe(true);
  });
});

describe('queued writes find their exercise by name (#439)', () => {
  it('a tick queued before a can\'t-do removes the exercise above it lands on the right exercise and lift', async () => {
    const { db, result } = await started();
    const [first, second] = result.current.day.exs.map((e) => e.name);
    await act(async () => result.current.editSet(1, 'work', 0, 'w', '30'));
    await act(async () => result.current.editSet(1, 'work', 0, 'r', '10'));
    await settle();
    await act(async () => {
      result.current.tick(1, 0); // queued for the second exercise
      result.current.cant(0, { name: first!, reason: 'dislike', dur: 'today', scope: 'exercise', key: first! }, null); // removes the first
    });
    await settle();
    const done = (await loadSets(db, DATE)).filter((s) => s.done && !s.deleted_at);
    expect(done.map((s) => s.exercise)).toEqual([second]);
    const lifts = await loadLifts(db);
    expect(lifts[second!]?.sets).toHaveLength(1);
  });

  it('a tick queued before a can\'t-do swaps the exercise above it still lands on its own exercise', async () => {
    const { db, result } = await started();
    const [first, second] = result.current.day.exs.map((e) => e.name);
    await act(async () => result.current.editSet(1, 'work', 0, 'w', '30'));
    await act(async () => result.current.editSet(1, 'work', 0, 'r', '10'));
    await settle();
    await act(async () => {
      result.current.tick(1, 0);
      result.current.cant(0, { name: first!, reason: 'dislike', dur: 'today', scope: 'exercise', key: first! }, 'Dumbbell Bench Press');
    });
    await settle();
    expect(result.current.day.exs.map((e) => e.name)).toContain('Dumbbell Bench Press');
    const done = (await loadSets(db, DATE)).filter((s) => s.done && !s.deleted_at);
    expect(done.map((s) => s.exercise)).toEqual([second]);
    expect((await loadLifts(db))[second!]?.sets).toHaveLength(1);
    expect((await loadLifts(db))['Dumbbell Bench Press']).toBeUndefined();
  });
});

describe('add and remove exercises (#147)', () => {
  it('a failure between the exercise row and its sets stores neither, and both writes go through the transaction (#492)', async () => {
    const { db, result } = await started();
    const before = (await loadWorkout(db, DATE))!.exercises.map((e) => e.name);
    const nSets = (await loadSets(db, DATE)).length;
    const run = db.runAsync;
    const exclusive = db.withExclusiveTransactionAsync;
    let open = false;
    let leaked = false;
    // The transaction gets its own object; a write through `db` while it is open would hang on a device, so it throws here.
    db.runAsync = async (sql: string, ...p: (string | number)[]) => {
      if (open) {
        leaked = true;
        throw new Error('write outside the transaction');
      }
      return run(sql, ...p);
    };
    db.withExclusiveTransactionAsync = (task) => {
      open = true;
      const txn = { ...db, runAsync: async (sql: string, ...p: (string | number)[]) => {
        if (sql.includes('workout_sets')) throw new Error('disk full');
        return run(sql, ...p);
      } };
      return exclusive((raw) => task(txn as typeof raw)).finally(() => void (open = false));
    };
    await act(async () => void result.current.addExercise('Goblet Squat'));
    await settle();
    db.runAsync = run;
    db.withExclusiveTransactionAsync = exclusive;
    expect(leaked).toBe(false);
    expect((await loadWorkout(db, DATE))!.exercises.map((e) => e.name)).toEqual(before);
    expect(await loadSets(db, DATE)).toHaveLength(nSets);
  });

  it('Add exercise appends a library exercise with 3 blank sets in the last exercise\'s part; a name in the session is refused', async () => {
    const { db, result } = await started();
    const before = result.current.day.exs.map((e) => e.name);
    let ok = false;
    await act(async () => void (ok = result.current.addExercise('Goblet Squat')));
    await settle();
    expect(ok).toBe(true);
    const added = result.current.day.exs[result.current.day.exs.length - 1]!;
    expect(added).toMatchObject({ name: 'Goblet Squat', part: 1, form: null, ramp: [] });
    expect(added.sets).toHaveLength(3);
    expect(added.sets.every((r) => r.w === '' && r.r === '' && !r.done)).toBe(true);
    expect((await loadWorkout(db, DATE))!.exercises.map((e) => e.name)).toEqual([...before, 'Goblet Squat']);
    expect(await live(db, 'Goblet Squat')).toHaveLength(3);
    let again = true;
    await act(async () => void (again = result.current.addExercise(before[0]!)));
    expect(again).toBe(false);
    expect(result.current.day.exs).toHaveLength(before.length + 1);
  });

  it('an added exercise gets as many sets as its last session', async () => {
    const { db } = await started();
    await saveLift(db, 'Goblet Squat', { date: '2026-10-01', sets: Array.from({ length: 5 }, () => ({ w: 20, r: 10 })), prev: null });
    const { result: fresh } = await (async () => {
      const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify: jest.fn(), startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
      const v = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
      await waitFor(() => expect(v.result.current.day.ready).toBe(true));
      return v;
    })();
    await act(async () => void fresh.current.addExercise('Goblet Squat'));
    expect(fresh.current.day.exs.find((e) => e.name === 'Goblet Squat')!.sets).toHaveLength(5);
  });

  it('after a second session is added, an added exercise joins it (part 2)', async () => {
    const { result } = await started();
    await act(async () => void (await result.current.addSecond('Lower A')));
    await settle();
    expect(result.current.day.exs.some((e) => e.part === 2)).toBe(true);
    await act(async () => void result.current.addExercise('Plank (seconds)'));
    expect(result.current.day.exs.find((e) => e.name === 'Plank (seconds)')?.part).toBe(2);
  });

  it('Remove exercise tombstones its rows, drops it from the workout and recomputes its lift', async () => {
    const { db, result } = await started();
    const name = result.current.day.exs[0]!.name;
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '40'));
    await act(async () => result.current.editSet(0, 'work', 0, 'r', '10'));
    await act(async () => result.current.tick(0, 0));
    await settle();
    expect((await loadLifts(db))[name]).toBeTruthy();
    await act(async () => void result.current.removeExercise(name));
    await settle();
    expect(result.current.day.exs.map((e) => e.name)).not.toContain(name);
    expect(await live(db, name)).toHaveLength(0);
    expect((await loadWorkout(db, DATE))!.exercises.map((e) => e.name)).not.toContain(name);
    expect((await loadLifts(db))[name]).toBeUndefined(); // its only session was this one
  });

  it('removing the last exercise deletes today\'s workout so a new session can start', async () => {
    const { db, result } = await started();
    for (const e of [...result.current.day.exs]) await act(async () => void result.current.removeExercise(e.name));
    await settle();
    expect(result.current.day.workout).toBeNull();
    expect((await loadWorkout(db, DATE))!.deleted_at).toBeTruthy();
    await act(async () => void (await result.current.start('Lower A', {}, null)));
    await settle();
    expect((await loadWorkout(db, DATE))!.deleted_at ?? null).toBeNull();
    expect(result.current.day.exs.length).toBeGreaterThan(0);
  });

  it('a removal after the stored workout changed elsewhere does not bring the exercise back (#410 merge)', async () => {
    const { db, result } = await started();
    const name = result.current.day.exs[1]!.name;
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, cardio_min: 20, updated_at: '2026-10-08T09:30:00Z' }); // a pull changed the row
    await act(async () => void result.current.removeExercise(name));
    await settle();
    const stored = (await loadWorkout(db, DATE))!;
    expect(stored.exercises.map((e) => e.name)).not.toContain(name);
    expect(stored.cardio_min).toBe(20);
  });

  it('Remove tombstones the exercise\'s rows a pull stored that the screen never loaded', async () => {
    const { db, result } = await started();
    const name = result.current.day.exs[0]!.name;
    const any = (await live(db, name))[0]!;
    await saveSet(db, DATE, { ...any, id: 'pulled-row', set_index: 9 });
    await act(async () => void result.current.removeExercise(name));
    await settle();
    expect(await live(db, name)).toHaveLength(0);
  });

  it('removing the last exercise keeps exercises another device added meanwhile', async () => {
    const { db, result } = await started();
    const all = [...result.current.day.exs];
    for (const e of all.slice(0, -1)) await act(async () => void result.current.removeExercise(e.name));
    await settle();
    // Now another device adds an exercise, then this device removes what it sees as the last one.
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, exercises: [...w.exercises, { name: 'Plank (seconds)', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }], updated_at: '2026-10-08T09:30:00Z' });
    expect(result.current.day.exs).toHaveLength(1);
    await act(async () => void result.current.removeExercise(all[all.length - 1]!.name));
    await settle();
    const stored = (await loadWorkout(db, DATE))!;
    expect(stored.deleted_at ?? null).toBeNull();
    expect(stored.exercises.map((e) => e.name)).toEqual(['Plank (seconds)']);
    await waitFor(() => expect(result.current.day.exs.map((e) => e.name)).toEqual(['Plank (seconds)']));
  });

  it('Start never overwrites a live session stored meanwhile; it shows it instead', async () => {
    const { db, result } = await started();
    const all = [...result.current.day.exs];
    for (const e of all.slice(0, -1)) await act(async () => void result.current.removeExercise(e.name));
    await settle();
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, exercises: [...w.exercises, { name: 'Plank (seconds)', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }], updated_at: '2026-10-08T09:30:00Z' });
    await act(async () => {
      void result.current.removeExercise(all[all.length - 1]!.name); // the screen now shows no session
      void result.current.start('Lower A', {}, null); // and Start is tapped before the kept row is read again
    });
    await settle();
    expect((await loadWorkout(db, DATE))!.exercises.map((e) => e.name)).toEqual(['Plank (seconds)']);
    await waitFor(() => expect(result.current.day.exs.map((e) => e.name)).toEqual(['Plank (seconds)']));
  });

  it('removing an exercise that is not in the session does nothing and says so', async () => {
    const { result } = await started();
    let ok = true;
    await act(async () => void (ok = result.current.removeExercise('Not an exercise')));
    expect(ok).toBe(false);
  });

  it('a can\'t-do on the screen after an exercise was added elsewhere keeps it (#444)', async () => {
    const { db, result } = await started();
    const first = result.current.day.exs[0]!.name;
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, exercises: [...w.exercises, { name: 'Plank (seconds)', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }], updated_at: '2026-10-08T09:30:00Z' });
    await act(async () => result.current.cant(0, { name: first, reason: 'dislike', dur: 'today', scope: 'exercise', key: first }, 'Dumbbell Bench Press'));
    await settle();
    const names = (await loadWorkout(db, DATE))!.exercises.map((e) => e.name);
    expect(names).toContain('Plank (seconds)');
    expect(names).toContain('Dumbbell Bench Press');
    expect(names).not.toContain(first);
    await waitFor(() => expect(result.current.day.exs.map((e) => e.name)).toContain('Plank (seconds)'));
  });

  it('a can\'t-do pick that another device added meanwhile keeps its sets, not doubled (#446)', async () => {
    const { db, result } = await started();
    const first = result.current.day.exs[0]!.name;
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, exercises: [...w.exercises, { name: 'Dumbbell Bench Press', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }], updated_at: '2026-10-08T09:30:00Z' });
    const mine = (await loadSets(db, DATE))[0]!;
    const theirs = [0, 1, 2].map((k) => ({ ...mine, id: `other-${k}`, exercise: 'Dumbbell Bench Press', kind: 'work' as const, set_index: k, version: 1, deleted_at: null }));
    for (const r of theirs) await saveSet(db, DATE, r);
    await act(async () => result.current.cant(0, { name: first, reason: 'dislike', dur: 'today', scope: 'exercise', key: first }, 'Dumbbell Bench Press'));
    await settle();
    expect((await live(db, 'Dumbbell Bench Press')).map((s) => s.id).sort()).toEqual(['other-0', 'other-1', 'other-2']);
    await waitFor(() => expect(result.current.day.exs.find((e) => e.name === 'Dumbbell Bench Press')?.sets).toHaveLength(3));
  });

  it('a can\'t-do pick that another device added writes no blank sets when that device\'s sets are not pulled yet (#459)', async () => {
    const { db, result } = await started();
    const first = result.current.day.exs[0]!.name;
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, exercises: [...w.exercises, { name: 'Dumbbell Bench Press', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }], updated_at: '2026-10-08T09:30:00Z' });
    await act(async () => result.current.cant(0, { name: first, reason: 'dislike', dur: 'today', scope: 'exercise', key: first }, 'Dumbbell Bench Press'));
    await settle();
    expect(await live(db, 'Dumbbell Bench Press')).toHaveLength(0);
  });

  it('a can\'t-do pick that no other device added still gets its sets when another exercise was added elsewhere (#459 guard)', async () => {
    const { db, result } = await started();
    const first = result.current.day.exs[0]!.name;
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, exercises: [...w.exercises, { name: 'Plank (seconds)', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }], updated_at: '2026-10-08T09:30:00Z' });
    await act(async () => result.current.cant(0, { name: first, reason: 'dislike', dur: 'today', scope: 'exercise', key: first }, 'Dumbbell Bench Press'));
    await settle();
    expect((await live(db, 'Dumbbell Bench Press')).length).toBeGreaterThanOrEqual(3);
  });

  it('a can\'t-do pick whose other-device sets are all tombstoned shows no live sets (#459 trade-off)', async () => {
    const { db, result } = await started();
    const first = result.current.day.exs[0]!.name;
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, exercises: [...w.exercises, { name: 'Dumbbell Bench Press', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }], updated_at: '2026-10-08T09:30:00Z' });
    const mine = (await loadSets(db, DATE))[0]!;
    for (const k of [0, 1, 2]) await saveSet(db, DATE, { ...mine, id: `gone-${k}`, exercise: 'Dumbbell Bench Press', kind: 'work' as const, set_index: k, version: 2, deleted_at: '2026-10-08T09:31:00Z' });
    await act(async () => result.current.cant(0, { name: first, reason: 'dislike', dur: 'today', scope: 'exercise', key: first }, 'Dumbbell Bench Press'));
    await settle();
    expect(await live(db, 'Dumbbell Bench Press')).toHaveLength(0);
  });

  it('two can\'t-do swaps in a row: the second replaces the first in place (#445 review)', async () => {
    const { db, result } = await started();
    const first = result.current.day.exs[0]!.name;
    const rest = result.current.day.exs.slice(1).map((e) => e.name);
    await act(async () => result.current.cant(0, { name: first, reason: 'dislike', dur: 'today', scope: 'exercise', key: first }, 'Dumbbell Bench Press'));
    await settle();
    await act(async () => result.current.cant(0, { name: 'Dumbbell Bench Press', reason: 'dislike', dur: 'today', scope: 'exercise', key: 'Dumbbell Bench Press' }, 'Push-ups'));
    await settle();
    expect((await loadWorkout(db, DATE))!.exercises.map((e) => e.name)).toEqual(['Push-ups', ...rest]);
    expect(result.current.day.exs.map((e) => e.name)).toEqual(['Push-ups', ...rest]);
  });

  it('a can\'t-do after the workout was deleted elsewhere keeps it deleted and the screen reloads to no session', async () => {
    const { db, result } = await started();
    const first = result.current.day.exs[0]!.name;
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, version: 4, deleted_at: '2026-10-09T09:59:00Z', updated_at: '2026-10-09T09:59:59Z' });
    await act(async () => result.current.cant(0, { name: first, reason: 'dislike', dur: 'today', scope: 'exercise', key: first }, 'Dumbbell Bench Press'));
    await settle();
    expect((await loadWorkout(db, DATE))!.deleted_at).toBe('2026-10-09T09:59:00Z');
    await waitFor(() => expect(result.current.day.workout).toBeNull());
  });
});

