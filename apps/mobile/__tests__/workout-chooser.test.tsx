import { AccessibilityInfo } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { doneCoverage, type CoverageDay } from '@plate-and-bar/core';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { loadSessionLog, loadSets, loadWorkout } from '../src/db/workouts';
import { workoutLists } from '../src/workout/workoutLists';
import { getCatalog } from '../src/workout/catalog';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

// Thursday 2026-10-08 is Push B on the 6-day split.
const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const NEXT_MONDAY = () => new Date(2026, 9, 12, 10, 0, 0);
const DATE = '2026-10-08';
const FOUR = { start: '2026-10-12', list: ['Upper A', 'Lower A', 'Upper B', 'Lower B'] };

async function setup(now = THURSDAY, adjustments: Record<string, unknown> = {}) {
  const db = memoryDb();
  await saveProfile(db, buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1)));
  await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), adjustments });
  await render(withProfile(db, <WorkoutScreen db={db} now={now} />));
  return db;
}
const press = (label: string) => fireEvent.press(screen.getByLabelText(label));
const nothingStored = (db: ReturnType<typeof memoryDb>) => {
  expect([...db.rows.keys()].filter((k) => k.startsWith('workouts:'))).toEqual([]);
  expect(db.sets.size).toBe(0);
};

describe('Choosing a workout previews it (#1005)', () => {
  it('shows the exercises and a way back, and leaves nothing in the store when going back', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Choose Pull A');
    expect(await screen.findByText('Pull A day')).toBeTruthy();
    expect(screen.getByLabelText('Exercise 1: Lat Pulldown')).toBeTruthy();
    expect(screen.getByLabelText('Start Pull A')).toBeTruthy();
    expect(screen.getByLabelText('Pick exercises')).toBeTruthy();
    expect(screen.queryByLabelText('Choose Pull B')).toBeNull(); // the list of workouts is replaced by the preview
    nothingStored(db);
    await press('Back to workouts');
    expect(await screen.findByText('Push B day')).toBeTruthy();
    expect(screen.getByLabelText('Choose Pull A')).toBeTruthy();
    expect(screen.queryByText('Session')).toBeNull();
    nothingStored(db);
    expect(await loadWorkout(db, DATE)).toBeNull();
    expect(await loadSets(db, DATE)).toEqual([]);
  });

  it('Start in the preview starts that workout', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Choose Pull A');
    await press('Start Pull A');
    await screen.findByText('Pull A');
    await waitFor(() => expect(JSON.parse(db.rows.get(`workouts:${DATE}`) as string)).toMatchObject({ template: 'Pull A', base: 'Pull A' }));
  });

  it('an abandoned preview leaves the rotation as it was', async () => {
    // A week plan: the next workout is the first unfinished entry of its list, from the sessions logged.
    const db = await setup(NEXT_MONDAY, { weekPlan: FOUR });
    expect(await screen.findByText('Upper A day')).toBeTruthy();
    await press('Choose Lower B');
    expect(await screen.findByText('Lower B day')).toBeTruthy();
    await press('Back to workouts');
    expect(await screen.findByText('Upper A day')).toBeTruthy();
    expect(await loadSessionLog(db)).toEqual({});
    nothingStored(db);
  });

  it('picking exercises from the workouts is also a preview, and back drops the picks', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Pick exercises');
    await press('Add Lat Pulldown from Pull A');
    expect(await screen.findByText('Your exercises')).toBeTruthy();
    nothingStored(db);
    await press('Back to workouts');
    expect(await screen.findByText('Push B day')).toBeTruthy();
    nothingStored(db);
  });
});

describe('A session mixing exercises from several workouts (#1005)', () => {
  it('counts every logged set towards its own exercise muscles in the weekly volume', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Pick exercises');
    await press('Add Lat Pulldown from Pull A');
    await press('Pick more exercises');
    await press('Add Barbell Bench Press from Push B');
    await press('Start these exercises');
    await screen.findByText('Session');
    await fireEvent.changeText(screen.getByLabelText('Lat Pulldown set 1 kg'), '50');
    await fireEvent.changeText(screen.getByLabelText('Lat Pulldown set 1 reps'), '8');
    await press('Mark Lat Pulldown set 1 done');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 kg'), '40');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 reps'), '8');
    await press('Mark Barbell Bench Press set 1 done');
    await waitFor(() => expect([...db.sets.values()].filter((s) => s.done === 1)).toHaveLength(2));

    const workout = (await loadWorkout(db, DATE)) as Workout;
    const sets = (await loadSets(db, DATE)) as WorkoutSet[];
    expect(workout.exercises.map((e) => e.name)).toEqual(['Lat Pulldown', 'Barbell Bench Press']);
    const days: CoverageDay[] = [{ date: DATE, workout, sets }];
    const { tags } = getCatalog();
    const done = doneCoverage(DATE, days, tags);
    // One ticked set of each: the row's and the bench's muscles both get it, whichever workout the exercise came from.
    expect(done[(tags['Lat Pulldown']!.primary[0]) as string]).toBeGreaterThanOrEqual(1);
    expect(done[(tags['Barbell Bench Press']!.primary[0]) as string]).toBeGreaterThanOrEqual(1);
    const expected: Record<string, number> = {};
    for (const n of ['Lat Pulldown', 'Barbell Bench Press']) {
      for (const m of tags[n]!.primary) expected[m] = (expected[m] ?? 0) + 1;
      for (const m of tags[n]!.secondary) expected[m] = (expected[m] ?? 0) + 0.5;
    }
    expect(done).toEqual(expected);
  });

  it('an exercise from another workout can be added during a session, and its sets count for its muscles', async () => {
    const db = await setup();
    await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
    await screen.findByText('Push B');
    await press('Add exercise');
    await press('Add Lat Pulldown from Pull A');
    await screen.findByLabelText('Lat Pulldown set 1 kg');
    await fireEvent.changeText(screen.getByLabelText('Lat Pulldown set 1 kg'), '50');
    await fireEvent.changeText(screen.getByLabelText('Lat Pulldown set 1 reps'), '8');
    await press('Mark Lat Pulldown set 1 done');
    await waitFor(() => expect([...db.sets.values()].filter((s) => s.done === 1)).toHaveLength(1));
    const workout = (await loadWorkout(db, DATE)) as Workout;
    const { tags } = getCatalog();
    const done = doneCoverage(DATE, [{ date: DATE, workout, sets: (await loadSets(db, DATE)) as WorkoutSet[] }], tags);
    for (const m of tags['Lat Pulldown']!.primary) expect(done[m]).toBe(1);
    // The rotation keys off the workout the user started, not the exercises added to it.
    expect(workout.base).toBe('Push B');
  });
});

describe('Workout lists apply the user rules (#1005)', () => {
  const base = { date: DATE, lifts: {} };
  it('offers the template as it is with no rules', () => {
    const [push] = workoutLists(['Push B'], 'gym', { ...base, exclusions: [], swaps: [] });
    expect(push!.exercises).toEqual(['Barbell Bench Press', 'Machine Shoulder Press', 'Pec Deck Fly', 'Cable Lateral Raise', 'Overhead Cable Extension']);
  });
  it('leaves out an excluded exercise', () => {
    const excl = { scope: 'exercise' as const, key: 'Barbell Bench Press', reason: 'pain' as const, to: {}, done: false };
    const [push] = workoutLists(['Push B'], 'gym', { ...base, exclusions: [excl], swaps: [] });
    expect(push!.exercises).not.toContain('Barbell Bench Press');
  });
  it('shows the replacement of a swapped exercise', () => {
    const swap = { from: 'Pec Deck Fly', to: 'Cable Crossover', bridge_until: null };
    const [push] = workoutLists(['Push B'], 'gym', { ...base, exclusions: [], swaps: [swap] });
    expect(push!.exercises).toContain('Cable Crossover');
    expect(push!.exercises).not.toContain('Pec Deck Fly');
  });
});

describe('Preview picks and announcements (#1005)', () => {
  it('Pick exercises in a preview starts from that workout, and a pick can be removed', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Choose Pull A');
    await press('Pick exercises');
    await press('Add Barbell Bench Press from Push B');
    expect(await screen.findByText('Your exercises')).toBeTruthy();
    expect(screen.getByLabelText('Exercise 1: Lat Pulldown')).toBeTruthy();
    expect(screen.getByLabelText('Exercise 5: Cable Crunch')).toBeTruthy();
    expect(screen.getByLabelText('Exercise 6: Barbell Bench Press')).toBeTruthy();
    await press('Remove Lat Pulldown from your exercises');
    expect(screen.queryByLabelText(/Exercise \d: Lat Pulldown/)).toBeNull();
    nothingStored(db);
    await press('Start these exercises');
    await screen.findByText('Pull A');
    await waitFor(() => expect(JSON.parse(db.rows.get(`workouts:${DATE}`) as string).exercises.map((e: { name: string }) => e.name)).toEqual(['Seated Cable Row', 'Face Pull', 'Dumbbell Curl', 'Cable Crunch', 'Barbell Bench Press']));
  });

  it('removing the last pick returns to the list of workouts', async () => {
    await setup();
    await screen.findByText('Push B day');
    await press('Pick exercises');
    await press('Add Barbell Bench Press');
    await press('Remove Barbell Bench Press from your exercises');
    expect(await screen.findByText('Push B day')).toBeTruthy();
    expect(screen.getByLabelText('Choose Pull A')).toBeTruthy();
  });

  it('announces the preview and the way back', async () => {
    const say = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    await setup();
    await screen.findByText('Push B day');
    await press('Choose Pull A');
    expect(say).toHaveBeenLastCalledWith('Pull A day preview. Nothing is saved until you start.');
    await press('Back to workouts');
    expect(say).toHaveBeenLastCalledWith('Back to the list of workouts.');
    say.mockRestore();
  });
});
