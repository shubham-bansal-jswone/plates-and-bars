import { act, renderHook, waitFor } from '@testing-library/react-native';
import { addDays, mainLifts, personalRecords, priorBestOf } from '@plate-and-bar/core';
import { DONE_SETS_SQL, loadDoneSets, saveSet, saveWorkout } from '../src/db/workouts';
import { useProgressSets } from '../src/progress/useProgressSets';
import { setsBefore, setsInRange } from '../src/progress/setsView';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { openDb } from './sync-helpers';

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

const meta = { version: 0, updated_at: '', deleted_at: null };
const wset = (id: string, exercise: string, w: number | null, r: number | null, o: Partial<WorkoutSet> = {}): WorkoutSet => ({ ...meta, id, workout_id: null, exercise, kind: 'work', set_index: 0, weight_kg: w, reps: r, done: true, rate: null, t: null, ...o });
const workout = (date: string, o: Partial<Workout> = {}): Workout => ({ ...meta, id: null, date, template: null, base: null, where: 'gym', cardio_min: null, mods: {}, exercises: [], ci_choice: null, ...o }) as Workout;
type Db = Awaited<ReturnType<typeof openDb>>;
const day = async (db: Db, date: string, sets: WorkoutSet[], w: Partial<Workout> = {}) => {
  await saveWorkout(db, workout(date, w));
  for (const s of sets) await saveSet(db, date, s);
};

describe('loadDoneSets', () => {
  it('returns done work sets only: no deleted, undone, ramp, or sets of a deleted workout', async () => {
    const db = await openDb();
    await day(db, '2026-10-01', [wset('a', 'Squat', 100, 5), wset('b', 'Squat', 100, 5, { done: false }), wset('c', 'Squat', 60, 5, { kind: 'ramp' }), wset('d', 'Squat', 100, 5, { deleted_at: '2026-10-02T00:00:00Z' })]);
    await day(db, '2026-10-02', [wset('e', 'Squat', 100, 5)], { deleted_at: '2026-10-03T00:00:00Z' });
    expect(await loadDoneSets(db)).toEqual([{ date: '2026-10-01', exercise: 'Squat', kind: 'work', weight_kg: 100, reps: 5, done: true, rate: null, deleted_at: null }]);
  });

  it('bounds the dates inclusively, either side optional', async () => {
    const db = await openDb();
    for (const d of ['2026-09-30', '2026-10-01', '2026-10-05', '2026-10-06']) await day(db, d, [wset(`s${d}`, 'Row', 50, 8)]);
    const dates = async (f?: string, t?: string) => (await loadDoneSets(db, f, t)).map((s) => s.date);
    expect(await dates('2026-10-01', '2026-10-05')).toEqual(['2026-10-01', '2026-10-05']);
    expect(await dates('2026-10-05')).toEqual(['2026-10-05', '2026-10-06']);
    expect(await dates(undefined, '2026-09-30')).toEqual(['2026-09-30']);
    expect(await dates()).toHaveLength(4);
  });

  it('uses the date index, not a table scan', async () => {
    const db = await openDb();
    const plan = await db.getAllAsync<{ detail: string }>(`EXPLAIN QUERY PLAN ${DONE_SETS_SQL}`, '2026-01-01', '2026-02-01');
    expect(plan.map((p) => p.detail).join(' ')).toContain('workout_sets_by_date');
  });
});

describe('set views', () => {
  const mk = (date: string) => ({ date, exercise: 'Row', kind: 'work' as const, weight_kg: 50, reps: 5, done: true, rate: null });
  const all = ['2026-07-15', '2026-07-16', '2026-10-08', '2026-10-09'].map(mk);
  it('setsInRange keeps both bounds (84 days back to end)', () => {
    expect(setsInRange(all, '2026-10-08', '12w').map((s) => s.date)).toEqual(['2026-07-16', '2026-10-08']);
    expect(setsInRange(all, '2026-10-08', '4w').map((s) => s.date)).toEqual(['2026-10-08']);
    expect(setsInRange(all, '2026-10-08', 'all')).toHaveLength(3);
  });
  it('setsBefore leaves out the day itself', () => {
    expect(setsBefore(all, '2026-10-08').map((s) => s.date)).toEqual(['2026-07-15', '2026-07-16']);
  });
});

describe('useProgressSets', () => {
  it('loads after first render, then returns all sets and types with overrides', async () => {
    const db = await openDb();
    await day(db, '2026-10-01', [wset('a', 'Bench Press', 80, 5), wset('b', 'My Lift', 20, 10)]);
    const seen: boolean[] = [];
    const { result } = await renderHook(() => {
      const r = useProgressSets(db, 0, { 'My Lift': { type: 'bodyweight', step_kg: 0, rep_low: 5, rep_high: 10 } });
      seen.push(r.loading);
      return r;
    });
    expect(seen[0]).toBe(true); // first paint has no data and is not blocked
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.all.map((s) => s.exercise)).toEqual(['Bench Press', 'My Lift']);
    expect(result.current.types['My Lift']).toBe('bodyweight');
    expect(result.current.types['Bench Press']).toBeDefined();
    expect(result.current.error).toBeNull();
  });

  it('switching range or end does not reload; a dataVersion bump does', async () => {
    const db = await openDb();
    await day(db, '2026-04-01', [wset('old', 'Row', 50, 8)]);
    await day(db, '2026-10-01', [wset('a', 'Row', 60, 8)]);
    const spy = jest.spyOn(db, 'getAllAsync');
    const { result, rerender } = await renderHook((p: { v: number }) => useProgressSets(db, p.v), { initialProps: { v: 0 } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.inRange('2026-10-08', '12w').map((s) => s.date)).toEqual(['2026-10-01']);
    expect(result.current.inRange('2026-10-08', 'all')).toHaveLength(2);
    expect(result.current.inRange('2026-10-08', '12w')).toBe(result.current.inRange('2026-10-08', '12w'));
    expect(result.current.before('2026-10-01').map((s) => s.date)).toEqual(['2026-04-01']);
    await rerender({ v: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    await day(db, '2026-10-02', [wset('b', 'Row', 62, 8)]);
    await rerender({ v: 1 });
    await waitFor(() => expect(result.current.all).toHaveLength(3));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('PRs from all find an old best outside the selected range', async () => {
    const db = await openDb();
    await day(db, '2025-01-10', [wset('p', 'Back Squat', 150, 5)]);
    await day(db, '2025-01-12', [wset('q', 'Back Squat', 100, 5)]);
    await day(db, '2026-10-01', [wset('r', 'Back Squat', 120, 5)]);
    const { result } = await renderHook(() => useProgressSets(db, 0));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const types = { 'Back Squat': 'barbell' as const };
    const inWin = result.current.inRange('2026-10-08', '12w');
    expect(inWin).toHaveLength(1);
    // The range slice has no history, so no PR; the whole history shows 120 x 5 is no record against 150 x 5.
    expect(personalRecords(inWin, types).some((r) => r.date === '2026-10-01')).toBe(false);
    expect(personalRecords(result.current.all, types).some((r) => r.date === '2026-10-01')).toBe(false);
    expect(priorBestOf(result.current.before('2026-10-01'), 'barbell', '2026-10-01').best).toBeGreaterThan(170);
  });

  it('reloads on focus, so a set ticked on Workout shows, and also without a sync version (dataVersion stays 0)', async () => {
    const db = await openDb();
    await day(db, '2026-10-01', [wset('a', 'Row', 60, 8)]);
    const spy = jest.spyOn(db, 'getAllAsync');
    const { result } = await renderHook(() => useProgressSets(db, 0));
    await waitFor(() => expect(result.current.all).toHaveLength(1));
    expect(spy).toHaveBeenCalledTimes(1); // the focus on mount does not read twice
    await saveSet(db, '2026-10-01', wset('b', 'Row', 62, 8));
    await focus();
    await waitFor(() => expect(result.current.all).toHaveLength(2));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reports a failed read as error and keeps the last sets', async () => {
    const db = await openDb();
    await day(db, '2026-10-01', [wset('a', 'Row', 60, 8)]);
    const { result, rerender } = await renderHook((p: { v: number }) => useProgressSets(db, p.v), { initialProps: { v: 0 } });
    await waitFor(() => expect(result.current.all).toHaveLength(1));
    jest.spyOn(db, 'getAllAsync').mockRejectedValueOnce(new Error('disk'));
    await rerender({ v: 1 });
    await waitFor(() => expect(result.current.error?.message).toBe('disk'));
    expect(result.current.loading).toBe(false);
    expect(result.current.all).toHaveLength(1);
  });
});

describe('performance: two years of sets', () => {
  it('loads and runs core records within budget', async () => {
    const db = await openDb();
    const lifts = ['Bench Press', 'Back Squat', 'Deadlift', 'Overhead Press', 'Barbell Row'];
    const start = '2024-10-28'; // a Monday
    await db.execAsync('BEGIN');
    let n = 0;
    for (let wk = 0; wk < 104; wk++) {
      for (const dow of [0, 1, 3, 4]) {
        const date = addDays(start, wk * 7 + dow);
        await saveWorkout(db, workout(date));
        for (let i = 0; i < 20; i++) {
          const ex = lifts[(i >> 2) % lifts.length]!;
          await saveSet(db, date, wset(`s${n++}`, ex, 40 + wk * 0.5 + (i % 4) * 2.5, 5 + (i % 3), { set_index: i }));
        }
      }
    }
    await db.execAsync('COMMIT');
    const t0 = performance.now();
    const sets = await loadDoneSets(db);
    const t1 = performance.now();
    const types = Object.fromEntries(lifts.map((l) => [l, 'barbell' as const]));
    const prs = personalRecords(sets, types);
    const ml = mainLifts(sets, types, addDays(start, 104 * 7));
    const t2 = performance.now();
    console.log(`perf: ${sets.length} sets; loadDoneSets ${(t1 - t0).toFixed(0)} ms; personalRecords+mainLifts ${(t2 - t1).toFixed(0)} ms; ${prs.length} PRs, ${ml.length} main lifts`);
    expect(sets).toHaveLength(104 * 4 * 20);
    expect(t1 - t0).toBeLessThan(1500);
    expect(t2 - t1).toBeLessThan(1500);
  });
});
