import { act, renderHook, waitFor } from '@testing-library/react-native';
import { loadLifts, loadSets, loadWorkout, saveLift, saveSet, saveWorkout } from '../src/db/workouts';
import { dayQueue } from '../src/workout/dayQueue';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import type { Workout } from '../src/workout/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { failInTxn, openDb } from './sync-helpers';

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

describe('workout row and sets are written together (#516)', () => {
  it('start: a failure writing the sets stores no workout row either', async () => {
    const db = await openDb();
    const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify: jest.fn(), startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
    const { result } = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
    await waitFor(() => expect(result.current.day.ready).toBe(true));
    const f = failInTxn(db, 'workout_sets');
    await act(async () => void (await result.current.start('Upper A', {}, null)));
    await settle();
    f.restore();
    expect(f.leaked()).toBe(false);
    expect(await loadWorkout(db, DATE)).toBeNull();
    expect(await loadSets(db, DATE)).toHaveLength(0);
  });

  it('addSecond: a failure writing the new sets leaves the workout row as it was', async () => {
    const { db, result } = await started();
    const before = await loadWorkout(db, DATE);
    const nSets = (await loadSets(db, DATE)).length;
    const f = failInTxn(db, 'workout_sets');
    await act(async () => void (await result.current.addSecond('Lower A')));
    await settle();
    f.restore();
    expect(f.leaked()).toBe(false);
    expect(await loadWorkout(db, DATE)).toEqual(before);
    expect(await loadSets(db, DATE)).toHaveLength(nSets);
  });

  it('removeExercise: a failure writing the workout row leaves the sets live', async () => {
    const { db, result } = await started();
    const name = result.current.day.exs[0]!.name;
    const before = await loadWorkout(db, DATE);
    const sets = await loadSets(db, DATE);
    const f = failInTxn(db, 'INTO workouts');
    await act(async () => void result.current.removeExercise(name));
    await settle();
    f.restore();
    expect(f.leaked()).toBe(false);
    expect(await loadWorkout(db, DATE)).toEqual(before);
    expect(await loadSets(db, DATE)).toEqual(sets);
  });
});

describe('a set tick writes the set and the workout row together (#545)', () => {
  // The workout row fails inside the transaction: the set written just before it must not stay.
  type Day = Awaited<ReturnType<typeof started>>['result']['current'];
  const failing = async (prep: (d: Day) => void, run: (d: Day) => void) => {
    const { db, result } = await started();
    await act(async () => prep(result.current));
    await settle();
    const before = await loadWorkout(db, DATE);
    const sets = await loadSets(db, DATE);
    const f = failInTxn(db, 'INTO workouts');
    await act(async () => run(result.current));
    await settle();
    f.restore();
    expect(f.leaked()).toBe(false);
    expect(await loadWorkout(db, DATE)).toEqual(before);
    expect(await loadSets(db, DATE)).toEqual(sets);
  };
  const ramp = (d: Day) => {
    d.rampStart(0);
    d.editSet(0, 'ramp', 0, 'w', '20');
  };

  it('tick: a failure writing the workout row leaves the set unticked in the store', async () => {
    await failing((d) => d.editSet(0, 'work', 0, 'w', '40'), (d) => d.tick(0, 0));
  });

  it('rampTick: a failure writing the workout row leaves the ramp set as it was', async () => {
    await failing(ramp, (d) => d.rampTick(0, 0));
  });

  it('rampRated: a failure writing the workout row leaves the ramp rows as they were', async () => {
    await failing(ramp, (d) => d.rampRated(0, 0, 'right'));
  });

  it('after addExercise fails on its sets, the next tick writes the screen as is (no merge against a row never stored)', async () => {
    const { db, result } = await started();
    const f = failInTxn(db, 'workout_sets');
    await act(async () => void result.current.addExercise('Goblet Squat'));
    await settle();
    f.restore();
    expect((await loadWorkout(db, DATE))!.exercises.map((e) => e.name)).not.toContain('Goblet Squat');
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '40'));
    await act(async () => result.current.tick(0, 0));
    await settle();
    expect((await loadWorkout(db, DATE))!.exercises.map((e) => e.name)).toEqual(result.current.day.exs.map((e) => e.name));
    expect(result.current.day.exs.map((e) => e.name)).toContain('Goblet Squat');
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

  it('removing a member of a two-exercise group dissolves it, stored with an explicit null (#1182)', async () => {
    const { db } = await started();
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, exercises: w.exercises.map((e, i) => (i < 2 ? { ...e, group: 'g1' } : e)), updated_at: '2026-10-08T09:30:00Z' });
    const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify: jest.fn(), startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
    const fresh = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
    await waitFor(() => expect(fresh.result.current.day.exs[0]?.group).toBe('g1'));
    const [a, b] = fresh.result.current.day.exs;
    await act(async () => void fresh.result.current.removeExercise(a!.name));
    await settle();
    expect(fresh.result.current.day.exs.find((e) => e.name === b!.name)?.group).toBeNull();
    expect((await loadWorkout(db, DATE))!.exercises.find((e) => e.name === b!.name)).toHaveProperty('group', null);
  });

  describe('the screen state carries the group, so an unrelated edit never writes a null (#1182)', () => {
    const grouped = async (n: number) => {
      const { db } = await started();
      const w = (await loadWorkout(db, DATE))!;
      await saveWorkout(db, { ...w, exercises: w.exercises.map((e, i) => (i < n ? { ...e, group: 'g1' } : e)), updated_at: '2026-10-08T09:30:00Z' });
      const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify: jest.fn(), startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
      const fresh = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
      await waitFor(() => expect(fresh.result.current.day.exs[0]?.group).toBe('g1'));
      return { db, result: fresh.result };
    };
    const stored = async (db: Awaited<ReturnType<typeof started>>['db']) => (await loadWorkout(db, DATE))!.exercises.map((e) => e.group ?? null);

    it('after a can\'t-do swap, removing an unrelated exercise keeps the group on every member', async () => {
      const { db, result } = await grouped(3);
      const first = result.current.day.exs[0]!.name;
      await act(async () => result.current.cant(0, { name: first, reason: 'dislike', dur: 'today', scope: 'exercise', key: first }, 'Dumbbell Bench Press'));
      await settle();
      expect(result.current.day.exs.slice(0, 3).map((e) => e.group)).toEqual(['g1', 'g1', 'g1']);
      const last = result.current.day.exs[result.current.day.exs.length - 1]!.name;
      await act(async () => void result.current.removeExercise(last));
      await settle();
      expect((await stored(db)).slice(0, 3)).toEqual(['g1', 'g1', 'g1']);
    });

    it('a group stored by a pull since the screen loaded is not wiped by an unrelated edit', async () => {
      const { db, result } = await started();
      const w = (await loadWorkout(db, DATE))!;
      await saveWorkout(db, { ...w, version: w.version + 1, exercises: w.exercises.map((e, i) => (i < 2 ? { ...e, group: 'g1' } : e)) });
      await act(async () => result.current.setForm(3, 'yes'));
      await settle();
      expect((await stored(db)).slice(0, 2)).toEqual(['g1', 'g1']);
    });
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

  it('an Add waiting on a Start whose COMMIT fails gives up (#864)', async () => {
    const db = await openDb();
    const notify = jest.fn();
    const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
    const { result } = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
    await waitFor(() => expect(result.current.day.ready).toBe(true));
    const exclusive = db.withExclusiveTransactionAsync;
    // The task runs fine and the COMMIT then fails: the error comes after the task has resolved.
    db.withExclusiveTransactionAsync = (async (task: Parameters<typeof exclusive>[0]) => {
      await exclusive(task);
      throw new Error('commit failed');
    }) as typeof exclusive;
    await act(async () => {
      void result.current.start('Upper A', {}, null);
      void result.current.addSecond('Lower A'); // tapped while Start is saving
    });
    await settle();
    expect(notify).not.toHaveBeenCalledWith('Lower A added to today');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('save'));
    expect(result.current.day.exs.map((e) => e.name)).not.toContain('Squat');
  });

  it('an Add waiting on a Start that finds a live session already stored applies to it (#864)', async () => {
    const db = await openDb();
    const notify = jest.fn();
    const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
    const { result } = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
    await waitFor(() => expect(result.current.day.ready).toBe(true));
    // Another device's session lands after the screen loaded: a server id, version 3, and one done set (version 2).
    const plank: Workout['exercises'][number] = { name: 'Plank (seconds)', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false };
    await saveWorkout(db, { id: 'srv-w1', version: 3, updated_at: '2026-10-08T09:30:00Z', deleted_at: null, date: DATE, template: 'Session', base: null, where: null, mods: {}, exercises: [plank], ci_choice: null, cardio_min: null } as unknown as Workout);
    const set = { id: 'srv-s1', version: 2, updated_at: '2026-10-08T09:31:00Z', deleted_at: null, workout_id: 'srv-w1', exercise: plank.name, kind: 'work', set_index: 0, weight_kg: null, reps: 30, done: true, rate: null, t: null } as unknown as Parameters<typeof saveSet>[2];
    await saveSet(db, DATE, set);
    await db.runAsync('DELETE FROM sync_outbox');
    await act(async () => {
      void result.current.start('Upper A', {}, null);
      void result.current.addSecond('Lower A');
      void result.current.addSecond('Lower A'); // a double tap adds once
    });
    await settle();
    expect(notify.mock.calls.filter(([m]) => m === 'Lower A added to today')).toHaveLength(1);
    const w = (await loadWorkout(db, DATE))!;
    const lower = (await loadSets(db, DATE)).filter((x) => x.exercise !== plank.name);
    const names = w.exercises.map((e) => e.name);
    expect(names[0]).toBe(plank.name);
    expect(names.slice(1)).toEqual([...new Set(lower.map((x) => x.exercise))]); // the Lower A exercises, once each
    expect(names.length).toBeGreaterThan(1);
    expect(w).toMatchObject({ id: 'srv-w1', version: 3 });
    const kept = (await loadSets(db, DATE)).find((x) => x.id === 'srv-s1');
    expect(kept).toMatchObject({ version: 2, done: true, reps: 30 });
    const queued = ((await db.getAllAsync('SELECT tbl, key FROM sync_outbox')) as { tbl: string; key: string }[]).map((r) => `${r.tbl}:${r.key}`);
    expect(queued).not.toContain('workout_sets:srv-s1');
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


// A tick queued against the local build that Start dropped for another device's session (#898).
describe('a write queued during Start, when Start adopts another device\'s session (#898)', () => {
  type Db = Awaited<ReturnType<typeof openDb>>;
  const outbox = async (db: Db) => (await db.getAllAsync<{ tbl: string; key: string }>('SELECT tbl, key FROM sync_outbox ORDER BY seq')).map((o) => `${o.tbl}:${o.key}`);
  const plank = { name: 'Plank (seconds)', part: 1 as const, bridge: false, form: null, found_kg: null, skip_ramp: false };

  /** Holds the day queue, presses Start and edits then ticks set 1 of the first exercise on the local build. */
  async function waiting(other: (local: string) => { exercises: (typeof plank)[]; sets: { exercise: string; id: string; set_index: number; done?: boolean; w?: number; r?: number }[] }, pullLater?: (db: Db) => Promise<void>) {
    const db = await openDb();
    const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify: jest.fn(), startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
    const view = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
    await waitFor(() => expect(view.result.current.day.ready).toBe(true));
    let release = () => {};
    dayQueue.current = dayQueue.current.then(() => new Promise<void>((r) => (release = r)));
    let started: Promise<unknown> = Promise.resolve();
    await act(async () => void (started = view.result.current.start('Upper A', {}, null)));
    await waitFor(() => expect(view.result.current.day.workout).not.toBeNull());
    const local = view.result.current.day.exs[0]!.name;
    const theirs = other(local);
    await act(async () => view.result.current.editSet(0, 'work', 0, 'w', '40'));
    await act(async () => view.result.current.editSet(0, 'work', 0, 'r', '8'));
    await act(async () => view.result.current.tick(0, 0));
    expect(view.result.current.day.exs[0]!.sets[0]!.done).toBe(true);
    // Another device's session lands (a pull): server id, version 3, its sets at version 2.
    const row = { id: 'srv-w1', version: 3, updated_at: '2026-10-08T09:30:00Z', deleted_at: null, date: DATE, template: 'Session', base: null, where: null, cardio_min: null, mods: {}, exercises: theirs.exercises, ci_choice: null };
    await saveWorkout(db, row as never);
    for (const s of theirs.sets) await saveSet(db, DATE, { id: s.id, version: 2, updated_at: '2026-10-08T09:30:00Z', deleted_at: null, workout_id: null, exercise: s.exercise, kind: 'work', set_index: s.set_index, weight_kg: s.w ?? null, reps: s.r ?? null, done: s.done ?? s.exercise === 'Plank (seconds)', rate: null, t: null } as never);
    await db.runAsync('DELETE FROM sync_outbox');
    let txns = 0;
    // The second transaction is the queued tick's (the first is Start's): a pull lands just before it.
    if (pullLater) db.beforeTxn = async () => void (++txns === 2 && (await pullLater(db)));
    await act(async () => {
      release();
      await started;
      await dayQueue.current;
    });
    return { db, local, ...view };
  }

  it('keeps the other device\'s session, id, version and sets; the tick on an exercise it lacks is dropped with no orphan sets', async () => {
    const { db, local, result } = await waiting(() => ({ exercises: [plank], sets: [{ exercise: 'Plank (seconds)', id: 'p1', set_index: 0 }] }));
    const w = (await loadWorkout(db, DATE)) as unknown as { id: string; version: number; exercises: { name: string }[] };
    expect(w.exercises.map((e) => e.name)).toEqual(['Plank (seconds)']);
    expect(w).toMatchObject({ id: 'srv-w1', version: 3 });
    const sets = (await loadSets(db, DATE)).filter((s) => !s.deleted_at);
    expect(sets.map((s) => `${s.exercise}:${s.id}:${s.version}:${s.done}`)).toEqual(['Plank (seconds):p1:2:true']); // no Upper A set, none orphaned
    expect(sets.some((s) => s.exercise === local)).toBe(false);
        // Nothing was carried, so the tick has nothing to save: no workout row, no set, no lift record is queued.
    expect(await outbox(db)).toEqual([]);
    await waitFor(() => expect(result.current.day.exs.map((e) => e.name)).toEqual(['Plank (seconds)']));
  });

  it('applies the tick to the matching set of the adopted session, keeping its ids and versions', async () => {
    let first = '';
    const { db, result } = await waiting((local) => {
      first = local;
      return { exercises: [{ ...plank, name: local }, plank], sets: [0, 1, 2].map((k) => ({ exercise: local, id: `f${k}`, set_index: k })).concat([{ exercise: 'Plank (seconds)', id: 'p1', set_index: 0 }]) };
    });
    const w = (await loadWorkout(db, DATE)) as unknown as { id: string; version: number; exercises: { name: string }[] };
    expect(w.exercises.map((e) => e.name)).toEqual([first, 'Plank (seconds)']);
    expect(w).toMatchObject({ id: 'srv-w1', version: 3 });
    const sets = (await loadSets(db, DATE)).filter((s) => !s.deleted_at);
    expect(sets.map((s) => s.id).sort()).toEqual(['f0', 'f1', 'f2', 'p1']);
    expect(sets.find((s) => s.id === 'f0')).toMatchObject({ weight_kg: 40, reps: 8, done: true, version: 2 });
    expect(sets.find((s) => s.id === 'f1')).toMatchObject({ done: false });
    expect(sets.find((s) => s.id === 'p1')).toMatchObject({ done: true, version: 2 });
    // The carried set, the workout row, and the lift record the tick updates; the other device's sets are not queued again.
    expect((await outbox(db)).sort()).toEqual([`lift_stats:${first}`, `workout_sets:f0`, `workouts:${DATE}`].sort());
    await waitFor(() => expect(result.current.day.exs[0]!.sets[0]).toMatchObject({ id: 'f0', done: true }));
  });

  const withFirst = (local: string, first: object[]) => ({ exercises: [{ ...plank, name: local }, plank], sets: [...first, { exercise: 'Plank (seconds)', id: 'p1', set_index: 0 }] as never });

  it('a pull that lands after the adoption and before the queued tick is written is merged, not overwritten', async () => {
    const { db, local } = await waiting(
      (l) => withFirst(l, [0, 1, 2].map((k) => ({ exercise: l, id: `f${k}`, set_index: k }))),
      async (d) => {
        const w = (await loadWorkout(d, DATE))!;
        await saveWorkout(d, { ...w, version: 4, exercises: [...w.exercises, { ...plank, name: 'Dead Bug' }], updated_at: '2026-10-08T09:40:00Z' });
      },
    );
    const w = (await loadWorkout(db, DATE)) as unknown as { id: string; version: number; exercises: { name: string }[] };
    expect(w.exercises.map((e) => e.name)).toEqual([local, 'Plank (seconds)', 'Dead Bug']);
    expect(w).toMatchObject({ id: 'srv-w1', version: 4 });
    expect((await loadSets(db, DATE)).find((s) => s.id === 'f0')).toMatchObject({ done: true, weight_kg: 40 });
  });

  it('a set the other device already ticked stays as it is: the tick is dropped and nothing is queued, not even a lift record', async () => {
    const { db } = await waiting((l) => withFirst(l, [{ exercise: l, id: 'f0', set_index: 0, done: true, w: 50, r: 5 }, { exercise: l, id: 'f1', set_index: 1, done: false }]));
    const sets = (await loadSets(db, DATE)).filter((s) => !s.deleted_at);
    expect(sets.map((s) => s.id).sort()).toEqual(['f0', 'f1', 'p1']);
    expect(sets.find((s) => s.id === 'f0')).toMatchObject({ done: true, weight_kg: 50, reps: 5, version: 2 });
    expect(await outbox(db)).toEqual([]);
    expect(await db.getAllAsync('SELECT 1 FROM lift_stats')).toEqual([]);
  });
});

describe('finish early (#1157)', () => {
  it('keeps ticked sets, drops unticked sets and untouched exercises in one write, and a reload shows the same', async () => {
    const { db, result } = await started();
    const [a, b] = result.current.day.exs;
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '20'));
    await act(async () => result.current.editSet(0, 'work', 0, 'r', '5'));
    await act(async () => result.current.tick(0, 0));
    await settle();
    const total = result.current.day.exs.length;
    await act(async () => void result.current.finishEarly());
    await settle();
    expect(result.current.day.exs.map((e) => [e.name, e.sets.length])).toEqual([[a!.name, 1]]);
    expect((await live(db, a!.name)).map((s) => s.done)).toEqual([true]);
    expect(await live(db, b!.name)).toEqual([]);
    expect((await loadWorkout(db, DATE))?.exercises.map((e) => e.name)).toEqual([a!.name]);
    expect(total).toBeGreaterThan(1);
  });

  it('removes an exercise with only ticked warm-ups (and its warm-ups), keeps a kept exercise\'s unticked warm-ups, drops a second session never started', async () => {
    const { db, result } = await started();
    const [a, b] = result.current.day.exs;
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '20'));
    await act(async () => result.current.editSet(0, 'work', 0, 'r', '5'));
    await act(async () => result.current.tick(0, 0));
    await act(async () => result.current.rampStart(0)); // an unticked warm-up on the kept exercise
    await act(async () => result.current.rampStart(1));
    await act(async () => result.current.editSet(1, 'ramp', 0, 'w', '20'));
    await act(async () => result.current.rampTick(1, 0)); // a ticked warm-up, no ticked work set
    await act(async () => void (await result.current.addSecond('Lower A')));
    await settle();
    expect((await live(db, b!.name, 'ramp')).some((s) => s.done)).toBe(true);
    expect(result.current.day.exs.some((e) => e.part === 2)).toBe(true);
    await act(async () => void result.current.finishEarly());
    await settle();
    expect(result.current.day.exs.map((e) => e.name)).toEqual([a!.name]);
    expect(result.current.day.exs.some((e) => e.part === 2)).toBe(false);
    expect(await live(db, b!.name, 'ramp')).toEqual([]);
    expect(await live(db, b!.name)).toEqual([]);
    expect((await live(db, a!.name, 'ramp')).map((s) => s.done)).toEqual([false]);
    expect((await loadSets(db, DATE)).filter((s) => !s.deleted_at && s.exercise !== a!.name)).toEqual([]);
  });

  it('does nothing when no set is ticked', async () => {
    const { result } = await started();
    const before = result.current.day.exs.length;
    let ok = true;
    await act(async () => void (ok = result.current.finishEarly()));
    expect(ok).toBe(false);
    expect(result.current.day.exs).toHaveLength(before);
  });
});
