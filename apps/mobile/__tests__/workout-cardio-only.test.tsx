import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { BurnCard } from '../src/food/BurnCard';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import type { Workout } from '../src/workout/types';
import { memoryDb, withProfile } from './helpers';

// #619: the prototype's renderWorkout always adds the Cardio block, after the start view (planned day, rest day) as well as
// inside a started session, so cardio minutes can be logged without a session. A cardio-only day is a workout row with no
// template, no base and no exercises (all nullable in the contract), and no sets.
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0); // Push B day
const SUNDAY = () => new Date(2026, 9, 11, 10, 0, 0); // rest day
const THU = '2026-10-08';
const SUN = '2026-10-11';

const profile = () =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

type Db = ReturnType<typeof memoryDb>;
const field = () => screen.getByLabelText('Cardio minutes');
const press = (label: string) => fireEvent.press(screen.getByLabelText(label));
const workoutOn = (db: Db, date: string) => JSON.parse(db.rows.get(`workouts:${date}`) as string) as Workout;

async function mount(now: () => Date, db: Db = memoryDb()) {
  await saveProfile(db, profile());
  await render(withProfile(db, <WorkoutScreen db={db} now={now} />));
  return db;
}

describe('Cardio block visibility (#619)', () => {
  it('shows on a planned day before Start', async () => {
    await mount(THURSDAY);
    await screen.findByText('Push B day');
    expect(screen.getByText('Cardio')).toBeTruthy();
    expect(field().props.value).toBe('');
    expect(screen.getByText('minutes (walk, cycle, incline treadmill)')).toBeTruthy();
  });

  it('shows on a rest day', async () => {
    await mount(SUNDAY);
    await screen.findByText('Rest day');
    expect(screen.getByText('Cardio')).toBeTruthy();
    expect(field()).toBeTruthy();
  });

  it('shows inside a started session', async () => {
    await mount(THURSDAY);
    await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
    await screen.findByText('Push B');
    expect(screen.getByText('Cardio')).toBeTruthy();
    expect(field()).toBeTruthy();
  });
});

describe('Cardio on a day with no started session (#619)', () => {
  it('typing minutes on a rest day stores a cardio-only workout row, stays on the rest day, and survives a reload', async () => {
    const db = await mount(SUNDAY);
    await screen.findByText('Rest day');
    expect(db.rows.has(`workouts:${SUN}`)).toBe(false);
    await fireEvent.changeText(field(), '30');
    await waitFor(() => expect(workoutOn(db, SUN)).toMatchObject({ date: SUN, template: null, base: null, where: null, cardio_min: 30, mods: {}, exercises: [], ci_choice: null, deleted_at: null }));
    expect(db.sets.size).toBe(0);
    expect(screen.getByText('Rest day')).toBeTruthy();
    expect(screen.getByLabelText('Start Pull A')).toBeTruthy();
    expect(field().props.value).toBe('30');
    expect(screen.queryByText(/kcal burned/)).toBeNull();

    await screen.unmount();
    await mount(SUNDAY, db);
    await screen.findByText('Rest day');
    expect(field().props.value).toBe('30');
  });

  it('blank text with no workout stores nothing; a cleared field on a cardio-only day keeps the row with no minutes', async () => {
    const db = await mount(SUNDAY);
    await screen.findByText('Rest day');
    await fireEvent.changeText(field(), '  ');
    await act(async () => {});
    expect(db.rows.has(`workouts:${SUN}`)).toBe(false);
    await fireEvent.changeText(field(), '20');
    await waitFor(() => expect(workoutOn(db, SUN).cardio_min).toBe(20));
    await fireEvent.changeText(field(), '');
    await waitFor(() => expect(workoutOn(db, SUN).cardio_min).toBeNull());
    expect(workoutOn(db, SUN).deleted_at).toBeNull();
  });

  it('typing a number key by key on a planned day keeps one row and the typed text', async () => {
    const db = await mount(THURSDAY);
    await screen.findByText('Push B day');
    for (const text of ['4', '45']) await fireEvent.changeText(field(), text);
    await waitFor(() => expect(workoutOn(db, THU).cardio_min).toBe(45));
    expect(field().props.value).toBe('45');
    expect([...db.rows.keys()].filter((k) => k.startsWith('workouts:'))).toEqual([`workouts:${THU}`]);
  });

  it('Start after logging cardio begins the session and keeps the minutes, stored and on screen', async () => {
    const db = await mount(THURSDAY);
    await screen.findByText('Push B day');
    await fireEvent.changeText(field(), '25');
    await waitFor(() => expect(workoutOn(db, THU).cardio_min).toBe(25));
    await press('Start Push B');
    await screen.findByText('Push B');
    await waitFor(() => expect(workoutOn(db, THU)).toMatchObject({ template: 'Push B', base: 'Push B', cardio_min: 25 }));
    expect(workoutOn(db, THU).exercises.length).toBeGreaterThan(0);
    expect(db.sets.size).toBeGreaterThan(0);
    expect(field().props.value).toBe('25');
  });

  it('removing the last exercise keeps the cardio minutes as a cardio-only day, and a session can start again', async () => {
    const db = await mount(THURSDAY);
    await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
    await screen.findByText('Push B');
    await fireEvent.changeText(field(), '15');
    await waitFor(() => expect(workoutOn(db, THU).cardio_min).toBe(15));
    const names = workoutOn(db, THU).exercises.map((e) => e.name);
    for (const n of names) {
      await press(`Remove ${n} from today`);
      await press(`Tap again to remove ${n} from today`);
    }
    await screen.findByText('Push B day');
    await waitFor(() => expect(workoutOn(db, THU)).toMatchObject({ template: null, base: null, exercises: [], cardio_min: 15, deleted_at: null }));
    expect(field().props.value).toBe('15');
    await press('Start Push B');
    await screen.findByText('Push B');
    expect(field().props.value).toBe('15');
  });

  it('removing the last exercise with no cardio still deletes the workout (#413)', async () => {
    const db = await mount(THURSDAY);
    await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
    await screen.findByText('Push B');
    for (const n of workoutOn(db, THU).exercises.map((e) => e.name)) {
      await press(`Remove ${n} from today`);
      await press(`Tap again to remove ${n} from today`);
    }
    await screen.findByText('Push B day');
    await waitFor(() => expect(workoutOn(db, THU).deleted_at).toBeTruthy());
  });

  it('a live session pulled from another device is not overwritten by the first cardio keystroke', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await render(withProfile(db, <WorkoutScreen db={db} now={SUNDAY} />));
    await screen.findByText('Rest day');
    // Stored after the screen loaded (a pull the screen has not shown yet).
    const pulled: Workout = { id: null, version: 3, updated_at: '2026-10-11T08:00:00Z', deleted_at: null, date: SUN, template: 'Pull A', base: 'Pull A', where: null, cardio_min: null, mods: {}, exercises: [{ name: 'Lat Pulldown', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }], ci_choice: null };
    db.rows.set(`workouts:${SUN}`, JSON.stringify(pulled));
    await fireEvent.changeText(field(), '10');
    await waitFor(() => expect(workoutOn(db, SUN)).toMatchObject({ template: 'Pull A', base: 'Pull A', cardio_min: 10 }));
    expect(workoutOn(db, SUN).exercises.map((e) => e.name)).toEqual(['Lat Pulldown']);
    expect(await screen.findByText('Pull A')).toBeTruthy();
  });

  it('the Today burn card counts a cardio-only day through core workoutBurn: 30 min at 82 kg is 165 kcal above resting', async () => {
    const db = memoryDb();
    const p = profile();
    await saveProfile(db, p);
    const row: Workout = { id: null, version: 0, updated_at: '2026-10-11T08:00:00Z', deleted_at: null, date: SUN, template: null, base: null, where: null, cardio_min: 30, mods: {}, exercises: [], ci_choice: null };
    db.rows.set(`workouts:${SUN}`, JSON.stringify(row));
    await render(withProfile(db, <BurnCard db={db} date={SUN} profile={p} steps={0} kcalEaten={0} />));
    await fireEvent.press(await screen.findByLabelText('Show burn details'));
    expect(screen.getByLabelText('Training, 0 sets, 30 min cardio, rough, 165 kilocalories')).toBeTruthy();
  });
});
