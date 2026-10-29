import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { LiftRecord } from '@plate-and-bar/core';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { saveProfile } from '../src/db/records';
import { saveLift, saveSet, saveWorkout } from '../src/db/workouts';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { buildSessions, exerciseTrend, setText } from '../src/progress/history/logic';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';
import type { WorkoutSet } from '../src/workout/types';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('react-native/Libraries/ReactNative/RendererProxy', () => ({ ...jest.requireActual('react-native/Libraries/ReactNative/RendererProxy'), findNodeHandle: () => 7 }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const meta = { version: 0, updated_at: '', deleted_at: null };
const wset = (id: string, exercise: string, i: number, w: number | null, r: number | null, done = true): WorkoutSet => ({ ...meta, id, workout_id: null, exercise, kind: 'work', set_index: i, weight_kg: w, reps: r, done, rate: null, t: null });
const workout = (date: string, base: string | null) => ({ ...meta, id: null, date, template: base, base, where: 'gym' as const, cardio_min: null, mods: {}, exercises: [], ci_choice: null });
const flush = () => act(async () => { await new Promise<void>((r) => setImmediate(r)); });

describe('history logic', () => {
  const log = { '2026-10-06': { t: 'Pull A', n: 3 }, '2026-10-04': { n: 1 } };
  const sets = {
    '2026-10-06': [wset('a', 'Row', 0, 60, 8), wset('b', 'Row', 1, 60, 6), wset('c', 'Curl', 2, 15, 10), wset('d', 'Row', 3, 60, 5, false)],
    '2026-10-04': [wset('e', 'Row', 0, 50, 10)],
  };

  it('builds newest-first sessions from done work sets, with core volume', () => {
    const s = buildSessions(log, sets);
    expect(s.map((x) => x.date)).toEqual(['2026-10-06', '2026-10-04']);
    expect(s[0]).toMatchObject({ name: 'Pull A', setsDone: 3, volume: 60 * 8 + 60 * 6 + 150 });
    expect(s[0]!.exercises.map((e) => e.name)).toEqual(['Row', 'Curl']);
    expect(s[1]!.name).toBe('Session'); // core's HAND_PICKED
  });

  it('leaves out a day with no done set', () => {
    expect(buildSessions({ '2026-10-06': { t: 'x' } }, { '2026-10-06': [wset('a', 'Row', 0, 60, 8, false)] })).toEqual([]);
  });

  it('trends one exercise oldest first and calls a personal best only when core stored the toast for that day', () => {
    const s = buildSessions(log, sets);
    const lift = (hist: { date: string; e: number }[], pbToast: string | null) => ({ date: '2026-10-06', sets: [], hist, pbToast }) as unknown as LiftRecord;
    const hist = [{ date: '2026-10-04', e: 60 }, { date: '2026-10-06', e: 70 }];
    expect(exerciseTrend(s, 'Row', lift(hist, '2026-10-06'))).toMatchObject({
      points: [{ date: '2026-10-04', volume: 500 }, { date: '2026-10-06', volume: 840 }],
      heaviest: 60,
      pbDate: '2026-10-06',
    });
    // Core's own call wins: a stored history that looks like a best (the capped hist forgot an older, higher one) shows nothing without the toast.
    expect(exerciseTrend(s, 'Row', lift(hist, null)).pbDate).toBeNull();
    expect(exerciseTrend(s, 'Row', lift(hist, '2026-10-04')).pbDate).toBeNull(); // the toast was for an earlier day
    expect(exerciseTrend(s, 'Row', undefined).pbDate).toBeNull();
  });

  it('words a set by what was typed', () => {
    expect(setText({ w: 60, r: 8 })).toBe('60 kg x 8');
    expect(setText({ w: null, r: 12 })).toBe('12 reps');
    expect(setText({ w: null, r: null })).toBe('done');
  });
});

describe('Progress: recent workouts', () => {
  const setup = async (db: ReturnType<typeof memoryDb>, version = 0) => {
    await saveProfile(db, buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1)));
    const ui = (v: number) => <SyncContext.Provider value={{ dataVersion: v } as SyncState}>{withProfile(db, <ProgressScreen db={db} now={NOW} />)}</SyncContext.Provider>;
    const r = await render(ui(version));
    await screen.findByRole('header', { name: 'Progress' });
    return { rerender: (v: number) => r.rerender(ui(v)) };
  };

  it('shows an honest empty state with no counters', async () => {
    await setup(memoryDb());
    expect(await screen.findByText('No workouts logged yet. Your sessions will appear here.')).toBeTruthy();
  });

  it('lists logged days, opens one, and refreshes after a sync pull', async () => {
    const db = memoryDb();
    await saveWorkout(db, workout('2026-10-06', 'Pull A'));
    await saveSet(db, '2026-10-06', wset('a', 'Row', 0, 60, 8));
    await saveSet(db, '2026-10-06', wset('b', 'Row', 1, 60, 6));
    await saveLift(db, 'Row', { date: '2026-10-06', sets: [], hist: [{ date: '2026-10-01', e: 50 }, { date: '2026-10-06', e: 70 }], pbToast: '2026-10-06' } as unknown as LiftRecord);
    const { rerender } = await setup(db);
    const row = await screen.findByLabelText('Pull A, 6 Oct, 2 sets, 840 kg');
    expect(screen.queryByText('No workouts logged yet. Your sessions will appear here.')).toBeNull();

    await fireEvent.press(row);
    expect(await screen.findByRole('header', { name: 'Pull A' })).toBeTruthy();
    expect(screen.getByText('Set 1: 60 kg x 8')).toBeTruthy();
    expect(screen.getByText('Set 2: 60 kg x 6')).toBeTruthy();
    expect(screen.getByText('Personal best')).toBeTruthy();
    expect(screen.getByLabelText('2 sets')).toBeTruthy();
    expect(screen.getByLabelText('840 kg lifted')).toBeTruthy();
    expect(screen.getByLabelText('1 exercise')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back to progress'));
    expect(await screen.findByRole('header', { name: 'Recent workouts' })).toBeTruthy();

    await saveWorkout(db, workout('2026-10-07', 'Push A'));
    await saveSet(db, '2026-10-07', wset('c', 'Bench', 0, 40, 10));
    await rerender(1); // a sync pull stored records
    await flush();
    expect(await screen.findByLabelText('Push A, 7 Oct, 1 set, 400 kg')).toBeTruthy();
  });

  async function withDay() {
    const db = memoryDb();
    await saveWorkout(db, workout('2026-10-06', 'Pull A'));
    await saveSet(db, '2026-10-06', wset('a', 'Row', 0, 60, 8));
    const ui = await setup(db);
    return { db, ...ui };
  }

  it('moves focus to the day heading when a day opens, and back to the row after Back', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
    await withDay();
    const row = await screen.findByLabelText('Pull A, 6 Oct, 1 set, 480 kg');
    await flush();
    const n0 = spy.mock.calls.length;
    await fireEvent.press(row);
    await screen.findByRole('header', { name: 'Pull A' });
    expect(spy).toHaveBeenCalledTimes(n0 + 1); // the day heading
    await fireEvent.press(screen.getByLabelText('Back to progress'));
    await screen.findByRole('header', { name: 'Recent workouts' });
    expect(spy).toHaveBeenCalledTimes(n0 + 2); // the row
    spy.mockRestore();
  });

  it('goes back to the page when the open day disappears after a sync', async () => {
    const { db, rerender } = await withDay();
    await fireEvent.press(await screen.findByLabelText('Pull A, 6 Oct, 1 set, 480 kg'));
    await screen.findByRole('header', { name: 'Pull A' });
    await saveSet(db, '2026-10-06', wset('a', 'Row', 0, 60, 8, false)); // un-ticked on another device
    await rerender(1);
    await flush();
    expect(await screen.findByRole('header', { name: 'Recent workouts' })).toBeTruthy();
    expect(screen.queryByLabelText('Back to progress')).toBeNull();
  });
});
