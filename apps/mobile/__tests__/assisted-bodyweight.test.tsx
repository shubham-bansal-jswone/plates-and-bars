import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import type { ExType } from '@plate-and-bar/core';
import { bodyweightOn } from '../src/progress/bodyweight';
import { saveWeight } from '../src/db/progress';
import { useProgress } from '../src/progress/useProgress';
import { saveProfile } from '../src/db/records';
import { loadLifts, loadSets, loadWorkout, saveLift, saveSet, saveWorkout } from '../src/db/workouts';
import { dayQueue } from '../src/workout/dayQueue';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import type { WorkoutSet } from '../src/workout/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';
import { openDb } from './sync-helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => {},
}));
jest.mock('react-native/Libraries/ReactNative/RendererProxy', () => ({ ...jest.requireActual('react-native/Libraries/ReactNative/RendererProxy'), findNodeHandle: () => 7 }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

// A held weigh-in save: while `mockGate` is set, `saveWeight` waits for it, as a slow disk write would.
let mockGate: Promise<void> | null = null;
jest.mock('../src/db/progress', () => {
  const actual = jest.requireActual('../src/db/progress');
  return { ...actual, saveWeight: async (...a: unknown[]) => { if (mockGate) await mockGate; return actual.saveWeight(...a); } };
});

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const meta = { version: 0, updated_at: '', deleted_at: null };
const weigh = (date: string, kg: number) => ({ id: null, version: 0, updated_at: `${date}T00:00:00Z`, deleted_at: null, date, weight_kg: kg });
const profileAt = (weight: string) => buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight, activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

describe('bodyweightOn', () => {
  const ws = [weigh('2026-10-01', 70), weigh('2026-10-05', 72), weigh('2026-10-09', 99), { ...weigh('2026-10-06', 50), deleted_at: '2026-10-06T00:00:00Z' }];
  it('is the latest weigh-in on or before the date, else the profile weight, else null', () => {
    expect(bodyweightOn(ws, '2026-10-05', 82)).toBe(72);
    expect(bodyweightOn(ws, '2026-10-08', 82)).toBe(72); // a later weigh-in and a deleted one are not used
    expect(bodyweightOn(ws, '2026-09-30', 82)).toBe(82);
    expect(bodyweightOn([], DATE, undefined)).toBeNull();
  });
});

describe('the workout scores an assisted lift at the latest weigh-in', () => {
  const OVER = { step_kg: 2.5, rep_low: 5, rep_high: 12 };
  const notify = jest.fn();
  async function started() {
    const db = await openDb();
    const base = { db, now: NOW, focus: [], adjustments: {}, notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn() };
    const hook = (type: ExType | null, name: string | null) => (p: { k: number }) => useWorkoutDay({ ...base, profile: profileAt('82'), tune: { unit: 'kg', overrides: type && name ? { [name]: { type, ...OVER } } : {} }, reloadKey: p.k } as unknown as Parameters<typeof useWorkoutDay>[0]);
    const view = await renderHook((p: { k: number; name: string | null }) => hook(p.name ? 'assisted' : null, p.name)(p), { initialProps: { k: 0, name: null as string | null } });
    await waitFor(() => expect(view.result.current.day.ready).toBe(true));
    await act(async () => void (await view.result.current.start('Upper A', {}, null)));
    await waitFor(async () => expect((await loadSets(db, DATE)).length).toBeGreaterThan(0));
    await act(async () => void (await dayQueue.current));
    const name = view.result.current.day.exs[0]!.name;
    await act(async () => void (await view.rerender({ k: 0, name })));
    notify.mockClear();
    const reload = async (k: number) => {
      await act(async () => void (await view.rerender({ k, name })));
      await waitFor(() => expect(view.result.current.day.ready).toBe(true));
    };
    return { db, name, reload, ...view };
  }
  async function seedDay(db: Awaited<ReturnType<typeof openDb>>, name: string, date: string, sets: [number, number][], record = false) {
    const w = (await loadWorkout(db, DATE))!;
    await saveWorkout(db, { ...w, date, id: `w-${date}` } as typeof w);
    let i = 0;
    for (const [kg, reps] of sets) {
      const s: WorkoutSet = { id: `${date}-${i}`, version: 0, updated_at: `${date}T09:00:00Z`, deleted_at: null, workout_id: null, exercise: name, kind: 'work', set_index: i++, weight_kg: kg, reps, done: true, rate: null, t: null };
      await saveSet(db, date, s);
    }
    if (record) await saveLift(db, name, { date, sets: sets.map(([w2, r]) => ({ w: w2, r, rate: null })), form: null, n: 3, first: '2026-09-01', prev: null, hist: [{ date, e: 1 }] });
  }
  type Hook = Awaited<ReturnType<typeof started>>['result'];
  const tickSet = async (result: Hook, j: number, w: string, r: string) => {
    await act(async () => result.current.editSet(0, 'work', j, 'w', w));
    await act(async () => result.current.editSet(0, 'work', j, 'r', r));
    await act(async () => result.current.tick(0, j));
    await act(async () => void (await dayQueue.current));
  };
  const toasts = () => notify.mock.calls.map(([m]) => String(m)).filter((m) => m.startsWith('New personal best'));
  const score = async (db: Awaited<ReturnType<typeof openDb>>, name: string) => (await loadLifts(db))[name]?.hist?.at(-1)?.e;

  it('scores the record and the toast at a weigh-in, with no profile change', async () => {
    const { db, name, reload, result } = await started();
    await seedDay(db, name, '2026-09-01', [[20, 8]]);
    await seedDay(db, name, '2026-09-20', [[20, 8]], true);
    await tickSet(result, 0, '12', '7'); // profile 82 kg: 7 x 70 = 490 against 8 x 62 = 496
    expect(toasts()).toEqual([]);
    expect(await score(db, name)).toBe(490);
    await saveWeight(db, weigh('2026-10-02', 60)); // a weigh-in only: the profile stays 82 kg
    await reload(1); // the tab is shown again / a pull moved dataVersion
    await tickSet(result, 1, '12', '7'); // 60 kg: today 7 x 48 = 336 against 8 x 40 = 320
    expect(toasts()).toHaveLength(1);
    expect(await score(db, name)).toBe(336);
  });

  it('a reload waits for a weigh-in whose save is still running (trackWrite)', async () => {
    const { db, name, reload, result } = await started();
    await seedDay(db, name, '2026-09-01', [[20, 8]]);
    await seedDay(db, name, '2026-09-20', [[20, 8]], true);
    await tickSet(result, 0, '12', '7'); // 82 kg: no toast
    expect(toasts()).toEqual([]);
    const progress = await renderHook(() => useProgress({ db, date: DATE, now: NOW, notify }));
    await waitFor(() => expect(progress.result.current.ready).toBe(true));
    let release = () => {};
    mockGate = new Promise<void>((r) => (release = r));
    await act(async () => progress.result.current.saveWeightText('60')); // queued, held in saveWeight
    await act(async () => void (await new Promise<void>((r) => setImmediate(r))));
    await reload(1); // the Workout tab is shown again while the save is still running
    mockGate = null;
    await act(async () => { release(); await new Promise<void>((r) => setImmediate(r)); await new Promise<void>((r) => setImmediate(r)); });
    await tickSet(result, 1, '12', '7'); // 60 kg: 336 against 320
    expect(toasts()).toHaveLength(1);
    expect(await score(db, name)).toBe(336);
  });

  it('does not use a weigh-in dated after the workout date', async () => {
    const { db, name, reload, result } = await started();
    await seedDay(db, name, '2026-09-01', [[20, 8]]);
    await seedDay(db, name, '2026-09-20', [[20, 8]], true);
    await saveWeight(db, weigh('2026-10-09', 60));
    await reload(1);
    await tickSet(result, 0, '12', '7');
    expect(toasts()).toEqual([]);
    expect(await score(db, name)).toBe(490); // still the 82 kg profile weight
  });
});

describe('History and Recent PRs agree for an assisted lift', () => {
  const ws = (id: string, i: number, w: number, r: number): WorkoutSet => ({ ...meta, id, workout_id: null, exercise: 'Assisted Pull-up', kind: 'work', set_index: i, weight_kg: w, reps: r, done: true, rate: null, t: null });
  const day = (date: string) => ({ ...meta, id: null, date, template: 'Pull A', base: 'Pull A', where: 'gym' as const, cardio_min: null, mods: {}, exercises: [], ci_choice: null });
  async function open(weights: [string, number][]) {
    const db = memoryDb();
    await saveProfile(db, profileAt('82'));
    // 30 kg assistance x 10, then 40 kg x 12: a record only when the bodyweight is high enough (100 kg: 700 -> 720; 82 kg: 520 -> 504).
    await saveWorkout(db, day('2026-10-01'));
    await saveSet(db, '2026-10-01', ws('a', 0, 30, 10));
    await saveWorkout(db, day('2026-10-06'));
    await saveSet(db, '2026-10-06', ws('b', 0, 40, 12));
    for (const [d, kg] of weights) await saveWeight(db, weigh(d, kg));
    await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    await screen.findByRole('header', { name: 'Progress' });
    const row = await screen.findByLabelText(/^Pull A, 6 Oct/);
    await fireEvent.press(row);
    await screen.findByRole('header', { name: 'Pull A' });
  }
  const badge = () => screen.queryAllByText('Personal best').length > 0;
  const recent = () => screen.queryAllByLabelText(/^Personal best, Assisted Pull-up, 12 reps with 40 kg of assistance/, { includeHiddenElements: true }).length > 0;
  // The Progress page stays mounted (hidden) under the open day, so its list is read there.
  const noRecords = () => screen.queryAllByText('No personal bests yet.', { includeHiddenElements: true }).length > 0;

  it('both show the record at a 100 kg weigh-in', async () => {
    await open([['2026-10-03', 100]]);
    await waitFor(() => expect(badge()).toBe(true));
    expect(recent()).toBe(true);
  });

  it('uses the viewed date (8 Oct), not the opened session date (6 Oct): a 7 Oct weigh-in counts', async () => {
    await open([['2026-10-07', 100]]);
    await waitFor(() => expect(badge()).toBe(true));
    expect(recent()).toBe(true);
  });

  it('neither shows it at the profile weight, or when the 100 kg weigh-in is after the viewed date', async () => {
    await open([['2026-10-09', 100]]);
    await act(async () => { await new Promise<void>((r) => setImmediate(r)); });
    expect(badge()).toBe(false);
    expect(recent()).toBe(false);
    expect(noRecords()).toBe(true); // the list did load, and is empty
  });
});
