import { act, renderHook, waitFor } from '@testing-library/react-native';
import { loadLifts, loadSets } from '../src/db/workouts';
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
  const opts = { db, profile, now: NOW, focus: [], notify: jest.fn(), startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
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
