import { act, renderHook, waitFor } from '@testing-library/react-native';
import { loadSets, loadWorkout, saveSet, saveWorkout } from '../src/db/workouts';
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
  await act(async () => void (await new Promise((r) => setTimeout(r, 30)))); // the queued writes finish
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
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
    expect((await loadSets(db, DATE)).find((s) => s.id === first.id)?.version).toBe(4);
    expect((await loadSets(db, DATE)).find((s) => s.id !== first.id)?.version).toBe(0);
    expect((await loadWorkout(db, DATE))?.version).toBe(7);
  });

  it('a set another device deleted is not brought back by an edit', async () => {
    const { db, result } = await started();
    const first = (await loadSets(db, DATE))[0]!;
    await saveSet(db, DATE, { ...first, version: 5, deleted_at: '2026-10-08T09:00:00Z', updated_at: '2026-10-08T09:00:00Z' });
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '50'));
    await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
    const stored = (await loadSets(db, DATE)).find((s) => s.id === first.id)!;
    expect(stored.deleted_at).toBe('2026-10-08T09:00:00Z');
    expect(stored.version).toBe(5);
  });

  it('a workout another device deleted is not brought back by an edit', async () => {
    const { db, result } = await started();
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, version: 3, deleted_at: '2026-10-08T09:59:00Z', updated_at: '2026-10-08T09:59:59Z' });
    await act(async () => result.current.setForm(0, 'yes')); // writes the workout row
    await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
    const stored = (await loadWorkout(db, DATE))!;
    expect(stored.deleted_at).toBe('2026-10-08T09:59:00Z');
    expect(stored.version).toBe(3);
  });
});
