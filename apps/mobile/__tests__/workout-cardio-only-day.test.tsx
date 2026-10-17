import { act, renderHook, waitFor } from '@testing-library/react-native';
import { loadSets, loadWorkout, saveSet, saveWorkout } from '../src/db/workouts';
import { dayQueue } from '../src/workout/dayQueue';
import { blankRow, setRecord, type ExState } from '../src/workout/model';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import type { Workout } from '../src/workout/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { openDb } from './sync-helpers';

// #619: a cardio-only day (a workout row with no template, no base and no exercises) and what happens when another device's
// copy of the day was stored behind the open screen. The hook is driven directly so the queued writes can be ordered.
jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

type Db = Awaited<ReturnType<typeof openDb>>;
const settle = () => act(async () => void (await dayQueue.current));
const row = (o: Partial<Workout> = {}): Workout => ({ id: null, version: 0, updated_at: '2026-10-08T12:00:00Z', deleted_at: null, date: DATE, template: null, base: null, where: null, cardio_min: null, mods: {}, exercises: [], ci_choice: null, ...o });
const session = (o: Partial<Workout> = {}) => row({ template: 'Pull A', base: 'Pull A', exercises: [{ name: 'Lat Pulldown', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }], ...o });

async function mount(seed?: (db: Db) => Promise<void>) {
  const db = await openDb();
  await seed?.(db);
  const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify: jest.fn(), startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
  const view = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
  await waitFor(() => expect(view.result.current.day.ready).toBe(true));
  return { db, notify: opts.notify as jest.Mock, ...view };
}

describe('start() over a cardio-only row pulled behind the screen', () => {
  it('keeps the pulled minutes: pulled 30 min, press Start, the session stores and shows 30', async () => {
    const { db, result } = await mount();
    expect(result.current.day.workout).toBeNull();
    await saveWorkout(db, row({ cardio_min: 30 })); // stored after the screen loaded
    await act(async () => void (await result.current.start('Upper A', {}, null)));
    await settle();
    const stored = (await loadWorkout(db, DATE))!;
    expect(stored).toMatchObject({ template: 'Upper A', base: 'Upper A', cardio_min: 30, deleted_at: null });
    expect(result.current.day.workout?.cardio_min).toBe(30);
  });

  it('the minutes typed on this screen win over the pulled ones', async () => {
    const { db, result } = await mount();
    await saveWorkout(db, row({ cardio_min: 30 }));
    await act(async () => result.current.setCardio('10')); // the stored row is live: the minutes go onto it
    await settle();
    await act(async () => void (await result.current.start('Upper A', {}, null)));
    await settle();
    expect((await loadWorkout(db, DATE))!.cardio_min).toBe(10);
  });

  it('a field the user cleared stays cleared through Start', async () => {
    const { db, result } = await mount();
    await act(async () => result.current.setCardio('20'));
    await settle();
    await act(async () => result.current.setCardio(''));
    await settle();
    await act(async () => void (await result.current.start('Upper A', {}, null)));
    await settle();
    expect((await loadWorkout(db, DATE))!.cardio_min).toBeNull();
  });
});

describe('the first cardio keystroke when another device stored a session', () => {
  it('a cleared field stays cleared: typing 1 then clearing stores no minutes, before and after the later write', async () => {
    const { db, result } = await mount();
    await saveWorkout(db, session());
    await act(async () => {
      result.current.setCardio('1');
      result.current.setCardio('');
    });
    await settle();
    expect((await loadWorkout(db, DATE))!).toMatchObject({ template: 'Pull A', cardio_min: null });
    expect(result.current.day.workout?.cardio_min).toBeNull();
  });

  it('shows the pulled session only once the save has committed: a failed save leaves the screen as it was', async () => {
    const { db, result } = await mount();
    await saveWorkout(db, session());
    // The writes inside succeed, then the commit fails: they are rolled back, and the screen must not show them.
    const exclusive = db.withExclusiveTransactionAsync;
    db.withExclusiveTransactionAsync = (task) =>
      exclusive(async (raw) => {
        await task(raw);
        throw new Error('commit failed');
      });
    await act(async () => result.current.setCardio('10'));
    await settle();
    db.withExclusiveTransactionAsync = exclusive;
    expect(result.current.day.exs).toEqual([]);
    expect(result.current.day.workout?.template).toBeNull();
    expect((await loadWorkout(db, DATE))!.cardio_min).toBeNull();
  });
});

describe('minutes on a day whose workout was deleted on another device', () => {
  it('replaces the tombstone with a live cardio-only row and tombstones the old sets', async () => {
    const ex: ExState = { name: 'Lat Pulldown', part: 1, bridge: false, form: null, found: null, skipRamp: false, feel: null, sets: [{ ...blankRow(), w: '40', r: '10', done: true }], ramp: [] };
    const { db, result } = await mount(async (d) => {
      await saveWorkout(d, session({ deleted_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z' })); // newer than this screen's copy
      await saveSet(d, DATE, setRecord(ex, 'work', 0, new Date(2026, 9, 7)));
    });
    expect(result.current.day.workout).toBeNull();
    await act(async () => result.current.setCardio('20'));
    await settle();
    expect(await loadWorkout(db, DATE)).toMatchObject({ deleted_at: null, template: null, base: null, exercises: [], cardio_min: 20 });
    const sets = await loadSets(db, DATE);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.deleted_at).toBeTruthy();
  });
});

describe('removing the last exercise decides from the stored minutes', () => {
  it('keeps minutes another device stored that this screen never had', async () => {
    const { db, result } = await mount();
    await act(async () => void (await result.current.start('Upper A', {}, null)));
    await settle();
    const names = result.current.day.exs.map((e) => e.name);
    for (const n of names.slice(0, -1)) await act(async () => void result.current.removeExercise(n));
    await settle();
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, cardio_min: 20, updated_at: '2026-10-08T12:00:00Z' }); // a pull the screen has not shown
    await act(async () => void result.current.removeExercise(names[names.length - 1]!));
    await settle();
    expect(await loadWorkout(db, DATE)).toMatchObject({ deleted_at: null, template: null, exercises: [], cardio_min: 20 });
    await waitFor(() => expect(result.current.day.workout?.cardio_min).toBe(20));
  });

  it('deletes the workout when the user cleared minutes the screen had', async () => {
    const { db, result } = await mount();
    await act(async () => void (await result.current.start('Upper A', {}, null)));
    await settle();
    await act(async () => result.current.setCardio('20'));
    await settle();
    await act(async () => result.current.setCardio(''));
    await settle();
    for (const e of [...result.current.day.exs]) await act(async () => void result.current.removeExercise(e.name));
    await settle();
    expect(result.current.day.workout).toBeNull();
    expect((await loadWorkout(db, DATE))!.deleted_at).toBeTruthy();
  });
});
