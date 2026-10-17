import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';

function profile(days: 0 | 6) {
  return buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
}
async function setup(days: 0 | 6) {
  const db = memoryDb();
  await saveProfile(db, profile(days));
  await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
  return db;
}
const press = (label: string) => fireEvent.press(screen.getByLabelText(label));
const stored = <T,>(db: ReturnType<typeof memoryDb>, key: string) => JSON.parse(db.rows.get(key) as string) as T;

describe('Workout start: Pick exercises', () => {
  it('a 0-training-day profile has the chip on its rest day, picks an exercise, starts and logs a set', async () => {
    const db = await setup(0);
    expect(await screen.findByText('Rest day')).toBeTruthy();
    await press('Pick exercises');
    await press('Add Barbell Bench Press');
    await screen.findByText('Session');
    expect(stored<Workout>(db, `workouts:${DATE}`)).toMatchObject({ id: null, template: 'Session', base: null, where: null, date: DATE });
    expect(stored<Workout>(db, `workouts:${DATE}`).exercises.map((e) => e.name)).toEqual(['Barbell Bench Press']);
    const sets = () => [...db.sets.values()].map((s) => JSON.parse(s.data) as WorkoutSet);
    expect(sets()).toHaveLength(3);
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 kg'), '40');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 reps'), '8');
    await press('Mark Barbell Bench Press set 1 done');
    await waitFor(() => expect(sets().find((s) => s.set_index === 0)).toMatchObject({ done: true, weight_kg: 40, reps: 8 }));
  });

  it('the where override chosen on the start screen applies to the picked session', async () => {
    const db = await setup(0);
    await screen.findByText('Rest day');
    await press('Training away from your gym?');
    await press('Dumbbells only');
    await press('Pick exercises');
    await press('Add Dumbbell Curl');
    await screen.findByText('Session');
    expect(stored<Workout>(db, `workouts:${DATE}`)).toMatchObject({ where: 'dumbbells', template: 'Session', base: null });
  });

  it('a planned day keeps its Start button and template chips, and can pick instead', async () => {
    const db = await setup(6);
    expect(await screen.findByText('Push B day')).toBeTruthy();
    expect(screen.getByLabelText('Start Push B')).toBeTruthy();
    expect(screen.getByLabelText('Start Pull A')).toBeTruthy();
    await press('Pick exercises');
    await press('Add Barbell Bench Press');
    await screen.findByText('Session');
    expect(stored<Workout>(db, `workouts:${DATE}`).exercises).toHaveLength(1);
  });

  it('Start Push B on a planned day is unchanged', async () => {
    const db = await setup(6);
    await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
    await screen.findByText('Push B');
    expect(stored<Workout>(db, `workouts:${DATE}`)).toMatchObject({ template: 'Push B', base: 'Push B' });
    expect(stored<Workout>(db, `workouts:${DATE}`).exercises).toHaveLength(5);
  });
});
