import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createClient } from '@plate-and-bar/api';
import { syncOnce } from '../src/sync/engine';
import { loadSets, saveSet, saveWorkout } from '../src/db/workouts';
import { useProgressSets } from '../src/progress/useProgressSets';
import { getKv, setKv, KEY_USER } from '../src/sync/store';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { writeImport } from '../src/import/writeImport';
import type { ImportPlan } from '@plate-and-bar/core';
import { openDb, fakeServer, memoryTokens, seedConsent } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
jest.mock('../src/photos/vault', () => ({ deleteKitchenPhoto: jest.fn(() => Promise.resolve()) }));
const focusFns: (() => void)[] = [];
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      focusFns.push(cb);
      cb();
      return () => void focusFns.splice(focusFns.indexOf(cb), 1);
    }, [cb]);
  },
}));
const focus = () => act(async () => { focusFns.forEach((f) => f()); });

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const DATE = '2026-10-08';
const meta = { version: 0, updated_at: '2026-10-08T06:00:00Z', deleted_at: null };
const workout: Workout = { ...meta, id: null, date: DATE, template: null, base: null, where: 'gym', cardio_min: null, mods: {}, exercises: [], ci_choice: null } as Workout;
const bench: WorkoutSet = { ...meta, id: '11111111-1111-4111-8111-111111111111', workout_id: null, exercise: 'Bench Press', kind: 'work', set_index: 0, weight_kg: 60, reps: 5, done: true, rate: null, t: null };

describe('an adopted push conflict reloads the screens (#1369)', () => {
  it('counts toward pulled and Progress shows the server copy of a set', async () => {
    const db = await openDb();
    const server = fakeServer(USER);
    server.accessValid = 'access-1';
    (globalThis as { fetch: unknown }).fetch = server.fetch;
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    await setKv(db, KEY_USER, USER);
    await seedConsent(db);
    const deps = { db, api: createClient('http://fake/api/v1', async () => (await tokens.load())?.access ?? null), tokens };
    await saveWorkout(db, workout);
    await saveSet(db, DATE, bench);
    await syncOnce(deps);
    // Progress reads the local copy at dataVersion 0.
    let version = 0;
    const { result, rerender } = await renderHook(() => useProgressSets(db, version));
    await waitFor(() => expect(result.current.all.map((s) => s.reps)).toEqual([5]));
    // Another device changed the set on the server; this one edits it too before it pulled.
    const stored = server.pushed().find((r) => r.table === 'workout_sets')!;
    server.seed('workout_sets', { ...stored, version: 2, reps: 9 });
    const [mine] = await loadSets(db, DATE);
    await saveSet(db, DATE, { ...mine!, reps: 6 });
    const r = await syncOnce(deps);
    expect(r.conflicts).toBe(1);
    expect(r.pulled).toBe(1); // SyncProvider bumps dataVersion when pulled > 0
    version = (r.pulled ?? 0) > 0 ? 1 : 0;
    await rerender({});
    await waitFor(() => expect(result.current.all.map((s) => s.reps)).toEqual([9]));
    expect(await getKv(db, KEY_USER)).toBe(USER);
  });
});

describe('a partial import still shows on the next Progress focus (#1369)', () => {
  it('the first chunk of 25 days is shown when the second chunk fails', async () => {
    const db = await openDb();
    const { result } = await renderHook(() => useProgressSets(db, 0));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const days = Array.from({ length: 30 }, (_, i) => ({ date: `2024-03-${String(i + 1).padStart(2, '0')}`, sets: [{ exercise: 'Bench Press', setIndex: 0, weightKg: 60, reps: 5 }] }));
    const plan = { days, sets: 30, skippedExercise: 0, occupied: [] } as unknown as ImportPlan;
    // The second chunk (days 26 to 30) fails on its first write.
    const real = db.withExclusiveTransactionAsync.bind(db);
    let txns = 0;
    jest.spyOn(db, 'withExclusiveTransactionAsync').mockImplementation((task) => (++txns === 2 ? Promise.reject(new Error('disk full')) : real(task)));
    await expect(writeImport(db, plan)).rejects.toThrow('disk full');
    await focus();
    await waitFor(() => expect(result.current.all).toHaveLength(25));
  });
});
