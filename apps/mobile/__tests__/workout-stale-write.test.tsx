import { act, renderHook, waitFor } from '@testing-library/react-native';
import { loadLifts, loadSets, loadWorkout, saveLift, saveSet, saveWorkout } from '../src/db/workouts';
import { dayQueue } from '../src/workout/dayQueue';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { openDb } from './sync-helpers';

jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const notify = jest.fn();
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

/** A built session on screen and stored, then a pull stores a different version of its rows before the hook reloads. */
async function started() {
  const db = await openDb();
  const opts = { db, profile, now: NOW, focus: [], notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
  const view = await renderHook(({ k }: { k: number }) => useWorkoutDay({ ...opts, reloadKey: k }), { initialProps: { k: 0 } });
  await waitFor(() => expect(view.result.current.day.ready).toBe(true));
  await act(async () => void (await view.result.current.start('Upper A', {}, null)));
  await waitFor(async () => expect((await loadSets(db, DATE)).length).toBeGreaterThan(0));
  await act(async () => void (await dayQueue.current)); // the queued writes finish
  return { db, ...view };
}

describe('an edit made before the reload keeps what a sync pull stored (#302)', () => {
  it('a set edit keeps the stored version of the set and of the workout', async () => {
    const { db, result } = await started();
    const w = (await loadWorkout(db, DATE))!;
    const sets = await loadSets(db, DATE);
    const first = sets[0]!;
    await saveWorkout(db, { ...w, version: 7 });
    await saveSet(db, DATE, { ...first, version: 4 });
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '50'));
    await act(async () => result.current.setForm(0, 'yes')); // writes the workout row
    await waitFor(async () => expect((await loadSets(db, DATE)).find((s) => s.id === first.id)?.weight_kg).toBe(50));
    await act(async () => void (await dayQueue.current)); // the queued writes finish
    expect((await loadSets(db, DATE)).find((s) => s.id === first.id)?.version).toBe(4);
    expect((await loadSets(db, DATE)).find((s) => s.id !== first.id)?.version).toBe(0);
    expect((await loadWorkout(db, DATE))?.version).toBe(7);
  });

  it('a set another device deleted is not brought back by an edit', async () => {
    const { db, result } = await started();
    const first = (await loadSets(db, DATE))[0]!;
    await saveSet(db, DATE, { ...first, version: 5, deleted_at: '2026-10-08T09:00:00Z', updated_at: '2026-10-08T09:00:00Z' });
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '50'));
    await act(async () => void (await dayQueue.current)); // the queued writes finish
    const stored = (await loadSets(db, DATE)).find((s) => s.id === first.id)!;
    expect(stored.deleted_at).toBe('2026-10-08T09:00:00Z');
    expect(stored.version).toBe(5);
  });

  it('a workout another device deleted is not brought back by an edit', async () => {
    const { db, result } = await started();
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, version: 3, deleted_at: '2026-10-09T09:59:00Z', updated_at: '2026-10-09T09:59:59Z' });
    await act(async () => result.current.setForm(0, 'yes')); // writes the workout row
    await act(async () => void (await dayQueue.current)); // the queued writes finish
    const stored = (await loadWorkout(db, DATE))!;
    expect(stored.deleted_at).toBe('2026-10-09T09:59:00Z');
    expect(stored.version).toBe(3);
  });

  it('a session started after an older tombstone was pulled is stored live, on the tombstone\'s version', async () => {
    const shape = (await loadWorkout((await started()).db, DATE))!;
    const db = await openDb();
    const opts = { db, profile, now: NOW, focus: [], notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
    const { result } = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
    await waitFor(() => expect(result.current.day.ready).toBe(true));
    // Pulled after the screen loaded an empty day; deleted a day before the session starts in any timezone.
    await saveWorkout(db, { ...shape, version: 6, deleted_at: '2026-10-07T09:00:00Z', updated_at: '2026-10-07T09:00:00Z' });
    await act(async () => void (await result.current.start('Upper A', {}, null)));
    await act(async () => void (await dayQueue.current)); // the queued writes finish
    const stored = (await loadWorkout(db, DATE))!;
    expect(stored.deleted_at ?? null).toBeNull();
    expect(stored.version).toBe(6);
  });
});

describe('a lift record a sync pull stored after the screen loaded (#409)', () => {
  it('is the base for the next tick, not the screen\'s older copy', async () => {
    const { db, result } = await started();
    const name = result.current.day.exs[0]!.name;
    // Another device's session on this lift, pulled after the screen loaded its lifts.
    await saveLift(db, name, { date: '2026-10-05', sets: [{ w: 40, r: 8, rate: null }], form: null, n: 3, first: '2026-09-01', prev: null, hist: [{ date: '2026-10-05', e: 99 }] });
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '50'));
    await act(async () => result.current.editSet(0, 'work', 0, 'r', '8'));
    await act(async () => result.current.tick(0, 0));
    await act(async () => void (await dayQueue.current)); // the queued writes finish
    const stored = (await loadLifts(db))[name]!;
    expect(stored.date).toBe(DATE);
    expect(stored.prev?.date).toBe('2026-10-05');
    expect(stored.n).toBe(4);
    expect(stored.first).toBe('2026-09-01');
    expect(stored.hist?.map((h) => h.date)).toEqual(['2026-10-05', DATE]);
    expect(result.current.day.lifts[name]).toEqual(stored);
  });
});
