import { act, renderHook, waitFor } from '@testing-library/react-native';
import { deleteLift, loadLifts, loadSets, loadWorkout, saveLift, saveSet, saveWorkout } from '../src/db/workouts';
import { applyCantToStoredDay } from '../src/workout/cantApply';
import { dayQueue } from '../src/workout/dayQueue';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { failInTxn, openDb } from './sync-helpers';

jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const notify = jest.fn();
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

/** A built session on screen and stored, then a pull stores a different version of its rows before the hook reloads. */
async function started() {
  const db = await openDb();
  const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
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
    const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
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

describe('a workout deleted on another device (#408)', () => {
  it('loads as no session today, and a new session can be started over it', async () => {
    const shape = (await loadWorkout((await started()).db, DATE))!;
    const db = await openDb();
    await saveWorkout(db, { ...shape, version: 6, deleted_at: '2026-10-07T09:00:00Z', updated_at: '2026-10-07T09:00:00Z' });
    const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
    const { result } = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
    await waitFor(() => expect(result.current.day.ready).toBe(true));
    expect(result.current.day.workout).toBeNull();
    await act(async () => void (await result.current.start('Upper A', {}, null)));
    await act(async () => void (await dayQueue.current)); // the queued writes finish
    expect(result.current.day.workout).not.toBeNull();
    const stored = (await loadWorkout(db, DATE))!;
    expect(stored.deleted_at ?? null).toBeNull();
    expect(stored.version).toBe(6);
  });

  it('starting over the deleted session tombstones its sets that were left live', async () => {
    const { db: old } = await started();
    const shape = (await loadWorkout(old, DATE))!;
    const oldSets = await loadSets(old, DATE);
    const db = await openDb();
    await saveWorkout(db, { ...shape, version: 6, deleted_at: '2026-10-07T09:00:00Z', updated_at: '2026-10-07T09:00:00Z' });
    for (const st of oldSets) await saveSet(db, DATE, st); // the deleting device did not tombstone them
    const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
    const view = await renderHook(({ k }: { k: number }) => useWorkoutDay({ ...opts, reloadKey: k }), { initialProps: { k: 0 } });
    await waitFor(() => expect(view.result.current.day.ready).toBe(true));
    await act(async () => void (await view.result.current.start('Upper A', {}, null)));
    await act(async () => void (await dayQueue.current)); // the queued writes finish
    const sets = await loadSets(db, DATE);
    const oldIds = new Set(oldSets.map((x) => x.id));
    expect(sets.filter((x) => oldIds.has(x.id)).every((x) => !!x.deleted_at)).toBe(true);
    const live = sets.filter((x) => !x.deleted_at).length;
    expect(live).toBe(oldSets.length); // same template, so the same number of new sets
    await view.rerender({ k: 1 });
    await waitFor(() => expect(view.result.current.day.exs.flatMap((e) => e.sets).length).toBe(live));
  });

  it('a rule saved on Targets: a failure writing the sets leaves the workout row and sets as they were (#516)', async () => {
    const { db } = await started();
    const before = await loadWorkout(db, DATE);
    const sets = await loadSets(db, DATE);
    const f = failInTxn(db, 'workout_sets');
    const onError = jest.fn();
    await applyCantToStoredDay({ db, date: DATE, now: () => new Date(2026, 9, 8, 10, 5, 0), draft: { name: 'Machine Chest Press', reason: 'pain', dur: 'perm', scope: 'joint', key: 'shoulder' }, choice: null, exclusions: [], fallbackWhere: 'gym', onError });
    f.restore();
    expect(onError).toHaveBeenCalled();
    expect(f.leaked()).toBe(false);
    expect(await loadWorkout(db, DATE)).toEqual(before);
    expect(await loadSets(db, DATE)).toEqual(sets);
  });

  it('a rule saved on Targets leaves a deleted workout and its sets alone', async () => {
    const { db } = await started();
    const w = (await loadWorkout(db, DATE))!;
    const tomb = { ...w, version: 6, deleted_at: '2026-10-08T09:00:00Z', updated_at: '2026-10-08T09:00:00Z' };
    await saveWorkout(db, tomb);
    const before = await loadSets(db, DATE);
    expect(w.exercises.map((e) => e.name)).toContain('Machine Chest Press'); // the rule below swaps it on a live day
    await applyCantToStoredDay({ db, date: DATE, now: NOW, draft: { name: 'Machine Chest Press', reason: 'pain', dur: 'perm', scope: 'joint', key: 'shoulder' }, choice: null, exclusions: [], fallbackWhere: 'gym', onError: jest.fn() });
    expect(await loadWorkout(db, DATE)).toEqual(tomb);
    expect(await loadSets(db, DATE)).toEqual(before);
  });

  it('a "can\'t do" change on the screen does not bring back a workout deleted since it loaded', async () => {
    const { db, result } = await started();
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, version: 6, deleted_at: '2026-10-09T09:59:00Z', updated_at: '2026-10-09T09:59:59Z' });
    const before = await loadSets(db, DATE);
    const name = result.current.day.exs[0]!.name;
    await act(async () => result.current.cant(0, { name, reason: 'dislike', dur: 'today', scope: 'exercise', key: name }, null));
    await act(async () => void (await dayQueue.current)); // the queued writes finish
    const stored = (await loadWorkout(db, DATE))!;
    expect(stored.deleted_at).toBe('2026-10-09T09:59:00Z');
    expect(stored.version).toBe(6);
    expect(await loadSets(db, DATE)).toEqual(before);
  });

  it('starting over a tombstone stamped ahead of this device\'s clock still stores the session live', async () => {
    const shape = (await loadWorkout((await started()).db, DATE))!;
    const db = await openDb();
    await saveWorkout(db, { ...shape, version: 6, deleted_at: '2026-10-09T09:59:59Z', updated_at: '2026-10-09T09:59:59Z' });
    const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
    const { result } = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
    await waitFor(() => expect(result.current.day.ready).toBe(true));
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

  it('a lift deleted on another device starts a fresh record on the next tick', async () => {
    const { db, result } = await started();
    const name = result.current.day.exs[0]!.name;
    await saveLift(db, name, { date: '2026-10-05', sets: [{ w: 40, r: 8, rate: null }], form: null, n: 3, first: '2026-09-01', prev: null, hist: [{ date: '2026-10-05', e: 99 }] });
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '50'));
    await act(async () => result.current.editSet(0, 'work', 0, 'r', '8'));
    await act(async () => result.current.tick(0, 0));
    await act(async () => void (await dayQueue.current));
    await deleteLift(db, name, '2026-10-08T09:00:00Z'); // the pull: deleted elsewhere
    await act(async () => result.current.editSet(0, 'work', 1, 'w', '50'));
    await act(async () => result.current.editSet(0, 'work', 1, 'r', '8'));
    await act(async () => result.current.tick(0, 1));
    await act(async () => void (await dayQueue.current));
    const stored = (await loadLifts(db))[name]!;
    expect(stored.n).toBe(1);
    expect(stored.prev).toBeNull();
    expect(stored.hist?.map((h) => h.date)).toEqual([DATE]);
  });

  it('no personal-best toast when the pulled history holds a better score', async () => {
    notify.mockClear();
    const { db, result } = await started();
    const name = result.current.day.exs[0]!.name;
    await saveLift(db, name, { date: '2026-10-05', sets: [{ w: 400, r: 20, rate: null }], form: null, n: 3, first: '2026-09-01', prev: null, hist: [{ date: '2026-10-05', e: 9999 }] });
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '50'));
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '50'));
    await act(async () => result.current.editSet(0, 'work', 0, 'r', '8'));
    await act(async () => result.current.tick(0, 0));
    await act(async () => void (await dayQueue.current));
    expect(notify).not.toHaveBeenCalledWith(`New personal best on ${name}`);
  });

  it('a personal-best toast when today beats the pulled history', async () => {
    notify.mockClear();
    const { db, result } = await started();
    const name = result.current.day.exs[0]!.name;
    await saveLift(db, name, { date: '2026-10-05', sets: [{ w: 10, r: 5, rate: null }], form: null, n: 3, first: '2026-09-01', prev: null, hist: [{ date: '2026-09-28', e: 1 }, { date: '2026-10-05', e: 1 }] });
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '50'));
    await act(async () => result.current.editSet(0, 'work', 0, 'r', '8'));
    await act(async () => result.current.tick(0, 0));
    await act(async () => void (await dayQueue.current));
    expect(notify).toHaveBeenCalledWith(`New personal best on ${name}`);
  });
});

describe('a workout row changed elsewhere after the screen loaded (#410)', () => {
  it('a rule saved on Targets keeps its swap when the screen then writes the workout, and the screen reloads', async () => {
    const { db, result } = await started();
    expect(result.current.day.exs.map((e) => e.name)).toContain('Machine Chest Press');
    await applyCantToStoredDay({ db, date: DATE, now: () => new Date(2026, 9, 8, 10, 5, 0), draft: { name: 'Machine Chest Press', reason: 'pain', dur: 'perm', scope: 'joint', key: 'shoulder' }, choice: null, exclusions: [], fallbackWhere: 'gym', onError: jest.fn() });
    const swapped = (await loadWorkout(db, DATE))!.exercises.map((e) => e.name);
    expect(swapped).not.toContain('Machine Chest Press');
    const kept = result.current.day.exs.find((e) => swapped.includes(e.name))!.name; // on both lists
    const i = result.current.day.exs.findIndex((e) => e.name === kept);
    await act(async () => result.current.setForm(i, 'yes')); // the screen still shows the old list
    await act(async () => void (await dayQueue.current)); // the queued writes finish
    const stored = (await loadWorkout(db, DATE))!;
    expect(stored.exercises.map((e) => e.name)).toEqual(swapped);
    expect(stored.exercises.find((e) => e.name === kept)?.form).toBe('yes');
    await waitFor(() => expect(result.current.day.exs.map((e) => e.name)).toEqual(swapped));
  });

  it('two writes queued before the reload both keep the swap, even within the same second', async () => {
    const { db, result } = await started();
    await applyCantToStoredDay({ db, date: DATE, now: NOW, draft: { name: 'Machine Chest Press', reason: 'pain', dur: 'perm', scope: 'joint', key: 'shoulder' }, choice: null, exclusions: [], fallbackWhere: 'gym', onError: jest.fn() });
    const swapped = (await loadWorkout(db, DATE))!.exercises.map((e) => e.name);
    const kept = result.current.day.exs.find((e) => swapped.includes(e.name))!.name;
    const i = result.current.day.exs.findIndex((e) => e.name === kept);
    await act(async () => {
      result.current.setForm(i, 'yes');
      result.current.rampSkip(i);
    });
    await act(async () => void (await dayQueue.current)); // the queued writes finish
    const stored = (await loadWorkout(db, DATE))!;
    expect(stored.exercises.map((e) => e.name)).toEqual(swapped);
    expect(stored.exercises.find((e) => e.name === kept)).toMatchObject({ form: 'yes', skip_ramp: true });
  });

  it('opened over a stored session (no start here), a rule saved on Targets survives the next write', async () => {
    const { db } = await started();
    const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
    const { result } = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
    await waitFor(() => expect(result.current.day.exs.length).toBeGreaterThan(0));
    await applyCantToStoredDay({ db, date: DATE, now: NOW, draft: { name: 'Machine Chest Press', reason: 'pain', dur: 'perm', scope: 'joint', key: 'shoulder' }, choice: null, exclusions: [], fallbackWhere: 'gym', onError: jest.fn() });
    const swapped = (await loadWorkout(db, DATE))!.exercises.map((e) => e.name);
    const kept = result.current.day.exs.find((e) => swapped.includes(e.name))!.name;
    await act(async () => result.current.setForm(result.current.day.exs.findIndex((e) => e.name === kept), 'yes'));
    await act(async () => void (await dayQueue.current)); // the queued writes finish
    expect((await loadWorkout(db, DATE))!.exercises.map((e) => e.name)).toEqual(swapped);
  });

  it('a sync push that only changed the version is not a change: no merge, no reload', async () => {
    const { db, result } = await started();
    await saveWorkout(db, { ...(await loadWorkout(db, DATE))!, version: 9 }); // what patchMeta does after a push
    const first = (await loadSets(db, DATE))[0]!;
    await saveSet(db, DATE, { ...first, weight_kg: 77 }); // would show on screen only if the screen reloaded
    await act(async () => result.current.setForm(0, 'yes'));
    await act(async () => void (await dayQueue.current)); // the queued writes finish
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
    expect(result.current.day.exs.flatMap((e) => e.sets).find((r) => r.id === first.id)?.w).toBe('');
    expect((await loadWorkout(db, DATE))!.version).toBe(9);
  });
});
